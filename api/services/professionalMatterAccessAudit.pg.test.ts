// Stage 10 slice 4: access lifecycle + audit event ATOMICITY -- REAL PostgreSQL.
//
// Full stack in a DISPOSABLE local database: accounts, matters/members, Stage 7B grants, the
// Stage 7B remediation (frozen a452c6c, contract v2), the slice 2 event log, and the slice 4 v3
// audited lifecycle. Exercises the real service code through a PostgREST-style adapter, plus
// direct SQL for failure injection and concurrency.
//
// Opt-in: NAVIGATOR_PG_TEST_ADMIN_URL=postgres://postgres@127.0.0.1:<port>/postgres (local only).

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pg from 'pg';
import { acceptProfessionalGrant, createProfessionalGrant, revokeProfessionalGrant } from './professionalMatterAccess';
import { getMatterAccessHistory } from './matterAccessHistory';
import { getMatterAccessAudit } from './matterAccessAudit';

const svc = vi.hoisted(() => ({ client: null as any, calls: [] as string[] }));

function isoRow(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]));
}

// PostgREST-style adapter: rpc(named args) plus the small select/eq subset the slice 1 report uses.
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
        // PostgREST returns timestamps as ISO strings, not Date objects.
        then: (res: any, rej: any) => run().then(r => ({ data: r.rows.map(isoRow), error: null }), e => ({ data: null, error: e })).then(res, rej),
      };
      return q;
    },
  };
}
vi.mock('./access', () => ({ getSupabase: () => adapter() }));
vi.mock('./access.js', () => ({ getSupabase: () => adapter() }));
async function findAccountPg(uid: string) {
  const r = await svc.client.query('select id, primary_role, status from public.accounts where firebase_uid = $1', [uid]);
  return r.rows[0] ? { id: r.rows[0].id, primaryRole: r.rows[0].primary_role, status: r.rows[0].status } : null;
}
vi.mock('./accounts', () => ({ findAccount: findAccountPg }));
vi.mock('./accounts.js', () => ({ findAccount: findAccountPg }));

const ADMIN_URL = process.env.NAVIGATOR_PG_TEST_ADMIN_URL;
const MIGRATIONS = path.resolve(__dirname, '../../supabase/migrations_pending_approval');
const F = {
  accounts: path.join(MIGRATIONS, 'create_accounts_foundation.sql'),
  grants: path.join(MIGRATIONS, 'create_navigator_matter_access_grants.sql'),
  remediation: path.join(MIGRATIONS, 'remediate_navigator_matter_access_grants_lifecycle.sql'),
  eventLog: path.join(MIGRATIONS, 'create_navigator_matter_access_event_log.sql'),
  v3: path.join(MIGRATIONS, 'create_navigator_matter_access_lifecycle_audit_v3.sql'),
};
const d = ADMIN_URL ? describe : describe.skip;
const sql = (f: string) => fs.readFileSync(f, 'utf8');
const digest = (raw: string) => crypto.createHash('sha256').update(raw).digest('hex');
function assertLocal(url: string) {
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error(`Refusing non-local host ${host}.`);
}
function mattersPrefix(): string {
  const s = sql(path.join(MIGRATIONS, 'create_navigator_matters_foundation.sql'));
  return s.slice(0, s.indexOf('alter table public.navigator_documents'));
}

const A = {
  owner: '12000000-0000-4000-8000-000000000001', coOwner: '12000000-0000-4000-8000-000000000002',
  lawyer: '12000000-0000-4000-8000-000000000003', lawyer2: '12000000-0000-4000-8000-000000000004',
  otherOwner: '12000000-0000-4000-8000-000000000005',
};
const M = { a: '22000000-0000-4000-8000-00000000000a', b: '22000000-0000-4000-8000-00000000000b' };

