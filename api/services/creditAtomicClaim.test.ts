// Regression tests for credit claims under concurrency, retries, failures and multiple server instances.
//
// Each "instance" below is a fresh copy of the module (vi.resetModules), so it has its own memory,
// exactly like two serverless instances. They share one fake database that behaves like production's
// free_usage table: a primary key on uid, and row-level writes that are atomic.

import { createHash } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createProductionLikeDb } from "../testSupport/productionLikeCreditDb.js";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.SESSION_SECRET = "test-session-secret";

const currentDb: { ref: any } = vi.hoisted(() => ({ ref: null }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => currentDb.ref.from(table),
  }),
}));

type CreditModule = typeof import("./creditAccounting.js");
type UsageModule = typeof import("./usage.js");

const SESSION = "11111111-1111-4111-8111-111111111111";
const COUNTER = `paid_session_${SESSION}_total`;

async function loadCredit(): Promise<CreditModule> {
  vi.resetModules();
  return await import("./creditAccounting.js");
}

async function loadUsage(): Promise<UsageModule> {
  vi.resetModules();
  return await import("./usage.js");
}

function markerFor(sessionId: string, requestId: string): string {
  const digest = createHash("sha256").update(requestId).digest("hex").slice(0, 32);
  return `paid_res_${sessionId}_${digest}`;
}

function counter(): number | undefined {
  return currentDb.ref._freeUsage.get(COUNTER)?.analyses_used;
}

function reserveWith(credit: CreditModule, requestId: string, sessionId = SESSION, tier = "Basic") {
  return credit.reserveAnalysisCredit({
    sessionId,
    firebaseUid: "uid-owner",
    tier,
    requestId,
    analysisType: "quick",
    documentName: "affidavit.pdf",
  });
}

function finalizeWith(credit: CreditModule, requestId: string, sessionId = SESSION, tier = "Basic") {
  return credit.finalizeAnalysisCredit({ sessionId, firebaseUid: "uid-owner", requestId, tier });
}

describe("Credit claims are atomic across instances", () => {
  beforeEach(() => {
    currentDb.ref = createProductionLikeDb({ usage: { [COUNTER]: 2 } });
  });

  it("with one credit left, two instances reserving different requests: exactly one is reserved", async () => {
    const [a, b] = [await loadCredit(), await loadCredit()];
    const results = await Promise.allSettled([reserveWith(a, "req_a"), reserveWith(b, "req_b")]);
    const outcomes = results.map((r) => (r.status === "fulfilled" ? "reserved" : (r.reason as any).code));
    expect(outcomes.sort()).toEqual(["ANALYSIS_LIMIT_REACHED", "reserved"]);
    expect(counter()).toBe(3);
  });

  it("twenty simultaneous requests across five instances with five credits left: exactly five reserved, counter exact", async () => {
    currentDb.ref = createProductionLikeDb({ usage: { [COUNTER]: 0 } });
    const instances = await Promise.all(Array.from({ length: 5 }, () => loadCredit()));
    const results = await Promise.allSettled(
      Array.from({ length: 20 }, (_, i) => reserveWith(instances[i % 5], `burst_${i}`, SESSION, "Premium"))
    );
    const reserved = results.filter((r) => r.status === "fulfilled").length;
    const limited = results.filter((r) => r.status === "rejected" && (r.reason as any).code === "ANALYSIS_LIMIT_REACHED").length;
    expect(reserved).toBe(5);
    expect(limited).toBe(15);
    expect(counter()).toBe(5);
  });

  it("the same request retried on two instances at once is charged once", async () => {
    currentDb.ref = createProductionLikeDb();
    const [a, b] = [await loadCredit(), await loadCredit()];
    const results = await Promise.allSettled([reserveWith(a, "retry_me"), reserveWith(b, "retry_me")]);
    const fulfilled = results.filter((r): r is PromiseFulfilledResult<any> => r.status === "fulfilled");
    for (const r of results) {
      if (r.status === "rejected") expect((r.reason as any).code).toBe("ANALYSIS_IN_PROGRESS");
    }
    expect(fulfilled.length).toBeGreaterThanOrEqual(1);
    expect(new Set(fulfilled.map((r) => r.value.reservationId)).size).toBe(1);
    expect(counter()).toBe(1);
  });

  it("finalizing on another instance does not charge again; a later retry is recognised as finalized", async () => {
    currentDb.ref = createProductionLikeDb();
    const [a, b, c] = [await loadCredit(), await loadCredit(), await loadCredit()];
    await reserveWith(a, "req_fin");
    await finalizeWith(b, "req_fin");
    expect(counter()).toBe(1);

    const retry = await reserveWith(c, "req_fin");
    expect(retry.alreadyFinalized).toBe(true);
    expect(counter()).toBe(1);
  });

  it("finalizing twice is a no-op", async () => {
    currentDb.ref = createProductionLikeDb();
    const credit = await loadCredit();
    await reserveWith(credit, "req_twice");
    await finalizeWith(credit, "req_twice");
    await finalizeWith(credit, "req_twice");
    expect(counter()).toBe(1);
  });
});

