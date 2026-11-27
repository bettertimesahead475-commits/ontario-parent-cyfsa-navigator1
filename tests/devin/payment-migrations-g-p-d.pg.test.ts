// Migration-level qualification of G (payments UPDATE grant), P (20261110004740_preserve_monthly_renewal) and D (one
// redemption per payment reference) on a disposable PostgreSQL built to the live nxfhvebzzobegubefcda payment schema
// (tests/devin/fixtures/live-nxfh-payment-schema.sql). Covers preflights, reapplication, interrupted application,
// application under a concurrent in-flight redemption, preservation of existing synthetic entitlements, grants/RLS,
// and the rollbacks (including when a rollback must refuse). Runs only where CREDIT_PG_URL is set; creates and drops
// its own database. The handler-level behaviour is in payment-schema-qualification.pg.test.ts.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const url = process.env.CREDIT_PG_URL;
const here = path.dirname(fileURLToPath(import.meta.url));
const read = (p: string) => readFileSync(path.resolve(here, p), 'utf8');
const LIVE = read('fixtures/live-nxfh-payment-schema.sql');
const pend = (f: string) => read(`../../supabase/migrations_pending_approval/${f}`);
const G = pend('payments_service_role_review_update.sql');
const G_DOWN = pend('payments_service_role_review_update.rollback.sql');
const G_PRE = pend('payments_service_role_review_update.preflight.sql');
const P = read('../../supabase/migrations/20261110004740_preserve_monthly_renewal.sql');
const P_DOWN = pend('preserve_monthly_renewal_P.rollback.sql');
const P_PRE = pend('preserve_monthly_renewal_P.preflight.sql');
const D = pend('access_codes_one_redemption_per_reference.sql');
const D_DOWN = pend('access_codes_one_redemption_per_reference.rollback.sql');
const D_PRE = pend('access_codes_one_redemption_per_reference.preflight.sql');
const FP = { live: 'ca9f13a85933345f0dfede3b1ab2975e', p: 'b835b252c9d2b97413e43271c712e5ce' };
const DB = `paymig_${process.pid}_${Date.now()}`;
const hash = (c: string) => createHash('sha256').update(c.trim().toUpperCase()).digest('hex');
type Check = { check_name: string; detail: string; ok: boolean; blocking: boolean };

