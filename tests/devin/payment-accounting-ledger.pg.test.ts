import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { handleAdminRequest } from '../../functions/api/admin/[[path]]';
import { refundedReferences } from '../../functions/api/_customer-payments';
import { planPaymentAccountingImport, renderPaymentAccountingImport } from '../../scripts/reconcile-payment-accounting.mjs';
import { findPostgrest, Harness, localJwt } from './helpers/postgrest-harness';

const url = process.env.CREDIT_PG_URL;
const bin = findPostgrest();
const local = !!url && ['127.0.0.1', '::1', '[::1]', 'localhost'].includes(new URL(url).hostname);
const read = (path: string) => readFileSync(new URL(path, import.meta.url), 'utf8');
const sql = (suffix = '') => read(`../../supabase/migrations_pending_approval/payment_accounting_ledger${suffix}.sql`);
const off = { STAGING_SUPABASE_URL: 'https://db.test', STAGING_SUPABASE_SERVICE_ROLE_KEY: localJwt('service_role'), PAYMENT_ACCOUNTING_LEDGER_ENABLED: 'false' };
const on = { ...off, PAYMENT_ACCOUNTING_LEDGER_ENABLED: 'true' };
const invoke = 'select public.append_payment_accounting_event($1,$2,$3,$4,$5,$6) as result';
const data = (id: string, event: string, key: string) => [id, event, key, 'staff@example.test', null, {}];
const dir = fileURLToPath(new URL('.', import.meta.url));
const root = fileURLToPath(new URL('../..', import.meta.url));
const prod = '82dfe65';
const hasProd = (() => {
  try { execFileSync('git', ['cat-file', '-e', `${prod}^{commit}`], { cwd: dir, stdio: 'ignore' }); return true; } catch { return false; }
})();
const fixture = read('fixtures/live-nxfh-payment-schema.sql');

