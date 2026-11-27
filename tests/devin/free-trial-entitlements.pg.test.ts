// Free-trial policy (functions/api/_free-trial.ts) end to end against a real PostgreSQL server running the pending
// free-scan reservation functions: one lifetime Quick and one lifetime Forensic per verified email, separate atomic
// counters, release on failure, the earlier 3-Quick allowance honoured, paid counters untouched, platform/IP caps and
// paid priority. The policy needs no schema change: each entitlement is its own free_usage row, keyed fq:/ff:<hash>.
//
// Local only (refuses anything not on localhost); works in its own scratch database and drops it afterwards.
//   CREDIT_PG_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run tests/devin/free-trial-entitlements.pg.test.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  finalizeFreeReservation, freeTrialKey, platformDailyKey, readFreeTrialBalance, releaseFreeReservation, reserveFreeTrial,
  type FreeTrialEnv, type FreeTrialKind,
} from "../../functions/api/_free-trial";
import type { CreditRpc } from "../../functions/api/_paid-credit-reservation";

const url = process.env.CREDIT_PG_URL;
const isLocal = Boolean(url && /@(127\.0\.0\.1|localhost):/.test(url));
const dir = resolve(__dirname, "../../supabase/migrations_pending_approval");
const OFF = {
  FREE_TRIAL_IP_DAILY_LIMIT: "off", FREE_TRIAL_IP_MONTHLY_LIMIT: "off", FREE_QUICK_PLATFORM_DAILY_LIMIT: "off",
  FREE_FORENSIC_PLATFORM_DAILY_LIMIT: "off", FREE_OCR_PLATFORM_DAILY_LIMIT: "off", PAID_PLATFORM_DAILY_LIMIT: "off", FREE_TRIAL_PAUSE_AT_PAID_DAILY: "off",
};

