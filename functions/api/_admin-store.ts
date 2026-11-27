/**
 * Data access for the administrator console: Supabase REST (service role, server side only) and an append-only
 * administrator audit trail kept in the existing private `analysis_jobs` Storage bucket.
 *
 * The production database has no audit or settlement-status table (see
 * supabase/migrations_pending_approval/paid_payments_columns_minimal.sql), so every administrator action is recorded as
 * one immutable object whose NAME carries the timestamp, action and target. A single list call therefore yields the
 * whole history (and the latest bank-settlement state of each payment) without new infrastructure or schema changes,
 * and two administrators acting at once can never overwrite each other's record.
 */
import { normalizeSupabaseKey } from './_supabase-key';
import { byCodeUnit } from "../../shared/codeUnitOrder";

export type AdminStoreEnv = { STAGING_SUPABASE_URL?: string; STAGING_SUPABASE_SERVICE_ROLE_KEY?: string };
export const AUDIT_BUCKET = 'analysis_jobs';
export const AUDIT_PREFIX = 'admin-audit';

export class AdminStoreError extends Error {
  constructor(readonly code: string, readonly status: number, message: string, readonly pgCode: string | null = null) {
    super(message);
    this.name = 'AdminStoreError';
  }
}

function config(env: AdminStoreEnv): { base: string; key: string } {
  const key = normalizeSupabaseKey(env.STAGING_SUPABASE_SERVICE_ROLE_KEY);
  let url: URL | null = null;
  try { url = env.STAGING_SUPABASE_URL ? new URL(env.STAGING_SUPABASE_URL) : null; } catch { url = null; }
  if (!url || url.protocol !== 'https:' || !key) throw new AdminStoreError('ADMIN_STORE_NOT_CONFIGURED', 503, 'Administrator data service is not configured.');
  return { base: url.origin, key };
}

