// Stage 7B access-lifecycle remediation: REAL PostgreSQL integration tests.
//
// These run the actual pending migrations (accounts, the account/client/matter/member portion of
// the matters foundation, the Stage 7B grants migration, and the corrective remediation
// migration) against a DISPOSABLE local PostgreSQL database, then exercise accept_matter_grant
// and revoke_matter_grant directly in SQL.
//
// Opt-in only: set NAVIGATOR_PG_TEST_ADMIN_URL to a superuser URL on 127.0.0.1/localhost, e.g.
//   NAVIGATOR_PG_TEST_ADMIN_URL=postgres://postgres@127.0.0.1:55432/postgres
// Each run creates a uniquely named database and drops it afterwards. Non-local hosts are refused
// so this can never be pointed at a hosted/production project.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pg from 'pg';
import { acceptProfessionalGrant, createProfessionalGrant, revokeProfessionalGrant } from './professionalMatterAccess';

// The service is driven against real PostgreSQL through a thin PostgREST-style RPC adapter
// (named arguments, {data, error} result). The adapter records every RPC the service issues so
// tests can prove which database functions were -- and were not -- invoked.
const svc = vi.hoisted(() => ({ client: null as any, calls: [] as string[] }));
vi.mock('./access', () => ({
  getSupabase: () => ({
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      svc.calls.push(fn);
      const names = Object.keys(args);
      try {
        const r = await svc.client.query(
          `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as r`,
          names.map(n => args[n]));
        return { data: r.rows[0].r, error: null };
      } catch (e: any) {
        return { data: null, error: { message: e.message } };
      }
    },
  }),
}));
vi.mock('./accounts', () => ({
  findAccount: async (uid: string) => {
    const r = await svc.client.query('select id, primary_role, status from public.accounts where firebase_uid = $1', [uid]);
    const row = r.rows[0];
    return row ? { id: row.id, primaryRole: row.primary_role, status: row.status } : null;
  },
}));

const ADMIN_URL = process.env.NAVIGATOR_PG_TEST_ADMIN_URL;
const MIGRATIONS = path.resolve(__dirname, '../../supabase/migrations_pending_approval');
const REMEDIATION = path.join(MIGRATIONS, 'remediate_navigator_matter_access_grants_lifecycle.sql');
// Stage 10 slice 4: the audited (v3) replacements of accept/revoke must preserve every Stage 7B
// guarantee, so the whole SQL suite below runs against BOTH the frozen v2 functions and the v3
// functions (which additionally require the slice 2 event log).
const EVENT_LOG = path.join(MIGRATIONS, 'create_navigator_matter_access_event_log.sql');
const AUDIT_V3 = path.join(MIGRATIONS, 'create_navigator_matter_access_lifecycle_audit_v3.sql');
const LIFECYCLE_VARIANTS: { name: string; extra: string[] }[] = [
  { name: 'v2 frozen Stage 7B functions', extra: [] },
  { name: 'v3 audited Stage 10 functions', extra: [EVENT_LOG, AUDIT_V3] },
];

function assertLocal(url: string) {
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`Refusing to run destructive integration tests against non-local host ${host}.`);
  }
}

// The matters foundation also rewires Stage 4 document tables; only the prefix that creates
// clients / navigator_matters / navigator_matter_members / create_navigator_matter_with_owner is
// needed (and loadable without the Stage 4 schema).
function mattersFoundationPrefix(): string {
  const sql = fs.readFileSync(path.join(MIGRATIONS, 'create_navigator_matters_foundation.sql'), 'utf8');
  const cut = sql.indexOf('alter table public.navigator_documents');
  if (cut < 0) throw new Error('Unexpected matters foundation layout.');
  return sql.slice(0, cut);
}

const digest = (raw: string) => crypto.createHash('sha256').update(raw).digest('hex');

const d = ADMIN_URL ? describe : describe.skip;

