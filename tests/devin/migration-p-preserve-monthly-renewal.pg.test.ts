// Migration P (supabase/migrations/20261110004740_preserve_monthly_renewal.sql) with its read-only preflight, postcheck
// and rollback, on a disposable PostgreSQL. Runs only where CREDIT_PG_URL is set; creates and drops its own database.
// The schema mirrors the live nxfhvebzzobegubefcda shapes of access_codes / navigator_paid_sessions (captured
// read-only 2026-11-27). The live RPC is reached by applying P and then P's rollback, so the test also proves the
// rollback restores the exact live fingerprint.
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.CREDIT_PG_URL;
const here = path.dirname(fileURLToPath(import.meta.url));
const sql = (p: string) => readFileSync(path.resolve(here, "../../supabase", p), "utf8");
const P = sql("migrations/20261110004740_preserve_monthly_renewal.sql");
const DIR = "migrations_pending_approval/preserve_monthly_renewal_P";
const PREFLIGHT = sql(`${DIR}.preflight.sql`);
const POSTCHECK = sql(`${DIR}.postcheck.sql`);
const ROLLBACK = sql(`${DIR}.rollback.sql`);
const LIVE_FP = "ca9f13a85933345f0dfede3b1ab2975e";
const P_FP = "b835b252c9d2b97413e43271c712e5ce";
const SCHEMA = `
create schema supabase_migrations;
create table supabase_migrations.schema_migrations (version text primary key, name text);
insert into supabase_migrations.schema_migrations values ('20261127163309', 'reconcile_skip_live_analyzer_jobs');
create table public.access_codes (id uuid primary key default gen_random_uuid(), tier text, code text unique,
  created_at timestamptz default now(), used_at timestamptz, expires_at timestamptz, code_hash text unique, email text,
  reference_number text, amount numeric);
alter table public.access_codes enable row level security;
create table public.navigator_paid_sessions (id uuid primary key default gen_random_uuid(), firebase_uid text not null,
  email text, tier text not null, issued_at timestamptz not null default now(), expires_at timestamptz not null,
  revoked_at timestamptz, revocation_reason text, access_code_id uuid references public.access_codes(id) on delete set null);
create view public.navigator_payment_summary as select tier, count(*) as codes_issued from public.access_codes group by tier;`;
const hash = (code: string) => createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
type Row = { check_name: string; detail: string; ok: boolean; blocking?: boolean };

