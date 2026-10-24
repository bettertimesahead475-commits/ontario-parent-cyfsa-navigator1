// ---------------------------------------------------------------------------
// Atomic primitives over the existing free_usage table. No schema change.
//
// - A row insert is a one-winner claim: uid is the primary key, so a second insert of the same uid
//   fails with 23505 and changes nothing.
// - A counter increment is a compare-and-set update: "set analyses_used = next where analyses_used = current".
//   If another instance changed the counter first, zero rows match and the caller re-reads and retries.
//
// PostgREST returns failures as { error } rather than throwing, so every call checks both.
// Any unexpected failure fails closed: callers receive a retryable 503 before any AI call is made.
// ---------------------------------------------------------------------------

import { getSupabase } from "./access.js";
import { LifecycleError } from "./lifecycleErrors.js";
import { withTransientRetry } from "./transientRetry.js";
import { logSupabaseFailure } from "./supabaseDiagnostics.js";

export const UNIQUE_VIOLATION = "23505";
const MAX_CAS_ATTEMPTS = 25;

export interface UsageRow {
  uid: string;
  email: string | null;
  analyses_used: number;
  first_analysis_at: string | null;
  last_analysis_at: string | null;
}

export function usageUnavailable(operation: string, cause: unknown): LifecycleError {
  logSupabaseFailure(operation, cause);
  return new LifecycleError(
    503,
    "USAGE_SERVICE_TEMPORARILY_UNAVAILABLE",
    "We couldn't verify your analysis access right now. Your document is safe. Please retry in a moment."
  );
}

async function run<T>(operation: string, fn: (db: ReturnType<typeof getSupabase>) => Promise<{ data: T; error: any }>): Promise<T> {
  try {
    return await withTransientRetry(async () => {
      const { data, error } = await fn(getSupabase());
      if (error) {
        throw Object.assign(new Error(`${operation} failed: ${error.message}`), { supabaseError: error, statusCode: 503 });
      }
      return data;
    });
  } catch (err: any) {
    if (err instanceof LifecycleError) throw err;
    throw usageUnavailable(operation, err?.supabaseError ?? err);
  }
}

/**
 * Writes are never retried by the transport or by us. A lost response leaves the outcome unknown: the write may
 * have committed. A retry could apply it twice (a counter incremented twice, a unit given back twice). So an
 * ambiguous write fails closed as 503, and the reservation is cleaned up by the TTL instead.
 */
async function writeOnce<T>(operation: string, fn: (db: ReturnType<typeof getSupabase>) => PromiseLike<{ data: T; error: any }>): Promise<T> {
  let result: { data: T; error: any };
  try {
    result = await fn(getSupabase());
  } catch (err) {
    throw usageUnavailable(operation, err);
  }
  if (result.error) {
    throw usageUnavailable(operation, result.error);
  }
  return result.data;
}

/** Waits a short random time before retrying a compare-and-set that lost a race. */
export async function backoff(attempt: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, Math.random() * 5 * (attempt + 1)));
}

/** Returns the row, or null when the uid has never been written. */
export async function readUsageRow(uid: string): Promise<UsageRow | null> {
  const rows = await run<UsageRow[]>("free_usage read", async (db) => {
    const { data, error } = await db
      .from("free_usage")
      .select("uid, email, analyses_used, first_analysis_at, last_analysis_at")
      .eq("uid", uid)
      .limit(1)
      .retry(false);
    return { data: data as UsageRow[], error };
  });
  return rows?.[0] ?? null;
}

/** Inserts a new row. Returns false (and changes nothing) if the uid already exists. */
export async function claimUsageRow(row: UsageRow): Promise<boolean> {
  let result: { error: any };
  try {
    result = await getSupabase().from("free_usage").insert(row);
  } catch (err) {
    throw usageUnavailable("free_usage insert", err);
  }
  if (result.error?.code === UNIQUE_VIOLATION) return false;
  if (result.error) throw usageUnavailable("free_usage insert", result.error);
  return true;
}

/**
 * Sets analyses_used to `next` only if it still equals `expected`.
 * Returns true when this call made the change.
 */