describe.skipIf(!isLocal)("free-trial entitlements on a real PostgreSQL server", () => {
  let pool: pg.Pool;
  let admin: pg.Pool;
  const scratch = `free_trial_test_${process.pid}_${Date.now()}`;
  const rpc: CreditRpc = async (name, args) => {
    if (!/^free_(reserve|finalize|release)_scan$/.test(name)) throw new Error(`unexpected rpc ${name}`);
    const keys = Object.keys(args);
    const sql = `select public.${name}(${keys.map((k, i) => `${k} => $${i + 1}`).join(", ")}) as r`;
    return (await pool.query(sql, keys.map((k) => args[k]))).rows[0].r;
  };
  const fetcher = (async (input: RequestInfo | URL) => {
    const u = new URL(String(input));
    if (!u.pathname.endsWith("/rest/v1/free_usage")) throw new Error(`unexpected fetch ${u.pathname}`);
    const key = u.searchParams.get("uid")!.slice(3);
    return Response.json((await pool.query("select analyses_used from public.free_usage where uid = $1", [key])).rows);
  }) as typeof fetch;
  const env = (extra: Record<string, string> = {}): FreeTrialEnv => ({
    STAGING_SUPABASE_URL: "https://synthetic.supabase.test", STAGING_SUPABASE_SERVICE_ROLE_KEY: "sb_secret_synthetic", ...OFF, ...extra,
  });
  let seq = 0;
  const attempt = (kind: FreeTrialKind, uid: string, email: string, extra: { env?: FreeTrialEnv; ip?: string; requestId?: string } = {}) =>
    reserveFreeTrial({
      kind, uid, email, emailVerified: true, ip: extra.ip ?? null, captchaToken: null,
      requestId: extra.requestId ?? `req_${process.pid}_${++seq}_padding`, rpc, env: extra.env ?? env(), fetcher,
    });
  const used = async (key: string) => (await pool.query("select analyses_used from public.free_usage where uid = $1", [key])).rows[0]?.analyses_used ?? 0;

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: url, max: 1 });
    await admin.query(`create database ${scratch}`);
    const s = new URL(url!);
    s.pathname = `/${scratch}`;
    pool = new pg.Pool({ connectionString: s.toString(), max: 30 });
    await pool.query(`do $$ declare r text; begin foreach r in array array['anon','authenticated','service_role'] loop
      begin execute format('create role %I nologin', r); exception when duplicate_object or unique_violation then null; end; end loop; end $$;`);
    await pool.query(`create table public.free_usage (uid text primary key, email text, analyses_used integer not null default 0,
      first_analysis_at timestamptz, last_analysis_at timestamptz);`);
    await pool.query(readFileSync(resolve(dir, "free_scan_reservation_functions.sql"), "utf8"));
  });
  beforeEach(async () => { await pool.query("delete from public.free_usage"); });
  afterAll(async () => {
    await pool?.end();
    if (!admin) return;
    await admin.query(`drop database if exists ${scratch}`);
    await admin.end();
  });

  it("25 concurrent Quick submissions from one verified email reserve exactly one entitlement", async () => {
    const rs = await Promise.all(Array.from({ length: 25 }, () => attempt("quick", "uid-a", "a@example.com")));
    expect(rs.filter((r) => r.status === "reserved")).toHaveLength(1);
    expect(rs.filter((r) => r.status !== "reserved").every((r) => r.status === "limit")).toBe(true);
    expect(await used(await freeTrialKey("quick", "a@example.com"))).toBe(1);
  });

  it("a second account with the same verified email (or a Gmail alias of it) gets nothing more", async () => {
    const first = await attempt("forensic", "uid-1", "Jane.Doe@gmail.com");
    expect(first.status).toBe("reserved");
    for (const [uid, email] of [["uid-2", "janedoe@gmail.com"], ["uid-3", "jane.doe+cyfsa@googlemail.com"], ["uid-4", "JANEDOE@GMAIL.COM"]]) {
      expect((await attempt("forensic", uid, email)).status).toBe("limit");
    }
  });

  it("Quick and Forensic are separate counters: using one leaves the other", async () => {
    const q = await attempt("quick", "uid-b", "b@example.com");
    expect(q.status).toBe("reserved");
    await finalizeFreeReservation("uid-b", "unused", q.status === "reserved" ? q.reservationId : null, rpc);
    const f = await attempt("forensic", "uid-b", "b@example.com");
    expect(f.status).toBe("reserved");
    expect((await attempt("quick", "uid-b", "b@example.com")).status).toBe("limit");
    expect((await attempt("forensic", "uid-b", "b@example.com")).status).toBe("limit");
  });

  it("a failed analysis releases its entitlement; a delivered one is consumed for good", async () => {
    const requestId = "req_release_test_padding";
    const r = await attempt("quick", "uid-c", "c@example.com", { requestId });
    expect(r.status).toBe("reserved");
    const key = await freeTrialKey("quick", "c@example.com");
    expect((await releaseFreeReservation("uid-c", requestId, r.status === "reserved" ? r.reservationId : null, rpc)).status).toBe("released");
    expect(await used(key)).toBe(0);
    const again = await attempt("quick", "uid-c", "c@example.com", { requestId: "req_release_retry_padding" });
    expect(again.status).toBe("reserved");
    expect((await finalizeFreeReservation("uid-c", "req_release_retry_padding", again.status === "reserved" ? again.reservationId : null, rpc)).status).toBe("consumed");
    expect(await used(key)).toBe(1);
    expect((await attempt("quick", "uid-c", "c@example.com")).status).toBe("limit");
  });

  it("an account that started under the earlier 3-Quick offer keeps its remaining Quick Reviews, plus 1 Forensic", async () => {
    await pool.query("insert into public.free_usage (uid, analyses_used) values ('legacy-uid', 2)");
    expect((await attempt("quick", "legacy-uid", "legacy@example.com")).status).toBe("reserved");
    expect((await attempt("quick", "legacy-uid", "legacy@example.com")).status).toBe("limit");
    expect(await used("legacy-uid")).toBe(3);
    expect(await used(await freeTrialKey("quick", "legacy@example.com"))).toBe(0);
    expect((await attempt("forensic", "legacy-uid", "legacy@example.com")).status).toBe("reserved");
    const b = await readFreeTrialBalance(env(), "legacy-uid", "legacy@example.com", true, fetcher);
    expect(b).toMatchObject({ legacy: true, quickLimit: 3, quickUsed: 3, forensicUsed: 1 });
  });

  it("never reads or writes purchased-credit counters", async () => {
    await pool.query("insert into public.free_usage (uid, analyses_used) values ('paid_session_11111111-1111-4111-8111-111111111111_total', 2)");
    await attempt("quick", "uid-d", "d@example.com");
    await attempt("forensic", "uid-d", "d@example.com");
    expect(await used("paid_session_11111111-1111-4111-8111-111111111111_total")).toBe(2);
  });

  it("platform daily cap: 8 concurrent new customers, cap 3 -> 3 reserved, 5 paused with their entitlement intact", async () => {
    const e = env({ FREE_QUICK_PLATFORM_DAILY_LIMIT: "3" });
    const rs = await Promise.all(Array.from({ length: 8 }, (_, i) => attempt("quick", `uid-p${i}`, `p${i}@example.com`, { env: e })));
    expect(rs.filter((r) => r.status === "reserved")).toHaveLength(3);
    expect(rs.filter((r) => r.status === "paused")).toHaveLength(5);
    let left = 0;
    for (let i = 0; i < 8; i++) left += (await used(await freeTrialKey("quick", `p${i}@example.com`))) === 0 ? 1 : 0;
    expect(left).toBe(5);
  });

  it("paid priority: free trials pause once today's paid volume reaches the threshold, without using the entitlement", async () => {
    await pool.query("insert into public.free_usage (uid, analyses_used) values ($1, 5)", [platformDailyKey("paid", new Date())]);
    expect((await attempt("forensic", "uid-e", "e@example.com", { env: env({ FREE_TRIAL_PAUSE_AT_PAID_DAILY: "5" }) })).status).toBe("paused");
    expect(await used(await freeTrialKey("forensic", "e@example.com"))).toBe(0);
    expect((await attempt("forensic", "uid-e", "e@example.com", { env: env({ FREE_TRIAL_PAUSE_AT_PAID_DAILY: "6" }) })).status).toBe("reserved");
  });

  it("repeated account creation from one network is capped per day", async () => {
    const e = env({ FREE_TRIAL_IP_DAILY_LIMIT: "2" });
    const rs = [];
    for (let i = 0; i < 4; i++) rs.push((await attempt("quick", `uid-ip${i}`, `ip${i}@example.com`, { env: e, ip: "203.0.113.7" })).status);
    expect(rs).toEqual(["reserved", "reserved", "ip_limit", "ip_limit"]);
    expect(await used(await freeTrialKey("quick", "ip2@example.com"))).toBe(0);
    expect((await attempt("quick", "uid-ip9", "ip9@example.com", { env: e, ip: "198.51.100.4" })).status).toBe("reserved");
  });
});
