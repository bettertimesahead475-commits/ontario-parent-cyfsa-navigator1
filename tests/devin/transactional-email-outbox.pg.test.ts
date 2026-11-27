import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as authCheck from '../../functions/api/_auth-check';
import { handleAdminRequest } from '../../functions/api/admin/[[path]]';
import { enqueueTransactionalEmail, MAX_ATTEMPTS, OUTBOX_TABLE, processOutbox, retryDelayMs } from '../../functions/api/_email-outbox';
import { MailerError } from '../../functions/api/_mailer';
import { onRequestPost as requestAccess } from '../../functions/api/request-access';
import { findPostgrest, Harness, localJwt } from './helpers/postgrest-harness';

const url = process.env.CREDIT_PG_URL;
const bin = findPostgrest();
const read = (file: string) => readFileSync(new URL(file, import.meta.url), 'utf8');
const sql = (suffix: string) => read(`../../supabase/migrations_pending_approval/create_transactional_email_outbox${suffix}.sql`);
const env = {
  STAGING_SUPABASE_URL: 'https://db.test',
  STAGING_SUPABASE_SERVICE_ROLE_KEY: localJwt('service_role'),
  TRANSACTIONAL_EMAIL_ENABLED: 'true',
  TRANSACTIONAL_EMAIL_ALLOWLIST: '@example.test',
  PAYMENT_EMAIL: 'pay@example.test',
};
const recipient = 'parent@example.test';
const item = { kind: 'refund_confirmation', dedupeKey: 'synthetic-refund', email: recipient, data: {} } as const;
const due = () => new Date(Date.now() + 1_000);
const contents = `select row_to_json(o) as row from ${OUTBOX_TABLE} o order by id`;
let h: Harness;

