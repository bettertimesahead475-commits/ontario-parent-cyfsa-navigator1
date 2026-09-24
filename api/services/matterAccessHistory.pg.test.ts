// Stage 10 slice 3 access-history read model: REAL PostgreSQL integration tests.
//
// Drives the real read model (matterAccessHistory.ts -> matterAccessEvents.ts) against the real
// slice 2 migration in a DISPOSABLE local database. Opt-in via NAVIGATOR_PG_TEST_ADMIN_URL;
// non-local hosts are refused.

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pg from 'pg';
import { getMatterAccessHistory, encodeHistoryCursor } from './matterAccessHistory';

const svc = vi.hoisted(() => ({ client: null as any, rpcCalls: 0 }));
vi.mock('./access.js', () => ({
  getSupabase: () => ({
    rpc: async (fn: string, args: Record<string, unknown> = {}) => {
      svc.rpcCalls++;
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
vi.mock('./accounts.js', () => ({
  findAccount: async (uid: string) => {
    const r = await svc.client.query('select id, primary_role, status from public.accounts where firebase_uid = $1', [uid]);
    return r.rows[0] ? { id: r.rows[0].id, primaryRole: r.rows[0].primary_role, status: r.rows[0].status } : null;
  },
}));

const ADMIN_URL = process.env.NAVIGATOR_PG_TEST_ADMIN_URL;
const MIGRATIONS = path.resolve(__dirname, '../../supabase/migrations_pending_approval');
const d = ADMIN_URL ? describe : describe.skip;

function assertLocal(url: string) {
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error(`Refusing non-local host ${host}.`);
}
function mattersFoundationPrefix(): string {
  const sql = fs.readFileSync(path.join(MIGRATIONS, 'create_navigator_matters_foundation.sql'), 'utf8');
  const cut = sql.indexOf('alter table public.navigator_documents');
  if (cut < 0) throw new Error('Unexpected matters foundation layout.');
  return sql.slice(0, cut);
}

const A = {
  owner: '11000000-0000-4000-8000-000000000001', owner2: '11000000-0000-4000-8000-000000000002',
  rev1: '11000000-0000-4000-8000-000000000003', rev2: '11000000-0000-4000-8000-000000000004',
  revoked: '11000000-0000-4000-8000-000000000005', suspended: '11000000-0000-4000-8000-000000000006',
  stranger: '11000000-0000-4000-8000-000000000007',
};
const M = { a: '21000000-0000-4000-8000-00000000000a', b: '21000000-0000-4000-8000-00000000000b', empty: '21000000-0000-4000-8000-0000000000ee' };
const G = { a1: '31000000-0000-4000-8000-0000000000a1', a2: '31000000-0000-4000-8000-0000000000a2', b1: '31000000-0000-4000-8000-0000000000b1' };

d('Stage 10 slice 3 access history -- real PostgreSQL', () => {
  const dbName = `navigator_stage10_history_${crypto.randomBytes(6).toString('hex')}`;
  let admin: pg.Client;
  let db: pg.Client;

  const rec = (uid: string | null, matter: string, type: string, extra: { subject?: string; grant?: string; outcome?: string; reason?: string } = {}) =>
    db.query(`select public.record_matter_access_event($1, $2, $3, $4, $5, $6, $7) as id`,
      [uid, matter, type, extra.outcome ?? 'SUCCEEDED', extra.subject ?? null, extra.grant ?? null, extra.reason ?? null]).then(r => r.rows[0].id as string);

  async function allPages(uid: string, matter: string, pageSize: number) {
    const ids: string[] = [];
    const scopes: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 100; i++) {
      const page = await getMatterAccessHistory(uid, matter, { cursor, pageSize });
      expect(page.entries.length).toBeLessThanOrEqual(pageSize);
      ids.push(...page.entries.map(e => e.id));
      scopes.push(page.scope);
      cursor = page.nextCursor;
      if (!cursor) return { ids, scopes };
    }
    throw new Error('pagination did not terminate');
  }

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
    await db.query(fs.readFileSync(path.join(MIGRATIONS, 'create_accounts_foundation.sql'), 'utf8'));
    await db.query(mattersFoundationPrefix());
    await db.query(fs.readFileSync(path.join(MIGRATIONS, 'create_navigator_matter_access_grants.sql'), 'utf8'));
    await db.query(fs.readFileSync(path.join(MIGRATIONS, 'create_navigator_matter_access_event_log.sql'), 'utf8'));
    await db.query(`insert into public.accounts (id, firebase_uid, primary_role, status) values
      ('${A.owner}','uid-owner','parent','active'), ('${A.owner2}','uid-owner2','parent','active'),
      ('${A.rev1}','uid-rev1','lawyer','active'), ('${A.rev2}','uid-rev2','lawyer','active'),
      ('${A.revoked}','uid-revoked','lawyer','active'), ('${A.suspended}','uid-suspended','lawyer','suspended'),
      ('${A.stranger}','uid-stranger','parent','active')`);
    for (const [m, o] of [[M.a, A.owner], [M.b, A.owner2], [M.empty, A.owner]]) {
      const c = await db.query(`insert into public.clients (account_id, name) values ($1, 'c') returning id`, [o]);
      await db.query(`insert into public.navigator_matters (id, account_id, client_id, title) values ($1, $2, $3, 'm')`, [m, o, c.rows[0].id]);
      await db.query(`insert into public.navigator_matter_members (matter_id, account_id, role) values ($1, $2, 'OWNER')`, [m, o]);
    }
    await db.query(`insert into public.navigator_matter_members (matter_id, account_id, role) values
      ('${M.a}','${A.rev1}','REVIEWER'), ('${M.a}','${A.rev2}','REVIEWER'), ('${M.a}','${A.suspended}','REVIEWER'), ('${M.b}','${A.rev1}','REVIEWER')`);
    await db.query(`insert into public.navigator_matter_access_grants (id, matter_id, grantor_account_id, token_digest, expires_at) values
      ('${G.a1}','${M.a}','${A.owner}','h-a1', now() + interval '7 days'), ('${G.a2}','${M.a}','${A.owner}','h-a2', now() + interval '7 days'),
      ('${G.b1}','${M.b}','${A.owner2}','h-b1', now() + interval '7 days')`);

    // Matter A history. The first five rows share ONE transaction, hence one identical timestamp.
    await db.query('begin');
    await rec('uid-owner', M.a, 'GRANT_CREATED', { grant: G.a1 });
    await rec('uid-rev1', M.a, 'GRANT_ACCEPTED', { grant: G.a1, subject: A.rev1 });
    await rec('uid-rev1', M.a, 'REVIEWER_ACCESS_ADDED', { grant: G.a1, subject: A.rev1 });
    await rec('uid-owner', M.a, 'GRANT_CREATED', { grant: G.a2 });
    await rec('uid-rev2', M.a, 'GRANT_ACCEPTED', { grant: G.a2, subject: A.rev2 });
    await db.query('commit');
    await rec('uid-rev2', M.a, 'REVIEWER_ACCESS_ADDED', { grant: G.a2, subject: A.rev2 });
    await rec(null, M.a, 'GRANT_EXPIRED', { grant: G.a2 });
    await rec('uid-owner', M.a, 'REVIEWER_ACCESS_REMOVED', { subject: A.revoked });
    await rec('uid-stranger', M.a, 'GRANT_REVOKED', { grant: G.a1, outcome: 'REFUSED', reason: 'NOT_OWNER' });
    await rec('uid-owner', M.a, 'ACCESS_AUDIT_VIEWED');
    // Matter B history.
    await rec('uid-owner2', M.b, 'GRANT_CREATED', { grant: G.b1 });
    await rec('uid-rev1', M.b, 'GRANT_ACCEPTED', { grant: G.b1, subject: A.rev1 });
    svc.client = db;
  }, 60_000);

  afterAll(async () => {
    await db?.end();
    if (admin) { await admin.query(`drop database if exists ${dbName} with (force)`); await admin.end(); }
  });

  beforeEach(() => { svc.rpcCalls = 0; });

  const matterEvents = async (matter: string) =>
    (await db.query('select id from public.navigator_matter_access_events where matter_id = $1 order by event_sequence', [matter])).rows.map(r => r.id);

  // ------------------------------------------------------------------ authorization
  it('OWNER: full matter history, historical basis and notice, entries labelled from stored facts only', async () => {
    const page = await getMatterAccessHistory('uid-owner', M.a, { pageSize: 100 });
    expect(page).toMatchObject({ matterId: M.a, basis: 'HISTORICAL_EVENTS', scope: 'MATTER', nextCursor: null });
    expect(page.notice).toMatch(/does not show who can open this matter now/);
    expect(page.entries.map(e => e.id)).toEqual(await matterEvents(M.a));
    const accepted = page.entries.find(e => e.eventType === 'GRANT_ACCEPTED' && e.subject?.accountId === A.rev1)!;
    expect(accepted.summary).toBe('Access invitation accepted');
    expect(accepted.actor).toEqual({ kind: 'ACCOUNT', accountId: A.rev1, roleAtEvent: 'REVIEWER', isRequester: false });
    const viewed = page.entries.find(e => e.eventType === 'ACCESS_AUDIT_VIEWED')!;
    expect(viewed.actor.isRequester).toBe(true);
    const refused = page.entries.find(e => e.outcome === 'REFUSED')!;
    expect(refused).toMatchObject({ summary: 'Attempt to revoke an access invitation was refused', reasonCode: 'NOT_OWNER',
      actor: { accountId: A.stranger, roleAtEvent: 'NONE' } });
    const expired = page.entries.find(e => e.eventType === 'GRANT_EXPIRED')!;
    expect(expired.actor).toEqual({ kind: 'SYSTEM', accountId: null, roleAtEvent: 'SYSTEM', isRequester: false });
  });

  it('REVIEWER: only events it performed or that concern it -- the database never sends the rest', async () => {
    const page = await getMatterAccessHistory('uid-rev1', M.a, { pageSize: 100 });
    expect(page.scope).toBe('SELF');
    expect(page.entries.length).toBe(2);
    for (const e of page.entries) expect(e.actor.accountId === A.rev1 || e.subject?.accountId === A.rev1).toBe(true);
    expect(JSON.stringify(page)).not.toContain(A.rev2);
    expect(JSON.stringify(page)).not.toContain(A.stranger);
    // The restriction happens before rows leave PostgreSQL, not in this module:
    const raw = await db.query(`select public.list_matter_access_events('uid-rev1', $1, 0, 200) as r`, [M.a]);
    expect(raw.rows[0].r.events.length).toBe(2);
  });

  it.each([
    ['a revoked professional', 'uid-revoked', M.a],
    ['a suspended reviewer', 'uid-suspended', M.a],
    ['an unrelated account', 'uid-stranger', M.a],
    ['the owner of another matter', 'uid-owner2', M.a],
    ['an unknown account', 'uid-nobody', M.a],
    ['anyone, for an unknown matter', 'uid-owner', '21000000-0000-4000-8000-0000000000ff'],
  ])('%s is refused with 403 and receives no entries', async (_l, uid, matter) => {
    await expect(getMatterAccessHistory(uid, matter)).rejects.toMatchObject({ statusCode: 403, code: 'FORBIDDEN' });
  });

  it('empty history is an empty page, not an error', async () => {
    const page = await getMatterAccessHistory('uid-owner', M.empty);
    expect(page).toMatchObject({ entries: [], nextCursor: null, scope: 'MATTER' });
  });

  it('cross-matter isolation: a reviewer on both matters sees each matter\'s own events only', async () => {
    const a = await getMatterAccessHistory('uid-rev1', M.a, { pageSize: 100 });
    const b = await getMatterAccessHistory('uid-rev1', M.b, { pageSize: 100 });
    const aIds = new Set(await matterEvents(M.a));
    const bIds = new Set(await matterEvents(M.b));
    expect(a.entries.every(e => aIds.has(e.id))).toBe(true);
    expect(b.entries.every(e => bIds.has(e.id))).toBe(true);
    expect(b.entries.map(e => e.grantId)).toEqual([G.b1]);
  });

  // ------------------------------------------------------------------ pagination / ordering
  it.each([1, 2, 3, 4, 100])('paging with pageSize %i visits every authorized event exactly once, in sequence order', async size => {
    const { ids } = await allPages('uid-owner', M.a, size);
    expect(ids).toEqual(await matterEvents(M.a));
  });

  it('same-timestamp events are ordered by the stable sequence tie-breaker across page boundaries', async () => {
    const sameTs = await db.query(`select id, event_sequence from public.navigator_matter_access_events
      where matter_id = $1 and occurred_at = (select min(occurred_at) from public.navigator_matter_access_events where matter_id = $1)
      order by event_sequence`, [M.a]);
    expect(sameTs.rows.length).toBe(5);
    const { ids } = await allPages('uid-owner', M.a, 2);
    expect(ids.slice(0, 5)).toEqual(sameTs.rows.map(r => r.id));
    for (let i = 0; i < 3; i++) expect((await allPages('uid-owner', M.a, 2)).ids).toEqual(ids);
  });

  it('an event inserted between page requests is neither duplicated nor skipped', async () => {
    const first = await getMatterAccessHistory('uid-owner2', M.b, { pageSize: 1 });
    const inserted = await rec('uid-owner2', M.b, 'ACCESS_AUDIT_VIEWED');
    const ids = [...first.entries.map(e => e.id)];
    let cursor = first.nextCursor;
    while (cursor) {
      const p = await getMatterAccessHistory('uid-owner2', M.b, { pageSize: 1, cursor });
      ids.push(...p.entries.map(e => e.id));
      cursor = p.nextCursor;
    }
    expect(ids).toEqual(await matterEvents(M.b));
    expect(ids.at(-1)).toBe(inserted);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('revocation between page requests: the next page is refused (authorization is not cached in the cursor)', async () => {
    const first = await getMatterAccessHistory('uid-rev2', M.a, { pageSize: 1 });
    expect(first.nextCursor).not.toBeNull();
    await db.query('delete from public.navigator_matter_members where matter_id = $1 and account_id = $2', [M.a, A.rev2]);
    try {
      await expect(getMatterAccessHistory('uid-rev2', M.a, { pageSize: 1, cursor: first.nextCursor })).rejects.toMatchObject({ statusCode: 403 });
    } finally {
      await db.query(`insert into public.navigator_matter_members (matter_id, account_id, role) values ($1, $2, 'REVIEWER')`, [M.a, A.rev2]);
    }
  });

  it('role change between page requests: the next page uses the CURRENT role, not the one when the cursor was issued', async () => {
    const first = await getMatterAccessHistory('uid-rev1', M.a, { pageSize: 1 });
    expect(first.scope).toBe('SELF');
    await db.query(`update public.navigator_matter_members set role = 'OWNER' where matter_id = $1 and account_id = $2`, [M.a, A.rev1]);
    try {
      const second = await getMatterAccessHistory('uid-rev1', M.a, { pageSize: 100, cursor: first.nextCursor });
      expect(second.scope).toBe('MATTER');
    } finally {
      await db.query(`update public.navigator_matter_members set role = 'REVIEWER' where matter_id = $1 and account_id = $2`, [M.a, A.rev1]);
    }
    const third = await getMatterAccessHistory('uid-rev1', M.a, { pageSize: 100, cursor: first.nextCursor });
    expect(third.scope).toBe('SELF');
  });

  // ------------------------------------------------------------------ cursor security
  it('a cursor issued for matter A is rejected on matter B before any database call', async () => {
    const pageA = await getMatterAccessHistory('uid-rev1', M.a, { pageSize: 1 });
    svc.rpcCalls = 0;
    await expect(getMatterAccessHistory('uid-rev1', M.b, { cursor: pageA.nextCursor })).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_CURSOR' });
    expect(svc.rpcCalls).toBe(0);
  });

  it('a tampered cursor cannot widen a reviewer\'s view: it can only re-slice events already authorized', async () => {
    const all = (await getMatterAccessHistory('uid-rev1', M.a, { pageSize: 100 })).entries.map(e => e.id);
    for (const s of [1, 2, 3, 5, 7, 999999]) {
      const p = await getMatterAccessHistory('uid-rev1', M.a, { pageSize: 100, cursor: encodeHistoryCursor(M.a, s) });
      for (const e of p.entries) expect(all).toContain(e.id);
    }
  });

  it.each([
    ['wrong prefix', 'h2.eyJtIjoiIn0'],
    ['not base64url', 'h1.***'],
    ['not JSON', `h1.${Buffer.from('not json').toString('base64url')}`],
    ['extra key', `h1.${Buffer.from(JSON.stringify({ m: M.a, s: 1, role: 'OWNER' })).toString('base64url')}`],
    ['string sequence', `h1.${Buffer.from(JSON.stringify({ m: M.a, s: '1' })).toString('base64url')}`],
    ['zero sequence', `h1.${Buffer.from(JSON.stringify({ m: M.a, s: 0 })).toString('base64url')}`],
    ['negative sequence', `h1.${Buffer.from(JSON.stringify({ m: M.a, s: -5 })).toString('base64url')}`],
    ['fractional sequence', `h1.${Buffer.from(JSON.stringify({ m: M.a, s: 1.5 })).toString('base64url')}`],
    ['uppercase matter', `h1.${Buffer.from(JSON.stringify({ m: M.a.toUpperCase(), s: 1 })).toString('base64url')}`],
    ['oversized', `h1.${'A'.repeat(300)}`],
  ])('a malformed cursor (%s) fails with 400 before any database call', async (_l, cursor) => {
    await expect(getMatterAccessHistory('uid-owner', M.a, { cursor })).rejects.toMatchObject({ statusCode: 400, code: 'INVALID_CURSOR' });
    expect(svc.rpcCalls).toBe(0);
  });

  it.each([0, -1, 101, 1.5, 1e9])('page size %s is rejected before any database call', async size => {
    await expect(getMatterAccessHistory('uid-owner', M.a, { pageSize: size })).rejects.toMatchObject({ statusCode: 400 });
    expect(svc.rpcCalls).toBe(0);
  });

  // ------------------------------------------------------------------ minimization
  it('entries expose only the documented fields -- no idempotency key, no internal columns, no case content', async () => {
    const page = await getMatterAccessHistory('uid-owner', M.a, { pageSize: 100 });
    for (const e of page.entries) {
      expect(Object.keys(e).sort()).toEqual(['actor', 'eventType', 'grantId', 'id', 'occurredAt', 'outcome', 'reasonCode', 'sequence', 'subject', 'summary']);
      expect(Object.keys(e.actor).sort()).toEqual(['accountId', 'isRequester', 'kind', 'roleAtEvent']);
    }
    expect(Object.keys(page).sort()).toEqual(['basis', 'entries', 'matterId', 'nextCursor', 'notice', 'pageSize', 'scope']);
  });
});
