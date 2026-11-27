// Verifies the free-scan reservation functions (supabase/migrations_pending_approval/free_scan_reservation_functions.sql)
// against a real PostgreSQL server: advisory and row locking under truly concurrent connections, the allowance cap,
// joining a repeated request, account isolation, reservation expiry, finalization, release and unauthorized release.
//
// Local only: refuses any database that is not on localhost. It creates its own scratch database (so it cannot race the
// paid-credit suite, which shares CREDIT_PG_URL), applies the pending migration there only, and drops it afterwards.
// It never runs against Supabase.
//
//   CREDIT_PG_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run api/services/freeScanFunctions.pg.test.ts

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { FREE_SCAN_RESERVATION_TTL } from "./freeScanReservation.js";

const url = process.env.CREDIT_PG_URL;
const isLocal = Boolean(url && /@(127\.0\.0\.1|localhost):/.test(url));
const MIGRATION = resolve(__dirname, "../../supabase/migrations_pending_approval/free_scan_reservation_functions.sql");
const DOWN = resolve(__dirname, "../../supabase/migrations_pending_approval/free_scan_reservation_functions.down.sql");
const SKIP_LIVE = resolve(__dirname, "../../supabase/migrations_pending_approval/reconcile_skip_live_analyzer_jobs.sql");
const TTL = FREE_SCAN_RESERVATION_TTL;
const UID = "synthetic_free_uid_1";
const markerOf = (uid: string, request: string) => `free_res_${uid}_${createHash("sha256").update(request).digest("hex").slice(0, 32)}`;