export async function compareAndSetCounter(uid: string, expected: number, next: number): Promise<boolean> {
  const rows = await writeOnce<Array<{ uid: string }>>("free_usage counter update", async (db) =>
    db
      .from("free_usage")
      .update({ analyses_used: next, last_analysis_at: new Date().toISOString() })
      .eq("uid", uid)
      .eq("analyses_used", expected)
      .select("uid")
      .retry(false)
  );
  return Array.isArray(rows) && rows.length === 1;
}

/** Adds one to a counter, creating the row if needed. Lost updates are impossible: every write is a CAS. */
export async function incrementCounter(uid: string, email: string | null): Promise<number> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const row = await readUsageRow(uid);
    if (!row) {
      const now = new Date().toISOString();
      if (await claimUsageRow({ uid, email, analyses_used: 1, first_analysis_at: now, last_analysis_at: now })) {
        return 1;
      }
      continue;
    }
    const next = row.analyses_used + 1;
    if (await compareAndSetCounter(uid, row.analyses_used, next)) return next;
    await backoff(attempt);
  }
  throw usageUnavailable("free_usage counter increment", new Error(`contention on ${uid}`));
}

/** Subtracts one from a counter, never below zero. Missing rows are left alone. */
export async function decrementCounter(uid: string): Promise<number> {
  for (let attempt = 0; attempt < MAX_CAS_ATTEMPTS; attempt++) {
    const row = await readUsageRow(uid);
    if (!row || row.analyses_used <= 0) return 0;
    const next = row.analyses_used - 1;
    if (await compareAndSetCounter(uid, row.analyses_used, next)) return next;
    await backoff(attempt);
  }
  throw usageUnavailable("free_usage counter decrement", new Error(`contention on ${uid}`));
}

/**
 * Changes a row's email marker only if it currently has `fromEmail`. Returns true when changed.
 * `resetSlot` also zeroes analyses_used, so a re-taken reservation never inherits a slot it did not claim.
 */
export async function transitionMarker(uid: string, fromEmail: string, toEmail: string, resetSlot = false): Promise<boolean> {
  const patch: Record<string, unknown> = { email: toEmail, last_analysis_at: new Date().toISOString() };
  if (resetSlot) patch.analyses_used = 0;
  const rows = await writeOnce<Array<{ uid: string }>>("free_usage marker update", async (db) =>
    db
      .from("free_usage")
      .update(patch)
      .eq("uid", uid)
      .eq("email", fromEmail)
      .select("uid")
      .retry(false)
  );
  return Array.isArray(rows) && rows.length === 1;
}

/** Records the counter slot a reservation claimed, only while its marker still says `email`. */
export async function setMarkerSlot(uid: string, email: string, slot: number): Promise<boolean> {
  const rows = await writeOnce<Array<{ uid: string }>>("free_usage marker slot update", async (db) =>
    db
      .from("free_usage")
      .update({ analyses_used: slot, last_analysis_at: new Date().toISOString() })
      .eq("uid", uid)
      .eq("email", email)
      .select("uid")
      .retry(false)
  );
  return Array.isArray(rows) && rows.length === 1;
}

/**
 * Lists rows whose uid starts with `uidPrefix` and whose email starts with `emailPrefix`.
 * PostgREST's documented LIKE wildcard in URLs is `*`. Prefixes are restricted to letters, digits, `_` and `-`,
 * so no escaping is needed.
 */
export async function listMarkers(uidPrefix: string, emailPrefix: string): Promise<UsageRow[]> {
  if (!/^[A-Za-z0-9_\-]+$/.test(uidPrefix) || !/^[A-Za-z0-9_:\-]+$/.test(emailPrefix)) {
    throw new Error("Unsafe marker prefix");
  }
  const rows = await run<UsageRow[]>("free_usage marker list", async (db) => {
    const { data, error } = await db
      .from("free_usage")
      .select("uid, email, analyses_used, first_analysis_at, last_analysis_at")
      .like("uid", `${uidPrefix}*`)
      .like("email", `${emailPrefix}*`)
      .retry(false);
    return { data: data as UsageRow[], error };
  });
  return (rows ?? []).filter((r) => r.uid.startsWith(uidPrefix) && (r.email ?? "").startsWith(emailPrefix));
}
