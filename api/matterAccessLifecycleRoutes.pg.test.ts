// Stage 10 slice 6: the UNMOUNTED lifecycle HTTP adapter on REAL PostgreSQL.
//
// An isolated Express app (the adapter is deliberately not in api/_server.ts) drives the REAL
// lifecycle service, the REAL accounts.ts and the REAL migrations -- accounts, matters, Stage 7B
// grants + remediation (a452c6c), the slice 2 event log and the slice 4 v3 audited lifecycle --
// in a DISPOSABLE local database. Only Firebase token verification is simulated. Queries go
// through a pg Pool, so concurrent HTTP requests are concurrent database transactions.
//
// Opt-in: NAVIGATOR_PG_TEST_ADMIN_URL=postgres://postgres@127.0.0.1:<port>/postgres (local only).

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pg from 'pg';
import express from 'express';
import request from 'supertest';

const svc = vi.hoisted(() => ({ pool: null as any, calls: [] as string[] }));

function isoRow(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]));
}
// PostgREST-style adapter (same shape as the slice 4/5 suites), over a pool.
function adapter() {
  return {
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      svc.calls.push(fn);
      const names = Object.keys(args);
      try {
        const r = await svc.pool.query(
          `select public.${fn}(${names.map((n, i) => `${n} => $${i + 1}`).join(', ')}) as r`, names.map(n => args[n]));
        return { data: r.rows[0].r, error: null };
      } catch (e: any) {
        return { data: null, error: { message: e.message } };
      }
    },
    from: (table: string) => {
      const filters: [string, unknown][] = [];
      let cols = '*';
      const run = async () => {
        const where = filters.map(([c], i) => `${c} = $${i + 1}`).join(' and ');
        return svc.pool.query(`select ${cols} from public.${table}${where ? ` where ${where}` : ''}`, filters.map(f => f[1]));
      };
      const q: any = {
        select: (c: string) => { cols = c; return q; },
        eq: (c: string, v: unknown) => { filters.push([c, v]); return q; },
        maybeSingle: async () => { try { const r = (await run()).rows[0]; return { data: r ? isoRow(r) : null, error: null }; } catch (e: any) { return { data: null, error: e }; } },
        then: (res: any, rej: any) => run().then(r => ({ data: r.rows.map(isoRow), error: null }), e => ({ data: null, error: e })).then(res, rej),
      };
      return q;
    },
  };
}
vi.mock('./services/access.js', async (importOriginal) => ({ ...(await importOriginal<any>()), getSupabase: () => adapter() }));
vi.mock('./services/firebaseAdmin.js', () => ({
  verifyFirebaseIdentity: async (header?: string) => {
    // Stage 10 slice 7: the verified token carries <name>@example.test, verified.
    const m = /^Bearer tok:(uid-[a-z0-9-]+)$/.exec(header ?? '');
    return m ? { uid: m[1], email: `${m[1].slice(4)}@example.test`, emailVerified: true } : null;
  },
}));

const { registerMatterAccessLifecycleRoutes } = await import('./matterAccessLifecycleRoutes.js');
// Stage 10 slice 8: the adapter now carries the per-account write limiter; this suite pins the
// lifecycle contract, so each test starts with a fresh budget (the limiter has its own suites).
const { lifecycleWriteLimiter } = await import('./services/lifecycleWriteLimiter.js');

const ADMIN_URL = process.env.NAVIGATOR_PG_TEST_ADMIN_URL;
const MIGRATIONS = path.resolve(__dirname, '../supabase/migrations_pending_approval');
const sql = (f: string) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
const d = ADMIN_URL ? describe : describe.skip;
const digest = (raw: string) => crypto.createHash('sha256').update(raw).digest('hex');
function assertLocal(url: string) {
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error(`Refusing non-local host ${host}.`);
}

