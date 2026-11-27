/**
 * Administrator API on Cloudflare Pages Functions: /api/admin/* (except the dedicated provider-check modules beside
 * this file, which Pages routes first).
 *
 * Replaces the Express admin endpoints in api/_server.ts and their shared ADMIN_SECRET header. Every request must carry
 * a Firebase ID token of an allow-listed administrator (see ../_admin-auth.ts). Every state change is conditional
 * (compare-and-set in the database, so concurrent administrators cannot double-apply it) and is recorded in the
 * append-only administrator audit trail (../_admin-store.ts). No endpoint moves money: refunds are recorded here and
 * returned to the customer by Interac e-Transfer outside the application.
 */
import { requireAdmin, adminError, ADMIN_HEADERS, type AdminAuthEnv, type AdminIdentity } from '../_admin-auth';
import {
  rest, restOptional, appendAudit, listAuditNames, listAuditNamesWithCompleteness, listAllAuditNames, readAuditEvent, parseAuditObjectName, settlementByReference, safeSegment,
  AdminStoreError, acquireOnce, restPage, type AdminStoreEnv,
} from '../_admin-store';
import { LIMITS } from '../_paid-credit-reservation';
import { monthlyCreditScope } from '../_monthly-credit-scope';
import { statusResponse, type StatusEnv } from '../_status';
import { RATE_LIMITS, rateLimitRetryAfter, rateLimitedResponse } from '../_rate-limit';
import { trimCharacters } from '../../../shared/linearText';

export type AdminEnv = AdminAuthEnv & AdminStoreEnv & StatusEnv;
type Context = { request: Request; env: AdminEnv };
type Deps = { requireAdmin?: typeof requireAdmin; fetcher?: typeof fetch; now?: () => Date };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const REFERENCE = /^PS-[A-Z0-9]{4,12}$/;
const EMAIL = /^[^\s,()*;"'\\]{1,64}@[^\s,()*;"'\\@]{1,190}$/;
const UID = /^[A-Za-z0-9_-]{6,128}$/;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_TTL_DAYS = 14;

const ok = (body: unknown, status = 200) => Response.json(body, { status, headers: ADMIN_HEADERS });
const enc = encodeURIComponent;

type Payment = Record<string, unknown> & { reference_number?: string; notes?: string | null; plan?: string; amount?: number | string; status?: string; submitted_at?: string; approved_at?: string | null; firebase_uid?: string | null };
type Session = Record<string, unknown> & { id: string; firebase_uid?: string; tier?: string; issued_at?: string; expires_at?: string; revoked_at?: string | null; access_code_id?: string | null; email?: string | null };
type AccessCode = Record<string, unknown> & { id?: string; email?: string | null; tier?: string; reference_number?: string | null; used_at?: string | null; expires_at?: string | null };
type Counter = { uid: string; analyses_used: number | null; last_analysis_at?: string | null };

/** Parses the payment notes written by /api/request-access: "email:<email>;uid:<uid>;key:...". */
export function parsePaymentNotes(notes: unknown): { email: string | null; uid: string | null } {
  const text = typeof notes === 'string' ? notes : '';
  const email = /^email:([^;]+)/.exec(text)?.[1]?.trim().toLowerCase() || null;
  const uid = /;uid:([^;]+)/.exec(text)?.[1]?.trim() || null;
  return { email, uid };
}

function amountOf(value: unknown): number {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : 0;
}

/** Removes the code hash and request metadata (IP address, user agent) before anything reaches the browser. */
function publicCode(c: AccessCode) {
  return { id: c.id ?? null, email: c.email ?? null, tier: c.tier ?? null, referenceNumber: c.reference_number ?? null,
    createdAt: (c.created_at as string) ?? null, usedAt: c.used_at ?? null, expiresAt: c.expires_at ?? null,
    state: c.used_at ? 'redeemed' : c.expires_at && Date.parse(c.expires_at) <= Date.now() ? 'expired' : 'unused' };
}

function publicPayment(p: Payment, settlements: Settlements, sharedReference = false) {
  const { email, uid } = parsePaymentNotes(p.notes);
  // A reference shared by more than one payment cannot be attributed: its settlement records are ambiguous.
  const settlement = sharedReference ? undefined : settlements.byReference.get(safeSegment(String(p.reference_number || '')));
  return { referenceNumber: p.reference_number ?? null, customerEmail: email, firebaseUid: (p.firebase_uid as string) || uid,
    package: p.plan ?? null, amount: amountOf(p.amount), status: p.status ?? null, submittedAt: p.submitted_at ?? null,
    approvedAt: p.approved_at ?? null,
    // 'unknown' (never 'pending_settlement') when the settlement records could not be read completely or attributed.
    bankSettlementStatus: sharedReference ? 'unknown' : settlement?.status ?? (settlements.complete ? 'pending_settlement' : 'unknown'),
    settlementUpdatedAt: settlement?.at ?? null };
}

/** References used by more than one of the given payments. */
function sharedReferences(payments: Payment[]): Set<string> {
  const counts = new Map<string, number>();
  for (const p of payments) if (p.reference_number) counts.set(String(p.reference_number), (counts.get(String(p.reference_number)) || 0) + 1);
  return new Set([...counts].filter(([, n]) => n > 1).map(([ref]) => ref));
}

/**
 * Of these references, the ones held by more than one payment ANYWHERE in the payments table (a view shows only some
 * rows: one customer's payments, or the most recent 200). A failed read fails the request rather than guessing.
 */
async function sharedReferencesInDb(env: AdminEnv, references: string[], fetcher: typeof fetch): Promise<Set<string>> {
  const refs = [...new Set(references)].filter((r) => REFERENCE.test(r));
  const rows: Payment[] = [];
  for (let i = 0; i < refs.length; i += 100) {
    rows.push(...await rest<Payment[]>(env, `payments?select=reference_number&reference_number=in.(${refs.slice(i, i + 100).join(',')})&limit=1000`, {}, fetcher));
  }
  return sharedReferences(rows);
}

/**
 * Bank-settlement and refund state per payment reference, read from the administrator audit trail (the production
 * schema has no settlement or refund column; see BLOCKERS B-6). `complete` is false when the trail could not be read
 * or was cut off at the read limit: callers must then report the affected figures as unavailable, never as zero.
 */
type Settlements = { byReference: Map<string, { status: string; at: string }>; names: string[]; available: boolean; truncated: boolean; complete: boolean };
// The administrator audit trail is read whole for settlement state and for the refund/settlement/restore guards
// (which refuse with 503 when it cannot be read completely). 20,000 records = 20 Storage list calls per read.
// Production holds 0 records today (2026-11-26); the console warns from 80 %, long before actions would refuse.
// Per-target indexing replaces the full read when that warning first appears (TASK_REGISTER T-26).
const SETTLEMENT_READ_LIMIT = 20_000;
const AUDIT_CAPACITY_WARNING_AT = Math.floor(SETTLEMENT_READ_LIMIT * 0.8);
async function readSettlements(env: AdminEnv, fetcher: typeof fetch): Promise<Settlements> {
  try {
    const { names, exhausted } = await listAuditNamesWithCompleteness(env, SETTLEMENT_READ_LIMIT, fetcher);
    const truncated = !exhausted;
    return { byReference: settlementByReference(names), names, available: true, truncated, complete: !truncated };
  } catch {
    console.error('[ADMIN_SETTLEMENT_UNAVAILABLE]');
    return { byReference: new Map(), names: [], available: false, truncated: false, complete: false };
  }
}

function settlementWarnings(s: Settlements): string[] {
  if (!s.available) return ['Refund and bank-settlement records could not be read. Refunds, net revenue and settlement totals are unavailable; do not rely on the figures shown as complete.'];
  if (s.truncated) return [`Refund and bank-settlement records exceed ${SETTLEMENT_READ_LIMIT} entries and were not read completely. Refund and settlement figures are unavailable.`];
  if (s.names.length >= AUDIT_CAPACITY_WARNING_AT) {
    // Figures are still complete; this is an operational early warning.
    return [`The administrator audit trail holds ${s.names.length} of the ${SETTLEMENT_READ_LIMIT} records it can read in full. Refunds and settlement changes will be refused beyond that; ask engineering to enable per-payment indexing now.`];
  }
  return [];
}

/** The credit counter that paid_reserve_credit charges for this session today (null: unlimited / not counted). */
export function creditCounter(session: Pick<Session, 'id' | 'tier' | 'issued_at'>, now: Date): { uid: string; granted: number; scope: string } | null {
  const tier = LIMITS[String(session.tier)];
  if (!tier) return null;
  if (!tier.monthly) return { uid: `paid_session_${session.id}_total`, granted: tier.limit, scope: 'total' };
  try {
    const scope = monthlyCreditScope(String(session.issued_at || ''), now);
    return { uid: `paid_session_${session.id}_period_${scope.slice(7)}`, granted: tier.limit, scope };
  } catch {
    return null;
  }
}

function publicSession(s: Session, counters: Map<string, Counter>, now: Date) {
  const counter = creditCounter(s, now);
  const used = counter ? Math.max(0, Number(counters.get(counter.uid)?.analyses_used ?? 0)) : 0;
  const expired = s.expires_at ? Date.parse(s.expires_at) <= now.getTime() : false;
  return { sessionId: s.id, firebaseUid: s.firebase_uid ?? null, email: (s.email as string) ?? null, tier: s.tier ?? null,
    issuedAt: s.issued_at ?? null, expiresAt: s.expires_at ?? null, revokedAt: s.revoked_at ?? null,
    accessStatus: s.revoked_at ? 'suspended_or_revoked' : expired ? 'expired' : 'active',
    creditScope: counter?.scope ?? 'unlimited', creditsGranted: counter?.granted ?? null, creditsConsumed: used,
    creditsRemaining: counter ? Math.max(0, counter.granted - used) : null,
    lastActivity: counter ? counters.get(counter.uid)?.last_analysis_at ?? null : null };
}

async function countersFor(env: AdminEnv, sessionIds: string[], fetcher: typeof fetch): Promise<Map<string, Counter>> {
  const map = new Map<string, Counter>();
  const ids = sessionIds.filter((id) => UUID.test(id));
  for (let i = 0; i < ids.length; i += 40) {
    const filter = ids.slice(i, i + 40).map((id) => `uid.like.paid_session_${id}_*`).join(',');
    const rows = await rest<Counter[]>(env, `free_usage?select=uid,analyses_used,last_analysis_at&or=(${filter})&limit=2000`, {}, fetcher);
    for (const row of rows) map.set(row.uid, row);
  }
  return map;
}

async function readJson(request: Request): Promise<Record<string, unknown> | Response> {
  if (!(request.headers.get('content-type') || '').toLowerCase().startsWith('application/json')) {
    return adminError('JSON_REQUIRED', 415, 'Send the request as application/json.');
  }
  const text = await request.text();
  if (text.length > 4096) return adminError('REQUEST_TOO_LARGE', 413, 'Request is too large.');
  try {
    const body = JSON.parse(text);
    return body && typeof body === 'object' && !Array.isArray(body) ? body : adminError('INVALID_REQUEST', 400, 'Invalid request body.');
  } catch {
    return adminError('INVALID_REQUEST', 400, 'Invalid request body.');
  }
}

function reasonOf(body: Record<string, unknown>, required: boolean): string | null | Response {
  const reason = typeof body.reason === 'string' ? body.reason.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 500) : '';
  if (required && reason.length < 3) return adminError('REASON_REQUIRED', 400, 'Enter a reason for this action (it is kept in the audit log).');
  return reason || null;
}

