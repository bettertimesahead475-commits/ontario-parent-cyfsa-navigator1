// ---------------------------------------------------------------------------
// Enforces the free-tier limit on the Document Analyzer. Before this file,
// "1 free analysis" was documentation only — /api/analyze never checked a
// uid, a tier, or a count, so it ran unlimited times for anyone regardless
// of payment. This is the actual enforcement, backed by a new Supabase
// table (free_usage) keyed on the parent's Firebase uid.
// ---------------------------------------------------------------------------

import { getSupabase } from "./access.js";
import { LifecycleError } from "./lifecycleErrors.js";
import { withTransientRetry } from "./transientRetry.js";
import { logSupabaseFailure } from "./supabaseDiagnostics.js";

export const FREE_ANALYSES_LIMIT = 1;

export async function getFreeUsage(uid: string): Promise<number> {
  try {
    return await withTransientRetry(async () => {
      const db = getSupabase();
      // postgrest-js retries failed GETs internally (1s + 2s + 4s backoff). Stacked under
      // withTransientRetry's own three attempts, an unreachable database made the parent wait
      // ~20s (or minutes on connect timeouts) before the access check failed. One retry layer -
      // the short one here - is kept; the result still fails closed.
      const { data, error } = await db
        .from("free_usage")
        .select("analyses_used")
        .eq("uid", uid)
        .retry(false)
        .maybeSingle();
      if (error) {
        throw Object.assign(new Error(`Failed to read usage: ${error.message}`), { statusCode: 500, supabaseError: error });
      }
      return data?.analyses_used ?? 0;
    });
  } catch (err: any) {
    if (err instanceof LifecycleError) throw err;
    // Still fails closed (never grants access); the cause is now recorded instead of discarded.
    logSupabaseFailure("free_usage read", err?.supabaseError ?? err);
    throw new LifecycleError(
      503,
      "USAGE_SERVICE_TEMPORARILY_UNAVAILABLE",
      "We couldn't verify your analysis access right now. Your document is safe. Please retry in a moment."
    );
  }
}

/**
 * Call ONLY after an analysis actually succeeds — a failed attempt (bad AI
 * call, malformed upload, etc.) should never cost a parent their one free
 * try. Upserts the row and increments the count.
 */
export async function recordFreeUse(uid: string, email: string | null): Promise<void> {
  try {
    const current = await getFreeUsage(uid);
    const now = new Date().toISOString();
    await withTransientRetry(async () => {
      const db = getSupabase();
      const { error } = await db.from("free_usage").upsert(
        {
          uid,
          email,
          analyses_used: current + 1,
          first_analysis_at: current === 0 ? now : undefined,
          last_analysis_at: now,
        },
        { onConflict: "uid" }
      );
      if (error) {
        throw Object.assign(new Error(`Failed to record usage: ${error.message}`), { statusCode: 500, supabaseError: error });
      }
    });
  } catch (err: any) {
    if (err instanceof LifecycleError) throw err;
    logSupabaseFailure("free_usage write", err?.supabaseError ?? err);
    throw new LifecycleError(
      503,
      "USAGE_SERVICE_TEMPORARILY_UNAVAILABLE",
      "We couldn't update your analysis usage right now. Please try again in a moment."
    );
  }
}