d('Stage 10 slice 4 -- lifecycle + audit atomicity on real PostgreSQL', () => {
  const suffix = crypto.randomBytes(6).toString('hex');
  const dbName = `navigator_stage10_s4_${suffix}`;
  let admin: pg.Client;
  let db: pg.Client;
  let url: string;

  async function newDb(name: string, files: string[]) {
    await admin.query(`create database ${name}`);
    const u = new URL(ADMIN_URL!);
    u.pathname = `/${name}`;
    const c = new pg.Client({ connectionString: u.toString() });
    await c.connect();
    await c.query(`do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
    end $$;`);
    await c.query(sql(F.accounts));
    await c.query(mattersPrefix());
    await c.query(sql(F.grants));
    for (const f of files) await c.query(sql(f));
    return { c, url: u.toString() };
  }

  beforeAll(async () => {
    assertLocal(ADMIN_URL!);
    admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    const created = await newDb(dbName, [F.remediation, F.eventLog, F.v3]);
    db = created.c;
    url = created.url;
    svc.client = db;
  }, 60_000);

  afterAll(async () => {
    await db?.end();
    if (admin) {
      const r = await admin.query(`select datname from pg_database where datname like $1`, [`%${suffix}`]);
      for (const row of r.rows) await admin.query(`drop database if exists ${row.datname} with (force)`);
      await admin.end();
    }
  });

  // The event log is append-only, so every test gets fresh matters/accounts and counts only its own rows.
  beforeEach(async () => {
    svc.client = db;
    svc.calls = [];
    await db.query('truncate public.navigator_matter_access_grants, public.navigator_matter_members, public.navigator_matters, public.clients, public.accounts cascade');
    await db.query(`insert into public.accounts (id, firebase_uid, primary_role) values
      ($1,'uid-owner','parent'), ($2,'uid-coowner','parent'), ($3,'uid-lawyer','lawyer'), ($4,'uid-lawyer2','lawyer'), ($5,'uid-other','parent')`,
      [A.owner, A.coOwner, A.lawyer, A.lawyer2, A.otherOwner]);
    M.a = crypto.randomUUID();
    M.b = crypto.randomUUID();
    for (const [m, o] of [[M.a, A.owner], [M.b, A.otherOwner]]) {
      const c = await db.query(`insert into public.clients (account_id, name) values ($1,'c') returning id`, [o]);
      await db.query(`insert into public.navigator_matters (id, account_id, client_id, title) values ($1,$2,$3,'m')`, [m, o, c.rows[0].id]);
      await db.query(`insert into public.navigator_matter_members (matter_id, account_id, role) values ($1,$2,'OWNER')`, [m, o]);
    }
    await db.query(`insert into public.navigator_matter_members (matter_id, account_id, role) values ($1,$2,'OWNER')`, [M.a, A.coOwner]);
  });

  const events = async (matter = M.a) => (await db.query(
    `select event_type, actor_kind, actor_account_id, actor_matter_role, subject_account_id, grant_id, outcome, occurred_at
     from public.navigator_matter_access_events where matter_id = $1 order by event_sequence`, [matter])).rows;
  const types = async (matter = M.a) => (await events(matter)).map(e => e.event_type);
  const grant = async (id: string) => (await db.query('select * from public.navigator_matter_access_grants where id = $1', [id])).rows[0];
  const role = async (acc: string, matter = M.a) =>
    (await db.query('select role from public.navigator_matter_members where matter_id = $1 and account_id = $2', [matter, acc])).rows[0]?.role ?? null;
  const create = async (matter = M.a, uid = 'uid-owner') => {
    const r = await createProfessionalGrant(uid, matter);
    return { id: r.grant.id, raw: r.rawToken };
  };
  const sqlCreate = async (uid: string, matter: string) => {
    const raw = crypto.randomBytes(16).toString('hex');
    const r = await db.query('select public.create_matter_grant($1,$2,$3,7) as r', [uid, matter, digest(raw)]);
    return { id: r.rows[0].r.id as string, raw };
  };

  // =============================================================== cardinality + content
  describe('one committed transition -> exactly its events', () => {
    it('create: grant PENDING and exactly one GRANT_CREATED, actor = verified owner, server time', async () => {
      const before = Date.now();
      const g = await create();
      expect((await grant(g.id)).status).toBe('PENDING');
      const ev = await events();
      expect(ev).toHaveLength(1);
      expect(ev[0]).toMatchObject({ event_type: 'GRANT_CREATED', actor_kind: 'ACCOUNT', actor_account_id: A.owner,
        actor_matter_role: 'OWNER', grant_id: g.id, subject_account_id: null, outcome: 'SUCCEEDED' });
      expect(new Date(ev[0].occurred_at).getTime()).toBeGreaterThan(before - 5000);
      expect(new Date(ev[0].occurred_at).getTime()).toBeLessThan(Date.now() + 5000);
    });

    it('accept: GRANT_ACCEPTED + REVIEWER_ACCESS_ADDED, actor and subject = the accepting reviewer', async () => {
      const g = await create();
      await acceptProfessionalGrant('uid-lawyer', g.raw);
      const ev = (await events()).slice(1);
      expect(ev.map(e => e.event_type)).toEqual(['GRANT_ACCEPTED', 'REVIEWER_ACCESS_ADDED']);
      for (const e of ev) expect(e).toMatchObject({ actor_account_id: A.lawyer, actor_matter_role: 'REVIEWER', subject_account_id: A.lawyer, grant_id: g.id });
    });

    it('a second accepted grant for a reviewer who already has access records GRANT_ACCEPTED only', async () => {
      const g1 = await create();
      const g2 = await create();
      await acceptProfessionalGrant('uid-lawyer', g1.raw);
      await acceptProfessionalGrant('uid-lawyer', g2.raw);
      expect(await types()).toEqual(['GRANT_CREATED', 'GRANT_CREATED', 'GRANT_ACCEPTED', 'REVIEWER_ACCESS_ADDED', 'GRANT_ACCEPTED']);
    });

    it('revoke the only grant: GRANT_REVOKED + REVIEWER_ACCESS_REMOVED; subject derived from the grant row', async () => {
      const g = await create();
      await acceptProfessionalGrant('uid-lawyer', g.raw);
      await revokeProfessionalGrant('uid-owner', g.id);
      const ev = (await events()).slice(3);
      expect(ev.map(e => e.event_type)).toEqual(['GRANT_REVOKED', 'REVIEWER_ACCESS_REMOVED']);
      for (const e of ev) expect(e).toMatchObject({ actor_account_id: A.owner, actor_matter_role: 'OWNER', subject_account_id: A.lawyer, grant_id: g.id });
    });

    it('revoke while another ACCEPTED grant backs access: GRANT_REVOKED only -- no false "access removed"', async () => {
      const g1 = await create();
      const g2 = await create();
      await acceptProfessionalGrant('uid-lawyer', g1.raw);
      await acceptProfessionalGrant('uid-lawyer', g2.raw);
      await revokeProfessionalGrant('uid-owner', g1.id);
      expect(await role(A.lawyer)).toBe('REVIEWER');
      expect((await types()).slice(5)).toEqual(['GRANT_REVOKED']);
      await revokeProfessionalGrant('uid-owner', g2.id);
      expect(await role(A.lawyer)).toBeNull();
      expect((await types()).slice(6)).toEqual(['GRANT_REVOKED', 'REVIEWER_ACCESS_REMOVED']);
    });

    it('revoke a PENDING invitation: GRANT_REVOKED with no subject and no access event', async () => {
      const g = await create();
      await revokeProfessionalGrant('uid-owner', g.id);
      const ev = (await events()).slice(1);
      expect(ev).toHaveLength(1);
      expect(ev[0]).toMatchObject({ event_type: 'GRANT_REVOKED', subject_account_id: null });
    });

    it('a co-owner who revokes is recorded as the actor (not the grantor)', async () => {
      const g = await create();
      await acceptProfessionalGrant('uid-lawyer', g.raw);
      await revokeProfessionalGrant('uid-coowner', g.id);
      const ev = (await events()).slice(3);
      for (const e of ev) expect(e.actor_account_id).toBe(A.coOwner);
    });

    it('uppercase / mixed-case grant id: one set of events with the canonical grant id', async () => {
      const g = await create();
      await acceptProfessionalGrant('uid-lawyer', g.raw);
      await revokeProfessionalGrant('uid-owner', g.id.toUpperCase());
      await revokeProfessionalGrant('uid-owner', g.id.split('').map((c, i) => (i % 2 ? c.toUpperCase() : c)).join(''));
      expect((await events()).slice(3).map(e => [e.event_type, e.grant_id])).toEqual([['GRANT_REVOKED', g.id], ['REVIEWER_ACCESS_REMOVED', g.id]]);
    });

    it('expiry: the persisted EXPIRED transition records exactly one SYSTEM GRANT_EXPIRED', async () => {
      const g = await create();
      await db.query(`update public.navigator_matter_access_grants set expires_at = now() - interval '1 minute' where id = $1`, [g.id]);
      await expect(acceptProfessionalGrant('uid-lawyer', g.raw)).rejects.toThrow(/expired/);
      expect((await grant(g.id)).status).toBe('EXPIRED');
      const ev = (await events()).slice(1);
      expect(ev).toHaveLength(1);
      expect(ev[0]).toMatchObject({ event_type: 'GRANT_EXPIRED', actor_kind: 'SYSTEM', actor_account_id: null, grant_id: g.id });
      await expect(acceptProfessionalGrant('uid-lawyer', g.raw)).rejects.toThrow(/no longer pending/);
      expect(await events()).toHaveLength(2);
    });

    it('a lapsed invitation nobody touches gets no fabricated expiry event', async () => {
      const g = await create();
      await db.query(`update public.navigator_matter_access_grants set expires_at = now() - interval '1 day' where id = $1`, [g.id]);
      expect((await grant(g.id)).status).toBe('PENDING');
      expect(await types()).toEqual(['GRANT_CREATED']);
    });

    it('re-revoke that clears a pre-remediation lingering membership records only REVIEWER_ACCESS_REMOVED', async () => {
      const g = await create();
      await acceptProfessionalGrant('uid-lawyer', g.raw);
      await db.query(`update public.navigator_matter_access_grants set status = 'REVOKED', revoked_at = now(), revoked_by_account_id = $2 where id = $1`, [g.id, A.owner]);
      await revokeProfessionalGrant('uid-owner', g.id);
      expect((await types()).slice(3)).toEqual(['REVIEWER_ACCESS_REMOVED']);
    });
  });

  // =============================================================== refusals, retries, idempotency
  describe('failed or repeated operations record nothing', () => {
    it.each([
      ['owner self-accept', async (g: any) => acceptProfessionalGrant('uid-owner', g.raw), /matter owner cannot accept/],
      ['co-owner accept', async (g: any) => acceptProfessionalGrant('uid-coowner', g.raw), /matter owner cannot accept/],
      ['malformed / unknown invitation token', async () => acceptProfessionalGrant('uid-lawyer', 'not-a-real-token'), /Invalid token/],
      ['unknown accepting account', async (g: any) => acceptProfessionalGrant('uid-nobody', g.raw), /unavailable/],
      ['unauthorized revoke (reviewer)', async (g: any) => revokeProfessionalGrant('uid-lawyer', g.id), /UNAUTHORIZED/],
      ['wrong-matter revoke (owner of another matter)', async (g: any) => revokeProfessionalGrant('uid-other', g.id), /UNAUTHORIZED/],
      ['unknown grant', async () => revokeProfessionalGrant('uid-owner', crypto.randomUUID()), /Grant not found/],
      ['malformed grant id', async () => revokeProfessionalGrant('uid-owner', 'nope'), /grantId must be a UUID/],
      ['create by a non-owner', async () => createProfessionalGrant('uid-lawyer', M.a), /UNAUTHORIZED/],
      ['create on another owner\'s matter', async () => createProfessionalGrant('uid-owner', M.b), /UNAUTHORIZED/],
    ])('%s', async (_l, op, err) => {
      const g = await create();
      const beforeA = await events(M.a);
      const beforeB = await events(M.b);
      const grantBefore = await grant(g.id);
      await expect(op(g)).rejects.toThrow(err);
      expect(await events(M.a)).toEqual(beforeA);
      expect(await events(M.b)).toEqual(beforeB);
      expect(await grant(g.id)).toEqual(grantBefore);
      expect(await role(A.owner)).toBe('OWNER');
    });

    it('accept twice (e.g. a retry after an ambiguous network failure): the second is refused, events unchanged', async () => {
      const g = await create();
      await acceptProfessionalGrant('uid-lawyer', g.raw);
      const before = await events();
      await expect(acceptProfessionalGrant('uid-lawyer', g.raw)).rejects.toThrow(/no longer pending/);
      expect(await events()).toEqual(before);
    });

    it('revoke twice: the retry succeeds idempotently and records nothing new', async () => {
      const g = await create();
      await acceptProfessionalGrant('uid-lawyer', g.raw);
      await revokeProfessionalGrant('uid-owner', g.id);
      const before = await events();
      await expect(revokeProfessionalGrant('uid-owner', g.id)).resolves.toEqual({ success: true, membershipRemoved: false });
      expect(await events()).toEqual(before);
    });
  });

  // =============================================================== failure injection
  describe('failure injection: the mutation and its events commit or roll back together', () => {
    async function withTrigger(table: string, when: string, body: string, fn: () => Promise<void>) {
      await db.query(`create or replace function public.t_inject() returns trigger language plpgsql as $$ begin ${body} end $$`);
      await db.query(`create trigger t_inject before ${when} on public.${table} for each row execute function public.t_inject()`);
      try { await fn(); } finally {
        await db.query(`drop trigger if exists t_inject on public.${table}`);
        await db.query('drop function if exists public.t_inject()');
      }
    }
    const failEvent = (type?: string) => type
      ? `if new.event_type = '${type}' then raise exception 'INJECTED_AUDIT_FAILURE'; end if; return new;`
      : `raise exception 'INJECTED_AUDIT_FAILURE';`;

    it('audit insert fails during CREATE -> no invitation row persists', async () => {
      await withTrigger('navigator_matter_access_events', 'insert', failEvent(), async () => {
        await expect(sqlCreate('uid-owner', M.a)).rejects.toThrow(/INJECTED_AUDIT_FAILURE/);
      });
      expect((await db.query('select count(*)::int as n from public.navigator_matter_access_grants')).rows[0].n).toBe(0);
      expect(await events()).toEqual([]);
    });

    it('audit insert fails during ACCEPT -> invitation stays PENDING, no membership, no events', async () => {
      const g = await create();
      await withTrigger('navigator_matter_access_events', 'insert', failEvent(), async () => {
        await expect(db.query('select public.accept_matter_grant($1,$2)', ['uid-lawyer', digest(g.raw)])).rejects.toThrow(/INJECTED_AUDIT_FAILURE/);
      });
      expect((await grant(g.id)).status).toBe('PENDING');
      expect(await role(A.lawyer)).toBeNull();
      expect(await types()).toEqual(['GRANT_CREATED']);
    });

    it('the SECOND event of an acceptance fails -> the first event AND the mutation roll back too', async () => {
      const g = await create();
      await withTrigger('navigator_matter_access_events', 'insert', failEvent('REVIEWER_ACCESS_ADDED'), async () => {
        await expect(db.query('select public.accept_matter_grant($1,$2)', ['uid-lawyer', digest(g.raw)])).rejects.toThrow(/INJECTED_AUDIT_FAILURE/);
      });
      expect((await grant(g.id)).status).toBe('PENDING');
      expect(await role(A.lawyer)).toBeNull();
      expect(await types()).toEqual(['GRANT_CREATED']);
    });

    it('audit insert fails during REVOKE -> grant stays ACCEPTED and access remains', async () => {
      const g = await create();
      await acceptProfessionalGrant('uid-lawyer', g.raw);
      await withTrigger('navigator_matter_access_events', 'insert', failEvent('REVIEWER_ACCESS_REMOVED'), async () => {
        await expect(db.query('select public.revoke_matter_grant($1,$2)', ['uid-owner', g.id])).rejects.toThrow(/INJECTED_AUDIT_FAILURE/);
      });
      expect((await grant(g.id)).status).toBe('ACCEPTED');
      expect(await role(A.lawyer)).toBe('REVIEWER');
      expect(await types()).toEqual(['GRANT_CREATED', 'GRANT_ACCEPTED', 'REVIEWER_ACCESS_ADDED']);
    });

    it('audit failure during EXPIRY -> status stays PENDING and no event', async () => {
      const g = await create();
      await db.query(`update public.navigator_matter_access_grants set expires_at = now() - interval '1 minute' where id = $1`, [g.id]);
      await withTrigger('navigator_matter_access_events', 'insert', failEvent(), async () => {
        await expect(db.query('select public.accept_matter_grant($1,$2)', ['uid-lawyer', digest(g.raw)])).rejects.toThrow(/INJECTED_AUDIT_FAILURE/);
      });
      expect((await grant(g.id)).status).toBe('PENDING');
      expect(await types()).toEqual(['GRANT_CREATED']);
    });

    // Each required event, failing ALONE, must roll back the whole transition -- so a swallowed or
    // non-transactional write of any single event type is detected.
    it.each([
      ['GRANT_CREATED', 'create'],
      ['GRANT_ACCEPTED', 'first acceptance'],
      ['REVIEWER_ACCESS_ADDED', 'first acceptance'],
      ['GRANT_ACCEPTED', 'second-grant acceptance (its only event)'],
      ['GRANT_REVOKED', 'revoke'],
      ['REVIEWER_ACCESS_REMOVED', 'revoke'],
      ['GRANT_EXPIRED', 'expiry'],
    ])('only %s fails during %s -> nothing about that transition persists', async (eventType, op) => {
      const setup = op === 'create' ? null : await create();
      const second = op.startsWith('second') ? await create() : null;
      if (op.startsWith('second')) await acceptProfessionalGrant('uid-lawyer', setup!.raw);
      if (op === 'revoke') await acceptProfessionalGrant('uid-lawyer', setup!.raw);
      if (op === 'expiry') await db.query(`update public.navigator_matter_access_grants set expires_at = now() - interval '1 minute' where id = $1`, [setup!.id]);
      const grantsBefore = (await db.query('select id, status, accepted_by_account_id, revoked_at from public.navigator_matter_access_grants order by id')).rows;
      const membersBefore = (await db.query('select account_id, role from public.navigator_matter_members where matter_id = $1 order by account_id', [M.a])).rows;
      const eventsBefore = await events();
      await withTrigger('navigator_matter_access_events', 'insert', failEvent(eventType), async () => {
        const call = op === 'create' ? sqlCreate('uid-owner', M.a)
          : op === 'revoke' ? db.query('select public.revoke_matter_grant($1,$2)', ['uid-owner', setup!.id])
          : db.query('select public.accept_matter_grant($1,$2)', ['uid-lawyer', digest((second ?? setup)!.raw)]);
        await expect(call).rejects.toThrow(/INJECTED_AUDIT_FAILURE/);
      });
      expect((await db.query('select id, status, accepted_by_account_id, revoked_at from public.navigator_matter_access_grants order by id')).rows).toEqual(grantsBefore);
      expect((await db.query('select account_id, role from public.navigator_matter_members where matter_id = $1 order by account_id', [M.a])).rows).toEqual(membersBefore);
      expect(await events()).toEqual(eventsBefore);
    });

    it('the service reports failure (and no success) when the audit write fails', async () => {
      const g = await create();
      await withTrigger('navigator_matter_access_events', 'insert', failEvent(), async () => {
        await expect(acceptProfessionalGrant('uid-lawyer', g.raw)).rejects.toThrow(/Acceptance failed/);
        await expect(revokeProfessionalGrant('uid-owner', g.id)).rejects.toThrow(/Revocation failed/);
        await expect(createProfessionalGrant('uid-owner', M.a)).rejects.toThrow(/Failed to create grant/);
      });
      expect((await grant(g.id)).status).toBe('PENDING');
    });

    it('the membership mutation fails during ACCEPT -> no acceptance events exist', async () => {
      const g = await create();
      await withTrigger('navigator_matter_members', 'insert', `raise exception 'INJECTED_MUTATION_FAILURE';`, async () => {
        await expect(db.query('select public.accept_matter_grant($1,$2)', ['uid-lawyer', digest(g.raw)])).rejects.toThrow(/INJECTED_MUTATION_FAILURE/);
      });
      expect((await grant(g.id)).status).toBe('PENDING');
      expect(await types()).toEqual(['GRANT_CREATED']);
    });

    it('the grant update fails during REVOKE -> no revocation events exist', async () => {
      const g = await create();
      await acceptProfessionalGrant('uid-lawyer', g.raw);
      await withTrigger('navigator_matter_access_grants', 'update', `raise exception 'INJECTED_MUTATION_FAILURE';`, async () => {
        await expect(db.query('select public.revoke_matter_grant($1,$2)', ['uid-owner', g.id])).rejects.toThrow(/INJECTED_MUTATION_FAILURE/);
      });
      expect(await role(A.lawyer)).toBe('REVIEWER');
      expect(await types()).toEqual(['GRANT_CREATED', 'GRANT_ACCEPTED', 'REVIEWER_ACCESS_ADDED']);
    });

    it('the grant insert fails during CREATE -> no GRANT_CREATED event', async () => {
      await withTrigger('navigator_matter_access_grants', 'insert', `raise exception 'INJECTED_MUTATION_FAILURE';`, async () => {
        await expect(sqlCreate('uid-owner', M.a)).rejects.toThrow(/INJECTED_MUTATION_FAILURE/);
      });
      expect(await events()).toEqual([]);
    });

    it('a constraint violation on the event log rolls back the whole revocation', async () => {
      const g = await create();
      await acceptProfessionalGrant('uid-lawyer', g.raw);
      await db.query(`alter table public.navigator_matter_access_events add constraint t_inject_no_revoke check (event_type <> 'GRANT_REVOKED') not valid`);
      try {
        await expect(db.query('select public.revoke_matter_grant($1,$2)', ['uid-owner', g.id])).rejects.toThrow(/t_inject_no_revoke/);
      } finally {
        await db.query('alter table public.navigator_matter_access_events drop constraint t_inject_no_revoke');
      }
      expect((await grant(g.id)).status).toBe('ACCEPTED');
      expect(await role(A.lawyer)).toBe('REVIEWER');
    });
  });

  // =============================================================== concurrency
  describe('concurrency: events always match committed state', () => {
    async function clients(n: number) {
      return Promise.all(Array.from({ length: n }, async () => { const c = new pg.Client({ connectionString: url }); await c.connect(); return c; }));
    }
    // Invariant for one reviewer on one matter, starting from no access:
    //   #REVIEWER_ACCESS_ADDED - #REVIEWER_ACCESS_REMOVED == (membership exists ? 1 : 0)
    //   #GRANT_ACCEPTED == grants with accepted_at; #GRANT_REVOKED == grants REVOKED; owner intact.
    async function checkInvariant(reviewer: string) {
      const ev = await events();
      const count = (t: string, subject?: string) => ev.filter(e => e.event_type === t && (!subject || e.subject_account_id === subject)).length;
      const member = (await role(reviewer)) === 'REVIEWER' ? 1 : 0;
      expect(count('REVIEWER_ACCESS_ADDED', reviewer) - count('REVIEWER_ACCESS_REMOVED', reviewer)).toBe(member);
      const g = (await db.query('select status, accepted_at from public.navigator_matter_access_grants where matter_id = $1', [M.a])).rows;
      expect(count('GRANT_ACCEPTED')).toBe(g.filter(x => x.accepted_at !== null).length);
      expect(count('GRANT_REVOKED')).toBe(g.filter(x => x.status === 'REVOKED').length);
      expect(count('GRANT_CREATED')).toBe(g.length);
      expect(await role(A.owner)).toBe('OWNER');
    }

    const scenarios: Record<string, (c: pg.Client[]) => Promise<{ reviewer: string }>> = {
      'accept/accept (same grant, same reviewer)': async c => {
        const g = await sqlCreate('uid-owner', M.a);
        await Promise.allSettled([0, 1].map(i => c[i].query('select public.accept_matter_grant($1,$2)', ['uid-lawyer', digest(g.raw)])));
        return { reviewer: A.lawyer };
      },
      'accept/accept (same grant, two reviewers)': async c => {
        const g = await sqlCreate('uid-owner', M.a);
        await Promise.allSettled([c[0].query('select public.accept_matter_grant($1,$2)', ['uid-lawyer', digest(g.raw)]),
          c[1].query('select public.accept_matter_grant($1,$2)', ['uid-lawyer2', digest(g.raw)])]);
        const winners = (await events()).filter(e => e.event_type === 'GRANT_ACCEPTED');
        expect(winners).toHaveLength(1);
        return { reviewer: winners[0].subject_account_id };
      },
      'revoke/revoke (same grant)': async c => {
        const g = await sqlCreate('uid-owner', M.a);
        await db.query('select public.accept_matter_grant($1,$2)', ['uid-lawyer', digest(g.raw)]);
        await Promise.allSettled([c[0].query('select public.revoke_matter_grant($1,$2)', ['uid-owner', g.id]),
          c[1].query('select public.revoke_matter_grant($1,$2)', ['uid-coowner', g.id])]);
        expect((await events()).filter(e => e.event_type === 'GRANT_REVOKED')).toHaveLength(1);
        return { reviewer: A.lawyer };
      },
      'accept/revoke (same grant)': async c => {
        const g = await sqlCreate('uid-owner', M.a);
        await Promise.allSettled([c[0].query('select public.accept_matter_grant($1,$2)', ['uid-lawyer', digest(g.raw)]),
          c[1].query('select public.revoke_matter_grant($1,$2)', ['uid-owner', g.id])]);
        expect(await role(A.lawyer)).toBeNull();
        return { reviewer: A.lawyer };
      },
      'revoke A / revoke B (two grants, same reviewer)': async c => {
        const a = await sqlCreate('uid-owner', M.a);
        const b = await sqlCreate('uid-owner', M.a);
        await db.query('select public.accept_matter_grant($1,$2)', ['uid-lawyer', digest(a.raw)]);
        await db.query('select public.accept_matter_grant($1,$2)', ['uid-lawyer', digest(b.raw)]);
        await Promise.allSettled([c[0].query('select public.revoke_matter_grant($1,$2)', ['uid-owner', a.id]),
          c[1].query('select public.revoke_matter_grant($1,$2)', ['uid-owner', b.id])]);
        expect(await role(A.lawyer)).toBeNull();
        expect((await events()).filter(e => e.event_type === 'REVIEWER_ACCESS_REMOVED')).toHaveLength(1);
        return { reviewer: A.lawyer };
      },
      'revoke A / accept B (same reviewer)': async c => {
        const a = await sqlCreate('uid-owner', M.a);
        const b = await sqlCreate('uid-owner', M.a);
        await db.query('select public.accept_matter_grant($1,$2)', ['uid-lawyer', digest(a.raw)]);
        await Promise.allSettled([c[0].query('select public.revoke_matter_grant($1,$2)', ['uid-owner', a.id]),
          c[1].query('select public.accept_matter_grant($1,$2)', ['uid-lawyer', digest(b.raw)])]);
        expect(await role(A.lawyer)).toBe('REVIEWER');
        return { reviewer: A.lawyer };
      },
    };

    it.each(Object.keys(scenarios))('%s x15: invariant holds, no deadlocks', async name => {
      const c = await clients(2);
      let deadlocks = 0;
      try {
        for (let i = 0; i < 15; i++) {
          await db.query('truncate public.navigator_matter_access_grants cascade');
          await db.query(`delete from public.navigator_matter_members where role = 'REVIEWER'`);
          // Fresh matter per iteration so each iteration's events are isolated.
          const cl = await db.query(`insert into public.clients (account_id, name) values ($1,'c') returning id`, [A.owner]);
          M.a = crypto.randomUUID();
          await db.query(`insert into public.navigator_matters (id, account_id, client_id, title) values ($1,$2,$3,'m')`, [M.a, A.owner, cl.rows[0].id]);
          await db.query(`insert into public.navigator_matter_members (matter_id, account_id, role) values ($1,$2,'OWNER'), ($1,$3,'OWNER')`, [M.a, A.owner, A.coOwner]);
          const origQuery = c.map(x => x.query.bind(x));
          c.forEach((x, k) => { (x as any).query = (...args: any[]) => origQuery[k](...args).catch((e: any) => { if (/deadlock/i.test(e.message)) deadlocks++; throw e; }); });
          const { reviewer } = await scenarios[name](c);
          c.forEach((x, k) => { (x as any).query = origQuery[k]; });
          await checkInvariant(reviewer);
        }
      } finally {
        await Promise.all(c.map(x => x.end()));
      }
      expect(deadlocks).toBe(0);
    }, 60_000);
  });

  // =============================================================== authority, contract, privileges
  describe('authority, contract and privileges', () => {
    it('no lifecycle function accepts an actor, role, subject, outcome or timestamp parameter', async () => {
      const r = await db.query(`select proname, proargnames from pg_proc where proname in ('create_matter_grant','accept_matter_grant','revoke_matter_grant') order by proname`);
      expect(r.rows).toEqual([
        { proname: 'accept_matter_grant', proargnames: ['p_firebase_uid', 'p_token_digest'] },
        { proname: 'create_matter_grant', proargnames: ['p_firebase_uid', 'p_matter_id', 'p_token_digest', 'p_expires_in_days'] },
        { proname: 'revoke_matter_grant', proargnames: ['p_firebase_uid', 'p_grant_id'] },
      ]);
    });

    it('frozen v2 contract is unchanged; v3 contract exists; both are constant, non-definer and service_role-only', async () => {
      expect((await db.query('select public.navigator_matter_access_lifecycle_contract() as v')).rows[0].v).toBe('navigator_matter_access_lifecycle_v2');
      expect((await db.query('select public.navigator_matter_access_lifecycle_contract_v3() as v')).rows[0].v).toBe('navigator_matter_access_lifecycle_v3');
      for (const fn of ['public.navigator_matter_access_lifecycle_contract_v3()', 'public.create_matter_grant(text, uuid, text, integer)',
        'public.accept_matter_grant(text, text)', 'public.revoke_matter_grant(text, uuid)']) {
        for (const role of ['public', 'anon', 'authenticated']) {
          expect((await db.query(`select has_function_privilege($1, $2, 'execute') as ok`, [role, fn])).rows[0].ok).toBe(false);
        }
        expect((await db.query(`select has_function_privilege('service_role', $1, 'execute') as ok`, [fn])).rows[0].ok).toBe(true);
      }
      const v3 = (await db.query(`select prosecdef, provolatile from pg_proc where proname = 'navigator_matter_access_lifecycle_contract_v3'`)).rows[0];
      expect(v3).toEqual({ prosecdef: false, provolatile: 'i' });
    });

    it('create validates the token digest and expiry inside the database', async () => {
      await expect(db.query('select public.create_matter_grant($1,$2,$3,7)', ['uid-owner', M.a, 'not-hex'])).rejects.toThrow(/INVALID_REQUEST/);
      for (const days of [0, -1, 366]) {
        await expect(db.query('select public.create_matter_grant($1,$2,$3,$4)', ['uid-owner', M.a, digest('x' + days), days])).rejects.toThrow(/INVALID_REQUEST/);
      }
      expect(await events()).toEqual([]);
    });

    it('the v3 migration refuses to install without its prerequisites (deployment order is enforced)', async () => {
      const noRemediation = await newDb(`navigator_stage10_s4_norem_${suffix}`, [F.eventLog]);
      try {
        await expect(noRemediation.c.query(sql(F.v3))).rejects.toThrow(/PREREQUISITE_MISSING.*remediate/);
        await noRemediation.c.query('rollback'); // what a migration runner does after a failed script
      } finally {
        await noRemediation.c.end();
      }
      const noEventLog = await newDb(`navigator_stage10_s4_nolog_${suffix}`, [F.remediation]);
      try {
        await expect(noEventLog.c.query(sql(F.v3))).rejects.toThrow(/PREREQUISITE_MISSING.*event_log/);
        await noEventLog.c.query('rollback');
        // Failed install is fully rolled back: nothing from v3 exists and the frozen v2 contract is live.
        expect((await noEventLog.c.query(`select to_regprocedure('public.create_matter_grant(text, uuid, text, integer)') is null as absent`)).rows[0].absent).toBe(true);
        expect((await noEventLog.c.query(`select to_regprocedure('public.navigator_matter_access_lifecycle_contract_v3()') is null as absent`)).rows[0].absent).toBe(true);
        expect((await noEventLog.c.query('select public.navigator_matter_access_lifecycle_contract() as v')).rows[0].v).toBe('navigator_matter_access_lifecycle_v2');
      } finally {
        await noEventLog.c.end();
      }
    });

    it('rollback compatibility: the frozen Stage 7B (v2) application keeps working on a v3 database and its accept/revoke are audited', async () => {
      const g = await sqlCreate('uid-owner', M.a);
      // What the frozen a452c6c service does: v2 gate, then the same RPCs.
      expect((await db.query('select public.navigator_matter_access_lifecycle_contract() as v')).rows[0].v).toBe('navigator_matter_access_lifecycle_v2');
      await db.query('select public.accept_matter_grant($1,$2)', ['uid-lawyer', digest(g.raw)]);
      await db.query('select public.revoke_matter_grant($1,$2)', ['uid-owner', g.id]);
      expect(await types()).toEqual(['GRANT_CREATED', 'GRANT_ACCEPTED', 'REVIEWER_ACCESS_ADDED', 'GRANT_REVOKED', 'REVIEWER_ACCESS_REMOVED']);
    });
  });

  // =============================================================== read model + current state
  describe('slice 1 and slice 3 compatibility', () => {
    it('history shows the real committed transitions; current-state report is computed independently from live rows', async () => {
      const g1 = await create();
      const g2 = await create();
      await acceptProfessionalGrant('uid-lawyer', g1.raw);
      await acceptProfessionalGrant('uid-lawyer', g2.raw);
      await revokeProfessionalGrant('uid-owner', g1.id);

      const history = await getMatterAccessHistory('uid-owner', M.a, { pageSize: 100 });
      expect(history.basis).toBe('HISTORICAL_EVENTS');
      expect(history.entries.map(e => e.summary)).toEqual([
        'Access invitation created', 'Access invitation created', 'Access invitation accepted', 'Reviewer access added',
        'Access invitation accepted', 'Access invitation revoked',
      ]);
      expect(history.entries.some(e => e.summary === 'Reviewer access removed')).toBe(false);

      const current = await getMatterAccessAudit('uid-owner', M.a);
      const reviewer = current.currentAccess.find(a => a.accountId === A.lawyer)!;
      expect(reviewer).toMatchObject({ role: 'REVIEWER', basis: 'ACCEPTED_GRANT', backingGrantIds: [g2.id] });
      expect(current.integrityFindings).toEqual([]);

      const reviewerView = await getMatterAccessHistory('uid-lawyer', M.a, { pageSize: 100 });
      expect(reviewerView.scope).toBe('SELF');
      for (const e of reviewerView.entries) expect(e.actor.accountId === A.lawyer || e.subject?.accountId === A.lawyer).toBe(true);
    });

    it('history is not authority: deleting the event-backed membership out-of-band is reported by the current-state report', async () => {
      const g = await create();
      await acceptProfessionalGrant('uid-lawyer', g.raw);
      await db.query(`delete from public.navigator_matter_members where matter_id = $1 and account_id = $2`, [M.a, A.lawyer]);
      const current = await getMatterAccessAudit('uid-owner', M.a);
      expect(current.currentAccess.find(a => a.accountId === A.lawyer)).toBeUndefined();
      expect(current.integrityFindings.map(f => f.code)).toContain('ACCEPTED_GRANT_WITHOUT_MEMBERSHIP');
      // History still (correctly) says access was added at the time.
      expect((await getMatterAccessHistory('uid-owner', M.a)).entries.map(e => e.eventType)).toContain('REVIEWER_ACCESS_ADDED');
    });
  });

  it('privacy: lifecycle events carry identifiers and fixed vocabulary only', async () => {
    const g = await create();
    await acceptProfessionalGrant('uid-lawyer', g.raw);
    const cols = (await db.query(`select column_name from information_schema.columns where table_name = 'navigator_matter_access_events' order by ordinal_position`)).rows.map(r => r.column_name);
    expect(cols).toEqual(['id', 'event_sequence', 'matter_id', 'event_type', 'actor_kind', 'actor_account_id', 'actor_matter_role',
      'subject_account_id', 'grant_id', 'outcome', 'reason_code', 'idempotency_key', 'occurred_at']);
    const raw = JSON.stringify((await db.query('select * from public.navigator_matter_access_events')).rows);
    expect(raw).not.toContain(g.raw);
    expect(raw).not.toContain(digest(g.raw));
  });
});
