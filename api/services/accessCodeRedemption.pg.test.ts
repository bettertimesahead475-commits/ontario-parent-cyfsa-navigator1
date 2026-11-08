// Real-PostgreSQL tests for supabase/migrations_pending_approval/20261030_reconcile_access_codes_and_atomic_rpc.sql.
// The tables are created exactly as they exist on the staging project (columns and constraints inspected
// 2026-10-30), the migration file is applied unchanged, and the function is exercised with synthetic records.
// Runs only against a local server (NAVIGATOR_PG_TEST_ADMIN_URL on 127.0.0.1/localhost).
import { createHash, randomBytes } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const ADMIN_URL = process.env.NAVIGATOR_PG_TEST_ADMIN_URL;
const MIGRATION = path.resolve(__dirname, "../../supabase/migrations_pending_approval/20261030_reconcile_access_codes_and_atomic_rpc.sql");
const d = ADMIN_URL ? describe : describe.skip;

// The staging tables before the migration, as inspected.
const STAGING_SCHEMA = `
  create extension if not exists pgcrypto;
  create table public.access_codes (
    id uuid primary key default gen_random_uuid(),
    tier text check (tier = any (array['Pro','Premium','pro_advocate','premium_attorney'])),
    code text unique,
    created_at timestamptz default now()
  );
  create table public.navigator_paid_sessions (
    id uuid primary key default gen_random_uuid(),
    firebase_uid text not null,
    email text,
    tier text not null check (tier = any (array['Pro','Premium'])),
    issued_at timestamptz not null default now(),
    expires_at timestamptz not null,
    revoked_at timestamptz,
    revocation_reason text,
    access_code_id uuid unique references public.access_codes(id) on delete set null,
    constraint navigator_paid_sessions_revocation_consistency_check check ((revoked_at is not null) or (revocation_reason is null))
  );
  create index navigator_paid_sessions_firebase_uid_idx on public.navigator_paid_sessions (firebase_uid);
  alter table public.access_codes enable row level security;
  alter table public.navigator_paid_sessions enable row level security;
`;

// The same hash api/services/access.ts hashCode() stores.
const nodeHash = (code: string) => createHash("sha256").update(code.toUpperCase().trim()).digest("hex");

