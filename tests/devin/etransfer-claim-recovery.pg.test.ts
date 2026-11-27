// Interrupted-activation recovery for POST /api/claim-purchase and the administrator reissue (PR #171), against a
// disposable PostgreSQL. access_codes, navigator_paid_sessions and redeem_access_code_atomic are real (P =
// 20261110004740, optionally Migration D on top); payments, audit history and storage locks are in-memory doubles.
// Runs only where CREDIT_PG_URL is set; creates and drops its own database; synthetic accounts only.
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import * as authCheck from '../../functions/api/_auth-check';
import { onRequestPost as claim } from '../../functions/api/claim-purchase';
import { handleAdminRequest } from '../../functions/api/admin/[[path]]';

const url = process.env.CREDIT_PG_URL;
const here = path.dirname(fileURLToPath(import.meta.url));
const file = (p: string) => path.resolve(here, '../../supabase', p);
const P = readFileSync(file('migrations/20261110004740_preserve_monthly_renewal.sql'), 'utf8');
const D_PATH = file('migrations_pending_approval/access_codes_one_redemption_per_reference.sql');
const SCHEMA = `
create table public.access_codes (id uuid primary key default gen_random_uuid(), tier text, code_hash text unique, email text,
  used_at timestamptz, expires_at timestamptz, reference_number text, amount numeric, created_at timestamptz not null default now());
create table public.navigator_paid_sessions (id uuid primary key default gen_random_uuid(), firebase_uid text not null, email text,
  tier text not null, issued_at timestamptz not null default now(), expires_at timestamptz not null, revoked_at timestamptz,
  revocation_reason text, access_code_id uuid references public.access_codes(id) on delete set null,
  constraint navigator_paid_sessions_access_code_id_key unique (access_code_id));
create table public.test_faults (name text primary key);
create function public.test_fail_session_insert() returns trigger language plpgsql as $$
begin
  if exists (select 1 from public.test_faults where name = 'session_insert') then
    raise exception 'injected: connection lost while writing the entitlement';
  end if;
  return new;
end $$;
create trigger test_fail_session_insert before insert on public.navigator_paid_sessions
  for each row execute function public.test_fail_session_insert();`;
const env = { FIREBASE_PROJECT_ID: 'p', SESSION_SECRET: 'recovery-secret', STAGING_SUPABASE_URL: 'https://db.test', STAGING_SUPABASE_SERVICE_ROLE_KEY: 'k' };
const DAY = 86400000;
const TABLES = new Set(['access_codes', 'navigator_paid_sessions']);
type Fault = 'rpc_unreachable' | 'rpc_response_lost' | null;

const variants = [{ name: 'P (live after P)', d: false }, ...(existsSync(D_PATH) ? [{ name: 'P + Migration D', d: true }] : [])];