const A = {
  owner: '16000000-0000-4000-8000-000000000001', coOwner: '16000000-0000-4000-8000-000000000002',
  lawyer: '16000000-0000-4000-8000-000000000003', lawyer2: '16000000-0000-4000-8000-000000000004',
  other: '16000000-0000-4000-8000-000000000005', stranger: '16000000-0000-4000-8000-000000000006',
  suspended: '16000000-0000-4000-8000-000000000007',
};
const M = { a: '', b: '' };

const app = express();
app.use(express.json());
registerMatterAccessLifecycleRoutes(app);

const auth = (r: request.Test, uid: string | null) => (uid ? r.set('Authorization', `Bearer tok:${uid}`) : r);
const emailOf = (uid: string) => `${uid.slice(4)}@example.test`;
// Default recipient: uid-lawyer. An explicit body is merged over { recipientEmail }.
const create = (uid: string | null, matter = M.a, body: Record<string, unknown> = {}, recipient = 'uid-lawyer') =>
  auth(request(app).post(`/api/matters/${matter}/access-grants`), uid).send({ recipientEmail: emailOf(recipient), ...body } as any);
const accept = (uid: string | null, token: string) =>
  auth(request(app).post('/api/access-invitations/accept'), uid).send({ token });
const revoke = (uid: string | null, grantId: string) =>
  auth(request(app).post(`/api/access-grants/${grantId}/revoke`), uid).send({});

