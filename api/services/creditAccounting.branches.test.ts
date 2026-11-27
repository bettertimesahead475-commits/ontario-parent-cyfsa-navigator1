// Paid-credit branches: unknown tiers, revoked/suspended balances, database failures that must fail closed, finalize
// outcomes that must withhold a result, and administrative changes that must not be reported when nothing changed.
import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import {
  finalizeAnalysisCredit, getCreditBalance, getPackageAllowance, markerKey, reserveAnalysisCredit, restoreSession, suspendSession,
} from "./creditAccounting.js";
import { createProductionLikeDb } from "../testSupport/productionLikeCreditDb.js";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

const currentDb: { ref: any } = vi.hoisted(() => ({ ref: null }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => currentDb.ref.from(table),
    rpc: (name: string, args: any) => currentDb.ref.rpc(name, args),
  }),
}));

/** A query builder whose every call chains and which resolves to `result`. */
const chain = (result: any): any => new Proxy({}, {
  get: (_t, prop) => prop === "then" ? (resolve: any, reject: any) => Promise.resolve(result).then(resolve, reject) : () => chain(result),
});
/** The production-like database with selected tables or RPCs replaced. */
const withOverrides = (tables: Record<string, any> = {}, rpc?: (name: string, args: any) => any, base = createProductionLikeDb()) => ({
  from: (t: string) => (t in tables ? tables[t] : base.from(t)),
  rpc: rpc ?? ((n: string, a: any) => base.rpc(n, a)),
});
const reserve = (tier = "Basic", requestId = "req_branch_1") =>
  reserveAnalysisCredit({ sessionId: "session_branch", firebaseUid: "u1", tier, requestId, analysisType: "quick" });

afterEach(() => vi.restoreAllMocks());