d("access code redemption on real PostgreSQL (staging schema + corrected migration)", () => {
  const dbName = `redeem_test_${randomBytes(5).toString("hex")}`;
  let admin: pg.Client;
  let pool: pg.Pool;
  const redeem = (uid: string, code: string, email: string, client: pg.Pool | pg.PoolClient = pool) =>
    client.query("select public.redeem_access_code_atomic($1,$2,$3) as r", [uid, code, email]).then((x) => x.rows[0].r);
  const issue = async (fields: { tier?: string; email?: string | null; expires?: string | null; plaintext?: boolean } = {}) => {
    const code = `TEST-${randomBytes(4).toString("hex").toUpperCase()}`;
    const r = await pool.query(
      `insert into public.access_codes (tier, code, code_hash, email, expires_at) values ($1, $2, $3, $4, $5) returning id`,
      [fields.tier ?? "Pro", fields.plaintext ? code : null, fields.plaintext ? null : nodeHash(code), fields.email ?? null, fields.expires ?? null]
    );
    return { code, id: r.rows[0].id as string };
  };

  beforeAll(async () => {
    if (!/@(127\.0\.0\.1|localhost):/.test(ADMIN_URL!)) throw new Error("Refusing to run against a non-local database.");
    admin = new pg.Client({ connectionString: ADMIN_URL });
    await admin.connect();
    await admin.query(`create database ${dbName}`);
    const url = new URL(ADMIN_URL!);
    url.pathname = `/${dbName}`;
    pool = new pg.Pool({ connectionString: url.toString(), max: 25 });
    // The forced drop in afterAll ends idle connections; that is expected, not a test failure.
    pool.on("error", () => {});
    await pool.query(`do $$ begin
      if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon; end if;
      if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated; end if;
      if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role; end if;
    end $$;`);
    await pool.query(STAGING_SCHEMA);
    // A legacy plaintext code that exists before the migration: it must be hashed and stay redeemable.
    await pool.query(`insert into public.access_codes (tier, code) values ('Pro', 'legacy-code-0001')`);
    await pool.query(fs.readFileSync(MIGRATION, "utf8"));
  }, 60_000);

  afterAll(async () => {
    await pool?.end().catch(() => {});
    await admin?.query(`drop database if exists ${dbName} with (force)`);
    await admin?.end();
  });

  beforeEach(async () => {
    await pool.query("drop trigger if exists fail_insert on public.navigator_paid_sessions");
  });

  it("activates a valid code once, binding the session to the verified account", async () => {
    const { code, id } = await issue({ email: "parent@example.test" });
    const r = await redeem("uid-a", code.toLowerCase(), " Parent@Example.test ");
    expect(r).toMatchObject({ status: "activated", tier: "Pro" });
    const s = (await pool.query("select * from public.navigator_paid_sessions where access_code_id = $1", [id])).rows;
    expect(s).toHaveLength(1);
    expect(s[0]).toMatchObject({ firebase_uid: "uid-a", email: "parent@example.test", tier: "Pro", revoked_at: null });
    const c = (await pool.query("select used_at from public.access_codes where id = $1", [id])).rows[0];
    expect(c.used_at).not.toBeNull();
  });

  it("returns the same session on a retry by the same account, and refuses everyone else", async () => {
    const { code, id } = await issue();
    const first = await redeem("uid-b", code, "b@example.test");
    const again = await redeem("uid-b", code, "b@example.test");
    expect(again).toMatchObject({ status: "reused", session_id: first.session_id });
    expect(await redeem("uid-other", code, "b@example.test")).toEqual({ status: "consumed", code: "CODE_ALREADY_USED" });
    expect((await pool.query("select count(*)::int n from public.navigator_paid_sessions where access_code_id = $1", [id])).rows[0].n).toBe(1);
  });

  it("does not reuse a revoked session", async () => {
    const { code } = await issue();
    const first = await redeem("uid-r", code, "r@example.test");
    await pool.query("update public.navigator_paid_sessions set revoked_at = now(), revocation_reason = 'test' where id = $1", [first.session_id]);
    expect(await redeem("uid-r", code, "r@example.test")).toEqual({ status: "consumed", code: "CODE_ALREADY_USED" });
  });

  it("refuses a wrong email with the same answer as an unknown code", async () => {
    const { code, id } = await issue({ email: "owner@example.test" });
    expect(await redeem("uid-c", code, "someone@example.test")).toEqual({ status: "invalid", code: "CODE_NOT_FOUND" });
    expect(await redeem("uid-c", "TEST-NOPE0000", "owner@example.test")).toEqual({ status: "invalid", code: "CODE_NOT_FOUND" });
    expect((await pool.query("select used_at from public.access_codes where id = $1", [id])).rows[0].used_at).toBeNull();
  });

  it("refuses an expired code, and a tier that cannot become a paid session, without consuming either", async () => {
    const expired = await issue({ expires: new Date(Date.now() - 60_000).toISOString() });
    expect(await redeem("uid-d", expired.code, "d@example.test")).toEqual({ status: "expired", code: "CODE_EXPIRED" });
    const legacyTier = await issue({ tier: "pro_advocate" });
    expect(await redeem("uid-d", legacyTier.code, "d@example.test")).toEqual({ status: "denied", code: "TIER_NOT_REDEEMABLE" });
    const used = await pool.query("select count(*)::int n from public.access_codes where id = any($1) and used_at is not null", [[expired.id, legacyTier.id]]);
    expect(used.rows[0].n).toBe(0);
  });

  it("rolls back the claim when creating the session fails: the code stays unused and no session exists", async () => {
    const { code, id } = await issue();
    await pool.query(`create or replace function public.fail_insert_fn() returns trigger language plpgsql as $$ begin raise exception 'simulated failure'; end $$`);
    await pool.query("create trigger fail_insert before insert on public.navigator_paid_sessions for each row execute function public.fail_insert_fn()");
    await expect(redeem("uid-e", code, "e@example.test")).rejects.toThrow(/simulated failure/);
    expect((await pool.query("select used_at from public.access_codes where id = $1", [id])).rows[0].used_at).toBeNull();
    expect((await pool.query("select count(*)::int n from public.navigator_paid_sessions where access_code_id = $1", [id])).rows[0].n).toBe(0);
    await pool.query("drop trigger fail_insert on public.navigator_paid_sessions");
    // Once the fault is gone the same code redeems normally.
    expect(await redeem("uid-e", code, "e@example.test")).toMatchObject({ status: "activated" });
  });

  it("lets exactly one of 20 simultaneous redemptions of the same code succeed", async () => {
    const { code, id } = await issue();
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => redeem(`uid-race-${i}`, code, "race@example.test")));
    expect(results.filter((r) => r.status === "activated")).toHaveLength(1);
    expect(results.filter((r) => r.status === "consumed")).toHaveLength(19);
    expect((await pool.query("select count(*)::int n from public.navigator_paid_sessions where access_code_id = $1", [id])).rows[0].n).toBe(1);
  });

  it("hashes legacy plaintext codes compatibly with the application, so they stay redeemable", async () => {
    const row = (await pool.query("select code_hash from public.access_codes where code = 'legacy-code-0001'")).rows[0];
    expect(row.code_hash).toBe(nodeHash("legacy-code-0001"));
    expect(await redeem("uid-f", "LEGACY-CODE-0001", "f@example.test")).toMatchObject({ status: "activated", tier: "Pro" });
  });

  it("returns no database error text, and validates input before touching any row", async () => {
    for (const [uid, code, email] of [["", "TEST-AAAA", "x@example.test"], ["uid", "ab", "x@example.test"], ["uid", "TEST-AAAA", "not-an-email"]]) {
      const r = await redeem(uid, code, email);
      expect(Object.keys(r).sort()).toEqual(["code", "status"]);
    }
  });

  it("can be executed by service_role only, and runs as its owner without changing RLS", async () => {
    const acl = (await pool.query(`select array_to_string(proacl, ',') acl from pg_proc where proname = 'redeem_access_code_atomic'`)).rows[0].acl as string;
    expect(acl).toMatch(/service_role=X/);
    expect(acl).not.toMatch(/(^|,)=X/); // no PUBLIC grant
    expect(acl).not.toMatch(/anon=|authenticated=/);
    for (const role of ["anon", "authenticated"]) {
      const c = await pool.connect();
      try {
        await c.query(`set role ${role}`);
        await expect(c.query("select public.redeem_access_code_atomic('u','TEST-AAAA','x@example.test')")).rejects.toThrow(/permission denied/);
      } finally {
        await c.query("reset role");
        c.release();
      }
    }
    const rls = (await pool.query(`select relname, relrowsecurity from pg_class where relname in ('access_codes','navigator_paid_sessions') order by 1`)).rows;
    expect(rls.every((r: any) => r.relrowsecurity)).toBe(true);
  });

  it("refuses to apply if existing codes collide", async () => {
    const url = new URL(ADMIN_URL!);
    const other = `redeem_dup_${randomBytes(4).toString("hex")}`;
    await admin.query(`create database ${other}`);
    url.pathname = `/${other}`;
    const c = new pg.Client({ connectionString: url.toString() });
    await c.connect();
    try {
      await c.query(STAGING_SCHEMA);
      await c.query(`insert into public.access_codes (tier, code) values ('Pro', 'dup-code-1'), ('Pro', 'DUP-CODE-1')`);
      await expect(c.query(fs.readFileSync(MIGRATION, "utf8"))).rejects.toThrow(/duplicate codes/);
      await c.query("rollback").catch(() => {});
      const cols = (await c.query(`select count(*)::int n from information_schema.columns where table_name = 'access_codes' and column_name = 'code_hash'`)).rows[0].n;
      expect(cols).toBe(0); // the whole migration rolled back
    } finally {
      await c.end();
      await admin.query(`drop database if exists ${other} with (force)`);
    }
  });
});