/** PostgREST call. `path` is relative to /rest/v1/ and must already be encoded. */
export async function rest<T>(env: AdminStoreEnv, path: string, init: { method?: string; body?: unknown; prefer?: string } = {}, fetcher: typeof fetch = fetch): Promise<T> {
  const { base, key } = config(env);
  let response: Response;
  try {
    response = await fetcher(`${base}/rest/v1/${path}`, {
      method: init.method || 'GET',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Accept: 'application/json',
        ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        ...(init.prefer ? { Prefer: init.prefer } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new AdminStoreError('ADMIN_STORE_UNAVAILABLE', 503, 'The database did not respond.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { code?: unknown } | null;
    const pgCode = typeof body?.code === 'string' && /^(PGRST\d{3}|[0-9A-Z]{5})$/.test(body.code) ? body.code : null;
    // The table name only; never row data, filters, or the upstream message (it can echo values).
    console.warn('[ADMIN_STORE_REJECTED]', JSON.stringify({ table: path.split('?')[0], status: response.status, pgCode }));
    const missing = pgCode === '42P01' || pgCode === 'PGRST205' || pgCode === '42703' || pgCode === 'PGRST204';
    throw new AdminStoreError(missing ? 'ADMIN_SCHEMA_UNAVAILABLE' : 'ADMIN_STORE_REJECTED', missing ? 501 : 502,
      missing ? 'This record type is not available in the current database schema.' : 'The database rejected the request.', pgCode);
  }
  // `Prefer: return=minimal` answers 201/204 with an empty body.
  const text = await response.text();
  return (text ? JSON.parse(text) : []) as T;
}

/** Like rest(), but a table or column that does not exist in this database yields `fallback` instead of an error. */
export async function restOptional<T>(env: AdminStoreEnv, path: string, fallback: T, fetcher: typeof fetch = fetch): Promise<{ data: T; available: boolean }> {
  try {
    return { data: await rest<T>(env, path, {}, fetcher), available: true };
  } catch (error) {
    if (error instanceof AdminStoreError && error.code === 'ADMIN_SCHEMA_UNAVAILABLE') return { data: fallback, available: false };
    throw error;
  }
}

export type AuditEvent = {
  at: string;
  action: string;
  target: string;
  admin: string;
  reason: string | null;
  details: Record<string, unknown>;
};

/** Characters allowed in an object-name segment. */
export function safeSegment(value: string, max = 64): string {
  return (value || 'none').replace(/[^A-Za-z0-9-]/g, '-').replace(/-+/g, '-').slice(0, max) || 'none';
}

function compactTimestamp(date: Date): string {
  return date.toISOString().replace(/[-:.]/g, '');
}

export function auditObjectName(event: Pick<AuditEvent, 'at' | 'action' | 'target'>, nonce: string): string {
  return `${compactTimestamp(new Date(event.at))}__${safeSegment(event.action, 32)}__${safeSegment(event.target)}__${safeSegment(nonce, 16)}.json`;
}

export function parseAuditObjectName(name: string): { at: string; action: string; target: string } | null {
  const match = /^(\d{8}T\d{9}Z)__([A-Za-z0-9-]+)__([A-Za-z0-9-]+)__[A-Za-z0-9-]+\.json$/.exec(name);
  if (!match) return null;
  const t = match[1];
  const at = `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(9, 11)}:${t.slice(11, 13)}:${t.slice(13, 15)}.${t.slice(15, 18)}Z`;
  return { at, action: match[2], target: match[3] };
}

/** Appends one immutable audit record. Never overwrites (x-upsert false), so records cannot be altered through here. */
export async function appendAudit(env: AdminStoreEnv, event: Omit<AuditEvent, 'at'>, fetcher: typeof fetch = fetch): Promise<AuditEvent> {
  const { base, key } = config(env);
  const full: AuditEvent = { at: new Date().toISOString(), ...event };
  const name = auditObjectName(full, crypto.randomUUID().slice(0, 8));
  const response = await fetcher(`${base}/storage/v1/object/${AUDIT_BUCKET}/${AUDIT_PREFIX}/${encodeURIComponent(name)}`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', 'x-upsert': 'false' },
    body: JSON.stringify(full),
    redirect: 'manual',
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!response || !response.ok) {
    console.error('[ADMIN_AUDIT_WRITE_FAILED]', JSON.stringify({ action: full.action, status: response?.status ?? 0 }));
    throw new AdminStoreError('ADMIN_AUDIT_UNAVAILABLE', 503, 'The administrator audit log could not be written.');
  }
  return full;
}

/** Lists audit object names, newest first (up to `limit`, paging the Storage list API). */
export async function listAuditNames(env: AdminStoreEnv, limit = 1000, fetcher: typeof fetch = fetch): Promise<string[]> {
  return (await listAuditNamesWithCompleteness(env, limit, fetcher)).names;
}

/**
 * Audit object names (newest first) and whether the listing was read to its end. `exhausted` is decided on the RAW
 * page sizes: entries that are not audit records (folder placeholders, stray files) are skipped but still count
 * toward a full page, so they cannot make a cut-off listing look complete. A non-array page is an error.
 */
export async function listAuditNamesWithCompleteness(env: AdminStoreEnv, limit = 1000, fetcher: typeof fetch = fetch): Promise<{ names: string[]; exhausted: boolean }> {
  const { base, key } = config(env);
  const names: string[] = [];
  let exhausted = false;
  for (let offset = 0; offset < limit; offset += 1000) {
    const pageSize = Math.min(1000, limit - offset);
    const response = await fetcher(`${base}/storage/v1/object/list/${AUDIT_BUCKET}`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ prefix: AUDIT_PREFIX, limit: pageSize, offset, sortBy: { column: 'name', order: 'desc' } }),
      redirect: 'manual',
      signal: AbortSignal.timeout(8000),
    }).catch(() => null);
    if (!response || !response.ok) throw new AdminStoreError('ADMIN_AUDIT_UNAVAILABLE', 503, 'The administrator audit log could not be read.');
    const page = await response.json().catch(() => null) as Array<{ name?: unknown }> | null;
    if (!Array.isArray(page)) throw new AdminStoreError('ADMIN_AUDIT_UNAVAILABLE', 503, 'The administrator audit log could not be read.');
    const valid = page.map((o) => o?.name).filter((n): n is string => typeof n === 'string' && parseAuditObjectName(n) !== null);
    names.push(...valid);
    if (page.length < pageSize) { exhausted = true; break; }
  }
  return { names: names.sort(byCodeUnit).reverse(), exhausted };
}

/** Like listAuditNames, but refuses (503) when the listing could not be read completely: for decisions that need the
 * whole history (has this payment been refunded? which suspension is current?). */
export async function listAllAuditNames(env: AdminStoreEnv, limit: number, fetcher: typeof fetch = fetch): Promise<string[]> {
  const { names, exhausted } = await listAuditNamesWithCompleteness(env, limit, fetcher);
  if (!exhausted) throw new AdminStoreError('ADMIN_AUDIT_TRUNCATED', 503, 'The administrator audit log is larger than can be read safely; this action was not taken.');
  return names;
}

export async function readAuditEvent(env: AdminStoreEnv, name: string, fetcher: typeof fetch = fetch): Promise<AuditEvent | null> {
  const { base, key } = config(env);
  if (!parseAuditObjectName(name)) return null;
  const response = await fetcher(`${base}/storage/v1/object/authenticated/${AUDIT_BUCKET}/${AUDIT_PREFIX}/${encodeURIComponent(name)}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    redirect: 'manual',
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!response || !response.ok) return null;
  return await response.json().catch(() => null) as AuditEvent | null;
}

export const SETTLEMENT_ACTIONS: Record<string, string> = {
  'confirm-bank': 'bank_confirmed',
  dispute: 'missing_or_disputed',
  refund: 'refunded',
  'reset-settlement': 'pending_settlement',
};

/** Latest bank-settlement state per payment reference, derived from the (newest-first) audit names. */
export function settlementByReference(namesNewestFirst: string[]): Map<string, { status: string; at: string }> {
  const result = new Map<string, { status: string; at: string }>();
  // A refund is final: once any refund record exists it wins over every other settlement record, including one that
  // raced in after it (a confirm-bank that passed its own check just before the refund was written).
  for (const name of namesNewestFirst) {
    const parsed = parseAuditObjectName(name);
    if (parsed?.action === "refund" && !result.has(parsed.target)) result.set(parsed.target, { status: "refunded", at: parsed.at });
  }
  for (const name of namesNewestFirst) {
    const parsed = parseAuditObjectName(name);
    if (!parsed || !SETTLEMENT_ACTIONS[parsed.action] || result.has(parsed.target)) continue;
    result.set(parsed.target, { status: SETTLEMENT_ACTIONS[parsed.action], at: parsed.at });
  }
  return result;
}

/**
 * Create-once lock object (Storage refuses to overwrite with x-upsert false). Returns true for the single caller that
 * created it, false when it already exists. Used where a step must run at most once (refund shortening, code reissue).
 */
export async function acquireOnce(env: AdminStoreEnv, name: string, fetcher: typeof fetch = fetch): Promise<boolean> {
  const { base, key } = config(env);
  const response = await fetcher(`${base}/storage/v1/object/${AUDIT_BUCKET}/admin-locks/${encodeURIComponent(safeSegment(name, 120))}.json`, {
    method: "POST",
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json", "x-upsert": "false" },
    body: JSON.stringify({ at: new Date().toISOString() }),
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (response?.ok) return true;
  if (response) {
    // Storage reports "already exists" as 409, or as 400 with statusCode "409" in the body.
    const body = await response.json().catch(() => null) as { statusCode?: unknown } | null;
    if (response.status === 409 || String(body?.statusCode) === "409") return false;
  }
  throw new AdminStoreError("ADMIN_LOCK_UNAVAILABLE", 503, "The operation could not be coordinated. Nothing was changed.");
}

/** One PostgREST page plus the exact total row count of the query (Prefer: count=exact → Content-Range). */
export async function restPage<T>(env: AdminStoreEnv, path: string, fetcher: typeof fetch = fetch): Promise<{ rows: T[]; total: number | null }> {
  const { base, key } = config(env);
  const response = await fetcher(`${base}/rest/v1/${path}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}`, Accept: "application/json", Prefer: "count=exact" },
    redirect: "manual",
    signal: AbortSignal.timeout(8000),
  }).catch(() => null);
  if (!response) throw new AdminStoreError("ADMIN_STORE_UNAVAILABLE", 503, "The database did not respond.");
  if (!response.ok) {
    // Reuse rest() error mapping by repeating the request through it.
    return { rows: await rest<T[]>(env, path, {}, fetcher), total: null };
  }
  const range = response.headers.get("content-range") || "";
  const total = range.includes("/") ? Number(range.slice(range.lastIndexOf("/") + 1)) : Number.NaN;
  const text = await response.text();
  return { rows: (text ? JSON.parse(text) : []) as T[], total: Number.isFinite(total) ? total : null };
}
