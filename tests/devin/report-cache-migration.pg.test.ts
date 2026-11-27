// DEVIN-PERF-03: the pending report-cache migration and its rollback on a disposable PostgreSQL. Runs only where
// CREDIT_PG_URL is set. Creates and drops its own schema-qualified objects in public; it touches no other data.
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const url = process.env.CREDIT_PG_URL;
const here = path.dirname(fileURLToPath(import.meta.url));
const dir = path.resolve(here, "../../supabase/migrations_pending_approval");
const UP = readFileSync(path.join(dir, "create_navigator_report_cache.sql"), "utf8");
const DOWN = readFileSync(path.join(dir, "rollback_navigator_report_cache.sql"), "utf8");
const KEY = (c: string) => c.repeat(64);

describe.skipIf(!url)("navigator_report_cache migration", () => {
  let db: pg.Client;
  const row = (owner: string, key: string, over: Record<string, unknown> = {}) => ({
    owner_uid: owner, cache_key: key, key_version: "v1", document_fingerprint: KEY("f"), mode: "full",
    analyzer_version: "a1", prompt_version: "p1", primary_model: "m", verification_model: "m",
    legal_reference_version: "CYFSA-2026-06-24", legal_effective_date: "2026-06-24", job_id: "req_1_abc",
    completed_at: "2026-11-20T10:00:00Z", expires_at: "2026-12-20T10:00:00Z", ...over,
  });
  const insert = (r: Record<string, unknown>) => {
    const cols = Object.keys(r);
    return db.query(`insert into public.navigator_report_cache (${cols.join(",")}) values (${cols.map((_, i) => `$${i + 1}`).join(",")})`, Object.values(r));
  };

  beforeAll(async () => {
    db = new pg.Client({ connectionString: url });
    await db.connect();
    await db.query(DOWN);
    for (const role of ["anon", "authenticated"]) {
      await db.query(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${role}') then create role ${role} nologin; end if; end $$;`);
    }
    await db.query(UP);
  });
  afterAll(async () => {
    await db.query(DOWN);
    await db.end();
  });

  it("allows one entry per owner and key, and the same key under another owner", async () => {
    await insert(row("uid_a", KEY("a")));
    await expect(insert(row("uid_a", KEY("a")))).rejects.toThrow(/duplicate key/);
    await insert(row("uid_b", KEY("a")));
  });

  it("rejects eligibility longer than 30 days, malformed keys and non-completed rows", async () => {
    await expect(insert(row("uid_c", KEY("c"), { expires_at: "2026-12-21T10:00:01Z" }))).rejects.toThrow(/check/);
    await expect(insert(row("uid_c", "not-a-hash"))).rejects.toThrow(/check/);
    await expect(insert(row("uid_c", KEY("d"), { status: "running" }))).rejects.toThrow(/check/);
    await expect(insert(row("uid_c", KEY("e"), { job_id: "../../etc" }))).rejects.toThrow(/check/);
  });

  it("gives anon and authenticated no access to the table or functions", async () => {
    for (const role of ["anon", "authenticated"]) {
      const t = await db.query("select has_table_privilege($1, 'public.navigator_report_cache', 'select') as s", [role]);
      expect(t.rows[0].s).toBe(false);
      const f = await db.query("select has_function_privilege($1, 'public.navigator_report_cache_forget(text,text)', 'execute') as e", [role]);
      expect(f.rows[0].e).toBe(false);
    }
  });

  it("forgets only the requesting owner's rows, by document or entirely", async () => {
    await insert(row("uid_d", KEY("1"), { document_fingerprint: KEY("9") }));
    await insert(row("uid_d", KEY("2")));
    await insert(row("uid_e", KEY("1"), { document_fingerprint: KEY("9") }));
    expect((await db.query("select public.navigator_report_cache_forget('uid_d', $1) as n", [KEY("9")])).rows[0].n).toBe(1);
    expect((await db.query("select public.navigator_report_cache_forget('uid_d') as n")).rows[0].n).toBe(1);
    expect((await db.query("select count(*)::int as n from public.navigator_report_cache where owner_uid = 'uid_e'")).rows[0].n).toBe(1);
  });

  it("purges expired and deleted index rows only", async () => {
    await insert(row("uid_f", KEY("5"), { completed_at: "2020-01-01T00:00:00Z", expires_at: "2020-01-30T00:00:00Z" }));
    await insert(row("uid_f", KEY("6"), { completed_at: "2099-01-01T00:00:00Z", expires_at: "2099-01-30T00:00:00Z", deleted_at: "2026-11-26T00:00:00Z" }));
    await insert(row("uid_f", KEY("7"), { completed_at: "2099-01-01T00:00:00Z", expires_at: "2099-01-30T00:00:00Z" }));
    await db.query("select public.navigator_report_cache_purge_expired()");
    const left = await db.query("select cache_key from public.navigator_report_cache where owner_uid = 'uid_f'");
    expect(left.rows.map((r) => r.cache_key)).toEqual([KEY("7")]);
  });

  it("rolls back cleanly and can be re-applied", async () => {
    await db.query(DOWN);
    expect((await db.query("select to_regclass('public.navigator_report_cache') as t")).rows[0].t).toBeNull();
    await db.query(UP);
  });
});
