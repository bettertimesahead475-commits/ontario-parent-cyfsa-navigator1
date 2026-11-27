import { describe, expect, it, vi, beforeEach } from 'vitest';
import { handleAdminRequest, parsePaymentNotes, creditCounter, type AdminEnv } from '../functions/api/admin/[[path]]';
import { requireAdmin } from '../functions/api/_admin-auth';
import { auditObjectName, parseAuditObjectName, settlementByReference } from '../functions/api/_admin-store';

const SERVICE_KEY = 'eyJhbGciOiJIUzI1NiJ9.' + 'a'.repeat(120) + '.sig';
const env: AdminEnv = { FIREBASE_PROJECT_ID: 'p', STAGING_SUPABASE_URL: 'https://db.example.supabase.co', STAGING_SUPABASE_SERVICE_ROLE_KEY: SERVICE_KEY };
const ADMIN = { admin: { uid: 'admin-uid-1', email: 'mr.pelkie@gmail.com' } };
const allowAdmin = vi.fn(async () => ADMIN);

type Row = Record<string, any>;
const S1 = '11111111-1111-4111-8111-111111111111';
const S2 = '22222222-2222-4222-8222-222222222222';
const C1 = '33333333-3333-4333-8333-333333333333';

/** Minimal in-memory PostgREST + Storage, enough to exercise the filters the admin API sends. */
function fakeSupabase(seed: Record<string, Row[]>) {
  const tables: Record<string, Row[]> = JSON.parse(JSON.stringify(seed));
  const storage = new Map<string, string>();
  const calls: Array<{ method: string; url: string; body?: any }> = [];
  const like = (pattern: string, value: unknown) => typeof value === 'string'
    && new RegExp('^' + pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/_/g, '.').replace(/%/g, '.*')).join('.*') + '$').test(value);
  const test = (row: Row, col: string, expr: string): boolean => {
    if (expr.startsWith('eq.')) return String(row[col]) === expr.slice(3);
    if (expr === 'is.null') return row[col] == null;
    if (expr === 'not.is.null') return row[col] != null;
    if (expr.startsWith('like.')) return like(expr.slice(5), row[col]);
    if (expr.startsWith('in.(')) return expr.slice(4, -1).split(',').includes(String(row[col]));
    if (expr.startsWith('lt.')) return String(row[col]) < expr.slice(3);
    if (expr.startsWith('gte.')) return String(row[col]) >= expr.slice(4);
    throw new Error('unsupported filter ' + expr);
  };
  const fetcher = vi.fn(async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : undefined;
    calls.push({ method, url: url.toString(), body });
    expect(init.headers.apikey).toBe(SERVICE_KEY);
    if (url.pathname.startsWith('/storage/v1/object/list/')) {
      // Like Supabase Storage: one folder level, sorted by name (desc here), paged by limit/offset.
      const names = [...storage.keys()].filter((k) => k.startsWith(body.prefix + '/')).map((k) => k.slice(body.prefix.length + 1)).sort().reverse();
      const offset = Number(body.offset || 0); const limit = Number(body.limit || 100);
      return Response.json(names.slice(offset, offset + limit).map((name) => ({ name })));
    }
    if (url.pathname.startsWith('/storage/v1/object/authenticated/')) {
      const key = decodeURIComponent(url.pathname.split('/analysis_jobs/')[1]);
      return storage.has(key) ? new Response(storage.get(key)) : new Response('{}', { status: 400 });
    }
    if (url.pathname.startsWith('/storage/v1/object/')) {
      const key = decodeURIComponent(url.pathname.split('/analysis_jobs/')[1]);
      if (storage.has(key) && init.headers['x-upsert'] !== 'true') return Response.json({ statusCode: '409' }, { status: 400 });
      storage.set(key, init.body);
      return Response.json({ Key: key });
    }
    const table = url.pathname.replace('/rest/v1/', '');
    const rows = tables[table];
    if (!rows) return Response.json({ code: '42P01' }, { status: 404 });
    const filters = [...url.searchParams.entries()].filter(([k]) => !['select', 'order', 'limit', 'offset', 'or'].includes(k));
    const orExpr = url.searchParams.get('or');
    const match = (r: Row) => filters.every(([c, e]) => test(r, c, e))
      && (!orExpr || orExpr.slice(1, -1).split(',').some((part) => { const [c, ...rest] = part.split('.'); return test(r, c, rest.join('.')); }));
    if (method === 'GET') {
      // Like Supabase: never more than 1,000 rows per response, whatever limit asks for.
      const offset = Number(url.searchParams.get('offset') || 0);
      const limit = Math.min(1000, Number(url.searchParams.get('limit') || 1000));
      const all = rows.filter(match);
      const page = all.slice(offset, offset + limit).map((r) => ({ ...r }));
      const headers: Record<string, string> = String(init.headers?.Prefer || '').includes('count=exact') ? { 'Content-Range': `${offset}-${offset + page.length - 1}/${all.length}` } : {};
      return Response.json(page, { headers });
    }
    if (method === 'PATCH') {
      const hit = rows.filter(match);
      hit.forEach((r) => Object.assign(r, body));
      return Response.json(hit.map((r) => ({ ...r })));
    }
    if (method === 'POST') { rows.push({ id: crypto.randomUUID(), ...body }); return new Response(null, { status: 201 }); }
    throw new Error('unexpected');
  });
  return { tables, storage, calls, fetcher };
}

function seed() {
  return {
    payments: [
      { reference_number: 'PS-AAAAA', plan: 'Premium', amount: 129, status: 'pending', notes: 'email:a_b@x.com;uid:uidA00001;ip:1.2.3.4', submitted_at: '2026-11-01T00:00:00Z' },
      { reference_number: 'PS-BBBBB', plan: 'Basic', amount: 49, status: 'approved', notes: 'email:axb@x.com;uid:uidB00001', submitted_at: '2026-11-02T00:00:00Z', approved_at: '2026-11-02T01:00:00Z' },
    ],
    navigator_paid_sessions: [
      { id: S1, firebase_uid: 'uidA00001', tier: 'Premium', issued_at: '2026-11-01T00:00:00Z', expires_at: '2027-11-01T00:00:00Z', revoked_at: null, access_code_id: C1 },
      { id: S2, firebase_uid: 'uidB00001', tier: 'Basic', issued_at: '2026-11-02T00:00:00Z', expires_at: '2027-11-02T00:00:00Z', revoked_at: null, access_code_id: null },
    ],
    access_codes: [
      { id: C1, email: 'a_b@x.com', tier: 'Premium', reference_number: 'PS-AAAAA', code_hash: 'deadbeef'.repeat(8), used_at: '2026-11-01T02:00:00Z', expires_at: '2026-11-15T00:00:00Z', client_ip: '1.2.3.4' },
    ],
    free_usage: [
      { uid: `paid_session_${S1}_total`, analyses_used: 3, last_analysis_at: '2026-11-03T00:00:00Z' },
      { uid: `paid_session_${S2}_total`, analyses_used: 1, last_analysis_at: '2026-11-03T00:00:00Z' },
      { uid: 'uidA00001', analyses_used: 1 },
    ],
    analyzer_jobs: [
      { job_id: 'job-aaaaaaaa', owner_uid: 'uidA00001', mode: 'full', status: 'failed', error_code: 'AI_TIMEOUT', error_message: 'x'.repeat(500), created_at: '2026-11-20T00:00:00Z', updated_at: '2026-11-20T00:01:00Z' },
      { job_id: 'job-bbbbbbbb', owner_uid: 'uidB00001', mode: 'fast', status: 'completed', created_at: '2026-11-24T00:00:00Z', completed_at: '2026-11-24T00:00:40Z', updated_at: '2026-11-24T00:00:40Z' },
    ],
  };
}