describe("Release returns exactly one unit", () => {
  beforeEach(() => {
    currentDb.ref = createProductionLikeDb();
  });

  it("a failed analysis releases its unit once, even if released twice", async () => {
    const credit = await loadCredit();
    await reserveWith(credit, "req_fail");
    expect(counter()).toBe(1);
    await credit.releaseAnalysisReservation({ sessionId: SESSION, requestId: "req_fail", reason: "timeout" });
    await credit.releaseAnalysisReservation({ sessionId: SESSION, requestId: "req_fail", reason: "timeout" });
    expect(counter()).toBe(0);
  });

  it("a release on one instance is seen by another instance", async () => {
    const [a, b] = [await loadCredit(), await loadCredit()];
    await reserveWith(a, "req_cross");
    await b.releaseAnalysisReservation({ sessionId: SESSION, requestId: "req_cross", reason: "stream dropped" });
    expect(counter()).toBe(0);
  });

  it("two instances releasing the same reservation at the same moment give back one unit, not two", async () => {
    const [a, b, c] = [await loadCredit(), await loadCredit(), await loadCredit()];
    await reserveWith(c, "req_one");
    await reserveWith(c, "req_two");
    expect(counter()).toBe(2);
    await Promise.all([
      a.releaseAnalysisReservation({ sessionId: SESSION, requestId: "req_one", reason: "timeout" }),
      b.releaseAnalysisReservation({ sessionId: SESSION, requestId: "req_one", reason: "timeout" }),
    ]);
    expect(counter()).toBe(1);
  });

  it("a retry after a released attempt re-reserves exactly one unit", async () => {
    const credit = await loadCredit();
    await reserveWith(credit, "req_retry");
    await credit.releaseAnalysisReservation({ sessionId: SESSION, requestId: "req_retry", reason: "timeout" });
    expect(counter()).toBe(0);
    const again = await reserveWith(credit, "req_retry");
    expect(again.alreadyFinalized).toBe(false);
    expect(counter()).toBe(1);
  });

  it("a release after finalization does not give the unit back", async () => {
    const credit = await loadCredit();
    await reserveWith(credit, "req_done");
    await finalizeWith(credit, "req_done");
    await credit.releaseAnalysisReservation({ sessionId: SESSION, requestId: "req_done", reason: "late error" });
    expect(counter()).toBe(1);
  });
});

describe("Abandoned reservations", () => {
  it("a reservation whose request never finished is reclaimed when the allowance is full", async () => {
    const stale = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    currentDb.ref = createProductionLikeDb({ usage: { [COUNTER]: 3 } });
    currentDb.ref._freeUsage.set(markerFor(SESSION, "req_crashed"), {
      uid: markerFor(SESSION, "req_crashed"),
      email: "reservation:reserved",
      analyses_used: 3,
      first_analysis_at: stale,
      last_analysis_at: stale,
    });

    const credit = await loadCredit();
    const res = await reserveWith(credit, "req_next");
    expect(res.alreadyFinalized).toBe(false);
    // 3 taken, the crashed one released (-1), the new one taken (+1).
    expect(counter()).toBe(3);
    expect(currentDb.ref._freeUsage.get(markerFor(SESSION, "req_crashed")).email).toBe("reservation:released");
  });

  it("a live reservation is not reclaimed, so a full allowance still refuses", async () => {
    const now = new Date().toISOString();
    currentDb.ref = createProductionLikeDb({ usage: { [COUNTER]: 3 } });
    currentDb.ref._freeUsage.set(markerFor(SESSION, "req_live"), {
      uid: markerFor(SESSION, "req_live"),
      email: "reservation:reserved",
      analyses_used: 3,
      first_analysis_at: now,
      last_analysis_at: now,
    });

    const credit = await loadCredit();
    await expect(reserveWith(credit, "req_blocked")).rejects.toMatchObject({ statusCode: 402, code: "ANALYSIS_LIMIT_REACHED" });
    expect(counter()).toBe(3);
  });

  it("an abandoned reservation that never claimed a unit gives nothing back", async () => {
    const stale = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    currentDb.ref = createProductionLikeDb({ usage: { [COUNTER]: 2 } });
    currentDb.ref._freeUsage.set(markerFor(SESSION, "req_half"), {
      uid: markerFor(SESSION, "req_half"),
      email: "reservation:reserved",
      analyses_used: 0,
      first_analysis_at: stale,
      last_analysis_at: stale,
    });
    const credit = await loadCredit();
    await reserveWith(credit, "req_after_half");
    expect(counter()).toBe(3);
  });
});