async function applyOutbox() {
  await h.pool.query(sql(''));
  for (let attempt = 0; attempt < 100; attempt++) {
    await h.q("notify pgrst, 'reload schema'");
    // A GET can see a newly created table before PostgREST's mutation planner has cached its columns.
    const response = await h.fetch(`${env.STAGING_SUPABASE_URL}/rest/v1/${OUTBOX_TABLE}`, {
      method: 'OPTIONS',
      headers: { Authorization: `Bearer ${env.STAGING_SUPABASE_SERVICE_ROLE_KEY}` },
    });
    const allowed = response.headers.get('Allow')?.split(',');
    if (response.ok && allowed?.includes('POST') && allowed.includes('PATCH')) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('PostgREST schema cache is not ready for outbox mutations');
}

async function waitForLocks(command: 'INSERT' | 'UPDATE', count: number) {
  for (let attempt = 0; attempt < 100; attempt++) {
    const [{ total }] = await h.q<{ total: number }>(
      "select count(*)::int as total from pg_stat_activity where datname = current_database() and wait_event_type = 'Lock' and query ilike $1",
      [`%${command}%transactional_email_outbox%`],
    );
    if (total >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(`Did not observe ${count} concurrent ${command} lock waits`);
}

describe.skipIf(!url || !bin)('F transactional email outbox with PostgreSQL and PostgREST', () => {
  beforeAll(async () => {
    if (!url || !bin || !['localhost', '127.0.0.1'].includes(new URL(url).hostname) ||
        [...new URL(url).searchParams.keys()].some((key) => key !== 'sslmode')) {
      throw new Error('Migration F requires a disposable loopback PostgreSQL URL');
    }
    h = new Harness(url, `outbox_f_${process.pid}_${Date.now()}`, bin);
    await h.start([
      read('./fixtures/live-nxfh-payment-schema.sql'),
      "create schema auth; create function auth.uid() returns uuid language sql stable as 'select null::uuid'",
      "insert into navigator_paid_sessions (firebase_uid, email, tier, expires_at) values ('synthetic-existing', 'existing@example.test', 'Basic', now() + interval '90 days')",
    ]);
  }, 30_000);
  afterAll(() => h?.stop());
  afterEach(() => {
    h.hooks = [];
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('runs read-only preflight, preserves existing records, and supports the pre-F checkout contract with the flag off', async () => {
    const preflight = (await h.pool.query(sql('.preflight')))[1].rows[0];
    expect(preflight).toMatchObject({ outbox_exists: false, gen_random_uuid_available: true, payments_exists: true,
      paid_sessions_exists: true, paid_sessions_has_email: true, supabase_roles_found: '3' });
    const entitlement = await h.q("select * from navigator_paid_sessions where firebase_uid = 'synthetic-existing'");
    const paymentContract = async (uid: string) => {
      vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue({ status: 'verified', uid, email: recipient, emailVerified: true } as never);
      vi.stubGlobal('fetch', h.fetch);
      const res = await requestAccess({ request: new Request('https://app.test/api/request-access', {
        method: 'POST', body: JSON.stringify({ tier: 'Basic', requestKey: 'synthetic-compat' }),
      }), env: { ...env, TRANSACTIONAL_EMAIL_ENABLED: 'false' } });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ reused: false, payTo: env.PAYMENT_EMAIL });
    };
    await paymentContract('synthetic-before');
    const priorPayments = await h.q("select * from payments where firebase_uid = 'synthetic-before'");
    await applyOutbox();
    await paymentContract('synthetic-after');
    expect(await h.q("select * from payments where firebase_uid = 'synthetic-before'")).toEqual(priorPayments);
    expect(await h.q("select * from navigator_paid_sessions where firebase_uid = 'synthetic-existing'")).toEqual(entitlement);
    expect(await h.q(contents)).toEqual([]);
  });

  it('enforces indexes, data constraints and browser isolation through SQL and HTTP', async () => {
    await h.pool.query(sql('.test').replace(/^\\set.*$/m, ''));
    expect(await h.q("select relrowsecurity from pg_class where oid = 'public.transactional_email_outbox'::regclass")).toEqual([{ relrowsecurity: true }]);
    expect(await h.q("select pg_get_expr(indpred, indrelid) as predicate, indisvalid from pg_index where indexrelid = 'public.transactional_email_outbox_due'::regclass"))
      .toEqual([{ predicate: "(status = 'pending'::text)", indisvalid: true }]);
    for (const role of ['anon', 'authenticated']) {
      for (const method of ['GET', 'POST', 'PATCH', 'DELETE']) {
        const headers = { Authorization: `Bearer ${localJwt(role)}`, 'Content-Type': 'application/json' };
        const response = await h.fetch(`https://db.test/rest/v1/${OUTBOX_TABLE}?status=eq.pending`, {
          method, headers, body: method === 'POST' || method === 'PATCH' ? JSON.stringify({ recipient_email: recipient }) : undefined,
        });
        if (response.ok) {
          expect(method).toBe('GET');
          expect(await response.json()).toEqual([]);
        } else expect([401, 403, 404]).toContain(response.status);
      }
    }
    const response = await handleAdminRequest(new Request('https://app.test/api/admin/email-outbox'), { ...env, FIREBASE_PROJECT_ID: 'synthetic' }, { fetcher: h.fetch });
    expect(response.status).toBe(401);
    await h.q(`truncate table ${OUTBOX_TABLE}`);
  });

  it('deduplicates an enqueue racing another transaction and leaves the original payload intact', async () => {
    const tx = await h.pool.connect();
    let enqueue: Promise<boolean> | undefined;
    try {
      await tx.query('begin');
      await tx.query(`insert into ${OUTBOX_TABLE} (kind, dedupe_key, recipient_email) values ($1,$2,$3)`,
        [item.kind, item.dedupeKey, recipient]);
      enqueue = enqueueTransactionalEmail(env, { ...item, email: 'duplicate@example.test' }, h.fetch);
      await waitForLocks('INSERT', 1);
      await tx.query('commit');
      expect(await enqueue).toBe(true);
      expect(await h.q(`select recipient_email, attempts from ${OUTBOX_TABLE}`)).toEqual([{ recipient_email: recipient, attempts: 0 }]);
    } finally {
      await tx.query('rollback');
      tx.release();
      await enqueue;
    }
  });

  it('allows exactly one sender when two real PostgREST claims contend for the same row', async () => {
    const tx = await h.pool.connect();
    const send = vi.fn().mockResolvedValue({ id: 'synthetic-provider-id' });
    let workers: Promise<Awaited<ReturnType<typeof processOutbox>>[]> | undefined;
    try {
      await tx.query('begin');
      await tx.query(`select id from ${OUTBOX_TABLE} where dedupe_key = $1 for update`, [item.dedupeKey]);
      const now = due();
      workers = Promise.all([processOutbox(env, { send }, h.fetch, now), processOutbox(env, { send }, h.fetch, now)]);
      await waitForLocks('UPDATE', 2);
      await tx.query('commit');
      expect((await workers).map((r) => r.sent).sort()).toEqual([0, 1]);
      expect(send).toHaveBeenCalledTimes(1);
      expect(await h.q(`select status, attempts, locked_at from ${OUTBOX_TABLE}`)).toEqual([{ status: 'sent', attempts: 1, locked_at: null }]);
    } finally {
      await tx.query('rollback');
      tx.release();
      await workers;
    }
  });

  it('rolls back a disconnected claim, retries a definite failure, and ends at the attempt cap', async () => {
    expect(await enqueueTransactionalEmail(env, { ...item, dedupeKey: 'retry' }, h.fetch)).toBe(true);
    const tx = await h.pool.connect();
    try {
      await tx.query('begin');
      await tx.query(`update ${OUTBOX_TABLE} set status='sending', locked_at=now(), attempts=1 where dedupe_key='retry'`);
    } finally {
      tx.release(true);
    }
    const send = vi.fn().mockRejectedValue(new MailerError('OAUTH_UNREACHABLE', true));
    let now = due();
    for (let n = 1; n <= MAX_ATTEMPTS; n++) {
      expect(await processOutbox(env, { send }, h.fetch, now)).toMatchObject(n < MAX_ATTEMPTS ? { retrying: 1 } : { failed: 1 });
      const next = new Date(now.getTime() + retryDelayMs(n));
      expect(await h.q(`select attempts, status, locked_at, next_attempt_at from ${OUTBOX_TABLE} where dedupe_key='retry'`))
        .toMatchObject([{ attempts: n, locked_at: null, ...(n < MAX_ATTEMPTS ? { status: 'pending', next_attempt_at: next } : { status: 'failed' }) }]);
      expect(await processOutbox(env, { send }, h.fetch, new Date(next.getTime() - 1))).toMatchObject({ sent: 0, retrying: 0, failed: 0 });
      now = next;
    }
    expect(send).toHaveBeenCalledTimes(MAX_ATTEMPTS);
  });

  it('retains a committed interrupted claim as unknown, clears its sealed payload, and never resends it', async () => {
    expect(await enqueueTransactionalEmail(env, { ...item, dedupeKey: 'interrupted' }, h.fetch)).toBe(true);
    const send = vi.fn().mockResolvedValue({ id: 'accepted-but-not-recorded' });
    const now = due();
    h.hooks.push((hop, phase) => {
      if (phase === 'before' && hop.method === 'PATCH' && (hop.body as { status?: string }).status === 'sent') throw new TypeError('connection lost');
    });
    await expect(processOutbox(env, { send }, h.fetch, now)).rejects.toMatchObject({ code: 'ADMIN_STORE_UNAVAILABLE' });
    expect(await h.q(`select status, attempts from ${OUTBOX_TABLE} where dedupe_key='interrupted'`)).toEqual([{ status: 'sending', attempts: 1 }]);
    await h.q(`insert into ${OUTBOX_TABLE} (kind, dedupe_key, recipient_email, secret_payload, status, locked_at, attempts)
      values ('access_code', 'sealed-stale', $1, 'synthetic-sealed-value', 'sending', $2, 1)`, [recipient, now]);
    expect(await processOutbox(env, { send }, h.fetch, new Date(now.getTime() + 16 * 60_000))).toMatchObject({ unknown: 2, sent: 0 });
    expect(await h.q(`select status, attempts, locked_at, secret_payload from ${OUTBOX_TABLE} where dedupe_key in ('interrupted', 'sealed-stale')`))
      .toEqual(Array.from({ length: 2 }, () => ({ status: 'unknown', attempts: 1, locked_at: null, secret_payload: null })));
    expect(send).toHaveBeenCalledTimes(1);
  });

  it('documents the committed-payment / missing-email gap: keyed retry returns the original payment without backfilling', async () => {
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue({ status: 'verified', uid: 'synthetic-enqueue-cut', email: recipient, emailVerified: true } as never);
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', h.fetch);
    h.hooks.push((hop, phase) => {
      if (phase === 'before' && hop.method === 'POST' && hop.target === OUTBOX_TABLE) throw new TypeError('connection lost');
    });
    const checkout = () => requestAccess({ request: new Request('https://app.test/api/request-access', {
      method: 'POST', body: JSON.stringify({ tier: 'Basic', requestKey: 'synthetic-enqueue-cut' }),
    }), env });
    const first = await checkout();
    expect(first.status).toBe(200);
    const { referenceNumber } = await first.json() as { referenceNumber: string };
    h.hooks = [];
    const second = await checkout();
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({ referenceNumber, reused: true });
    expect(await h.q('select status from payments where reference_number = $1', [referenceNumber])).toEqual([{ status: 'pending' }]);
    expect(await h.q(`select id from ${OUTBOX_TABLE} where dedupe_key = $1`, [referenceNumber])).toEqual([]);
  });

  it('preserves rows during reapply and demonstrates that down SQL destroys delivery evidence', async () => {
    const snapshot = await h.q(contents);
    expect(snapshot.length).toBeGreaterThan(0);
    const payments = await h.q('select * from payments order by id');
    const entitlements = await h.q('select * from navigator_paid_sessions order by id');
    await h.q('drop index public.transactional_email_outbox_due');
    await applyOutbox();
    expect(await h.q("select to_regclass('public.transactional_email_outbox_due') is not null as present")).toEqual([{ present: true }]);
    expect(await h.q(contents)).toEqual(snapshot);
    await h.pool.query(sql('.down'));
    expect(await h.q("select to_regclass('public.transactional_email_outbox') is null as absent")).toEqual([{ absent: true }]);
    await applyOutbox();
    expect(await h.q(contents)).toEqual([]);
    expect(await h.q('select * from payments order by id')).toEqual(payments);
    expect(await h.q('select * from navigator_paid_sessions order by id')).toEqual(entitlements);
  });
});
