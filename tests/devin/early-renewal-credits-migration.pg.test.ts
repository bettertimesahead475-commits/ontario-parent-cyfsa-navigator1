// Migration E: supabase/migrations_pending_approval/paid_sessions_early_renewal_keeps_credits.sql, its rollback and
// read-only preflight, on a disposable PostgreSQL. Runs only where CREDIT_PG_URL is set. Creates its own throwaway
// database (dropped afterwards) with a minimal access_codes / navigator_paid_sessions / free_usage schema, then P
// (20261110004740), D and paid_credit_reservation_functions.sql, as on the intended release order. No other database
// is touched; synthetic accounts only.
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { handleAdminRequest } from "../../functions/api/admin/[[path]]";

const url = process.env.CREDIT_PG_URL;
const here = path.dirname(fileURLToPath(import.meta.url));
const sql = (p: string) => readFileSync(path.resolve(here, "../../supabase", p), "utf8");
const P = sql("migrations/20261110004740_preserve_monthly_renewal.sql");
const D = sql("migrations_pending_approval/access_codes_one_redemption_per_reference.sql");
const CREDITS = sql("migrations_pending_approval/paid_credit_reservation_functions.sql");
const UP = sql("migrations_pending_approval/paid_sessions_early_renewal_keeps_credits.sql");
const DOWN = sql("migrations_pending_approval/paid_sessions_early_renewal_keeps_credits.rollback.sql");
const PREFLIGHT = sql("migrations_pending_approval/paid_sessions_early_renewal_keeps_credits.preflight.sql");
const SCHEMA = `
create table public.access_codes (id uuid primary key default gen_random_uuid(), tier text, code_hash text unique, email text,
  used_at timestamptz, expires_at timestamptz, reference_number text, amount numeric, created_at timestamptz not null default now());
create table public.navigator_paid_sessions (id uuid primary key default gen_random_uuid(), firebase_uid text not null, email text,
  tier text not null, issued_at timestamptz not null default now(), expires_at timestamptz not null, revoked_at timestamptz,
  revocation_reason text, access_code_id uuid references public.access_codes(id) on delete set null,
  constraint navigator_paid_sessions_access_code_id_key unique (access_code_id));
create table public.free_usage (uid text primary key, email text, analyses_used integer not null default 0,
  first_analysis_at timestamptz, last_analysis_at timestamptz);`;
const DAY = 86400000;
const PACK: Record<string, number> = { Basic: 3, AnalyzerBasic: 3, Premium: 5, AnalyzerPremium: 5, Pro: 5 };
const hash = (code: string) => createHash("sha256").update(code.trim().toUpperCase()).digest("hex");
type Rpc = { status: string; code?: string; session_id?: string; expires_at?: string; granted_credits?: number };

