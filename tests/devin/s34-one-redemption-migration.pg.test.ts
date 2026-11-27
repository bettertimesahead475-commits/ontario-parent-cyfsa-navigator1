// S-34 / Migration D: supabase/migrations_pending_approval/access_codes_one_redemption_per_reference.sql, its rollback
// and read-only preflight, on a disposable PostgreSQL. Runs only where CREDIT_PG_URL is set. Creates its own throwaway
// database (dropped afterwards) holding a minimal access_codes / navigator_paid_sessions schema plus the live
// 20261110004740_preserve_monthly_renewal.sql RPC; no other database is touched.
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.CREDIT_PG_URL;
const here = path.dirname(fileURLToPath(import.meta.url));
const sql = (p: string) => readFileSync(path.resolve(here, "../../supabase", p), "utf8");
const BASELINE = sql("migrations/20261110004740_preserve_monthly_renewal.sql");
const UP = sql("migrations_pending_approval/access_codes_one_redemption_per_reference.sql");
const DOWN = sql("migrations_pending_approval/access_codes_one_redemption_per_reference.rollback.sql");
const PREFLIGHT = sql("migrations_pending_approval/access_codes_one_redemption_per_reference.preflight.sql");
const SCHEMA = `
create table public.access_codes (id uuid primary key default gen_random_uuid(), tier text, code_hash text unique, email text,
  used_at timestamptz, expires_at timestamptz, reference_number text, amount numeric, created_at timestamptz not null default now());
create table public.navigator_paid_sessions (id uuid primary key default gen_random_uuid(), firebase_uid text not null, email text,
  tier text not null, issued_at timestamptz not null default now(), expires_at timestamptz not null, revoked_at timestamptz,
  revocation_reason text, access_code_id uuid references public.access_codes(id) on delete set null,
  constraint navigator_paid_sessions_access_code_id_key unique (access_code_id));`;
const DAY = 86400000;
const hash = (code: string) => createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
type Rpc = { status: string; code?: string; session_id?: string; expires_at?: string };

