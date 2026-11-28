// T-05 / Migration C: the pending rate-limit migration, preflight, and rollback on disposable PostgreSQL
// (plus real PostgREST HTTP compatibility when POSTGREST_BIN is available). Runs only where CREDIT_PG_URL is set.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RATE_LIMIT_FAIL_CLOSED_RETRY_SECONDS,
  RATE_LIMIT_STORE_FAILURE_MODE,
  persistentRateLimitRetryAfter,
} from "../../functions/api/_persistent-rate-limit";
import { RATE_LIMITS, resetRateLimitsForTests } from "../../functions/api/_rate-limit";
import { findPostgrest, Harness, localJwt } from "./helpers/postgrest-harness";

const url = process.env.CREDIT_PG_URL;
const postgrestBin = findPostgrest();
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, "../../supabase/migrations_pending_approval");
const UP = readFileSync(path.join(dir, "create_navigator_rate_limit_hits.sql"), "utf8");
const DOWN = readFileSync(path.join(dir, "rollback_navigator_rate_limit_hits.sql"), "utf8");
const PREFLIGHT = readFileSync(path.join(dir, "create_navigator_rate_limit_hits.preflight.sql"), "utf8");
const KEY = (c: string) => c.repeat(64);

async function runPreflight(client: pg.Client): Promise<Record<string, unknown>> {
  const res = (await client.query(PREFLIGHT)) as unknown as pg.QueryResult[];
  const selectRes = Array.isArray(res) ? res.find((r) => r.command === "SELECT") : (res as unknown as pg.QueryResult);
  if (!selectRes || !selectRes.rows[0]) throw new Error("preflight returned no SELECT row");
  return selectRes.rows[0];
}