async function audit(env: AdminEnv, admin: AdminIdentity, action: string, target: string, reason: string | null, details: Record<string, unknown>, fetcher: typeof fetch): Promise<boolean> {
  try {
    await appendAudit(env, { action, target: safeSegment(target), admin: admin.email, reason, details }, fetcher);
    return true;
  } catch {
    return false;
  }
}

class DuplicateReferenceError extends Error {}

/**
 * The payment with this reference. References were 5 random characters with no unique index, so two customers can
 * share one: such a reference is refused (DuplicateReferenceError) rather than acting on an arbitrary row.
 */
async function paymentByReference(env: AdminEnv, reference: string, fetcher: typeof fetch): Promise<Payment | null> {
  const rows = await rest<Payment[]>(env, `payments?select=*&reference_number=eq.${enc(reference)}&limit=2`, {}, fetcher);
  if (rows.length > 1) throw new DuplicateReferenceError(reference);
  return rows[0] ?? null;
}

/** Filter that addresses exactly this payment row: its primary key when present, else its (unique-checked) reference. */
function paymentFilter(p: Payment): string {
  const id = typeof p.id === 'string' && UUID.test(p.id) ? p.id : null;
  return id ? `id=eq.${id}` : `reference_number=eq.${enc(String(p.reference_number))}`;
}

/**
 * Reads every row of a query, 1,000 at a time. Supabase caps a response at 1,000 rows (max_rows) whatever `limit`
 * says, so totals computed from one response would silently cover only part of the data. `path` must have an order.
 */
async function restAll<T>(env: AdminEnv, path: string, fetcher: typeof fetch, max = 20000): Promise<{ rows: T[]; truncated: boolean }> {
  // `path` must order by a unique key, so offset pages neither overlap nor skip. The exact total (Content-Range) is
  // the stop condition, which also works if the project's row cap is lower than 1,000; a mismatch is reported.
  const rows: T[] = [];
  let total: number | null = null;
  for (let offset = 0; offset < max; ) {
    const page = await restPage<T>(env, `${path}&limit=1000&offset=${offset}`, fetcher);
    if (total === null) total = page.total;
    rows.push(...page.rows);
    offset += page.rows.length;
    if (page.rows.length === 0 || (total !== null ? rows.length >= total : page.rows.length < 1000)) break;
  }
  return { rows, truncated: total !== null ? rows.length !== total : rows.length >= max };
}

/** Latest settlement state of one payment, from the audit trail. */
async function settlementOf(env: AdminEnv, reference: string, fetcher: typeof fetch): Promise<string | undefined> {
  // Guards refunds, reissues and settlement changes: an incomplete history refuses the action (503), never "not refunded".
  return settlementByReference(await listAllAuditNames(env, SETTLEMENT_READ_LIMIT, fetcher)).get(safeSegment(reference))?.status;
}

type CodeLink = AccessCode & { redeemed_session_id?: string | null };

/** The entitlement a code was redeemed into: new purchases and renewals both record redeemed_session_id. */
function sessionOfCode(code: CodeLink, sessions: Session[]): Session | undefined {
  return sessions.find((s) => (code.redeemed_session_id && s.id === code.redeemed_session_id) || (code.id && s.access_code_id === code.id));
}

async function sessionById(env: AdminEnv, sessionId: string, fetcher: typeof fetch): Promise<Session | null> {
  const rows = await rest<Session[]>(env, `navigator_paid_sessions?select=*&id=eq.${sessionId}&limit=1`, {}, fetcher);
  return rows[0] ?? null;
}

