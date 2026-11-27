import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as authCheck from '../../functions/api/_auth-check';
import { onRequestPost as activateHandler } from '../../functions/api/activate-code';
import { handleAdminRequest } from '../../functions/api/admin/[[path]]';
import { Harness, findPostgrest, localJwt } from './helpers/postgrest-harness';

const url = process.env.CREDIT_PG_URL;
const bin = findPostgrest();
const isLocal = url && ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname);
const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
const pending = (file: string) => read(`../../supabase/migrations_pending_approval/${file}.sql`);
const env = {
  FIREBASE_PROJECT_ID: 'p', SESSION_SECRET: 'qualification-secret', STAGING_SUPABASE_URL: 'https://db.test',
  STAGING_SUPABASE_SERVICE_ROLE_KEY: localJwt('service_role'), PAYMENT_EMAIL: 'pay@example.test',
};

describe.skipIf(!isLocal || !bin)('Migration E through PostgREST', () => {
  const h = new Harness(url!, `payq_e_${process.pid}_${Date.now()}`, bin!);
  const uid = 'uid-e-qualification';
  const email = 'e-qualification@example.test';
  const send = (route: string, body: unknown) => new Request(`https://cyfsanavigator.com/api/${route}`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': '10.9.1.2' }, body: JSON.stringify(body),
  });
  let adminId = 0;
  const admin = (route: string, body: unknown) => handleAdminRequest(send(`admin/${route}`, body),
    env as never, { requireAdmin: (async () => ({ admin: { email: 'ops@example.test', uid: `admin-${++adminId}` } })) as never, fetcher: h.fetch as never });
  beforeAll(async () => {
    await h.start([read('fixtures/live-nxfh-payment-schema.sql'),
      read('../../supabase/migrations/20261110004740_preserve_monthly_renewal.sql'),
      pending('access_codes_one_redemption_per_reference'), `
        grant update (status, approved_at) on public.payments to service_role;
        create table public.free_usage (
          uid text primary key, email text, analyses_used integer not null default 0,
          first_analysis_at timestamptz, last_analysis_at timestamptz
        );
        alter table public.free_usage enable row level security;
        grant select, insert, update on public.free_usage to service_role;
      `, pending('paid_credit_reservation_functions'), pending('paid_sessions_early_renewal_keeps_credits')]);
  });
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  afterAll(async () => { await h.stop(); });

  it('accounts for renewals and refunds once with real service-role grants', async () => {
    vi.stubGlobal('fetch', h.fetch);
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue({ status: 'verified', uid, email, emailVerified: true } as never);
    const refs = ['PS-EQUAL01', 'PS-EQUAL02'];
    for (const ref of refs) {
      await h.q(`insert into public.payments (plan, amount, reference_number, status, notes, firebase_uid, user_role)
        values ('Premium',49.99,$1,'pending',$2,$3,'parent')`, [ref, `email:${email};uid:${uid}`, uid]);
      const approve = await admin('payments/approve', { referenceNumber: ref, amountReceived: 49.99 });
      expect(approve.status).toBe(200);
      const activate = await activateHandler({ request: send('activate-code', { code: (await approve.json()).accessCode, email }), env } as never);
      expect(activate.status).toBe(200);
    }
    const days = (d: Date) => Math.round((d.getTime() - Date.now()) / 86400000);
    const sessions = () => h.q<{ id: string; expires_at: Date; granted_credits: number | null }>(
      'select id, expires_at, granted_credits from public.navigator_paid_sessions where firebase_uid = $1 and revoked_at is null', [uid]);
    const stacked = await sessions();
    expect(stacked).toHaveLength(1);
    expect(stacked[0].granted_credits).toBe(10);
    expect(days(stacked[0].expires_at)).toBe(60);
    const refund = () => admin('payments/refund', { referenceNumber: refs[1], reason: 'customer requested a refund' });
    const result = await refund();
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({ sessionsShortened: 1, sessionsRevoked: 0, shorteningsForReview: 0 });
    expect((await (await refund()).json()).code).toBe('ALREADY_REFUNDED');
    const after = await sessions();
    expect(after).toHaveLength(1);
    expect(after[0]).toMatchObject({ id: stacked[0].id, granted_credits: null });
    expect(days(after[0].expires_at)).toBe(30);
    expect(await h.q('select granted_before, granted_after from public.navigator_paid_session_refunds where session_id = $1', [stacked[0].id]))
      .toEqual([{ granted_before: 10, granted_after: 5 }]);
  });

  it('restores monthly usage through the service-only RPC and leaves other periods untouched', async () => {
    const session = '11111111-1111-4111-8111-111111111111';
    const now = new Date();
    const period = now.toISOString().slice(0, 10);
    const current = `paid_session_${session}_period_${period}`;
    const past = `paid_session_${session}_period_2000-01-01`;
    await h.q(`insert into public.navigator_paid_sessions (id, firebase_uid, tier, issued_at, expires_at)
      values ($1,$2,'Pro',$3,$3::timestamptz + interval '30 days')`, [session, 'uid-pro-qualification', now]);
    await h.q('insert into public.free_usage (uid, analyses_used) values ($1,2), ($2,3)', [current, past]);
    const restore = () => admin('credits/restore', { sessionId: session, credits: 1, expectedUsed: 2, reason: 'failed analysis' });
    const response = await restore();
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, creditsRestored: 1 });
    const duplicate = await restore();
    expect(duplicate.status).toBe(409);
    expect(await duplicate.json()).toMatchObject({ code: 'CONCURRENT_UPDATE' });
    expect(await h.q('select uid, analyses_used from public.free_usage where uid in ($1, $2) order by uid', [current, past]))
      .toEqual([{ uid: past, analyses_used: 3 }, { uid: current, analyses_used: 1 }]);
  });
});