describe.skipIf(!url)("navigator_rate_limit_hits migration", () => {
  let db: pg.Client;
  const hit = async (key: string, limit: number, windowSeconds: number, client: pg.Client = db) =>
    (await client.query("select * from public.navigator_rate_limit_hit($1, $2, $3)", [key, limit, windowSeconds])).rows[0];

  beforeAll(async () => {
    db = new pg.Client({ connectionString: url });
    await db.connect();
    await db.query(DOWN);
    for (const role of ["anon", "authenticated", "service_role"]) {
      await db.query(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${role}') then create role ${role} nologin; end if; end $$;`);
    }
    await db.query(UP);
  });
  beforeEach(async () => { await db.query("delete from public.navigator_rate_limit_hits"); });
  afterAll(async () => {
    await db.query(DOWN);
    await db.end();
  });

  it("allows exactly the limit per key and window, and refused calls do not increment", async () => {
    const results = [];
    for (let i = 0; i < 5; i++) results.push(await hit(KEY("a"), 3, 600));
    expect(results.map((r) => r.allowed)).toEqual([true, true, true, false, false]);
    expect(results[3].retry_after_seconds).toBeGreaterThanOrEqual(1);
    expect(results[3].retry_after_seconds).toBeLessThanOrEqual(600);
    expect((await db.query("select hits from public.navigator_rate_limit_hits where key_hash = $1", [KEY("a")])).rows).toEqual([{ hits: 3 }]);
    expect((await hit(KEY("b"), 3, 600)).allowed).toBe(true);
  });

  it("is atomic under concurrency: 40 parallel connections, limit 8, exactly 8 allowed", async () => {
    const clients = await Promise.all(Array.from({ length: 40 }, async () => { const c = new pg.Client({ connectionString: url }); await c.connect(); return c; }));
    try {
      const rows = await Promise.all(clients.map((c) => hit(KEY("c"), 8, 60, c)));
      expect(rows.filter((r) => r.allowed)).toHaveLength(8);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  });

  it("is atomic on cold-insert race: 40 parallel connections, limit 1, exactly 1 allowed", async () => {
    const clients = await Promise.all(Array.from({ length: 40 }, async () => { const c = new pg.Client({ connectionString: url }); await c.connect(); return c; }));
    try {
      const rows = await Promise.all(clients.map((c) => hit(KEY("1"), 1, 600, c)));
      expect(rows.filter((r) => r.allowed)).toHaveLength(1);
      expect(rows.filter((r) => !r.allowed).every((r) => r.retry_after_seconds >= 1)).toBe(true);
      expect((await db.query("select hits from public.navigator_rate_limit_hits where key_hash = $1", [KEY("1")])).rows).toEqual([{ hits: 1 }]);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  });

  it("handles concurrent pruning under contention with zero deadlocks or errors", async () => {
    await db.query("insert into public.navigator_rate_limit_hits (key_hash, window_start, hits) select lpad(to_hex(g), 64, '0'), now() - interval '2 days', 1 from generate_series(1, 2000) g");
    const clients = await Promise.all(Array.from({ length: 40 }, async () => { const c = new pg.Client({ connectionString: url }); await c.connect(); return c; }));
    try {
      const rows = await Promise.all(clients.map((c, idx) => hit(idx.toString(16).padStart(64, "9"), 5, 600, c)));
      expect(rows.every((r) => r.allowed)).toBe(true);
      const remaining = Number((await db.query("select count(*) from public.navigator_rate_limit_hits where window_start < now() - interval '1 day'")).rows[0].count);
      expect(remaining).toBeLessThan(2000);
    } finally {
      await Promise.all(clients.map((c) => c.end()));
    }
  });

  it("handles interrupted/rolled-back transactions without leaking phantom hits", async () => {
    const c1 = new pg.Client({ connectionString: url });
    const c2 = new pg.Client({ connectionString: url });
    await Promise.all([c1.connect(), c2.connect()]);
    try {
      await c1.query("begin");
      const r1 = await hit(KEY("2"), 1, 600, c1);
      expect(r1.allowed).toBe(true);
      // c2 blocks on the unique-index lock held by c1 until c1 rolls back.
      const p2 = hit(KEY("2"), 1, 600, c2);
      await new Promise((r) => setTimeout(r, 50));
      await c1.query("rollback");
      const r2 = await p2;
      expect(r2.allowed).toBe(true);
      expect((await db.query("select hits from public.navigator_rate_limit_hits where key_hash = $1", [KEY("2")])).rows).toEqual([{ hits: 1 }]);
    } finally {
      await Promise.all([c1.end(), c2.end()]);
    }
  });

  it("opens a new window after the old one ends", async () => {
    await db.query("insert into public.navigator_rate_limit_hits (key_hash, window_start, hits) values ($1, now() - interval '2 minutes', 8)", [KEY("d")]);
    expect((await hit(KEY("d"), 8, 60)).allowed).toBe(true);
  });

  it("deletes windows older than a day, at most 50 per allowed call", async () => {
    await db.query("insert into public.navigator_rate_limit_hits (key_hash, window_start, hits) select lpad(to_hex(g), 64, 'e'), now() - interval '2 days', 1 from generate_series(1, 60) g");
    await hit(KEY("f"), 8, 60);
    expect(Number((await db.query("select count(*) from public.navigator_rate_limit_hits where window_start < now() - interval '1 day'")).rows[0].count)).toBe(10);
  });

  it("rejects malformed arguments with SQLSTATE 22023 and enforces table check constraints", async () => {
    for (const args of [["not-a-hash", 3, 60], [KEY("A"), 3, 60], [KEY("a"), 0, 60], [KEY("a"), 10001, 60], [KEY("a"), 3, 0], [KEY("a"), 3, 86401], [null, 3, 60]]) {
      await expect(db.query("select * from public.navigator_rate_limit_hit($1, $2, $3)", args)).rejects.toMatchObject({ code: "22023" });
    }
    await expect(db.query("insert into public.navigator_rate_limit_hits (key_hash, window_start, hits) values ('bad', now(), 1)")).rejects.toMatchObject({ code: "23514" });
    await expect(db.query("insert into public.navigator_rate_limit_hits (key_hash, window_start, hits) values ($1, now(), 0)", [KEY("3")])).rejects.toMatchObject({ code: "23514" });
  });

  it("creates expected PK, secondary window index, RLS state, and security-definer search_path", async () => {
    const indexes = (await db.query(
      "select indexname, indexdef from pg_indexes where schemaname = 'public' and tablename = 'navigator_rate_limit_hits' order by indexname",
    )).rows;
    expect(indexes.map((r) => r.indexname)).toEqual(["navigator_rate_limit_hits_pkey", "navigator_rate_limit_hits_window_idx"]);
    expect(indexes[0].indexdef).toContain("(key_hash, window_start)");
    expect(indexes[1].indexdef).toContain("(window_start)");

    const post = await runPreflight(db);
    expect(post).toMatchObject({
      table_exists: true,
      window_idx_exists: true,
      rls_enabled: true,
      rls_policy_count: 0,
      function_exists: true,
      function_security_definer: true,
      function_search_path_pinned: true,
      supabase_roles_found: 3,
      service_role_can_execute: true,
      anon_can_execute: false,
      authenticated_can_execute: false,
      public_can_execute: false,
      anon_can_select_table: false,
      authenticated_can_select_table: false,
      public_can_select_table: false,
    });
  });

  it("is callable only by service_role; anon and authenticated cannot call it or read/write the table even with Supabase default privileges", async () => {
    // Run inside an isolated database so ALTER DEFAULT PRIVILEGES never mutates the shared test database.
    const isoName = `rate_limit_priv_${Date.now()}_${Math.floor(Math.random() * 1000)}`;
    const isoUrl = new URL(url!);
    isoUrl.pathname = `/${isoName}`;
    await db.query(`create database ${isoName}`);
    const iso = new pg.Client({ connectionString: isoUrl.toString() });
    await iso.connect();
    try {
      await iso.query("alter default privileges in schema public grant all on tables to anon, authenticated, service_role");
      await iso.query("alter default privileges in schema public grant execute on functions to anon, authenticated, service_role");
      await iso.query(UP);
      for (const role of ["anon", "authenticated"]) {
        for (const stmt of [
          ["select * from public.navigator_rate_limit_hit($1, 3, 60)", [KEY("a")]],
          ["select * from public.navigator_rate_limit_hits", []],
          ["insert into public.navigator_rate_limit_hits (key_hash, window_start, hits) values ($1, now(), 1)", [KEY("4")]],
          ["delete from public.navigator_rate_limit_hits", []],
        ] as Array<[string, unknown[]]>) {
          await iso.query("begin");
          try {
            await iso.query(`set local role ${role}`);
            await expect(iso.query(stmt[0], stmt[1])).rejects.toThrow(/permission denied/);
          } finally { await iso.query("rollback"); }
        }
      }
      await iso.query("begin");
      try {
        await iso.query("set local role service_role");
        expect((await hit(KEY("a"), 3, 60, iso)).allowed).toBe(true);
      } finally { await iso.query("rollback"); }
    } finally {
      await iso.end();
      await db.query(`drop database if exists ${isoName} with (force)`);
    }
  });

  it("migration reapplication fails cleanly inside its transaction and preserves existing data", async () => {
    await hit(KEY("5"), 5, 600);
    try {
      await expect(db.query(UP)).rejects.toMatchObject({ code: "42P07" });
    } finally {
      await db.query("rollback");
    }
    expect((await db.query("select hits from public.navigator_rate_limit_hits where key_hash = $1", [KEY("5")])).rows).toEqual([{ hits: 1 }]);
    expect((await hit(KEY("5"), 5, 600)).allowed).toBe(true);
  });

  it("preserves existing customer entitlement tables across apply, hits, and rollback", async () => {
    await db.query("create temp table synthetic_entitlements (id text primary key, credits integer not null)");
    await db.query("insert into synthetic_entitlements values ('cust_1', 5), ('cust_2', 12)");
    await db.query(DOWN);
    const before = await runPreflight(db);
    expect(before).toMatchObject({ table_exists: false, window_idx_exists: false, function_exists: false, supabase_roles_found: 3 });
    await db.query(UP);
    await hit(KEY("6"), 3, 600);
    await db.query(DOWN);
    const afterDown = await runPreflight(db);
    expect(afterDown).toMatchObject({ table_exists: false, window_idx_exists: false, function_exists: false });
    await db.query(UP);
    expect((await db.query("select * from synthetic_entitlements order by id")).rows).toEqual([
      { id: "cust_1", credits: 5 },
      { id: "cust_2", credits: 12 },
    ]);
  });

  it("rollback removes everything and is safe to run twice", async () => {
    await db.query(DOWN);
    await db.query(DOWN);
    const left = await db.query("select to_regclass('public.navigator_rate_limit_hits') as t, to_regclass('public.navigator_rate_limit_hits_window_idx') as idx, to_regprocedure('public.navigator_rate_limit_hit(text,integer,integer)') as f");
    expect(left.rows[0]).toEqual({ t: null, idx: null, f: null });
    await db.query(UP);
  });
});

describe.skipIf(!url || !postgrestBin)("Migration C compatibility with real PostgREST 12.2.3", () => {
  let h: Harness;
  const baseUrl = "https://synthetic.supabase.co";
  const dbName = `rate_limit_c_${Date.now()}_${Math.floor(Math.random() * 1000)}`;

  beforeAll(async () => {
    h = new Harness(url!, dbName, postgrestBin!);
    await h.start([
      `do $$ declare r text; begin
         for r in select unnest(array['anon','authenticated','service_role']) loop
           if not exists (select 1 from pg_roles where rolname = r) then execute format('create role %I nologin', r); end if;
         end loop;
       end $$;`,
      "grant usage on schema public to anon, authenticated, service_role",
      "alter default privileges in schema public grant all on tables to anon, authenticated, service_role",
      "alter default privileges in schema public grant execute on functions to anon, authenticated, service_role",
    ]);
  });

  afterAll(async () => {
    vi.restoreAllMocks();
    await h?.stop();
  });

  beforeEach(() => {
    resetRateLimitsForTests();
  });

  it("before C is applied: flag off works normally; flag on fails open for open buckets and closed for closed buckets", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const envOff = { PERSISTENT_RATE_LIMITS: undefined, STAGING_SUPABASE_URL: baseUrl, STAGING_SUPABASE_SERVICE_ROLE_KEY: localJwt("service_role") };
    expect(await persistentRateLimitRetryAfter(envOff, "analyze", "uid:old_app", { fetcher: h.fetch })).toBe(0);

    const envOn = { PERSISTENT_RATE_LIMITS: "true", STAGING_SUPABASE_URL: baseUrl, STAGING_SUPABASE_SERVICE_ROLE_KEY: localJwt("service_role") };
    for (const bucket of Object.keys(RATE_LIMIT_STORE_FAILURE_MODE) as Array<keyof typeof RATE_LIMITS>) {
      resetRateLimitsForTests();
      const retry = await persistentRateLimitRetryAfter(envOn, bucket, "uid:pre_apply", { fetcher: h.fetch });
      expect(retry).toBe(RATE_LIMIT_STORE_FAILURE_MODE[bucket] === "closed" ? RATE_LIMIT_FAIL_CLOSED_RETRY_SECONDS : 0);
    }
    expect(warn).toHaveBeenCalled();
  });

  it("after C is applied: service_role enforces exact cross-isolate limits over HTTP while anon/authenticated are denied", async () => {
    await h.pool.query(UP);
    await h.pool.query("notify pgrst, 'reload schema'");
    const serviceEnv = { PERSISTENT_RATE_LIMITS: "true", STAGING_SUPABASE_URL: baseUrl, STAGING_SUPABASE_SERVICE_ROLE_KEY: localJwt("service_role") };
    // Wait for PostgREST schema cache to expose the new RPC.
    for (let i = 0; i < 50; i++) {
      const probe = await h.fetch(`${baseUrl}/rest/v1/rpc/navigator_rate_limit_hit`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localJwt("service_role")}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_key_hash: KEY("7"), p_limit: 100, p_window_seconds: 60 }),
      });
      if (probe.ok) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    // Simulate requests landing on fresh isolates: per-isolate map is cleared every call, PostgREST+PG enforces limit.
    const results: number[] = [];
    for (let i = 0; i < RATE_LIMITS.requestAccess.limit + 2; i++) {
      resetRateLimitsForTests();
      results.push(await persistentRateLimitRetryAfter(serviceEnv, "requestAccess", "uid:cross_isolate_user", { fetcher: h.fetch }));
    }
    expect(results.slice(0, RATE_LIMITS.requestAccess.limit)).toEqual(Array(RATE_LIMITS.requestAccess.limit).fill(0));
    expect(results[RATE_LIMITS.requestAccess.limit]).toBeGreaterThanOrEqual(1);
    expect(results[RATE_LIMITS.requestAccess.limit + 1]).toBeGreaterThanOrEqual(1);

    // Direct PostgREST calls as anon or authenticated must be rejected for both RPC and table.
    for (const role of ["anon", "authenticated"]) {
      const rpcRes = await h.fetch(`${baseUrl}/rest/v1/rpc/navigator_rate_limit_hit`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localJwt(role)}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_key_hash: KEY("8"), p_limit: 5, p_window_seconds: 60 }),
      });
      expect(rpcRes.status).toBeGreaterThanOrEqual(401);
      expect(rpcRes.status).toBeLessThan(500);

      const tblRes = await h.fetch(`${baseUrl}/rest/v1/navigator_rate_limit_hits?select=*`, {
        method: "GET",
        headers: { Authorization: `Bearer ${localJwt(role)}` },
      });
      expect(tblRes.status).toBeGreaterThanOrEqual(401);
      expect(tblRes.status).toBeLessThan(500);
    }
  });

  it("after C is rolled back: flag off still works; flag on degrades cleanly (open vs closed)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await h.pool.query(DOWN);
    await h.pool.query("notify pgrst, 'reload schema'");
    for (let i = 0; i < 50; i++) {
      const probe = await h.fetch(`${baseUrl}/rest/v1/rpc/navigator_rate_limit_hit`, {
        method: "POST",
        headers: { Authorization: `Bearer ${localJwt("service_role")}`, "Content-Type": "application/json" },
        body: JSON.stringify({ p_key_hash: KEY("7"), p_limit: 100, p_window_seconds: 60 }),
      });
      if (probe.status === 404) break;
      await new Promise((r) => setTimeout(r, 100));
    }

    const envOff = { PERSISTENT_RATE_LIMITS: undefined, STAGING_SUPABASE_URL: baseUrl, STAGING_SUPABASE_SERVICE_ROLE_KEY: localJwt("service_role") };
    expect(await persistentRateLimitRetryAfter(envOff, "activateCode", "uid:after_rollback", { fetcher: h.fetch })).toBe(0);

    const envOn = { PERSISTENT_RATE_LIMITS: "true", STAGING_SUPABASE_URL: baseUrl, STAGING_SUPABASE_SERVICE_ROLE_KEY: localJwt("service_role") };
    expect(await persistentRateLimitRetryAfter(envOn, "analyze", "uid:after_rollback", { fetcher: h.fetch })).toBe(0);
    expect(await persistentRateLimitRetryAfter(envOn, "activateCode", "uid:after_rollback", { fetcher: h.fetch })).toBe(RATE_LIMIT_FAIL_CLOSED_RETRY_SECONDS);
  });
});
