// Stage 10 append-only access event log: REAL PostgreSQL integration tests.
//
// Loads the real pending migrations (accounts, the account/client/matter/member portion of the
// matters foundation, the Stage 7B grants TABLE migration, and the Stage 10 event-log migration)
// into a DISPOSABLE local database and exercises the SQL directly, plus the TypeScript service
// through a PostgREST-style RPC adapter.
//
// Opt-in: NAVIGATOR_PG_TEST_ADMIN_URL=postgres://postgres@127.0.0.1:<port>/postgres
// Non-local hosts are refused; each run creates and drops its own database.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pg from 'pg';
import { listMatterAccessEvents, recordMatterAccessEvent } from './matterAccessEvents';

const svc = vi.hoisted(() => ({ client: null as any }));
vi.mock('./access.js', () => ({
  getSupabase: () => ({
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
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

const ADMIN_URL = process.env.NAVIGATOR_PG_TEST_ADMIN_URL;
const MIGRATIONS = path.resolve(__dirname, '../../supabase/migrations_pending_approval');

function assertLocal(url: string) {
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') {
    throw new Error(`Refusing to run destructive integration tests against non-local host ${host}.`);
  }
}

function mattersFoundationPrefix(): string {
  const sql = fs.readFileSync(path.join(MIGRATIONS, 'create_navigator_matters_foundation.sql'), 'utf8');
  const cut = sql.indexOf('alter table public.navigator_documents');
  if (cut < 0) throw new Error('Unexpected matters foundation layout.');
  return sql.slice(0, cut);
}

const d = ADMIN_URL ? describe : describe.skip;

// Fixed identities (UUID v4 shape so the service's validators accept them).
const A = {
  owner: '10000000-0000-4000-8000-000000000001',
  owner2: '10000000-0000-4000-8000-000000000002',
  rev1: '10000000-0000-4000-8000-000000000003',
  rev2: '10000000-0000-4000-8000-000000000004',
  revoked: '10000000-0000-4000-8000-000000000005',
  suspended: '10000000-0000-4000-8000-000000000006',
  stranger: '10000000-0000-4000-8000-000000000007',
};
const M = { a: '20000000-0000-4000-8000-00000000000a', b: '20000000-0000-4000-8000-00000000000b' };
const G = { a1: '30000000-0000-4000-8000-0000000000a1', a2: '30000000-0000-4000-8000-0000000000a2', b1: '30000000-0000-4000-8000-0000000000b1' };

d('Stage 10 append-only access event log -- real PostgreSQL', () => {
  const dbName = `navigator_stage10_events_${crypto.randomBytes(6).toString('hex')}`;
  let admin: pg.Client;
  let db: pg.Client;
  let url: string;

  beforeAll(async () => {
    assertLocal(ADMIN_URL!);
    admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    const u = new URL(ADMIN_URL!);
    u.pathname = `/${dbName}`;
    url = u.toString();
    db = new pg.Client({ connectionString: url });
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
    await db.query(fs.readFileSync(path.join(MIGRATIONS, 'create_navigator_matter_access_event_log.sql'), 'utf8'));

    await db.query(`insert into public.accounts (id, firebase_uid, primary_role, status) values
      ('${A.owner}','uid-owner','parent','active'), ('${A.owner2}','uid-owner2','parent','active'),
      ('${A.rev1}','uid-rev1','lawyer','active'), ('${A.rev2}','uid-rev2','lawyer','active'),
      ('${A.revoked}','uid-revoked','lawyer','active'), ('${A.suspended}','uid-suspended','parent','suspended'),
      ('${A.stranger}','uid-stranger','parent','active')`);
    for (const [m, o] of [[M.a, A.owner], [M.b, A.owner2]]) {
      const c = await db.query(`insert into public.clients (account_id, name) values ($1, 'c') returning id`, [o]);
      await db.query(`insert into public.navigator_matters (id, account_id, client_id, title) values ($1, $2, $3, 'm')`, [m, o, c.rows[0].id]);
    }
    await db.query(`insert into public.navigator_matter_members (matter_id, account_id, role) values
      ('${M.a}','${A.owner}','OWNER'), ('${M.a}','${A.suspended}','OWNER'), ('${M.b}','${A.owner2}','OWNER'),
      ('${M.a}','${A.rev1}','REVIEWER'), ('${M.a}','${A.rev2}','REVIEWER'), ('${M.b}','${A.rev1}','REVIEWER')`);
    await db.query(`insert into public.navigator_matter_access_grants (id, matter_id, grantor_account_id, token_digest, expires_at) values
      ('${G.a1}','${M.a}','${A.owner}','t-a1', now() + interval '7 days'),
      ('${G.a2}','${M.a}','${A.owner}','t-a2', now() + interval '7 days'),
      ('${G.b1}','${M.b}','${A.owner2}','t-b1', now() + interval '7 days')`);
    svc.client = db;
  }, 60_000);

  afterAll(async () => {
    await db?.end();
    if (admin) {
      await admin.query(`drop database if exists ${dbName} with (force)`);
      await admin.end();
    }
  });

  // Rows are append-only, so tests isolate themselves by counting only rows they create.
  const count = async (where = 'true', params: unknown[] = []) =>
    Number((await db.query(`select count(*) from public.navigator_matter_access_events where ${where}`, params)).rows[0].count);

  const rec = (args: {
    uid: string | null; matter: string; type: string; outcome?: string;
    subject?: string | null; grant?: string | null; reason?: string | null; key?: string | null;
  }) => db.query(
    `select public.record_matter_access_event(p_actor_firebase_uid => $1, p_matter_id => $2, p_event_type => $3,
       p_outcome => $4, p_subject_account_id => $5, p_grant_id => $6, p_reason_code => $7, p_idempotency_key => $8) as id`,
    [args.uid, args.matter, args.type, args.outcome ?? 'SUCCEEDED', args.subject ?? null, args.grant ?? null, args.reason ?? null, args.key ?? null],
  ).then(r => r.rows[0].id as string);

  const row = (id: string) => db.query('select * from public.navigator_matter_access_events where id = $1', [id]).then(r => r.rows[0]);
  const list = (uid: string, matter: string, after = 0, limit = 200) =>
    db.query('select public.list_matter_access_events($1, $2, $3, $4) as r', [uid, matter, after, limit]).then(r => r.rows[0].r);

  // ----------------------------------------------------------------- write path / actor verification
  it('derives actor account, actor matter role and server timestamp', async () => {
    const before = Date.now();
    const id = await rec({ uid: 'uid-owner', matter: M.a, type: 'GRANT_CREATED', grant: G.a1 });
    const r = await row(id);
    expect(r).toMatchObject({ matter_id: M.a, event_type: 'GRANT_CREATED', actor_kind: 'ACCOUNT', actor_account_id: A.owner,
      actor_matter_role: 'OWNER', grant_id: G.a1, outcome: 'SUCCEEDED', subject_account_id: null, reason_code: null });
    expect(new Date(r.occurred_at).getTime()).toBeGreaterThanOrEqual(before - 5_000);
    expect(new Date(r.occurred_at).getTime()).toBeLessThanOrEqual(Date.now() + 5_000);
    expect(Number(r.event_sequence)).toBeGreaterThan(0);
  });

  it('records the actor role as it stands on THIS matter (REVIEWER here, NONE for a non-member)', async () => {
    const asReviewer = await row(await rec({ uid: 'uid-rev1', matter: M.a, type: 'GRANT_ACCEPTED', grant: G.a1, subject: A.rev1 }));
    expect(asReviewer.actor_matter_role).toBe('REVIEWER');
    const asStranger = await row(await rec({ uid: 'uid-stranger', matter: M.a, type: 'GRANT_ACCEPTED', grant: G.a2, subject: A.stranger,
      outcome: 'REFUSED', reason: 'INVALID_STATE' }));
    expect(asStranger).toMatchObject({ actor_account_id: A.stranger, actor_matter_role: 'NONE' });
  });

  it('exposes no parameter through which a caller could supply actor id, role, kind or timestamp', async () => {
    const r = await db.query(`select proargnames from pg_proc where proname = 'record_matter_access_event'`);
    expect(r.rows).toHaveLength(1);
    expect(r.rows[0].proargnames).toEqual(['p_actor_firebase_uid', 'p_matter_id', 'p_event_type', 'p_outcome',
      'p_subject_account_id', 'p_grant_id', 'p_reason_code', 'p_idempotency_key']);
  });

  it('SYSTEM actor is allowed only for GRANT_EXPIRED', async () => {
    const id = await rec({ uid: null, matter: M.a, type: 'GRANT_EXPIRED', grant: G.a2 });
    expect(await row(id)).toMatchObject({ actor_kind: 'SYSTEM', actor_account_id: null, actor_matter_role: 'SYSTEM' });
    await expect(rec({ uid: null, matter: M.a, type: 'GRANT_REVOKED', grant: G.a2 })).rejects.toThrow(/system_scope/);
  });

  it.each([
    [{ type: 'GRANT_DESTROYED' }, /INVALID_EVENT_TYPE/],
    [{ type: 'grant_created' }, /INVALID_EVENT_TYPE/],
    [{ type: 'GRANT_CREATED', outcome: 'MAYBE' }, /INVALID_OUTCOME/],
    [{ type: 'GRANT_CREATED', matter: '20000000-0000-4000-8000-0000000000ff' }, /MATTER_NOT_FOUND/],
    [{ type: 'GRANT_CREATED', uid: 'uid-nobody' }, /ACTOR_NOT_FOUND/],
    [{ type: 'GRANT_ACCEPTED', subject: '10000000-0000-4000-8000-0000000000ff' }, /SUBJECT_NOT_FOUND/],
    [{ type: 'GRANT_CREATED', grant: G.b1 }, /GRANT_NOT_IN_MATTER/],
    [{ type: 'GRANT_CREATED', grant: null }, /grant_required/],
    [{ type: 'REVIEWER_ACCESS_ADDED', grant: null, subject: null }, /subject_required/],
    [{ type: 'ACCESS_AUDIT_VIEWED', grant: G.a1 }, /audit_view_shape/],
    [{ type: 'GRANT_CREATED', outcome: 'REFUSED' }, /refusal_reason/],
    [{ type: 'GRANT_CREATED', reason: 'Parent said the child was at risk' }, /reason_code_check/],
    [{ type: 'GRANT_CREATED', key: 'short' }, /idempotency_key_check/],
  ])('rejects a malformed or unverifiable event %#', async (over: any, err) => {
    const before = await count();
    await expect(rec({ uid: 'uid-owner', matter: M.a, grant: G.a1, subject: A.rev1, ...over })).rejects.toThrow(err);
    expect(await count()).toBe(before);
  });

  // ----------------------------------------------------------------- idempotency / bounded refusals
  it('idempotency: identical retry returns the original event; a conflicting reuse is refused', async () => {
    const key = `retry-${crypto.randomBytes(4).toString('hex')}`;
    const first = await rec({ uid: 'uid-owner', matter: M.a, type: 'GRANT_REVOKED', grant: G.a1, subject: A.rev1, key });
    const again = await rec({ uid: 'uid-owner', matter: M.a, type: 'GRANT_REVOKED', grant: G.a1, subject: A.rev1, key });
    expect(again).toBe(first);
    expect(await count('idempotency_key = $1', [key])).toBe(1);
    await expect(rec({ uid: 'uid-owner', matter: M.a, type: 'GRANT_REVOKED', grant: G.a2, subject: A.rev1, key }))
      .rejects.toThrow(/IDEMPOTENCY_CONFLICT/);
    await expect(rec({ uid: 'uid-rev1', matter: M.a, type: 'GRANT_REVOKED', grant: G.a1, subject: A.rev1, key }))
      .rejects.toThrow(/IDEMPOTENCY_CONFLICT/);
  });

  it('idempotency holds under concurrent identical calls', async () => {
    const key = `race-${crypto.randomBytes(4).toString('hex')}`;
    const clients = await Promise.all([1, 2, 3, 4].map(async () => { const c = new pg.Client({ connectionString: url }); await c.connect(); return c; }));
    try {
      const ids = await Promise.all(clients.map(c => c.query(
        `select public.record_matter_access_event('uid-owner', $1, 'ACCESS_AUDIT_VIEWED', 'SUCCEEDED', p_idempotency_key => $2) as id`,
        [M.a, key]).then(r => r.rows[0].id)));
      expect(new Set(ids).size).toBe(1);
      expect(await count('idempotency_key = $1', [key])).toBe(1);
    } finally {
      await Promise.all(clients.map(c => c.end()));
    }
  });

  it('REFUSED events are bounded: repeated identical refusals do not grow the log', async () => {
    const before = await count(`actor_account_id = $1 and outcome = 'REFUSED'`, [A.stranger]);
    const ids = new Set<string>();
    for (let i = 0; i < 25; i++) {
      ids.add(await rec({ uid: 'uid-stranger', matter: M.b, type: 'GRANT_REVOKED', grant: G.b1, outcome: 'REFUSED', reason: 'NOT_OWNER' }));
    }
    expect(ids.size).toBe(1);
    await rec({ uid: 'uid-stranger', matter: M.b, type: 'GRANT_REVOKED', grant: G.b1, outcome: 'REFUSED', reason: 'GRANT_NOT_FOUND' });
    expect(await count(`actor_account_id = $1 and outcome = 'REFUSED'`, [A.stranger])).toBe(before + 2);
  });

  // ----------------------------------------------------------------- append-only / privileges
  it.each([
    ['UPDATE', `update public.navigator_matter_access_events set outcome = 'REFUSED', reason_code = 'X'`],
    ['UPDATE of timestamp', `update public.navigator_matter_access_events set occurred_at = now() - interval '1 year'`],
    ['DELETE', 'delete from public.navigator_matter_access_events'],
    ['TRUNCATE', 'truncate public.navigator_matter_access_events'],
  ])('append-only: %s is refused even for the table owner', async (_label, sql) => {
    await rec({ uid: 'uid-owner', matter: M.a, type: 'ACCESS_AUDIT_VIEWED' });
    const before = await count();
    await expect(db.query(sql)).rejects.toThrow(/APPEND_ONLY/);
    expect(await count()).toBe(before);
  });

  it.each(['anon', 'authenticated', 'service_role'])('role %s has no direct table access at all', async role => {
    for (const priv of ['select', 'insert', 'update', 'delete', 'truncate']) {
      const r = await db.query(`select has_table_privilege($1, 'public.navigator_matter_access_events', $2) as ok`, [role, priv]);
      expect(r.rows[0].ok).toBe(false);
    }
  });

  it('service_role cannot write the table directly even if it tried', async () => {
    await db.query('begin');
    try {
      await db.query('set local role service_role');
      await expect(db.query(`insert into public.navigator_matter_access_events (matter_id, event_type, actor_kind, actor_account_id, actor_matter_role, outcome)
        values ('${M.a}', 'ACCESS_AUDIT_VIEWED', 'ACCOUNT', '${A.owner}', 'OWNER', 'SUCCEEDED')`)).rejects.toThrow(/permission denied/);
    } finally {
      await db.query('rollback');
    }
  });

  it('only service_role may execute the recorder and reader; nobody may execute the guard', async () => {
    const fns = ['public.record_matter_access_event(text, uuid, text, text, uuid, uuid, text, text)',
      'public.list_matter_access_events(text, uuid, bigint, integer)'];
    for (const fn of fns) {
      for (const role of ['public', 'anon', 'authenticated']) {
        expect((await db.query(`select has_function_privilege($1, $2, 'execute') as ok`, [role, fn])).rows[0].ok).toBe(false);
      }
      expect((await db.query(`select has_function_privilege('service_role', $1, 'execute') as ok`, [fn])).rows[0].ok).toBe(true);
    }
    for (const role of ['public', 'anon', 'authenticated', 'service_role']) {
      expect((await db.query(`select has_function_privilege($1, 'public.navigator_matter_access_events_append_only()', 'execute') as ok`, [role])).rows[0].ok).toBe(false);
    }
  });

  it('RLS is enabled with zero policies, and the existing access tables are untouched', async () => {
    const r = await db.query(`select relname, relrowsecurity, (select count(*) from pg_policy p where p.polrelid = c.oid)::int as policies
      from pg_class c where relname in ('navigator_matter_access_events', 'navigator_matter_access_grants', 'navigator_matter_members') order by relname`);
    expect(r.rows).toEqual([
      { relname: 'navigator_matter_access_events', relrowsecurity: true, policies: 0 },
      { relname: 'navigator_matter_access_grants', relrowsecurity: true, policies: 0 },
      { relname: 'navigator_matter_members', relrowsecurity: true, policies: 0 },
    ]);
  });

  it('privacy: the table has only identifier / fixed-vocabulary columns (no free text, JSON or metadata)', async () => {
    const r = await db.query(`select column_name, data_type from information_schema.columns
      where table_schema = 'public' and table_name = 'navigator_matter_access_events' order by ordinal_position`);
    expect(r.rows).toEqual([
      { column_name: 'id', data_type: 'uuid' },
      { column_name: 'event_sequence', data_type: 'bigint' },
      { column_name: 'matter_id', data_type: 'uuid' },
      { column_name: 'event_type', data_type: 'text' },
      { column_name: 'actor_kind', data_type: 'text' },
      { column_name: 'actor_account_id', data_type: 'uuid' },
      { column_name: 'actor_matter_role', data_type: 'text' },
      { column_name: 'subject_account_id', data_type: 'uuid' },
      { column_name: 'grant_id', data_type: 'uuid' },
      { column_name: 'outcome', data_type: 'text' },
      { column_name: 'reason_code', data_type: 'text' },
      { column_name: 'idempotency_key', data_type: 'text' },
      { column_name: 'occurred_at', data_type: 'timestamp with time zone' },
    ]);
  });

  // ----------------------------------------------------------------- read authorization
  describe('read authorization', () => {
    beforeAll(async () => {
      // A small, known event set on each matter (appended; earlier rows also exist).
      await rec({ uid: 'uid-owner', matter: M.a, type: 'GRANT_CREATED', grant: G.a2 });
      await rec({ uid: 'uid-rev2', matter: M.a, type: 'GRANT_ACCEPTED', grant: G.a2, subject: A.rev2 });
      await rec({ uid: 'uid-rev2', matter: M.a, type: 'REVIEWER_ACCESS_ADDED', grant: G.a2, subject: A.rev2 });
      await rec({ uid: 'uid-owner', matter: M.a, type: 'REVIEWER_ACCESS_REMOVED', subject: A.revoked });
      await rec({ uid: 'uid-owner2', matter: M.b, type: 'GRANT_CREATED', grant: G.b1 });
      await rec({ uid: 'uid-rev1', matter: M.b, type: 'GRANT_ACCEPTED', grant: G.b1, subject: A.rev1 });
    });

    it('the matter OWNER sees every event on its matter, in sequence order, and nothing from other matters', async () => {
      const res = await list('uid-owner', M.a);
      expect(res.scope).toBe('MATTER');
      const all = await db.query('select id from public.navigator_matter_access_events where matter_id = $1 order by event_sequence', [M.a]);
      expect(res.events.map((e: any) => e.id)).toEqual(all.rows.map(r => r.id));
      expect(res.events.every((e: any) => e.grant_id !== G.b1)).toBe(true);
      const seqs = res.events.map((e: any) => Number(e.event_sequence));
      expect([...seqs].sort((x, y) => x - y)).toEqual(seqs);
    });

    it('a REVIEWER sees only events it performed or that concern it -- never another reviewer\'s', async () => {
      const res = await list('uid-rev1', M.a);
      expect(res.scope).toBe('SELF');
      expect(res.events.length).toBeGreaterThan(0);
      for (const e of res.events) expect(e.actor_account_id === A.rev1 || e.subject_account_id === A.rev1).toBe(true);
      expect(res.events.some((e: any) => e.subject_account_id === A.rev2 || e.actor_account_id === A.rev2)).toBe(false);
    });

    it('a reviewer on matter B cannot read matter B events about other people, nor matter A events via B', async () => {
      const res = await list('uid-rev1', M.b);
      for (const e of res.events) {
        expect(e.actor_account_id === A.rev1 || e.subject_account_id === A.rev1).toBe(true);
      }
      expect(res.events.every((e: any) => e.grant_id !== G.a1 && e.grant_id !== G.a2)).toBe(true);
    });

    it.each([
      ['a revoked professional (no membership, has history)', 'uid-revoked', M.a],
      ['an unrelated account', 'uid-stranger', M.a],
      ['the owner of a different matter', 'uid-owner2', M.a],
      ['a suspended owner', 'uid-suspended', M.a],
      ['an unknown uid', 'uid-nobody', M.a],
      ['anyone asking about a nonexistent matter', 'uid-owner', '20000000-0000-4000-8000-0000000000ff'],
    ])('%s is refused with the same NOT_AUTHORIZED error', async (_label, uid, matter) => {
      await expect(list(uid, matter)).rejects.toThrow(/^NOT_AUTHORIZED$/);
    });

    it('pages deterministically by sequence and bounds the page size', async () => {
      const full = (await list('uid-owner', M.a)).events;
      const first = (await list('uid-owner', M.a, 0, 2)).events;
      const second = (await list('uid-owner', M.a, Number(first[1].event_sequence), 2)).events;
      expect([...first, ...second].map((e: any) => e.id)).toEqual(full.slice(0, 4).map((e: any) => e.id));
      for (const [after, limit] of [[-1, 10], [0, 0], [0, 201]]) {
        await expect(list('uid-owner', M.a, after, limit)).rejects.toThrow(/INVALID_REQUEST/);
      }
    });

    it('the read output carries no idempotency key or other internal field', async () => {
      const res = await list('uid-owner', M.a);
      expect(Object.keys(res.events[0]).sort()).toEqual(['actor_account_id', 'actor_kind', 'actor_matter_role', 'event_sequence',
        'event_type', 'grant_id', 'id', 'occurred_at', 'outcome', 'reason_code', 'subject_account_id']);
    });
  });

  // ----------------------------------------------------------------- TypeScript service end to end
  describe('service against real PostgreSQL', () => {
    it('records through the service and reads it back with camelCase, validated events', async () => {
      const { eventId } = await recordMatterAccessEvent({ actorFirebaseUid: 'uid-owner', matterId: M.a.toUpperCase(), eventType: 'ACCESS_AUDIT_VIEWED', outcome: 'SUCCEEDED' });
      const page = await listMatterAccessEvents('uid-owner', M.a, { limit: 200 });
      const e = page.events.find(x => x.id === eventId)!;
      expect(e).toMatchObject({ eventType: 'ACCESS_AUDIT_VIEWED', actorKind: 'ACCOUNT', actorAccountId: A.owner, actorMatterRole: 'OWNER', outcome: 'SUCCEEDED' });
      expect(page.matterId).toBe(M.a);
      expect(page.scope).toBe('MATTER');
    });

    it('forged authority fields smuggled into the service input have no effect', async () => {
      const { eventId } = await recordMatterAccessEvent({
        actorFirebaseUid: 'uid-stranger', matterId: M.a, eventType: 'ACCESS_AUDIT_VIEWED', outcome: 'SUCCEEDED',
        ...({ actorAccountId: A.owner, actorMatterRole: 'OWNER', occurredAt: '2000-01-01T00:00:00Z' } as any),
      });
      const r = await row(eventId);
      expect(r).toMatchObject({ actor_account_id: A.stranger, actor_matter_role: 'NONE' });
      expect(new Date(r.occurred_at).getFullYear()).toBeGreaterThan(2000);
    });

    it('maps database refusals to fail-closed errors', async () => {
      await expect(listMatterAccessEvents('uid-revoked', M.a)).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
      await expect(recordMatterAccessEvent({ actorFirebaseUid: 'uid-owner', matterId: M.a, eventType: 'GRANT_CREATED', outcome: 'SUCCEEDED', grantId: G.b1 }))
        .rejects.toThrow(/not recorded \(GRANT_NOT_IN_MATTER\)/);
    });
  });
});