describe.skipIf(!isLocal)("free-scan reservation functions on a real PostgreSQL server", () => {
  let pool: pg.Pool;
  let admin: pg.Pool;
  const scratch = `free_scan_test_${process.pid}_${Date.now()}`;
  const reserve = (request: string, { uid = UID, limit = 1, now = new Date() } = {}) =>
    pool.query("select public.free_reserve_scan($1,$2,$3,$4,$5::interval) as r", [uid, request, limit, now.toISOString(), TTL]).then((r) => r.rows[0].r);
  const finalize = (request: string, { uid = UID, now = new Date() } = {}) =>
    pool.query("select public.free_finalize_scan($1,$2,$3) as r", [uid, request, now.toISOString()]).then((r) => r.rows[0].r);
  const release = (request: string, reservationId: string | null, { uid = UID, now = new Date() } = {}) =>
    pool.query("select public.free_release_scan($1,$2,$3,$4) as r", [uid, request, reservationId, now.toISOString()]).then((r) => r.rows[0].r);
  const used = async (uid = UID) => (await pool.query("select analyses_used from public.free_usage where uid = $1", [uid])).rows[0]?.analyses_used ?? 0;
  const markerState = async (uid: string, request: string) =>
    (await pool.query("select email from public.free_usage where uid = $1", [markerOf(uid, request)])).rows[0]?.email;
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: url, max: 1 });
    await admin.query(`create database ${scratch}`);
    const scratchUrl = new URL(url!);
    scratchUrl.pathname = `/${scratch}`;
    pool = new pg.Pool({ connectionString: scratchUrl.toString(), max: 30 });
    await pool.query(`
      do $$ declare r text; begin
        foreach r in array array['anon', 'authenticated', 'service_role'] loop
          -- Roles are cluster-wide; the paid-credit suite may create them at the same moment.
          begin execute format('create role %I nologin', r); exception when duplicate_object or unique_violation then null; end;
        end loop;
      end $$;`);
    await pool.query(readFileSync(DOWN, "utf8"));
    await pool.query(`
      drop table if exists public.free_usage;
      create table public.free_usage (
        uid text primary key, email text, analyses_used integer not null default 0,
        first_analysis_at timestamptz, last_analysis_at timestamptz);
      grant select, insert, update, delete on public.free_usage to service_role;`);
    await pool.query(readFileSync(MIGRATION, "utf8"));
  });

  afterAll(async () => {
    await pool?.end();
    if (!admin) return;
    await admin.query(`drop database if exists ${scratch}`);
    await admin.end();
  });

  beforeEach(async () => { await pool.query("truncate public.free_usage"); });

  it("grants a new account's single scan to exactly one of 20 concurrent requests (no counter row exists yet)", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => reserve(`req_race_${i}`)));
    expect(results.filter((r) => r.status === "reserved")).toHaveLength(1);
    expect(results.filter((r) => r.status === "limit")).toHaveLength(19);
    expect(await used()).toBe(1);
  });

  it("caps 20 concurrent requests at an allowance of 3", async () => {
    const results = await Promise.all(Array.from({ length: 20 }, (_, i) => reserve(`req_cap_${i}`, { limit: 3 })));
    expect(results.filter((r) => r.status === "reserved").map((r) => r.slot).sort()).toEqual([1, 2, 3]);
    expect(await used()).toBe(3);
  });

  it("charges one unit for 15 concurrent repeats of the same request; only one attempt owns the reservation", async () => {
    const results = await Promise.all(Array.from({ length: 15 }, () => reserve("req_same", { limit: 5 })));
    const owners = results.filter((r) => r.status === "reserved");
    expect(owners).toHaveLength(1);
    expect(owners[0].reservation_id).toBe(markerOf(UID, "req_same"));
    expect(results.filter((r) => r.status === "joined").every((r) => r.reservation_id === null)).toBe(true);
    expect(await used()).toBe(1);
  });

  it("keeps accounts isolated under concurrency, including a uid that extends another uid", async () => {
    const uids = [UID, `${UID}_x`, "synthetic_free_uid_2"];
    const results = await Promise.all(uids.flatMap((uid) => [0, 1, 2].map((i) => reserve(`req_iso_${i}`, { uid }))));
    expect(results.filter((r) => r.status === "reserved")).toHaveLength(3);
    for (const uid of uids) expect(await used(uid)).toBe(1);
    // Expiring the prefix account's reservation must never return a unit to the other account.
    const [first] = results.filter((r) => r.status === "reserved");
    expect(first).toBeDefined();
    await pool.query("update public.free_usage set last_analysis_at = $1, first_analysis_at = $1 where uid like 'free_res_%'", [minutesAgo(30).toISOString()]);
    await reserve("req_iso_later", { uid: UID, limit: 1 });
    expect(await used(`${UID}_x`)).toBe(1);
  });

  it("finalizes once: a consumed scan is not charged again and cannot be released", async () => {
    const r = await reserve("req_final");
    expect(await finalize("req_final")).toEqual({ status: "consumed" });
    expect(await finalize("req_final")).toEqual({ status: "consumed" });
    expect(await reserve("req_final")).toMatchObject({ status: "consumed" });
    expect(await release("req_final", r.reservation_id)).toEqual({ status: "noop" });
    expect(await used()).toBe(1);
  });

  it("refunds on release by the owning attempt, once, even when 10 releases race", async () => {
    const r = await reserve("req_refund");
    const results = await Promise.all(Array.from({ length: 10 }, () => release("req_refund", r.reservation_id)));
    expect(results.filter((x) => x.status === "released")).toHaveLength(1);
    expect(await used()).toBe(0);
    expect(await finalize("req_refund")).toEqual({ status: "released" });
    expect(await reserve("req_next")).toMatchObject({ status: "reserved" });
  });

  it("refuses release without the reservation id, with another request's id, or from another account", async () => {
    const a = await reserve("req_owner", { limit: 3 });
    await reserve("req_other", { limit: 3 });
    expect(await release("req_owner", null)).toEqual({ status: "noop" });
    expect(await release("req_owner", markerOf(UID, "req_other"))).toEqual({ status: "noop" });
    expect(await release("req_owner", a.reservation_id, { uid: "synthetic_attacker" })).toEqual({ status: "noop" });
    expect(await used()).toBe(2);
    expect(await markerState(UID, "req_owner")).toBe("reservation:reserved");
  });

  it("a reservation older than the TTL is released by the account's next reservation; its finalize then reports released (delivered uncharged)", async () => {
    await reserve("req_queued", { now: minutesAgo(16) });
    expect(await reserve("req_new")).toMatchObject({ status: "reserved", slot: 1 });
    expect(await markerState(UID, "req_queued")).toBe("reservation:released");
    expect(await finalize("req_queued")).toEqual({ status: "released" });
    expect(await used()).toBe(1);
  });

  it("a reservation inside the TTL is not released by another request, and a repeat of it joins", async () => {
    await reserve("req_live", { now: minutesAgo(14), limit: 2 });
    expect(await reserve("req_other", { limit: 2 })).toMatchObject({ status: "reserved", slot: 2 });
    expect(await reserve("req_live", { limit: 2 })).toMatchObject({ status: "joined" });
    expect(await used()).toBe(2);
  });

  it("an expired repeat of the same request takes a new claim without double charging", async () => {
    await reserve("req_retry", { now: minutesAgo(20) });
    expect(await reserve("req_retry")).toMatchObject({ status: "reserved", slot: 1 });
    expect(await used()).toBe(1);
  });

  it("rolls back the counter when the transaction that reserved fails", async () => {
    const client = await pool.connect();
    try {
      await client.query("begin");
      await client.query("select public.free_reserve_scan($1,$2,1,now(),$3::interval)", [UID, "req_rollback", TTL]);
      await client.query("rollback");
    } finally { client.release(); }
    expect(await used()).toBe(0);
    expect(await markerState(UID, "req_rollback")).toBeUndefined();
  });

  it("grants execute only to service_role", async () => {
    const { rows } = await pool.query(`
      select p.proname, has_function_privilege('anon', p.oid, 'execute') as anon,
             has_function_privilege('authenticated', p.oid, 'execute') as auth,
             has_function_privilege('service_role', p.oid, 'execute') as service
        from pg_proc p join pg_namespace n on n.oid = p.pronamespace
       where n.nspname = 'public' and p.proname like 'free\\_%'`);
    expect(rows.map((r) => r.proname).sort()).toEqual(["free_finalize_scan", "free_marker_uid", "free_reconcile", "free_release_marker", "free_release_scan", "free_reserve_scan"]);
    for (const r of rows) expect([r.anon, r.auth, r.service]).toEqual([false, false, true]);
  });
  // NAV-004: a queued job's reservation must not be returned while the job still waits. Pending migration
  // reconcile_skip_live_analyzer_jobs.sql; the analyzer_jobs columns it reads are created here in scratch form.
  it("with reconcile_skip_live_analyzer_jobs applied, a queued job's reservation survives the TTL; a job idle over 2 hours does not", async () => {
    await pool.query("drop table if exists public.analyzer_jobs; create table public.analyzer_jobs (job_id text primary key, reservation_id text, status text, updated_at timestamptz)");
    await pool.query(readFileSync(SKIP_LIVE, "utf8"));
    await reserve("req_waiting", { now: minutesAgo(40), limit: 3 });
    await reserve("req_abandoned", { now: minutesAgo(40), limit: 3 });
    await pool.query("insert into public.analyzer_jobs values ('job_waiting', $1, 'queued', $2), ('job_abandoned', $3, 'queued', $4)",
      [markerOf(UID, "req_waiting"), minutesAgo(1).toISOString(), markerOf(UID, "req_abandoned"), minutesAgo(180).toISOString()]);
    await reserve("req_after", { limit: 3 });
    expect(await markerState(UID, "req_waiting")).toBe("reservation:reserved");
    expect(await markerState(UID, "req_abandoned")).toBe("reservation:released");
    expect(await used()).toBe(2);
    expect(await finalize("req_waiting")).toEqual({ status: "consumed" });
  });
});
