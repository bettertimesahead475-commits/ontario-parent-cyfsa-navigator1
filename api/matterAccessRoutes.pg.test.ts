// Stage 10 slice 5: the MOUNTED Stage 10 routes against REAL PostgreSQL, through the real server
// composition in api/_server.ts. Only Firebase token verification is simulated (a fixed token ->
// uid map; an unknown token verifies to null exactly like a malformed/expired/revoked one). Every
// authorization decision, every lifecycle transition and every audit event comes from the real
// migrations: accounts, matters, Stage 7B grants + remediation (a452c6c), the slice 2 event log
// and the slice 4 v3 audited lifecycle. The real accounts.ts (active-status check) is used.
//
// The lifecycle itself has no HTTP route (none exists in the repository); it is driven through
// its trusted service, and every effect is then observed through the mounted HTTP routes.
//
// Opt-in: NAVIGATOR_PG_TEST_ADMIN_URL=postgres://postgres@127.0.0.1:<port>/postgres (local only).

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pg from 'pg';
import request from 'supertest';

const svc = vi.hoisted(() => ({ client: null as any, calls: [] as string[] }));

function isoRow(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]));
}
// PostgREST-style adapter over one pg client (same shape as the slice 4 suite's adapter).
function adapter() {
  return {
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      svc.calls.push(fn);
      const names = Object.keys(args);
      try {
        const r = await svc.client.query(
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
        return svc.client.query(`select ${cols} from public.${table}${where ? ` where ${where}` : ''}`, filters.map(f => f[1]));
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
  verifyFirebaseToken: async (header?: string) => {
    const m = /^Bearer tok:(uid-[a-z0-9-]+)$/.exec(header ?? '');
    return m ? { uid: m[1], email: null } : null;
  },
}));

process.env.VERCEL = '1';
const { default: app } = await import('./_server.js');
const { acceptProfessionalGrant, createProfessionalGrant, revokeProfessionalGrant } = await import('./services/professionalMatterAccess.js');

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
  owner: '15000000-0000-4000-8000-000000000001', lawyer: '15000000-0000-4000-8000-000000000002',
  lawyer2: '15000000-0000-4000-8000-000000000003', other: '15000000-0000-4000-8000-000000000004',
  stranger: '15000000-0000-4000-8000-000000000005', suspended: '15000000-0000-4000-8000-000000000006',
};
const M = { a: '', b: '' };
const SECRET_TITLE = 'SECRET-MATTER-TITLE-7Q';
const SECRET_CLIENT = 'SECRET-CHILD-NAME-9Z';

const get = (uid: string | null, url: string) => {
  const r = request(app).get(url);
  return uid ? r.set('Authorization', `Bearer tok:${uid}`) : r;
};
const audit = (uid: string | null, m = M.a) => get(uid, `/api/matters/${m}/access-audit`);
const evts = (uid: string | null, m = M.a, q = '') => get(uid, `/api/matters/${m}/access-events${q}`);
const hist = (uid: string | null, m = M.a, q = '') => get(uid, `/api/matters/${m}/access-history${q}`);
const ALL = [audit, evts, hist];