describe("Legacy usage and limits", () => {
  it("usage recorded before this change is honoured: no analysis beyond the package", async () => {
    currentDb.ref = createProductionLikeDb({ usage: { [COUNTER]: 3 } });
    const credit = await loadCredit();
    await expect(reserveWith(credit, "req_over")).rejects.toMatchObject({ code: "ANALYSIS_LIMIT_REACHED" });
    expect(counter()).toBe(3);
  });

  it("a Basic session is refused the 4th analysis when the first three ran on different instances", async () => {
    currentDb.ref = createProductionLikeDb();
    const instances = await Promise.all([loadCredit(), loadCredit(), loadCredit(), loadCredit()]);
    for (let i = 0; i < 3; i++) {
      await reserveWith(instances[i], `seq_${i}`);
      await finalizeWith(instances[i], `seq_${i}`);
    }
    await expect(reserveWith(instances[3], "seq_3")).rejects.toMatchObject({ code: "ANALYSIS_LIMIT_REACHED" });
    expect(counter()).toBe(3);
  });
});

describe("Fail closed", () => {
  it("if the reservation cannot be written, the analysis is refused with a retryable 503", async () => {
    currentDb.ref = createProductionLikeDb({ failWrites: true });
    const credit = await loadCredit();
    await expect(reserveWith(credit, "req_outage")).rejects.toMatchObject({
      statusCode: 503,
      code: "USAGE_SERVICE_TEMPORARILY_UNAVAILABLE",
    });
    expect(counter()).toBeUndefined();
  });

  it("finalize never throws after the analysis has been produced", async () => {
    currentDb.ref = createProductionLikeDb();
    const credit = await loadCredit();
    await reserveWith(credit, "req_late");
    currentDb.ref = createProductionLikeDb({ failWrites: true, usage: { [COUNTER]: 1 } });
    await expect(finalizeWith(credit, "req_late")).resolves.toBeNull();
  });
});

describe("Suspension and revocation", () => {
  it("a revoked session is refused on every instance", async () => {
    currentDb.ref = createProductionLikeDb({
      sessions: [{ id: SESSION, tier: "Basic", revoked_at: "2026-01-01T00:00:00Z" }],
    });
    const [a, b] = [await loadCredit(), await loadCredit()];
    await expect(reserveWith(a, "req_rev_a")).rejects.toMatchObject({ statusCode: 403, code: "ACCOUNT_SUSPENDED" });
    await expect(reserveWith(b, "req_rev_b")).rejects.toMatchObject({ statusCode: 403, code: "ACCOUNT_SUSPENDED" });
    expect(counter()).toBeUndefined();
  });

  it("an administrative suspension recorded as a suspended_ row blocks reservations", async () => {
    currentDb.ref = createProductionLikeDb();
    const credit = await loadCredit();
    await credit.suspendSession({ sessionId: SESSION, reason: "Chargeback" });
    await expect(reserveWith(credit, "req_susp")).rejects.toMatchObject({ code: "ACCOUNT_SUSPENDED", message: "Chargeback" });
  });

  it("a database failure reading the session row fails closed", async () => {
    const fake = createProductionLikeDb();
    currentDb.ref = {
      from: (table: string) =>
        table === "navigator_paid_sessions"
          ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { code: "08006", message: "connection failure" } }) }) }) }
          : fake.from(table),
    };
    const credit = await loadCredit();
    await expect(reserveWith(credit, "req_dbdown")).rejects.toMatchObject({ statusCode: 503 });
  });
});

describe("Per-analysis usage counters (usage.ts)", () => {
  const quickKey = (requestId: string) => `analyze:${SESSION}:${requestId}`;

  beforeEach(() => {
    currentDb.ref = createProductionLikeDb();
  });

  it("a usage record retried on several instances is counted once", async () => {
    const [a, b] = [await loadUsage(), await loadUsage()];
    await Promise.all([
      a.recordPaidUse(SESSION, "Basic", null, "quick", quickKey("req_quick_1")),
      b.recordPaidUse(SESSION, "Basic", null, "quick", quickKey("req_quick_1")),
    ]);
    const c = await loadUsage();
    await c.recordPaidUse(SESSION, "Basic", null, "quick", quickKey("req_quick_1"));
    expect(currentDb.ref._freeUsage.get(`paid_session_${SESSION}_quick`)?.analyses_used).toBe(1);
  });

  it("concurrent increments on different keys are never lost", async () => {
    const instances = await Promise.all(Array.from({ length: 4 }, () => loadUsage()));
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => instances[i % 4].recordPaidUse(SESSION, "Premium", null, "quick", quickKey(`burst_${i}`)))
    );
    expect(currentDb.ref._freeUsage.get(`paid_session_${SESSION}_quick`)?.analyses_used).toBe(20);
  });

  it("a retry of an analysis that used the last Basic slot is still allowed, on any instance", async () => {
    const usage = await loadUsage();
    for (let i = 1; i <= 3; i++) {
      await usage.recordPaidUse(SESSION, "Basic", null, "quick", quickKey(`req_quick_${i}`));
    }
    const other = await loadUsage();
    const retry = await other.checkPaidUsage(SESSION, "Basic", "quick", quickKey("req_quick_3"));
    expect(retry.allowed).toBe(true);
    expect(retry.alreadyConsumed).toBe(true);
    const fresh = await other.checkPaidUsage(SESSION, "Basic", "quick", quickKey("req_quick_4"));
    expect(fresh.allowed).toBe(false);
  });
});