describe.skipIf(!url)("Migration P: preserve_monthly_renewal preflight, postcheck and rollback", () => {
  const dbName = `mig_p_${process.pid}_${Date.now()}`;
  let admin: pg.Client; let db: pg.Client;
  const rows = async (q: string) => ((await db.query(q)) as unknown as pg.QueryResult[]).find((r) => r.command === "SELECT")!.rows as Row[];
  const blockingFailures = async () => (await rows(PREFLIGHT)).filter((r) => r.blocking && !r.ok).map((r) => r.check_name);
  const fp = async () => (await db.query("select md5(prosrc) as m from pg_proc where proname = 'redeem_access_code_atomic'")).rows[0].m;
  const hasColumn = async () => (await db.query("select count(*)::int as n from information_schema.columns where table_name = 'access_codes' and column_name = 'redeemed_session_id'")).rows[0].n === 1;
  const issue = async (tier: string, email: string) => {
    const code = `MIGP-${randomUUID().slice(0, 8).toUpperCase()}`;
    await db.query("insert into public.access_codes (tier, code_hash, email, expires_at, amount) values ($1, $2, $3, now() + interval '14 days', 49.99)", [tier, hash(code), email]);
    return code;
  };
  const redeem = async (uid: string, code: string, email: string) =>
    (await db.query("select public.redeem_access_code_atomic($1, $2, $3) as r", [uid, code, email])).rows[0].r as { status: string; session_id?: string; expires_at?: string };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url }); await admin.connect();
    await admin.query(`create database ${dbName}`);
    const u = new URL(url!); u.pathname = `/${dbName}`;
    for (const role of ["anon", "authenticated", "service_role"]) {
      await admin.query(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${role}') then create role ${role} nologin; end if; end $$;`);
    }
    db = new pg.Client({ connectionString: u.toString() }); await db.connect();
    db.on("error", () => {});
    await db.query(SCHEMA);
    await db.query(P);
    await db.query(ROLLBACK);
  });
  afterAll(async () => {
    await db?.end();
    await admin.query(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  });

  it("rollback reproduces the live ledger exactly: live fingerprint, no column, service_role-only execute", async () => {
    expect(await fp()).toBe(LIVE_FP);
    expect(await hasColumn()).toBe(false);
    const grants = (await db.query("select string_agg(grantee, ',' order by grantee) as g from information_schema.routine_privileges where routine_name = 'redeem_access_code_atomic'")).rows[0].g;
    expect(grants.split(",").filter((g: string) => ["anon", "authenticated", "PUBLIC"].includes(g))).toEqual([]);
    expect(grants).toContain("service_role");
  });

  it("preflight passes every blocking check on the live-shaped ledger and changes nothing", async () => {
    expect(await blockingFailures()).toEqual([]);
    expect(await fp()).toBe(LIVE_FP);
    expect(await hasColumn()).toBe(false);
  });

  it("P keeps pre-P codes redeemable, extends a monthly entitlement in place, and passes the postcheck", async () => {
    const email = "parent.p@example.test"; const uid = `uid-${randomUUID()}`;
    const issuedBeforeP = await issue("Pro", email);
    await db.query(P);
    expect(await fp()).toBe(P_FP);
    expect((await rows(POSTCHECK)).filter((r) => !r.ok)).toEqual([]);
    const first = await redeem(uid, issuedBeforeP, email);
    expect(first.status).toBe("activated");
    const renewal = await redeem(uid, await issue("Pro", email), email);
    expect(renewal.status).toBe("activated");
    expect(renewal.session_id).toBe(first.session_id);
    expect(new Date(renewal.expires_at!).getTime() - new Date(first.expires_at!).getTime()).toBeGreaterThan(29 * 86400000);
    expect((await db.query("select count(*)::int as n from public.navigator_paid_sessions where firebase_uid = $1", [uid])).rows[0].n).toBe(1);
  });

  it("preflight refuses a second run once P is applied", async () => {
    const failures = await blockingFailures();
    expect(failures.some((c) => c.startsWith("access_codes.redeemed_session_id absent"))).toBe(true);
    expect(failures.some((c) => c.startsWith("live redeem_access_code_atomic equals"))).toBe(true);
  });

  it("rollback refuses while D's index exists, and leaves P intact", async () => {
    await db.query("create unique index access_codes_one_redemption_per_reference on public.access_codes (upper(btrim(reference_number))) where used_at is not null");
    await expect(db.query(ROLLBACK)).rejects.toThrow(/Migration D is applied/);
    await db.query("rollback");
    await db.query("drop index public.access_codes_one_redemption_per_reference");
    expect(await fp()).toBe(P_FP);
    expect(await hasColumn()).toBe(true);
  });

  it("rollback refuses to drop renewal links unless the loss is accepted explicitly, then restores live and P re-applies", async () => {
    await expect(db.query(ROLLBACK)).rejects.toThrow(/renewal codes record their entitlement/);
    await db.query("rollback");
    expect(await hasColumn()).toBe(true);
    await db.query("set navigator.p_rollback_accept_link_loss = 'yes'");
    await db.query(ROLLBACK);
    await db.query("reset navigator.p_rollback_accept_link_loss");
    expect(await fp()).toBe(LIVE_FP);
    expect(await hasColumn()).toBe(false);
    expect((await db.query("select count(*)::int as n from public.navigator_paid_sessions")).rows[0].n).toBe(1);
    await db.query(P);
    expect(await fp()).toBe(P_FP);
  });

  it("rollback refuses when the RPC is not P's version", async () => {
    await db.query("set navigator.p_rollback_accept_link_loss = 'yes'");
    await db.query(ROLLBACK);
    await db.query("reset navigator.p_rollback_accept_link_loss");
    await db.query("alter table public.access_codes add column redeemed_session_id uuid");
    await expect(db.query(ROLLBACK)).rejects.toThrow(/not the P version/);
    await db.query("rollback");
  });
});