for (const variant of LIFECYCLE_VARIANTS) d(`Stage 7B access lifecycle -- real PostgreSQL [${variant.name}]`, () => {
  const dbName = `navigator_stage7b_test_${crypto.randomBytes(6).toString('hex')}`;
  let admin: pg.Client;
  let db: pg.Client;

  const ids: Record<string, string> = {};

  beforeAll(async () => {
    assertLocal(ADMIN_URL!);
    admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    const url = new URL(ADMIN_URL!);
    url.pathname = `/${dbName}`;
    db = new pg.Client({ connectionString: url.toString() });
    await db.connect();
    await db.query(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
        if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
      end $$;`);
    await db.query(fs.readFileSync(path.join(MIGRATIONS, 'create_accounts_foundation.sql'), 'utf8'));
    await db.query(mattersFoundationPrefix());
    await db.query(fs.readFileSync(path.join(MIGRATIONS, 'create_navigator_matter_access_grants.sql'), 'utf8'));
    if (fs.existsSync(REMEDIATION)) await db.query(fs.readFileSync(REMEDIATION, 'utf8'));
    for (const file of variant.extra) await db.query(fs.readFileSync(file, 'utf8'));
  }, 60_000);

  afterAll(async () => {
    await db?.end();
    if (admin) {
      await admin.query(`drop database if exists ${dbName} with (force)`);
      await admin.end();
    }
  });

  beforeEach(async () => {
    await db.query('truncate public.navigator_matter_access_grants, public.navigator_matter_members, public.navigator_matters, public.clients, public.accounts cascade');
    for (const [key, uid, role] of [
      ['owner', 'uid-owner', 'parent'],
      ['owner2', 'uid-owner2', 'parent'],
      ['lawyer', 'uid-lawyer', 'lawyer'],
      ['lawyer2', 'uid-lawyer2', 'lawyer'],
    ] as const) {
      const r = await db.query('insert into public.accounts (firebase_uid, primary_role) values ($1, $2) returning id', [uid, role]);
      ids[key] = r.rows[0].id;
    }
    for (const [matter, owner] of [['matterA', 'owner'], ['matterB', 'owner2']] as const) {
      const c = await db.query('insert into public.clients (account_id, name) values ($1, $2) returning id', [ids[owner], 'client']);
      const m = await db.query('insert into public.navigator_matters (account_id, client_id, title) values ($1, $2, $3) returning id', [ids[owner], c.rows[0].id, matter]);
      ids[matter] = m.rows[0].id;
      await db.query(`insert into public.navigator_matter_members (matter_id, account_id, role) values ($1, $2, 'OWNER')`, [ids[matter], ids[owner]]);
    }
  });

  async function invite(matter = 'matterA', grantor = 'owner', expiresInterval = '7 days'): Promise<{ id: string; raw: string }> {
    const raw = crypto.randomBytes(16).toString('hex');
    const r = await db.query(
      `insert into public.navigator_matter_access_grants (matter_id, grantor_account_id, token_digest, expires_at)
       values ($1, $2, $3, now() + $4::interval) returning id`,
      [ids[matter], ids[grantor], digest(raw), expiresInterval]);
    return { id: r.rows[0].id, raw };
  }

  const accept = (uid: string, raw: string) =>
    db.query('select public.accept_matter_grant($1, $2) as result', [uid, digest(raw)]).then(r => r.rows[0].result);
  const revoke = (uid: string, grantId: string) =>
    db.query('select public.revoke_matter_grant($1, $2) as result', [uid, grantId]).then(r => r.rows[0].result);
  const grantRow = (id: string) =>
    db.query('select * from public.navigator_matter_access_grants where id = $1', [id]).then(r => r.rows[0]);
  const membership = (matter: string, account: string) =>
    db.query('select role from public.navigator_matter_members where matter_id = $1 and account_id = $2', [ids[matter], ids[account]])
      .then(r => r.rows[0]?.role ?? null);

  // ---------------------------------------------------------------- BUG 2: owner downgrade
  it('BUG 2: the matter owner accepting an invitation to their own matter is refused and stays OWNER', async () => {
    const g = await invite();
    await expect(accept('uid-owner', g.raw)).rejects.toThrow(/OWNER_CANNOT_ACCEPT/);
    expect(await membership('matterA', 'owner')).toBe('OWNER');
    expect((await grantRow(g.id)).status).toBe('PENDING');
  });

  it('BUG 2: a non-grantor co-member that is OWNER is also never downgraded', async () => {
    // owner2 is made OWNER of matter A too (defensive: OWNER rows may exist beyond the grantor).
    await db.query(`insert into public.navigator_matter_members (matter_id, account_id, role) values ($1, $2, 'OWNER')`, [ids.matterA, ids.owner2]);
    const g = await invite();
    await expect(accept('uid-owner2', g.raw)).rejects.toThrow(/OWNER_CANNOT_ACCEPT/);
    expect(await membership('matterA', 'owner2')).toBe('OWNER');
  });

  // ---------------------------------------------------------------- BUG 3: expiry persistence
  it('BUG 3: accepting an expired invitation is refused AND the EXPIRED status persists', async () => {
    const g = await invite('matterA', 'owner', '-1 minute');
    const result = await accept('uid-lawyer', g.raw);
    expect(result).toMatchObject({ outcome: 'EXPIRED' });
    expect((await grantRow(g.id)).status).toBe('EXPIRED');
    expect(await membership('matterA', 'lawyer')).toBeNull();
    // Retrying an expired invitation stays refused.
    await expect(accept('uid-lawyer', g.raw)).rejects.toThrow(/INVALID_STATE/);
  });

  // ---------------------------------------------------------------- accept behaviour
  it('valid acceptance creates exactly one REVIEWER membership and records the acceptor', async () => {
    const g = await invite();
    const result = await accept('uid-lawyer', g.raw);
    expect(result).toMatchObject({ outcome: 'ACCEPTED', matter_id: ids.matterA, role: 'REVIEWER' });
    expect(await membership('matterA', 'lawyer')).toBe('REVIEWER');
    const row = await grantRow(g.id);
    expect(row.status).toBe('ACCEPTED');
    expect(row.accepted_by_account_id).toBe(ids.lawyer);
  });

  it('double accept, accept after revoke, and unknown token are refused without side effects', async () => {
    const g = await invite();
    await accept('uid-lawyer', g.raw);
    await expect(accept('uid-lawyer', g.raw)).rejects.toThrow(/INVALID_STATE/);
    await expect(accept('uid-lawyer2', g.raw)).rejects.toThrow(/INVALID_STATE/);
    expect(await membership('matterA', 'lawyer2')).toBeNull();

    const g2 = await invite();
    await revoke('uid-owner', g2.id);
    await expect(accept('uid-lawyer2', g2.raw)).rejects.toThrow(/INVALID_STATE/);
    expect(await membership('matterA', 'lawyer2')).toBeNull();

    await expect(accept('uid-lawyer', 'no-such-token')).rejects.toThrow(/INVALID_TOKEN/);
  });

  it('unknown or inactive accepting accounts are refused', async () => {
    const g = await invite();
    await expect(accept('uid-nobody', g.raw)).rejects.toThrow(/ACCOUNT_UNAVAILABLE/);
    await db.query(`update public.accounts set status = 'suspended' where id = $1`, [ids.lawyer]);
    await expect(accept('uid-lawyer', g.raw)).rejects.toThrow(/ACCOUNT_UNAVAILABLE/);
    expect((await grantRow(g.id)).status).toBe('PENDING');
  });

  it('a reviewer accepting a second invitation keeps a single REVIEWER membership', async () => {
    const a = await invite();
    const b = await invite();
    await accept('uid-lawyer', a.raw);
    await accept('uid-lawyer', b.raw);
    const rows = await db.query('select role from public.navigator_matter_members where matter_id = $1 and account_id = $2', [ids.matterA, ids.lawyer]);
    expect(rows.rows).toEqual([{ role: 'REVIEWER' }]);
  });

  // ---------------------------------------------------------------- BUG 4 + revoke behaviour
  it('BUG 4: revoking an older grant keeps access that a newer accepted grant independently authorizes', async () => {
    const a = await invite();
    const b = await invite();
    await accept('uid-lawyer', a.raw);
    await accept('uid-lawyer', b.raw);
    const result = await revoke('uid-owner', a.id);
    expect(result).toMatchObject({ status: 'REVOKED', membership_removed: false });
    expect(await membership('matterA', 'lawyer')).toBe('REVIEWER');
    // Revoking the last backing grant removes access.
    const result2 = await revoke('uid-owner', b.id);
    expect(result2).toMatchObject({ status: 'REVOKED', membership_removed: true });
    expect(await membership('matterA', 'lawyer')).toBeNull();
  });

  it('revocation of the only accepted grant removes access atomically with the status change', async () => {
    const g = await invite();
    await accept('uid-lawyer', g.raw);
    const result = await revoke('uid-owner', g.id);
    expect(result).toMatchObject({ grant_id: g.id, status: 'REVOKED', membership_removed: true });
    const row = await grantRow(g.id);
    expect(row.status).toBe('REVOKED');
    expect(row.revoked_by_account_id).toBe(ids.owner);
    expect(row.revoked_at).not.toBeNull();
    expect(await membership('matterA', 'lawyer')).toBeNull();
  });

  it('double revoke is idempotent and keeps the original revocation record', async () => {
    const g = await invite();
    await accept('uid-lawyer', g.raw);
    await revoke('uid-owner', g.id);
    const first = await grantRow(g.id);
    const again = await revoke('uid-owner', g.id);
    expect(again).toMatchObject({ status: 'REVOKED', membership_removed: false });
    const second = await grantRow(g.id);
    expect(second.revoked_at).toEqual(first.revoked_at);
    expect(await membership('matterA', 'lawyer')).toBeNull();
  });

  it('re-revoking converges a membership left behind by an earlier partial revocation', async () => {
    const g = await invite();
    await accept('uid-lawyer', g.raw);
    // Simulate the pre-remediation partial failure: grant REVOKED, membership left in place.
    await db.query(`update public.navigator_matter_access_grants set status = 'REVOKED', revoked_at = now(), revoked_by_account_id = $2 where id = $1`, [g.id, ids.owner]);
    const result = await revoke('uid-owner', g.id);
    expect(result).toMatchObject({ status: 'REVOKED', membership_removed: true });
    expect(await membership('matterA', 'lawyer')).toBeNull();
  });

  it('non-owner, reviewer, other-matter owner and unknown callers cannot revoke', async () => {
    const g = await invite();
    await accept('uid-lawyer', g.raw);
    await expect(revoke('uid-lawyer', g.id)).rejects.toThrow(/NOT_OWNER/);
    await expect(revoke('uid-owner2', g.id)).rejects.toThrow(/NOT_OWNER/);
    await expect(revoke('uid-lawyer2', g.id)).rejects.toThrow(/NOT_OWNER/);
    await expect(revoke('uid-nobody', g.id)).rejects.toThrow(/ACCOUNT_UNAVAILABLE/);
    expect((await grantRow(g.id)).status).toBe('ACCEPTED');
    expect(await membership('matterA', 'lawyer')).toBe('REVIEWER');
  });

  it('a suspended owner cannot revoke', async () => {
    const g = await invite();
    await accept('uid-lawyer', g.raw);
    await db.query(`update public.accounts set status = 'suspended' where id = $1`, [ids.owner]);
    await expect(revoke('uid-owner', g.id)).rejects.toThrow(/ACCOUNT_UNAVAILABLE/);
    expect((await grantRow(g.id)).status).toBe('ACCEPTED');
  });

  it('a grantor who is no longer a member still cannot accept their own invitation', async () => {
    const g = await invite('matterA', 'owner2');
    await expect(accept('uid-owner2', g.raw)).rejects.toThrow(/OWNER_CANNOT_ACCEPT/);
    expect(await membership('matterA', 'owner2')).toBeNull();
    expect((await grantRow(g.id)).status).toBe('PENDING');
  });

  it('unknown grant id is refused', async () => {
    await expect(revoke('uid-owner', crypto.randomUUID())).rejects.toThrow(/GRANT_NOT_FOUND/);
  });

  it('revoking never touches an OWNER membership, even for a malformed grant accepted by the owner', async () => {
    const g = await invite();
    await db.query(`update public.navigator_matter_access_grants set status = 'ACCEPTED', accepted_at = now(), accepted_by_account_id = $2 where id = $1`, [g.id, ids.owner]);
    const result = await revoke('uid-owner', g.id);
    expect(result).toMatchObject({ status: 'REVOKED', membership_removed: false });
    expect(await membership('matterA', 'owner')).toBe('OWNER');
  });

  it('revoking a grant on matter A never affects the same reviewer on matter B', async () => {
    const a = await invite('matterA', 'owner');
    const b = await invite('matterB', 'owner2');
    await accept('uid-lawyer', a.raw);
    await accept('uid-lawyer', b.raw);
    await revoke('uid-owner', a.id);
    expect(await membership('matterA', 'lawyer')).toBeNull();
    expect(await membership('matterB', 'lawyer')).toBe('REVIEWER');
  });

  it('revoking a pending invitation prevents later acceptance', async () => {
    const g = await invite();
    const result = await revoke('uid-owner', g.id);
    expect(result).toMatchObject({ status: 'REVOKED', membership_removed: false });
    await expect(accept('uid-lawyer', g.raw)).rejects.toThrow(/INVALID_STATE/);
  });

  it('keeps RLS enabled with no client grants on the grants table and both RPCs service_role-only', async () => {
    const rls = await db.query(`select relrowsecurity from pg_class where oid = 'public.navigator_matter_access_grants'::regclass`);
    expect(rls.rows[0].relrowsecurity).toBe(true);
    for (const fn of ['public.accept_matter_grant(text, text)', 'public.revoke_matter_grant(text, uuid)', 'public.navigator_matter_access_lifecycle_contract()']) {
      for (const role of ['anon', 'authenticated', 'public']) {
        const r = await db.query(`select has_function_privilege($1, $2, 'execute') as ok`, [role === 'public' ? 'anon' : role, fn]);
        expect(r.rows[0].ok).toBe(false);
      }
      const s = await db.query(`select has_function_privilege('service_role', $1, 'execute') as ok`, [fn]);
      expect(s.rows[0].ok).toBe(true);
    }
    for (const role of ['anon', 'authenticated']) {
      const t = await db.query(`select has_table_privilege($1, 'public.navigator_matter_access_grants', 'select') as ok`, [role]);
      expect(t.rows[0].ok).toBe(false);
    }
  });

  it('the contract capability returns exactly the v2 identifier, reads no data and is not SECURITY DEFINER', async () => {
    const r = await db.query('select public.navigator_matter_access_lifecycle_contract() as v');
    expect(r.rows[0].v).toBe('navigator_matter_access_lifecycle_v2');
    const f = await db.query(`select prosecdef, provolatile, pronargs, prosrc from pg_proc where proname = 'navigator_matter_access_lifecycle_contract'`);
    expect(f.rows).toHaveLength(1);
    expect(f.rows[0]).toMatchObject({ prosecdef: false, provolatile: 'i', pronargs: 0 });
    expect(f.rows[0].prosrc).not.toMatch(/\b(from|insert|update|delete|execute)\b/i);
  });

  it('the owner-less matter diagnostic finds a destroyed-owner matter and runs in a read-only transaction', async () => {
    const g = await invite();
    // Recreate the pre-remediation damage directly: the owner's membership became REVIEWER.
    await db.query(`update public.navigator_matter_access_grants set status = 'ACCEPTED', accepted_at = now(), accepted_by_account_id = $2 where id = $1`, [g.id, ids.owner]);
    await db.query(`update public.navigator_matter_members set role = 'REVIEWER' where matter_id = $1 and account_id = $2`, [ids.matterA, ids.owner]);
    const sql = fs.readFileSync(path.resolve(__dirname, '../../supabase/diagnostics/stage7b_ownerless_matters.sql'), 'utf8');
    await db.query('begin transaction read only');
    try {
      const r = await db.query(sql);
      expect(r.rows).toHaveLength(1);
      expect(r.rows[0]).toMatchObject({ matter_id: ids.matterA, creator_account_id: ids.owner, creator_current_role: 'REVIEWER', grants_accepted_by_creator: [g.id] });
    } finally {
      await db.query('rollback');
    }
  });

  it('concurrent revoke and accept on the same grant serialize to a consistent state', async () => {
    const g = await invite();
    const url = new URL(ADMIN_URL!);
    url.pathname = `/${dbName}`;
    const c1 = new pg.Client({ connectionString: url.toString() });
    const c2 = new pg.Client({ connectionString: url.toString() });
    await c1.connect(); await c2.connect();
    try {
      const results = await Promise.allSettled([
        c1.query('select public.accept_matter_grant($1, $2)', ['uid-lawyer', digest(g.raw)]),
        c2.query('select public.revoke_matter_grant($1, $2)', ['uid-owner', g.id]),
      ]);
      const row = await grantRow(g.id);
      const role = await membership('matterA', 'lawyer');
      // Whichever ran first, the end state must be revoked with no lingering access.
      expect(row.status).toBe('REVOKED');
      expect(role).toBeNull();
      expect(results[1].status).toBe('fulfilled');
    } finally {
      await c1.end(); await c2.end();
    }
  });

  it('concurrent revoke of grant A and acceptance of grant B (same reviewer) never leaves B accepted without access', async () => {
    const a = await invite();
    const b = await invite();
    await accept('uid-lawyer', a.raw);
    const url = new URL(ADMIN_URL!);
    url.pathname = `/${dbName}`;
    const c1 = new pg.Client({ connectionString: url.toString() });
    const c2 = new pg.Client({ connectionString: url.toString() });
    await c1.connect(); await c2.connect();
    try {
      // Force the dangerous interleaving: B's acceptance is in flight (uncommitted) when the
      // revocation of A runs its "is this membership still backed by another grant?" check.
      await c2.query('begin');
      await c2.query('select public.accept_matter_grant($1, $2)', ['uid-lawyer', digest(b.raw)]);
      const revoking = c1.query('select public.revoke_matter_grant($1, $2)', ['uid-owner', a.id]);
      await new Promise(r => setTimeout(r, 300));
      await c2.query('commit');
      await revoking;
      expect((await grantRow(a.id)).status).toBe('REVOKED');
      expect((await grantRow(b.id)).status).toBe('ACCEPTED');
      expect(await membership('matterA', 'lawyer')).toBe('REVIEWER');
    } finally {
      await c1.end(); await c2.end();
    }
  });
});

// ---------------------------------------------------------------------------------------------
// Service-level deployment compatibility (B-1) and grant-id canonicalization (B-2), exercising
// the REAL service code against a LEGACY database (Stage 7B grants migration only) and a
// REMEDIATED database (plus remediate_navigator_matter_access_grants_lifecycle.sql).
// ---------------------------------------------------------------------------------------------
d('Stage 7B service against real PostgreSQL -- deployment compatibility', () => {
  const suffix = crypto.randomBytes(6).toString('hex');
  // legacy: Stage 7B grants only. v2only: + Stage 7B remediation (frozen contract v2, no audit
  // wiring). remediated: + slice 2 event log + slice 4 v3 audited lifecycle (what new code needs).
  const dbs = { legacy: `navigator_stage7b_legacy_${suffix}`, v2only: `navigator_stage7b_v2only_${suffix}`, remediated: `navigator_stage7b_remed_${suffix}` };
  type Kind = keyof typeof dbs;
  let admin: pg.Client;
  const clients: Record<Kind, pg.Client> = {} as any;
  const OWNER = '00000000-0000-4000-8000-000000000001';
  const LAWYER = '00000000-0000-4000-8000-000000000002';
  const MATTER = '00000000-0000-4000-8000-0000000000a1';

  async function build(kind: Kind) {
    await admin.query(`create database ${dbs[kind]}`);
    const url = new URL(ADMIN_URL!);
    url.pathname = `/${dbs[kind]}`;
    const c = new pg.Client({ connectionString: url.toString() });
    await c.connect();
    await c.query(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
        if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
      end $$;`);
    await c.query(fs.readFileSync(path.join(MIGRATIONS, 'create_accounts_foundation.sql'), 'utf8'));
    await c.query(mattersFoundationPrefix());
    await c.query(fs.readFileSync(path.join(MIGRATIONS, 'create_navigator_matter_access_grants.sql'), 'utf8'));
    if (kind !== 'legacy') await c.query(fs.readFileSync(REMEDIATION, 'utf8'));
    if (kind === 'remediated') {
      await c.query(fs.readFileSync(EVENT_LOG, 'utf8'));
      await c.query(fs.readFileSync(AUDIT_V3, 'utf8'));
    }
    clients[kind] = c;
  }

  beforeAll(async () => {
    assertLocal(ADMIN_URL!);
    admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await build('legacy');
    await build('v2only');
    await build('remediated');
  }, 60_000);

  afterAll(async () => {
    for (const c of Object.values(clients)) await c?.end();
    if (admin) {
      for (const name of Object.values(dbs)) await admin.query(`drop database if exists ${name} with (force)`);
      await admin.end();
    }
  });

  async function use(kind: Kind) {
    const c = clients[kind];
    await c.query('truncate public.navigator_matter_access_grants, public.navigator_matter_members, public.navigator_matters, public.clients, public.accounts cascade');
    await c.query(`insert into public.accounts (id, firebase_uid, primary_role) values ($1, 'uid-owner', 'parent'), ($2, 'uid-lawyer', 'lawyer')`, [OWNER, LAWYER]);
    const cl = await c.query(`insert into public.clients (account_id, name) values ($1, 'c') returning id`, [OWNER]);
    await c.query(`insert into public.navigator_matters (id, account_id, client_id, title) values ($1, $2, $3, 'm')`, [MATTER, OWNER, cl.rows[0].id]);
    await c.query(`insert into public.navigator_matter_members (matter_id, account_id, role) values ($1, $2, 'OWNER')`, [MATTER, OWNER]);
    svc.client = c;
    svc.calls = [];
    return c;
  }

  async function invite(c: pg.Client) {
    const raw = crypto.randomBytes(16).toString('hex');
    const r = await c.query(
      `insert into public.navigator_matter_access_grants (matter_id, grantor_account_id, token_digest, expires_at)
       values ($1, $2, $3, now() + interval '7 days') returning id`, [MATTER, OWNER, digest(raw)]);
    return { id: r.rows[0].id as string, raw };
  }

  const state = async (c: pg.Client, grantId: string) => {
    const g = await c.query('select status, accepted_by_account_id from public.navigator_matter_access_grants where id = $1', [grantId]);
    const m = await c.query('select account_id, role from public.navigator_matter_members where matter_id = $1 order by account_id', [MATTER]);
    return { grant: g.rows[0], members: m.rows };
  };

  // ------------------------------------------------------------------ B-1
  it('B-1: LEGACY DB + new code refuses an owner self-acceptance BEFORE calling the legacy accept function', async () => {
    const c = await use('legacy');
    const g = await invite(c);
    const before = await state(c, g.id);
    const err = await acceptProfessionalGrant('uid-owner', g.raw).then(() => null, e => e);
    // State first: the owner must still be OWNER and the invitation untouched.
    const after = await state(c, g.id);
    expect(after.members).toEqual([{ account_id: OWNER, role: 'OWNER' }]);
    expect(after.grant).toEqual({ status: 'PENDING', accepted_by_account_id: null });
    expect(after).toEqual(before);
    expect(svc.calls).not.toContain('accept_matter_grant');
    expect(err?.message).toMatch(/access lifecycle contract/i);
  });

  it('B-1: LEGACY DB + new code refuses an ordinary acceptance without mutating anything', async () => {
    const c = await use('legacy');
    const g = await invite(c);
    const err = await acceptProfessionalGrant('uid-lawyer', g.raw).then(() => null, e => e);
    expect(await state(c, g.id)).toEqual({ grant: { status: 'PENDING', accepted_by_account_id: null }, members: [{ account_id: OWNER, role: 'OWNER' }] });
    expect(svc.calls).not.toContain('accept_matter_grant');
    expect(err?.message).toMatch(/access lifecycle contract/i);
  });

  it('B-1: LEGACY DB + new code refuses revocation without touching grants or memberships', async () => {
    const c = await use('legacy');
    const g = await invite(c);
    await c.query(`update public.navigator_matter_access_grants set status = 'ACCEPTED', accepted_at = now(), accepted_by_account_id = $2 where id = $1`, [g.id, LAWYER]);
    await c.query(`insert into public.navigator_matter_members (matter_id, account_id, role) values ($1, $2, 'REVIEWER')`, [MATTER, LAWYER]);
    const before = await state(c, g.id);
    await expect(revokeProfessionalGrant('uid-owner', g.id)).rejects.toThrow(/access lifecycle contract/i);
    expect(svc.calls).not.toContain('revoke_matter_grant');
    expect(await state(c, g.id)).toEqual(before);
  });

  it.each(['accept', 'revoke', 'create'] as const)('SLICE 4: a v2-only DB (no audit wiring) + new code refuses %s before any lifecycle call', async (op) => {
    const c = await use('v2only');
    const g = await invite(c);
    await c.query(`update public.navigator_matter_access_grants set status = 'ACCEPTED', accepted_at = now(), accepted_by_account_id = $2 where id = $1`, [g.id, LAWYER]);
    await c.query(`insert into public.navigator_matter_members (matter_id, account_id, role) values ($1, $2, 'REVIEWER')`, [MATTER, LAWYER]);
    const before = await state(c, g.id);
    const grantsBefore = (await c.query('select count(*)::int as n from public.navigator_matter_access_grants')).rows[0].n;
    const run = op === 'accept' ? acceptProfessionalGrant('uid-lawyer', g.raw)
      : op === 'revoke' ? revokeProfessionalGrant('uid-owner', g.id)
      : createProfessionalGrant('uid-owner', MATTER);
    await expect(run).rejects.toThrow(/access lifecycle contract/i);
    expect(svc.calls).toEqual(['navigator_matter_access_lifecycle_contract_v3']);
    expect(await state(c, g.id)).toEqual(before);
    expect((await c.query('select count(*)::int as n from public.navigator_matter_access_grants')).rows[0].n).toBe(grantsBefore);
  });

  it('REMEDIATED DB + new code: acceptance and owner protection work end to end', async () => {
    const c = await use('remediated');
    const own = await invite(c);
    await expect(acceptProfessionalGrant('uid-owner', own.raw)).rejects.toThrow(/matter owner cannot accept/i);
    expect((await state(c, own.id)).members).toEqual([{ account_id: OWNER, role: 'OWNER' }]);
    const g = await invite(c);
    await expect(acceptProfessionalGrant('uid-lawyer', g.raw)).resolves.toEqual({ success: true, matterId: MATTER });
    expect(svc.calls.filter(f => f === 'accept_matter_grant')).toHaveLength(2);
  });

  // ------------------------------------------------------------------ B-2
  it.each([
    ['uppercase', (id: string) => id.toUpperCase()],
    ['mixed case', (id: string) => id.split('').map((ch, i) => (i % 2 ? ch.toUpperCase() : ch)).join('')],
    ['lowercase', (id: string) => id],
  ])('B-2: revoking with a %s grant id reports success and removes access', async (_label, variant) => {
    const c = await use('remediated');
    const g = await invite(c);
    await acceptProfessionalGrant('uid-lawyer', g.raw);
    const res = await revokeProfessionalGrant('uid-owner', variant(g.id));
    expect(res).toEqual({ success: true, membershipRemoved: true });
    const after = await state(c, g.id);
    expect(after.grant.status).toBe('REVOKED');
    expect(after.members).toEqual([{ account_id: OWNER, role: 'OWNER' }]);
  });

  it('B-2: a malformed grant id is rejected before any revocation RPC is issued', async () => {
    await use('remediated');
    await expect(revokeProfessionalGrant('uid-owner', 'not-a-uuid')).rejects.toThrow(/grantId must be a UUID/);
    expect(svc.calls).not.toContain('revoke_matter_grant');
  });
});
