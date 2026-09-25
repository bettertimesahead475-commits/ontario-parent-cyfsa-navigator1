// Stage 10 slice 7: recipient-bound access lifecycle (contract v4) on REAL PostgreSQL.
//
// Authority: STAGE_10_COMPLETION_DECISIONS.md (frozen at audit/stage-10-completion-decisions-frozen),
// Decisions 1-3 and the Slice 7 security acceptance criteria (section 9).
//
// Full stack in a DISPOSABLE local database: accounts, matters, Stage 7B grants + remediation (v2),
// slice 2 event log, slice 4 audited lifecycle (v3) and slice 7 recipient binding (v4). The REAL
// service code runs through a PostgREST-style adapter; SQL is also called directly for failure
// injection and genuinely concurrent races (separate connections).
//
// Opt-in: NAVIGATOR_PG_TEST_ADMIN_URL=postgres://postgres@127.0.0.1:<port>/postgres (local only).

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import pg from 'pg';
import { acceptProfessionalGrant, createProfessionalGrant, revokeProfessionalGrant } from './professionalMatterAccess';
import { canonicalRecipientEmail } from './recipientEmail';

const svc = vi.hoisted(() => ({ client: null as any, calls: [] as string[] }));

function isoRow(row: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(row).map(([k, v]) => [k, v instanceof Date ? v.toISOString() : v]));
}
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
vi.mock('./access', () => ({ getSupabase: () => adapter() }));
vi.mock('./access.js', () => ({ getSupabase: () => adapter() }));

const ADMIN_URL = process.env.NAVIGATOR_PG_TEST_ADMIN_URL;
const MIGRATIONS = path.resolve(__dirname, '../../supabase/migrations_pending_approval');
const F = {
  accounts: 'create_accounts_foundation.sql',
  grants: 'create_navigator_matter_access_grants.sql',
  remediation: 'remediate_navigator_matter_access_grants_lifecycle.sql',
  eventLog: 'create_navigator_matter_access_event_log.sql',
  v3: 'create_navigator_matter_access_lifecycle_audit_v3.sql',
  v4: 'create_navigator_matter_access_lifecycle_recipient_v4.sql',
};
const sql = (f: string) => fs.readFileSync(path.join(MIGRATIONS, f), 'utf8');
const d = ADMIN_URL ? describe : describe.skip;
const digest = (raw: string) => crypto.createHash('sha256').update(raw).digest('hex');
function assertLocal(url: string) {
  const host = new URL(url).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error(`Refusing non-local host ${host}.`);
}
function mattersPrefix(): string {
  const s = sql('create_navigator_matters_foundation.sql');
  return s.slice(0, s.indexOf('alter table public.navigator_documents'));
}

const A = {
  owner: '17000000-0000-4000-8000-000000000001', coOwner: '17000000-0000-4000-8000-000000000002',
  lawyer: '17000000-0000-4000-8000-000000000003', lawyer2: '17000000-0000-4000-8000-000000000004',
  other: '17000000-0000-4000-8000-000000000005', inactive: '17000000-0000-4000-8000-000000000006',
};
const M = { a: '', b: '' };
const emailOf = (uid: string) => `${uid.slice(4)}@example.test`;
const claims = (uid: string) => ({ email: emailOf(uid), emailVerified: true });
const ACCEPT_SQL = 'select public.accept_recipient_bound_matter_grant($1,$2,$3,$4) as r';

