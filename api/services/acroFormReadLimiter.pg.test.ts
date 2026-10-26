// Verifies supabase/migrations_pending_approval/acroform_shared_read_limit.sql against a real PostgreSQL server:
// grants, row level security, the fixed-window limit, concurrency, and window cleanup.
//
// Local only: runs when NAVIGATOR_PG_TEST_ADMIN_URL points at localhost or 127.0.0.1, and refuses any other host.
// It creates and drops only its own objects (acroform_read_limits, acroform_consume_read). It never runs against Supabase.
//
//   NAVIGATOR_PG_TEST_ADMIN_URL=postgres://postgres:<password>@127.0.0.1:<port>/postgres npx vitest run api/services/acroFormReadLimiter.pg.test.ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import pg from "pg";

const url = process.env.NAVIGATOR_PG_TEST_ADMIN_URL;
const isLocal = Boolean(url && /@(127\.0\.0\.1|localhost):/.test(url));
const MIGRATION = resolve(__dirname, "../../supabase/migrations_pending_approval/acroform_shared_read_limit.sql");
const FN = "public.acroform_consume_read(text,integer,integer)";
const WINDOW = 900;

describe.skipIf(!isLocal)("acroform_consume_read on a real PostgreSQL server", () => {
  let pool: pg.Pool;
  const consume = (uid: string, limit: number, window = WINDOW) =>
    pool.query("select public.acroform_consume_read($1,$2,$3) as ok", [uid, limit, window]).then(r => r.rows[0].ok as boolean);

  beforeAll(async () => {
    pool = new pg.Pool({ connectionString: url, max: 30 });
    // Supabase provides these roles; a local server does not. Created only on this local test server.
    await pool.query(`
      do $$ begin
        if not exists (select 1 from pg_roles where rolname = 'anon') then create role anon nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'authenticated') then create role authenticated nologin; end if;
        if not exists (select 1 from pg_roles where rolname = 'service_role') then create role service_role nologin; end if;
      end $$;
      drop function if exists public.acroform_consume_read(text, integer, integer);
      drop table if exists public.acroform_read_limits;
      grant usage on schema public to anon, authenticated, service_role;`);
    await pool.query(readFileSync(MIGRATION, "utf8"));
  });

  afterAll(async () => {
    await pool?.query("drop function if exists public.acroform_consume_read(text, integer, integer); drop table if exists public.acroform_read_limits;");
    await pool?.end();
  });

  it("is a security definer function with search_path pinned", async () => {
    const r = await pool.query("select prosecdef, proconfig from pg_proc where oid = $1::regprocedure", [FN]);
    expect(r.rows[0].prosecdef).toBe(true);
    expect(JSON.stringify(r.rows[0].proconfig)).toContain("search_path=public");
  });

  it("grants execute to service_role only", async () => {
    const q = (role: string) => pool.query("select has_function_privilege($1, $2, 'EXECUTE') as ok", [role, FN]).then(r => r.rows[0].ok);
    expect(await q("service_role")).toBe(true);
    expect(await q("anon")).toBe(false);
    expect(await q("authenticated")).toBe(false);
    expect(await q("public")).toBe(false);
  });

  it("keeps the table private: RLS on, no privileges for anon or authenticated", async () => {
    const rls = await pool.query("select relrowsecurity from pg_class where oid = 'public.acroform_read_limits'::regclass");
    expect(rls.rows[0].relrowsecurity).toBe(true);
    for (const role of ["anon", "authenticated"]) {
      const r = await pool.query("select has_table_privilege($1, 'public.acroform_read_limits', 'SELECT,INSERT,UPDATE,DELETE') as ok", [role]);
      expect(r.rows[0].ok).toBe(false);
    }
  });

  it("refuses a call from anon or authenticated", async () => {
    for (const role of ["anon", "authenticated"]) {
      const c = await pool.connect();
      try {
        await c.query(`set role ${role}`);
        await expect(c.query("select public.acroform_consume_read('u-denied', 1, 60)")).rejects.toThrow(/permission denied/i);
      } finally {
        await c.query("reset role").catch(() => undefined);
        c.release();
      }
    }
  });

  it("allows the first N reads in a window and refuses the rest, per user", async () => {
    const results: boolean[] = [];
    for (let i = 0; i < 4; i++) results.push(await consume("u-fixed", 3));
    expect(results).toEqual([true, true, true, false]);
    // Another user has an independent count.
    expect(await consume("u-other", 3)).toBe(true);
  });

  it("counts exactly under concurrency: 30 simultaneous reads against a limit of 20 allow exactly 20", async () => {
    const allowed = await Promise.all(Array.from({ length: 30 }, () => consume("u-burst", 20)));
    expect(allowed.filter(Boolean)).toHaveLength(20);
  });

  it("removes windows that have ended", async () => {
    await pool.query(
      "insert into public.acroform_read_limits (uid, window_start, reads) values ('u-old', now() - interval '3 days', 5)"
    );
    await consume("u-new", 5);
    const left = await pool.query("select count(*)::int as n from public.acroform_read_limits where uid = 'u-old'");
    expect(left.rows[0].n).toBe(0);
  });

  it("has an index that serves the window cleanup", async () => {
    const r = await pool.query("select indexname from pg_indexes where schemaname = 'public' and tablename = 'acroform_read_limits'");
    expect(r.rows.map(x => x.indexname)).toContain("acroform_read_limits_window_start_idx");
  });

  it("rejects invalid arguments instead of allowing the read", async () => {
    await expect(consume("", 3)).rejects.toThrow(/invalid rate limit arguments/);
    await expect(consume("u-x", 0)).rejects.toThrow(/invalid rate limit arguments/);
    await expect(consume("u-x", 3, 0)).rejects.toThrow(/invalid rate limit arguments/);
  });
});