describe("credit accounting branches", () => {
  it("an unknown tier gets the smallest allowance and never Forensic", () => {
    expect(getPackageAllowance("Enterprise-typo")).toEqual({ tier: "Enterprise-typo", totalLimit: 3, allowsForensic: false, isMonthly: false });
  });

  it("markerKey uses the same derivation as paid_marker_uid() in the reservation SQL", () => {
    const sql = readFileSync(new URL("../../supabase/migrations_pending_approval/paid_credit_reservation_functions.sql", import.meta.url), "utf8");
    expect(sql).toContain("select 'paid_res_' || p_session || '_' || substr(encode(sha256(convert_to(p_request, 'UTF8')), 'hex'), 1, 32)");
    const expected = `paid_res_s1_${createHash("sha256").update("req_é_1", "utf8").digest("hex").slice(0, 32)}`;
    expect(markerKey("s1", "req_é_1")).toBe(expected);
  });

  it("a revoked or suspended session shows zero credits and suspended", async () => {
    const revoked = createProductionLikeDb();
    currentDb.ref = withOverrides({ navigator_paid_sessions: chain({ data: { id: "session_branch", revoked_at: "2026-11-01T00:00:00Z" }, error: null }) }, undefined, revoked);
    expect(await getCreditBalance("session_branch", "Premium")).toMatchObject({ creditsRemaining: 0, isSuspended: true, suspendedReason: "Session revoked" });

    currentDb.ref = createProductionLikeDb();
    await suspendSession({ sessionId: "session_branch", reason: "Chargeback received" });
    expect(await getCreditBalance("session_branch", "Premium")).toMatchObject({ creditsRemaining: 0, isSuspended: true, suspendedReason: "Chargeback received" });
  });

  it("a session read error, an RPC transport failure or an unknown RPC status fails closed with 503", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    currentDb.ref = withOverrides({ navigator_paid_sessions: chain({ data: null, error: { code: "08006", message: "connection failure" } }) });
    await expect(reserve()).rejects.toMatchObject({ statusCode: 503, code: "USAGE_SERVICE_TEMPORARILY_UNAVAILABLE" });

    currentDb.ref = withOverrides({}, () => { throw new TypeError("fetch failed"); });
    await expect(reserve()).rejects.toMatchObject({ statusCode: 503, code: "USAGE_SERVICE_TEMPORARILY_UNAVAILABLE" });

    currentDb.ref = withOverrides({}, async () => ({ data: { status: "granted_twice", reservation_id: "r" }, error: null }));
    await expect(reserve()).rejects.toMatchObject({ statusCode: 503, code: "USAGE_SERVICE_TEMPORARILY_UNAVAILABLE" });
  });

  it("finalize withholds the result when the reservation is missing or was released", async () => {
    const finalize = () => finalizeAnalysisCredit({ sessionId: "session_branch", firebaseUid: "u1", requestId: "req_branch_1", tier: "Basic" });
    currentDb.ref = withOverrides({}, async () => ({ data: { status: "missing" }, error: null }));
    await expect(finalize()).rejects.toMatchObject({ statusCode: 409, code: "RESERVATION_MISSING" });
    currentDb.ref = withOverrides({}, async () => ({ data: { status: "released" }, error: null }));
    await expect(finalize()).rejects.toMatchObject({ statusCode: 409, code: "RESERVATION_RELEASED" });
  });

  it("a recorded charge stands when the balance read for the response fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    currentDb.ref = withOverrides({ navigator_paid_sessions: chain({ data: null, error: { code: "08006", message: "connection failure" } }) }, async () => ({ data: { status: "consumed" }, error: null }));
    expect(await finalizeAnalysisCredit({ sessionId: "session_branch", firebaseUid: "u1", requestId: "req_branch_1", tier: "Basic" })).toBeNull();
  });

  it("suspend and restore refuse to report a change when the database is not configured", async () => {
    const saved = { ...process.env };
    for (const k of Object.keys(process.env)) if (/SUPABASE/.test(k)) delete process.env[k];
    try {
      vi.resetModules();
      const fresh = await import("./creditAccounting.js");
      await expect(fresh.suspendSession({ sessionId: "session_branch", reason: "x" })).rejects.toMatchObject({ statusCode: 503 });
      await expect(fresh.restoreSession("session_branch")).rejects.toMatchObject({ statusCode: 503 });
    } finally {
      process.env = saved;
    }
  });

  it("suspend reports failure when neither the session column nor the suspension marker could be written", async () => {
    currentDb.ref = createProductionLikeDb({ failWrites: true } as any);
    await expect(suspendSession({ sessionId: "session_branch", reason: "Chargeback received" })).rejects.toMatchObject({ statusCode: 503 });
  });

  it("restore reports failure when the suspension marker could not be removed, and the session stays suspended", async () => {
    const db = createProductionLikeDb();
    currentDb.ref = db;
    await suspendSession({ sessionId: "session_branch", reason: "Chargeback received" });
    currentDb.ref = withOverrides({ free_usage: { ...db.from("free_usage"), delete: () => chain({ data: null, error: { code: "08006", message: "connection failure" } }) } }, undefined, db);
    await expect(restoreSession("session_branch")).rejects.toMatchObject({ statusCode: 503 });
    currentDb.ref = db;
    await expect(reserve()).rejects.toMatchObject({ statusCode: 403, code: "ACCOUNT_SUSPENDED" });
  });
  it("restore removes a leftover suspension marker even when the column update succeeds", async () => {
    const db = createProductionLikeDb();
    currentDb.ref = db;
    await suspendSession({ sessionId: "session_branch", reason: "Chargeback received" });
    const sessions = db.from("navigator_paid_sessions");
    currentDb.ref = withOverrides({ navigator_paid_sessions: { ...sessions, update: () => chain({ data: null, error: null }) } }, undefined, db);
    await restoreSession("session_branch");
    currentDb.ref = db;
    expect(await getCreditBalance("session_branch", "Premium")).toMatchObject({ isSuspended: false });
  });

  it("restore of a revoked session fails with 409 instead of reporting success", async () => {
    const db = createProductionLikeDb();
    currentDb.ref = withOverrides({ navigator_paid_sessions: chain({ data: { id: "session_branch", revoked_at: "2026-11-01T00:00:00Z" }, error: null }) }, undefined, db);
    await expect(restoreSession("session_branch")).rejects.toMatchObject({ statusCode: 409 });
  });

  it("restore fails with 503 when the marker is still present afterwards", async () => {
    const db = createProductionLikeDb();
    currentDb.ref = db;
    await suspendSession({ sessionId: "session_branch", reason: "Chargeback received" });
    currentDb.ref = withOverrides({ free_usage: { ...db.from("free_usage"), delete: () => chain({ data: null, error: null }) } }, undefined, db);
    await expect(restoreSession("session_branch")).rejects.toMatchObject({ statusCode: 503 });
    currentDb.ref = db;
    await expect(reserve()).rejects.toMatchObject({ statusCode: 403, code: "ACCOUNT_SUSPENDED" });
  });
  it("restore fails with 503 when the session column update fails with a database error, and the session stays suspended", async () => {
    const db = createProductionLikeDb();
    currentDb.ref = db;
    await suspendSession({ sessionId: "session_branch", reason: "Chargeback received" });
    const sessions = db.from("navigator_paid_sessions");
    currentDb.ref = withOverrides({ navigator_paid_sessions: { ...sessions, update: () => chain({ data: null, error: { code: "08006", message: "connection failure" } }) } }, undefined, db);
    await expect(restoreSession("session_branch")).rejects.toMatchObject({ statusCode: 503 });
    currentDb.ref = db;
    await expect(reserve()).rejects.toMatchObject({ statusCode: 403, code: "ACCOUNT_SUSPENDED" });
  });

  it("restore succeeds when PostgREST reports the missing legacy column as PGRST204", async () => {
    const db = createProductionLikeDb();
    currentDb.ref = db;
    await suspendSession({ sessionId: "session_branch", reason: "Chargeback received" });
    const sessions = db.from("navigator_paid_sessions");
    currentDb.ref = withOverrides({ navigator_paid_sessions: { ...sessions, update: () => chain({ data: null, error: { code: "PGRST204", message: "Could not find the 'is_suspended' column of 'navigator_paid_sessions' in the schema cache" } }) } }, undefined, db);
    await restoreSession("session_branch");
    currentDb.ref = db;
    expect(await getCreditBalance("session_branch", "Premium")).toMatchObject({ isSuspended: false });
  });

  it("restore succeeds on the legacy schema, where the column is missing (42703) and the marker holds the suspension", async () => {
    const db = createProductionLikeDb();
    currentDb.ref = db;
    await suspendSession({ sessionId: "session_branch", reason: "Chargeback received" });
    expect(await getCreditBalance("session_branch", "Premium")).toMatchObject({ isSuspended: true });
    await restoreSession("session_branch");
    expect(await getCreditBalance("session_branch", "Premium")).toMatchObject({ isSuspended: false });
  });
});