describe.skipIf(!url)("Migration D: one redemption per payment reference (S-34)", () => {
  const dbName = `s34_${process.pid}_${Date.now()}`;
  let admin: pg.Client; let db: pg.Client; let dbUrl: string;
  const clients: pg.Client[] = [];
  const connect = async () => { const c = new pg.Client({ connectionString: dbUrl }); await c.connect(); clients.push(c); return c; };
  let n = 0;
  const issue = async (ref: string | null, email: string, tier = "Premium", expiresInDays = 14) => {
    const code = `S34T-${String(++n).padStart(4, "0")}-${randomUUID().slice(0, 4).toUpperCase()}`;
    await db.query("insert into public.access_codes (tier, code_hash, email, reference_number, expires_at, amount) values ($1,$2,$3,$4,now() + make_interval(days => $5),49.99)",
      [tier, hash(code), email, ref, expiresInDays]);
    return code;
  };
  const redeem = async (c: pg.Client, uid: string, code: string, email: string): Promise<Rpc> =>
    (await c.query("select public.redeem_access_code_atomic($1,$2,$3) as r", [uid, code, email])).rows[0].r;
  const count = async (q: string, p: unknown[] = []) => Number((await db.query(q, p)).rows[0].n);
  const fingerprint = async () => (await db.query("select md5(prosrc) as m from pg_proc where proname = 'redeem_access_code_atomic'")).rows[0].m as string;
  const preflight = async () => {
    const res = (await db.query(PREFLIGHT)) as unknown as pg.QueryResult[];
    return res.find((r) => r.command === "SELECT")!.rows as Array<{ check_name: string; detail: string; ok: boolean; blocking: boolean }>;
  };
  const blockingOk = async () => (await preflight()).filter((r) => r.blocking).every((r) => r.ok);
  // Holds one redemption open (uncommitted) and starts `others` against it, so the concurrency is real, not sequential.
  const contend = async (first: { uid: string; code: string; email: string }, others: Array<{ uid: string; code: string; email: string }>) => {
    const holder = await connect();
    await holder.query("begin");
    const r0 = await redeem(holder, first.uid, first.code, first.email);
    const pending = await Promise.all(others.map(async () => connect()));
    const results = others.map((o, i) => redeem(pending[i], o.uid, o.code, o.email));
    await new Promise((r) => setTimeout(r, 300));
    const waiting = await count("select count(*) as n from pg_locks where not granted");
    await holder.query("commit");
    return { first: r0, others: await Promise.all(results), waiting };
  };

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url }); await admin.connect();
    await admin.query(`create database ${dbName}`);
    const u = new URL(url!); u.pathname = `/${dbName}`; dbUrl = u.toString();
    for (const role of ["anon", "authenticated", "service_role"]) {
      await admin.query(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${role}') then create role ${role} nologin; end if; end $$;`);
    }
    db = new pg.Client({ connectionString: dbUrl }); await db.connect();
    await db.query(SCHEMA);
    await db.query(BASELINE);
  });
  afterAll(async () => {
    await Promise.all(clients.map((c) => c.end().catch(() => undefined)));
    await db?.end();
    await admin.query(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  });

  it("baseline (before D): two codes of one payment redeemed concurrently give two entitlements", async () => {
    const codes = [await issue("PS-BASE0001", "a@example.test"), await issue("PS-BASE0001", "a@example.test")];
    const { first, others } = await contend({ uid: "uid-a", code: codes[0], email: "a@example.test" }, [{ uid: "uid-a", code: codes[1], email: "a@example.test" }]);
    expect([first.status, others[0].status]).toEqual(["activated", "activated"]);
    expect(await count("select count(*) as n from public.navigator_paid_sessions where firebase_uid = 'uid-a'")).toBe(2);
  });

  it("preflight is read-only, matches the live RPC fingerprint, and blocks D while a reference has two redeemed codes", async () => {
    expect(PREFLIGHT).toMatch(/begin transaction read only;/);
    expect(PREFLIGHT).toMatch(/\brollback;\s*$/);
    const rows = await preflight();
    expect(rows.find((r) => r.check_name.startsWith("live redeem_access_code_atomic"))).toMatchObject({ ok: true, detail: await fingerprint() });
    expect(rows.find((r) => r.check_name.startsWith("references with more than one"))).toMatchObject({ ok: false, detail: "PS-BASE0001 x2" });
    await expect(db.query("begin transaction read only; insert into public.access_codes (tier) values ('Premium'); rollback;")).rejects.toThrow(/read-only/);
    await db.query("rollback").catch(() => undefined);
  });

  it("D refuses to apply over existing duplicates and changes nothing (no entitlement is reduced)", async () => {
    const before = (await db.query("select id, expires_at, revoked_at from public.navigator_paid_sessions order by id")).rows;
    const fp = await fingerprint();
    await expect(db.query(UP)).rejects.toThrow(/1 payment reference\(s\) already have more than one redeemed code/);
    await db.query("rollback").catch(() => undefined);
    expect(await fingerprint()).toBe(fp);
    expect(await count("select count(*) as n from pg_indexes where indexname = 'access_codes_one_redemption_per_reference'")).toBe(0);
    expect((await db.query("select id, expires_at, revoked_at from public.navigator_paid_sessions order by id")).rows).toEqual(before);
    // The owner resolves the duplicate outside this migration; the fixture simply removes it.
    await db.query("delete from public.access_codes where reference_number = 'PS-BASE0001'");
    await db.query("delete from public.navigator_paid_sessions where firebase_uid = 'uid-a'");
  });

  it("applies cleanly when preflight passes, leaves existing sessions untouched, and grants only service_role", async () => {
    const legacy = await issue("PS-LEGACY01", "l@example.test");
    expect((await redeem(db, "uid-l", legacy, "l@example.test")).status).toBe("activated");
    const before = (await db.query("select id, expires_at, revoked_at from public.navigator_paid_sessions order by id")).rows;
    expect(await blockingOk()).toBe(true);
    await db.query(UP);
    await db.query(UP); // re-runnable
    expect((await db.query("select id, expires_at, revoked_at from public.navigator_paid_sessions order by id")).rows).toEqual(before);
    expect((await preflight()).find((r) => r.check_name.startsWith("index"))!.ok).toBe(false);
    for (const [role, allowed] of [["anon", false], ["authenticated", false], ["service_role", true]] as const) {
      const r = await db.query("select has_function_privilege($1, 'public.redeem_access_code_atomic(text,text,text)', 'execute') as e", [role]);
      expect(r.rows[0].e).toBe(allowed);
    }
  });

  it("claim, approval and reissue codes of one payment redeemed concurrently (8 transactions) give exactly one entitlement", async () => {
    const ref = "PS-RACE0001"; const email = "r@example.test";
    const codes = await Promise.all(Array.from({ length: 8 }, () => issue(ref, email)));
    const { first, others, waiting } = await contend({ uid: "uid-r", code: codes[0], email }, codes.slice(1).map((code) => ({ uid: "uid-r", code, email })));
    expect(waiting).toBeGreaterThanOrEqual(7);
    expect(first.status).toBe("activated");
    expect(others.map((o) => o.status)).toEqual(Array(7).fill("reused"));
    expect(new Set(others.map((o) => o.session_id))).toEqual(new Set([first.session_id]));
    expect(await count("select count(*) as n from public.navigator_paid_sessions where firebase_uid = 'uid-r'")).toBe(1);
    expect(await count("select count(*) as n from public.access_codes where reference_number = $1 and used_at is not null", [ref])).toBe(1);
    // The refused codes are retired, so none can be used later.
    expect(await count("select count(*) as n from public.access_codes where reference_number = $1 and used_at is null and expires_at > now()", [ref])).toBe(0);
    const days = (Date.parse(first.expires_at!) - Date.now()) / DAY;
    expect(days).toBeGreaterThan(29.9); expect(days).toBeLessThanOrEqual(30);
  });

  it("the same code sent 6 times at once activates once; repeats return the same entitlement", async () => {
    const code = await issue("PS-DUP00001", "d@example.test");
    const { first, others } = await contend({ uid: "uid-d", code, email: "d@example.test" }, Array.from({ length: 5 }, () => ({ uid: "uid-d", code, email: "d@example.test" })));
    expect(first.status).toBe("activated");
    expect(others.every((o) => o.status === "reused" && o.session_id === first.session_id)).toBe(true);
    expect(await count("select count(*) as n from public.navigator_paid_sessions where firebase_uid = 'uid-d'")).toBe(1);
  });

  it("monthly renewal tiers: two codes of one payment stack once; a new verified payment still renews (+30 days)", async () => {
    const email = "p@example.test";
    const [a, b] = [await issue("PS-PROMON01", email, "Pro"), await issue("PS-PROMON01", email, "Pro")];
    const { first, others } = await contend({ uid: "uid-p", code: a, email }, [{ uid: "uid-p", code: b, email }]);
    expect([first.status, others[0].status]).toEqual(["activated", "reused"]);
    const exp1 = Date.parse(first.expires_at!);
    expect((exp1 - Date.now()) / DAY).toBeLessThanOrEqual(30);
    const renewal = await redeem(db, "uid-p", await issue("PS-PROMON02", email, "Pro"), email);
    expect(renewal).toMatchObject({ status: "activated", session_id: first.session_id });
    expect(Date.parse(renewal.expires_at!) - exp1).toBe(30 * DAY);
    // Two further, separate payments redeemed concurrently both count: +60 days.
    const [c, d] = [await issue("PS-PROMON03", email, "Pro"), await issue("PS-PROMON04", email, "Pro")];
    const both = await contend({ uid: "uid-p", code: c, email }, [{ uid: "uid-p", code: d, email }]);
    expect([both.first.status, both.others[0].status]).toEqual(["activated", "activated"]);
    const final = (await db.query("select expires_at from public.navigator_paid_sessions where id = $1", [first.session_id])).rows[0].expires_at as Date;
    expect(final.getTime() - exp1).toBe(90 * DAY);
    expect(await count("select count(*) as n from public.navigator_paid_sessions where firebase_uid = 'uid-p'")).toBe(1);
  });

  it("an interrupted or failed redemption stays recoverable with another code of the same payment", async () => {
    const ref = "PS-RECOVER1"; const email = "f@example.test";
    const a = await issue(ref, email);
    const c = await connect();
    await c.query("begin"); expect((await redeem(c, "uid-f", a, email)).status).toBe("activated"); await c.query("rollback");
    expect(await count("select count(*) as n from public.navigator_paid_sessions where firebase_uid = 'uid-f'")).toBe(0);
    const expired = await issue(ref, email, "Premium", -1);
    expect((await redeem(db, "uid-f", expired, email)).status).toBe("expired");
    const reissued = await issue(ref, email);
    expect((await redeem(db, "uid-f", reissued, email)).status).toBe("activated");
    expect(await count("select count(*) as n from public.navigator_paid_sessions where firebase_uid = 'uid-f'")).toBe(1);
  });

  it("another account presenting a second code of an activated payment gets nothing", async () => {
    const ref = "PS-OTHER001";
    await redeem(db, "uid-o1", await issue(ref, "o@example.test"), "o@example.test");
    const second = await issue(ref, "x@example.test");
    expect(await redeem(db, "uid-o2", second, "x@example.test")).toEqual({ status: "consumed", code: "ORDER_ALREADY_ACTIVATED" });
    expect(await count("select count(*) as n from public.navigator_paid_sessions where firebase_uid = 'uid-o2'")).toBe(0);
  });

  it("codes without a payment reference are unaffected; the index refuses a direct second redemption", async () => {
    const [x, y] = [await issue(null, "m@example.test"), await issue(null, "m@example.test")];
    expect((await redeem(db, "uid-m", x, "m@example.test")).status).toBe("activated");
    expect((await redeem(db, "uid-m2", y, "m@example.test")).status).toBe("activated");
    await issue("ps-direct01 ", "z@example.test"); await issue("PS-DIRECT01", "z@example.test");
    await db.query("update public.access_codes set used_at = now() where reference_number = 'ps-direct01 '");
    await expect(db.query("update public.access_codes set used_at = now() where reference_number = 'PS-DIRECT01'")).rejects.toThrow(/access_codes_one_redemption_per_reference/);
  });

  it("rollback restores the exact previous RPC and drops the index; D can be re-applied", async () => {
    const applied = await fingerprint();
    await db.query(DOWN);
    expect(await fingerprint()).toBe("b835b252c9d2b97413e43271c712e5ce");
    expect(await count("select count(*) as n from pg_indexes where indexname = 'access_codes_one_redemption_per_reference'")).toBe(0);
    await db.query(UP);
    expect(await fingerprint()).toBe(applied);
  });
});
