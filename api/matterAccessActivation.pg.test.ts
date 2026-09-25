// Stage 10 slice 8 (activation): the MOUNTED lifecycle routes, end to end through the REAL server
// composition (api/_server.ts: helmet, CORS, per-IP /api limiter, JSON parser, route order) against
// REAL PostgreSQL with the real migrations up to v4, in a DISPOSABLE local database. Only Firebase ID
// token verification is simulated:  Bearer tok:<uid>  -> verified <name>@example.test,
//                                     Bearer unv:<uid>  -> same email, email_verified = false.
// Everything else -- every authorization decision, transition and audit event -- is the real code.
//
// Numbered tests map to Slice 8 section 18 (1-32).
//
// Opt-in: NAVIGATOR_PG_TEST_ADMIN_URL=postgres://postgres@127.0.0.1:<port>/postgres (local only).

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pg from 'pg';
import request from 'supertest';

const svc = vi.hoisted(() => ({ pool: null as any }));

function isoRow(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]));
}
// PostgREST-style adapter over a pool (same shape as the slice 4-7 suites), plus the one embedded
// select the Professional Workspace list uses: `..., navigator_matters ( id, title, ... )`.
function adapter() {
  return {
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
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
        const where = filters.map(([c], i) => `t.${c} = $${i + 1}`).join(' and ');
        const embed = /,?\s*navigator_matters\s*\(([^)]*)\)/.exec(cols);
        const plain = embed ? cols.replace(embed[0], '') : cols;
        const select = plain.split(',').map(c => c.trim()).filter(Boolean).map(c => (c === '*' ? 't.*' : `t.${c}`)).join(', ');
        const joined = embed
          ? `, (select row_to_json(x) from (select ${embed[1]} from public.navigator_matters m where m.id = t.matter_id) x) as navigator_matters`
          : '';
        return svc.pool.query(`select ${select}${joined} from public.${table} t${where ? ` where ${where}` : ''}`, filters.map(f => f[1]));
      };
      const q: any = {
        select: (c: string) => { cols = c; return q; },
        eq: (c: string, v: unknown) => { filters.push([c, v]); return q; },
        order: () => q,
        limit: () => q,
        maybeSingle: async () => { try { const r = (await run()).rows[0]; return { data: r ? isoRow(r) : null, error: null }; } catch (e: any) { return { data: null, error: e }; } },
        single: async () => { try { const r = (await run()).rows; return r.length === 1 ? { data: isoRow(r[0]), error: null } : { data: null, error: { message: 'not single' } }; } catch (e: any) { return { data: null, error: e }; } },
        then: (res: any, rej: any) => run().then(r => ({ data: r.rows.map(isoRow), error: null }), e => ({ data: null, error: e })).then(res, rej),
      };
      return q;
    },
  };
}
vi.mock('./services/access.js', async (importOriginal) => ({ ...(await importOriginal<any>()), getSupabase: () => adapter() }));
vi.mock('./services/firebaseAdmin.js', () => {
  const parse = (h?: string) => /^Bearer (tok|unv):(uid-[a-z0-9-]+)$/.exec(h ?? '');
  return {
    verifyFirebaseToken: async (h?: string) => { const m = parse(h); return m ? { uid: m[2], email: `${m[2].slice(4)}@example.test` } : null; },
    verifyFirebaseIdentity: async (h?: string) => {
      const m = parse(h);
      return m ? { uid: m[2], email: `${m[2].slice(4)}@example.test`, emailVerified: m[1] === 'tok' } : null;
    },
  };
});

process.env.VERCEL = '1';
const { default: app } = await import('./_server.js');
const { lifecycleWriteLimiter, LIFECYCLE_WRITE_LIMIT } = await import('./services/lifecycleWriteLimiter.js');

const ADMIN_URL = process.env.NAVIGATOR_PG_TEST_ADMIN_URL;
const MIGRATIONS = path.resolve(__dirname, '../supabase/migrations_pending_approval');
const sql = (f: string) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
const d = ADMIN_URL ? describe : describe.skip;
const digest = (raw: string) => crypto.createHash('sha256').update(raw).digest('hex');
function assertLocal(url: string) {
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error(`Refusing non-local host ${host}.`);
}
const BASE = ['create_navigator_matter_access_grants.sql', 'remediate_navigator_matter_access_grants_lifecycle.sql',
  'create_navigator_matter_access_event_log.sql', 'create_navigator_matter_access_lifecycle_audit_v3.sql'];
