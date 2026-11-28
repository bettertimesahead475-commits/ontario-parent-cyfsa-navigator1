// Payment-schema qualification (Claude D-1..D-4 on PR #171): the real handlers (claim-purchase, my-payments,
// activate-code, admin approve/reissue/refund) against a disposable PostgreSQL behind the real PostgREST binary.
// Baseline = the live nxfhvebzzobegubefcda payment schema, grants and redeem function (captured read-only:
// tests/devin/fixtures/live-nxfh-payment-schema.sql). Only Firebase verification is stubbed; audit history and
// create-once locks use an in-memory Storage double. Skips unless CREDIT_PG_URL is set and a PostgREST binary exists
// (POSTGREST_BIN, ~/tools/postgrest or /usr/local/bin/postgrest). Synthetic accounts only; nothing hosted is touched.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as authCheck from '../../functions/api/_auth-check';
import { onRequestPost as claimHandler } from '../../functions/api/claim-purchase';
import { onRequestGet as myPaymentsHandler } from '../../functions/api/my-payments';
import { onRequestPost as activateHandler } from '../../functions/api/activate-code';
import { handleAdminRequest } from '../../functions/api/admin/[[path]]';
import { Harness, findPostgrest, localJwt, type Hop } from './helpers/postgrest-harness';
import { parseAuditObjectName } from '../../functions/api/_admin-store';

const url = process.env.CREDIT_PG_URL;
const isLocal = url && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname);
const bin = findPostgrest();
const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(path.resolve(here, p), 'utf8');
const LIVE = read('fixtures/live-nxfh-payment-schema.sql');
const P = read('../../supabase/migrations/20261110004740_preserve_monthly_renewal.sql');
const D_PATH = path.resolve(here, '../../supabase/migrations_pending_approval/access_codes_one_redemption_per_reference.sql');
const G = read('../../supabase/migrations_pending_approval/payments_service_role_review_update.sql');
const E = read('../../supabase/migrations_pending_approval/paid_sessions_early_renewal_keeps_credits.sql');
const CREDITS = read('../../supabase/migrations_pending_approval/paid_credit_reservation_functions.sql');
const LIVE_FINGERPRINT = 'ca9f13a85933345f0dfede3b1ab2975e';
const DAY = 86400000;
const PRICES: Record<string, number> = { Basic: 19.99, Premium: 49.99, Pro: 149 };

const env = { FIREBASE_PROJECT_ID: 'p', SESSION_SECRET: 'qualification-secret', STAGING_SUPABASE_URL: 'https://db.test',
  STAGING_SUPABASE_SERVICE_ROLE_KEY: localJwt('service_role'), PAYMENT_EMAIL: 'pay@example.test' };

type Json = Record<string, any>;