d('Stage 10 slice 7 -- recipient-bound lifecycle (contract v4) on real PostgreSQL', () => {
  const suffix = crypto.randomBytes(6).toString('hex');
  const dbName = `navigator_stage10_s7_${suffix}`;
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
    const created = await newDb(dbName, [F.remediation, F.eventLog, F.v3, F.v4]);
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

  beforeEach(async () => {
    svc.client = db;
    svc.calls = [];
    await db.query('truncate public.navigator_matter_access_grants, public.navigator_matter_members, public.navigator_matters, public.clients, public.accounts cascade');
    await db.query(`insert into public.accounts (id, firebase_uid, primary_role, status) values
      ($1,'uid-owner','parent','active'), ($2,'uid-coowner','parent','active'), ($3,'uid-lawyer','parent','active'),
      ($4,'uid-lawyer2','lawyer','active'), ($5,'uid-other','parent','active'), ($6,'uid-inactive','lawyer','suspended')`,
    [A.owner, A.coOwner, A.lawyer, A.lawyer2, A.other, A.inactive]);
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
    `select event_type, actor_kind, actor_account_id, subject_account_id, grant_id from public.navigator_matter_access_events
     where matter_id = $1 order by event_sequence`, [matter])).rows;
  const types = async (matter = M.a) => (await events(matter)).map(e => e.event_type);
  const grantRow = async (id: string) => (await db.query('select * from public.navigator_matter_access_grants where id = $1', [id])).rows[0];
  const role = async (acc: string, matter = M.a) =>
    (await db.query('select role from public.navigator_matter_members where matter_id = $1 and account_id = $2', [matter, acc])).rows[0]?.role ?? null;
  const snapshot = async () => ({
    grants: (await db.query('select id, status, accepted_by_account_id, revoked_at, recipient_email from public.navigator_matter_access_grants order by id')).rows,
    members: (await db.query('select matter_id, account_id, role from public.navigator_matter_members order by matter_id, account_id')).rows,
    events: Number((await db.query('select count(*) from public.navigator_matter_access_events')).rows[0].count),
  });
  const invite = async (recipient: string, matter = M.a, uid = 'uid-owner') => {
    const r = await createProfessionalGrant(uid, matter, { recipientEmail: recipient });
    return { id: r.grant.id, raw: r.rawToken };
  };
  const expire = (id: string) => db.query(`update public.navigator_matter_access_grants set expires_at = now() - interval '1 minute' where id = $1`, [id]);
  const acceptAs = (uid: string, raw: string) => acceptProfessionalGrant(uid, raw, claims(uid));

  // =============================================================== canonical rule (JS = PostgreSQL)
  describe('one canonical recipient rule, identical in JavaScript and PostgreSQL', () => {
    const inputs: unknown[] = [
      'pro@example.test', '  Pro.Name+Tag@Example.COM \t', '\n\r\v\fa@b\t ', 'A@B', 'ab', 'a@', '@a', 'a@b@c', 'no-at-sign',
      'x'.repeat(250) + '@b.c', 'x'.repeat(249) + '@b.c', 'ünïcode@example.test', 'pro@exämple.test', ' pro@example.test',
      'pro@example.test ', 'pro\u0000@example.test', 'pro@exa\u007fmple.test', 'pro @example.test', 'Ｐro@example.test',
      '', '   ', 'İnfo@example.test', 'first.last@sub.example.test', 'UPPER@EXAMPLE.TEST',
    ];
    it.each(inputs.map(i => [JSON.stringify(i), i]))('%s', async (_l, input) => {
      if (typeof input === 'string' && input.includes('\u0000')) {
        // PostgreSQL text cannot hold NUL at all: the database refuses it outright; JavaScript returns null.
        expect(canonicalRecipientEmail(input)).toBeNull();
        await expect(db.query('select public.navigator_canonical_recipient_email($1) as v', [input])).rejects.toThrow();
        return;
      }
      const pgResult = (await db.query('select public.navigator_canonical_recipient_email($1) as v', [input])).rows[0].v;
      expect(canonicalRecipientEmail(input)).toBe(pgResult);
    });

    it('applies only trim + ASCII lower-case: no dot, plus-tag, domain or alias rewriting', async () => {
      const r = await db.query('select public.navigator_canonical_recipient_email($1) as v', ['  First.Last+Case@Gmail.COM ']);
      expect(r.rows[0].v).toBe('first.last+case@gmail.com');
      expect(canonicalRecipientEmail('  First.Last+Case@Gmail.COM ')).toBe('first.last+case@gmail.com');
    });

    it('is locale-independent: a Turkish dotted capital I is refused, never mapped', async () => {
      expect(canonicalRecipientEmail('İnfo@example.test')).toBeNull();
      expect((await db.query('select public.navigator_canonical_recipient_email($1) as v', ['İnfo@example.test'])).rows[0].v).toBeNull();
    });

    it('the grant column only ever holds a canonical value (database CHECK)', async () => {
      const g = await invite('pro@example.test');
      await expect(db.query('update public.navigator_matter_access_grants set recipient_email = $2 where id = $1', [g.id, 'Pro@Example.test']))
        .rejects.toThrow(/recipient_email_canonical/);
      await expect(db.query('update public.navigator_matter_access_grants set recipient_email = $2 where id = $1', [g.id, 'bad']))
        .rejects.toThrow(/recipient_email_canonical/);
      await expect(db.query('update public.navigator_matter_access_grants set recipient_email = $2 where id = $1', [g.id, 'prö@example.test']))
        .rejects.toThrow(/recipient_email_canonical/);
      expect((await grantRow(g.id)).recipient_email).toBe('pro@example.test');
    });
  });

  // =============================================================== creation (criteria 1-5, 16, 26, 33, 34)
  describe('recipient-bound creation', () => {
    it('owner creates an invitation; the canonical recipient is stored once; digest only; GRANT_CREATED only', async () => {
      const r = await createProfessionalGrant('uid-owner', M.a, { recipientEmail: '  Pro.Name+Tag@Example.COM ' });
      expect(r.grant).toMatchObject({ matterId: M.a, status: 'PENDING', recipientEmail: 'pro.name+tag@example.com' });
      const row = await grantRow(r.grant.id);
      expect(row.recipient_email).toBe('pro.name+tag@example.com');
      expect(row.token_digest).toBe(digest(r.rawToken));
      expect(JSON.stringify(Object.values(row))).not.toContain(r.rawToken);
      expect(await events()).toEqual([{ event_type: 'GRANT_CREATED', actor_kind: 'ACCOUNT', actor_account_id: A.owner, subject_account_id: null, grant_id: r.grant.id }]);
      expect(svc.calls).toEqual(['navigator_matter_access_lifecycle_contract_v4', 'create_recipient_bound_matter_grant']);
    });

    it.each([
      ['missing', undefined], ['empty', ''], ['no @', 'pro.example.test'], ['two @', 'a@b@c.test'], ['empty local part', '@example.test'],
      ['empty domain', 'pro@'], ['too short', 'a@'], ['too long', 'x'.repeat(251) + '@b.c'], ['non-ASCII', 'prö@example.test'],
      ['non-ASCII edge space (NBSP)', ' pro@example.test'], ['control character', 'pro\u0001@example.test'],
    ])('a %s recipient is refused before the database and nothing is created', async (_l, recipient) => {
      const before = await snapshot();
      await expect(createProfessionalGrant('uid-owner', M.a, { recipientEmail: recipient as any })).rejects.toThrow('Recipient email must be a valid address.');
      expect(svc.calls).toEqual([]);
      expect(await snapshot()).toEqual(before);
    });

    it('the database refuses an invalid recipient even if JavaScript validation were bypassed', async () => {
      const before = await snapshot();
      for (const bad of ['prö@example.test', 'a@b@c', '', null]) {
        await expect(db.query('select public.create_recipient_bound_matter_grant($1,$2,$3,7,$4)', ['uid-owner', M.a, digest('x' + bad), bad]))
          .rejects.toThrow(/INVALID_RECIPIENT/);
      }
      expect(await snapshot()).toEqual(before);
    });

    it('a reviewer, a stranger to the matter and the owner of another matter cannot create', async () => {
      const g = await invite(emailOf('uid-lawyer'));
      await acceptAs('uid-lawyer', g.raw);
      const before = await snapshot();
      await expect(createProfessionalGrant('uid-lawyer', M.a, { recipientEmail: emailOf('uid-lawyer2') })).rejects.toThrow(/UNAUTHORIZED/);
      await expect(createProfessionalGrant('uid-other', M.a, { recipientEmail: emailOf('uid-lawyer2') })).rejects.toThrow(/UNAUTHORIZED/);
      await expect(createProfessionalGrant('uid-owner', M.b, { recipientEmail: emailOf('uid-lawyer2') })).rejects.toThrow(/UNAUTHORIZED/);
      expect(await snapshot()).toEqual(before);
    });

    it('the recipient email never appears in the append-only event log', async () => {
      const g = await invite('Distinctive.Person+x@Example.test');
      await db.query(ACCEPT_SQL, ['uid-lawyer', digest(g.raw), emailOf('uid-lawyer'), true]).catch(() => {});
      const g2 = await invite(emailOf('uid-lawyer'));
      await acceptAs('uid-lawyer', g2.raw);
      await revokeProfessionalGrant('uid-owner', g2.id);
      const cols = (await db.query(`select column_name from information_schema.columns where table_name = 'navigator_matter_access_events'`)).rows.map(r => r.column_name);
      expect(cols.some(c => /email|recipient/.test(c))).toBe(false);
      const all = JSON.stringify((await db.query('select * from public.navigator_matter_access_events')).rows);
      expect(all).not.toMatch(/@/);
      expect(all).not.toContain('distinctive');
      expect(all).not.toContain(g.raw);
      expect(all).not.toContain(digest(g.raw));
    });
  });

  // =============================================================== acceptance (criteria 6-15)
  describe('acceptance by the verified recipient only', () => {
    it('the matching verified recipient accepts (email compared canonically): GRANT_ACCEPTED + REVIEWER_ACCESS_ADDED', async () => {
      const g = await invite(emailOf('uid-lawyer'));
      await expect(acceptProfessionalGrant('uid-lawyer', g.raw, { email: '  LAWYER@Example.TEST ', emailVerified: true }))
        .resolves.toEqual({ success: true, matterId: M.a });
      expect(await role(A.lawyer)).toBe('REVIEWER');
      expect((await events()).slice(1)).toEqual([
        { event_type: 'GRANT_ACCEPTED', actor_kind: 'ACCOUNT', actor_account_id: A.lawyer, subject_account_id: A.lawyer, grant_id: g.id },
        { event_type: 'REVIEWER_ACCESS_ADDED', actor_kind: 'ACCOUNT', actor_account_id: A.lawyer, subject_account_id: A.lawyer, grant_id: g.id },
      ]);
      expect((await grantRow(g.id)).accepted_by_account_id).toBe(A.lawyer);
    });

    it('a different verified user holding the token cannot accept, and changes NOTHING (no state, no membership, no event)', async () => {
      const g = await invite(emailOf('uid-lawyer'));
      const before = await snapshot();
      await expect(acceptAs('uid-lawyer2', g.raw)).rejects.toThrow('Invalid token.');
      expect(await snapshot()).toEqual(before);
      expect((await grantRow(g.id)).status).toBe('PENDING');
      // The real recipient can still accept afterwards.
      await expect(acceptAs('uid-lawyer', g.raw)).resolves.toEqual({ success: true, matterId: M.a });
    });

    it('a non-recipient cannot expire an expired invitation: no PENDING -> EXPIRED, no GRANT_EXPIRED', async () => {
      const g = await invite(emailOf('uid-lawyer'));
      await expire(g.id);
      const before = await snapshot();
      await expect(acceptAs('uid-lawyer2', g.raw)).rejects.toThrow('Invalid token.');
      await expect(db.query(ACCEPT_SQL, ['uid-lawyer2', digest(g.raw), emailOf('uid-lawyer2'), true])).rejects.toThrow(/INVALID_TOKEN/);
      expect(await snapshot()).toEqual(before);
      expect((await grantRow(g.id)).status).toBe('PENDING');
      expect(await types()).not.toContain('GRANT_EXPIRED');
      // The legitimate recipient's attempt persists the expiry exactly as in v3 (SYSTEM actor).
      await expect(acceptAs('uid-lawyer', g.raw)).rejects.toThrow('Invitation has expired.');
      expect((await grantRow(g.id)).status).toBe('EXPIRED');
      expect((await events()).filter(e => e.event_type === 'GRANT_EXPIRED')).toEqual([
        { event_type: 'GRANT_EXPIRED', actor_kind: 'SYSTEM', actor_account_id: null, subject_account_id: null, grant_id: g.id },
      ]);
    });

    it.each([
      ['a matching but UNVERIFIED email', { email: emailOf('uid-lawyer'), emailVerified: false }],
      ['an absent email claim', { email: null, emailVerified: true }],
      ['an absent email claim and unverified', { email: null, emailVerified: false }],
      ['a malformed email claim', { email: 'not-an-email', emailVerified: true }],
    ])('%s cannot accept: refused before any database call, nothing changes', async (_l, c) => {
      const g = await invite(emailOf('uid-lawyer'));
      const before = await snapshot();
      svc.calls = [];
      await expect(acceptProfessionalGrant('uid-lawyer', g.raw, c as any)).rejects.toThrow('Verified email required.');
      expect(svc.calls).toEqual([]);
      expect(await snapshot()).toEqual(before);
    });

    it('the database independently refuses an unverified or missing email (defense in depth), before the token is looked up', async () => {
      const g = await invite(emailOf('uid-lawyer'));
      await expire(g.id);
      const before = await snapshot();
      for (const [email, verified] of [[emailOf('uid-lawyer'), false], [null, true], ['bad', true], [emailOf('uid-lawyer'), null]] as const) {
        await expect(db.query(ACCEPT_SQL, ['uid-lawyer', digest(g.raw), email, verified])).rejects.toThrow(/EMAIL_NOT_VERIFIED/);
      }
      expect(await snapshot()).toEqual(before);
    });

    it('BUG 2 / owner preservation: the grantor addressed by their own invitation is refused and stays OWNER', async () => {
      const g = await invite(emailOf('uid-owner'));
      const before = await snapshot();
      await expect(acceptAs('uid-owner', g.raw)).rejects.toThrow(/matter owner cannot accept/);
      expect(await snapshot()).toEqual(before);
      expect(await role(A.owner)).toBe('OWNER');
    });

    it('BUG 2 / owner preservation: a co-owner addressed by an invitation is refused and is never downgraded', async () => {
      const g = await invite(emailOf('uid-coowner'));
      const before = await snapshot();
      await expect(acceptAs('uid-coowner', g.raw)).rejects.toThrow(/matter owner cannot accept/);
      expect(await snapshot()).toEqual(before);
      expect(await role(A.coOwner)).toBe('OWNER');
    });

    it('Decision 2: a grantor who has since left the matter still cannot accept their own invitation (no re-entry as REVIEWER)', async () => {
      // A co-owner invites their own address, then loses their membership. The owner check no longer
      // applies to them, so only the grantor rule stands between them and a REVIEWER membership.
      const g = await invite(emailOf('uid-coowner'), M.a, 'uid-coowner');
      await db.query('delete from public.navigator_matter_members where matter_id = $1 and account_id = $2', [M.a, A.coOwner]);
      const before = await snapshot();
      await expect(acceptAs('uid-coowner', g.raw)).rejects.toThrow(/matter owner cannot accept/);
      expect(await snapshot()).toEqual(before);
      expect(await role(A.coOwner)).toBeNull();
    });

    it('an inactive (suspended) recipient cannot accept, and nothing changes', async () => {
      const g = await invite(emailOf('uid-inactive'));
      const before = await snapshot();
      await expect(acceptAs('uid-inactive', g.raw)).rejects.toThrow('Account is unavailable.');
      expect(await snapshot()).toEqual(before);
    });

    it('no lawyer role is required: a parent-role account that is the verified recipient can accept', async () => {
      const g = await invite(emailOf('uid-lawyer')); // uid-lawyer's primary_role is 'parent' in this suite
      await expect(acceptAs('uid-lawyer', g.raw)).resolves.toEqual({ success: true, matterId: M.a });
    });

    it('a grant created before v4 (no recipient) can never be accepted by anyone', async () => {
      const raw = crypto.randomBytes(32).toString('base64url');
      const r = await db.query(`insert into public.navigator_matter_access_grants (matter_id, grantor_account_id, token_digest, expires_at)
        values ($1,$2,$3, now() + interval '7 days') returning id`, [M.a, A.owner, digest(raw)]);
      const before = await snapshot();
      for (const uid of ['uid-lawyer', 'uid-lawyer2', 'uid-owner']) await expect(acceptAs(uid, raw)).rejects.toThrow('Invalid token.');
      expect(await snapshot()).toEqual(before);
      expect((await grantRow(r.rows[0].id)).status).toBe('PENDING');
    });

    it('tokens stay single-use; unknown, used, revoked and expired all fail without side effects for non-recipients', async () => {
      const used = await invite(emailOf('uid-lawyer'));
      await acceptAs('uid-lawyer', used.raw);
      const revoked = await invite(emailOf('uid-lawyer'));
      await revokeProfessionalGrant('uid-owner', revoked.id);
      const expired = await invite(emailOf('uid-lawyer'));
      await expire(expired.id);
      const before = await snapshot();
      // Non-recipient: every case is indistinguishable from an unknown token (the same service message).
      for (const raw of [used.raw, revoked.raw, expired.raw, crypto.randomBytes(32).toString('base64url')]) {
        await expect(acceptAs('uid-lawyer2', raw)).rejects.toThrow(/^Invalid token\.$/);
      }
      expect(await snapshot()).toEqual(before);
      // Recipient: the frozen v3 outcomes (all mapped to one 410 by the HTTP adapter).
      await expect(acceptAs('uid-lawyer', used.raw)).rejects.toThrow('Invitation is no longer pending.');
      await expect(acceptAs('uid-lawyer', revoked.raw)).rejects.toThrow('Invitation is no longer pending.');
      await expect(acceptAs('uid-lawyer', expired.raw)).rejects.toThrow('Invitation has expired.');
    });
  });

  // =============================================================== revocation + multiple grants (17, 30-32, BUG 1/4)
  describe('revocation and multiple grants are unchanged by v4', () => {
    it('BUG 1 / 17: a reviewer, a stranger and an unknown grant cannot revoke; nothing is reported as success', async () => {
      const g = await invite(emailOf('uid-lawyer'));
      await acceptAs('uid-lawyer', g.raw);
      const before = await snapshot();
      await expect(revokeProfessionalGrant('uid-lawyer', g.id)).rejects.toThrow(/UNAUTHORIZED/);
      await expect(revokeProfessionalGrant('uid-other', g.id)).rejects.toThrow(/UNAUTHORIZED/);
      await expect(revokeProfessionalGrant('uid-owner', crypto.randomUUID())).rejects.toThrow('Grant not found');
      expect(await snapshot()).toEqual(before);
    });

    it('pending revoke; BUG 4 alternate backing grant keeps access; final revoke removes it; retry records nothing', async () => {
      const pending = await invite(emailOf('uid-lawyer2'));
      await expect(revokeProfessionalGrant('uid-owner', pending.id)).resolves.toEqual({ success: true, membershipRemoved: false });
      const g1 = await invite(emailOf('uid-lawyer'));
      const g2 = await invite(emailOf('uid-lawyer'));
      await acceptAs('uid-lawyer', g1.raw);
      await acceptAs('uid-lawyer', g2.raw);
      const mark = (await types()).length;
      await expect(revokeProfessionalGrant('uid-owner', g1.id)).resolves.toEqual({ success: true, membershipRemoved: false });
      expect(await role(A.lawyer)).toBe('REVIEWER');
      await expect(revokeProfessionalGrant('uid-owner', g2.id)).resolves.toEqual({ success: true, membershipRemoved: true });
      expect(await role(A.lawyer)).toBeNull();
      expect((await types()).slice(mark)).toEqual(['GRANT_REVOKED', 'GRANT_REVOKED', 'REVIEWER_ACCESS_REMOVED']);
      const n = (await snapshot()).events;
      await revokeProfessionalGrant('uid-owner', g2.id);
      expect((await snapshot()).events).toBe(n);
    });

    it('a second accepted grant for an already-backed reviewer records GRANT_ACCEPTED only', async () => {
      const g1 = await invite(emailOf('uid-lawyer'));
      const g2 = await invite(emailOf('uid-lawyer'));
      await acceptAs('uid-lawyer', g1.raw);
      await acceptAs('uid-lawyer', g2.raw);
      expect(await types()).toEqual(['GRANT_CREATED', 'GRANT_CREATED', 'GRANT_ACCEPTED', 'REVIEWER_ACCESS_ADDED', 'GRANT_ACCEPTED']);
    });

    it('cross-matter: a matter-A invitation only ever grants matter A; matter-B owners cannot touch it', async () => {
      const g = await invite(emailOf('uid-lawyer'));
      await acceptAs('uid-lawyer', g.raw);
      expect(await role(A.lawyer, M.a)).toBe('REVIEWER');
      expect(await role(A.lawyer, M.b)).toBeNull();
      await expect(revokeProfessionalGrant('uid-other', g.id)).rejects.toThrow(/UNAUTHORIZED/);
      expect(await types(M.b)).toEqual([]);
    });
  });

  // =============================================================== transactions (25-27)
  describe('audit failure rolls the whole transition back', () => {
    const withFailingEvent = async (eventType: string, fn: () => Promise<unknown>) => {
      await db.query(`create or replace function public.s7_fail() returns trigger language plpgsql as $$
        begin if new.event_type = '${eventType}' then raise exception 'S7_INJECTED'; end if; return new; end $$`);
      await db.query('create trigger s7_fail before insert on public.navigator_matter_access_events for each row execute function public.s7_fail()');
      try { await fn(); } finally {
        await db.query('drop trigger if exists s7_fail on public.navigator_matter_access_events');
        await db.query('drop function if exists public.s7_fail()');
      }
    };

    it.each(['GRANT_CREATED', 'GRANT_ACCEPTED', 'REVIEWER_ACCESS_ADDED', 'GRANT_EXPIRED'])('a failing %s leaves no partial state', async eventType => {
      const g = eventType === 'GRANT_CREATED' ? null : await invite(emailOf('uid-lawyer'));
      if (eventType === 'GRANT_EXPIRED') await expire(g!.id);
      const before = await snapshot();
      await withFailingEvent(eventType, async () => {
        const call = eventType === 'GRANT_CREATED'
          ? db.query('select public.create_recipient_bound_matter_grant($1,$2,$3,7,$4)', ['uid-owner', M.a, digest('fail'), emailOf('uid-lawyer')])
          : db.query(ACCEPT_SQL, ['uid-lawyer', digest(g!.raw), emailOf('uid-lawyer'), true]);
        await expect(call).rejects.toThrow(/S7_INJECTED/);
      });
      expect(await snapshot()).toEqual(before);
    });
  });

  // =============================================================== concurrency (22-24)
  describe('concurrency on separate connections', () => {
    async function clients(n: number) {
      return Promise.all(Array.from({ length: n }, async () => { const c = new pg.Client({ connectionString: url }); await c.connect(); return c; }));
    }
    const settle = (ps: Promise<unknown>[]) => Promise.allSettled(ps);

    it('matching accepts racing: exactly one acceptance, one GRANT_ACCEPTED', async () => {
      const c = await clients(2);
      try {
        for (let i = 0; i < 10; i++) {
          const g = await invite(emailOf('uid-lawyer'));
          const r = await settle(c.map(x => x.query(ACCEPT_SQL, ['uid-lawyer', digest(g.raw), emailOf('uid-lawyer'), true])));
          expect(r.filter(x => x.status === 'fulfilled')).toHaveLength(1);
          expect((await events()).filter(e => e.grant_id === g.id && e.event_type === 'GRANT_ACCEPTED')).toHaveLength(1);
          await revokeProfessionalGrant('uid-owner', g.id);
        }
      } finally { await Promise.all(c.map(x => x.end())); }
    }, 60_000);

    it('a mismatched recipient racing the real recipient never mutates the grant and never wins', async () => {
      const c = await clients(2);
      try {
        for (let i = 0; i < 10; i++) {
          const g = await invite(emailOf('uid-lawyer'));
          const [bad, good] = await settle([
            c[0].query(ACCEPT_SQL, ['uid-lawyer2', digest(g.raw), emailOf('uid-lawyer2'), true]),
            c[1].query(ACCEPT_SQL, ['uid-lawyer', digest(g.raw), emailOf('uid-lawyer'), true]),
          ]);
          expect(bad.status).toBe('rejected');
          expect(String((bad as PromiseRejectedResult).reason?.message)).toMatch(/INVALID_TOKEN/);
          expect(good.status).toBe('fulfilled');
          expect((await grantRow(g.id)).accepted_by_account_id).toBe(A.lawyer);
          expect(await role(A.lawyer2)).toBeNull();
          await revokeProfessionalGrant('uid-owner', g.id);
        }
      } finally { await Promise.all(c.map(x => x.end())); }
    }, 60_000);

    it('on an expired invitation, only the recipient\'s attempt can record GRANT_EXPIRED -- exactly once', async () => {
      const c = await clients(3);
      try {
        for (let i = 0; i < 6; i++) {
          const g = await invite(emailOf('uid-lawyer'));
          await expire(g.id);
          await settle([
            c[0].query(ACCEPT_SQL, ['uid-lawyer2', digest(g.raw), emailOf('uid-lawyer2'), true]),
            c[1].query(ACCEPT_SQL, ['uid-lawyer', digest(g.raw), emailOf('uid-lawyer'), true]),
            c[2].query(ACCEPT_SQL, ['uid-lawyer2', digest(g.raw), emailOf('uid-lawyer2'), true]),
          ]);
          expect((await grantRow(g.id)).status).toBe('EXPIRED');
          expect((await events()).filter(e => e.grant_id === g.id && e.event_type === 'GRANT_EXPIRED')).toHaveLength(1);
        }
      } finally { await Promise.all(c.map(x => x.end())); }
    }, 60_000);

    it('accept racing revoke always leaves a consistent state (never access through a revoked grant)', async () => {
      const c = await clients(2);
      try {
        for (let i = 0; i < 10; i++) {
          const g = await invite(emailOf('uid-lawyer'));
          await settle([
            c[0].query(ACCEPT_SQL, ['uid-lawyer', digest(g.raw), emailOf('uid-lawyer'), true]),
            c[1].query('select public.revoke_matter_grant($1,$2)', ['uid-owner', g.id]),
          ]);
          expect((await grantRow(g.id)).status).toBe('REVOKED');
          expect(await role(A.lawyer)).toBeNull();
          const mine = (await events()).filter(e => e.grant_id === g.id).map(e => e.event_type);
          expect([
            ['GRANT_CREATED', 'GRANT_REVOKED'],
            ['GRANT_CREATED', 'GRANT_ACCEPTED', 'REVIEWER_ACCESS_ADDED', 'GRANT_REVOKED', 'REVIEWER_ACCESS_REMOVED'],
          ]).toContainEqual(mine);
        }
      } finally { await Promise.all(c.map(x => x.end())); }
    }, 60_000);
  });

  // =============================================================== contract + deployment
  describe('contract v4 and deployment order', () => {
    it('the service requires v4 before any lifecycle call', async () => {
      const g = await invite(emailOf('uid-lawyer'));
      await db.query('alter function public.navigator_matter_access_lifecycle_contract_v4() rename to s7_hidden');
      try {
        svc.calls = [];
        await expect(acceptAs('uid-lawyer', g.raw)).rejects.toThrow(/access lifecycle contract/);
        await expect(createProfessionalGrant('uid-owner', M.a, { recipientEmail: emailOf('uid-lawyer') })).rejects.toThrow(/access lifecycle contract/);
        await expect(revokeProfessionalGrant('uid-owner', g.id)).rejects.toThrow(/access lifecycle contract/);
        expect(svc.calls.filter(c => /matter_grant/.test(c))).toEqual([]);
      } finally {
        await db.query('alter function public.s7_hidden() rename to navigator_matter_access_lifecycle_contract_v4');
      }
    });

    it('the v4 migration refuses to install without v3 and leaves nothing behind', async () => {
      const noV3 = await newDb(`navigator_stage10_s7_nov3_${suffix}`, [F.remediation, F.eventLog]);
      try {
        await expect(noV3.c.query(sql(F.v4))).rejects.toThrow(/PREREQUISITE_MISSING.*v3/);
        await noV3.c.query('rollback');
        const absent = async (sig: string) => (await noV3.c.query(`select to_regprocedure($1) is null as a`, [sig])).rows[0].a;
        expect(await absent('public.navigator_matter_access_lifecycle_contract_v4()')).toBe(true);
        expect(await absent('public.accept_recipient_bound_matter_grant(text, text, text, boolean)')).toBe(true);
        const col = await noV3.c.query(`select 1 from information_schema.columns where table_name = 'navigator_matter_access_grants' and column_name = 'recipient_email'`);
        expect(col.rows).toEqual([]);
      } finally {
        await noV3.c.end();
      }
    });
  });
});
