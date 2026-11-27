// T-05: the pending rate-limit migration and its rollback on a disposable PostgreSQL. Runs only where
// CREDIT_PG_URL is set. Creates and drops only navigator_rate_limit_hits and its function.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

const url = process.env.CREDIT_PG_URL;
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, "../../supabase/migrations_pending_approval");
const UP = readFileSync(path.join(dir, "create_navigator_rate_limit_hits.sql"), "utf8");
const DOWN = readFileSync(path.join(dir, "rollback_navigator_rate_limit_hits.sql"), "utf8");
const KEY = (c: string) => c.repeat(64);

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

  it("opens a new window after the old one ends", async () => {
    await db.query("insert into public.navigator_rate_limit_hits (key_hash, window_start, hits) values ($1, now() - interval '2 minutes', 8)", [KEY("d")]);
    expect((await hit(KEY("d"), 8, 60)).allowed).toBe(true);
  });

  it("deletes windows older than a day, at most 50 per allowed call", async () => {
    await db.query("insert into public.navigator_rate_limit_hits (key_hash, window_start, hits) select lpad(to_hex(g), 64, 'e'), now() - interval '2 days', 1 from generate_series(1, 60) g");
    await hit(KEY("f"), 8, 60);
    expect(Number((await db.query("select count(*) from public.navigator_rate_limit_hits where window_start < now() - interval '1 day'")).rows[0].count)).toBe(10);
  });

  it("rejects malformed arguments", async () => {
    for (const args of [["not-a-hash", 3, 60], [KEY("A"), 3, 60], [KEY("a"), 0, 60], [KEY("a"), 10001, 60], [KEY("a"), 3, 0], [KEY("a"), 3, 86401], [null, 3, 60]]) {
      await expect(db.query("select * from public.navigator_rate_limit_hit($1, $2, $3)", args)).rejects.toThrow(/invalid rate limit arguments/);
    }
  });

  it("is callable only by service_role; anon and authenticated cannot call it or read the table", async () => {
    for (const role of ["anon", "authenticated"]) {
      await db.query("begin");
      try {
        await db.query(`set local role ${role}`);
        await expect(db.query("select * from public.navigator_rate_limit_hit($1, 3, 60)", [KEY("a")])).rejects.toThrow(/permission denied/);
      } finally { await db.query("rollback"); }
      await db.query("begin");
      try {
        await db.query(`set local role ${role}`);
        await expect(db.query("select * from public.navigator_rate_limit_hits")).rejects.toThrow(/permission denied/);
      } finally { await db.query("rollback"); }
    }
    await db.query("begin");
    try {
      await db.query("set local role service_role");
      expect((await hit(KEY("a"), 3, 60)).allowed).toBe(true);
    } finally { await db.query("rollback"); }
  });

  it("rollback removes everything and is safe to run twice", async () => {
    await db.query(DOWN);
    await db.query(DOWN);
    const left = await db.query("select to_regclass('public.navigator_rate_limit_hits') as t, to_regprocedure('public.navigator_rate_limit_hit(text,integer,integer)') as f");
    expect(left.rows[0]).toEqual({ t: null, f: null });
    await db.query(UP);
  });
});