function setup(h: () => Harness) {
  let n = 0; let uid = ''; let email = '';
  const customer = () => { n++; uid = `uid-q-${n}-${Date.now().toString(36)}`; email = `q${n}.${Date.now().toString(36)}@example.test`; return { uid, email }; };
  const newRef = () => `PS-Q${(Date.now().toString(36) + (++n).toString(36)).toUpperCase().slice(-8)}`;
  const order = async (plan = 'Premium', status = 'pending') => {
    const ref = newRef();
    await h().q(`insert into public.payments (plan, amount, reference_number, status, notes, firebase_uid, user_role) values ($1,$2,$3,$4,$5,$6,'parent')`,
      [plan, PRICES[plan], ref, status, `email:${email};uid:${uid}`, uid]);
    return ref;
  };
  const req = (u: string, body?: unknown, ip = `10.9.${n % 250}.${Math.floor(Math.random() * 250)}`) => new Request(u, {
    method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip },
    body: body === undefined ? undefined : JSON.stringify(body) });
  const out = async (r: Response) => ({ status: r.status, body: await r.json().catch(() => null) as Json });
  const claim = async (ref: string) => out(await claimHandler({ request: req('https://x/api/claim-purchase', { referenceNumber: ref }), env } as never));
  const myPayments = async () => out(await myPaymentsHandler({ request: req('https://x/api/my-payments'), env } as never));
  const activate = async (code: string) => out(await activateHandler({ request: req('https://x/api/activate-code', { code, email }), env } as never));
  let adminN = 0;
  const admin = async (route: string, body: Json) => out(await handleAdminRequest(
    new Request(`https://cyfsanavigator.com/api/admin/${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    env as never, { requireAdmin: (async () => ({ admin: { email: 'ops@example.test', uid: `admin-${++adminN}` } })) as never, fetcher: h().fetch as never }));
  const approve = (ref: string, plan = 'Premium') => admin('payments/approve', { referenceNumber: ref, amountReceived: PRICES[plan] });
  const reissue = (ref: string) => admin('payments/reissue-code', { referenceNumber: ref, reason: 'customer lost the code' });
  const refund = (ref: string) => admin('payments/refund', { referenceNumber: ref, reason: 'customer requested a refund' });
  const restore = (sessionId: string) => admin('credits/restore', { sessionId, credits: 1, reason: 'restore a used credit' });
  const sessions = () => h().q<{ id: string; tier: string; expires_at: Date; revoked_at: Date | null }>(
    'select id, tier, expires_at, revoked_at from public.navigator_paid_sessions where firebase_uid = $1 order by issued_at', [uid]);
  const live = async () => (await sessions()).filter((s) => !s.revoked_at && s.expires_at.getTime() > Date.now());
  const codes = (ref: string) => h().q<{ used_at: Date | null; expires_at: Date | null }>(
    'select used_at, expires_at from public.access_codes where reference_number = $1 order by created_at', [ref]);
  const usedCodes = async (ref: string) => (await codes(ref)).filter((c) => c.used_at).length;
  const redeemableCodes = async (ref: string) => (await codes(ref)).filter((c) => !c.used_at && (!c.expires_at || c.expires_at.getTime() > Date.now())).length;
  const days = (d: Date | string) => Math.round((new Date(d).getTime() - Date.now()) / DAY);
  /** No account may hold two live entitlements of the same tier (overlapping quotas). */
  const noOverlap = async () => {
    const byTier = new Map<string, number>();
    for (const s of await live()) byTier.set(s.tier, (byTier.get(s.tier) ?? 0) + 1);
    for (const [, count] of byTier) expect(count).toBe(1);
  };
  /** Pauses the first request matching `match` (before or after it reaches PostgREST) until `release()` is called. */
  const gate = (match: (hop: Hop) => boolean, phase: 'before' | 'after' = 'before') => {
    let release!: () => void; let reached!: () => void; let armed = true;
    const opened = new Promise<void>((r) => { release = r; });
    const hit = new Promise<void>((r) => { reached = r; });
    h().hooks.push(async (hop, p) => { if (armed && p === phase && match(hop)) { armed = false; reached(); await opened; } });
    return { release, reached: hit };
  };
  /** Makes the first matching request fail like a dropped connection (TypeError, as fetch does). */
  const cut = (match: (hop: Hop) => boolean, phase: 'before' | 'after') => {
    let armed = true;
    h().hooks.push((hop, p) => { if (armed && p === phase && match(hop)) { armed = false; throw new TypeError('fetch failed: connection reset'); } });
  };
  beforeEach(() => {
    customer();
    vi.stubGlobal('fetch', h().fetch);
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockImplementation(async () => ({ status: 'verified', uid, email, emailVerified: true }) as never);
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => { h().hooks = []; h().storageDown = 0; vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  return { order, claim, myPayments, activate, approve, reissue, refund, restore, sessions, live, codes, usedCodes, redeemableCodes, days, noOverlap, gate, cut, customer, who: () => ({ uid, email }) };
}

const enabled = !!isLocal && !!bin;
const tag = `${process.pid}_${Date.now()}`;

describe.skipIf(!enabled)('pre-P: the live nxfh payment schema today (no redeemed_session_id, live redeem function)', () => {
  const h = new Harness(url!, `payq_live_${tag}`, bin!);
  beforeAll(async () => { await h.start([LIVE]); });
  afterAll(async () => { await h.stop(); });
  const t = setup(() => h);

  it('the baseline reproduces the live fingerprint and the missing column', async () => {
    expect((await h.q<{ fp: string }>("select md5(prosrc) as fp from pg_proc where proname = 'redeem_access_code_atomic'"))[0].fp).toBe(LIVE_FINGERPRINT);
    expect(await h.q("select 1 from information_schema.columns where table_name = 'access_codes' and column_name = 'redeemed_session_id'")).toHaveLength(0);
  });

  it('with the exact live grants an administrator approval is refused by the database (G), and nothing is issued', async () => {
    const ref = await t.order();
    const res = await t.approve(ref);
    expect([res.status, res.body.code]).toEqual([502, 'ADMIN_STORE_REJECTED']);
    expect((await h.q('select status from public.payments where reference_number = $1', [ref]))[0].status).toBe('pending');
    expect(await t.codes(ref)).toHaveLength(0);
    // Migration G grants UPDATE (status, approved_at) only; the remaining pre-P scenarios run with it.
    await h.migrate(G, 'payments?select=id&limit=1');
    const again = await t.approve(ref);
    expect(again.status).toBe(200);
    expect(again.body.accessCode).toMatch(/^[A-Z0-9]{4}-/);
  });

  it('G is least privilege: service_role may update only status and approved_at; anon, authenticated and DELETE stay refused', async () => {
    const cols = await h.q<{ column_name: string; upd: boolean }>(
      "select column_name, has_column_privilege('service_role', 'public.payments', column_name, 'UPDATE') as upd from information_schema.columns where table_schema = 'public' and table_name = 'payments'");
    expect(cols.filter((c) => c.upd).map((c) => c.column_name).sort()).toEqual(['approved_at', 'status']);
    for (const role of ['anon', 'authenticated']) {
      const r = await h.q<{ any_update: boolean; del: boolean; sel: boolean; ins: boolean }>(
        `select bool_or(has_column_privilege($1, 'public.payments', column_name, 'UPDATE')) as any_update, has_table_privilege($1, 'public.payments', 'DELETE') as del,
                has_table_privilege($1, 'public.payments', 'SELECT') as sel, has_table_privilege($1, 'public.payments', 'INSERT') as ins
           from information_schema.columns where table_schema = 'public' and table_name = 'payments'`, [role]);
      expect(r[0]).toEqual({ any_update: false, del: false, sel: false, ins: false });
    }
    expect((await h.q<{ t: boolean }>("select has_table_privilege('service_role', 'public.payments', 'DELETE') as t"))[0].t).toBe(false);
    const ref = await t.order();
    const rest = (role: string, method: string, query: string, body?: Json) => h.fetch(`https://db.test/rest/v1/payments?reference_number=eq.${ref}${query}`, {
      method, headers: { Authorization: `Bearer ${localJwt(role)}`, 'content-type': 'application/json', Prefer: 'return=representation' },
      body: body ? JSON.stringify(body) : undefined });
    for (const role of ['anon', 'authenticated']) {
      expect((await rest(role, 'PATCH', '', { status: 'approved' })).status).toBeGreaterThanOrEqual(400);
      expect((await rest(role, 'DELETE', '')).status).toBeGreaterThanOrEqual(400);
    }
    expect((await rest('service_role', 'PATCH', '', { amount: 0.01 })).status).toBeGreaterThanOrEqual(400);
    expect((await rest('service_role', 'PATCH', '', { plan: 'Pro' })).status).toBeGreaterThanOrEqual(400);
    expect((await rest('service_role', 'PATCH', '', { firebase_uid: 'someone-else' })).status).toBeGreaterThanOrEqual(400);
    expect((await rest('service_role', 'DELETE', '')).status).toBeGreaterThanOrEqual(400);
    const row = (await h.q<{ status: string; amount: string; plan: string; firebase_uid: string }>(
      'select status, amount::text, plan, firebase_uid from public.payments where reference_number = $1', [ref]))[0];
    expect(row).toEqual({ status: 'pending', amount: '49.99', plan: 'Premium', firebase_uid: t.who().uid });
    // A customer's own routes cannot approve: claim refuses a pending order and leaves it pending.
    expect((await t.claim(ref)).status).not.toBe(200);
    expect((await h.q<{ status: string }>('select status from public.payments where reference_number = $1', [ref]))[0].status).toBe('pending');
    expect(await t.codes(ref)).toHaveLength(0);
  });

  it('claim-purchase fails closed (503, activation temporarily unavailable), never 500, and writes nothing', async () => {
    const ref = await t.order('Premium', 'approved');
    const res = await t.claim(ref);
    expect(res.status).toBe(503);
    expect(res.body.code).toBe('ACTIVATION_UNAVAILABLE');
    expect(res.body.error).toMatch(/activation is temporarily unavailable/i);
    expect(await t.codes(ref)).toHaveLength(0);
    expect(await t.sessions()).toHaveLength(0);
  });

  it('approve -> code -> activate-code gives one entitlement; claim, a repeat and reissue add none; My Orders lists the order without accessActive', async () => {
    const ref = await t.order();
    const code = (await t.approve(ref)).body.accessCode as string;
    const first = await t.activate(code);
    expect(first.status).toBe(200);
    expect((await t.activate(code)).status).toBe(200); // same account, same code: the existing entitlement
    expect((await t.claim(ref)).status).toBe(503);
    expect((await t.reissue(ref)).body.code).toBe('CODE_ALREADY_REDEEMED');
    expect(await t.live()).toHaveLength(1);
    expect(await t.usedCodes(ref)).toBe(1);
    const mine = await t.myPayments();
    expect(mine.status).toBe(200);
    const o = mine.body.orders.find((x: Json) => x.referenceNumber === ref);
    expect(o.state).toBe('activated');
    expect(o).not.toHaveProperty('accessActive');
    expect(mine.body.entitlements).toHaveLength(1);
  });

  it('My Orders lists pending and ready orders with payment instructions', async () => {
    const pending = await t.order('Basic');
    const ready = await t.order('Premium', 'approved');
    const mine = await t.myPayments();
    expect(mine.status).toBe(200);
    const states = Object.fromEntries(mine.body.orders.map((o: Json) => [o.referenceNumber, o.state]));
    expect(states).toEqual({ [pending]: 'awaiting_verification', [ready]: 'ready_to_activate' });
    expect(mine.body.orders.find((o: Json) => o.referenceNumber === pending).instructions).toBeTruthy();
  });

  it('reissue before redemption replaces the code: the old one stops working, the new one activates once', async () => {
    const ref = await t.order();
    const old = (await t.approve(ref)).body.accessCode as string;
    const re = await t.reissue(ref);
    expect(re.status).toBe(200);
    expect((await t.activate(old)).status).not.toBe(200);
    expect((await t.activate(re.body.accessCode)).status).toBe(200);
    expect(await t.live()).toHaveLength(1);
  });

  it('refund of an activated order revokes its entitlement (no renewal link exists before P)', async () => {
    const ref = await t.order();
    expect((await t.activate((await t.approve(ref)).body.accessCode)).status).toBe(200);
    const res = await t.refund(ref);
    expect(res.status).toBe(200);
    expect(res.body.sessionsRevoked).toBe(1);
    expect(await t.live()).toHaveLength(0);
    expect((await t.claim(ref)).status).toBe(409);
  });

  it('refund of an unpaid order cancels it (G) and retires its code', async () => {
    const ref = await t.order();
    const res = await t.refund(ref);
    expect(res.status).toBe(200);
    expect(res.body.paymentRejected).toBe(true);
  });

  it('D-2 as deployed: a monthly renewal mints a second, overlapping entitlement (why P is required)', async () => {
    const a = await t.order('Pro'); const b = await t.order('Pro');
    expect((await t.activate((await t.approve(a, 'Pro')).body.accessCode)).status).toBe(200);
    expect((await t.activate((await t.approve(b, 'Pro')).body.accessCode)).status).toBe(200);
    expect(await t.live()).toHaveLength(2);
  });
});

