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
  rest, restOptional, appendAudit, listAuditNames, readAuditEvent, parseAuditObjectName, settlementByReference, safeSegment,
  AdminStoreError, type AdminStoreEnv,
} from '../_admin-store';
import { LIMITS } from '../_paid-credit-reservation';
import { monthlyCreditScope } from '../_monthly-credit-scope';
import { statusResponse, type StatusEnv } from '../_status';
import { RATE_LIMITS, rateLimitRetryAfter, rateLimitedResponse } from '../_rate-limit';

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

function publicPayment(p: Payment, settlement?: { status: string; at: string }) {
  const { email, uid } = parsePaymentNotes(p.notes);
  return { referenceNumber: p.reference_number ?? null, customerEmail: email, firebaseUid: (p.firebase_uid as string) || uid,
    package: p.plan ?? null, amount: amountOf(p.amount), status: p.status ?? null, submittedAt: p.submitted_at ?? null,
    approvedAt: p.approved_at ?? null, bankSettlementStatus: settlement?.status ?? 'pending_settlement', settlementUpdatedAt: settlement?.at ?? null };
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

async function paymentByReference(env: AdminEnv, reference: string, fetcher: typeof fetch): Promise<Payment | null> {
  const rows = await rest<Payment[]>(env, `payments?select=*&reference_number=eq.${enc(reference)}&limit=1`, {}, fetcher);
  return rows[0] ?? null;
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
  const [payments, sessions, auditNames] = await Promise.all([
    rest<Payment[]>(env, 'payments?select=*&order=submitted_at.desc.nullslast&limit=200', {}, fetcher),
    rest<Session[]>(env, 'navigator_paid_sessions?select=*&order=issued_at.desc&limit=500', {}, fetcher),
    listAuditNames(env, 2000, fetcher).catch(() => [] as string[]),
  ]);
  const settlement = settlementByReference(auditNames);
  const counters = await countersFor(env, sessions.map((s) => s.id), fetcher);
  const sessionsByUid = new Map<string, Session[]>();
  for (const s of sessions) if (s.firebase_uid) sessionsByUid.set(s.firebase_uid, [...(sessionsByUid.get(s.firebase_uid) || []), s]);
  return {
    payments: payments.map((p) => {
      const base = publicPayment(p, settlement.get(safeSegment(String(p.reference_number || ''))));
      const session = base.firebaseUid ? (sessionsByUid.get(base.firebaseUid) || []).find((s) => s.tier === p.plan) : undefined;
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
  if (!email) email = payments.map((p) => parsePaymentNotes(p.notes).email).find(Boolean) ?? null;
  if (!uid) uid = payments.map((p) => (p.firebase_uid as string) || parsePaymentNotes(p.notes).uid).find(Boolean) ?? null;

  const [sessions, codes, jobs, freeUsage, auditNames] = await Promise.all([
    uid ? rest<Session[]>(env, `navigator_paid_sessions?select=*&firebase_uid=eq.${enc(uid)}&order=issued_at.desc&limit=50`, {}, fetcher) : Promise.resolve([] as Session[]),
    email ? rest<AccessCode[]>(env, `access_codes?select=*&email=eq.${enc(email)}&limit=50`, {}, fetcher) : Promise.resolve([] as AccessCode[]),
    uid ? rest<Record<string, unknown>[]>(env, `analyzer_jobs?select=job_id,mode,status,stage,progress,error_code,retryable,attempt_count,created_at,updated_at,completed_at,session_id&owner_uid=eq.${enc(uid)}&order=created_at.desc&limit=50`, {}, fetcher) : Promise.resolve([]),
    uid ? rest<Counter[]>(env, `free_usage?select=uid,analyses_used,last_analysis_at&uid=eq.${enc(uid)}&limit=1`, {}, fetcher) : Promise.resolve([] as Counter[]),
    listAuditNames(env, 2000, fetcher).catch(() => [] as string[]),
  ]);
  const ownSessions = sessions.filter((s) => s.firebase_uid === uid);
  const counters = await countersFor(env, ownSessions.map((s) => s.id), fetcher);
  const settlement = settlementByReference(auditNames);
  const targets = new Set([...ownSessions.map((s) => safeSegment(s.id)), ...payments.map((p) => safeSegment(String(p.reference_number || ''))), ...codes.map((c) => safeSegment(String(c.id || '')))]);
  return {
    identity: { email, firebaseUid: uid },
    payments: payments.map((p) => publicPayment(p, settlement.get(safeSegment(String(p.reference_number || ''))))),
    sessions: ownSessions.map((s) => publicSession(s, counters, now)),
    accessCodes: codes.filter((c) => (c.email || '').toLowerCase() === email).map(publicCode),
    jobs,
    freeUsage: freeUsage.filter((r) => r.uid === uid).map((r) => ({ analysesUsed: r.analyses_used ?? 0, lastAnalysisAt: r.last_analysis_at ?? null }))[0] ?? null,
    auditTrail: auditNames.map((n) => ({ name: n, parsed: parseAuditObjectName(n) })).filter((x) => x.parsed && targets.has(x.parsed.target)).slice(0, 50).map((x) => x.parsed),
  };
}

async function usageSummary(env: AdminEnv, fetcher: typeof fetch, now: Date) {
  const since = new Date(now.getTime() - 7 * 86400000).toISOString();
  const jobs = await rest<Array<{ mode: string; status: string; error_code: string | null; created_at: string; completed_at: string | null; owner_bypass: boolean }>>(
    env, `analyzer_jobs?select=mode,status,error_code,created_at,completed_at,owner_bypass&created_at=gte.${enc(since)}&limit=5000`, {}, fetcher);
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
  return { windowDays: 7, jobsLast24h: last24h, byMode, failuresByCode: failures, truncated: jobs.length >= 5000 };
}

async function revenueSummary(env: AdminEnv, fetcher: typeof fetch) {
  const [payments, auditNames, summary] = await Promise.all([
    rest<Payment[]>(env, 'payments?select=reference_number,plan,amount,status,submitted_at,approved_at&limit=5000', {}, fetcher),
    listAuditNames(env, 5000, fetcher).catch(() => [] as string[]),
    restOptional<Record<string, unknown>[]>(env, 'navigator_payment_summary?select=*', [], fetcher),
  ]);
  const settlement = settlementByReference(auditNames);
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
  return {
    currency: 'CAD',
    totals: { approvedAmount: round(approvedAmount), refundedAmount: round(refundedAmount), netAmount: round(approvedAmount - refundedAmount),
      bankConfirmedAmount: round(bankConfirmedAmount), disputedAmount: round(disputedAmount), pendingAmount: round(pendingAmount) },
    byMonth: Object.entries(months).sort(([a], [b]) => b.localeCompare(a)).map(([month, v]) => ({ month, ...v, approvedAmount: round(v.approvedAmount), refundedAmount: round(v.refundedAmount) })),
    byPlan: Object.entries(plans).map(([plan, v]) => ({ plan, ...v, approvedAmount: round(v.approvedAmount) })),
    tierSummary: summary.available ? summary.data : null,
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

async function approvePayment(env: AdminEnv, admin: AdminIdentity, body: Record<string, unknown>, fetcher: typeof fetch, now: Date): Promise<Response> {
  const reference = typeof body.referenceNumber === 'string' ? body.referenceNumber.trim().toUpperCase() : '';
  const received = typeof body.amountReceived === 'number' ? body.amountReceived : NaN;
  if (!REFERENCE.test(reference) || !Number.isFinite(received) || received <= 0 || received > 100000) return adminError('INVALID_REQUEST', 400, 'referenceNumber and amountReceived are required.');
  const payment = await paymentByReference(env, reference, fetcher);
  if (!payment) return adminError('PAYMENT_NOT_FOUND', 404, 'No payment request has that reference number.');
  if (payment.status !== 'pending') return adminError('PAYMENT_ALREADY_PROCESSED', 409, `This payment was already processed (${payment.status}). No second code was issued.`);
  const expected = amountOf(payment.amount);
  if (received + 0.001 < expected) return adminError('AMOUNT_TOO_LOW', 400, `Amount received ($${received}) is less than the $${expected} due for ${payment.plan}.`);
  const { email } = parsePaymentNotes(payment.notes);
  if (!email || !LIMITS[String(payment.plan)]) return adminError('PAYMENT_INCOMPLETE', 422, 'This payment request has no customer email or a package that cannot be activated.');

  // Compare-and-set: only one approval can move the row out of 'pending', so a code is never issued twice.
  const claimed = await rest<Payment[]>(env, `payments?reference_number=eq.${enc(reference)}&status=eq.pending`, {
    method: 'PATCH', body: { status: 'approved', approved_at: now.toISOString() }, prefer: 'return=representation',
  }, fetcher);
  if (!claimed.length) return adminError('PAYMENT_ALREADY_PROCESSED', 409, 'Another administrator processed this payment at the same moment. No second code was issued.');

  const code = generateAccessCode();
  const expiresAt = new Date(now.getTime() + CODE_TTL_DAYS * 86400000).toISOString();
  try {
    await rest(env, 'access_codes', { method: 'POST', body: { email, tier: payment.plan, reference_number: reference, amount: received, code_hash: await sha256Hex(code), expires_at: expiresAt }, prefer: 'return=minimal' }, fetcher);
  } catch (error) {
    // Put the payment back so the approval can be retried; nothing was issued.
    await rest(env, `payments?reference_number=eq.${enc(reference)}&status=eq.approved`, { method: 'PATCH', body: { status: 'pending', approved_at: null }, prefer: 'return=minimal' }, fetcher).catch(() => undefined);
    throw error;
  }
  const audited = await audit(env, admin, 'approve', reference, null, { plan: payment.plan, amountExpected: expected, amountReceived: received, codeExpiresAt: expiresAt }, fetcher);
  return ok({ success: true, referenceNumber: reference, customerEmail: email, tier: payment.plan, accessCode: code, expiresAt, auditRecorded: audited,
    note: 'Send this code to the customer now. It is shown once and only its hash is stored.' });
}

async function settlementAction(env: AdminEnv, admin: AdminIdentity, action: 'confirm-bank' | 'dispute' | 'reset-settlement', body: Record<string, unknown>, fetcher: typeof fetch): Promise<Response> {
  const reference = typeof body.referenceNumber === 'string' ? body.referenceNumber.trim().toUpperCase() : '';
  if (!REFERENCE.test(reference)) return adminError('INVALID_REQUEST', 400, 'referenceNumber is required.');
  const reason = reasonOf(body, action === 'dispute');
  if (reason instanceof Response) return reason;
  const payment = await paymentByReference(env, reference, fetcher);
  if (!payment) return adminError('PAYMENT_NOT_FOUND', 404, 'No payment request has that reference number.');
  if (!(await audit(env, admin, action, reference, reason, { amount: amountOf(payment.amount), plan: payment.plan }, fetcher))) {
    return adminError('ADMIN_AUDIT_UNAVAILABLE', 503, 'The settlement change could not be recorded. Nothing was changed.');
  }
  return ok({ success: true, referenceNumber: reference, bankSettlementStatus: action === 'confirm-bank' ? 'bank_confirmed' : action === 'dispute' ? 'missing_or_disputed' : 'pending_settlement' });
}

async function refundPayment(env: AdminEnv, admin: AdminIdentity, body: Record<string, unknown>, fetcher: typeof fetch, now: Date): Promise<Response> {
  const reference = typeof body.referenceNumber === 'string' ? body.referenceNumber.trim().toUpperCase() : '';
  if (!REFERENCE.test(reference)) return adminError('INVALID_REQUEST', 400, 'referenceNumber is required.');
  const reason = reasonOf(body, true);
  if (reason instanceof Response) return reason;
  const revokeAccess = body.revokeAccess !== false;
  const payment = await paymentByReference(env, reference, fetcher);
  if (!payment) return adminError('PAYMENT_NOT_FOUND', 404, 'No payment request has that reference number.');
  const names = await listAuditNames(env, 5000, fetcher);
  if (settlementByReference(names).get(safeSegment(reference))?.status === 'refunded') return adminError('ALREADY_REFUNDED', 409, 'This payment is already recorded as refunded.');

  const stamp = now.toISOString();
  let rejected = false; let codesExpired = 0; let sessionsRevoked = 0;
  if (payment.status === 'pending') {
    rejected = (await rest<Payment[]>(env, `payments?reference_number=eq.${enc(reference)}&status=eq.pending`, { method: 'PATCH', body: { status: 'rejected' }, prefer: 'return=representation' }, fetcher)).length > 0;
  }
  if (revokeAccess) {
    const codes = await rest<AccessCode[]>(env, `access_codes?select=id,used_at&reference_number=eq.${enc(reference)}&limit=20`, {}, fetcher);
    codesExpired = (await rest<AccessCode[]>(env, `access_codes?reference_number=eq.${enc(reference)}&used_at=is.null`, { method: 'PATCH', body: { expires_at: stamp }, prefer: 'return=representation' }, fetcher)).length;
    const ids = codes.map((c) => String(c.id || '')).filter((id) => UUID.test(id));
    if (ids.length) {
      try {
        sessionsRevoked = (await rest<Session[]>(env, `navigator_paid_sessions?access_code_id=in.(${ids.join(',')})&revoked_at=is.null`, { method: 'PATCH', body: { revoked_at: stamp }, prefer: 'return=representation' }, fetcher)).length;
      } catch (error) {
        if (!(error instanceof AdminStoreError && error.code === 'ADMIN_SCHEMA_UNAVAILABLE')) throw error;
      }
    }
  }
  const audited = await audit(env, admin, 'refund', reference, reason, { amount: amountOf(payment.amount), plan: payment.plan, revokeAccess, paymentRejected: rejected, codesExpired, sessionsRevoked }, fetcher);
  return ok({ success: true, referenceNumber: reference, amount: amountOf(payment.amount), paymentRejected: rejected, codesExpired, sessionsRevoked, auditRecorded: audited,
    note: 'Recorded only. Return the funds to the customer by Interac e-Transfer; this application never moves money.' });
}

async function suspendOrRestore(env: AdminEnv, admin: AdminIdentity, action: 'suspend' | 'restore', body: Record<string, unknown>, fetcher: typeof fetch, now: Date): Promise<Response> {
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId.trim() : '';
  if (!UUID.test(sessionId)) return adminError('INVALID_REQUEST', 400, 'sessionId is required.');
  const reason = reasonOf(body, action === 'suspend');
  if (reason instanceof Response) return reason;
  if (action === 'suspend') {
    const rows = await rest<Session[]>(env, `navigator_paid_sessions?id=eq.${sessionId}&revoked_at=is.null`, { method: 'PATCH', body: { revoked_at: now.toISOString() }, prefer: 'return=representation' }, fetcher);
    if (!rows.length) return adminError('SESSION_NOT_ACTIVE', 409, 'That entitlement does not exist or is already suspended.');
    const audited = await audit(env, admin, 'suspend', sessionId, reason, { tier: rows[0].tier ?? null }, fetcher);
    return ok({ success: true, sessionId, status: 'suspended', auditRecorded: audited });
  }
  // Only an administrator suspension can be lifted here (never a refund or other revocation): the newest audit record
  // for this entitlement must be a suspension.
  const names = await listAuditNames(env, 5000, fetcher);
  const last = names.map(parseAuditObjectName).find((p) => p && p.target === safeSegment(sessionId) && ['suspend', 'restore'].includes(p.action));
  if (!last || last.action !== 'suspend') return adminError('NOT_ADMIN_SUSPENDED', 409, 'Only an entitlement suspended from this console can be restored here.');
  const rows = await rest<Session[]>(env, `navigator_paid_sessions?id=eq.${sessionId}&revoked_at=not.is.null`, { method: 'PATCH', body: { revoked_at: null }, prefer: 'return=representation' }, fetcher);
  if (!rows.length) return adminError('SESSION_NOT_SUSPENDED', 409, 'That entitlement is not suspended.');
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
  const credits = typeof body.credits === 'number' ? body.credits : NaN;
  if (!UUID.test(sessionId) || !Number.isInteger(credits) || credits < 1 || credits > 25) return adminError('INVALID_REQUEST', 400, 'sessionId and a whole number of credits (1-25) are required.');
  const reason = reasonOf(body, true);
  if (reason instanceof Response) return reason;
  const session = await sessionById(env, sessionId, fetcher);
  if (!session) return adminError('SESSION_NOT_FOUND', 404, 'No entitlement has that id.');
  const counter = creditCounter(session, now);
  if (!counter) return adminError('CREDITS_NOT_COUNTED', 409, 'This package has no counted credits to restore in the current period.');
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
const POST_ROUTES = ['payments/approve', 'payments/confirm-bank', 'payments/dispute', 'payments/reset-settlement', 'payments/refund', 'payments/suspend', 'payments/restore', 'access-codes/revoke', 'credits/restore', 'monitoring/run'];

export async function handleAdminRequest(request: Request, env: AdminEnv, deps: Deps = {}): Promise<Response> {
  const fetcher = deps.fetcher ?? fetch;
  const now = deps.now?.() ?? new Date();
  const url = new URL(request.url);
  const route = url.pathname.replace(/^\/api\/admin\/?/, '').replace(/\/+$/, '');
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
      case 'payments/suspend': return await suspendOrRestore(env, admin, 'suspend', body, fetcher, now);
      case 'payments/restore': return await suspendOrRestore(env, admin, 'restore', body, fetcher, now);
      case 'access-codes/revoke': return await revokeAccessCode(env, admin, body, fetcher, now);
      case 'credits/restore': return await restoreCredits(env, admin, body, fetcher, now);
      case 'monitoring/run': return ok(await monitoringStatus(request, env, fetcher, now));
    }
    return adminError('API_ROUTE_NOT_FOUND', 404, 'No administrator endpoint matches this request.');
  } catch (error) {
    if (error instanceof AdminStoreError) return adminError(error.code, error.status, error.message);
    console.error('[ADMIN_REQUEST_FAILED]', JSON.stringify({ route, name: error instanceof Error ? error.name : 'unknown' }));
    return adminError('ADMIN_REQUEST_FAILED', 500, 'The administrator request failed.');
  }
}

export const onRequest = ({ request, env }: Context): Promise<Response> => handleAdminRequest(request, env);