d('Stage 10 slice 5 -- mounted routes on real PostgreSQL', () => {
  const suffix = crypto.randomBytes(6).toString('hex');
  const dbName = `navigator_stage10_s5_${suffix}`;
  let admin: pg.Client;
  let db: pg.Client;

  beforeAll(async () => {
    assertLocal(ADMIN_URL!);
    admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    const u = new URL(ADMIN_URL!);
    u.pathname = `/${dbName}`;
    db = new pg.Client({ connectionString: u.toString() });
    await db.connect();
    await db.query(`do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
    end $$;`);
    await db.query(sql('create_accounts_foundation.sql'));
    const matters = sql('create_navigator_matters_foundation.sql');
    await db.query(matters.slice(0, matters.indexOf('alter table public.navigator_documents')));
    // Deployment order from STAGE_10_LIFECYCLE_AUDIT.md: grants -> 7B remediation -> event log -> v3.
    for (const f of ['create_navigator_matter_access_grants.sql', 'remediate_navigator_matter_access_grants_lifecycle.sql',
      'create_navigator_matter_access_event_log.sql', 'create_navigator_matter_access_lifecycle_audit_v3.sql']) {
      await db.query(sql(f));
    }
    svc.client = db;
  }, 60_000);

  afterAll(async () => {
    await db?.end();
    if (admin) {
      await admin.query(`drop database if exists ${dbName} with (force)`);
      await admin.end();
    }
  });

  beforeEach(async () => {
    svc.client = db;
    svc.calls = [];
    await db.query('truncate public.navigator_matter_access_grants, public.navigator_matter_members, public.navigator_matters, public.clients, public.accounts cascade');
    await db.query(`insert into public.accounts (id, firebase_uid, primary_role) values
      ($1,'uid-owner','parent'), ($2,'uid-lawyer','lawyer'), ($3,'uid-lawyer2','lawyer'), ($4,'uid-other','parent'),
      ($5,'uid-stranger','parent'), ($6,'uid-suspended','lawyer')`,
      [A.owner, A.lawyer, A.lawyer2, A.other, A.stranger, A.suspended]);
    // Fresh matters per test: the event log is append-only, so tests never share event rows.
    M.a = crypto.randomUUID();
    M.b = crypto.randomUUID();
    for (const [m, o] of [[M.a, A.owner], [M.b, A.other]]) {
      const c = await db.query(`insert into public.clients (account_id, name) values ($1,$2) returning id`, [o, SECRET_CLIENT]);
      await db.query(`insert into public.navigator_matters (id, account_id, client_id, title) values ($1,$2,$3,$4)`, [m, o, c.rows[0].id, SECRET_TITLE]);
      await db.query(`insert into public.navigator_matter_members (matter_id, account_id, role) values ($1,$2,'OWNER')`, [m, o]);
    }
  });

  const dbEvents = async (matter = M.a) => (await db.query(
    'select id, event_type from public.navigator_matter_access_events where matter_id = $1 order by event_sequence', [matter])).rows;
  const eventCount = async () => Number((await db.query('select count(*) from public.navigator_matter_access_events')).rows[0].count);
  const invite = async (matter = M.a, uid = 'uid-owner') => {
    const r = await createProfessionalGrant(uid, matter);
    return { id: r.grant.id, raw: r.rawToken };
  };
  const invitedAndAccepted = async (uid: string, matter = M.a) => {
    const g = await invite(matter);
    await acceptProfessionalGrant(uid, g.raw);
    return g;
  };
  const historyTypes = async (uid = 'uid-owner', matter = M.a) => {
    const types: string[] = [];
    let cursor: string | null = null;
    do {
      const res = await hist(uid, matter, `?pageSize=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      expect(res.status).toBe(200);
      types.push(...res.body.entries.map((e: any) => e.eventType));
      cursor = res.body.nextCursor;
    } while (cursor);
    return types;
  };
  // A realistic matter A: owner, active reviewer "lawyer", revoked reviewer "lawyer2", suspended ex-reviewer.
  const standardScenario = async () => {
    const g1 = await invitedAndAccepted('uid-lawyer');
    const g2 = await invitedAndAccepted('uid-lawyer2');
    await revokeProfessionalGrant('uid-owner', g2.id);
    const g3 = await invitedAndAccepted('uid-suspended');
    await db.query(`update public.accounts set status = 'suspended' where id = $1`, [A.suspended]);
    return { g1, g2, g3 };
  };

  // =============================================================== reachability + roles
  describe('owner / reviewer / refused callers', () => {
    it('the owner reaches all three mounted routes with full-matter scope', async () => {
      await standardScenario();
      const a = await audit('uid-owner');
      const e = await evts('uid-owner');
      const h = await hist('uid-owner');
      expect([a.status, e.status, h.status]).toEqual([200, 200, 200]);
      expect(a.body.matterId).toBe(M.a);
      expect(e.body.scope).toBe('MATTER');
      expect(h.body).toMatchObject({ matterId: M.a, basis: 'HISTORICAL_EVENTS', scope: 'MATTER' });
      expect(h.body.entries.length).toBe((await dbEvents()).length);
    });

    it('a current reviewer: no current-state report, and history limited to its own events', async () => {
      await standardScenario();
      const a = await audit('uid-lawyer');
      expect(a.status).toBe(403);
      expect(a.body.code).toBe('FORBIDDEN');
      for (const res of [await evts('uid-lawyer'), await hist('uid-lawyer')]) {
        expect(res.status).toBe(200);
        expect(res.body.scope).toBe('SELF');
      }
      const h = await hist('uid-lawyer');
      expect(h.body.entries.map((e: any) => e.eventType)).toEqual(['GRANT_ACCEPTED', 'REVIEWER_ACCESS_ADDED']);
      for (const e of h.body.entries) {
        expect(e.actor.accountId === A.lawyer || e.subject?.accountId === A.lawyer).toBe(true);
      }
      const e = await evts('uid-lawyer');
      for (const ev of e.body.events) expect(ev.actorAccountId === A.lawyer || ev.subjectAccountId === A.lawyer).toBe(true);
    });

    it('refused callers get one indistinguishable 403 per route (no matter-existence or relationship oracle)', async () => {
      await standardScenario();
      const nonexistent = crypto.randomUUID();
      const cases: [string, string][] = [
        ['uid-stranger', M.a], // authenticated, unrelated
        ['uid-other', M.a], // owner of a different matter
        ['uid-lawyer2', M.a], // revoked reviewer
        ['uid-lawyer', M.b], // reviewer of A asking for B (cross-matter)
        ['uid-owner', M.b], // owner of A asking for B (cross-matter)
        ['uid-owner', nonexistent], // matter that does not exist
      ];
      for (const route of ALL) {
        const bodies = new Set<string>();
        for (const [uid, m] of cases) {
          const res = await route(uid, m);
          expect(res.status).toBe(403);
          bodies.add(JSON.stringify(res.body));
        }
        expect(bodies.size).toBe(1);
      }
    });

    it('a suspended account (formerly an accepted reviewer) is refused on every route', async () => {
      await standardScenario();
      for (const route of ALL) {
        const res = await route('uid-suspended');
        expect(res.status).toBe(403);
        expect(res.text).not.toMatch(/suspend/i);
      }
      // The suspended OWNER is refused too.
      await db.query(`update public.accounts set status = 'suspended' where id = $1`, [A.owner]);
      for (const route of ALL) expect((await route('uid-owner')).status).toBe(403);
    });

    it('unauthenticated, malformed and unverifiable credentials are refused before any database call', async () => {
      await standardScenario();
      for (const route of ALL) {
        svc.calls = [];
        expect((await route(null)).status).toBe(401);
        const bad = await request(app).get(`/api/matters/${M.a}/access-history`).set('Authorization', 'Bearer not-a-valid-token');
        expect(bad.status).toBe(401);
        const basic = await request(app).get(`/api/matters/${M.a}/access-audit`).set('Authorization', 'Basic b3duZXI=');
        expect(basic.status).toBe(401);
        expect(svc.calls).toEqual([]);
      }
    });

    it('a malformed matter id is a 400 without reaching the database; an upper-case id is the same matter', async () => {
      for (const route of ALL) {
        svc.calls = [];
        const res = await route('uid-owner', 'not-a-uuid');
        expect(res.status).toBe(400);
        expect(svc.calls).toEqual([]);
      }
      await invite();
      for (const route of ALL) expect((await route('uid-owner', M.a.toUpperCase())).status).toBe(200);
    });
  });

  // =============================================================== pagination through HTTP
  describe('history pagination through the mounted route', () => {
    it('walks every event exactly once, in event_sequence order, with the database re-checking every page', async () => {
      await standardScenario();
      await invite();
      await invite();
      const expected = (await dbEvents()).map(r => r.id);
      expect(expected.length).toBeGreaterThanOrEqual(9);
      const seen: string[] = [];
      let cursor: string | null = null;
      let pages = 0;
      do {
        svc.calls = [];
        const res = await hist('uid-owner', M.a, `?pageSize=2${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
        expect(res.status).toBe(200);
        expect(res.body.entries.length).toBeLessThanOrEqual(2);
        expect(svc.calls.filter(c => c === 'list_matter_access_events')).toHaveLength(1);
        seen.push(...res.body.entries.map((e: any) => e.id));
        cursor = res.body.nextCursor;
        pages++;
      } while (cursor && pages < 50);
      expect(seen).toEqual(expected);
      expect(new Set(seen).size).toBe(seen.length);
      expect(pages).toBe(Math.ceil(expected.length / 2));
    });

    it('rejects tampered cursors, cursors from another matter, and grants nothing to a caller holding a valid cursor', async () => {
      await standardScenario();
      const gB = await createProfessionalGrant('uid-other', M.b);
      await acceptProfessionalGrant('uid-lawyer2', gB.rawToken);
      await createProfessionalGrant('uid-other', M.b);
      const pageA = await hist('uid-owner', M.a, '?pageSize=1');
      const pageB = await hist('uid-other', M.b, '?pageSize=1');
      const cursorA: string = pageA.body.nextCursor;
      const cursorB: string = pageB.body.nextCursor;
      expect(cursorA).toMatch(/^h1\./);
      expect(cursorB).toMatch(/^h1\./);

      const forged = 'h1.' + Buffer.from(JSON.stringify({ m: M.a, s: 1, role: 'OWNER' })).toString('base64url');
      const tampered = [cursorA.slice(0, -2) + (cursorA.endsWith('A') ? 'B' : 'A') + '!', 'h1.', 'h2.' + cursorA.slice(3), forged, 'x'.repeat(600)];
      for (const c of tampered) {
        const res = await hist('uid-owner', M.a, `?pageSize=1&cursor=${encodeURIComponent(c)}`);
        expect(res.status).toBe(400);
        expect(res.body.code).toBe('INVALID_CURSOR');
      }
      // Matter B's cursor on matter A, even by B's owner or A's owner.
      for (const uid of ['uid-owner', 'uid-other']) {
        const res = await hist(uid, M.a, `?pageSize=1&cursor=${encodeURIComponent(cursorB)}`);
        expect(res.status === 400 || res.status === 403).toBe(true);
        expect(res.body.entries).toBeUndefined();
      }
      // A valid cursor carries no authority.
      for (const uid of ['uid-stranger', 'uid-lawyer2', 'uid-other']) {
        const res = await hist(uid, M.a, `?pageSize=1&cursor=${encodeURIComponent(cursorA)}`);
        expect(res.status).toBe(403);
      }
    });

    it('revoking a reviewer between page 1 and page 2 prevents page 2', async () => {
      const g = await invitedAndAccepted('uid-lawyer');
      const p1 = await hist('uid-lawyer', M.a, '?pageSize=1');
      expect(p1.status).toBe(200);
      expect(p1.body.entries).toHaveLength(1);
      expect(p1.body.nextCursor).toBeTruthy();
      await revokeProfessionalGrant('uid-owner', g.id);
      const p2 = await hist('uid-lawyer', M.a, `?pageSize=1&cursor=${encodeURIComponent(p1.body.nextCursor)}`);
      expect(p2.status).toBe(403);
      expect(p2.body.entries).toBeUndefined();
    });
  });

  // =============================================================== current-state report through HTTP
  describe('slice 1 current-state report through the mounted route', () => {
    it('reports invited / accepted / revoked / persisted-expired / lazily-expired grants and current access exactly', async () => {
      const pending = await invite();
      const accepted = await invitedAndAccepted('uid-lawyer');
      const revoked = await invitedAndAccepted('uid-lawyer2');
      await revokeProfessionalGrant('uid-owner', revoked.id);
      const expired = await invite();
      await db.query(`update public.navigator_matter_access_grants set expires_at = now() - interval '1 minute' where id = $1`, [expired.id]);
      await expect(acceptProfessionalGrant('uid-stranger', expired.raw)).rejects.toThrow(/expired/i);
      const lapsed = await invite();
      await db.query(`update public.navigator_matter_access_grants set expires_at = now() - interval '1 minute' where id = $1`, [lapsed.id]);

      const res = await audit('uid-owner');
      expect(res.status).toBe(200);
      const byId = Object.fromEntries(res.body.grants.map((g: any) => [g.grantId, g]));
      expect(byId[pending.id]).toMatchObject({ recordedStatus: 'PENDING', effectiveStatus: 'PENDING', expiryDerived: false });
      expect(byId[accepted.id]).toMatchObject({ recordedStatus: 'ACCEPTED', effectiveStatus: 'ACCEPTED', acceptedByAccountId: A.lawyer });
      expect(byId[revoked.id]).toMatchObject({ recordedStatus: 'REVOKED', effectiveStatus: 'REVOKED', revokedByAccountId: A.owner });
      expect(byId[expired.id]).toMatchObject({ recordedStatus: 'EXPIRED', effectiveStatus: 'EXPIRED', expiryDerived: false });
      expect(byId[lapsed.id]).toMatchObject({ recordedStatus: 'PENDING', effectiveStatus: 'EXPIRED', expiryDerived: true });
      expect(res.body.currentAccess).toEqual([
        { accountId: A.owner, role: 'OWNER', basis: 'MATTER_OWNER', backingGrantIds: [], isRequester: true },
        { accountId: A.lawyer, role: 'REVIEWER', basis: 'ACCEPTED_GRANT', backingGrantIds: [accepted.id], isRequester: false },
      ]);
      expect(res.body.integrityFindings).toEqual([]);
    });

    it('history never substitutes for current state: an out-of-band membership loss shows in the report, not in history', async () => {
      const g = await invitedAndAccepted('uid-lawyer');
      await db.query('delete from public.navigator_matter_members where matter_id = $1 and account_id = $2', [M.a, A.lawyer]);
      const report = (await audit('uid-owner')).body;
      expect(report.currentAccess.map((c: any) => c.accountId)).toEqual([A.owner]);
      expect(report.integrityFindings).toEqual([expect.objectContaining({ code: 'ACCEPTED_GRANT_WITHOUT_MEMBERSHIP', grantId: g.id, accountId: A.lawyer })]);
      // History still (correctly) records that access was once added -- it is not an authority.
      expect(await historyTypes()).toContain('REVIEWER_ACCESS_ADDED');
      // And the former reviewer is refused, whatever history says.
      expect((await hist('uid-lawyer')).status).toBe(403);
    });
  });

  // =============================================================== atomic audit, observed through HTTP
  describe('lifecycle audit events, observed through the mounted routes', () => {
    it('each committed transition shows exactly its required events', async () => {
      const step = async (fn: () => Promise<unknown>) => {
        const before = (await historyTypes()).length;
        await fn();
        return (await historyTypes()).slice(before);
      };
      let g1: { id: string; raw: string } = { id: '', raw: '' };
      let g2: { id: string; raw: string } = { id: '', raw: '' };
      expect(await step(async () => { g1 = await invite(); })).toEqual(['GRANT_CREATED']);
      expect(await step(() => acceptProfessionalGrant('uid-lawyer', g1.raw))).toEqual(['GRANT_ACCEPTED', 'REVIEWER_ACCESS_ADDED']);
      g2 = await invite();
      expect(await step(() => acceptProfessionalGrant('uid-lawyer', g2.raw))).toEqual(['GRANT_ACCEPTED']);
      const g3 = await invite();
      await db.query(`update public.navigator_matter_access_grants set expires_at = now() - interval '1 minute' where id = $1`, [g3.id]);
      expect(await step(() => acceptProfessionalGrant('uid-lawyer2', g3.raw).catch(() => {}))).toEqual(['GRANT_EXPIRED']);
      expect(await step(() => revokeProfessionalGrant('uid-owner', g1.id))).toEqual(['GRANT_REVOKED']);
      expect(await step(() => revokeProfessionalGrant('uid-owner', g2.id))).toEqual(['GRANT_REVOKED', 'REVIEWER_ACCESS_REMOVED']);
      expect(await step(() => revokeProfessionalGrant('uid-owner', g2.id))).toEqual([]);
    });

    it('reading through the HTTP routes records nothing', async () => {
      await standardScenario();
      const before = await eventCount();
      for (let i = 0; i < 5; i++) {
        for (const route of ALL) {
          await route('uid-owner');
          await route('uid-lawyer');
          await route('uid-stranger');
          await route(null);
        }
      }
      expect(await eventCount()).toBe(before);
    });

    it('an injected audit failure rolls the lifecycle back; the routes show no event and no access change', async () => {
      const g = await invite();
      await db.query(`create function public.s5_fail() returns trigger language plpgsql as $$
        begin if new.event_type = 'GRANT_ACCEPTED' then raise exception 'S5_INJECTED'; end if; return new; end $$`);
      await db.query('create trigger s5_fail before insert on public.navigator_matter_access_events for each row execute function public.s5_fail()');
      try {
        await expect(acceptProfessionalGrant('uid-lawyer', g.raw)).rejects.toThrow();
      } finally {
        await db.query('drop trigger s5_fail on public.navigator_matter_access_events');
        await db.query('drop function public.s5_fail()');
      }
      expect(await historyTypes()).toEqual(['GRANT_CREATED']);
      const report = (await audit('uid-owner')).body;
      expect(report.grants[0]).toMatchObject({ grantId: g.id, recordedStatus: 'PENDING' });
      expect(report.currentAccess.map((c: any) => c.accountId)).toEqual([A.owner]);
      expect((await hist('uid-lawyer')).status).toBe(403);
      // The invitation is still usable afterwards: nothing was half-applied.
      await acceptProfessionalGrant('uid-lawyer', g.raw);
      expect(await historyTypes()).toEqual(['GRANT_CREATED', 'GRANT_ACCEPTED', 'REVIEWER_ACCESS_ADDED']);
    });

    it('an unauthorized lifecycle attempt changes nothing the routes can see', async () => {
      const g = await invitedAndAccepted('uid-lawyer');
      const before = await historyTypes();
      await expect(createProfessionalGrant('uid-lawyer', M.a)).rejects.toThrow(/UNAUTHORIZED/);
      await expect(createProfessionalGrant('uid-stranger', M.a)).rejects.toThrow();
      await expect(revokeProfessionalGrant('uid-lawyer', g.id)).rejects.toThrow();
      await expect(revokeProfessionalGrant('uid-other', g.id)).rejects.toThrow();
      expect(await historyTypes()).toEqual(before);
      const report = (await audit('uid-owner')).body;
      expect(report.grants).toHaveLength(1);
      expect(report.currentAccess.map((c: any) => c.accountId)).toEqual([A.owner, A.lawyer]);
    });
  });

  // =============================================================== failure / append-only / privacy
  describe('fail-closed reads, append-only surface, privacy', () => {
    it('a database failure beneath each route is a fixed 503 with no SQL or identifiers', async () => {
      await standardScenario();
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        await db.query('alter function public.list_matter_access_events(text, uuid, bigint, integer) rename to s5_hidden');
        try {
          for (const [route, code] of [[evts, 'ACCESS_EVENTS_UNAVAILABLE'], [hist, 'ACCESS_HISTORY_UNAVAILABLE']] as const) {
            const res = await route('uid-owner');
            expect(res.status).toBe(503);
            expect(res.body.code).toBe(code);
            expect(res.text).not.toMatch(/function|list_matter|s5_hidden|does not exist|public\./);
          }
        } finally {
          await db.query('alter function public.s5_hidden(text, uuid, bigint, integer) rename to list_matter_access_events');
        }
        await db.query('alter table public.navigator_matter_access_grants rename to s5_hidden_grants');
        try {
          const res = await audit('uid-owner');
          expect(res.status).toBe(503);
          expect(res.body.code).toBe('ACCESS_AUDIT_UNAVAILABLE');
          expect(res.text).not.toMatch(/relation|s5_hidden|navigator_/);
        } finally {
          await db.query('alter table public.s5_hidden_grants rename to navigator_matter_access_grants');
        }
      } finally {
        spy.mockRestore();
      }
      expect((await audit('uid-owner')).status).toBe(200);
    });

    it('no HTTP method can write, change or delete an event; the table itself stays append-only', async () => {
      await standardScenario();
      const before = await eventCount();
      const [one] = await dbEvents();
      for (const suffix of ['access-events', 'access-history', 'access-audit', `access-events/${one.id}`]) {
        for (const method of ['post', 'put', 'patch', 'delete'] as const) {
          const res = await request(app)[method](`/api/matters/${M.a}/${suffix}`).set('Authorization', 'Bearer tok:uid-owner')
            .send({ eventType: 'GRANT_REVOKED', outcome: 'SUCCEEDED' });
          expect(res.status).toBe(404);
        }
      }
      expect(await eventCount()).toBe(before);
      await expect(db.query(`update public.navigator_matter_access_events set event_type = 'GRANT_CREATED' where id = $1`, [one.id])).rejects.toThrow();
      await expect(db.query('delete from public.navigator_matter_access_events where id = $1', [one.id])).rejects.toThrow();
      await expect(db.query('truncate public.navigator_matter_access_events')).rejects.toThrow();
    });

    it('responses carry no tokens, digests, uids, case titles, client names or database internals', async () => {
      const g = await invitedAndAccepted('uid-lawyer');
      const g2 = await invite();
      const bodies: string[] = [];
      for (const uid of ['uid-owner', 'uid-lawyer', 'uid-stranger']) {
        for (const route of ALL) bodies.push((await route(uid)).text);
      }
      const all = bodies.join('\n');
      for (const secret of [g.raw, g2.raw, digest(g.raw), digest(g2.raw), 'token_digest', 'firebase_uid', 'uid-owner', 'uid-lawyer',
        SECRET_TITLE, SECRET_CLIENT, 'service_role', 'SUPABASE', 'event_sequence', 'idempotency']) {
        expect(all).not.toContain(secret);
      }
      const h = JSON.parse(bodies[2]);
      expect(Object.keys(h).sort()).toEqual(['basis', 'entries', 'matterId', 'nextCursor', 'notice', 'pageSize', 'scope']);
      for (const e of h.entries) {
        expect(Object.keys(e).sort()).toEqual(['actor', 'eventType', 'grantId', 'id', 'occurredAt', 'outcome', 'reasonCode', 'sequence', 'subject', 'summary']);
      }
    });
  });
});