function generateAccessCode(): string {
  // Rejection sampling keeps every character equally likely.
  const out: string[] = [];
  while (out.length < 12) {
    for (const b of crypto.getRandomValues(new Uint8Array(24))) {
      if (b < 248 && out.length < 12) out.push(CODE_ALPHABET[b % CODE_ALPHABET.length]);
    }
  }
  return out.join('').match(/.{4}/g)!.join('-');
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// ---------------------------------------------------------------- read endpoints

async function paymentsOverview(env: AdminEnv, fetcher: typeof fetch, now: Date) {
  const [payments, sessions, settlements] = await Promise.all([
    rest<Payment[]>(env, 'payments?select=*&order=submitted_at.desc.nullslast&limit=200', {}, fetcher),
    rest<Session[]>(env, 'navigator_paid_sessions?select=*&order=issued_at.desc&limit=1000', {}, fetcher),
    readSettlements(env, fetcher),
  ]);
  const references = [...new Set(payments.map((p) => String(p.reference_number || '')).filter((r) => REFERENCE.test(r)))];
  const codes: CodeLink[] = [];
  for (let i = 0; i < references.length; i += 100) {
    codes.push(...await rest<CodeLink[]>(env, `access_codes?select=*&reference_number=in.(${references.slice(i, i + 100).join(',')})&limit=1000`, {}, fetcher));
  }
  const counters = await countersFor(env, sessions.map((s) => s.id), fetcher);
  const shared = await sharedReferencesInDb(env, payments.map((p) => String(p.reference_number || '')), fetcher);
  return {
    reporting: {
      settlementAvailable: settlements.complete,
      warnings: [...settlementWarnings(settlements),
        ...(shared.size ? [`${shared.size} payment reference(s) are shared by more than one payment; their settlement status is shown as unknown.`] : [])],
    },
    payments: payments.map((p) => {
      const base = publicPayment(p, settlements, shared.has(String(p.reference_number || '')));
      // Linked through the payment's own access code, never by uid and package (a customer can buy a package twice).
      const duplicated = payments.filter((x) => x.reference_number === p.reference_number).length > 1;
      const session = duplicated ? undefined : codes
        .filter((c) => c.reference_number === p.reference_number && (c.email || '').toLowerCase() === base.customerEmail)
        .map((c) => sessionOfCode(c, sessions)).find(Boolean);
      const s = session ? publicSession(session, counters, now) : null;
      return { ...base, sessionId: s?.sessionId ?? null, accessStatus: s?.accessStatus ?? (p.status === 'approved' ? 'code_issued' : p.status === 'rejected' ? 'rejected' : 'pending'),
        creditsGranted: s?.creditsGranted ?? null, creditsConsumed: s?.creditsConsumed ?? 0, creditsRemaining: s?.creditsRemaining ?? null, lastActivity: s?.lastActivity ?? null };
    }),
    sessions: sessions.map((s) => publicSession(s, counters, now)),
  };
}

async function customerDetail(env: AdminEnv, q: string, fetcher: typeof fetch, now: Date) {
  let email: string | null = null;
  let uid: string | null = null;
  let reference: string | null = null;
  if (EMAIL.test(q)) email = q.toLowerCase();
  else if (REFERENCE.test(q.toUpperCase())) reference = q.toUpperCase();
  else if (UID.test(q)) uid = q;
  else return null;

  // Resolve every identity the customer is known by, then read ONLY rows matching those exact identities.
  let payments: Payment[] = [];
  if (reference) payments = await rest<Payment[]>(env, `payments?select=*&reference_number=eq.${enc(reference)}&limit=20`, {}, fetcher);
  else if (email) payments = await rest<Payment[]>(env, `payments?select=*&notes=like.${enc(`email:${email};*`)}&order=submitted_at.desc&limit=50`, {}, fetcher);
  else if (uid) payments = await rest<Payment[]>(env, `payments?select=*&notes=like.${enc(`*;uid:${uid}*`)}&order=submitted_at.desc&limit=50`, {}, fetcher);
  // Exact re-check: LIKE patterns are never trusted to isolate customers on their own.
  payments = payments.filter((p) => {
    const n = parsePaymentNotes(p.notes);
    return reference ? p.reference_number === reference : email ? n.email === email : (n.uid === uid || p.firebase_uid === uid);
  });
  // A reference shared by two customers (possible with the old 5-character references) identifies nobody.
  if (reference && new Set(payments.map((p) => `${parsePaymentNotes(p.notes).email}|${(p.firebase_uid as string) || parsePaymentNotes(p.notes).uid}`)).size > 1) throw new DuplicateReferenceError(reference);
  if (!email) email = payments.map((p) => parsePaymentNotes(p.notes).email).find(Boolean) ?? null;
  if (!uid) uid = payments.map((p) => (p.firebase_uid as string) || parsePaymentNotes(p.notes).uid).find(Boolean) ?? null;

  const [sessions, codes, jobs, freeUsage, settlements] = await Promise.all([
    uid ? rest<Session[]>(env, `navigator_paid_sessions?select=*&firebase_uid=eq.${enc(uid)}&order=issued_at.desc&limit=50`, {}, fetcher) : Promise.resolve([] as Session[]),
    email ? rest<AccessCode[]>(env, `access_codes?select=*&email=eq.${enc(email)}&limit=50`, {}, fetcher) : Promise.resolve([] as AccessCode[]),
    uid ? rest<Record<string, unknown>[]>(env, `analyzer_jobs?select=job_id,mode,status,stage,progress,error_code,retryable,attempt_count,created_at,updated_at,completed_at,session_id&owner_uid=eq.${enc(uid)}&order=created_at.desc&limit=50`, {}, fetcher) : Promise.resolve([]),
    uid ? rest<Counter[]>(env, `free_usage?select=uid,analyses_used,last_analysis_at&uid=eq.${enc(uid)}&limit=1`, {}, fetcher) : Promise.resolve([] as Counter[]),
    readSettlements(env, fetcher),
  ]);
  const ownSessions = sessions.filter((s) => s.firebase_uid === uid);
  const counters = await countersFor(env, ownSessions.map((s) => s.id), fetcher);
  const auditNames = settlements.names;
  const sharedInView = await sharedReferencesInDb(env, payments.map((p) => String(p.reference_number || '')), fetcher);
  const targets = new Set([...ownSessions.map((s) => safeSegment(s.id)), ...payments.map((p) => safeSegment(String(p.reference_number || ''))), ...codes.map((c) => safeSegment(String(c.id || '')))]);
  return {
    identity: { email, firebaseUid: uid },
    reporting: {
      settlementAvailable: settlements.complete,
      warnings: [...settlementWarnings(settlements),
        ...(sharedInView.size ? [`${sharedInView.size} of this customer's payment reference(s) are also used by another payment; their settlement status is shown as unknown.`] : [])],
    },
    payments: payments.map((p) => publicPayment(p, settlements, sharedInView.has(String(p.reference_number || '')))),
    sessions: ownSessions.map((s) => publicSession(s, counters, now)),
    accessCodes: codes.filter((c) => (c.email || '').toLowerCase() === email).map(publicCode),
    jobs,
    freeUsage: freeUsage.filter((r) => r.uid === uid).map((r) => ({ analysesUsed: r.analyses_used ?? 0, lastAnalysisAt: r.last_analysis_at ?? null }))[0] ?? null,
    auditTrail: auditNames.map((n) => ({ name: n, parsed: parseAuditObjectName(n) })).filter((x) => x.parsed && targets.has(x.parsed.target)).slice(0, 50).map((x) => x.parsed),
  };
}

async function usageSummary(env: AdminEnv, fetcher: typeof fetch, now: Date) {
  const since = new Date(now.getTime() - 7 * 86400000).toISOString();
  const { rows: jobs, truncated } = await restAll<{ mode: string; status: string; error_code: string | null; created_at: string; completed_at: string | null; owner_bypass: boolean }>(
    env, `analyzer_jobs?select=job_id,mode,status,error_code,created_at,completed_at,owner_bypass&created_at=gte.${enc(since)}&order=created_at.asc,job_id.asc`, fetcher);
  const byMode: Record<string, { total: number; completed: number; failed: number; running: number; queued: number; avgSeconds: number | null; ownerRuns: number }> = {};
  const failures: Record<string, number> = {};
  const day = new Date(now.getTime() - 86400000).toISOString();
  let last24h = 0;
  for (const mode of ['fast', 'full']) {
    const rows = jobs.filter((j) => j.mode === mode);
    const done = rows.filter((j) => j.status === 'completed' && j.completed_at);
    const seconds = done.map((j) => (Date.parse(j.completed_at!) - Date.parse(j.created_at)) / 1000).filter((s) => Number.isFinite(s) && s >= 0);
    byMode[mode === 'fast' ? 'quickReview' : 'forensicDeepScan'] = {
      total: rows.length, completed: done.length, failed: rows.filter((j) => j.status === 'failed').length,
      running: rows.filter((j) => j.status === 'running').length, queued: rows.filter((j) => j.status === 'queued').length,
      avgSeconds: seconds.length ? Math.round(seconds.reduce((a, b) => a + b, 0) / seconds.length) : null,
      ownerRuns: rows.filter((j) => j.owner_bypass).length,
    };
  }
  for (const j of jobs) {
    if (j.status === 'failed') failures[j.error_code || 'UNKNOWN'] = (failures[j.error_code || 'UNKNOWN'] || 0) + 1;
    if (j.created_at >= day) last24h++;
  }
  return { windowDays: 7, jobsLast24h: last24h, byMode, failuresByCode: failures, truncated };
}

async function revenueSummary(env: AdminEnv, fetcher: typeof fetch) {
  const [{ rows: payments, truncated }, settlements, summary] = await Promise.all([
    restAll<Payment>(env, 'payments?select=reference_number,plan,amount,status,submitted_at,approved_at&order=id.asc', fetcher).catch((error) => {
      if (error instanceof AdminStoreError && error.code === 'ADMIN_SCHEMA_UNAVAILABLE') {
        return restAll<Payment>(env, 'payments?select=reference_number,plan,amount,status,submitted_at,approved_at&order=submitted_at.asc,reference_number.asc', fetcher);
      }
      throw error;
    }),
    readSettlements(env, fetcher),
    restOptional<Record<string, unknown>[]>(env, 'navigator_payment_summary?select=*', [], fetcher),
  ]);
  const settlement = settlements.byReference;
  // References shared by more than one payment (possible with the former 5-character references): their settlement
  // records cannot be attributed to one payment.
  const referenceCounts = new Map<string, number>();
  for (const p of payments) if (p.reference_number) referenceCounts.set(String(p.reference_number), (referenceCounts.get(String(p.reference_number)) || 0) + 1);
  const duplicateReferences = [...referenceCounts.entries()].filter(([, n]) => n > 1).map(([ref]) => ref);
  const months: Record<string, { approved: number; approvedAmount: number; refundedAmount: number }> = {};
  const plans: Record<string, { approved: number; approvedAmount: number; pending: number }> = {};
  let pendingAmount = 0; let approvedAmount = 0; let refundedAmount = 0; let bankConfirmedAmount = 0; let disputedAmount = 0;
  for (const p of payments) {
    const amount = amountOf(p.amount);
    const plan = String(p.plan || 'unknown');
    plans[plan] ??= { approved: 0, approvedAmount: 0, pending: 0 };
    const state = settlement.get(safeSegment(String(p.reference_number || '')))?.status;
    if (p.status === 'pending') { plans[plan].pending++; pendingAmount += amount; }
    if (p.status !== 'approved') continue;
    const month = String(p.approved_at || p.submitted_at || '').slice(0, 7) || 'unknown';
    months[month] ??= { approved: 0, approvedAmount: 0, refundedAmount: 0 };
    months[month].approved++; months[month].approvedAmount += amount;
    plans[plan].approved++; plans[plan].approvedAmount += amount;
    approvedAmount += amount;
    if (state === 'refunded') { refundedAmount += amount; months[month].refundedAmount += amount; }
    if (state === 'bank_confirmed') bankConfirmedAmount += amount;
    if (state === 'missing_or_disputed') disputedAmount += amount;
  }
  const round = (n: number) => Math.round(n * 100) / 100;
  // Payment totals come from the payment rows themselves (authoritative); settlement-derived totals only when the
  // settlement records were read completely and can be attributed. Unavailable figures are null, never zero.
  const paymentsComplete = !truncated;
  const settlementKnown = settlements.complete && duplicateReferences.length === 0;
  const fromPayments = (n: number) => (paymentsComplete ? round(n) : null);
  const fromSettlements = (n: number) => (paymentsComplete && settlementKnown ? round(n) : null);
  const warnings = [
    ...(paymentsComplete ? [] : ['Not every payment record could be read. Totals are unavailable.']),
    ...settlementWarnings(settlements),
    ...(duplicateReferences.length ? [`${duplicateReferences.length} payment reference(s) are shared by more than one payment (${duplicateReferences.slice(0, 5).join(', ')}). Their refunds and settlements cannot be attributed; refund and settlement totals are unavailable until resolved.`] : []),
  ];
  return {
    currency: 'CAD',
    reporting: { complete: warnings.length === 0, paymentsComplete, settlementAvailable: settlements.complete, duplicateReferences: duplicateReferences.length, warnings },
    totals: { approvedAmount: fromPayments(approvedAmount), refundedAmount: fromSettlements(refundedAmount), netAmount: fromSettlements(approvedAmount - refundedAmount),
      bankConfirmedAmount: fromSettlements(bankConfirmedAmount), disputedAmount: fromSettlements(disputedAmount), pendingAmount: fromPayments(pendingAmount) },
    // Breakdowns follow the same rule as the totals: counts and amounts only from a complete payment read.
    byMonth: Object.entries(months).sort(([a], [b]) => b.localeCompare(a)).map(([month, v]) => ({
      month,
      approved: paymentsComplete ? v.approved : null,
      approvedAmount: fromPayments(v.approvedAmount),
      refundedAmount: fromSettlements(v.refundedAmount),
    })),
    byPlan: Object.entries(plans).map(([plan, v]) => ({
      plan,
      approved: paymentsComplete ? v.approved : null,
      approvedAmount: fromPayments(v.approvedAmount),
      pending: paymentsComplete ? v.pending : null,
    })),
    tierSummary: summary.available ? summary.data : null,
    truncated,
  };
}

async function monitoringStatus(request: Request, env: AdminEnv, fetcher: typeof fetch, now: Date) {
  const status = await (await statusResponse(request, env, true)).json();
  const started = Date.now();
  let database: { reachable: boolean; latencyMs: number | null } = { reachable: false, latencyMs: null };
  let stuck: unknown[] = [];
  let recentFailures: unknown[] = [];
  try {
    const staleQueued = new Date(now.getTime() - 15 * 60000).toISOString();
    const [running, queued, failed] = await Promise.all([
      rest<Array<Record<string, unknown>>>(env, `analyzer_jobs?select=job_id,mode,status,stage,progress,attempt_count,lease_expires_at,updated_at&status=eq.running&lease_expires_at=lt.${enc(now.toISOString())}&limit=50`, {}, fetcher),
      rest<Array<Record<string, unknown>>>(env, `analyzer_jobs?select=job_id,mode,status,stage,progress,attempt_count,created_at,updated_at&status=eq.queued&created_at=lt.${enc(staleQueued)}&limit=50`, {}, fetcher),
      rest<Array<Record<string, unknown>>>(env, 'analyzer_jobs?select=job_id,mode,error_code,retryable,attempt_count,updated_at&status=eq.failed&order=updated_at.desc&limit=10', {}, fetcher),
    ]);
    database = { reachable: true, latencyMs: Date.now() - started };
    stuck = [...running, ...queued];
    recentFailures = failed;
  } catch {
    database = { reachable: false, latencyMs: Date.now() - started };
  }
  return { checkedAt: now.toISOString(), status, database, stuckJobs: stuck, recentFailures,
    healthy: Boolean((status as { liveAnalysisReady?: boolean }).liveAnalysisReady) && database.reachable && stuck.length === 0 };
}

// ---------------------------------------------------------------- write endpoints

async function issueCode(env: AdminEnv, payment: Payment, email: string, amount: number, fetcher: typeof fetch, now: Date): Promise<{ code: string; expiresAt: string }> {
  const code = generateAccessCode();
  const expiresAt = new Date(now.getTime() + CODE_TTL_DAYS * 86400000).toISOString();
  await rest(env, 'access_codes', { method: 'POST', body: { email, tier: payment.plan, reference_number: payment.reference_number, amount, code_hash: await sha256Hex(code), expires_at: expiresAt }, prefer: 'return=minimal' }, fetcher);
  return { code, expiresAt };
}

async function usedCodeIds(env: AdminEnv, reference: string, fetcher: typeof fetch): Promise<string[]> {
  return (await rest<AccessCode[]>(env, `access_codes?select=id&reference_number=eq.${enc(reference)}&used_at=not.is.null`, {}, fetcher)).map((c) => String(c.id));
}

async function approvePayment(env: AdminEnv, admin: AdminIdentity, body: Record<string, unknown>, fetcher: typeof fetch, now: Date): Promise<Response> {
  const reference = typeof body.referenceNumber === 'string' ? body.referenceNumber.trim().toUpperCase() : '';
  const received = typeof body.amountReceived === 'number' ? body.amountReceived : Number.NaN;
  if (!REFERENCE.test(reference) || !Number.isFinite(received) || received <= 0 || received > 100000) return adminError('INVALID_REQUEST', 400, 'referenceNumber and amountReceived are required.');
  const payment = await paymentByReference(env, reference, fetcher);
  if (!payment) return adminError('PAYMENT_NOT_FOUND', 404, 'No payment request has that reference number.');
  if (payment.status !== 'pending') return adminError('PAYMENT_ALREADY_PROCESSED', 409, `This payment was already processed (${payment.status}). No second code was issued.`);
  const expected = amountOf(payment.amount);
  if (received + 0.001 < expected) return adminError('AMOUNT_TOO_LOW', 400, `Amount received ($${received}) is less than the $${expected} due for ${payment.plan}.`);
  const { email } = parsePaymentNotes(payment.notes);
  if (!email || !LIMITS[String(payment.plan)]) return adminError('PAYMENT_INCOMPLETE', 422, 'This payment request has no customer email or a package that cannot be activated.');

  const usedBefore = await usedCodeIds(env, reference, fetcher);
  // Compare-and-set on this exact row: only one approval can move it out of 'pending', so a code is never issued twice.
  const claimed = await rest<Payment[]>(env, `payments?${paymentFilter(payment)}&status=eq.pending`, {
    method: 'PATCH', body: { status: 'approved', approved_at: now.toISOString() }, prefer: 'return=representation',
  }, fetcher);
  if (!claimed.length) return adminError('PAYMENT_ALREADY_PROCESSED', 409, 'Another administrator processed this payment at the same moment. No second code was issued.');

  let issued: { code: string; expiresAt: string };
  try {
    issued = await issueCode(env, payment, email, received, fetcher, now);
  } catch (error) {
    // Put the payment back so the approval can be retried; no code was shown to anyone. If this also fails, the
    // payment stays approved without a delivered code and "Reissue code" recovers it.
    await rest(env, `payments?${paymentFilter(payment)}&status=eq.approved`, { method: 'PATCH', body: { status: 'pending', approved_at: null }, prefer: 'return=minimal' }, fetcher)
      .catch(() => console.error('[ADMIN_APPROVE_ROLLBACK_FAILED]', JSON.stringify({ reference })));
    throw error;
  }
  // A refund recorded while this code was being issued retired the unused codes before it existed. The refund writes
  // its record first, so checking after the insert closes the race; unreadable history fails closed (Reissue recovers it).
  const settled = await settlementOf(env, reference, fetcher).catch(() => null);
  if (settled === 'refunded' || settled === null) {
    await rest(env, `access_codes?reference_number=eq.${enc(reference)}&used_at=is.null&code_hash=eq.${await sha256Hex(issued.code)}`, { method: 'PATCH', body: { expires_at: new Date().toISOString() }, prefer: 'return=minimal' }, fetcher);
    return settled === 'refunded'
      ? adminError('PAYMENT_REFUNDED', 409, 'This payment was refunded while it was being approved. The code was cancelled.')
      : adminError('ADMIN_AUDIT_UNAVAILABLE', 503, 'The refund history could not be read, so the code was cancelled. Use "Reissue code" once it is readable.');
  }
  // A customer can self-activate the moment the status flips (claim-purchase); if that happened before this code was
  // inserted, the claim's cleanup missed it, so retire it here. Either order leaves at most one redeemable code.
  let activated: boolean | null;
  try { activated = (await usedCodeIds(env, reference, fetcher)).some((id) => !usedBefore.includes(id)); }
  catch { console.error('[ADMIN_APPROVE_ACTIVATION_CHECK_FAILED]', JSON.stringify({ reference })); activated = null; }
  // Fail closed: unless it is certain no redemption happened during approval, retire this code (Reissue recovers it).
  if (activated !== false) {
    await rest(env, `access_codes?reference_number=eq.${enc(reference)}&used_at=is.null&code_hash=eq.${await sha256Hex(issued.code)}`, { method: 'PATCH', body: { expires_at: now.toISOString() }, prefer: 'return=minimal' }, fetcher);
    await audit(env, admin, 'approve', reference, null, { plan: payment.plan, amountExpected: expected, amountReceived: received, customerActivated: activated ?? 'unknown' }, fetcher);
    return ok({ success: true, referenceNumber: reference, customerEmail: email, tier: payment.plan, accessCode: null, ...(activated ? { alreadyActivated: true } : { activationUnknown: true }),
      note: activated
        ? 'Approved. The customer already activated this order from their account, so no code needs to be sent.'
        : 'Approved, but the activation check failed, so this code was withheld to avoid giving access twice. Use "Reissue code" to send the customer a code.' });
  }
  const audited = await audit(env, admin, 'approve', reference, null, { plan: payment.plan, amountExpected: expected, amountReceived: received, codeExpiresAt: issued.expiresAt }, fetcher);
  return ok({ success: true, referenceNumber: reference, customerEmail: email, tier: payment.plan, accessCode: issued.code, expiresAt: issued.expiresAt, auditRecorded: audited,
    note: 'Send this code to the customer now. It is shown once and only its hash is stored.' });
}

/** Replaces an undelivered or lost code of an approved payment. Refused once the payment's code was redeemed or refunded. */
async function reissueCode(env: AdminEnv, admin: AdminIdentity, body: Record<string, unknown>, fetcher: typeof fetch, now: Date): Promise<Response> {
  const reference = typeof body.referenceNumber === 'string' ? body.referenceNumber.trim().toUpperCase() : '';
  if (!REFERENCE.test(reference)) return adminError('INVALID_REQUEST', 400, 'referenceNumber is required.');
  const reason = reasonOf(body, true);
  if (reason instanceof Response) return reason;
  const payment = await paymentByReference(env, reference, fetcher);
  if (!payment) return adminError('PAYMENT_NOT_FOUND', 404, 'No payment request has that reference number.');
  if (payment.status !== 'approved') return adminError('PAYMENT_NOT_APPROVED', 409, 'Only an approved payment can have its code reissued.');
  if (await settlementOf(env, reference, fetcher) === 'refunded') return adminError('PAYMENT_REFUNDED', 409, 'This payment was refunded.');
  const { email } = parsePaymentNotes(payment.notes);
  if (!email || !LIMITS[String(payment.plan)]) return adminError('PAYMENT_INCOMPLETE', 422, 'This payment request has no customer email or a package that cannot be activated.');
  // One reissue per reference per minute: two administrators acting together cannot leave two working codes.
  if (!(await acquireOnce(env, `reissue__${reference}__${now.toISOString().slice(0, 16).replace(/[-:T]/g, '')}`, fetcher))) {
    return adminError('REISSUE_IN_PROGRESS', 409, 'A code for this payment was just reissued. Wait a minute and check before trying again.');
  }
  const codes = await rest<AccessCode[]>(env, `access_codes?select=id,used_at&reference_number=eq.${enc(reference)}&limit=50`, {}, fetcher);
  if (codes.some((c) => c.used_at)) return adminError('CODE_ALREADY_REDEEMED', 409, 'This payment\'s code was already redeemed; the customer has access.');
  if (!(await audit(env, admin, 'reissue-code', reference, reason, { plan: payment.plan, previousCodes: codes.length }, fetcher))) {
    return adminError('ADMIN_AUDIT_UNAVAILABLE', 503, 'The change could not be recorded. Nothing was changed.');
  }
  // Retire the old code(s) first, so at most one unused code exists afterwards.
  await rest(env, `access_codes?reference_number=eq.${enc(reference)}&used_at=is.null`, { method: 'PATCH', body: { expires_at: now.toISOString() }, prefer: 'return=minimal' }, fetcher);
  // The customer may have redeemed the old code between the first read and the expiry; then they have access already.
  const after = await rest<AccessCode[]>(env, `access_codes?select=id,used_at&reference_number=eq.${enc(reference)}&used_at=not.is.null&limit=1`, {}, fetcher);
  if (after.length) return adminError('CODE_ALREADY_REDEEMED', 409, 'The customer redeemed the earlier code just now; no new code was issued.');
  const issued = await issueCode(env, payment, email, amountOf(payment.amount), fetcher, now);
  // A refund recorded while this code was being issued may have retired the unused codes before it was inserted. The
  // refund writes its record first, so checking after the insert closes the race; unreadable history fails closed.
  const settled = await settlementOf(env, reference, fetcher).catch(() => null);
  if (settled === 'refunded' || settled === null) {
    await rest(env, `access_codes?reference_number=eq.${enc(reference)}&used_at=is.null&code_hash=eq.${await sha256Hex(issued.code)}`, { method: 'PATCH', body: { expires_at: new Date().toISOString() }, prefer: 'return=minimal' }, fetcher);
    return settled === 'refunded'
      ? adminError('PAYMENT_REFUNDED', 409, 'This payment was refunded while the code was being issued. The new code was cancelled.')
      : adminError('ADMIN_AUDIT_UNAVAILABLE', 503, 'The refund history could not be read, so the new code was cancelled. Try again.');
  }
  return ok({ success: true, referenceNumber: reference, customerEmail: email, tier: payment.plan, accessCode: issued.code, expiresAt: issued.expiresAt,
    note: 'Send this code to the customer now. It is shown once; earlier unused codes for this payment no longer work.' });
}

async function settlementAction(env: AdminEnv, admin: AdminIdentity, action: 'confirm-bank' | 'dispute' | 'reset-settlement', body: Record<string, unknown>, fetcher: typeof fetch): Promise<Response> {
  const reference = typeof body.referenceNumber === 'string' ? body.referenceNumber.trim().toUpperCase() : '';
  if (!REFERENCE.test(reference)) return adminError('INVALID_REQUEST', 400, 'referenceNumber is required.');
  const reason = reasonOf(body, action === 'dispute');
  if (reason instanceof Response) return reason;
  const payment = await paymentByReference(env, reference, fetcher);
  if (!payment) return adminError('PAYMENT_NOT_FOUND', 404, 'No payment request has that reference number.');
  // A refund is final: changing the settlement afterwards would drop it from revenue and allow a second refund.
  if (await settlementOf(env, reference, fetcher) === 'refunded') return adminError('PAYMENT_REFUNDED', 409, 'This payment was refunded; its settlement can no longer change.');
  if (!(await audit(env, admin, action, reference, reason, { amount: amountOf(payment.amount), plan: payment.plan }, fetcher))) {
    return adminError('ADMIN_AUDIT_UNAVAILABLE', 503, 'The settlement change could not be recorded. Nothing was changed.');
  }
  return ok({ success: true, referenceNumber: reference, bankSettlementStatus: action === 'confirm-bank' ? 'bank_confirmed' : action === 'dispute' ? 'missing_or_disputed' : 'pending_settlement' });
}

const RENEWAL_DAYS = 30;

async function refundPayment(env: AdminEnv, admin: AdminIdentity, body: Record<string, unknown>, fetcher: typeof fetch, now: Date): Promise<Response> {
  const reference = typeof body.referenceNumber === 'string' ? body.referenceNumber.trim().toUpperCase() : '';
  if (!REFERENCE.test(reference)) return adminError('INVALID_REQUEST', 400, 'referenceNumber is required.');
  const reason = reasonOf(body, true);
  if (reason instanceof Response) return reason;
  const revokeAccess = body.revokeAccess !== false;
  const payment = await paymentByReference(env, reference, fetcher);
  if (!payment) return adminError('PAYMENT_NOT_FOUND', 404, 'No payment request has that reference number.');
  const names = await listAllAuditNames(env, SETTLEMENT_READ_LIMIT, fetcher);
  const target = safeSegment(reference);
  const recorded = names.some((n) => { const p = parseAuditObjectName(n); return p?.target === target && p.action === 'refund'; });
  const applied = names.some((n) => { const p = parseAuditObjectName(n); return p?.target === target && p.action === 'refund-applied'; });
  if (recorded && applied) return adminError('ALREADY_REFUNDED', 409, 'This payment is already recorded as refunded.');

  // The audit record IS the refund record (it drives revenue and the duplicate guard), so it is written first: if it
  // cannot be written, nothing else changes. A refund recorded but interrupted before 'refund-applied' is resumed
  // (every step below is idempotent) instead of being refused.
  if (!recorded && !(await audit(env, admin, 'refund', reference, reason, { amount: amountOf(payment.amount), plan: payment.plan, revokeAccess }, fetcher))) {
    return adminError('ADMIN_AUDIT_UNAVAILABLE', 503, 'The refund could not be recorded. Nothing was changed.');
  }

  // Exactly one request ever holds this lock. Only that request may take back renewal days (not idempotent); a retry,
  // a resumed refund or a concurrent duplicate repeats only the idempotent steps.
  const firstApplication = await acquireOnce(env, `refund__${reference}`, fetcher);

  const stamp = now.toISOString();
  let rejected = false; let codesExpired = 0; let sessionsRevoked = 0; let sessionsShortened = 0; let shorteningsForReview = 0; const revokedSessionIds: string[] = [];
  if (payment.status === 'pending') {
    rejected = (await rest<Payment[]>(env, `payments?${paymentFilter(payment)}&status=eq.pending`, { method: 'PATCH', body: { status: 'rejected' }, prefer: 'return=representation' }, fetcher)).length > 0;
  }
  if (revokeAccess) {
    codesExpired = (await rest<AccessCode[]>(env, `access_codes?reference_number=eq.${enc(reference)}&used_at=is.null`, { method: 'PATCH', body: { expires_at: stamp }, prefer: 'return=representation' }, fetcher)).length;
    const used = (await rest<CodeLink[]>(env, `access_codes?select=*&reference_number=eq.${enc(reference)}&used_at=not.is.null&limit=20`, {}, fetcher))
      .filter((c) => typeof c.id === 'string' && UUID.test(c.id));
    for (const code of used) {
      const filters = [`access_code_id.eq.${code.id}`];
      if (code.redeemed_session_id && UUID.test(code.redeemed_session_id)) filters.push(`id.eq.${code.redeemed_session_id}`);
      const session = (await rest<Session[]>(env, `navigator_paid_sessions?select=*&or=(${filters.join(',')})&limit=5`, {}, fetcher))
        .find((s) => s.id === code.redeemed_session_id || s.access_code_id === code.id);
      if (!session) continue;
      // Monthly renewals extend one entitlement by 30 days per code. Refunding one month (the renewal itself, or the
      // original purchase of an entitlement that has paid renewals) takes back those 30 days; refunding a purchase
      // with no renewals revokes it.
      // Before 20261110004740 there is no redeemed_session_id: every redemption had its own entitlement, so no renewals.
      const renewals = (await restOptional<CodeLink[]>(env, `access_codes?select=id&redeemed_session_id=eq.${session.id}&used_at=not.is.null&limit=50`, [], fetcher)).data
        .filter((c) => c.id !== session.access_code_id);
      const isRenewal = session.access_code_id !== code.id;
      if ((isRenewal || renewals.length > 0) && session.expires_at && !firstApplication) {
        // Not the first application of this refund: shortening is not idempotent, so it is left for manual review.
        shorteningsForReview++;
      } else if ((isRenewal || renewals.length > 0) && session.expires_at) {
        const shortened = new Date(Date.parse(session.expires_at) - RENEWAL_DAYS * 86400000).toISOString();
        const rows = await rest<Session[]>(env, `navigator_paid_sessions?id=eq.${session.id}&expires_at=eq.${enc(session.expires_at)}`, { method: 'PATCH', body: { expires_at: shortened }, prefer: 'return=representation' }, fetcher);
        sessionsShortened += rows.length;
      } else {
        // Overwrites any earlier revocation time too, so an earlier console suspension can no longer be "restored".
        const n = (await rest<Session[]>(env, `navigator_paid_sessions?id=eq.${session.id}`, { method: 'PATCH', body: { revoked_at: stamp }, prefer: 'return=representation' }, fetcher)).length;
        sessionsRevoked += n;
        if (n) revokedSessionIds.push(session.id);
      }
    }
  }
  const result = { paymentRejected: rejected, codesExpired, sessionsRevoked, sessionsShortened, shorteningsForReview, resumed: recorded };
  const auditRecorded = await audit(env, admin, 'refund-applied', reference, null, { ...result, revokedSessionIds }, fetcher);
  return ok({ success: true, referenceNumber: reference, amount: amountOf(payment.amount), ...result, auditRecorded,
    note: 'Recorded only. Return the funds to the customer by Interac e-Transfer; this application never moves money.' });
}

async function suspendOrRestore(env: AdminEnv, admin: AdminIdentity, action: 'suspend' | 'restore', body: Record<string, unknown>, fetcher: typeof fetch, now: Date): Promise<Response> {
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  if (!UUID.test(sessionId)) return adminError('INVALID_REQUEST', 400, 'sessionId is required.');
  const reason = reasonOf(body, action === 'suspend');
  if (reason instanceof Response) return reason;
  if (action === 'suspend') {
    const session = await sessionById(env, sessionId, fetcher);
    if (!session || session.revoked_at) return adminError('SESSION_NOT_ACTIVE', 409, 'That entitlement does not exist or is already suspended.');
    const revokedAt = now.toISOString();
    // Recorded first with the exact revocation time: restore lifts only a revocation with this time.
    if (!(await audit(env, admin, 'suspend', sessionId, reason, { tier: session.tier ?? null, revokedAt }, fetcher))) {
      return adminError('ADMIN_AUDIT_UNAVAILABLE', 503, 'The suspension could not be recorded. Nothing was changed.');
    }
    const rows = await rest<Session[]>(env, `navigator_paid_sessions?id=eq.${sessionId}&revoked_at=is.null`, { method: 'PATCH', body: { revoked_at: revokedAt }, prefer: 'return=representation' }, fetcher);
    if (!rows.length) return adminError('SESSION_NOT_ACTIVE', 409, 'That entitlement was suspended or revoked at the same moment.');
    return ok({ success: true, sessionId, status: 'suspended', auditRecorded: true });
  }
  // Only the console's own suspension can be lifted: the entitlement's CURRENT revocation time must equal the
  // revokedAt of one of this console's suspension records. A refund or any other revocation writes a different time,
  // and a suspension that lost a race (its PATCH matched nothing) never matches, so it cannot block a later restore.
  const session = await sessionById(env, sessionId, fetcher);
  if (!session?.revoked_at) return adminError('SESSION_NOT_SUSPENDED', 409, 'That entitlement is not suspended.');
  const current = Date.parse(session.revoked_at);
  const names = await listAllAuditNames(env, SETTLEMENT_READ_LIMIT, fetcher);
  const suspendNames = names.filter((n) => { const p = parseAuditObjectName(n); return !!p && p.target === safeSegment(session.id) && p.action === 'suspend'; }).slice(0, 10);
  let lastName: string | null = null;
  let last: { at: string } | null = null;
  let revokedAt: string | null = null;
  for (const n of suspendNames) {
    const e = await readAuditEvent(env, n, fetcher);
    const value = typeof e?.details?.revokedAt === 'string' ? e.details.revokedAt : null;
    if (value && Date.parse(value) === current) { lastName = n; last = parseAuditObjectName(n); revokedAt = session.revoked_at; break; }
  }
  if (!lastName || !last || !revokedAt) return adminError('NOT_ADMIN_SUSPENDED', 409, 'Only an entitlement suspended from this console can be restored here.');
  // A refund that revoked this entitlement after the suspension is final, even if its timestamp happens to match.
  const laterRefunds = names.filter((n) => { const p = parseAuditObjectName(n); return !!p && p.action === 'refund-applied' && p.at >= last.at; });
  for (const n of laterRefunds.slice(0, 20)) {
    const e = await readAuditEvent(env, n, fetcher);
    if (Array.isArray(e?.details?.revokedSessionIds) && (e!.details.revokedSessionIds as unknown[]).includes(session.id)) {
      return adminError('REVOKED_AFTER_SUSPENSION', 409, 'This entitlement was revoked by a refund after the suspension and cannot be restored here.');
    }
  }
  const rows = await rest<Session[]>(env, `navigator_paid_sessions?id=eq.${sessionId}&revoked_at=eq.${enc(revokedAt)}`, { method: 'PATCH', body: { revoked_at: null }, prefer: 'return=representation' }, fetcher);
  if (!rows.length) return adminError('REVOKED_AFTER_SUSPENSION', 409, 'This entitlement was revoked after the suspension (for example by a refund) and cannot be restored here.');
  const audited = await audit(env, admin, 'restore', sessionId, reason, { tier: rows[0].tier ?? null }, fetcher);
  return ok({ success: true, sessionId, status: 'active', auditRecorded: audited });
}

async function revokeAccessCode(env: AdminEnv, admin: AdminIdentity, body: Record<string, unknown>, fetcher: typeof fetch, now: Date): Promise<Response> {
  const codeId = typeof body.codeId === 'string' ? body.codeId.trim() : '';
  if (!UUID.test(codeId)) return adminError('INVALID_REQUEST', 400, 'codeId is required.');
  const reason = reasonOf(body, true);
  if (reason instanceof Response) return reason;
  const rows = await rest<AccessCode[]>(env, `access_codes?id=eq.${codeId}&used_at=is.null`, { method: 'PATCH', body: { expires_at: now.toISOString() }, prefer: 'return=representation' }, fetcher);
  if (!rows.length) return adminError('CODE_NOT_REVOCABLE', 409, 'That code does not exist or was already redeemed.');
  const audited = await audit(env, admin, 'revoke-code', codeId, reason, { tier: rows[0].tier ?? null, referenceNumber: rows[0].reference_number ?? null }, fetcher);
  return ok({ success: true, codeId, state: 'expired', auditRecorded: audited });
}

async function restoreCredits(env: AdminEnv, admin: AdminIdentity, body: Record<string, unknown>, fetcher: typeof fetch, now: Date): Promise<Response> {
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  const credits = typeof body.credits === 'number' ? body.credits : Number.NaN;
  if (!UUID.test(sessionId) || !Number.isInteger(credits) || credits < 1 || credits > 25) return adminError('INVALID_REQUEST', 400, 'sessionId and a whole number of credits (1-25) are required.');
  const reason = reasonOf(body, true);
  if (reason instanceof Response) return reason;
  const session = await sessionById(env, sessionId, fetcher);
  if (!session) return adminError('SESSION_NOT_FOUND', 404, 'No entitlement has that id.');
  const counter = creditCounter(session, now);
  if (!counter) return adminError('CREDITS_NOT_COUNTED', 409, 'This package has no counted credits to restore in the current period.');
  // An unreleased reservation is returned to the counter automatically (on failure, or by reconciliation within
  // 15 minutes of the next analysis). Restoring now would return that credit twice.
  const live = await rest<Counter[]>(env, `free_usage?select=uid&uid=like.${enc(`paid_res_${session.id}_*`)}&email=like.${enc('reservation:reserved*')}&limit=1`, {}, fetcher);
  if (live.length) return adminError('RESERVATION_PENDING', 409, 'An analysis on this entitlement still holds a credit reservation, which is returned automatically if it fails. Try again later.');
  const rows = await rest<Counter[]>(env, `free_usage?select=uid,analyses_used&uid=eq.${enc(counter.uid)}&limit=1`, {}, fetcher);
  const used = Math.max(0, Number(rows[0]?.analyses_used ?? 0));
  if (!rows.length || used === 0) return adminError('NOTHING_TO_RESTORE', 409, 'No credits have been used in the current period.');
  const next = Math.max(0, used - credits);
  // Compare-and-set on the observed value: a concurrent analysis or administrator changes it and this is refused.
  const updated = await rest<Counter[]>(env, `free_usage?uid=eq.${enc(counter.uid)}&analyses_used=eq.${used}`, { method: 'PATCH', body: { analyses_used: next }, prefer: 'return=representation' }, fetcher);
  if (!updated.length) return adminError('CONCURRENT_UPDATE', 409, 'Credits changed while this request ran. Reload and try again.');
  const audited = await audit(env, admin, 'restore-credits', sessionId, reason, { scope: counter.scope, creditsRestored: used - next, usedBefore: used, usedAfter: next, granted: counter.granted }, fetcher);
  return ok({ success: true, sessionId, scope: counter.scope, creditsRestored: used - next, creditsRemaining: counter.granted - next, auditRecorded: audited });
}

// ---------------------------------------------------------------- router

const GET_ROUTES = ['session', 'payments/overview', 'payments/audit-history', 'customers', 'access-codes', 'jobs', 'usage', 'revenue', 'audit', 'monitoring/status'];
const POST_ROUTES = ['payments/approve', 'payments/confirm-bank', 'payments/dispute', 'payments/reset-settlement', 'payments/refund', 'payments/reissue-code', 'payments/suspend', 'payments/restore', 'access-codes/revoke', 'credits/restore', 'monitoring/run'];

export async function handleAdminRequest(request: Request, env: AdminEnv, deps: Deps = {}): Promise<Response> {
  const fetcher = deps.fetcher ?? fetch;
  const now = deps.now?.() ?? new Date();
  const url = new URL(request.url);
  // trimCharacters: linear equivalent of .replace(/\/+$/, ''), which rescanned every run of slashes in the path.
  const route = trimCharacters(url.pathname.replace(/^\/api\/admin\/?/, ''), '/', { end: true });
  const method = request.method.toUpperCase();
  const known = GET_ROUTES.includes(route) || POST_ROUTES.includes(route);
  if (!known) return adminError('API_ROUTE_NOT_FOUND', 404, 'No administrator endpoint matches this request.');
  const allowed = GET_ROUTES.includes(route) ? 'GET' : 'POST';
  if (method !== allowed) return Response.json({ error: `This endpoint does not accept ${method} requests.`, code: 'METHOD_NOT_ALLOWED', retryable: false }, { status: 405, headers: { ...ADMIN_HEADERS, Allow: allowed } });

  // Authorization first: nothing below runs, and no database is touched, for anyone but a verified administrator.
  const auth = await (deps.requireAdmin ?? requireAdmin)(request, env);
  if ('response' in auth) return auth.response;
  const { admin } = auth;

  if (method === 'POST') {
    const retryAfter = rateLimitRetryAfter('adminWrite', 'uid:' + admin.uid, RATE_LIMITS.adminWrite);
    if (retryAfter > 0) return rateLimitedResponse(retryAfter);
  }

  try {
    if (method === 'GET') {
      switch (route) {
        case 'session': return ok({ admin: true, email: admin.email });
        case 'payments/overview': return ok(await paymentsOverview(env, fetcher, now));
        case 'customers': {
          const q = (url.searchParams.get('q') || '').trim();
          const detail = q ? await customerDetail(env, q, fetcher, now) : null;
          return detail ? ok(detail) : adminError('INVALID_QUERY', 400, 'Search by exact email, Firebase uid, or payment reference (PS-XXXXX).');
        }
        case 'access-codes': {
          const codes = await rest<AccessCode[]>(env, 'access_codes?select=*&order=expires_at.desc.nullslast&limit=300', {}, fetcher);
          const state = url.searchParams.get('state');
          const rows = codes.map(publicCode).filter((c) => !state || c.state === state);
          return ok({ accessCodes: rows });
        }
        case 'jobs': {
          const status = url.searchParams.get('status') || 'failed';
          if (!['failed', 'running', 'queued', 'completed'].includes(status)) return adminError('INVALID_QUERY', 400, 'Unknown job status.');
          const jobs = await rest<Array<Record<string, unknown>>>(env, `analyzer_jobs?select=job_id,owner_uid,mode,status,stage,progress,error_code,error_message,retryable,attempt_count,owner_bypass,session_id,created_at,updated_at,completed_at,lease_expires_at&status=eq.${status}&order=updated_at.desc&limit=100`, {}, fetcher);
          return ok({ jobs: jobs.map((j) => ({ ...j, error_message: typeof j.error_message === 'string' ? j.error_message.slice(0, 240) : null })) });
        }
        case 'usage': return ok(await usageSummary(env, fetcher, now));
        case 'revenue': return ok(await revenueSummary(env, fetcher));
        case 'audit':
        case 'payments/audit-history': {
          const limit = Math.min(40, Math.max(1, Number(url.searchParams.get('limit')) || 40));
          const names = await listAuditNames(env, 1000, fetcher);
          const events = await Promise.all(names.slice(0, limit).map((n) => readAuditEvent(env, n, fetcher)));
          return ok({ total: names.length, events: events.filter(Boolean) });
        }
        case 'monitoring/status': return ok(await monitoringStatus(request, env, fetcher, now));
      }
    }
    const body = await readJson(request);
    if (body instanceof Response) return body;
    switch (route) {
      case 'payments/approve': return await approvePayment(env, admin, body, fetcher, now);
      case 'payments/confirm-bank': return await settlementAction(env, admin, 'confirm-bank', body, fetcher);
      case 'payments/dispute': return await settlementAction(env, admin, 'dispute', body, fetcher);
      case 'payments/reset-settlement': return await settlementAction(env, admin, 'reset-settlement', body, fetcher);
      case 'payments/refund': return await refundPayment(env, admin, body, fetcher, now);
      case 'payments/reissue-code': return await reissueCode(env, admin, body, fetcher, now);
      case 'payments/suspend': return await suspendOrRestore(env, admin, 'suspend', body, fetcher, now);
      case 'payments/restore': return await suspendOrRestore(env, admin, 'restore', body, fetcher, now);
      case 'access-codes/revoke': return await revokeAccessCode(env, admin, body, fetcher, now);
      case 'credits/restore': return await restoreCredits(env, admin, body, fetcher, now);
      case 'monitoring/run': return ok(await monitoringStatus(request, env, fetcher, now));
    }
    return adminError('API_ROUTE_NOT_FOUND', 404, 'No administrator endpoint matches this request.');
  } catch (error) {
    if (error instanceof AdminStoreError) return adminError(error.code, error.status, error.message);
    if (error instanceof DuplicateReferenceError) return adminError('DUPLICATE_REFERENCE', 409, 'More than one payment uses this reference number. Resolve it in the database before acting on it.');
    console.error('[ADMIN_REQUEST_FAILED]', JSON.stringify({ route, name: error instanceof Error ? error.name : 'unknown' }));
    return adminError('ADMIN_REQUEST_FAILED', 500, 'The administrator request failed.');
  }
}

export const onRequest = ({ request, env }: Context): Promise<Response> => handleAdminRequest(request, env);