const V4 = 'create_navigator_matter_access_lifecycle_recipient_v4.sql';

const A = {
  owner: '19000000-0000-4000-8000-000000000001', coOwner: '19000000-0000-4000-8000-000000000002',
  lawyer: '19000000-0000-4000-8000-000000000003', lawyer2: '19000000-0000-4000-8000-000000000004',
  other: '19000000-0000-4000-8000-000000000005', stranger: '19000000-0000-4000-8000-000000000006',
  suspended: '19000000-0000-4000-8000-000000000007',
};
const M = { a: '', b: '' };
const SECRET_TITLE = 'SECRET-TITLE-S8';

const as = (r: request.Test, uid: string | null, kind = 'tok') => (uid ? r.set('Authorization', `Bearer ${kind}:${uid}`) : r);
const emailOf = (uid: string) => `${uid.slice(4)}@example.test`;
const MISSING = Symbol('missing recipientEmail');
const create = (uid: string | null, recipient: unknown = emailOf('uid-lawyer'), matter = M.a, extra: Record<string, unknown> = {}) =>
  as(request(app).post(`/api/matters/${matter}/access-grants`), uid).send(recipient === MISSING ? { ...extra } : { recipientEmail: recipient, ...extra });
const accept = (uid: string | null, token: string, kind = 'tok') => as(request(app).post('/api/access-invitations/accept'), uid, kind).send({ token });
const revoke = (uid: string | null, grantId: string) => as(request(app).post(`/api/access-grants/${grantId}/revoke`), uid).send({});
const report = (uid: string | null, matter = M.a) => as(request(app).get(`/api/matters/${matter}/access-audit`), uid);
const workspace = (uid: string) => as(request(app).get('/api/professional-workspace/matters'), uid);
const fakeToken = () => crypto.randomBytes(32).toString('base64url');

