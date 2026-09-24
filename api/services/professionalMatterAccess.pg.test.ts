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

import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pg from 'pg';

const ADMIN_URL = process.env.NAVIGATOR_PG_TEST_ADMIN_URL;
const MIGRATIONS = path.resolve(__dirname, '../../supabase/migrations_pending_approval');
const REMEDIATION = path.join(MIGRATIONS, 'remediate_navigator_matter_access_grants_lifecycle.sql');

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

d('Stage 7B access lifecycle -- real PostgreSQL', () => {
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
    for (const fn of ['public.accept_matter_grant(text, text)', 'public.revoke_matter_grant(text, uuid)']) {
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