const variants = [{ name: 'P', d: false }, ...(existsSync(D_PATH) ? [{ name: 'P + D', d: true }] : [])];

describe.skipIf(!enabled).each(variants)('post-$name: one activation per approved payment through the real handlers', ({ d }) => {
  const h = new Harness(url!, `payq_${d ? 'pd' : 'p'}_${tag}`, bin!);
  beforeAll(async () => {
    await h.start([LIVE, G]);
    await h.migrate(P, 'access_codes?select=redeemed_session_id&limit=1');
    if (d) await h.migrate(readFileSync(D_PATH, 'utf8'), 'access_codes?select=id&limit=1');
  });
  afterAll(async () => { await h.stop(); });
  const t = setup(() => h);
  const isCodePost = (hop: Hop) => hop.method === 'POST' && hop.target === 'access_codes';
  const isRpc = (hop: Hop) => hop.target === 'rpc/redeem_access_code_atomic';

  it('5 concurrent claims: exactly one activation; every later claim restores the same entitlement', async () => {
    const ref = await t.order('Premium', 'approved');
    const all = await Promise.all(Array.from({ length: 5 }, () => t.claim(ref)));
    expect(all.filter((r) => r.status === 200 && !r.body.restored)).toHaveLength(1);
    for (const r of all.filter((x) => x.status !== 200)) expect([r.status, r.body.code]).toEqual([409, 'ACTIVATION_IN_PROGRESS']);
    h.nextMinute();
    const again = await t.claim(ref);
    expect([again.status, again.body.restored]).toEqual([200, true]);
    expect(await t.usedCodes(ref)).toBe(1);
    expect(await t.live()).toHaveLength(1);
    const mine = await t.myPayments();
    expect(mine.body.orders[0]).toMatchObject({ referenceNumber: ref, state: 'activated', accessActive: true });
  });

  it(d ? 'two live codes of one payment redeemed in parallel: D refuses the second' : 'two live codes of one payment redeemed in parallel: both activate without D (S-34 at the database)', async () => {
    const ref = await t.order('Premium', 'approved');
    const { email } = t.who();
    const mk = (c: string) => h.q(`insert into public.access_codes (tier, code_hash, email, reference_number, amount, expires_at)
      values ('Premium', encode(sha256(convert_to($1, 'UTF8')), 'hex'), $2, $3, 49.99, now() + interval '1 day')`, [c, email, ref]);
    await mk('AAAA-BBBB-CCCC'); await mk('DDDD-EEEE-FFFF');
    const rs = await Promise.all([t.activate('AAAA-BBBB-CCCC'), t.activate('DDDD-EEEE-FFFF')]);
    for (const r of rs) expect(r.status).not.toBe(500);
    overlapExpected = !d;
    expect(await t.usedCodes(ref)).toBe(d ? 1 : 2);
    expect(await t.live()).toHaveLength(d ? 1 : 2);
    if (d) {
      await expect(h.q(`update public.access_codes set used_at = now() where reference_number = $1 and used_at is null`, [ref]))
        .rejects.toThrow(/access_codes_one_redemption_per_reference/);
    }
  });

  it('approve versus claim: the customer activates while approval is issuing its code; the approval code is withheld', async () => {
    const ref = await t.order();
    const g = gateFor(isCodePost);
    const approving = t.approve(ref);
    await g.reached; // payment is approved, the approval code is not inserted yet
    const claimed = await t.claim(ref);
    expect(claimed.status).toBe(200);
    g.release();
    const approved = await approving;
    expect(approved.status).toBe(200);
    expect(approved.body.accessCode).toBeNull();
    expect(approved.body.alreadyActivated).toBe(true);
    expect(await t.redeemableCodes(ref)).toBe(0);
    expect(await t.usedCodes(ref)).toBe(1);
    expect(await t.live()).toHaveLength(1);
  });

  it('approve then claim: the claim retires the e-mailed approval code, which then gives nothing', async () => {
    const ref = await t.order();
    const code = (await t.approve(ref)).body.accessCode as string;
    expect((await t.claim(ref)).status).toBe(200);
    // Without D the retired code is refused as expired; with D the same account is shown its existing entitlement.
    await t.activate(code);
    expect(await t.usedCodes(ref)).toBe(1);
    expect(await t.live()).toHaveLength(1);
  });

  it('interrupted after the code insert: 503, then the retry activates exactly once', async () => {
    const ref = await t.order('Premium', 'approved');
    t.cut(isCodePost, 'after');
    expect((await t.claim(ref)).status).toBe(503);
    expect(await t.sessions()).toHaveLength(0);
    expect(await t.redeemableCodes(ref)).toBe(1);
    h.nextMinute();
    expect((await t.claim(ref)).status).toBe(200);
    expect(await t.usedCodes(ref)).toBe(1);
    expect(await t.live()).toHaveLength(1);
  });

  it('interrupted after the RPC committed (response lost): 503, then the retry restores the same entitlement', async () => {
    const ref = await t.order('Premium', 'approved');
    t.cut(isRpc, 'after');
    expect((await t.claim(ref)).status).toBe(503);
    const [s] = await t.live();
    h.nextMinute();
    const retry = await t.claim(ref);
    expect([retry.status, retry.body.restored]).toEqual([200, true]);
    expect(await t.live()).toEqual([s]);
  });

  it('interrupted before the refund-history check (audit unreadable): 503 with the code kept, then the retry activates once', async () => {
    const ref = await t.order('Premium', 'approved');
    h.hooks.push((hop, p) => { if (p === 'after' && isCodePost(hop)) h.storageDown = 1; });
    expect((await t.claim(ref)).status).toBe(503);
    expect(await t.sessions()).toHaveLength(0);
    h.hooks = [];
    h.nextMinute();
    expect((await t.claim(ref)).status).toBe(200);
    expect(await t.usedCodes(ref)).toBe(1);
    expect(await t.live()).toHaveLength(1);
  });

  it('refund versus reissue: a code reissued while the refund runs never activates the refunded order', async () => {
    const ref = await t.order();
    await t.approve(ref);
    const g = gateFor(isCodePost);
    const reissuing = t.reissue(ref);
    await g.reached; // reissue passed its refund check and retired the old code; its new code is not inserted yet
    expect((await t.refund(ref)).status).toBe(200);
    g.release();
    const re = await reissuing;
    if (re.status === 200) expect((await t.activate(re.body.accessCode)).status).not.toBe(200);
    expect(await t.redeemableCodes(ref)).toBe(0);
    expect((await t.claim(ref)).body.code).toBe('ORDER_CLOSED');
    expect(await t.live()).toHaveLength(0);
  });

  it('approve versus refund of a pending order: a refund that lands while approval issues its code leaves no working code or access', async () => {
    const ref = await t.order();
    const g = gateFor(isCodePost);
    const approving = t.approve(ref);
    await g.reached; // approval moved the payment to approved; its code is not inserted yet
    const r = await t.refund(ref);
    expect(r.status).toBe(200);
    g.release();
    const a = await approving;
    expect([a.status, a.body.code]).toEqual([409, 'PAYMENT_REFUNDED']);
    expect([...h.audit.keys()].map(parseAuditObjectName).filter((x) => x?.action === 'approve' && x.target === ref)).toHaveLength(1);
    expect(await t.redeemableCodes(ref)).toBe(0);
    expect((await t.claim(ref)).body.code).toBe('ORDER_CLOSED');
    expect(await t.live()).toHaveLength(0);
  });

  it('approve versus refund of a pending order: an approval that lands while the refund runs is cancelled with it', async () => {
    const ref = await t.order();
    const g = gateFor((hop) => hop.method === 'PATCH' && hop.target === 'payments');
    const refunding = t.refund(ref);
    await g.reached; // the refund is recorded and read the payment as pending; it has not cancelled it yet
    const a = await t.approve(ref);
    expect(a.status).not.toBe(500);
    g.release();
    expect((await refunding).status).toBe(200);
    if (a.body?.accessCode) expect((await t.activate(a.body.accessCode)).status).not.toBe(200);
    expect(await t.redeemableCodes(ref)).toBe(0);
    expect((await t.claim(ref)).body.code).toBe('ORDER_CLOSED');
    expect(await t.live()).toHaveLength(0);
  });

  it('a monthly renewal (new verified payment) extends the one entitlement by 30 days; refunding it takes the 30 days back', async () => {
    const a = await t.order('Pro'); const b = await t.order('Pro');
    await t.approve(a, 'Pro'); await t.approve(b, 'Pro');
    expect((await t.claim(a)).status).toBe(200);
    h.nextMinute();
    expect((await t.claim(b)).status).toBe(200);
    const [s] = await t.live();
    expect(await t.live()).toHaveLength(1);
    expect(t.days(s.expires_at)).toBe(60);
    const mine = await t.myPayments();
    for (const o of mine.body.orders) expect(o).toMatchObject({ state: 'activated', accessActive: true });
    const r = await t.refund(b);
    expect([r.status, r.body.sessionsShortened, r.body.sessionsRevoked]).toEqual([200, 1, 0]);
    const [after] = await t.live();
    expect(after.id).toBe(s.id);
    expect(t.days(after.expires_at)).toBe(30);
  });

  let overlapExpected = false;
  afterEach(async () => { if (!overlapExpected) await t.noOverlap(); overlapExpected = false; });

  function gateFor(match: (hop: Hop) => boolean) { return t.gate(match); }
});