describe.skipIf(!local || !bin)('payment accounting ledger on disposable PostgreSQL and PostgREST', () => {
  const tag = `${process.pid}_${Date.now()}`;
  const h = new Harness(url!, `acct_ledger_${tag}`, bin!);
  let legacyDir: string | undefined;
  const issue = async (db = h) => {
    const id = randomUUID();
    const ref = `PS-${id.slice(0, 8).toUpperCase()}`;
    await db.q("insert into public.payments (id,reference_number,plan,amount,status) values ($1,$2,'Premium',49.99,'approved')", [id, ref]);
    return { id, reference_number: ref };
  };
  const call = (route: string, reference: string, env = on, handler = handleAdminRequest, more = {}) => handler(
    new Request(`https://app.test/api/admin/payments/${route}`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ referenceNumber: reference, reason: 'Synthetic refund', revokeAccess: false, ...more }),
    }),
    env, { fetcher: h.fetch, requireAdmin: (async () => ({ admin: { uid: randomUUID(), email: 'staff@example.test' } })) as never });
  const events = (id: string) => h.q('select event from public.payment_accounting_events where payment_id = $1 order by id', [id]);
  const append = async (id: string, event: string, key: string) => (await h.q<{ result: string }>(invoke, data(id, event, key)))[0].result;
  beforeAll(async () => {
    await h.start([fixture]);
    const preflight = (await h.pool.query(sql('.preflight'))) as unknown as pg.QueryResult[];
    expect(preflight.find(({ command }) => command === 'SELECT')!.rows.every(({ ok }) => ok)).toBe(true);
    await h.pool.query(sql());
    await h.pool.query(sql('.rollback'));
    expect(await h.q("select to_regclass('public.payment_accounting_events') as ledger")).toEqual([{ ledger: null }]);
    await h.migrate(sql(), 'payment_accounting_events?select=id&limit=1');
  });
  afterEach(() => { h.hooks = []; h.audit.clear(); h.locks.clear(); });
  afterAll(async () => {
    await h.stop();
    if (legacyDir) rmSync(legacyDir, { recursive: true, force: true });
  });

  it('serializes separate transactions and dedupes refund and settlement keys', async () => {
    const { id } = await issue();
    const a = await h.pool.connect();
    const b = await h.pool.connect();
    try {
      await a.query('begin');
      await b.query('begin');
      const aid = (await a.query('select pg_backend_pid() as pid')).rows[0].pid;
      const bid = (await b.query('select pg_backend_pid() as pid')).rows[0].pid;
      expect((await a.query(invoke, data(id, 'confirm-bank', 'confirm'))).rows[0].result).toBe('appended');
      const waiting = b.query(invoke, data(id, 'confirm-bank', 'confirm'));
      let blockers: number[] = [];
      for (let i = 0; i < 100 && !blockers.includes(aid); i++) {
        blockers = (await h.q<{ blockers: number[] }>('select pg_blocking_pids($1) as blockers', [bid]))[0].blockers;
      }
      expect(blockers).toContain(aid);
      await a.query('commit');
      expect((await waiting).rows[0].result).toBe('unchanged');
      await b.query('commit');
      expect(await append(id, 'dispute', 'dispute')).toBe('appended');
      expect(await append(id, 'confirm-bank', 'confirm')).toBe('unchanged');
      expect(await append(id, 'confirm-bank', 'confirm-new')).toBe('appended');
      expect((await Promise.all([append(id, 'refund', 'a'), append(id, 'refund', 'b')])).sort()).toEqual(['already_recorded', 'appended']);
      expect(await append(id, 'reset-settlement', 'late')).toBe('refunded');
      expect((await Promise.all([append(id, 'refund-applied', 'a'), append(id, 'refund-applied', 'b')])).sort()).toEqual(['appended', 'unchanged']);
      expect(await events(id)).toEqual(['confirm-bank', 'dispute', 'confirm-bank', 'refund', 'refund-applied'].map((event) => ({ event })));
    } finally {
      await a.query('rollback'); await b.query('rollback'); a.release(); b.release();
    }
  });

  it('rolls back a terminated append and keeps an interrupted committed refund out of retries', async () => {
    const { id, reference_number: ref } = await issue();
    const c = new pg.Client({ connectionString: h.dbUrl });
    c.on('error', () => undefined);
    await c.connect();
    try {
      await c.query('begin');
      const pid = (await c.query('select pg_backend_pid() as pid')).rows[0].pid;
      await c.query(invoke, data(id, 'refund', 'interrupted'));
      await h.q('select pg_terminate_backend($1, 5000)', [pid]);
    } finally { await c.end(); }
    expect(await events(id)).toEqual([]);
    expect(await append(id, 'refund', 'recorded')).toBe('appended');
    const retry = await call('refund', ref);
    expect([retry.status, (await retry.json()).code]).toEqual([409, 'REFUND_REQUIRES_REVIEW']);
    expect(await events(id)).toEqual([{ event: 'refund' }]);
    expect(h.audit.size).toBe(0);
  });

  it('allows service-role RPCs only, refuses direct mutations and nonempty rollback, and reapplies', async () => {
    const { id } = await issue();
    const c = await h.pool.connect();
    try {
      for (const role of ['anon', 'authenticated', 'service_role']) {
        await c.query(`set role ${role}`);
        const denied = ['delete from public.payment_accounting_events', 'update public.payment_accounting_events set reason = null',
          'insert into public.payment_accounting_events default values', 'truncate public.payment_accounting_events'];
        if (role !== 'service_role') denied.push('select * from public.payment_accounting_events', 'select * from public.payment_accounting_state',
          'select public.read_payment_accounting_state()', "select public.append_payment_accounting_event(null,'refund','key','actor',null,'{}')");
        for (const op of denied) await expect(c.query(op)).rejects.toMatchObject({ code: '42501' });
        if (role === 'service_role') expect((await c.query(invoke, data(id, 'dispute', 'key'))).rows[0].result).toBe('appended');
        await c.query('reset role');
      }
      await expect(c.query(sql('.rollback'))).rejects.toThrow('use forward repair');
    } finally { await c.query('rollback'); await c.query('reset role'); c.release(); }
    await h.pool.query(sql());
    expect(await events(id)).toEqual([{ event: 'dispute' }]);
  });

  it('uses PostgreSQL only after activation and never falls back on an error', async () => {
    const { id, reference_number: ref } = await issue();
    const opts = { idempotencyKey: randomUUID() };
    const both = await Promise.all([call('confirm-bank', ref, on, handleAdminRequest, opts), call('confirm-bank', ref, on, handleAdminRequest, opts)]);
    expect(both.map((r) => r.status)).toEqual([200, 200]);
    h.hooks = [(hop, phase) => {
      if (phase === 'before' && hop.target === 'rpc/append_payment_accounting_event') throw new Error('database down');
    }];
    expect((await call('refund', ref)).status).toBe(503);
    expect(await events(id)).toEqual([{ event: 'confirm-bank' }]);
    expect(h.audit.size).toBe(0);
    h.hooks = [];
    const refunds = await Promise.all([call('refund', ref), call('refund', ref)]);
    expect(refunds.map((r) => r.status).sort()).toEqual([200, 409]);
    expect(await events(id)).toEqual([{ event: 'confirm-bank' }, { event: 'refund' }, { event: 'refund-applied' }]);
    expect(await refundedReferences(on, h.fetch)).toContain(ref);
    expect((await call('reset-settlement', ref)).status).toBe(409);
    expect([h.audit.size, h.locks.size]).toEqual([0, 0]);
    const audit = await handleAdminRequest(new Request('https://app.test/api/admin/payments/audit-history'), on,
      { fetcher: h.fetch, requireAdmin: (async () => ({ admin: { uid: randomUUID(), email: 'staff@example.test' } })) as never });
    expect(audit.status).toBe(200);
    expect((await audit.json()).events).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: 'confirm-bank', target: ref }), expect.objectContaining({ action: 'refund-applied', target: ref }),
    ]));
  });

  it.skipIf(!hasProd)('82dfe65 writes only to Storage before activation; its history imports and reconciles twice', async () => {
    const importDb = new Harness(url!, `acct_import_${tag}`, bin!);
    const payment = await issue();
    legacyDir = mkdtempSync(join(dir, '.payment-accounting-legacy-'));
    const archive = execFileSync('git', ['archive', prod, 'functions', 'shared'], { cwd: root, maxBuffer: 1 << 27 });
    execFileSync('tar', ['-x', '-C', legacyDir], { input: archive });
    const { handleAdminRequest: old } = await import(/* @vite-ignore */ join(legacyDir, 'functions/api/admin/[[path]].ts'));
    expect((await call('confirm-bank', payment.reference_number, off, old)).status).toBe(200);
    expect((await call('refund', payment.reference_number, off, old)).status).toBe(200);
    expect(await events(payment.id)).toEqual([]);
    expect([h.audit.size, h.locks.size]).toEqual([3, 1]);
    expect(await refundedReferences(off, h.fetch)).toContain(payment.reference_number);
    const objects = [...h.audit].map(([name, body]) => ({ name, body }));
    expect(() => planPaymentAccountingImport(objects, [payment, payment])).toThrow('ambiguous');
    const plan = planPaymentAccountingImport(objects, [payment]);
    expect([plan.missingRows, plan.incompleteRefunds]).toEqual([3, 0]);
    try {
      await importDb.start([fixture, sql()]);
      await importDb.q("insert into public.payments (id,reference_number,plan,amount,status) values ($1,$2,'Premium',49.99,'approved')", [payment.id, payment.reference_number]);
      await importDb.pool.query(renderPaymentAccountingImport(plan.rows));
      const original = await importDb.q('select * from public.payment_accounting_events order by id');
      await importDb.pool.query(renderPaymentAccountingImport(plan.rows));
      expect(await importDb.q('select * from public.payment_accounting_events order by id')).toEqual(original);
      expect(planPaymentAccountingImport(objects, [payment], original).missingRows).toBe(0);
      expect(await refundedReferences(on, importDb.fetch)).toContain(payment.reference_number);
    } finally { await importDb.stop(); }
  });
});