d('Stage 10 slice 8 -- activated lifecycle through the real server on real PostgreSQL', () => {
  const suffix = crypto.randomBytes(6).toString('hex');
  const dbName = `navigator_stage10_s8_${suffix}`;
  const v3Name = `navigator_stage10_s8v3_${suffix}`;
  let admin: pg.Client;
  let db: pg.Pool;
  let v3db: pg.Pool;

  async function build(name: string, files: string[]) {
    await admin.query(`create database ${name}`);
    const u = new URL(ADMIN_URL!);
    u.pathname = `/${name}`;
    const pool = new pg.Pool({ connectionString: u.toString(), max: 12 });
    await pool.query(`do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
    end $$;`);
    await pool.query(sql('create_accounts_foundation.sql'));
    const matters = sql('create_navigator_matters_foundation.sql');
    await pool.query(matters.slice(0, matters.indexOf('alter table public.navigator_documents')));
    for (const f of files) await pool.query(sql(f));
    return pool;
  }

  async function seed(pool: pg.Pool) {
    await pool.query('truncate public.navigator_matter_access_grants, public.navigator_matter_members, public.navigator_matters, public.clients, public.accounts cascade');
    await pool.query(`insert into public.accounts (id, firebase_uid, primary_role, status) values
      ($1,'uid-owner','parent','active'), ($2,'uid-coowner','parent','active'), ($3,'uid-lawyer','parent','active'),
      ($4,'uid-lawyer2','lawyer','active'), ($5,'uid-other','parent','active'), ($6,'uid-stranger','parent','active'),
      ($7,'uid-suspended','lawyer','suspended')`, [A.owner, A.coOwner, A.lawyer, A.lawyer2, A.other, A.stranger, A.suspended]);
    M.a = crypto.randomUUID();
    M.b = crypto.randomUUID();
    for (const [m, o] of [[M.a, A.owner], [M.b, A.other]]) {
      const c = await pool.query(`insert into public.clients (account_id, name) values ($1,'SECRET-CLIENT') returning id`, [o]);
      await pool.query(`insert into public.navigator_matters (id, account_id, client_id, title) values ($1,$2,$3,$4)`, [m, o, c.rows[0].id, SECRET_TITLE]);
      await pool.query(`insert into public.navigator_matter_members (matter_id, account_id, role) values ($1,$2,'OWNER')`, [m, o]);
    }
    await pool.query(`insert into public.navigator_matter_members (matter_id, account_id, role) values ($1,$2,'OWNER')`, [M.a, A.coOwner]);
  }

  beforeAll(async () => {
    assertLocal(ADMIN_URL!);
    admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    db = await build(dbName, [...BASE, V4]);
    v3db = await build(v3Name, BASE); // v4 migration NOT applied
    svc.pool = db;
  }, 90_000);

  afterAll(async () => {
    await db?.end();
    await v3db?.end();
    if (admin) {
      await admin.query(`drop database if exists ${dbName} with (force)`);
      await admin.query(`drop database if exists ${v3Name} with (force)`);
      await admin.end();
    }
  });

  beforeEach(async () => {
    svc.pool = db;
    lifecycleWriteLimiter.reset();
    await seed(db);
  });

  const grantRow = async (id: string) => (await db.query('select * from public.navigator_matter_access_grants where id = $1', [id])).rows[0];
  const role = async (acc: string, matter = M.a) =>
    (await db.query('select role from public.navigator_matter_members where matter_id = $1 and account_id = $2', [matter, acc])).rows[0]?.role ?? null;
  const events = async (matter = M.a) => (await db.query(
    'select event_type from public.navigator_matter_access_events where matter_id = $1 order by event_sequence', [matter])).rows.map(r => r.event_type);
  const snapshot = async () => ({
    grants: (await db.query('select id, status, accepted_by_account_id, revoked_at from public.navigator_matter_access_grants order by id')).rows,
    members: (await db.query('select matter_id, account_id, role from public.navigator_matter_members order by matter_id, account_id')).rows,
    events: Number((await db.query('select count(*) from public.navigator_matter_access_events')).rows[0].count),
  });
  const invite = async (recipient = 'uid-lawyer', matter = M.a, owner = 'uid-owner') => {
    const res = await create(owner, emailOf(recipient), matter);
    expect(res.status).toBe(201);
    return { id: res.body.grant.id as string, token: res.body.invitationToken as string, res };
  };
  const unavailable410 = async (res: request.Response) => {
    expect(res.status).toBe(410);
    expect(res.body).toEqual({ code: 'INVITATION_UNAVAILABLE', error: 'This invitation cannot be used. Ask the matter owner for a new invitation.' });
    return res.text;
  };

  // ------------------------------------------------------------------ create (1-9)
  describe('create', () => {
    it('1. unauthenticated create is refused (401) and changes nothing', async () => {
      const before = await snapshot();
      expect((await create(null)).status).toBe(401);
      expect((await as(request(app).post(`/api/matters/${M.a}/access-grants`), 'uid-owner').set('Authorization', 'Bearer forged').send({ recipientEmail: 'a@b.c' })).status).toBe(401);
      expect(await snapshot()).toEqual(before);
    });

    it('2/3. a reviewer and a stranger cannot create (one indistinguishable 403); nothing changes', async () => {
      const g = await invite('uid-lawyer');
      expect((await accept('uid-lawyer', g.token)).status).toBe(200);
      const before = await snapshot();
      const bodies = new Set<string>();
      for (const uid of ['uid-lawyer', 'uid-stranger', 'uid-other', 'uid-suspended']) {
        const res = await create(uid, emailOf('uid-lawyer2'));
        expect(res.status).toBe(403);
        bodies.add(res.text);
      }
      expect(bodies.size).toBe(1);
      expect(await snapshot()).toEqual(before);
    });

    it('4/7. the owner creates; the raw token is returned exactly once with no-store and the canonical recipient', async () => {
      const res = await create('uid-owner', '  Lawyer@Example.TEST ');
      expect(res.status).toBe(201);
      expect(res.headers['cache-control']).toBe('no-store');
      expect(res.body.invitationToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
      expect(res.body.grant).toMatchObject({ status: 'PENDING', recipientEmail: 'lawyer@example.test' });
      expect(Object.keys(res.body).sort()).toEqual(['grant', 'invitationToken', 'matterId']);
      // Nothing ever returns it again: the owner report and history carry no token.
      const rep = await report('uid-owner');
      expect(rep.text).not.toContain(res.body.invitationToken);
      const hist = await as(request(app).get(`/api/matters/${M.a}/access-history`), 'uid-owner');
      expect(hist.text).not.toContain(res.body.invitationToken);
    });

    it('5/6. create requires a valid recipientEmail: missing, empty and malformed are one constant 400; nothing changes', async () => {
      const before = await snapshot();
      for (const r of [MISSING, null, '', 'not-an-email', 'a@b@c', 'prö@example.test', 'x'.repeat(251) + '@b.c', 42]) {
        const res = await create('uid-owner', r);
        expect({ r: String(r), status: res.status }).toEqual({ r: String(r), status: 400 });
        expect(res.body).toEqual({ code: 'INVALID_REQUEST', error: 'recipientEmail must be a valid email address.' });
      }
      expect(await snapshot()).toEqual(before);
    });

    it('8/9. the database stores the SHA-256 digest only; the raw token is in no grant column and no event', async () => {
      const g = await invite();
      const row = await grantRow(g.id);
      expect(row.token_digest).toBe(digest(g.token));
      expect(JSON.stringify(row)).not.toContain(g.token);
      const all = JSON.stringify((await db.query('select * from public.navigator_matter_access_events')).rows);
      expect(all).not.toContain(g.token);
      expect(all).not.toContain(digest(g.token));
      expect(all).not.toContain('@');
    });
  });

  // ------------------------------------------------------------------ accept (10-20, 32)
  describe('accept', () => {
    it('10/32. the matching verified recipient accepts; workspace access appears only after acceptance', async () => {
      const g = await invite('uid-lawyer');
      expect((await workspace('uid-lawyer')).body).toEqual([]);
      const res = await accept('uid-lawyer', g.token);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ matterId: M.a, role: 'REVIEWER' });
      expect(res.text).not.toContain('@');
      expect(await role(A.lawyer)).toBe('REVIEWER');
      const ws = await workspace('uid-lawyer');
      expect(ws.status).toBe(200);
      expect(ws.body.map((m: any) => m.id)).toEqual([M.a]);
      expect(await events()).toEqual(['GRANT_CREATED', 'GRANT_ACCEPTED', 'REVIEWER_ACCESS_ADDED']);
    });

    it('11/19/20. a mismatched verified user gets the unknown-token 410 and causes no mutation and no event', async () => {
      const g = await invite('uid-lawyer');
      const before = await snapshot();
      const mismatch = await unavailable410(await accept('uid-lawyer2', g.token));
      const unknown = await unavailable410(await accept('uid-lawyer2', fakeToken()));
      expect(mismatch).toBe(unknown);
      expect(await snapshot()).toEqual(before);
      expect(await workspace('uid-lawyer2').then(r => r.body)).toEqual([]);
      // Even an expired invitation is not expired by a non-recipient.
      await db.query(`update public.navigator_matter_access_grants set expires_at = now() - interval '1 minute' where id = $1`, [g.id]);
      const before2 = await snapshot();
      await unavailable410(await accept('uid-lawyer2', g.token));
      expect(await snapshot()).toEqual(before2);
      expect((await grantRow(g.id)).status).toBe('PENDING');
    });

    it('12. an unverified email cannot accept (token-independent 403), and changes nothing', async () => {
      const g = await invite('uid-lawyer');
      const before = await snapshot();
      const a = await accept('uid-lawyer', g.token, 'unv');
      const b = await accept('uid-lawyer', fakeToken(), 'unv');
      expect(a.status).toBe(403);
      expect(a.body.code).toBe('EMAIL_NOT_VERIFIED');
      expect(a.text).toBe(b.text);
      expect(await snapshot()).toEqual(before);
    });

    it('13. an inactive (suspended) recipient cannot accept, and nothing changes', async () => {
      const g = await invite('uid-suspended');
      const before = await snapshot();
      const res = await accept('uid-suspended', g.token);
      expect(res.status).toBe(403);
      expect(res.text).not.toMatch(/suspend/i);
      expect(await snapshot()).toEqual(before);
    });

    it('14/15. an owner (co-owner) and the grantor cannot accept; owners are never downgraded', async () => {
      const toCo = await invite('uid-coowner');
      expect((await accept('uid-coowner', toCo.token)).status).toBe(409);
      expect(await role(A.coOwner)).toBe('OWNER');
      const self = await invite('uid-owner');
      expect((await accept('uid-owner', self.token)).status).toBe(409);
      expect(await role(A.owner)).toBe('OWNER');
      // A grantor who has since left the matter still cannot accept their own invitation.
      const byCo = await invite('uid-coowner', M.a, 'uid-coowner');
      await db.query('delete from public.navigator_matter_members where matter_id = $1 and account_id = $2', [M.a, A.coOwner]);
      expect((await accept('uid-coowner', byCo.token)).status).toBe(409);
      expect(await role(A.coOwner)).toBeNull();
      expect((await grantRow(byCo.id)).status).toBe('PENDING');
    });

    it('16/17/18. unknown, revoked, used and expired invitations are one indistinguishable 410', async () => {
      const revokedG = await invite('uid-lawyer');
      expect((await revoke('uid-owner', revokedG.id)).status).toBe(200);
      const used = await invite('uid-lawyer');
      expect((await accept('uid-lawyer', used.token)).status).toBe(200);
      const expired = await invite('uid-lawyer');
      await db.query(`update public.navigator_matter_access_grants set expires_at = now() - interval '1 minute' where id = $1`, [expired.id]);
      const texts = new Set<string>();
      texts.add(await unavailable410(await accept('uid-lawyer', fakeToken())));
      texts.add(await unavailable410(await accept('uid-lawyer', revokedG.token)));
      texts.add(await unavailable410(await accept('uid-lawyer', used.token)));
      texts.add(await unavailable410(await accept('uid-lawyer', expired.token)));
      expect(texts.size).toBe(1);
      expect((await grantRow(expired.id)).status).toBe('EXPIRED'); // the recipient's own attempt persists expiry
    });

    it('the token is accepted only from the JSON body; body identity fields are refused', async () => {
      const g = await invite('uid-lawyer');
      const before = await snapshot();
      for (const req of [
        as(request(app).post(`/api/access-invitations/accept?token=${g.token}`), 'uid-lawyer').send({}),
        as(request(app).post('/api/access-invitations/accept'), 'uid-lawyer2').send({ token: g.token, email: emailOf('uid-lawyer') }),
        as(request(app).post('/api/access-invitations/accept'), 'uid-lawyer2').send({ token: g.token, emailVerified: true, uid: 'uid-lawyer' }),
      ]) expect((await req).status).toBe(400);
      expect(await snapshot()).toEqual(before);
    });
  });

  // ------------------------------------------------------------------ revoke (21-26)
  describe('revoke', () => {
    it('21. owner revokes a pending invitation: the link dies; GRANT_REVOKED only', async () => {
      const g = await invite('uid-lawyer');
      const res = await revoke('uid-owner', g.id);
      expect(res.status).toBe(200);
      expect(res.body).toEqual({ grantId: g.id, status: 'REVOKED', accessRemovedByThisRequest: false });
      await unavailable410(await accept('uid-lawyer', g.token));
      expect(await events()).toEqual(['GRANT_CREATED', 'GRANT_REVOKED']);
    });

    it('22/26. owner revokes accepted access; with two backing grants the first revoke keeps membership, the last removes it', async () => {
      const g1 = await invite('uid-lawyer');
      const g2 = await invite('uid-lawyer');
      expect((await accept('uid-lawyer', g1.token)).status).toBe(200);
      expect((await accept('uid-lawyer', g2.token)).status).toBe(200);
      const r1 = await revoke('uid-owner', g1.id);
      expect(r1.body.accessRemovedByThisRequest).toBe(false);
      expect(await role(A.lawyer)).toBe('REVIEWER');
      expect((await workspace('uid-lawyer')).body.map((m: any) => m.id)).toEqual([M.a]);
      const r2 = await revoke('uid-owner', g2.id);
      expect(r2.body.accessRemovedByThisRequest).toBe(true);
      expect(await role(A.lawyer)).toBeNull();
      expect((await workspace('uid-lawyer')).body).toEqual([]);
      const retry = await revoke('uid-owner', g2.id);
      expect(retry.status).toBe(200);
      expect(retry.body.accessRemovedByThisRequest).toBe(false);
    });

    it('23/24/25. reviewer, stranger, cross-matter owner and suspended cannot revoke: one 404, nothing changes', async () => {
      const g = await invite('uid-lawyer');
      expect((await accept('uid-lawyer', g.token)).status).toBe(200);
      const pending = await invite('uid-lawyer2');
      const before = await snapshot();
      const bodies = new Set<string>();
      for (const uid of ['uid-lawyer', 'uid-stranger', 'uid-other', 'uid-suspended']) {
        for (const id of [g.id, pending.id, crypto.randomUUID()]) {
          const res = await revoke(uid, id);
          expect(res.status).toBe(404);
          bodies.add(res.text);
        }
      }
      expect(bodies.size).toBe(1);
      expect(await snapshot()).toEqual(before);
    });
  });

  // ------------------------------------------------------------------ atomicity (27)
  describe('27. lifecycle event atomicity through the mounted routes', () => {
    const inject = async (eventType: string) => {
      await db.query(`create or replace function public.s8_fail() returns trigger language plpgsql as $$
        begin if new.event_type = '${eventType}' then raise exception 'S8_INJECTED secret'; end if; return new; end $$`);
      await db.query('create trigger s8_fail before insert on public.navigator_matter_access_events for each row execute function public.s8_fail()');
    };
    const clear = () => db.query('drop trigger if exists s8_fail on public.navigator_matter_access_events');

    it.each(['GRANT_CREATED', 'GRANT_ACCEPTED', 'REVIEWER_ACCESS_ADDED', 'GRANT_REVOKED', 'REVIEWER_ACCESS_REMOVED'])(
      'a failing %s rolls the whole HTTP transition back, with a fixed 503', async eventType => {
        const g = ['GRANT_CREATED'].includes(eventType) ? null : await invite('uid-lawyer');
        if (g && ['GRANT_REVOKED', 'REVIEWER_ACCESS_REMOVED'].includes(eventType)) expect((await accept('uid-lawyer', g.token)).status).toBe(200);
        const before = await snapshot();
        await inject(eventType);
        const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
        try {
          const res = eventType === 'GRANT_CREATED' ? await create('uid-owner')
            : ['GRANT_ACCEPTED', 'REVIEWER_ACCESS_ADDED'].includes(eventType) ? await accept('uid-lawyer', g!.token)
              : await revoke('uid-owner', g!.id);
          expect(res.status).toBe(503);
          expect(res.text).not.toMatch(/S8_INJECTED|secret|navigator_/);
          expect(spy.mock.calls.flat().join(' ')).not.toMatch(/S8_INJECTED|@|[A-Za-z0-9_-]{43}/);
        } finally {
          spy.mockRestore();
          await clear();
        }
        expect(await snapshot()).toEqual(before);
      });
  });

  // ------------------------------------------------------------------ limiters (28-30)
  describe('rate limiting on the mounted routes', () => {
    it('28/29. the per-account write limiter trips for one account; another account keeps its budget', async () => {
      for (let i = 0; i < LIFECYCLE_WRITE_LIMIT; i++) await unavailable410(await accept('uid-lawyer2', fakeToken()));
      const limited = await accept('uid-lawyer2', fakeToken());
      expect(limited.status).toBe(429);
      expect(limited.body).toEqual({ code: 'RATE_LIMITED', error: 'Too many invitation actions. Please wait a few minutes and try again.' });
      expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
      for (const s of ['uid-lawyer2', A.lawyer2, 'lawyer2@example.test']) expect(limited.text + JSON.stringify(limited.headers)).not.toContain(s);
      // A different IP does not reset it.
      expect((await accept('uid-lawyer2', fakeToken()).set('X-Forwarded-For', '198.51.100.7')).status).toBe(429);
      // Another account is unaffected, and so is the owner.
      await unavailable410(await accept('uid-stranger', fakeToken()));
      expect((await create('uid-owner')).status).toBe(201);
      // Keys are uids only: no token, digest or email is held.
      expect(lifecycleWriteLimiter.keys().sort()).toEqual(['uid-lawyer2', 'uid-owner', 'uid-stranger']);
    });

    it('unauthenticated requests never spend any account budget', async () => {
      for (let i = 0; i < LIFECYCLE_WRITE_LIMIT + 5; i++) expect((await accept(null, fakeToken())).status).toBe(401);
      expect(lifecycleWriteLimiter.size()).toBe(0);
    });

    it('30. the global per-IP /api limiter still applies to the lifecycle routes', async () => {
      // apiLimiter skips itself only while NODE_ENV === "test"; lift that for this test alone.
      const env = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      try {
        const statuses: number[] = [];
        for (let i = 0; i < 101; i++) statuses.push((await accept(null, fakeToken())).status);
        expect(statuses.slice(0, 100).every(s => s === 401)).toBe(true);
        expect(statuses[100]).toBe(429);
        const res = await accept('uid-lawyer', fakeToken());
        expect(res.status).toBe(429); // an authenticated account cannot bypass the IP limit
        expect(res.body.code).toBeUndefined(); // it is the IP limiter's response, not the account limiter's
      } finally {
        process.env.NODE_ENV = env;
      }
    });
  });

  // ------------------------------------------------------------------ privacy (31)
  describe('31. the owner report exposes recipient emails only to the owner', () => {
    it('owner sees them; reviewer, stranger, cross-matter owner, suspended and unauthenticated do not', async () => {
      const g = await invite('uid-lawyer');
      expect((await accept('uid-lawyer', g.token)).status).toBe(200);
      await invite('uid-lawyer2');
      const own = await report('uid-owner');
      expect(own.status).toBe(200);
      expect(own.body.grants.map((x: any) => x.recipientEmail).sort()).toEqual(['lawyer2@example.test', 'lawyer@example.test']);
      for (const x of own.body.grants) expect(Object.keys(x)).not.toContain('tokenDigest');
      expect(own.text).not.toContain('token_digest');
      for (const uid of ['uid-lawyer', 'uid-stranger', 'uid-other', 'uid-suspended', null]) {
        const res = await report(uid);
        expect(res.status).not.toBe(200);
        expect(res.text).not.toContain('@');
      }
      // Lifecycle refusals to unauthorized callers carry no identity either.
      for (const res of [await create('uid-lawyer', emailOf('uid-lawyer2')), await revoke('uid-stranger', g.id), await accept('uid-lawyer2', fakeToken())]) {
        expect(res.text).not.toContain('@');
        expect(res.text).not.toContain(SECRET_TITLE);
      }
    });
  });

  // ------------------------------------------------------------------ v4 prerequisite
  describe('the v4 contract is required at runtime', () => {
    it('on a database WITHOUT the v4 migration, all three mounted routes fail closed (503) and change nothing', async () => {
      svc.pool = v3db;
      await seed(v3db);
      const count = async () => Number((await v3db.query('select count(*) from public.navigator_matter_access_grants')).rows[0].count)
        + Number((await v3db.query('select count(*) from public.navigator_matter_access_events')).rows[0].count);
      const before = await count();
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
      try {
        const c = await create('uid-owner');
        const a = await accept('uid-lawyer', fakeToken());
        const r = await revoke('uid-owner', crypto.randomUUID());
        expect([c.status, a.status, r.status]).toEqual([503, 503, 503]);
        for (const x of [c, a, r]) expect(x.text).not.toMatch(/contract|navigator_|v4/i);
      } finally {
        spy.mockRestore();
      }
      expect(await count()).toBe(before);
    });
  });
});