d('Stage 10 slice 6 -- unmounted lifecycle HTTP adapter on real PostgreSQL', () => {
  const suffix = crypto.randomBytes(6).toString('hex');
  const dbName = `navigator_stage10_s6_${suffix}`;
  let admin: pg.Client;
  let db: pg.Pool;

  beforeAll(async () => {
    assertLocal(ADMIN_URL!);
    admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    const u = new URL(ADMIN_URL!);
    u.pathname = `/${dbName}`;
    db = new pg.Pool({ connectionString: u.toString(), max: 12 });
    await db.query(`do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
    end $$;`);
    await db.query(sql('create_accounts_foundation.sql'));
    const matters = sql('create_navigator_matters_foundation.sql');
    await db.query(matters.slice(0, matters.indexOf('alter table public.navigator_documents')));
    // Deployment order: grants -> 7B remediation (v2) -> event log -> v3.
    for (const f of ['create_navigator_matter_access_grants.sql', 'remediate_navigator_matter_access_grants_lifecycle.sql',
      'create_navigator_matter_access_event_log.sql', 'create_navigator_matter_access_lifecycle_audit_v3.sql',
      'create_navigator_matter_access_lifecycle_recipient_v4.sql']) {
      await db.query(sql(f));
    }
    svc.pool = db;
  }, 60_000);

  afterAll(async () => {
    await db?.end();
    if (admin) {
      await admin.query(`drop database if exists ${dbName} with (force)`);
      await admin.end();
    }
  });

  beforeEach(async () => {
    lifecycleWriteLimiter.reset();
    svc.pool = db;
    svc.calls = [];
    await db.query('truncate public.navigator_matter_access_grants, public.navigator_matter_members, public.navigator_matters, public.clients, public.accounts cascade');
    await db.query(`insert into public.accounts (id, firebase_uid, primary_role, status) values
      ($1,'uid-owner','parent','active'), ($2,'uid-coowner','parent','active'), ($3,'uid-lawyer','lawyer','active'),
      ($4,'uid-lawyer2','lawyer','active'), ($5,'uid-other','parent','active'), ($6,'uid-stranger','parent','active'),
      ($7,'uid-suspended','lawyer','suspended')`,
      [A.owner, A.coOwner, A.lawyer, A.lawyer2, A.other, A.stranger, A.suspended]);
    // Fresh matters per test: the event log is append-only, so tests never share event rows.
    M.a = crypto.randomUUID();
    M.b = crypto.randomUUID();
    for (const [m, o] of [[M.a, A.owner], [M.b, A.other]]) {
      const c = await db.query(`insert into public.clients (account_id, name) values ($1,'c') returning id`, [o]);
      await db.query(`insert into public.navigator_matters (id, account_id, client_id, title) values ($1,$2,$3,'m')`, [m, o, c.rows[0].id]);
      await db.query(`insert into public.navigator_matter_members (matter_id, account_id, role) values ($1,$2,'OWNER')`, [m, o]);
    }
    await db.query(`insert into public.navigator_matter_members (matter_id, account_id, role) values ($1,$2,'OWNER')`, [M.a, A.coOwner]);
  });

  const events = async (matter = M.a) => (await db.query(
    `select event_type, actor_account_id, subject_account_id, grant_id from public.navigator_matter_access_events
     where matter_id = $1 order by event_sequence`, [matter])).rows;
  const types = async (matter = M.a) => (await events(matter)).map(e => e.event_type);
  const allEventCount = async () => Number((await db.query('select count(*) from public.navigator_matter_access_events')).rows[0].count);
  const grantRow = async (id: string) => (await db.query('select * from public.navigator_matter_access_grants where id = $1', [id])).rows[0];
  const grantCount = async () => Number((await db.query('select count(*) from public.navigator_matter_access_grants')).rows[0].count);
  const role = async (acc: string, matter = M.a) =>
    (await db.query('select role from public.navigator_matter_members where matter_id = $1 and account_id = $2', [matter, acc])).rows[0]?.role ?? null;
  const snapshot = async () => ({
    grants: (await db.query('select id, status, accepted_by_account_id from public.navigator_matter_access_grants order by id')).rows,
    members: (await db.query('select matter_id, account_id, role from public.navigator_matter_members order by matter_id, account_id')).rows,
    events: await allEventCount(),
  });
  const invite = async (matter = M.a, uid = 'uid-owner', recipient = 'uid-lawyer') => {
    const res = await create(uid, matter, {}, recipient);
    expect(res.status).toBe(201);
    return { id: res.body.grant.id as string, token: res.body.invitationToken as string };
  };
  const expire = (id: string) => db.query(`update public.navigator_matter_access_grants set expires_at = now() - interval '1 minute' where id = $1`, [id]);

  // =============================================================== create
  describe('create', () => {
    it('owner: 201, a PENDING grant storing only the digest, exactly one GRANT_CREATED by the verified owner', async () => {
      const res = await create('uid-owner', M.a, { expiresInDays: 2 });
      expect(res.status).toBe(201);
      expect(res.body.matterId).toBe(M.a);
      const row = await grantRow(res.body.grant.id);
      expect(row).toMatchObject({ matter_id: M.a, grantor_account_id: A.owner, status: 'PENDING', token_digest: digest(res.body.invitationToken) });
      const days = (new Date(row.expires_at).getTime() - new Date(row.created_at).getTime()) / 86_400_000;
      expect(days).toBeCloseTo(2, 3);
      expect(await events()).toEqual([{ event_type: 'GRANT_CREATED', actor_account_id: A.owner, subject_account_id: null, grant_id: res.body.grant.id }]);
      expect(JSON.stringify(Object.values(row))).not.toContain(res.body.invitationToken);
    });

    it('a co-owner may invite too (the database decides, not the adapter)', async () => {
      expect((await create('uid-coowner')).status).toBe(201);
    });

    it('refusals are one indistinguishable 403 and change nothing', async () => {
      const g = await invite();
      await accept('uid-lawyer', g.token);
      const before = await snapshot();
      const bodies = new Set<string>();
      for (const [uid, matter] of [
        ['uid-lawyer', M.a], // current reviewer
        ['uid-stranger', M.a], // unrelated account
        ['uid-other', M.a], // owner of another matter
        ['uid-owner', M.b], // cross-matter: owner of A on B
        ['uid-owner', crypto.randomUUID()], // nonexistent matter
        ['uid-noaccount', M.a], // verified identity without an account
        ['uid-suspended', M.a], // suspended account
      ] as const) {
        const res = await create(uid, matter);
        expect(res.status).toBe(403);
        bodies.add(res.text);
      }
      expect(bodies.size).toBe(1);
      expect(await snapshot()).toEqual(before);
    });

    it('unauthenticated and malformed requests change nothing and never reach the database', async () => {
      const before = await snapshot();
      svc.calls = [];
      expect((await create(null)).status).toBe(401);
      expect((await create('uid-owner', M.a, { matterId: M.b })).status).toBe(400);
      expect((await create('uid-owner', M.a, { expiresInDays: 0 })).status).toBe(400);
      expect((await create('uid-owner', 'not-a-uuid')).status).toBe(400);
      expect(svc.calls).toEqual([]);
      expect(await snapshot()).toEqual(before);
    });

    it('the path matter is authoritative: an upper-case path id creates the grant on that matter only', async () => {
      const res = await create('uid-owner', M.a.toUpperCase());
      expect(res.status).toBe(201);
      expect(res.body.matterId).toBe(M.a);
      expect((await grantRow(res.body.grant.id)).matter_id).toBe(M.a);
      expect(await types(M.b)).toEqual([]);
    });

    it('is not idempotent by design: each request is a new invitation with its own token and event', async () => {
      const g1 = await invite();
      const g2 = await invite();
      expect(g1.id).not.toBe(g2.id);
      expect(g1.token).not.toBe(g2.token);
      expect(await types()).toEqual(['GRANT_CREATED', 'GRANT_CREATED']);
    });
  });

  // =============================================================== accept
  describe('accept', () => {
    it('reviewer: 200, REVIEWER membership, GRANT_ACCEPTED + REVIEWER_ACCESS_ADDED by the verified acceptor', async () => {
      const g = await invite();
      const res = await accept('uid-lawyer', g.token);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ matterId: M.a, role: 'REVIEWER' });
      expect(await role(A.lawyer)).toBe('REVIEWER');
      expect((await events()).slice(1)).toEqual([
        { event_type: 'GRANT_ACCEPTED', actor_account_id: A.lawyer, subject_account_id: A.lawyer, grant_id: g.id },
        { event_type: 'REVIEWER_ACCESS_ADDED', actor_account_id: A.lawyer, subject_account_id: A.lawyer, grant_id: g.id },
      ]);
    });

    it('a second grant for an already-backed reviewer records GRANT_ACCEPTED only', async () => {
      const g1 = await invite();
      const g2 = await invite();
      await accept('uid-lawyer', g1.token);
      expect((await accept('uid-lawyer', g2.token)).status).toBe(200);
      expect(await types()).toEqual(['GRANT_CREATED', 'GRANT_CREATED', 'GRANT_ACCEPTED', 'REVIEWER_ACCESS_ADDED', 'GRANT_ACCEPTED']);
    });

    it('unknown, replayed, revoked and expired invitations are one 410 (expiry itself is persisted by the database)', async () => {
      const used = await invite();
      await accept('uid-lawyer', used.token);
      const revoked = await invite();
      await revoke('uid-owner', revoked.id);
      const expired = await invite();
      await expire(expired.id);
      const unknown = crypto.randomBytes(32).toString('base64url');
      const before = await types();
      const bodies = new Set<string>();
      // v4: the recipient (uid-lawyer) sees used/revoked/expired as one 410; a non-recipient (uid-lawyer2)
      // sees exactly the same 410 for a used token and for an unknown one.
      for (const [uid, token] of [['uid-lawyer', used.token], ['uid-lawyer2', used.token], ['uid-lawyer', revoked.token],
        ['uid-lawyer', expired.token], ['uid-lawyer2', unknown]] as const) {
        const res = await accept(uid, token);
        expect(res.status).toBe(410);
        bodies.add(res.text);
      }
      expect(bodies.size).toBe(1);
      // The only new event is the database's own record of the expiry transition.
      expect(await types()).toEqual([...before, 'GRANT_EXPIRED']);
      expect((await grantRow(expired.id)).status).toBe('EXPIRED');
      expect(await role(A.lawyer2)).toBeNull();
    });

    it('owner preservation: the grantor and a co-owner are refused (409); roles unchanged; nothing recorded', async () => {
      // v4: each invitation is addressed to that owner, so the recipient check passes and the owner rule refuses.
      const own = await invite(M.a, 'uid-owner', 'uid-owner');
      const co = await invite(M.a, 'uid-owner', 'uid-coowner');
      const before = await snapshot();
      for (const [uid, g] of [['uid-owner', own], ['uid-coowner', co]] as const) {
        const res = await accept(uid, g.token);
        expect(res.status).toBe(409);
        expect(res.body.code).toBe('OWNER_CANNOT_ACCEPT');
      }
      expect(await role(A.owner)).toBe('OWNER');
      expect(await role(A.coOwner)).toBe('OWNER');
      expect(await snapshot()).toEqual(before);
      // Both invitations are untouched.
      expect((await grantRow(own.id)).status).toBe('PENDING');
      expect((await grantRow(co.id)).status).toBe('PENDING');
    });

    it('a suspended account or a verified identity without an account is refused (403) and nothing changes', async () => {
      const g = await invite();
      const before = await snapshot();
      for (const uid of ['uid-suspended', 'uid-noaccount']) expect((await accept(uid, g.token)).status).toBe(403);
      expect(await snapshot()).toEqual(before);
    });

    it('unauthenticated or malformed accepts never reach the database', async () => {
      const g = await invite();
      svc.calls = [];
      expect((await accept(null, g.token)).status).toBe(401);
      expect((await accept('uid-lawyer', 'short')).status).toBe(400);
      const q = await auth(request(app).post(`/api/access-invitations/accept?token=${g.token}`), 'uid-lawyer').send({});
      expect(q.status).toBe(400);
      expect(svc.calls).toEqual([]);
      expect((await grantRow(g.id)).status).toBe('PENDING');
    });

    it('concurrent accepts of one invitation: exactly one succeeds and exactly one acceptance is recorded', async () => {
      for (let i = 0; i < 8; i++) {
        const g = await invite();
        const results = await Promise.all([accept('uid-lawyer', g.token), accept('uid-lawyer2', g.token), accept('uid-lawyer', g.token)]);
        expect(results.map(r => r.status).sort()).toEqual([200, 410, 410]);
        const accepted = (await events()).filter(e => e.grant_id === g.id && e.event_type === 'GRANT_ACCEPTED');
        expect(accepted).toHaveLength(1);
        const winner = results.find(r => r.status === 200)!;
        expect(winner.body.matterId).toBe(M.a);
        await db.query('delete from public.navigator_matter_members where matter_id = $1 and role = $2', [M.a, 'REVIEWER']);
        await db.query(`update public.navigator_matter_access_grants set status = 'REVOKED', revoked_at = now() where id = $1`, [g.id]);
      }
    });
  });

  // =============================================================== revoke
  describe('revoke', () => {
    it('distinguishes the three cases exactly, and a retry changes nothing', async () => {
      const pending = await invite();
      const r1 = await revoke('uid-owner', pending.id);
      expect(r1.status).toBe(200);
      expect(r1.body).toEqual({ grantId: pending.id, status: 'REVOKED', accessRemovedByThisRequest: false });

      const g1 = await invite();
      const g2 = await invite();
      await accept('uid-lawyer', g1.token);
      await accept('uid-lawyer', g2.token);
      const before = (await types()).length;
      // Another accepted grant still backs access: grant revoked, access kept.
      const r2 = await revoke('uid-owner', g1.id);
      expect(r2.body.accessRemovedByThisRequest).toBe(false);
      expect(await role(A.lawyer)).toBe('REVIEWER');
      // Final backing grant: access removed.
      const r3 = await revoke('uid-owner', g2.id);
      expect(r3.body.accessRemovedByThisRequest).toBe(true);
      expect(await role(A.lawyer)).toBeNull();
      expect((await types()).slice(before)).toEqual(['GRANT_REVOKED', 'GRANT_REVOKED', 'REVIEWER_ACCESS_REMOVED']);
      // Retry: success, reports nothing removed, records nothing.
      const count = await allEventCount();
      const r4 = await revoke('uid-owner', g2.id);
      expect(r4.status).toBe(200);
      expect(r4.body.accessRemovedByThisRequest).toBe(false);
      expect(await allEventCount()).toBe(count);
    });

    it('refusals (reviewer, stranger, other owner, cross-matter, unknown grant, no account, suspended) are one 404 and change nothing', async () => {
      const g = await invite();
      await accept('uid-lawyer', g.token);
      const bGrant = await invite(M.b, 'uid-other');
      const before = await snapshot();
      const bodies = new Set<string>();
      for (const [uid, grant] of [
        ['uid-lawyer', g.id], ['uid-stranger', g.id], ['uid-other', g.id], ['uid-owner', bGrant.id],
        ['uid-owner', crypto.randomUUID()], ['uid-noaccount', g.id], ['uid-suspended', g.id],
      ] as const) {
        const res = await revoke(uid, grant);
        expect(res.status).toBe(404);
        bodies.add(res.text);
      }
      expect(bodies.size).toBe(1);
      expect(await snapshot()).toEqual(before);
    });

    it('history is not authority: a former reviewer whose access was once recorded can do nothing', async () => {
      const g = await invite();
      await accept('uid-lawyer', g.token);
      await revoke('uid-owner', g.id);
      expect(await types()).toContain('REVIEWER_ACCESS_ADDED');
      const before = await snapshot();
      expect((await create('uid-lawyer')).status).toBe(403);
      expect((await revoke('uid-lawyer', g.id)).status).toBe(404);
      expect(await snapshot()).toEqual(before);
    });

    it('concurrent accept and revoke of one invitation always leave a consistent state', async () => {
      for (let i = 0; i < 8; i++) {
        const g = await invite();
        const [a, r] = await Promise.all([accept('uid-lawyer', g.token), revoke('uid-owner', g.id)]);
        expect(r.status).toBe(200);
        const row = await grantRow(g.id);
        expect(row.status).toBe('REVOKED');
        // Whatever the order, the reviewer never keeps access through a revoked grant.
        expect(await role(A.lawyer)).toBeNull();
        expect([200, 410]).toContain(a.status);
        const mine = (await events()).filter(e => e.grant_id === g.id).map(e => e.event_type);
        expect(mine).toEqual(a.status === 200
          ? ['GRANT_CREATED', 'GRANT_ACCEPTED', 'REVIEWER_ACCESS_ADDED', 'GRANT_REVOKED', 'REVIEWER_ACCESS_REMOVED']
          : ['GRANT_CREATED', 'GRANT_REVOKED']);
      }
    });
  });

  // =============================================================== failure / rollback
  describe('failure injection: an audit failure rolls the whole transition back', () => {
    const inject = async (eventType: string) => {
      await db.query(`create or replace function public.s6_fail() returns trigger language plpgsql as $$
        begin if new.event_type = '${eventType}' then raise exception 'S6_INJECTED relation secret'; end if; return new; end $$`);
      await db.query('create trigger s6_fail before insert on public.navigator_matter_access_events for each row execute function public.s6_fail()');
    };
    const clear = async () => {
      await db.query('drop trigger if exists s6_fail on public.navigator_matter_access_events');
      await db.query('drop function if exists public.s6_fail()');
    };

    it.each([
      ['create', 'GRANT_CREATED', 'ACCESS_LIFECYCLE_UNAVAILABLE'],
      ['accept', 'GRANT_ACCEPTED', 'ACCESS_LIFECYCLE_UNAVAILABLE'],
      ['accept', 'REVIEWER_ACCESS_ADDED', 'ACCESS_LIFECYCLE_UNAVAILABLE'],
      ['revoke', 'GRANT_REVOKED', 'ACCESS_REVOCATION_UNCONFIRMED'],
      ['revoke', 'REVIEWER_ACCESS_REMOVED', 'ACCESS_REVOCATION_UNCONFIRMED'],
    ])('%s with a failing %s: fixed 503 %s, no partial state, no leaked text', async (op, eventType, code) => {
      const g = await invite();
      if (op === 'revoke') await accept('uid-lawyer', g.token);
      const before = await snapshot();
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await inject(eventType);
      let res: request.Response;
      try {
        res = op === 'create' ? await create('uid-owner') : op === 'accept' ? await accept('uid-lawyer', g.token) : await revoke('uid-owner', g.id);
      } finally {
        await clear();
        spy.mockRestore();
      }
      expect(res.status).toBe(503);
      expect(res.body.code).toBe(code);
      expect(res.text).not.toMatch(/S6_INJECTED|relation|secret|navigator_/);
      expect(await snapshot()).toEqual(before);
    });

    it('a missing current (v4) contract refuses all three operations before any lifecycle call', async () => {
      const g = await invite();
      const before = await snapshot();
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      await db.query('alter function public.navigator_matter_access_lifecycle_contract_v4() rename to s6_hidden_contract');
      try {
        svc.calls = [];
        expect((await create('uid-owner')).status).toBe(503);
        expect((await accept('uid-lawyer', g.token)).status).toBe(503);
        expect((await revoke('uid-owner', g.id)).status).toBe(503);
        expect(svc.calls.filter(c => /matter_grant/.test(c))).toEqual([]);
      } finally {
        await db.query('alter function public.s6_hidden_contract() rename to navigator_matter_access_lifecycle_contract_v4');
        spy.mockRestore();
      }
      expect(await snapshot()).toEqual(before);
    });
  });

  // =============================================================== append-only + privacy
  describe('append-only and privacy', () => {
    it('the adapter only ever adds events; the log still refuses UPDATE / DELETE / TRUNCATE', async () => {
      const counts: number[] = [await allEventCount()];
      const g = await invite();
      counts.push(await allEventCount());
      await accept('uid-lawyer', g.token);
      counts.push(await allEventCount());
      await revoke('uid-owner', g.id);
      counts.push(await allEventCount());
      for (let i = 1; i < counts.length; i++) expect(counts[i]).toBeGreaterThan(counts[i - 1]);
      await expect(db.query(`update public.navigator_matter_access_events set event_type = 'GRANT_CREATED'`)).rejects.toThrow();
      await expect(db.query('delete from public.navigator_matter_access_events')).rejects.toThrow();
      await expect(db.query('truncate public.navigator_matter_access_events')).rejects.toThrow();
    });

    it('responses never carry digests, uids, internal account ids or database text; the token appears only once', async () => {
      const c = await create('uid-owner');
      const token = c.body.invitationToken as string;
      const a = await accept('uid-lawyer', token);
      const r = await revoke('uid-owner', c.body.grant.id);
      const refused = [await create('uid-stranger'), await accept('uid-lawyer2', token), await revoke('uid-stranger', c.body.grant.id)];
      const others = [a, r, ...refused].map(x => x.text).join('\n');
      const everything = [c.text, others].join('\n');
      for (const secret of [digest(token), 'token_digest', 'uid-owner', 'uid-lawyer', A.owner, A.lawyer, 'grantor', 'firebase', 'NOT_OWNER', 'INVALID_TOKEN']) {
        expect(everything).not.toContain(secret);
      }
      expect(others).not.toContain(token);
      expect(Object.keys(c.body).sort()).toEqual(['grant', 'invitationToken', 'matterId']);
      // v4: the creating owner also gets the canonical recipient the invitation is bound to.
      expect(Object.keys(c.body.grant).sort()).toEqual(['createdAt', 'expiresAt', 'id', 'recipientEmail', 'status']);
    });
  });
});
