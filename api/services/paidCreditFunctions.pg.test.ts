// Verifies the atomic PostgreSQL reservation functions (supabase/migrations_pending_approval/
// paid_credit_reservation_functions.sql) against a real PostgreSQL server, under concurrency and injected failures.
//
// Local only: refuses any database that is not on localhost, and works in a scratch database it creates and drops
// (public.free_usage, the functions, and a test trigger). It never runs against Supabase.
//
//   CREDIT_PG_URL=postgres://postgres@127.0.0.1:54329/postgres npx vitest run api/services/paidCreditFunctions.pg.test.ts

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.CREDIT_PG_URL;
const isLocal = Boolean(url && /@(127\.0\.0\.1|localhost):/.test(url));
const SESSION = "11111111-1111-4111-8111-111111111111";
const COUNTER = `paid_session_${SESSION}_total`;
const MIGRATION = resolve(__dirname, "../../supabase/migrations_pending_approval/paid_credit_reservation_functions.sql");
const DOWN = resolve(__dirname, "../../supabase/migrations_pending_approval/paid_credit_reservation_functions.down.sql");
const DAY = "1 day";
const TTL = "15 minutes";
const CLAIM = "60 seconds";

describe.skipIf(!isLocal)("atomic paid-credit functions on a real PostgreSQL server", () => {
  let pool: pg.Pool;

  const reserve = (client: pg.PoolClient | pg.Pool, request: string, granted = 3, scope = "total", now = new Date()) =>
    client
      .query(`select public.paid_reserve_credit($1,$2,$3,$4,$5,$6::interval,$7::interval) as r`, [SESSION, request, scope, granted, now.toISOString(), TTL, CLAIM])
      .then((r) => r.rows[0].r);
  const release = (request: string, reservationId: string | null, now = new Date()) =>
    pool.query(`select public.paid_release_credit($1,$2,$3,$4) as r`, [SESSION, request, reservationId, now.toISOString()]).then((r) => r.rows[0].r);
  const finalize = (request: string, now = new Date()) =>
    pool.query(`select public.paid_finalize_credit($1,$2,$3) as r`, [SESSION, request, now.toISOString()]).then((r) => r.rows[0].r);
  const counter = async (uid = COUNTER) =>
    (await pool.query("select analyses_used from public.free_usage where uid = $1", [uid])).rows[0]?.analyses_used;
  const marker = async (request: string) => {
    const digest = createHash("sha256").update(request).digest("hex").slice(0, 32);
    return (await pool.query("select * from public.free_usage where uid = $1", [`paid_res_${SESSION}_${digest}`])).rows[0];
  };
  const seed = (uid: string, email: string | null, used: number, touched: Date) =>
    pool.query(
      "insert into public.free_usage (uid,email,analyses_used,first_analysis_at,last_analysis_at) values ($1,$2,$3,$4,$4)",
      [uid, email, used, touched.toISOString()]
    );
  const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 30 });
    // Supabase provides these roles; a local server does not. Created only on the local test server.
    await pool.query(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
      end $$;`);
    await pool.query(`
      drop function if exists public.paid_finalize_credit(text, text, timestamptz);
      drop function if exists public.paid_release_credit(text, text, text, timestamptz);
      drop function if exists public.paid_reserve_credit(text, text, text, integer, timestamptz, interval, interval);
      drop function if exists public.paid_reconcile(text, text, timestamptz, interval);
      drop function if exists public.paid_release_marker(text, text, timestamptz);
      drop function if exists public.paid_counter_for_state(text, text);
      drop function if exists public.paid_state_for_scope(text);
      drop function if exists public.paid_marker_uid(text, text);
      drop table if exists public.free_usage;
      create table public.free_usage (
        uid text primary key, email text, analyses_used integer not null default 0,
        first_analysis_at timestamptz, last_analysis_at timestamptz);`);
    await pool.query(readFileSync(MIGRATION, "utf8"));
  });

  afterAll(async () => {
    if (!pool) return;
    await pool.query(readFileSync(DOWN, "utf8"));
    await pool.query("drop table if exists public.free_usage");
    await pool.end();
  });

  it("only the service role can execute the functions; anon and authenticated cannot", async () => {
    const sig = "(text,text,text,integer,timestamptz,interval,interval)";
    const reserve = await pool.query(`select has_function_privilege('service_role','public.paid_reserve_credit${sig}','execute') as svc,
      has_function_privilege('anon','public.paid_reserve_credit${sig}','execute') as anon,
      has_function_privilege('authenticated','public.paid_reserve_credit${sig}','execute') as auth`);
    expect(reserve.rows[0]).toEqual({ svc: true, anon: false, auth: false });
    const others = await pool.query(`select has_function_privilege('anon','public.paid_release_credit(text,text,text,timestamptz)','execute') as release_anon,
      has_function_privilege('anon','public.paid_finalize_credit(text,text,timestamptz)','execute') as finalize_anon`);
    expect(others.rows[0]).toEqual({ release_anon: false, finalize_anon: false });
  });

  it("the migration creates functions and no tables", async () => {
    const r = await pool.query(`select count(*)::int as n from information_schema.tables where table_schema='public' and table_name like 'paid_%'`);
    expect(r.rows[0].n).toBe(0);
  });

  it("twenty concurrent requests against three credits: exactly three reserved, counter exact", async () => {
    const clients = await Promise.all(Array.from({ length: 20 }, () => pool.connect()));
    try {
      const results = await Promise.all(clients.map((c, i) => reserve(c, `burst_${i}`)));
      expect(results.filter((r) => r.status === "reserved")).toHaveLength(3);
      expect(results.filter((r) => r.status === "limit")).toHaveLength(17);
    } finally {
      clients.forEach((c) => c.release());
    }
    expect(await counter()).toBe(3);
  });

  it("concurrent retries of one request: one owner, the rest joined or in progress, one unit", async () => {
    const clients = await Promise.all(Array.from({ length: 6 }, () => pool.connect()));
    try {
      const results = await Promise.all(clients.map((c) => reserve(c, "same_request", 10)));
      expect(results.filter((r) => r.reservation_id !== null)).toHaveLength(1);
      expect(results.filter((r) => r.status === "reserved")).toHaveLength(1);
    } finally {
      clients.forEach((c) => c.release());
    }
    expect(await counter()).toBe(4);
  });

  it("only the owner can release; a foreign or missing id does nothing", async () => {
    const owner = await reserve(await pool.connect().then((c) => { c.release(); return pool; }), "owner_req", 10);
    expect(owner.reservation_id).not.toBeNull();
    const before = await counter();
    expect(await release("owner_req", null)).toEqual({ status: "noop" });
    expect(await release("owner_req", "paid_res_other")).toEqual({ status: "noop" });
    expect(await counter()).toBe(before);
  });

  it("concurrent releases of the same owner return one unit", async () => {
    const owner = await reserve(pool, "release_twice", 10);
    const before = await counter();
    const results = await Promise.all([release("release_twice", owner.reservation_id), release("release_twice", owner.reservation_id), release("release_twice", owner.reservation_id)]);
    expect(results.filter((r) => r.status === "released")).toHaveLength(1);
    expect(await counter()).toBe(before - 1);
  });

  it("a finished analysis stays charged: finalize, then retry reports consumed and charges nothing", async () => {
    const owner = await reserve(pool, "finished", 10);
    expect(await finalize("finished")).toEqual({ status: "consumed" });
    const before = await counter();
    const retry = await reserve(pool, "finished", 10);
    expect(retry.status).toBe("consumed");
    expect(await counter()).toBe(before);
    expect(await release("finished", owner.reservation_id)).toEqual({ status: "noop" });
  });

  it("a crashed reservation with a recorded unit is returned by the next reserve", async () => {
    const crashed = `crashed_${Date.now()}`;
    const digest = createHash("sha256").update(crashed).digest("hex").slice(0, 32);
    await seed(`paid_res_${SESSION}_${digest}`, "reservation:reserved", 1, minutesAgo(20));
    const before = await counter();
    await reserve(pool, `next_after_${crashed}`, 10);
    expect(await counter()).toBe(before);
    expect((await pool.query("select email from public.free_usage where uid=$1", [`paid_res_${SESSION}_${digest}`])).rows[0].email).toBe("reservation:released");
  });

  it("a live reservation with a recorded unit is never reconciled by another request", async () => {
    const live = `live_${Date.now()}`;
    const digest = createHash("sha256").update(live).digest("hex").slice(0, 32);
    await seed(`paid_res_${SESSION}_${digest}`, "reservation:reserved", 1, minutesAgo(3));
    await reserve(pool, `other_${live}`, 100);
    expect((await pool.query("select email from public.free_usage where uid=$1", [`paid_res_${SESSION}_${digest}`])).rows[0].email).toBe("reservation:reserved");
  });

  it("a failed write in the middle of a reservation rolls the whole reservation back", async () => {
    // Test-only trigger: fails the marker write for one request. The counter write before it must roll back too.
    const failing = "rollback_request";
    const digest = createHash("sha256").update(failing).digest("hex").slice(0, 32);
    await pool.query(`
      create or replace function public.test_fail_marker() returns trigger language plpgsql as $$
      begin
        if new.uid = 'paid_res_${SESSION}_${digest}' then raise exception 'injected failure'; end if;
        return new;
      end $$;
      drop trigger if exists test_fail_marker on public.free_usage;
      create trigger test_fail_marker before insert on public.free_usage for each row execute function public.test_fail_marker();`);
    try {
      const before = await counter();
      await expect(reserve(pool, failing, 100)).rejects.toThrow(/injected failure/);
      expect(await counter()).toBe(before);
      expect(await marker(failing)).toBeUndefined();
    } finally {
      await pool.query("drop trigger if exists test_fail_marker on public.free_usage; drop function if exists public.test_fail_marker();");
    }
  });

  it("a Pro-style period scope counts its own counter and renews with a new period", async () => {
    const jan = await reserve(pool, "period_jan", 5, "period:2026-01-31");
    const feb = await reserve(pool, "period_feb", 5, "period:2026-02-28");
    expect(jan.counter_used).toBe(1);
    expect(feb.counter_used).toBe(1);
    expect(await counter(`paid_session_${SESSION}_period_2026-01-31`)).toBe(1);
    expect(await counter(`paid_session_${SESSION}_period_2026-02-28`)).toBe(1);
    // A January reservation released after the boundary returns its unit to January.
    await release("period_jan", jan.reservation_id, new Date("2026-03-01T00:00:00Z"));
    expect(await counter(`paid_session_${SESSION}_period_2026-01-31`)).toBe(0);
    expect(await counter(`paid_session_${SESSION}_period_2026-02-28`)).toBe(1);
  });

  it("quick reviews on monthly plans draw on no counter", async () => {
    const quick = await reserve(pool, "quick_monthly", 5, "none");
    expect(quick.status).toBe("reserved");
    expect(quick.counter_used).toBeNull();
  });
});