describe.skipIf(!enabled)('Migration E through PostgREST and the payment handlers', () => {
  const h = new Harness(url!, `payq_e_${tag}`, bin!);
  beforeAll(async () => {
    await h.start([LIVE, G, P, readFileSync(D_PATH, 'utf8'), `
      create table public.free_usage (
        uid text primary key, email text, analyses_used integer not null default 0,
        first_analysis_at timestamptz, last_analysis_at timestamptz
      );
      alter table public.free_usage enable row level security;
      grant select, insert, update on public.free_usage to service_role;
    `, CREDITS, E]);
  });
  afterAll(async () => { await h.stop(); });
  const t = setup(() => h);
  it('accounts for a paid renewal and its refund once with real service-role grants', async () => {
    const a = await t.order(); const b = await t.order();
    const first = await t.approve(a);
    expect(first.status).toBe(200);
    expect((await t.activate(first.body.accessCode)).status).toBe(200);
    const renewal = await t.approve(b);
    expect(renewal.status).toBe(200);
    expect((await t.activate(renewal.body.accessCode)).status).toBe(200);
    const [session] = await t.live();
    expect(t.days(session.expires_at)).toBe(60);
    expect(await h.q('select granted_credits from public.navigator_paid_sessions where id = $1', [session.id]))
      .toEqual([{ granted_credits: 10 }]);
    const result = await t.refund(b);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ sessionsShortened: 1, sessionsRevoked: 0, shorteningsForReview: 0 });
    expect((await t.refund(b)).body.code).toBe('ALREADY_REFUNDED');
    expect(t.days((await t.live())[0].expires_at)).toBe(30);
    expect(await h.q('select granted_before, granted_after from public.navigator_paid_session_refunds where session_id = $1', [session.id]))
      .toEqual([{ granted_before: 10, granted_after: 5 }]);
    await t.noOverlap();
  });

  it('reproduces the approval/refund race: approval can issue a live code after refund has finished', async () => {
    const ref = await t.order();
    const gate = t.gate((hop) => hop.method === 'POST' && hop.target === 'access_codes');
    const approving = t.approve(ref);
    await gate.reached;
    try {
      const refund = await t.refund(ref);
      expect(refund.status).toBe(200);
      expect(refund.body).toMatchObject({ codesExpired: 0, sessionsRevoked: 0 });
    } finally {
      gate.release();
    }
    const approval = await approving;
    expect(approval.status).toBe(200);
    expect(await t.redeemableCodes(ref)).toBe(1);
    expect((await t.claim(ref)).body.code).toBe('ORDER_CLOSED');
    expect((await t.activate(approval.body.accessCode)).status).toBe(200);
    expect(await t.live()).toHaveLength(1);
  });

  it('reproduces a manual restore racing a new reserve: a finalized analysis can be left uncharged', async () => {
    const ref = await t.order();
    expect((await t.activate((await t.approve(ref)).body.accessCode)).status).toBe(200);
    const [session] = await t.live();
    const gate = t.gate((hop) => hop.method === 'GET' && hop.target === 'free_usage' && hop.search.get('email')?.startsWith('like.') === true, 'after');
    const restoring = t.restore(session.id);
    await gate.reached;
    try {
      const [reservation] = await h.q<{ status: string }>(
        "select public.paid_reserve_credit($1,'new-request','total',5,now(),'15 minutes','60 seconds')->>'status' as status", [session.id]);
      expect(reservation.status).toBe('reserved');
    } finally {
      gate.release();
    }
    const result = await restoring;
    expect(result.status).toBe(200);
    expect(result.body.creditsRestored).toBe(1);
    expect(await h.q("select public.paid_finalize_credit($1,'new-request',now())->>'status' as status", [session.id]))
      .toEqual([{ status: 'consumed' }]);
    expect(await h.q('select analyses_used from public.free_usage where uid = $1', [`paid_session_${session.id}_total`]))
      .toEqual([{ analyses_used: 0 }]);
  });
});