describe.skipIf(!url).each(variants)('interrupted e-Transfer activation recovers safely: $name', ({ d }) => {
  const dbName = `claim_rec_${d ? 'd' : 'p'}_${process.pid}_${Date.now()}`;
  let admin: pg.Client; let pool: pg.Pool;
  let locks: Set<string>; let fault: Fault; let gate: Promise<void> | null; let n = 0;
  let ref: string; let uid: string; let email: string;

  // Minimal PostgREST: select / eq / neq / is.null / not.is.null / gt / in.() / limit, for the two real tables.
  async function postgrest(u: URL, method: string, body: unknown): Promise<Response> {
    const table = u.pathname.slice('/rest/v1/'.length);
    if (!TABLES.has(table)) return new Response('unexpected table', { status: 500 });
    const where: string[] = []; const params: unknown[] = []; let limit = '';
    for (const [k, v] of u.searchParams) {
      if (k === 'select' || k === 'order') continue;
      if (k === 'limit') { limit = ` limit ${Number(v)}`; continue; }
      if (!/^[a-z_]+$/.test(k)) throw new Error(`bad column ${k}`);
      if (v === 'is.null') where.push(`${k} is null`);
      else if (v === 'not.is.null') where.push(`${k} is not null`);
      else if (v.startsWith('in.(')) { params.push(v.slice(4, -1).split(',')); where.push(`${k}::text = any($${params.length})`); }
      else {
        const [op, ...rest] = v.split('.'); const sqlOp = { eq: '=', neq: '<>', gt: '>' }[op];
        if (!sqlOp) throw new Error(`bad filter ${v}`);
        params.push(rest.join('.')); where.push(`${k} ${sqlOp} $${params.length}`);
      }
    }
    const w = where.length ? ` where ${where.join(' and ')}` : '';
    if (method === 'GET') {
      const cols = (u.searchParams.get('select') ?? '*').split(',').map((c) => (/^[a-z_*]+$/.test(c) ? c : 'null')).join(',');
      return Response.json((await pool.query(`select ${cols} from public.${table}${w}${limit}`, params)).rows);
    }
    const b = body as Record<string, unknown>;
    if (method === 'PATCH') {
      const sets = Object.keys(b).map((k, i) => `${k} = $${params.length + i + 1}`);
      await pool.query(`update public.${table} set ${sets.join(', ')}${w}`, [...params, ...Object.values(b)]);
      return new Response(null, { status: 204 });
    }
    if (method === 'POST') {
      const keys = Object.keys(b);
      await pool.query(`insert into public.${table} (${keys.join(',')}) values (${keys.map((_, i) => `$${i + 1}`).join(',')})`, Object.values(b));
      return new Response(null, { status: 201 });
    }
    return new Response('unexpected method', { status: 500 });
  }

  const fetcher = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const u = new URL(String(input)); const method = init?.method ?? 'GET';
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    if (u.pathname === '/storage/v1/object/list/analysis_jobs') return Response.json([]);
    if (u.pathname.startsWith('/storage/v1/object/analysis_jobs/admin-locks/')) {
      const name = decodeURIComponent(u.pathname.split('/').pop()!);
      if (locks.has(name)) return Response.json({ statusCode: '409' }, { status: 400 });
      locks.add(name); return Response.json({});
    }
    if (u.pathname.startsWith('/storage/v1/object/analysis_jobs/')) return Response.json({});
    if (u.pathname === '/rest/v1/payments') {
      return Response.json(u.searchParams.get('reference_number') === `eq.${ref}` ? [{
        id: '33333333-3333-4333-8333-333333333333', reference_number: ref, plan: 'Premium', amount: 49.99, status: 'approved',
        notes: `email:${email};uid:${uid}`, firebase_uid: uid }] : []);
    }
    if (u.pathname === '/rest/v1/rpc/redeem_access_code_atomic') {
      if (gate) await gate;
      const f = fault; fault = null;
      if (f === 'rpc_unreachable') throw new TypeError('fetch failed: connection reset before the database');
      try {
        const r = (await pool.query('select public.redeem_access_code_atomic($1,$2,$3) as r', [body.p_firebase_uid, body.p_code, body.p_email])).rows[0].r;
        if (f === 'rpc_response_lost') throw new TypeError('fetch failed: connection reset after commit');
        return Response.json(r);
      } catch (e) {
        if (e instanceof TypeError) throw e;
        return Response.json({ message: String((e as Error).message) }, { status: 400 });
      }
    }
    if (u.pathname.startsWith('/rest/v1/')) return postgrest(u, method, body);
    return new Response('unexpected', { status: 500 });
  });

  const customerClaim = () => claim({ request: new Request('https://x/api/claim-purchase', { method: 'POST',
    headers: { 'content-type': 'application/json', 'cf-connecting-ip': `10.7.${n % 250}.${++n % 250}` }, body: JSON.stringify({ referenceNumber: ref }) }), env } as never);
  const reissue = () => handleAdminRequest(new Request('https://cyfsanavigator.com/api/admin/payments/reissue-code', { method: 'POST',
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ referenceNumber: ref, reason: 'customer lost the code' }) }),
    env as never, { requireAdmin: (async () => ({ admin: { email: 'ops@example.test', uid: 'admin-uid' } })) as never, fetcher: fetcher as never });
  const nextMinute = () => { for (const l of [...locks]) if (l.startsWith('reissue-')) locks.delete(l); };
  const q = async (sql: string, p: unknown[] = []) => (await pool.query(sql, p)).rows;
  const sessions = () => q('select id, expires_at from public.navigator_paid_sessions where firebase_uid = $1', [uid]);
  const usedCodes = async () => (await q('select count(*)::int as n from public.access_codes where reference_number = $1 and used_at is not null', [ref]))[0].n as number;
  const days = (iso: string | Date) => Math.round((new Date(iso).getTime() - Date.now()) / DAY);

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url }); await admin.connect();
    await admin.query(`create database ${dbName}`);
    for (const role of ['anon', 'authenticated', 'service_role']) {
      await admin.query(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${role}') then create role ${role} nologin; end if; end $$;`);
    }
    const u = new URL(url!); u.pathname = `/${dbName}`;
    pool = new pg.Pool({ connectionString: u.toString(), max: 8 });
    pool.on('error', () => undefined);
    await pool.query(SCHEMA); await pool.query(P);
    if (d) await pool.query(readFileSync(D_PATH, 'utf8'));
  });
  afterAll(async () => {
    await pool?.end();
    await admin.query(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  });
  beforeEach(() => {
    locks = new Set(); fault = null; gate = null;
    const k = `${Date.now().toString(36).toUpperCase().slice(-5)}${++n}`.slice(-6).padStart(6, 'Q');
    ref = `PS-R${k}`.replace(/[^A-Z0-9-]/g, 'Q'); uid = `uid-rec-${n}`; email = `rec${n}@example.test`;
    vi.stubGlobal('fetch', fetcher);
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockImplementation(async () => ({ status: 'verified', uid, email, emailVerified: true }) as never);
  });
  afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); await pool.query('delete from public.test_faults'); });

  it('cut off after the code is written, before the entitlement: retry activates exactly once (30 days)', async () => {
    fault = 'rpc_unreachable';
    expect((await customerClaim()).status).toBe(503);
    expect(await sessions()).toHaveLength(0);
    expect((await q('select count(*)::int as n from public.access_codes where reference_number = $1 and used_at is null', [ref]))[0].n).toBe(1);
    const sameMinute = await customerClaim();
    expect([sameMinute.status, (await sameMinute.json()).code]).toEqual([409, 'ACTIVATION_IN_PROGRESS']);
    nextMinute();
    const retry = await customerClaim();
    expect(retry.status).toBe(200);
    const s = await sessions();
    expect(s).toHaveLength(1);
    expect(days(s[0].expires_at)).toBe(30);
    expect(await usedCodes()).toBe(1);
  });

  it('the entitlement transaction aborts inside the database: nothing is half-written, and the retry activates once', async () => {
    await pool.query("insert into public.test_faults values ('session_insert')");
    expect((await customerClaim()).status).toBe(503);
    expect(await usedCodes()).toBe(0);
    expect(await sessions()).toHaveLength(0);
    await pool.query('delete from public.test_faults');
    nextMinute();
    expect((await customerClaim()).status).toBe(200);
    expect(await sessions()).toHaveLength(1);
    expect(await usedCodes()).toBe(1);
  });

  it('the entitlement committed but the response was lost: the retry restores the same access, no extra days', async () => {
    fault = 'rpc_response_lost';
    expect((await customerClaim()).status).toBe(503);
    const [before] = await sessions();
    expect(days(before.expires_at)).toBe(30);
    nextMinute();
    const retry = await customerClaim();
    const body = await retry.json() as { restored?: boolean; expiresAt?: string };
    expect(retry.status).toBe(200);
    expect(body.restored).toBe(true);
    const after = await sessions();
    expect(after).toHaveLength(1);
    expect(new Date(after[0].expires_at).toISOString()).toBe(new Date(before.expires_at).toISOString());
    expect(await usedCodes()).toBe(1);
  });

  it('duplicate submissions after an interruption (4 at once): one entitlement, every success is the same access', async () => {
    fault = 'rpc_unreachable';
    expect((await customerClaim()).status).toBe(503);
    nextMinute();
    const results = await Promise.all(Array.from({ length: 4 }, () => customerClaim()));
    const bodies = await Promise.all(results.map((r) => r.json() as Promise<{ code?: string; token?: string }>));
    const ok = results.filter((r) => r.status === 200).length;
    expect(ok).toBeGreaterThanOrEqual(1);
    results.forEach((r, i) => { if (r.status !== 200) expect(bodies[i].code).toBe('ACTIVATION_IN_PROGRESS'); });
    const s = await sessions();
    expect(s).toHaveLength(1);
    expect(days(s[0].expires_at)).toBe(30);
    expect(await usedCodes()).toBe(1);
    nextMinute();
    expect((await customerClaim()).status).toBe(200);
    expect(await sessions()).toHaveLength(1);
  });

  it('administrator reissue after an interrupted claim: the claim code stops working, the reissued code gives the one entitlement', async () => {
    fault = 'rpc_unreachable';
    expect((await customerClaim()).status).toBe(503);
    nextMinute();
    const issued = await reissue();
    expect(issued.status).toBe(200);
    const { accessCode } = await issued.json() as { accessCode: string };
    nextMinute();
    const retry = await customerClaim();
    expect([retry.status, (await retry.json()).code]).toEqual([409, 'CODE_REISSUED']);
    expect(await sessions()).toHaveLength(0);
    const r = (await q('select public.redeem_access_code_atomic($1,$2,$3) as r', [uid, accessCode, email]))[0].r;
    expect(r.status).toBe('activated');
    nextMinute();
    expect((await customerClaim()).status).toBe(200);
    const s = await sessions();
    expect(s).toHaveLength(1);
    expect(days(s[0].expires_at)).toBe(30);
  });

  it('administrator reissue after the entitlement committed (response lost): refused, no second code', async () => {
    fault = 'rpc_response_lost';
    expect((await customerClaim()).status).toBe(503);
    nextMinute();
    const issued = await reissue();
    expect([issued.status, ((await issued.json()) as { code?: string; error?: { code?: string } })]).toMatchObject([409, {}]);
    expect((await q('select count(*)::int as n from public.access_codes where reference_number = $1', [ref]))[0].n).toBe(1);
    expect(await sessions()).toHaveLength(1);
  });

  it('administrator reissue lands while a retry is between its checks and redemption: still one entitlement', async () => {
    fault = 'rpc_unreachable';
    expect((await customerClaim()).status).toBe(503);
    nextMinute();
    let release!: () => void; gate = new Promise<void>((r) => { release = r; });
    const pendingRetry = customerClaim();
    await vi.waitFor(() => expect(fetcher.mock.calls.some(([u]) => String(u).includes('rpc/redeem_access_code_atomic'))).toBe(true));
    nextMinute();
    gate = null;
    const issued = await reissue();
    expect(issued.status).toBe(200);
    const { accessCode } = await issued.json() as { accessCode: string };
    release();
    const retry = await pendingRetry;
    expect(retry.status).not.toBe(200);
    expect(await sessions()).toHaveLength(0);
    expect((await q('select public.redeem_access_code_atomic($1,$2,$3) as r', [uid, accessCode, email]))[0].r.status).toBe('activated');
    nextMinute();
    expect((await customerClaim()).status).toBe(200);
    const s = await sessions();
    expect(s).toHaveLength(1);
    expect(days(s[0].expires_at)).toBe(30);
    expect(await usedCodes()).toBe(1);
  });
});