const NOW = new Date('2026-11-25T00:00:00Z');
function req(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  return new Request('https://cyfsanavigator.com/api/admin/' + path, {
    method: init.method || 'GET',
    headers: { ...(init.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...init.headers },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
}
async function call(db: ReturnType<typeof fakeSupabase>, path: string, init: Parameters<typeof req>[1] = {}, auth: any = allowAdmin) {
  const response = await handleAdminRequest(req(path, init), env, { requireAdmin: auth, fetcher: db.fetcher as any, now: () => NOW });
  return { status: response.status, body: await response.json() as any };
}

beforeEach(() => allowAdmin.mockClear());

describe('admin authorization', () => {
  const verify = (result: any) => vi.fn(async () => result);

  it('rejects a request without a Firebase token (401) and never touches the database', async () => {
    const db = fakeSupabase(seed());
    const result = await call(db, 'payments/overview', {}, (r: Request, e: AdminEnv) => requireAdmin(r, e, verify({ status: 'denied' })));
    expect(result.status).toBe(401);
    expect(result.body.code).toBe('AUTH_REQUIRED');
    expect(db.fetcher).not.toHaveBeenCalled();
  });

  it('rejects a signed-in customer who is not an administrator (403), with no data read', async () => {
    const db = fakeSupabase(seed());
    const result = await call(db, 'customers?q=a_b@x.com', {}, (r: Request, e: AdminEnv) => requireAdmin(r, e, verify({ status: 'verified', uid: 'uidA00001', email: 'a_b@x.com', emailVerified: true })));
    expect(result.status).toBe(403);
    expect(result.body.code).toBe('ADMIN_REQUIRED');
    expect(db.fetcher).not.toHaveBeenCalled();
  });

  it('rejects the administrator email when the address is not verified', async () => {
    const r = await requireAdmin(req('session'), env, verify({ status: 'verified', uid: 'u1', email: 'mr.pelkie@gmail.com', emailVerified: false }));
    expect('response' in r && r.response.status).toBe(403);
  });

  it('accepts the verified owner by default, and honours ADMIN_EMAILS / ADMIN_UIDS when configured', async () => {
    const owner = verify({ status: 'verified', uid: 'u1', email: 'Mr.Pelkie@gmail.com', emailVerified: true });
    expect('admin' in (await requireAdmin(req('session'), env, owner))).toBe(true);
    expect('response' in (await requireAdmin(req('session'), { ...env, ADMIN_EMAILS: 'ops@example.com' }, owner))).toBe(true);
    expect('response' in (await requireAdmin(req('session'), { ...env, ADMIN_UIDS: 'someone-else' }, owner))).toBe(true);
    expect('admin' in (await requireAdmin(req('session'), { ...env, ADMIN_UIDS: 'u1' }, owner))).toBe(true);
  });

  it('no longer accepts the old shared x-admin-secret header', async () => {
    const db = fakeSupabase(seed());
    const result = await call(db, 'payments/overview', { headers: { 'x-admin-secret': 'the-old-secret' } },
      (r: Request, e: AdminEnv) => requireAdmin(r, { ...e, ADMIN_SECRET: 'the-old-secret' } as AdminEnv, verify({ status: 'denied' })));
    expect(result.status).toBe(401);
    expect(db.fetcher).not.toHaveBeenCalled();
  });

  it('reports sign-in verification outages as 503, not as a denial', async () => {
    const r = await requireAdmin(req('session'), env, verify({ status: 'unavailable' }));
    expect('response' in r && r.response.status).toBe(503);
  });

  it('answers unknown routes (404) and wrong methods (405) before authorization', async () => {
    const db = fakeSupabase(seed());
    const deny = vi.fn();
    expect((await call(db, 'nope', {}, deny)).status).toBe(404);
    expect((await call(db, 'payments/suspend', {}, deny)).status).toBe(405);
    expect((await call(db, 'payments/overview', { method: 'POST', body: {} }, deny)).status).toBe(405);
    expect(deny).not.toHaveBeenCalled();
  });

  it('requires a JSON body for state changes', async () => {
    const db = fakeSupabase(seed());
    const response = await handleAdminRequest(new Request('https://cyfsanavigator.com/api/admin/payments/suspend', { method: 'POST', body: 'sessionId=x' }), env, { requireAdmin: allowAdmin as any, fetcher: db.fetcher as any });
    expect(response.status).toBe(415);
  });
});

describe('admin read endpoints', () => {
  it('payments overview: customer fields, credits, and no code hashes, raw notes or IP addresses', async () => {
    const db = fakeSupabase(seed());
    const { status, body } = await call(db, 'payments/overview');
    expect(status).toBe(200);
    const a = body.payments.find((p: any) => p.referenceNumber === 'PS-AAAAA');
    expect(a).toMatchObject({ customerEmail: 'a_b@x.com', firebaseUid: 'uidA00001', package: 'Premium', amount: 129, status: 'pending', sessionId: S1, creditsGranted: 5, creditsConsumed: 3, creditsRemaining: 2 });
    const text = JSON.stringify(body);
    expect(text).not.toContain('deadbeef');
    expect(text).not.toContain('1.2.3.4');
    expect(text).not.toContain('email:');
  });

  it('customer search returns only the exact customer, even when LIKE wildcards would match another', async () => {
    const db = fakeSupabase(seed());
    const { status, body } = await call(db, 'customers?q=' + encodeURIComponent('a_b@x.com'));
    expect(status).toBe(200);
    expect(body.identity).toEqual({ email: 'a_b@x.com', firebaseUid: 'uidA00001' });
    expect(body.payments.map((p: any) => p.referenceNumber)).toEqual(['PS-AAAAA']);
    expect(body.sessions.map((s: any) => s.sessionId)).toEqual([S1]);
    expect(body.jobs.map((j: any) => j.job_id)).toEqual(['job-aaaaaaaa']);
    expect(body.accessCodes).toHaveLength(1);
    expect(JSON.stringify(body)).not.toMatch(/axb@x\.com|uidB00001|PS-BBBBB|deadbeef/);
    // The '_' wildcard did reach the database; the exact re-check removed the other customer.
    expect(db.calls.some((c) => c.url.includes('notes=like.'))).toBe(true);
  });

  it('customer search rejects free-form queries that could widen a database filter', async () => {
    const db = fakeSupabase(seed());
    for (const q of ['*', 'a,b', '%@x.com)', 'x']) {
      expect((await call(db, 'customers?q=' + encodeURIComponent(q))).status).toBe(400);
    }
  });

  it('failed jobs, usage and revenue summaries', async () => {
    const db = fakeSupabase(seed());
    const jobs = await call(db, 'jobs?status=failed');
    expect(jobs.body.jobs.map((j: any) => j.job_id)).toEqual(['job-aaaaaaaa']);
    expect(jobs.body.jobs[0].error_message.length).toBe(240);
    const usage = await call(db, 'usage');
    expect(usage.body.byMode.quickReview).toMatchObject({ total: 1, completed: 1, avgSeconds: 40 });
    expect(usage.body.failuresByCode).toEqual({ AI_TIMEOUT: 1 });
    const revenue = await call(db, 'revenue');
    expect(revenue.body.totals).toMatchObject({ approvedAmount: 49, pendingAmount: 129, refundedAmount: 0, netAmount: 49 });
  });
});

describe('admin state changes', () => {
  it('approves a payment once: issues a hashed code, records an audit entry without the code, refuses a second approval', async () => {
    const db = fakeSupabase(seed());
    const first = await call(db, 'payments/approve', { method: 'POST', body: { referenceNumber: 'PS-AAAAA', amountReceived: 129 } });
    expect(first.status).toBe(200);
    expect(first.body.accessCode).toMatch(/^[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    const inserted = db.tables.access_codes.at(-1)!;
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(first.body.accessCode));
    expect(inserted.code_hash).toBe([...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join(''));
    expect(inserted).toMatchObject({ email: 'a_b@x.com', tier: 'Premium', reference_number: 'PS-AAAAA' });
    expect(db.tables.payments[0].status).toBe('approved');
    const auditBodies = [...db.storage.values()].join('');
    expect(auditBodies).toContain('"action":"approve"');
    expect(auditBodies).not.toContain(first.body.accessCode);

    const second = await call(db, 'payments/approve', { method: 'POST', body: { referenceNumber: 'PS-AAAAA', amountReceived: 129 } });
    expect(second.status).toBe(409);
    expect(db.tables.access_codes).toHaveLength(2);
  });

  it('approval: concurrent claim loses the compare-and-set and issues nothing; short payment is refused', async () => {
    const db = fakeSupabase(seed());
    const low = await call(db, 'payments/approve', { method: 'POST', body: { referenceNumber: 'PS-AAAAA', amountReceived: 100 } });
    expect(low.status).toBe(400);
    // Simulate another administrator approving between this request's read and its update.
    const original = db.fetcher.getMockImplementation()!;
    db.fetcher.mockImplementation(async (input: any, init: any = {}) => {
      if ((init.method || 'GET') === 'PATCH' && String(input).includes('/payments')) db.tables.payments[0].status = 'approved';
      return original(input, init);
    });
    const raced = await call(db, 'payments/approve', { method: 'POST', body: { referenceNumber: 'PS-AAAAA', amountReceived: 129 } });
    expect(raced.status).toBe(409);
    expect(db.tables.access_codes).toHaveLength(1);
  });

  it('approval rolls the payment back to pending when the code cannot be stored', async () => {
    const db = fakeSupabase(seed());
    const original = db.fetcher.getMockImplementation()!;
    db.fetcher.mockImplementation(async (input: any, init: any = {}) =>
      (init.method === 'POST' && String(input).endsWith('/rest/v1/access_codes')) ? Response.json({ code: '23505' }, { status: 409 }) : original(input, init));
    const result = await call(db, 'payments/approve', { method: 'POST', body: { referenceNumber: 'PS-AAAAA', amountReceived: 129 } });
    expect(result.status).toBe(502);
    expect(db.tables.payments[0].status).toBe('pending');
  });

  it('suspends an entitlement, refuses to restore anything it did not suspend, then restores it', async () => {
    const db = fakeSupabase(seed());
    expect((await call(db, 'payments/restore', { method: 'POST', body: { sessionId: S2 } })).status).toBe(409);
    expect((await call(db, 'payments/suspend', { method: 'POST', body: { sessionId: S1 } })).body.code).toBe('REASON_REQUIRED');
    const s = await call(db, 'payments/suspend', { method: 'POST', body: { sessionId: S1, reason: 'Chargeback investigation' } });
    expect(s.status).toBe(200);
    expect(db.tables.navigator_paid_sessions[0].revoked_at).toBe(NOW.toISOString());
    expect(db.tables.navigator_paid_sessions[1].revoked_at).toBeNull();
    expect((await call(db, 'payments/suspend', { method: 'POST', body: { sessionId: S1, reason: 'again' } })).status).toBe(409);
    // A revocation that did not come from this console (e.g. a refund) cannot be lifted here.
    db.tables.navigator_paid_sessions[1].revoked_at = '2026-11-20T00:00:00Z';
    expect((await call(db, 'payments/restore', { method: 'POST', body: { sessionId: S2 } })).status).toBe(409);
    await new Promise((r) => setTimeout(r, 2));
    const restored = await call(db, 'payments/restore', { method: 'POST', body: { sessionId: S1 } });
    expect(restored.status).toBe(200);
    expect(db.tables.navigator_paid_sessions[0].revoked_at).toBeNull();
  });

  it('restores used credits with compare-and-set on the counter, never below zero', async () => {
    const db = fakeSupabase(seed());
    const r = await call(db, 'credits/restore', { method: 'POST', body: { sessionId: S1, credits: 2, reason: 'Failed analysis' } });
    expect(r.body).toMatchObject({ success: true, creditsRestored: 2, creditsRemaining: 4 });
    expect(db.tables.free_usage[0].analyses_used).toBe(1);
    expect(db.tables.free_usage[1].analyses_used).toBe(1); // another customer's counter is untouched
    const over = await call(db, 'credits/restore', { method: 'POST', body: { sessionId: S1, credits: 5, reason: 'Failed analysis' } });
    expect(over.body.creditsRestored).toBe(1);
    expect((await call(db, 'credits/restore', { method: 'POST', body: { sessionId: S1, credits: 1, reason: 'x y z' } })).body.code).toBe('NOTHING_TO_RESTORE');

    const raced = fakeSupabase(seed());
    const original = raced.fetcher.getMockImplementation()!;
    raced.fetcher.mockImplementation(async (input: any, init: any = {}) => {
      if (init.method === 'PATCH' && String(input).includes('/free_usage')) raced.tables.free_usage[0].analyses_used = 4; // an analysis ran meanwhile
      return original(input, init);
    });
    expect((await call(raced, 'credits/restore', { method: 'POST', body: { sessionId: S1, credits: 1, reason: 'Failed analysis' } })).body.code).toBe('CONCURRENT_UPDATE');
    expect(raced.tables.free_usage[0].analyses_used).toBe(4);
  });

  it('records a refund once, expires unused codes and revokes the linked entitlement', async () => {
    const db = fakeSupabase(seed());
    db.tables.access_codes.push({ id: crypto.randomUUID(), email: 'a_b@x.com', tier: 'Premium', reference_number: 'PS-AAAAA', used_at: null, expires_at: '2026-12-01T00:00:00Z' });
    expect((await call(db, 'payments/refund', { method: 'POST', body: { referenceNumber: 'PS-AAAAA' } })).body.code).toBe('REASON_REQUIRED');
    const r = await call(db, 'payments/refund', { method: 'POST', body: { referenceNumber: 'PS-AAAAA', reason: 'Customer request' } });
    expect(r.body).toMatchObject({ success: true, amount: 129, paymentRejected: true, codesExpired: 1, sessionsRevoked: 1, auditRecorded: true });
    expect(db.tables.navigator_paid_sessions[1].revoked_at).toBeNull();
    expect((await call(db, 'payments/refund', { method: 'POST', body: { referenceNumber: 'PS-AAAAA', reason: 'Customer request' } })).status).toBe(409);
    const revenue = await call(db, 'revenue');
    expect(revenue.body.totals.pendingAmount).toBe(0);
    const overview = await call(db, 'payments/overview');
    expect(overview.body.payments.find((p: any) => p.referenceNumber === 'PS-AAAAA').bankSettlementStatus).toBe('refunded');
  });

  it('bank settlement: confirm and dispute are audited and reflected; a dispute needs a reason', async () => {
    const db = fakeSupabase(seed());
    expect((await call(db, 'payments/dispute', { method: 'POST', body: { referenceNumber: 'PS-BBBBB' } })).status).toBe(400);
    expect((await call(db, 'payments/confirm-bank', { method: 'POST', body: { referenceNumber: 'PS-BBBBB' } })).status).toBe(200);
    let overview = await call(db, 'payments/overview');
    expect(overview.body.payments.find((p: any) => p.referenceNumber === 'PS-BBBBB').bankSettlementStatus).toBe('bank_confirmed');
    await new Promise((r) => setTimeout(r, 2));
    await call(db, 'payments/dispute', { method: 'POST', body: { referenceNumber: 'PS-BBBBB', reason: 'Not in bank statement' } });
    overview = await call(db, 'payments/overview');
    expect(overview.body.payments.find((p: any) => p.referenceNumber === 'PS-BBBBB').bankSettlementStatus).toBe('missing_or_disputed');
    const audit = await call(db, 'audit');
    expect(audit.body.events.map((e: any) => e.action)).toEqual(['dispute', 'confirm-bank']);
    expect(audit.body.events[0]).toMatchObject({ admin: 'mr.pelkie@gmail.com', reason: 'Not in bank statement', target: 'PS-BBBBB' });
  });

  it('a settlement change is refused when the audit log cannot be written', async () => {
    const db = fakeSupabase(seed());
    const original = db.fetcher.getMockImplementation()!;
    db.fetcher.mockImplementation(async (input: any, init: any = {}) =>
      (init.method === 'POST' && String(input).includes('/storage/v1/object/analysis_jobs/')) ? new Response('{}', { status: 500 }) : original(input, init));
    const r = await call(db, 'payments/confirm-bank', { method: 'POST', body: { referenceNumber: 'PS-BBBBB' } });
    expect(r.status).toBe(503);
  });

  it('revokes only unredeemed access codes', async () => {
    const db = fakeSupabase(seed());
    expect((await call(db, 'access-codes/revoke', { method: 'POST', body: { codeId: C1, reason: 'Issued in error' } })).status).toBe(409);
    const id = crypto.randomUUID();
    db.tables.access_codes.push({ id, email: 'z@x.com', tier: 'Basic', reference_number: 'PS-ZZZZZ', used_at: null, expires_at: '2026-12-01T00:00:00Z' });
    const r = await call(db, 'access-codes/revoke', { method: 'POST', body: { codeId: id, reason: 'Issued in error' } });
    expect(r.status).toBe(200);
    const list = await call(db, 'access-codes?state=expired');
    expect(list.body.accessCodes.map((c: any) => c.id)).toEqual([id]);
    expect(JSON.stringify(list.body)).not.toContain('code_hash');
  });
});

describe('admin helpers', () => {
  it('parses payment notes and computes the charged credit counter', () => {
    expect(parsePaymentNotes('email:A@B.com;uid:u123456;key:k')).toEqual({ email: 'a@b.com', uid: 'u123456' });
    expect(parsePaymentNotes(null)).toEqual({ email: null, uid: null });
    expect(creditCounter({ id: S1, tier: 'Basic', issued_at: '2026-01-01T00:00:00Z' }, NOW)).toEqual({ uid: `paid_session_${S1}_total`, granted: 3, scope: 'total' });
    expect(creditCounter({ id: S1, tier: 'Pro', issued_at: '2026-01-10T00:00:00Z' }, NOW)).toEqual({ uid: `paid_session_${S1}_period_2026-11-10`, granted: 5, scope: 'period:2026-11-10' });
    expect(creditCounter({ id: S1, tier: 'Nope' }, NOW)).toBeNull();
  });

  it('audit object names round-trip and the newest settlement wins', () => {
    const name = auditObjectName({ at: '2026-11-25T10:15:00.123Z', action: 'confirm-bank', target: 'PS-ABCDE' }, 'abc12345');
    expect(parseAuditObjectName(name)).toEqual({ at: '2026-11-25T10:15:00.123Z', action: 'confirm-bank', target: 'PS-ABCDE' });
    expect(parseAuditObjectName('../etc/passwd')).toBeNull();
    const older = auditObjectName({ at: '2026-11-01T00:00:00.000Z', action: 'dispute', target: 'PS-ABCDE' }, 'n1');
    const names = [name, older].sort().reverse();
    expect(settlementByReference(names).get('PS-ABCDE')).toEqual({ status: 'bank_confirmed', at: '2026-11-25T10:15:00.123Z' });
  });
});

describe('independent review findings (fc8b31c) stay fixed', () => {
  const tick = () => new Promise((r) => setTimeout(r, 2));

  it('#1 a suspension cannot be "restored" after a refund revoked the entitlement', async () => {
    const db = fakeSupabase(seed());
    expect((await call(db, 'payments/suspend', { method: 'POST', body: { sessionId: S1, reason: 'Chargeback check' } })).status).toBe(200);
    await tick();
    const refund = await call(db, 'payments/refund', { method: 'POST', body: { referenceNumber: 'PS-AAAAA', reason: 'Customer request' } });
    expect(refund.body.sessionsRevoked).toBe(1);
    await tick();
    const restore = await call(db, 'payments/restore', { method: 'POST', body: { sessionId: S1 } });
    expect(restore.status).toBe(409);
    expect(restore.body.code).toBe('REVOKED_AFTER_SUSPENSION');
    expect(db.tables.navigator_paid_sessions[0].revoked_at).not.toBeNull();
  });

  it('#2 refunding a monthly renewal takes back 30 days; refunding the original keeps paid renewals', async () => {
    const db = fakeSupabase(seed());
    db.tables.navigator_paid_sessions[0] = { ...db.tables.navigator_paid_sessions[0], tier: 'Pro', expires_at: '2027-01-01T00:00:00.000Z' };
    db.tables.access_codes[0].redeemed_session_id = S1;
    db.tables.access_codes.push({ id: crypto.randomUUID(), email: 'a_b@x.com', tier: 'Pro', reference_number: 'PS-RENEW1', used_at: '2026-12-01T00:00:00Z', expires_at: '2026-12-15T00:00:00Z', redeemed_session_id: S1 });
    db.tables.payments.push({ reference_number: 'PS-RENEW1', plan: 'Pro', amount: 29, status: 'approved', notes: 'email:a_b@x.com;uid:uidA00001' });
    const renewal = await call(db, 'payments/refund', { method: 'POST', body: { referenceNumber: 'PS-RENEW1', reason: 'Renewal refund' } });
    expect(renewal.body).toMatchObject({ sessionsShortened: 1, sessionsRevoked: 0 });
    expect(db.tables.navigator_paid_sessions[0]).toMatchObject({ expires_at: '2026-12-02T00:00:00.000Z', revoked_at: null });
    const original = await call(db, 'payments/refund', { method: 'POST', body: { referenceNumber: 'PS-AAAAA', reason: 'First month refund' } });
    expect(original.body).toMatchObject({ sessionsShortened: 1, sessionsRevoked: 0 });
    expect(db.tables.navigator_paid_sessions[0].revoked_at).toBeNull();
  });

  it('#3 a reference shared by two payments is refused instead of acting on an arbitrary row', async () => {
    const db = fakeSupabase(seed());
    db.tables.payments.push({ reference_number: 'PS-AAAAA', plan: 'Basic', amount: 49, status: 'pending', notes: 'email:other@x.com;uid:uidC00001' });
    const attempts: Array<[string, Record<string, unknown>]> = [
      ['payments/approve', { referenceNumber: 'PS-AAAAA', amountReceived: 129 }],
      ['payments/refund', { referenceNumber: 'PS-AAAAA', reason: 'xyz' }],
      ['payments/confirm-bank', { referenceNumber: 'PS-AAAAA' }],
    ];
    for (const [path, body] of attempts) expect((await call(db, path, { method: 'POST', body })).body.code).toBe('DUPLICATE_REFERENCE');
    expect((await call(db, 'customers?q=PS-AAAAA')).body.code).toBe('DUPLICATE_REFERENCE');
    expect(db.tables.payments.filter((p) => p.reference_number === 'PS-AAAAA').every((p) => p.status === 'pending')).toBe(true);
    expect(db.tables.access_codes).toHaveLength(1);
  });

  it('#4 revenue totals cover every payment past the 1,000-row response cap', async () => {
    const db = fakeSupabase(seed());
    for (let i = 0; i < 1500; i++) db.tables.payments.push({ reference_number: `PS-T${String(i).padStart(5, '0')}`, plan: 'Basic', amount: 1, status: 'approved', approved_at: '2026-11-03T00:00:00Z' });
    const revenue = await call(db, 'revenue');
    expect(revenue.body.totals.approvedAmount).toBe(1549);
    expect(revenue.body.truncated).toBe(false);
  });

  it('#5 a refund whose record cannot be written changes nothing', async () => {
    const db = fakeSupabase(seed());
    const original = db.fetcher.getMockImplementation()!;
    db.fetcher.mockImplementation(async (input: any, init: any = {}) =>
      (init.method === 'POST' && String(input).includes('/storage/v1/object/analysis_jobs/')) ? new Response('{}', { status: 500 }) : original(input, init));
    const r = await call(db, 'payments/refund', { method: 'POST', body: { referenceNumber: 'PS-AAAAA', reason: 'Customer request' } });
    expect(r.status).toBe(503);
    expect(db.tables.payments[0].status).toBe('pending');
    expect(db.tables.navigator_paid_sessions[0].revoked_at).toBeNull();
  });

  it('#6 a refunded payment cannot change settlement or be refunded twice', async () => {
    const db = fakeSupabase(seed());
    await call(db, 'payments/refund', { method: 'POST', body: { referenceNumber: 'PS-BBBBB', reason: 'Customer request' } });
    await tick();
    for (const path of ['payments/confirm-bank', 'payments/reset-settlement']) {
      expect((await call(db, path, { method: 'POST', body: { referenceNumber: 'PS-BBBBB' } })).body.code).toBe('PAYMENT_REFUNDED');
    }
    expect((await call(db, 'payments/dispute', { method: 'POST', body: { referenceNumber: 'PS-BBBBB', reason: 'later' } })).body.code).toBe('PAYMENT_REFUNDED');
    expect((await call(db, 'payments/refund', { method: 'POST', body: { referenceNumber: 'PS-BBBBB', reason: 'again' } })).body.code).toBe('ALREADY_REFUNDED');
    expect((await call(db, 'revenue')).body.totals.refundedAmount).toBe(49);
  });

  it('#6b an interrupted refund is resumed (access revoked) rather than refused', async () => {
    const db = fakeSupabase(seed());
    const original = db.fetcher.getMockImplementation()!;
    let failSessions = true;
    db.fetcher.mockImplementation(async (input: any, init: any = {}) =>
      (failSessions && init.method === 'PATCH' && String(input).includes('/navigator_paid_sessions')) ? Response.json({ code: 'XX000' }, { status: 500 }) : original(input, init));
    expect((await call(db, 'payments/refund', { method: 'POST', body: { referenceNumber: 'PS-AAAAA', reason: 'Customer request' } })).status).toBe(502);
    expect(db.tables.navigator_paid_sessions[0].revoked_at).toBeNull();
    failSessions = false;
    const resumed = await call(db, 'payments/refund', { method: 'POST', body: { referenceNumber: 'PS-AAAAA', reason: 'Customer request' } });
    expect(resumed.body).toMatchObject({ success: true, resumed: true, sessionsRevoked: 1 });
    expect((await call(db, 'payments/refund', { method: 'POST', body: { referenceNumber: 'PS-AAAAA', reason: 'Customer request' } })).body.code).toBe('ALREADY_REFUNDED');
  });

  it('#7 an approved payment whose code was never delivered gets a new code; a redeemed one does not', async () => {
    const db = fakeSupabase(seed());
    expect((await call(db, 'payments/reissue-code', { method: 'POST', body: { referenceNumber: 'PS-AAAAA', reason: 'Lost email' } })).body.code).toBe('PAYMENT_NOT_APPROVED');
    const oldId = crypto.randomUUID();
    db.tables.access_codes.push({ id: oldId, email: 'axb@x.com', tier: 'Basic', reference_number: 'PS-BBBBB', used_at: null, expires_at: '2026-12-01T00:00:00Z' });
    const r = await call(db, 'payments/reissue-code', { method: 'POST', body: { referenceNumber: 'PS-BBBBB', reason: 'Lost email' } });
    expect(r.body.accessCode).toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    expect(db.tables.access_codes.find((c) => c.id === oldId)!.expires_at).toBe(NOW.toISOString());
    expect(db.tables.access_codes.filter((c) => c.reference_number === 'PS-BBBBB')).toHaveLength(2);
    db.tables.payments[0].status = 'approved';
    expect((await call(db, 'payments/reissue-code', { method: 'POST', body: { referenceNumber: 'PS-AAAAA', reason: 'x y z' } })).body.code).toBe('CODE_ALREADY_REDEEMED');
  });

  it('#8 ADMIN_UIDS is compared case-sensitively', async () => {
    const owner = vi.fn(async () => ({ status: 'verified', uid: 'AbCdEf123', email: 'mr.pelkie@gmail.com', emailVerified: true }));
    expect('response' in (await requireAdmin(req('session'), { ...env, ADMIN_UIDS: 'abcdef123' }, owner as any))).toBe(true);
    expect('admin' in (await requireAdmin(req('session'), { ...env, ADMIN_UIDS: 'AbCdEf123' }, owner as any))).toBe(true);
  });

  it('#9 each payment shows the entitlement its own code created, not the newest of the same package', async () => {
    const db = fakeSupabase(seed());
    const S3 = '44444444-4444-4444-8444-444444444444';
    db.tables.navigator_paid_sessions.unshift({ id: S3, firebase_uid: 'uidA00001', tier: 'Premium', issued_at: '2026-11-20T00:00:00Z', expires_at: '2027-11-20T00:00:00Z', revoked_at: null, access_code_id: null });
    const overview = await call(db, 'payments/overview');
    expect(overview.body.payments.find((p: any) => p.referenceNumber === 'PS-AAAAA').sessionId).toBe(S1);
    expect(overview.body.payments.find((p: any) => p.referenceNumber === 'PS-BBBBB').sessionId).toBeNull();
  });

  it('#10 credits are not restored while a reservation that returns them itself is still open', async () => {
    const db = fakeSupabase(seed());
    db.tables.free_usage.push({ uid: `paid_res_${S1}_abcdef`, email: 'reservation:reserved', analyses_used: 3 });
    const r = await call(db, 'credits/restore', { method: 'POST', body: { sessionId: S1, credits: 1, reason: 'Failed analysis' } });
    expect(r.body.code).toBe('RESERVATION_PENDING');
    expect(db.tables.free_usage[0].analyses_used).toBe(3);
    db.tables.free_usage.at(-1)!.email = 'reservation:consumed';
    expect((await call(db, 'credits/restore', { method: 'POST', body: { sessionId: S1, credits: 1, reason: 'Failed analysis' } })).body.creditsRestored).toBe(1);
  });
});

describe('independent re-review findings (c82e971) stay fixed', () => {
  const tick = () => new Promise((r) => setTimeout(r, 2));
  function renewalFixture() {
    const db = fakeSupabase(seed());
    db.tables.navigator_paid_sessions[0] = { ...db.tables.navigator_paid_sessions[0], tier: 'Pro', expires_at: '2027-01-01T00:00:00.000Z' };
    db.tables.access_codes[0].redeemed_session_id = S1;
    db.tables.access_codes.push({ id: crypto.randomUUID(), email: 'a_b@x.com', tier: 'Pro', reference_number: 'PS-RENEW1', used_at: '2026-12-01T00:00:00Z', expires_at: '2026-12-15T00:00:00Z', redeemed_session_id: S1 });
    db.tables.payments.push({ reference_number: 'PS-RENEW1', plan: 'Pro', amount: 29, status: 'approved', notes: 'email:a_b@x.com;uid:uidA00001' });
    return db;
  }

  it('R1 a second refund run that did not see the first one never takes back the renewal days twice', async () => {
    const db = renewalFixture();
    await call(db, 'payments/refund', { method: 'POST', body: { referenceNumber: 'PS-RENEW1', reason: 'Renewal refund' } });
    expect(db.tables.navigator_paid_sessions[0].expires_at).toBe('2026-12-02T00:00:00.000Z');
    // A concurrent request that read the audit log before the first wrote anything: only the lock remains visible.
    for (const key of [...db.storage.keys()]) if (key.startsWith('admin-audit/')) db.storage.delete(key);
    const second = await call(db, 'payments/refund', { method: 'POST', body: { referenceNumber: 'PS-RENEW1', reason: 'Renewal refund' } });
    expect(second.body).toMatchObject({ sessionsShortened: 0, shorteningsForReview: 1 });
    expect(db.tables.navigator_paid_sessions[0].expires_at).toBe('2026-12-02T00:00:00.000Z');
  });

  it('R2 a settlement record that lands after a refund cannot hide the refund', async () => {
    const db = fakeSupabase(seed());
    await call(db, 'payments/refund', { method: 'POST', body: { referenceNumber: 'PS-BBBBB', reason: 'Customer request' } });
    await tick();
    // Simulate a confirm-bank that passed its check before the refund and was written after it.
    db.storage.set('admin-audit/' + auditObjectName({ at: new Date().toISOString(), action: 'confirm-bank', target: 'PS-BBBBB' }, 'late0001'), '{}');
    const overview = await call(db, 'payments/overview');
    expect(overview.body.payments.find((p: any) => p.referenceNumber === 'PS-BBBBB').bankSettlementStatus).toBe('refunded');
    expect((await call(db, 'revenue')).body.totals.refundedAmount).toBe(49);
    expect((await call(db, 'payments/refund', { method: 'POST', body: { referenceNumber: 'PS-BBBBB', reason: 'again' } })).body.code).toBe('ALREADY_REFUNDED');
  });

  it('R3 reissue: a redemption during the reissue wins, and two reissues at once leave one code', async () => {
    const db = fakeSupabase(seed());
    db.tables.access_codes.push({ id: crypto.randomUUID(), email: 'axb@x.com', tier: 'Basic', reference_number: 'PS-BBBBB', used_at: null, expires_at: '2026-12-01T00:00:00Z' });
    const original = db.fetcher.getMockImplementation()!;
    db.fetcher.mockImplementation(async (input: any, init: any = {}) => {
      // The customer redeems the old code just before the expiry update.
      if (init.method === 'PATCH' && String(input).includes('/access_codes')) db.tables.access_codes.at(-1)!.used_at = '2026-11-25T00:00:00Z';
      return original(input, init);
    });
    const raced = await call(db, 'payments/reissue-code', { method: 'POST', body: { referenceNumber: 'PS-BBBBB', reason: 'Lost email' } });
    expect(raced.body.code).toBe('CODE_ALREADY_REDEEMED');
    expect(db.tables.access_codes.filter((c) => c.reference_number === 'PS-BBBBB')).toHaveLength(1);

    const db2 = fakeSupabase(seed());
    const first = await call(db2, 'payments/reissue-code', { method: 'POST', body: { referenceNumber: 'PS-BBBBB', reason: 'Lost email' } });
    const second = await call(db2, 'payments/reissue-code', { method: 'POST', body: { referenceNumber: 'PS-BBBBB', reason: 'Lost email' } });
    expect(first.status).toBe(200);
    expect(second.body.code).toBe('REISSUE_IN_PROGRESS');
    expect(db2.tables.access_codes.filter((c) => c.reference_number === 'PS-BBBBB' && !c.used_at && c.expires_at > NOW.toISOString())).toHaveLength(1);
  });

  it('R4 a legacy duplicated reference never shows (or exposes actions on) another customer\'s entitlement', async () => {
    const db = fakeSupabase(seed());
    db.tables.payments.push({ reference_number: 'PS-AAAAA', plan: 'Premium', amount: 129, status: 'approved', notes: 'email:other@x.com;uid:uidC00001' });
    const overview = await call(db, 'payments/overview');
    for (const p of overview.body.payments.filter((x: any) => x.referenceNumber === 'PS-AAAAA')) expect(p.sessionId).toBeNull();
  });

  it('R5 paging stops on the exact total even when the row cap is smaller than 1,000', async () => {
    const db = fakeSupabase(seed());
    for (let i = 0; i < 1200; i++) db.tables.payments.push({ reference_number: `PS-T${String(i).padStart(5, '0')}`, plan: 'Basic', amount: 1, status: 'approved' });
    const original = db.fetcher.getMockImplementation()!;
    db.fetcher.mockImplementation(async (input: any, init: any = {}) => {
      const url = new URL(String(input));
      if (url.searchParams.has('offset')) url.searchParams.set('limit', '500'); // a project with max_rows = 500
      return original(url.toString(), init);
    });
    const revenue = await call(db, 'revenue');
    expect(revenue.body.totals.approvedAmount).toBe(1249);
    expect(revenue.body.truncated).toBe(false);
  });

  it('R6 an upper-case session id cannot skip the open-reservation check', async () => {
    const db = fakeSupabase(seed());
    const SX = 'abcdef12-3456-4abc-8def-abcdef123456';
    db.tables.navigator_paid_sessions.push({ id: SX, firebase_uid: 'uidA00001', tier: 'Premium', issued_at: '2026-11-01T00:00:00Z', expires_at: '2027-11-01T00:00:00Z', revoked_at: null });
    db.tables.free_usage.push({ uid: `paid_session_${SX}_total`, analyses_used: 2 }, { uid: `paid_res_${SX}_abcdef`, email: 'reservation:reserved', analyses_used: 2 });
    const original = db.fetcher.getMockImplementation()!;
    // Postgres compares uuid columns case-insensitively (text columns such as free_usage.uid are case-sensitive).
    db.fetcher.mockImplementation(async (input: any, init: any = {}) =>
      original(String(input).includes('/navigator_paid_sessions') ? String(input).replace(SX.toUpperCase(), SX) : String(input), init));
    const r = await call(db, 'credits/restore', { method: 'POST', body: { sessionId: SX.toUpperCase(), credits: 1, reason: 'Failed analysis' } });
    expect(r.body.code).toBe('RESERVATION_PENDING');
  });

  it('R7 a suspension that lost a race does not make the winning suspension permanent', async () => {
    const db = fakeSupabase(seed());
    expect((await call(db, 'payments/suspend', { method: 'POST', body: { sessionId: S1, reason: 'First admin' } })).status).toBe(200);
    await tick();
    // The second admin's record is written (newer), but its update matched nothing.
    db.storage.set('admin-audit/' + auditObjectName({ at: new Date().toISOString(), action: 'suspend', target: S1 }, 'loser001'),
      JSON.stringify({ at: new Date().toISOString(), action: 'suspend', target: S1, admin: 'b', reason: 'x', details: { revokedAt: '2026-11-25T00:00:01.000Z' } }));
    const restored = await call(db, 'payments/restore', { method: 'POST', body: { sessionId: S1 } });
    expect(restored.status).toBe(200);
    expect(db.tables.navigator_paid_sessions[0].revoked_at).toBeNull();
  });
});

describe('financial reporting integrity (DEVIN-FIN-01)', () => {
  const failStorageList = (db: ReturnType<typeof fakeSupabase>, status = 503) => {
    const original = db.fetcher.getMockImplementation()!;
    db.fetcher.mockImplementation(async (input: any, init: any = {}) =>
      String(input).includes('/storage/v1/object/list/') ? new Response('{}', { status }) : original(input, init));
  };

  it('complete data: totals are reported and marked complete', async () => {
    const db = fakeSupabase(seed());
    await call(db, 'payments/refund', { method: 'POST', body: { referenceNumber: 'PS-BBBBB', reason: 'Customer request' } });
    const r = await call(db, 'revenue');
    expect(r.body.reporting).toMatchObject({ complete: true, settlementAvailable: true, warnings: [] });
    expect(r.body.totals).toMatchObject({ approvedAmount: 49, refundedAmount: 49, netAmount: 0, pendingAmount: 129 });
  });

  it('audit log unreadable: refunds/net/settlement are unavailable (null), never silently zero', async () => {
    const db = fakeSupabase(seed());
    await call(db, 'payments/refund', { method: 'POST', body: { referenceNumber: 'PS-BBBBB', reason: 'Customer request' } });
    failStorageList(db);
    const r = await call(db, 'revenue');
    expect(r.status).toBe(200);
    expect(r.body.reporting.complete).toBe(false);
    expect(r.body.reporting.settlementAvailable).toBe(false);
    expect(r.body.reporting.warnings.join(' ')).toMatch(/could not be read/);
    // Payment-row totals are still authoritative; refund-derived figures are not presented.
    expect(r.body.totals).toMatchObject({ approvedAmount: 49, pendingAmount: 129, refundedAmount: null, netAmount: null, bankConfirmedAmount: null, disputedAmount: null });
    expect(r.body.byMonth.every((m: any) => m.refundedAmount === null)).toBe(true);
  });

  it('audit log unreadable: overview and customer lookup show settlement "unknown", not "pending_settlement"', async () => {
    const db = fakeSupabase(seed());
    failStorageList(db);
    const overview = await call(db, 'payments/overview');
    expect(overview.body.reporting.settlementAvailable).toBe(false);
    expect(overview.body.payments.every((p: any) => p.bankSettlementStatus === 'unknown')).toBe(true);
    const customer = await call(db, 'customers?q=PS-BBBBB');
    expect(customer.body.reporting.settlementAvailable).toBe(false);
    expect(customer.body.payments[0].bankSettlementStatus).toBe('unknown');
  });

  it('settlement actions refuse to proceed when the audit log is unreadable (no blind second refund)', async () => {
    const db = fakeSupabase(seed());
    await call(db, 'payments/refund', { method: 'POST', body: { referenceNumber: 'PS-BBBBB', reason: 'Customer request' } });
    failStorageList(db);
    const again = await call(db, 'payments/refund', { method: 'POST', body: { referenceNumber: 'PS-BBBBB', reason: 'Customer request' } });
    expect(again.status).toBe(503);
  });

  it('duplicate payment references: refund/settlement totals unavailable with a warning', async () => {
    const db = fakeSupabase(seed());
    db.tables.payments.push({ reference_number: 'PS-BBBBB', plan: 'Basic', amount: 49, status: 'approved', notes: 'email:other@x.com;uid:uidC00001' });
    const r = await call(db, 'revenue');
    expect(r.body.reporting).toMatchObject({ complete: false, duplicateReferences: 1 });
    expect(r.body.totals.approvedAmount).toBe(98);
    expect(r.body.totals.refundedAmount).toBeNull();
    expect(r.body.reporting.warnings.join(' ')).toMatch(/PS-BBBBB/);
  });

  it('payments read fails part-way: the request fails rather than reporting partial totals', async () => {
    const db = fakeSupabase(seed());
    for (let i = 0; i < 1500; i++) db.tables.payments.push({ reference_number: `PS-T${String(i).padStart(5, '0')}`, plan: 'Basic', amount: 1, status: 'approved' });
    const original = db.fetcher.getMockImplementation()!;
    db.fetcher.mockImplementation(async (input: any, init: any = {}) =>
      String(input).includes('/rest/v1/payments') && String(input).includes('offset=1000') ? new Response('{}', { status: 500 }) : original(input, init));
    const r = await call(db, 'revenue');
    expect(r.status).toBeGreaterThanOrEqual(500);
    expect(r.body.totals).toBeUndefined();
  });
});

describe('financial reporting integrity — independent review follow-ups', () => {
  const fill = (db: ReturnType<typeof fakeSupabase>, n: number) => {
    for (let i = 0; i < n; i++) db.storage.set(`admin-audit/${auditObjectName({ at: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(), action: 'note', target: `X${i}` }, `n${i}`)}`, '{}');
  };

  it('#1 a non-audit entry cannot make a cut-off audit listing look complete', async () => {
    const db = fakeSupabase(seed());
    await call(db, 'payments/refund', { method: 'POST', body: { referenceNumber: 'PS-BBBBB', reason: 'Customer request' } });
    fill(db, 20_000); // the read limit; with the placeholder, the raw listing is longer than can be read
    db.storage.set('admin-audit/zzzz-.emptyFolderPlaceholder', '');
    const r = await call(db, 'revenue');
    expect(r.body.reporting.settlementAvailable).toBe(false);
    expect(r.body.totals.refundedAmount).toBeNull();
  });

  it('#1 a refund/settlement decision refuses (503) when the history cannot be read completely', async () => {
    const db = fakeSupabase(seed());
    await call(db, 'payments/refund', { method: 'POST', body: { referenceNumber: 'PS-BBBBB', reason: 'Customer request' } });
    fill(db, 20_100);
    expect((await call(db, 'payments/confirm-bank', { method: 'POST', body: { referenceNumber: 'PS-BBBBB' } })).status).toBe(503);
    expect((await call(db, 'payments/refund', { method: 'POST', body: { referenceNumber: 'PS-BBBBB', reason: 'again' } })).status).toBe(503);
  });

  it('warns from 80 % of the audit read limit while figures are still complete', async () => {
    const db = fakeSupabase(seed());
    fill(db, 16_100);
    const r = await call(db, 'revenue');
    expect(r.body.reporting.settlementAvailable).toBe(true);
    expect(r.body.totals.refundedAmount).toBe(0);
    expect(r.body.reporting.warnings.join(' ')).toMatch(/per-payment indexing/);
  });

  it('#1 a malformed (non-array) listing is an outage, not an empty history', async () => {
    const db = fakeSupabase(seed());
    const original = db.fetcher.getMockImplementation()!;
    db.fetcher.mockImplementation(async (input: any, init: any = {}) =>
      String(input).includes('/storage/v1/object/list/') ? Response.json({ unexpected: true }) : original(input, init));
    const r = await call(db, 'revenue');
    expect(r.body.reporting.settlementAvailable).toBe(false);
    expect(r.body.totals.refundedAmount).toBeNull();
  });

  it('#2 monthly and package breakdowns are unavailable when the payment read is incomplete', async () => {
    const db = fakeSupabase(seed());
    for (let i = 0; i < 1200; i++) db.tables.payments.push({ reference_number: `PS-T${String(i).padStart(5, '0')}`, plan: 'Basic', amount: 1, status: 'approved', approved_at: '2026-11-03T00:00:00Z' });
    const original = db.fetcher.getMockImplementation()!;
    db.fetcher.mockImplementation(async (input: any, init: any = {}) => {
      const res = await original(input, init);
      if (!String(input).includes('/rest/v1/payments')) return res;
      // Report a larger total than can be read: the read is incomplete.
      const headers = new Headers(res.headers);
      if (headers.get('Content-Range')) headers.set('Content-Range', headers.get('Content-Range')!.replace(/\/\d+$/, '/999999'));
      return new Response(await res.text(), { status: res.status, headers });
    });
    const r = await call(db, 'revenue');
    expect(r.body.reporting.paymentsComplete).toBe(false);
    for (const m of r.body.byMonth) expect([m.approved, m.approvedAmount, m.refundedAmount]).toEqual([null, null, null]);
    for (const p of r.body.byPlan) expect([p.approved, p.approvedAmount, p.pending]).toEqual([null, null, null]);
  });

  it('#3 payments sharing a reference show settlement "unknown" in the overview, with a warning', async () => {
    const db = fakeSupabase(seed());
    await call(db, 'payments/confirm-bank', { method: 'POST', body: { referenceNumber: 'PS-BBBBB' } });
    db.tables.payments.push({ reference_number: 'PS-BBBBB', plan: 'Basic', amount: 49, status: 'approved', notes: 'email:other@x.com;uid:uidC00001' });
    const o = await call(db, 'payments/overview');
    const shared = o.body.payments.filter((p: any) => p.referenceNumber === 'PS-BBBBB');
    expect(shared).toHaveLength(2);
    for (const p of shared) expect(p.bankSettlementStatus).toBe('unknown');
    expect(o.body.reporting.warnings.join(' ')).toMatch(/shared by more than one payment/);
  });
});

describe('shared references detected across the whole payments table (re-review residual)', () => {
  it('customer lookup by email marks a reference shared with another customer as unknown, with a warning', async () => {
    const db = fakeSupabase(seed());
    await call(db, 'payments/confirm-bank', { method: 'POST', body: { referenceNumber: 'PS-BBBBB' } });
    // Another customer's legacy payment reuses the same reference (not visible in this customer's rows).
    db.tables.payments.push({ reference_number: 'PS-BBBBB', plan: 'Basic', amount: 49, status: 'approved', notes: 'email:other@x.com;uid:uidC00001' });
    const c = await call(db, 'customers?q=' + encodeURIComponent('axb@x.com'));
    expect(c.status).toBe(200);
    expect(c.body.payments.map((p: any) => p.referenceNumber)).toEqual(['PS-BBBBB']);
    expect(c.body.payments[0].bankSettlementStatus).toBe('unknown');
    expect(c.body.reporting.warnings.join(' ')).toMatch(/also used by another payment/);
  });
});

describe('refund of an early one-off re-purchase (Migration E granted_credits)', () => {
  const TOPUP = '44444444-4444-4444-8444-444444444444';
  // S1 is an active Premium pack (C1, PS-AAAAA) topped up early by PS-TOPUP1. With E applied the session row carries
  // granted_credits (5 per Premium pack); before E the column does not exist at all.
  function topUpFixture(granted?: number | null) {
    const db = fakeSupabase(seed());
    const session: Row = { ...db.tables.navigator_paid_sessions[0], expires_at: '2027-01-01T00:00:00.000Z' };
    if (granted !== undefined) session.granted_credits = granted;
    db.tables.navigator_paid_sessions[0] = session;
    db.tables.access_codes[0].redeemed_session_id = S1;
    db.tables.access_codes.push({ id: TOPUP, email: 'a_b@x.com', tier: 'Premium', reference_number: 'PS-TOPUP1', used_at: '2026-12-01T00:00:00Z', expires_at: '2026-12-15T00:00:00Z', redeemed_session_id: S1 });
    db.tables.payments.push({ reference_number: 'PS-TOPUP1', plan: 'Premium', amount: 49.99, status: 'approved', notes: 'email:a_b@x.com;uid:uidA00001' });
    return db;
  }
  const refund = (db: ReturnType<typeof fakeSupabase>, referenceNumber: string) =>
    call(db, 'payments/refund', { method: 'POST', body: { referenceNumber, reason: 'Customer request' } });
  const sessionPatches = (db: ReturnType<typeof fakeSupabase>) =>
    db.calls.filter((c) => c.method === 'PATCH' && c.url.includes('/rest/v1/navigator_paid_sessions'));

  // With E applied the top-up refund is one database call (paid_refund_one_off_pack, qualified against PostgreSQL in
  // tests/devin/early-renewal-credits-migration.pg.test.ts); here only the request and the reading of its answer.
  function withRefundRpc(db: ReturnType<typeof fakeSupabase>, answer: (body: any) => Record<string, unknown>) {
    const impl = db.fetcher.getMockImplementation()!;
    const rpc: any[] = [];
    db.fetcher.mockImplementation(async (input: any, init: any = {}) => {
      if (String(input).includes('/rest/v1/rpc/paid_refund_one_off_pack')) { const body = JSON.parse(init.body); rpc.push(body); return Response.json(answer(body)); }
      return impl(input, init);
    });
    return rpc;
  }

  it('E1 refunding the top-up is one database call keyed to that code, with no session PATCH', async () => {
    const db = topUpFixture(10);
    const rpc = withRefundRpc(db, () => ({ status: 'applied', used_beyond_remaining: 0 }));
    expect((await refund(db, 'PS-TOPUP1')).body).toMatchObject({ sessionsShortened: 1, sessionsRevoked: 0, shorteningsForReview: 0, packAnalysesAlreadyUsed: 0 });
    expect(rpc).toEqual([{ p_session: S1, p_refund_key: `PS-TOPUP1:${TOPUP}`, p_days: 30 }]);
    expect(sessionPatches(db)).toHaveLength(0);
  });

  it('E3 refunding the original pack of a topped-up session uses that pack\'s own refund key', async () => {
    const db = topUpFixture(10);
    const rpc = withRefundRpc(db, () => ({ status: 'applied', used_beyond_remaining: 0 }));
    expect((await refund(db, 'PS-AAAAA')).body).toMatchObject({ sessionsShortened: 1, sessionsRevoked: 0 });
    expect(rpc).toEqual([{ p_session: S1, p_refund_key: `PS-AAAAA:${db.tables.access_codes[0].id}`, p_days: 30 }]);
  });

  it('E4 a resumed refund calls the function again and counts its first result, without a second deduction', async () => {
    const db = topUpFixture(15);
    const rpc = withRefundRpc(db, (body) => ({ status: rpcSeen.has(body.p_refund_key) ? 'already_applied' : (rpcSeen.add(body.p_refund_key), 'applied'), used_beyond_remaining: 2 }));
    const rpcSeen = new Set<string>();
    await refund(db, 'PS-TOPUP1');
    for (const key of [...db.storage.keys()]) if (key.startsWith('admin-audit/')) db.storage.delete(key);
    expect((await refund(db, 'PS-TOPUP1')).body).toMatchObject({ sessionsShortened: 1, shorteningsForReview: 0, packAnalysesAlreadyUsed: 2 });
    expect(rpc.map((r) => r.p_refund_key)).toEqual([`PS-TOPUP1:${TOPUP}`, `PS-TOPUP1:${TOPUP}`]);
    expect(sessionPatches(db)).toHaveLength(0);
  });

  it('E6 analyses of the refunded pack already used are reported for a partial-refund decision', async () => {
    const db = topUpFixture(10);
    withRefundRpc(db, () => ({ status: 'applied', used_beyond_remaining: 3 }));
    expect((await refund(db, 'PS-TOPUP1')).body).toMatchObject({ sessionsShortened: 1, packAnalysesAlreadyUsed: 3 });
  });

  it('E7 an answer other than applied (no top-up left, unknown) is reported for review, never as applied', async () => {
    for (const status of ['no_top_up', 'not_one_off', undefined]) {
      const db = topUpFixture(10);
      withRefundRpc(db, () => ({ status }));
      expect((await refund(db, 'PS-TOPUP1')).body).toMatchObject({ sessionsShortened: 0, shorteningsForReview: 1 });
    }
  });

  it('E5 before E (no granted_credits column) and on monthly tiers the refund sends exactly the request it sent before', async () => {
    const before = topUpFixture();
    await refund(before, 'PS-TOPUP1');
    const [patch] = sessionPatches(before);
    expect(patch.body).toEqual({ expires_at: '2026-12-02T00:00:00.000Z' });
    expect(decodeURIComponent(patch.url)).not.toContain('granted_credits');

    const monthly = topUpFixture(null);
    monthly.tables.navigator_paid_sessions[0].tier = 'Pro';
    await refund(monthly, 'PS-TOPUP1');
    expect(sessionPatches(monthly)[0].body).toEqual({ expires_at: '2026-12-02T00:00:00.000Z' });
  });
});