describe.skipIf(!url)("Migration E: an early one-off re-purchase keeps unused analyses", () => {
  const dbName = `mig_e_${process.pid}_${Date.now()}`;
  let admin: pg.Client; let db: pg.Client; let dbUrl: string;
  const clients: pg.Client[] = [];
  const connect = async () => { const c = new pg.Client({ connectionString: dbUrl }); await c.connect(); clients.push(c); return c; };
  let n = 0;
  const ref = () => `PS-E${String(++n).padStart(7, "0")}`;
  const issue = async (reference: string | null, email: string, tier = "Premium") => {
    const code = `MIGE-${String(++n).padStart(4, "0")}-${randomUUID().slice(0, 4).toUpperCase()}`;
    await db.query("insert into public.access_codes (tier, code_hash, email, reference_number, expires_at, amount) values ($1,$2,$3,$4,now() + interval '14 days',49.99)",
      [tier, hash(code), email, reference]);
    return code;
  };
  const redeem = async (c: pg.Client, uid: string, code: string, email: string): Promise<Rpc> =>
    (await c.query("select public.redeem_access_code_atomic($1,$2,$3) as r", [uid, code, email])).rows[0].r;
  // What /api/analyze does for a one-off pack: reserve against the tier default (LIMITS), then finalize.
  const analyse = async (session: string, tier: string) => {
    const req = `req-${randomUUID()}`;
    const r = (await db.query("select public.paid_reserve_credit($1,$2,'total',$3,now(),'15 minutes','60 seconds') as r", [session, req, PACK[tier]])).rows[0].r;
    if (r.status === "reserved") await db.query("select public.paid_finalize_credit($1,$2,now())", [session, req]);
    return r.status as string;
  };
  const analyseUntilLimit = async (session: string, tier: string) => {
    let ok = 0;
    while ((await analyse(session, tier)) === "reserved") if (++ok > 50) throw new Error("no limit");
    return ok;
  };
  const one = async (q: string, p: unknown[] = []) => (await db.query(q, p)).rows[0];
  const count = async (q: string, p: unknown[] = []) => Number((await one(q, p)).n);
  const fp = async (name: string) => (await one("select md5(prosrc) as m from pg_proc where proname = $1", [name]))?.m as string | undefined;
  const preflight = async () => {
    const res = (await db.query(PREFLIGHT)) as unknown as pg.QueryResult[];
    return res.find((r) => r.command === "SELECT")!.rows as Array<{ check_name: string; detail: string; ok: boolean; blocking: boolean }>;
  };
  let dFingerprint: string; let reserveFingerprint: string;

  beforeAll(async () => {
    admin = new pg.Client({ connectionString: url }); await admin.connect();
    await admin.query(`create database ${dbName}`);
    const u = new URL(url!); u.pathname = `/${dbName}`; dbUrl = u.toString();
    for (const role of ["anon", "authenticated", "service_role"]) {
      await admin.query(`do $$ begin if not exists (select 1 from pg_roles where rolname = '${role}') then create role ${role} nologin; end if; end $$;`);
    }
    db = new pg.Client({ connectionString: dbUrl }); await db.connect();
    await db.query(SCHEMA);
    await db.query(P); await db.query(D); await db.query(CREDITS);
    dFingerprint = (await fp("redeem_access_code_atomic"))!;
    reserveFingerprint = (await fp("paid_reserve_credit"))!;
  });
  afterAll(async () => {
    await Promise.all(clients.map((c) => c.end().catch(() => undefined)));
    await db?.end();
    await admin.query(`drop database if exists ${dbName} with (force)`);
    await admin.end();
  });

  it("baseline (P + D, before E): an early Premium re-purchase mints a second session and strands the first one's unused analyses", async () => {
    const email = "base@example.test";
    const first = await redeem(db, "uid-base", await issue(ref(), email), email);
    expect(await analyse(first.session_id!, "Premium")).toBe("reserved");
    expect(await analyse(first.session_id!, "Premium")).toBe("reserved");
    const second = await redeem(db, "uid-base", await issue(ref(), email), email);
    expect(second.status).toBe("activated");
    expect(second.session_id).not.toBe(first.session_id);
    expect(await count("select count(*) as n from public.navigator_paid_sessions where firebase_uid = 'uid-base'")).toBe(2);
  });

  it("preflight is read-only and its blocking checks pass on P + D + paid credit functions", async () => {
    expect(PREFLIGHT).toMatch(/begin transaction read only;/);
    expect(PREFLIGHT).toMatch(/\brollback;\s*$/);
    const rows = await preflight();
    expect(rows.filter((r) => r.blocking).every((r) => r.ok)).toBe(true);
    expect(rows.find((r) => r.check_name.startsWith("live redeem_access_code_atomic"))!.detail).toBe(dFingerprint);
    expect(rows.find((r) => r.check_name.startsWith("paid_reserve_credit equals"))!.detail).toBe(reserveFingerprint);
    expect(rows.find((r) => r.check_name.startsWith("accounts with two active sessions"))!.detail).toBe("1");
  });

  it("E refuses to apply without D, and changes nothing", async () => {
    await db.query("alter index public.access_codes_one_redemption_per_reference rename to e_test_hidden");
    await expect(db.query(UP)).rejects.toThrow(/Migration D .* must be applied first/);
    await db.query("rollback").catch(() => undefined);
    await db.query("alter index public.e_test_hidden rename to access_codes_one_redemption_per_reference");
    expect(await fp("redeem_access_code_atomic")).toBe(dFingerprint);
    expect(await count("select count(*) as n from information_schema.columns where table_name = 'navigator_paid_sessions' and column_name = 'granted_credits'")).toBe(0);
  });

  it("applies cleanly: existing sessions are untouched, the original reserve body is kept, only service_role can call", async () => {
    const before = (await db.query("select id, tier, expires_at, revoked_at from public.navigator_paid_sessions order by id")).rows;
    await db.query(UP);
    expect((await db.query("select id, tier, expires_at, revoked_at from public.navigator_paid_sessions order by id")).rows).toEqual(before);
    expect(await count("select count(*) as n from public.navigator_paid_sessions where granted_credits is not null")).toBe(0);
    expect(await fp("paid_reserve_credit_tier_default")).toBe(reserveFingerprint);
    for (const fn of ["redeem_access_code_atomic(text,text,text)", "paid_reserve_credit(text,text,text,integer,timestamptz,interval,interval)"]) {
      for (const role of ["anon", "authenticated"]) {
        expect((await one(`select has_function_privilege('${role}', 'public.${fn}', 'execute') as ok`)).ok).toBe(false);
      }
      expect((await one(`select has_function_privilege('service_role', 'public.${fn}', 'execute') as ok`)).ok).toBe(true);
    }
    await expect(db.query("update public.navigator_paid_sessions set granted_credits = 0")).rejects.toThrow(/granted_credits_positive/);
    await db.query(UP); // re-runnable
    expect(await fp("paid_reserve_credit_tier_default")).toBe(reserveFingerprint);
  });

  it("Premium: 2 of 5 used, a new verified payment extends the same session by 30 days and adds 5 (8 left, not 5)", async () => {
    const email = "prem@example.test";
    const first = await redeem(db, "uid-prem", await issue(ref(), email), email);
    expect(await analyse(first.session_id!, "Premium")).toBe("reserved");
    expect(await analyse(first.session_id!, "Premium")).toBe("reserved");
    const again = await redeem(db, "uid-prem", await issue(ref(), email), email);
    expect(again).toMatchObject({ status: "activated", session_id: first.session_id, granted_credits: 10 });
    expect(Date.parse(again.expires_at!) - Date.parse(first.expires_at!)).toBe(30 * DAY);
    expect(await analyseUntilLimit(first.session_id!, "Premium")).toBe(8);
    expect(await count("select count(*) as n from public.navigator_paid_sessions where firebase_uid = 'uid-prem'")).toBe(1);
  });

  it("Basic: a pack used up, then re-purchased, gives exactly 3 more; quick and forensic share one counter", async () => {
    const email = "basic@example.test";
    const first = await redeem(db, "uid-basic", await issue(ref(), email, "Basic"), email);
    expect(await analyseUntilLimit(first.session_id!, "Basic")).toBe(3);
    const again = await redeem(db, "uid-basic", await issue(ref(), email, "Basic"), email);
    expect(again).toMatchObject({ status: "activated", session_id: first.session_id, granted_credits: 6 });
    expect(await analyseUntilLimit(first.session_id!, "Basic")).toBe(3);
  });

  it("two new payments redeemed concurrently stack exactly once each (15 analyses, +60 days, one session)", async () => {
    const email = "conc@example.test";
    const first = await redeem(db, "uid-conc", await issue(ref(), email), email);
    const [c1, c2] = [await issue(ref(), email), await issue(ref(), email)];
    const holder = await connect(); const other = await connect();
    await holder.query("begin");
    const r1 = await redeem(holder, "uid-conc", c1, email);
    const pending = redeem(other, "uid-conc", c2, email);
    await new Promise((r) => setTimeout(r, 300));
    const waiting = await count("select count(*) as n from pg_locks where not granted");
    await holder.query("commit");
    const r2 = await pending;
    expect(waiting).toBeGreaterThan(0);
    expect([r1.session_id, r2.session_id]).toEqual([first.session_id, first.session_id]);
    const s = await one("select granted_credits, expires_at from public.navigator_paid_sessions where id = $1", [first.session_id]);
    expect(s.granted_credits).toBe(15);
    expect(new Date(s.expires_at).getTime() - Date.parse(first.expires_at!)).toBe(60 * DAY);
  });

  it("D still holds: a second code of the same payment adds nothing; a repeated code adds nothing", async () => {
    const email = "dup@example.test";
    const reference = ref();
    const first = await redeem(db, "uid-dup", await issue(reference, email), email);
    const code = await issue(ref(), email);
    expect((await redeem(db, "uid-dup", code, email)).granted_credits).toBe(10);
    expect(await redeem(db, "uid-dup", code, email)).toMatchObject({ status: "reused", session_id: first.session_id });
    expect(await redeem(db, "uid-dup", await issue(reference, email), email)).toMatchObject({ status: "reused", session_id: first.session_id });
    expect((await one("select granted_credits from public.navigator_paid_sessions where id = $1", [first.session_id])).granted_credits).toBe(10);
  });

  it("an expired or revoked pack, or a different tier, gets a new session with the tier default (no top-up)", async () => {
    const email = "edge@example.test";
    const old = await redeem(db, "uid-edge", await issue(ref(), email), email);
    await db.query("update public.navigator_paid_sessions set expires_at = now() - interval '1 second' where id = $1", [old.session_id]);
    const fresh = await redeem(db, "uid-edge", await issue(ref(), email), email);
    expect(fresh.session_id).not.toBe(old.session_id);
    await db.query("update public.navigator_paid_sessions set revoked_at = now() where id = $1", [fresh.session_id]);
    const third = await redeem(db, "uid-edge", await issue(ref(), email), email);
    expect(third.session_id).not.toBe(fresh.session_id);
    const basic = await redeem(db, "uid-edge", await issue(ref(), email, "Basic"), email);
    expect(basic.session_id).not.toBe(third.session_id);
    expect(await count("select count(*) as n from public.navigator_paid_sessions where firebase_uid = 'uid-edge' and granted_credits is not null")).toBe(0);
    expect(await analyseUntilLimit(third.session_id!, "Premium")).toBe(5);
  });

  it("monthly renewals are unchanged: same session, +30 days, no granted_credits", async () => {
    const email = "pro@example.test";
    const first = await redeem(db, "uid-pro", await issue(ref(), email, "Pro"), email);
    const renewal = await redeem(db, "uid-pro", await issue(ref(), email, "Pro"), email);
    expect(renewal).toMatchObject({ status: "activated", session_id: first.session_id });
    expect(renewal.granted_credits).toBeUndefined();
    expect(Date.parse(renewal.expires_at!) - Date.parse(first.expires_at!)).toBe(30 * DAY);
    expect((await one("select granted_credits from public.navigator_paid_sessions where id = $1", [first.session_id])).granted_credits).toBeNull();
  });

  it("the reserve wrapper never lowers an allowance and leaves non-total scopes alone", async () => {
    const email = "wrap@example.test";
    const s = await redeem(db, "uid-wrap", await issue(ref(), email), email);
    await db.query("update public.navigator_paid_sessions set granted_credits = 2 where id = $1", [s.session_id]);
    expect(await analyseUntilLimit(s.session_id!, "Premium")).toBe(5);
    await db.query("update public.navigator_paid_sessions set granted_credits = 50 where id = $1", [s.session_id]);
    const period = (await one("select public.paid_reserve_credit($1,'p-1','period:2026-11-01',1,now(),'15 minutes','60 seconds') as r", [s.session_id])).r;
    const period2 = (await one("select public.paid_reserve_credit($1,'p-2','period:2026-11-01',1,now(),'15 minutes','60 seconds') as r", [s.session_id])).r;
    expect([period.status, period2.status]).toEqual(["reserved", "limit"]);
    await db.query("update public.navigator_paid_sessions set granted_credits = null where id = $1", [s.session_id]);
  });

  it("rollback counts suspended top-ups and waits for an in-flight top-up before checking", async () => {
    const email = "rb@example.test";
    const first = await redeem(db, "uid-rb-susp", await issue(ref(), email), email);
    await redeem(db, "uid-rb-susp", await issue(ref(), email), email);
    await db.query("update public.navigator_paid_sessions set revoked_at = now() where id = $1", [first.session_id]);
    const refused = (c: pg.Client) => c.query(DOWN).then(() => -1, async (e: Error) => {
      await c.query("rollback").catch(() => undefined);
      return Number(/rollback: (\d+) unexpired session/.exec(e.message)?.[1] ?? -2);
    });
    const unexpired = () => count("select count(*) as n from public.navigator_paid_sessions where granted_credits is not null and expires_at > now()");
    const before = await unexpired();
    expect(before).toBeGreaterThan(await count("select count(*) as n from public.navigator_paid_sessions where granted_credits is not null and revoked_at is null and expires_at > now()"));
    expect(await refused(db)).toBe(before);

    const second = await redeem(db, "uid-rb-race", await issue(ref(), email), email);
    const holder = await connect(); const roller = await connect();
    await holder.query("begin");
    expect((await redeem(holder, "uid-rb-race", await issue(ref(), email), email)).session_id).toBe(second.session_id);
    const pending = refused(roller);
    await new Promise((r) => setTimeout(r, 300));
    const waiting = await count("select count(*) as n from pg_locks where not granted");
    await holder.query("commit");
    expect(waiting).toBeGreaterThan(0);
    expect(await pending).toBe(before + 1);
    expect(await count("select count(*) as n from information_schema.columns where table_name = 'navigator_paid_sessions' and column_name = 'granted_credits'")).toBe(1);
  });

  it("rollback refuses while a customer holds added analyses; with the owner's override it restores D and the original reserve exactly", async () => {
    await expect(db.query(DOWN)).rejects.toThrow(/unexpired session\(s\) \(active or suspended\) hold credits from an early re-purchase/);
    await db.query("rollback").catch(() => undefined);
    expect(await fp("paid_reserve_credit_tier_default")).toBe(reserveFingerprint);
    expect(await count("select count(*) as n from public.navigator_paid_sessions where granted_credits is not null")).toBeGreaterThan(0);
    await db.query("set navigator.allow_credit_reduction = 'on'");
    await db.query(DOWN);
    await db.query("reset navigator.allow_credit_reduction");
    expect(await fp("redeem_access_code_atomic")).toBe(dFingerprint);
    expect(await fp("paid_reserve_credit")).toBe(reserveFingerprint);
    expect(await fp("paid_reserve_credit_tier_default")).toBeUndefined();
    expect(await count("select count(*) as n from information_schema.columns where table_name = 'navigator_paid_sessions' and column_name = 'granted_credits'")).toBe(0);
    expect((await one("select has_function_privilege('service_role', 'public.paid_reserve_credit(text,text,text,integer,timestamptz,interval,interval)', 'execute') as ok")).ok).toBe(true);
    await db.query(UP);
    expect(await fp("paid_reserve_credit_tier_default")).toBe(reserveFingerprint);
  });
  it("rollback waits for a redemption that holds a session row lock instead of deadlocking with it", async () => {
    const email = "rbdl@example.test";
    const s = await redeem(db, "uid-rb-dl", await issue(ref(), email), email);
    const holder = await connect(); const roller = await connect();
    await holder.query("begin");
    await holder.query("select id from public.navigator_paid_sessions where id = $1 for update", [s.session_id]);
    await roller.query("set navigator.allow_credit_reduction = 'on'");
    const pending = roller.query(DOWN);
    await new Promise((r) => setTimeout(r, 300));
    expect(await count("select count(*) as n from pg_locks where not granted")).toBeGreaterThan(0);
    await holder.query("update public.navigator_paid_sessions set expires_at = expires_at + interval '30 days' where id = $1", [s.session_id]);
    await holder.query("commit");
    await pending;
    expect(await count("select count(*) as n from information_schema.columns where table_name = 'navigator_paid_sessions' and column_name = 'granted_credits'")).toBe(0);
    expect(await fp("redeem_access_code_atomic")).toBe(dFingerprint);
    await db.query(UP);
  });
  // The admin refund (functions/api/admin/[[path]].ts) against this database through a minimal PostgREST
  // (select / eq / is.null / not.is.null / or=(a.eq.x,...) / limit, PATCH returning rows); payments and storage in memory.
  // holdSessionPatches = n: the first n session PATCHes wait until all n have been sent, so n refunds race on one row.
  const adminHarness = (payments: Record<string, { plan: string; email: string; uid: string }>, holdSessionPatches = 0) => {
    const storage = new Map<string, string>();
    let held: Array<() => void> = [];
    const where = (u: URL) => {
      const w: string[] = []; const params: unknown[] = [];
      const cond = (col: string, expr: string) => {
        if (!/^[a-z_]+$/.test(col)) throw new Error(`bad column ${col}`);
        if (expr === "is.null") return `${col} is null`;
        if (expr === "not.is.null") return `${col} is not null`;
        if (!expr.startsWith("eq.")) throw new Error(`bad filter ${expr}`);
        params.push(expr.slice(3)); return `${col} = $${params.length}`;
      };
      for (const [k, v] of u.searchParams) {
        if (["select", "order", "limit", "offset"].includes(k)) continue;
        if (k === "or") w.push("(" + v.slice(1, -1).split(",").map((part) => { const [c, ...r] = part.split("."); return cond(c, r.join(".")); }).join(" or ") + ")");
        else w.push(cond(k, v));
      }
      return { sql: w.length ? ` where ${w.join(" and ")}` : "", params, limit: u.searchParams.get("limit") };
    };
    const fetcher = async (input: string | URL | Request, init: RequestInit = {}) => {
      const u = new URL(String(input)); const method = (init.method ?? "GET").toUpperCase();
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      if (u.pathname.startsWith("/storage/v1/object/list/")) {
        const prefix = `${body.prefix}/`;
        return Response.json([...storage.keys()].filter((k) => k.startsWith(prefix)).map((k) => ({ name: k.slice(prefix.length) })).slice(Number(body.offset || 0), Number(body.offset || 0) + Number(body.limit || 100)));
      }
      if (u.pathname.startsWith("/storage/v1/object/")) {
        const key = decodeURIComponent(u.pathname.split("/analysis_jobs/")[1]);
        if (storage.has(key)) return Response.json({ statusCode: "409" }, { status: 400 });
        storage.set(key, String(init.body)); return Response.json({ Key: key });
      }
      const table = u.pathname.replace("/rest/v1/", "");
      if (table === "rpc/paid_refund_one_off_pack" && method === "POST") {
        return Response.json((await db.query("select public.paid_refund_one_off_pack(p_session => $1, p_refund_key => $2, p_days => $3) as r", [body.p_session, body.p_refund_key, body.p_days])).rows[0].r);
      }
      if (table === "payments") {
        const r = u.searchParams.get("reference_number")?.slice(3) ?? ""; const p = payments[r];
        return Response.json(p ? [{ id: randomUUID(), reference_number: r, plan: p.plan, amount: 49.99, status: "approved", notes: `email:${p.email};uid:${p.uid}` }] : []);
      }
      if (table !== "access_codes" && table !== "navigator_paid_sessions") return new Response("unexpected", { status: 500 });
      const w = where(u);
      // row_to_json: timestamps come back as PostgREST sends them (ISO 8601, microseconds), so eq filters on them round-trip.
      if (method === "GET") return Response.json((await db.query(`select row_to_json(t) as r from (select * from public.${table}${w.sql}${w.limit ? ` limit ${Number(w.limit)}` : ""}) t`, w.params)).rows.map((x) => x.r));
      if (method === "PATCH") {
        if (table === "navigator_paid_sessions" && holdSessionPatches > 0) {
          holdSessionPatches--;
          await new Promise<void>((release) => { held.push(release); if (holdSessionPatches === 0) { held.forEach((h) => h()); held = []; } });
        }
        const sets = Object.keys(body).map((k, i) => `${k} = $${w.params.length + i + 1}`);
        return Response.json((await db.query(`with t as (update public.${table} set ${sets.join(", ")}${w.sql} returning *) select row_to_json(t) as r from t`, [...w.params, ...Object.values(body)])).rows.map((x) => x.r));
      }
      return new Response("unexpected", { status: 500 });
    };
    const env = { FIREBASE_PROJECT_ID: "p", STAGING_SUPABASE_URL: "https://db.test", STAGING_SUPABASE_SERVICE_ROLE_KEY: "k" };
    return Object.assign(async (referenceNumber: string) => (await handleAdminRequest(new Request("https://cyfsanavigator.com/api/admin/payments/refund", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ referenceNumber, reason: "Customer request" }) }),
      env as never, { requireAdmin: (async () => ({ admin: { uid: "admin-uid", email: "ops@example.test" } })) as never, fetcher: fetcher as never })).json() as Promise<Record<string, unknown>>, { storage });
  };
  const refundPack = async (c: pg.Client, session: string, key: string) =>
    (await c.query("select public.paid_refund_one_off_pack($1, $2, 30) as r", [session, key])).rows[0].r as Record<string, unknown>;
  const reserveOnly = async (session: string) =>
    (await db.query("select public.paid_reserve_credit($1,$2,'total',5,now(),'15 minutes','60 seconds') as r", [session, `req-${randomUUID()}`])).rows[0].r.status as string;

  it("admin refund of the top-up takes back its 5 analyses and 30 days: 2 of 5 used + top-up = 8 left, refunded = 3 left", async () => {
    const email = "refund@example.test"; const uid = "uid-refund"; const topRef = ref();
    const refund = adminHarness({ [topRef]: { plan: "Premium", email, uid } });

    const first = await redeem(db, uid, await issue(ref(), email), email);
    expect(await analyse(first.session_id!, "Premium")).toBe("reserved");
    expect(await analyse(first.session_id!, "Premium")).toBe("reserved");
    const top = await redeem(db, uid, await issue(topRef, email), email);
    expect(top).toMatchObject({ session_id: first.session_id, granted_credits: 10 });

    expect(await refund(topRef)).toMatchObject({ success: true, sessionsShortened: 1, sessionsRevoked: 0 });
    const s = await one("select expires_at, granted_credits, revoked_at from public.navigator_paid_sessions where id = $1", [first.session_id]);
    expect(s).toMatchObject({ granted_credits: null, revoked_at: null });
    expect(new Date(s.expires_at).toISOString()).toBe(new Date(first.expires_at!).toISOString());
    expect(await analyseUntilLimit(first.session_id!, "Premium")).toBe(3);
  });

  it("two top-ups refunded at the same moment both take back their analyses and days (15 -> 5, -60 days)", async () => {
    const email = "race@example.test"; const uid = "uid-race"; const topA = ref(); const topB = ref();
    const refund = adminHarness({ [topA]: { plan: "Premium", email, uid }, [topB]: { plan: "Premium", email, uid } }, 2);
    const first = await redeem(db, uid, await issue(ref(), email), email);
    await redeem(db, uid, await issue(topA, email), email);
    const both = await redeem(db, uid, await issue(topB, email), email);
    expect(both).toMatchObject({ session_id: first.session_id, granted_credits: 15 });

    // Both refunds read the same row before either writes; the one whose write misses re-reads and applies its own.
    const results = await Promise.all([refund(topA), refund(topB)]);
    for (const r of results) expect(r).toMatchObject({ success: true, sessionsShortened: 1, shorteningsForReview: 0 });
    const s = await one("select expires_at, granted_credits from public.navigator_paid_sessions where id = $1", [first.session_id]);
    expect(s.granted_credits).toBeNull();
    expect(new Date(s.expires_at).toISOString()).toBe(new Date(Date.parse(String(both.expires_at)) - 60 * DAY).toISOString());
    expect(await analyseUntilLimit(first.session_id!, "Premium")).toBe(5);
  });

  it("analyses already used: 7 of 10 used, top-up refunded -> tier default, 0 left, 2 reported as used from the refunded pack", async () => {
    const email = "used@example.test"; const uid = "uid-used"; const topRef = ref();
    const refund = adminHarness({ [topRef]: { plan: "Premium", email, uid } });
    const first = await redeem(db, uid, await issue(ref(), email), email);
    await redeem(db, uid, await issue(topRef, email), email);
    for (let i = 0; i < 7; i++) expect(await analyse(first.session_id!, "Premium")).toBe("reserved");
    expect(await refund(topRef)).toMatchObject({ success: true, sessionsShortened: 1, shorteningsForReview: 0, packAnalysesAlreadyUsed: 2 });
    expect((await one("select granted_credits from public.navigator_paid_sessions where id = $1", [first.session_id])).granted_credits).toBeNull();
    expect(await analyseUntilLimit(first.session_id!, "Premium")).toBe(0);
    // Used analyses are history, not rewritten: the counter still says 7.
    expect(await count("select analyses_used as n from public.free_usage where uid = $1", [`paid_session_${first.session_id}_total`])).toBe(7);
  });

  it("analyses reserved but not finished count as used, and the record says so; finishing one later never goes past the new limit", async () => {
    const email = "reserved@example.test"; const uid = "uid-reserved"; const topRef = ref();
    const first = await redeem(db, uid, await issue(ref(), email), email);
    const top = await redeem(db, uid, await issue(topRef, email), email);
    for (let i = 0; i < 4; i++) expect(await analyse(first.session_id!, "Premium")).toBe("reserved");
    expect(await reserveOnly(first.session_id!)).toBe("reserved");
    expect(await reserveOnly(first.session_id!)).toBe("reserved");
    const r = await refundPack(db, first.session_id!, `${topRef}:k`);
    expect(r).toMatchObject({ status: "applied", granted_before: 10, granted_after: 5, used: 6, reserved: 2, used_beyond_remaining: 1 });
    expect(await reserveOnly(first.session_id!)).toBe("limit");
    expect(new Date((await one("select expires_at from public.navigator_paid_sessions where id = $1", [first.session_id])).expires_at).toISOString())
      .toBe(new Date(Date.parse(String(top.expires_at)) - 30 * DAY).toISOString());
  });

  it("retries are one deduction: the same refund key twice, and an admin refund resumed after its completion record was lost", async () => {
    const email = "retry@example.test"; const uid = "uid-retry"; const topA = ref(); const topB = ref();
    const refund = adminHarness({ [topA]: { plan: "Premium", email, uid } });
    const first = await redeem(db, uid, await issue(ref(), email), email);
    await redeem(db, uid, await issue(topA, email), email);
    await redeem(db, uid, await issue(topB, email), email);
    expect(await refund(topA)).toMatchObject({ success: true, sessionsShortened: 1 });
    const after = await one("select granted_credits, expires_at from public.navigator_paid_sessions where id = $1", [first.session_id]);
    expect(after.granted_credits).toBe(10);
    for (const key of [...refund.storage.keys()]) if (key.startsWith("admin-audit/")) refund.storage.delete(key);
    expect(await refund(topA)).toMatchObject({ success: true, sessionsShortened: 1, shorteningsForReview: 0 });
    const again = await one("select granted_credits, expires_at from public.navigator_paid_sessions where id = $1", [first.session_id]);
    expect(again).toEqual(after);
    expect(await refundPack(db, first.session_id!, "direct-key")).toMatchObject({ status: "applied", granted_after: 5 });
    expect(await refundPack(db, first.session_id!, "direct-key")).toMatchObject({ status: "already_applied", granted_after: 5 });
    expect((await one("select granted_credits from public.navigator_paid_sessions where id = $1", [first.session_id])).granted_credits).toBeNull();
  });

  it("other entitlements are untouched: never below the tier default, another session of the same customer unchanged, monthly refused", async () => {
    const email = "other@example.test"; const uid = "uid-other";
    const premium = await redeem(db, uid, await issue(ref(), email), email);
    const basic = await redeem(db, uid, await issue(ref(), email, "Basic"), email);
    await redeem(db, uid, await issue(ref(), email, "Basic"), email);
    const before = await one("select granted_credits, expires_at from public.navigator_paid_sessions where id = $1", [basic.session_id]);
    const base = await one("select granted_credits, expires_at from public.navigator_paid_sessions where id = $1", [premium.session_id]);
    expect(await refundPack(db, premium.session_id!, "no-top-up")).toMatchObject({ status: "no_top_up", granted: 5 });
    expect(await one("select granted_credits, expires_at from public.navigator_paid_sessions where id = $1", [premium.session_id])).toEqual(base);
    expect(await one("select granted_credits, expires_at from public.navigator_paid_sessions where id = $1", [basic.session_id])).toEqual(before);
    const monthly = await redeem(db, "uid-monthly", await issue(ref(), "m@example.test", "Pro"), "m@example.test");
    expect(await refundPack(db, monthly.session_id!, "monthly")).toMatchObject({ status: "not_one_off" });
    expect(await count("select count(*) as n from public.navigator_paid_session_refunds where refund_key in ('no-top-up','monthly')")).toBe(0);
  });

  it("concurrency on separate connections: two refunds give 15 -> 5; a reservation waits for the refund and sees the new limit", async () => {
    const email = "concrefund@example.test"; const uid = "uid-concrefund";
    const first = await redeem(db, uid, await issue(ref(), email), email);
    await redeem(db, uid, await issue(ref(), email), email);
    expect(await redeem(db, uid, await issue(ref(), email), email)).toMatchObject({ session_id: first.session_id, granted_credits: 15 });
    const [a, b] = [await connect(), await connect()];
    const rs = await Promise.all([refundPack(a, first.session_id!, "conc-a"), refundPack(b, first.session_id!, "conc-b")]);
    expect(rs.map((r) => r.status)).toEqual(["applied", "applied"]);
    expect((await one("select granted_credits from public.navigator_paid_sessions where id = $1", [first.session_id])).granted_credits).toBeNull();

    const second = await redeem(db, "uid-concrefund2", await issue(ref(), "cr2@example.test"), "cr2@example.test");
    await redeem(db, "uid-concrefund2", await issue(ref(), "cr2@example.test"), "cr2@example.test");
    for (let i = 0; i < 5; i++) expect(await analyse(second.session_id!, "Premium")).toBe("reserved");
    await a.query("begin");
    await refundPack(a, second.session_id!, "conc-hold");
    const pending = b.query("select public.paid_reserve_credit($1,'req-wait','total',5,now(),'15 minutes','60 seconds') as r", [second.session_id]);
    await new Promise((r) => setTimeout(r, 300));
    expect(await count("select count(*) as n from pg_stat_activity where wait_event_type = 'Lock' and datname = current_database()")).toBeGreaterThan(0);
    await a.query("commit");
    expect((await pending).rows[0].r.status).toBe("limit");
  });
});
