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
  TRANSACTIONAL_EMAIL_PAYLOAD_KEY: Buffer.alloc(32, 42).toString('base64'),
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

async function waitForLocks(command: 'INSERT' | 'UPDATE' | 'LOCK', count: number) {
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

  it('repairs a committed checkout on keyed retry without replaying the payment', async () => {
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
    expect(await h.q(`select id from ${OUTBOX_TABLE} where dedupe_key = $1`, [referenceNumber])).toEqual([]);
    h.hooks = [];
    for (const retry of await Promise.all([checkout(), checkout()])) {
      expect(retry.status).toBe(200);
      expect(await retry.json()).toMatchObject({ referenceNumber, reused: true });
    }
    expect(await h.q('select status from payments where reference_number = $1', [referenceNumber])).toEqual([{ status: 'pending' }]);
    expect(await h.q(`select kind from ${OUTBOX_TABLE} where dedupe_key = $1`, [referenceNumber])).toEqual([{ kind: 'payment_instructions' }]);
  });

  it('recovers interrupted checkout, approval receipt and completed refund under two concurrent drains', async () => {
    await h.q('grant update (status, approved_at) on public.payments to service_role');
    await h.q(`insert into payments (plan, amount, reference_number, status, notes) values
      ('Basic', 19.99, 'PS-APPROVE1', 'pending', $1),
      ('Basic', 19.99, 'PS-APPROVE2', 'pending', $1),
      ('Basic', 19.99, 'PS-APPROVE3', 'pending', $1),
      ('Basic', 19.99, 'PS-REFUND01', 'approved', $1),
      ('Basic', 19.99, 'PS-UNMARKED', 'pending', $1),
      ('Basic', 19.99, 'PS-DUPL0001', 'pending', $2),
      ('Basic', 19.99, 'PS-DUPL0001', 'rejected', $1)`,
      [`email:${recipient};uid:synthetic`, `email:${recipient};uid:synthetic;email-outbox:instructions-v1`]);
    await h.q("update payments set payment_email='pay@example.test' where reference_number = 'PS-DUPL0001'");
    const now = due();
    let admin = 0;
    const send = vi.fn().mockResolvedValue({ id: 'synthetic-sent' });
    const call = (route: string, body: Record<string, unknown>) => {
      const start = new Date(Date.now() - 1_000);
      let clockReads = 0;
      return handleAdminRequest(new Request(`https://app.test/api/admin/${route}`, {
        method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
      }), env, {
        fetcher: h.fetch, now: () => route !== 'email-outbox/process' ? now : clockReads++ === 0 ? start : due(), mailer: { send },
        requireAdmin: async () => ({ admin: { uid: `synthetic-admin-${++admin}`, email: 'operator@example.test' } }),
      });
    };
    h.hooks.push((hop, phase) => {
      if (phase === 'before' && hop.target === OUTBOX_TABLE && hop.method === 'POST') {
        const body = hop.body as { dedupe_key: string; kind: string };
        if (body.dedupe_key === 'PS-APPROVE2' && body.kind !== 'payment_confirmation') return;
        if (body.dedupe_key === 'PS-APPROVE3' && body.kind === 'access_code') return;
        throw new TypeError('outbox connection lost');
      }
    });
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue({ status: 'verified', uid: 'synthetic-no-retry', email: recipient, emailVerified: true } as never);
    vi.stubGlobal('fetch', h.fetch);
    const order = await requestAccess({ request: new Request('https://app.test/api/request-access', {
      method: 'POST', body: JSON.stringify({ tier: 'Basic', requestKey: 'synthetic-no-retry' }),
    }), env });
    expect(order.status).toBe(200);
    const { referenceNumber } = await order.json() as { referenceNumber: string };
    const approval = await call('payments/approve', { referenceNumber: 'PS-APPROVE1', amountReceived: 20 });
    expect(approval.status).toBe(200);
    expect(await approval.json()).toMatchObject({ auditRecorded: true, emailsQueued: { receipt: false, confirmation: false, accessCode: false } });
    const partial = await call('payments/approve', { referenceNumber: 'PS-APPROVE2', amountReceived: 20 });
    expect(partial.status).toBe(200);
    expect(await partial.json()).toMatchObject({ emailsQueued: { receipt: true, confirmation: false, accessCode: true } });
    const activated = await call('payments/approve', { referenceNumber: 'PS-APPROVE3', amountReceived: 20 });
    expect(activated.status).toBe(200);
    expect(await activated.json()).toMatchObject({ emailsQueued: { receipt: false, confirmation: false, accessCode: true } });
    await h.q("update access_codes set used_at = now() where reference_number = 'PS-APPROVE3'");
    await h.q(`update ${OUTBOX_TABLE} set status = 'sent', secret_payload = null, sent_at = now(), attempts = 1
      where kind = 'access_code' and dedupe_key = 'PS-APPROVE3'`);
    const refund = await call('payments/refund', { referenceNumber: 'PS-REFUND01', reason: 'Synthetic return', revokeAccess: false });
    expect(refund.status).toBe(200);
    expect(await refund.json()).toMatchObject({ auditRecorded: true, refundEmailQueued: false });
    const refs = [referenceNumber, 'PS-APPROVE1', 'PS-APPROVE2', 'PS-APPROVE3', 'PS-REFUND01', 'PS-UNMARKED', 'PS-DUPL0001'];
    const rows = () => h.q(`select kind, dedupe_key, template_data->>'amount' as amount, attempts from ${OUTBOX_TABLE}
      where dedupe_key = any($1) order by dedupe_key, kind`, [refs]);
    expect(await rows()).toEqual([
      { kind: 'access_code', dedupe_key: 'PS-APPROVE2', amount: '20', attempts: 0 },
      { kind: 'purchase_receipt', dedupe_key: 'PS-APPROVE2', amount: '20', attempts: 0 },
      { kind: 'access_code', dedupe_key: 'PS-APPROVE3', amount: '20', attempts: 1 },
    ]);

    let release!: () => void;
    const bothRead = new Promise<void>((resolve) => { release = resolve; });
    let readers = 0;
    h.hooks = [async (hop, phase) => {
      if (phase === 'after' && hop.target === OUTBOX_TABLE && hop.search.get('dedupe_key')?.startsWith('in.')) {
        if (++readers === 2) release();
        await bothRead;
      }
    }];
    const drains = await Promise.all([call('email-outbox/process', {}), call('email-outbox/process', {})]);
    expect(drains.map((r) => r.status)).toEqual([200, 200]);
    expect(readers).toBeGreaterThanOrEqual(2);
    expect(await rows()).toEqual(expect.arrayContaining([
      { kind: 'payment_instructions', dedupe_key: referenceNumber, amount: '19.99', attempts: 1 },
      { kind: 'purchase_receipt', dedupe_key: 'PS-APPROVE1', amount: '20', attempts: 1 },
      { kind: 'access_code', dedupe_key: 'PS-APPROVE2', amount: '20', attempts: 1 },
      { kind: 'payment_confirmation', dedupe_key: 'PS-APPROVE2', amount: '20', attempts: 1 },
      { kind: 'purchase_receipt', dedupe_key: 'PS-APPROVE2', amount: '20', attempts: 1 },
      { kind: 'purchase_receipt', dedupe_key: 'PS-APPROVE3', amount: '20', attempts: 1 },
      { kind: 'refund_confirmation', dedupe_key: 'PS-REFUND01', amount: '19.99', attempts: 1 },
    ]));
    expect(await rows()).toHaveLength(8);
    expect(await h.q(`select kind, status from ${OUTBOX_TABLE} where dedupe_key = 'PS-APPROVE3' order by kind`)).toEqual([
      { kind: 'access_code', status: 'sent' },
      { kind: 'purchase_receipt', status: 'sent' },
    ]);
    for (const ref of ['PS-APPROVE1', 'PS-APPROVE2']) {
      expect(await h.q('select id from access_codes where reference_number = $1', [ref])).toHaveLength(1);
    }
  });

  it('delivers checkout, approval and refund emails once with only transactional fields', async () => {
    await h.q('grant update (status, approved_at) on public.payments to service_role');
    const confidential = 'SYNTHETIC-PRIVATE-CASE-DOCUMENT';
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue({ status: 'verified', uid: 'synthetic-acceptance', email: recipient, emailVerified: true } as never);
    vi.stubGlobal('fetch', h.fetch);
    const checkout = () => requestAccess({ request: new Request('https://app.test/api/request-access', {
      method: 'POST', headers: { 'user-agent': confidential },
      body: JSON.stringify({ tier: 'Basic', requestKey: 'synthetic-acceptance', document: confidential }),
    }), env });

    const messages: Array<{ subject: string; text: string }> = [];
    const fetcher: typeof fetch = async (input, init) => {
      if (String(input) === 'https://oauth2.googleapis.com/token') return Response.json({ access_token: 'synthetic-token' });
      if (String(input) === 'https://gmail.googleapis.com/gmail/v1/users/me/messages/send') {
        expect(init?.method).toBe('POST');
        const payload = JSON.parse(String(init?.body)) as { raw: string };
        expect(Object.keys(payload)).toEqual(['raw']);
        const [headers, body] = Buffer.from(payload.raw, 'base64url').toString('utf8').split('\r\n\r\n');
        expect(headers).toContain(`To: ${recipient}`);
        expect(headers.match(/^Content-Type: .+$/gm)).toEqual(['Content-Type: text/plain; charset=UTF-8']);
        expect(headers).not.toMatch(/multipart|Content-Disposition|attachment/i);
        const subject = /^Subject: =\?UTF-8\?B\?([^?]+)\?=$/m.exec(headers)?.[1] ?? '';
        messages.push({ subject: Buffer.from(subject, 'base64').toString('utf8'), text: Buffer.from(body, 'base64').toString('utf8') });
        return Response.json({ id: `synthetic-message-${messages.length}` });
      }
      return h.fetch(input, init);
    };
    let admin = 0;
    const call = (route: string, body: Record<string, unknown> = {}) => handleAdminRequest(new Request(`https://app.test/api/admin/${route}`, {
      method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' },
    }), {
      ...env, GMAIL_SENDER_ADDRESS: 'sender@example.test', GMAIL_OAUTH_CLIENT_ID: 'synthetic-client',
      GMAIL_OAUTH_CLIENT_SECRET: 'synthetic-secret', GMAIL_OAUTH_REFRESH_TOKEN: 'synthetic-refresh',
    }, {
      fetcher, now: due, requireAdmin: async () => ({ admin: { uid: `acceptance-admin-${++admin}`, email: 'operator@example.test' } }),
    });
    const drain = async (sent: number) => {
      const results = await Promise.all([call('email-outbox/process'), call('email-outbox/process')]);
      expect(results.map((r) => r.status)).toEqual([200, 200]);
      const counts = await Promise.all(results.map((r) => r.json() as Promise<{ sent: number }>));
      expect(counts.reduce((sum, count) => sum + count.sent, 0)).toBe(sent);
    };

    const order = await checkout();
    expect(order.status).toBe(200);
    const { referenceNumber, amount } = await order.json() as { referenceNumber: string; amount: number };
    expect(await (await checkout()).json()).toMatchObject({ referenceNumber, reused: true });
    const amountText = `$${amount.toFixed(2)} CAD`;
    await drain(1);
    expect(messages[0]).toEqual({ subject: `Payment instructions for order ${referenceNumber}`, text: expect.stringContaining(`Amount: ${amountText}\nSend by Interac e-Transfer to: pay@example.test\nReference: ${referenceNumber}`) });

    const approval = { referenceNumber, amountReceived: amount, document: confidential };
    const approved = await call('payments/approve', approval);
    expect(approved.status).toBe(200);
    const { accessCode } = await approved.json() as { accessCode: string };
    expect(accessCode).toBeTruthy();
    expect((await call('payments/approve', approval)).status).toBe(409);
    await drain(3);
    expect(messages).toEqual(expect.arrayContaining([
      { subject: `Payment received for order ${referenceNumber}`, text: expect.stringContaining('Activate now') },
      { subject: `Your access code for order ${referenceNumber}`, text: expect.stringContaining(accessCode) },
      { subject: `Receipt for order ${referenceNumber}`, text: expect.stringContaining(`Amount paid: ${amountText}`) },
    ]));

    const refund = { referenceNumber, reason: confidential, revokeAccess: false };
    expect((await call('payments/refund', refund)).status).toBe(200);
    expect((await call('payments/refund', refund)).status).toBe(409);
    await drain(1);
    await drain(0);
    expect(messages[4]).toEqual({ subject: `Refund recorded for order ${referenceNumber}`, text: expect.stringContaining(`A refund of ${amountText} for Basic (reference ${referenceNumber}) has been recorded.`) });
    expect(messages).toHaveLength(5);
    expect(JSON.stringify(messages)).not.toContain(confidential);
    const rows = await h.q(`select kind, status, attempts, template_data, secret_payload from ${OUTBOX_TABLE} where dedupe_key = $1 order by kind`, [referenceNumber]);
    const base = { plan: 'Basic', amount, reference: referenceNumber };
    const approvedData = { ...base, approvedAt: expect.any(String), expiresAt: expect.any(String) };
    const sent = { status: 'sent', attempts: 1, secret_payload: null };
    expect(rows).toEqual([
      { ...sent, kind: 'access_code', template_data: approvedData },
      { ...sent, kind: 'payment_confirmation', template_data: approvedData },
      { ...sent, kind: 'payment_instructions', template_data: { ...base, payTo: 'pay@example.test' } },
      { ...sent, kind: 'purchase_receipt', template_data: approvedData },
      { ...sent, kind: 'refund_confirmation', template_data: base },
    ]);
  });

  it('preserves rows during reapply and only rolls back an empty outbox', async () => {
    const snapshot = await h.q(contents);
    expect(snapshot.length).toBeGreaterThan(0);
    const payments = await h.q('select * from payments order by id');
    const entitlements = await h.q('select * from navigator_paid_sessions order by id');
    await h.q('drop index public.transactional_email_outbox_due');
    await applyOutbox();
    expect(await h.q("select to_regclass('public.transactional_email_outbox_due') is not null as present")).toEqual([{ present: true }]);
    expect(await h.q(contents)).toEqual(snapshot);
    const rollback = await h.pool.connect();
    try {
      await expect(rollback.query(sql('.down'))).rejects.toThrow('Transactional email outbox is not empty');
      await rollback.query('rollback');
    } finally {
      rollback.release();
    }
    expect(await h.q(contents)).toEqual(snapshot);
    await h.q(`truncate table ${OUTBOX_TABLE}`);
    await h.pool.query(sql('.down'));
    expect(await h.q("select to_regclass('public.transactional_email_outbox') is null as absent")).toEqual([{ absent: true }]);
    await applyOutbox();
    expect(await h.q(contents)).toEqual([]);
    expect(await h.q('select * from payments order by id')).toEqual(payments);
    expect(await h.q('select * from navigator_paid_sessions order by id')).toEqual(entitlements);
  });

  it('waits on an in-flight insert before testing emptiness and protects the committed row', async () => {
    const writer = await h.pool.connect();
    const rollback = await h.pool.connect();
    let result: Promise<unknown> | undefined;
    try {
      await writer.query('begin');
      await writer.query(`insert into ${OUTBOX_TABLE} (kind, dedupe_key, recipient_email) values ($1, 'rollback-race', $2)`, [item.kind, recipient]);
      result = rollback.query(sql('.down')).catch((error: unknown) => error);
      await waitForLocks('LOCK', 1);
      await writer.query('commit');
      expect(await result).toMatchObject({ message: expect.stringContaining('Transactional email outbox is not empty') });
    } finally {
      await writer.query('rollback');
      writer.release();
      await result;
      await rollback.query('rollback');
      rollback.release();
    }
    expect(await h.q(`select dedupe_key from ${OUTBOX_TABLE}`)).toEqual([{ dedupe_key: 'rollback-race' }]);
  });
});