describe.skipIf(!url)('Migrations G, P, D on the live payment schema: apply, reapply, interrupt, concurrency, rollback', () => {
  let admin: pg.Client; let pool: pg.Pool;
  const dbUrl = () => { const u = new URL(url!); u.pathname = `/${DB}`; return u.toString(); };
  const q = async <T = Record<string, unknown>>(s: string, p: unknown[] = []) => (await pool.query(s, p)).rows as T[];
  const fp = async () => (await q<{ f: string }>("select md5(prosrc) as f from pg_proc where proname = 'redeem_access_code_atomic'"))[0]?.f;
  const hasCol = async () => (await q("select 1 from information_schema.columns where table_name = 'access_codes' and column_name = 'redeemed_session_id'")).length === 1;
  const hasD = async () => (await q("select 1 from pg_indexes where indexname = 'access_codes_one_redemption_per_reference'")).length === 1;
  const checks = async (sql: string) => { const c = await pool.connect(); try { const r = await c.query(sql) as unknown as pg.QueryResult | pg.QueryResult[]; return (Array.isArray(r) ? r.find((x) => x.command === 'SELECT')! : r).rows as Check[]; } finally { c.release(); } };
  const blockingOk = (rows: Check[]) => rows.filter((r) => r.blocking).every((r) => r.ok);
  /** Everything a migration may touch, as text: rows (customer data), function, columns, indexes, grants, RLS. */
  const catalog = async () => JSON.stringify(await q(`select
    (select md5(prosrc) from pg_proc where proname = 'redeem_access_code_atomic') as fn,
    (select string_agg(table_name || '.' || column_name, ',' order by table_name, column_name) from information_schema.columns where table_schema = 'public') as cols,
    (select string_agg(indexname, ',' order by indexname) from pg_indexes where schemaname = 'public') as idx,
    (select string_agg(grantee || ':' || table_name || ':' || privilege_type, ',' order by 1) from information_schema.role_table_grants where table_schema = 'public') as tgrants,
    (select string_agg(grantee || ':' || table_name || '.' || column_name || ':' || privilege_type, ',' order by 1) from information_schema.column_privileges where table_schema = 'public' and grantee in ('anon','authenticated','service_role')) as cgrants,
    (select string_agg(relname || ':' || relrowsecurity, ',' order by relname) from pg_class where relname in ('payments','access_codes','navigator_paid_sessions')) as rls,
    (select string_agg(p::text, ',' order by p::text) from public.payments p) as payments,
    (select string_agg(md5(row(c.id, c.tier, c.used_at, c.expires_at, c.code_hash, c.email, c.reference_number, c.amount)::text), ',' order by c.id) from public.access_codes c) as codes,
    (select string_agg(s::text, ',' order by s.id) from public.navigator_paid_sessions s) as sessions`));
  const redeem = async (c: pg.ClientBase | pg.Pool, uid: string, code: string, email: string) =>
    (await c.query('select public.redeem_access_code_atomic($1, $2, $3) as r', [uid, code, email])).rows[0].r as { status: string; session_id?: string };
  const mkCode = (code: string, email: string, ref: string, tier = 'Premium') => q(`insert into public.access_codes (tier, code_hash, email, reference_number, amount, expires_at)
    values ($1, $2, $3, $4, 49.99, now() + interval '7 days')`, [tier, hash(code), email, ref]);
  const asService = async <T>(fn: (c: pg.PoolClient) => Promise<T>) => {
    const c = await pool.connect(); try { await c.query('set role service_role'); return await fn(c); } finally { await c.query('reset role').catch(() => undefined); c.release(); }
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url }); await admin.connect();
    await admin.query(`create database ${DB}`);
    pool = new pg.Pool({ connectionString: dbUrl(), max: 6 }); pool.on('error', () => undefined);
    await q(LIVE);
    await q('create schema supabase_migrations; create table supabase_migrations.schema_migrations (version text primary key)');
    await q("insert into supabase_migrations.schema_migrations values ('20261110003928'), ('20261127163256'), ('20261127163309')");
    // Existing customers before any migration: two activated purchases (pre-P semantics) and pending/approved orders.
    for (const [i, tier] of [[1, 'Premium'], [2, 'Pro']] as const) {
      await mkCode(`EXST-000${i}-AAAA`, `existing${i}@example.test`, `PS-EXIST${i}`, tier);
      expect((await redeem(pool, `uid-existing-${i}`, `EXST-000${i}-AAAA`, `existing${i}@example.test`)).status).toBe('activated');
    }
    await q(`insert into public.payments (plan, amount, reference_number, status, notes, firebase_uid) values
      ('Premium', 49.99, 'PS-PEND0001', 'pending', 'email:p@example.test', 'uid-p'), ('Basic', 19.99, 'PS-APPR0001', 'approved', 'email:a@example.test', 'uid-a')`);
  });
  afterAll(async () => {
    await pool?.end().catch(() => undefined);
    await admin?.query(`drop database if exists ${DB} with (force)`).catch(() => undefined);
    await admin?.end();
  });

  let baseline = '';
  it('baseline reproduces live: fingerprint ca9f13a8, no redeemed_session_id, service_role has no UPDATE on payments', async () => {
    expect(await fp()).toBe(FP.live);
    expect(await hasCol()).toBe(false);
    expect(await checks(G_PRE)).toEqual([expect.objectContaining({ update_status: false, update_approved_at: false, table_update: false, delete: false })]);
    baseline = await catalog();
  });

  it('G: preflight, minimal grant, reapplication, interrupted application, RLS and other roles unchanged', async () => {
    // Interrupted: the grant inside a transaction that aborts leaves nothing.
    await expect(q(G.replace(/commit;\s*$/, 'select 1/0;'))).rejects.toThrow(/division by zero/);
    await q('rollback').catch(() => undefined);
    expect(JSON.parse(await catalog())).toEqual(JSON.parse(baseline));
    await q(G); await q(G); // re-runnable
    expect((await checks(G_PRE))[0]).toMatchObject({ update_status: true, update_approved_at: true, table_update: false, delete: false, pending_payments: '1' });
    await asService(async (c) => {
      expect((await c.query("update public.payments set status = 'approved', approved_at = now() where reference_number = 'PS-PEND0001' and status = 'pending' returning id")).rowCount).toBe(1);
      await c.query("update public.payments set status = 'pending', approved_at = null where reference_number = 'PS-PEND0001'");
      await expect(c.query("update public.payments set amount = 0 where reference_number = 'PS-PEND0001'")).rejects.toMatchObject({ code: '42501' });
      await expect(c.query("update public.payments set notes = 'x'")).rejects.toMatchObject({ code: '42501' });
      await expect(c.query('delete from public.payments')).rejects.toMatchObject({ code: '42501' });
    });
    for (const role of ['anon', 'authenticated']) {
      expect((await q<{ s: boolean; u: boolean }>(`select has_table_privilege('${role}', 'public.payments', 'SELECT') as s, has_column_privilege('${role}', 'public.payments', 'status', 'UPDATE') as u`))[0]).toEqual({ s: false, u: false });
    }
    expect((await q<{ r: boolean }>("select relrowsecurity as r from pg_class where relname = 'payments'"))[0].r).toBe(true);
    const after = JSON.parse(await catalog())[0]; const before = JSON.parse(baseline)[0];
    expect({ ...after, cgrants: null }).toEqual({ ...before, cgrants: null }); // only column grants differ
    expect(after.cgrants).toContain('service_role:payments.status:UPDATE');
    expect(after.cgrants).toContain('service_role:payments.approved_at:UPDATE');
    expect(after.cgrants.match(/service_role:payments\.[a-z_]+:UPDATE/g)).toHaveLength(2);
  });

  let afterG = '';
  it('P preflight passes on live-like state; D preflight fails exactly its two blocking checks; D alone refuses and changes nothing', async () => {
    afterG = await catalog();
    const pp = await checks(P_PRE);
    expect(blockingOk(pp)).toBe(true);
    expect(pp.find((r) => r.check_name.startsWith('latest applied'))!.detail).toBe('20261127163309');
    const dp = await checks(D_PRE);
    expect(dp.filter((r) => r.blocking && !r.ok).map((r) => r.check_name)).toEqual([
      expect.stringMatching(/^access_codes has/), expect.stringMatching(/^live redeem_access_code_atomic equals/)]);
    await expect(q(D)).rejects.toThrow(/20261110004740 first\)\. Nothing was changed/);
    await q('rollback').catch(() => undefined);
    expect(JSON.parse(await catalog())).toEqual(JSON.parse(afterG));
  });

  it('P interrupted before commit leaves the live state; P with lock_timeout fails cleanly behind an in-flight redemption', async () => {
    await expect(q(P.replace(/commit;\s*$/, 'select 1/0;'))).rejects.toThrow(/division by zero/);
    expect(JSON.parse(await catalog())).toEqual(JSON.parse(afterG));
    const tx = await pool.connect();
    try {
      await mkCode('INFL-0001-AAAA', 'inflight1@example.test', 'PS-INFL0001');
      await tx.query('begin');
      expect((await redeem(tx, 'uid-inflight-1', 'INFL-0001-AAAA', 'inflight1@example.test')).status).toBe('activated');
      await expect(q(P.replace('begin;', "begin; set local lock_timeout = '500ms';"))).rejects.toMatchObject({ code: '55P03' });
      await tx.query('rollback');
    } finally { tx.release(); }
    expect(await fp()).toBe(FP.live);
    expect(await hasCol()).toBe(false);
    await q("delete from public.access_codes where reference_number = 'PS-INFL0001'");
    expect(JSON.parse(await catalog())).toEqual(JSON.parse(afterG));
  });

  let afterP = '';
  it('P waits for an in-flight redemption, which commits with the old semantics; existing customers are unchanged; P reapplies', async () => {
    const before = JSON.parse(afterG)[0];
    await mkCode('INFL-0002-AAAA', 'inflight2@example.test', 'PS-INFL0002');
    const tx = await pool.connect();
    let applied = false;
    try {
      await tx.query('begin');
      expect((await redeem(tx, 'uid-inflight-2', 'INFL-0002-AAAA', 'inflight2@example.test')).status).toBe('activated');
      const migrating = q(P).then(() => { applied = true; });
      for (let i = 0; i < 50 && !(await q("select 1 from pg_stat_activity where wait_event_type = 'Lock' and query like '%preserve%' or (wait_event_type = 'Lock' and query like '%redeemed_session_id%')")).length; i++) await new Promise((r) => setTimeout(r, 50));
      expect(applied).toBe(false); // blocked behind the open redemption
      await tx.query('commit');
      await migrating;
    } finally { tx.release(); }
    expect(await fp()).toBe(FP.p);
    expect(await hasCol()).toBe(true);
    expect((await q("select count(*)::int as n from public.navigator_paid_sessions where firebase_uid = 'uid-inflight-2' and revoked_at is null")) [0].n).toBe(1);
    const now = JSON.parse(await catalog())[0];
    // Existing rows are byte-identical (the new column is null for all of them); only the in-flight redemption was added.
    expect(await q('select count(*)::int as n from public.access_codes where redeemed_session_id is not null')).toEqual([{ n: 0 }]);
    for (const s of String(before.sessions).split('),(')) expect(now.sessions).toContain(s.replace(/^\(|\)$/g, ''));
    expect(now.payments).toBe(before.payments);
    afterP = await catalog();
    await q(P); // re-runnable: same function, one column
    expect(JSON.parse(await catalog())).toEqual(JSON.parse(afterP));
    expect(blockingOk(await checks(D_PRE))).toBe(true);
    // Existing customers keep working after P: a repeat redemption of an existing code returns the same entitlement.
    const again = await redeem(pool, 'uid-existing-1', 'EXST-0001-AAAA', 'existing1@example.test');
    expect(again.status).not.toBe('error');
    expect((await q("select count(*)::int as n from public.navigator_paid_sessions where firebase_uid = 'uid-existing-1'"))[0].n).toBe(1);
  });

  let afterD = '';
  it('D applies after P, reapplies, refuses a second redemption of one reference; D rollback restores P exactly; D reapplies', async () => {
    await q(D); await q(D);
    expect(await hasD()).toBe(true);
    afterD = await catalog();
    await mkCode('DUPE-0001-AAAA', 'dupe@example.test', 'PS-DUPE0001'); await mkCode('DUPE-0002-AAAA', 'dupe@example.test', 'PS-DUPE0001');
    const rs = await Promise.all([redeem(pool, 'uid-dupe', 'DUPE-0001-AAAA', 'dupe@example.test'), redeem(pool, 'uid-dupe-2', 'DUPE-0002-AAAA', 'dupe@example.test')]);
    expect(rs.filter((r) => r.status === 'activated')).toHaveLength(1);
    expect((await q("select count(*)::int as n from public.access_codes where reference_number = 'PS-DUPE0001' and used_at is not null"))[0].n).toBe(1);
    await q("delete from public.access_codes where reference_number = 'PS-DUPE0001'"); await q("delete from public.navigator_paid_sessions where firebase_uid in ('uid-dupe', 'uid-dupe-2')");
    expect(JSON.parse(await catalog())).toEqual(JSON.parse(afterD));
    await q(D_DOWN);
    expect(JSON.parse(await catalog())).toEqual(JSON.parse(afterP));
    await q(D);
    expect(JSON.parse(await catalog())).toEqual(JSON.parse(afterD));
  });

  it('P rollback refuses while D is installed and while any renewal is linked, changing nothing', async () => {
    await expect(q(P_DOWN)).rejects.toThrow(/Roll back D first/);
    await q('rollback').catch(() => undefined);
    expect(JSON.parse(await catalog())).toEqual(JSON.parse(afterD));
    await q(D_DOWN);
    // A monthly renewal after P links its code to the entitlement it extended.
    await mkCode('RENW-0001-AAAA', 'renew@example.test', 'PS-RENW0001', 'Pro'); await mkCode('RENW-0002-AAAA', 'renew@example.test', 'PS-RENW0002', 'Pro');
    await redeem(pool, 'uid-renew', 'RENW-0001-AAAA', 'renew@example.test'); await redeem(pool, 'uid-renew', 'RENW-0002-AAAA', 'renew@example.test');
    expect((await q('select count(*)::int as n from public.access_codes where redeemed_session_id is not null'))[0].n).toBeGreaterThan(0);
    const linked = await catalog();
    await expect(q(P_DOWN)).rejects.toThrow(/forward-repair instead\. Nothing was changed/);
    await q('rollback').catch(() => undefined);
    expect(JSON.parse(await catalog())).toEqual(JSON.parse(linked));
    await q("delete from public.access_codes where reference_number like 'PS-RENW%'"); await q("delete from public.navigator_paid_sessions where firebase_uid = 'uid-renew'");
    expect(JSON.parse(await catalog())).toEqual(JSON.parse(afterP));
    // A renewal still uncommitted when the rollback starts: the rollback waits for it, then sees its link and refuses.
    await mkCode('RENW-0003-AAAA', 'renew@example.test', 'PS-RENW0003', 'Pro');
    expect(await q('select 1 from public.access_codes where redeemed_session_id is not null')).toHaveLength(0);
    const tx = await pool.connect();
    try {
      await tx.query('begin');
      await redeem(tx, 'uid-renew', 'RENW-0003-AAAA', 'renew@example.test');
      expect((await tx.query('select count(*)::int as n from public.access_codes where redeemed_session_id is not null')).rows[0].n).toBe(1);
      let settled = false;
      const rolling = q(P_DOWN.replace("'5s'", "'20s'")).then(() => 'applied', (e: Error) => e.message).finally(() => { settled = true; });
      await new Promise((r) => setTimeout(r, 300));
      expect(settled).toBe(false);
      await tx.query('commit');
      expect(await rolling).toMatch(/forward-repair instead\. Nothing was changed/);
    } finally { tx.release(); }
    await q('rollback').catch(() => undefined);
    expect(await hasCol()).toBe(true);
    expect(await fp()).toBe(FP.p);
    await q("delete from public.access_codes where reference_number like 'PS-RENW%'"); await q("delete from public.navigator_paid_sessions where firebase_uid = 'uid-renew'");
    expect(JSON.parse(await catalog())).toEqual(JSON.parse(afterP));
    await q("delete from public.access_codes where reference_number like 'PS-RENW%'"); await q("delete from public.navigator_paid_sessions where firebase_uid = 'uid-renew'");
    expect(JSON.parse(await catalog())).toEqual(JSON.parse(afterP));
  });

  it('full rollback D -> P -> G returns the live catalog and data exactly (apart from the in-flight test customer); P and G reapply', async () => {
    await q(P_DOWN);
    expect(await fp()).toBe(FP.live);
    expect(await hasCol()).toBe(false);
    await q(G_DOWN); await q(G_DOWN);
    await q("delete from public.access_codes where reference_number = 'PS-INFL0002'"); await q("delete from public.navigator_paid_sessions where firebase_uid = 'uid-inflight-2'");
    expect(JSON.parse(await catalog())).toEqual(JSON.parse(baseline));
    expect(blockingOk(await checks(P_PRE))).toBe(true);
    await q(G); await q(P); await q(D);
    expect(await fp()).not.toBe(FP.live);
    expect(await hasD()).toBe(true);
  });
});
