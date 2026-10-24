// Regression tests for credit claims under concurrency, retries, failures and multiple server instances.
//
// Each "instance" below is a fresh copy of the module (vi.resetModules), so it has its own memory,
// exactly like two serverless instances. They share one fake database that behaves like production's
// free_usage table: a primary key on uid, and row-level writes that are atomic.

import { createHash } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
    // Exactly one attempt owns the reservation; any attempt that joined it carries no id and cannot release it.
    expect(fulfilled.filter((r) => r.value.reservationId !== "")).toHaveLength(1);
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
    const held = await reserveWith(credit, "req_fail");
    expect(counter()).toBe(1);
    await credit.releaseAnalysisReservation({ sessionId: SESSION, requestId: "req_fail", reservationId: held.reservationId, reason: "timeout" });
    await credit.releaseAnalysisReservation({ sessionId: SESSION, requestId: "req_fail", reservationId: held.reservationId, reason: "timeout" });
    expect(counter()).toBe(0);
  });

  it("a release on one instance is seen by another instance", async () => {
    const [a, b] = [await loadCredit(), await loadCredit()];
    const held = await reserveWith(a, "req_cross");
    await b.releaseAnalysisReservation({ sessionId: SESSION, requestId: "req_cross", reservationId: held.reservationId, reason: "stream dropped" });
    expect(counter()).toBe(0);
  });

  it("two instances releasing the same reservation at the same moment give back one unit, not two", async () => {
    const [a, b, c] = [await loadCredit(), await loadCredit(), await loadCredit()];
    const held = await reserveWith(c, "req_one");
    await reserveWith(c, "req_two");
    expect(counter()).toBe(2);
    await Promise.all([
      a.releaseAnalysisReservation({ sessionId: SESSION, requestId: "req_one", reservationId: held.reservationId, reason: "timeout" }),
      b.releaseAnalysisReservation({ sessionId: SESSION, requestId: "req_one", reservationId: held.reservationId, reason: "timeout" }),
    ]);
    expect(counter()).toBe(1);
  });

  it("a retry after a released attempt re-reserves exactly one unit", async () => {
    const credit = await loadCredit();
    const first = await reserveWith(credit, "req_retry");
    await credit.releaseAnalysisReservation({ sessionId: SESSION, requestId: "req_retry", reservationId: first.reservationId, reason: "timeout" });
    expect(counter()).toBe(0);
    const again = await reserveWith(credit, "req_retry");
    expect(again.alreadyFinalized).toBe(false);
    expect(counter()).toBe(1);
  });

  it("a release after finalization does not give the unit back", async () => {
    const credit = await loadCredit();
    const done = await reserveWith(credit, "req_done");
    await finalizeWith(credit, "req_done");
    await credit.releaseAnalysisReservation({ sessionId: SESSION, requestId: "req_done", reservationId: done.reservationId, reason: "late error" });
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

  it("finalize refuses to record success when the charge cannot be written, so nothing is delivered for free", async () => {
    // A live reservation exists, but the database refuses writes when the analysis finishes.
    const db = createProductionLikeDb({ failWrites: true, usage: { [COUNTER]: 1 } });
    db._freeUsage.set(markerFor(SESSION, "req_late"), {
      uid: markerFor(SESSION, "req_late"),
      email: "reservation:reserved",
      analyses_used: 1,
      first_analysis_at: new Date().toISOString(),
      last_analysis_at: new Date().toISOString(),
    });
    currentDb.ref = db;
    const credit = await loadCredit();
    await expect(finalizeWith(credit, "req_late")).rejects.toMatchObject({ statusCode: 503 });
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

// ---------------------------------------------------------------------------
// Billing integrity: ownership, reclaim while running, crash points, claim window, monthly cycles.
// ---------------------------------------------------------------------------

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const PRO_SESSION = "22222222-2222-4222-8222-222222222222";
const proCounter = (cycle: string) => `paid_session_${PRO_SESSION}_cycle_${cycle}`;

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60 * 1000).toISOString();
}

function seedMarker(sessionId: string, requestId: string, email: string, slot: number, touched: string) {
  const uid = markerFor(sessionId, requestId);
  return { uid, email, analyses_used: slot, first_analysis_at: touched, last_analysis_at: touched };
}

describe("Only the owner of a reservation can release it", () => {
  beforeEach(() => {
    currentDb.ref = createProductionLikeDb();
  });

  it("a retry that joins a live reservation and then fails cannot release the owner's credit", async () => {
    const [owner, retry] = [await loadCredit(), await loadCredit()];
    const held = await reserveWith(owner, "req_live");
    const joined = await reserveWith(retry, "req_live");
    expect(joined.reservationId).toBe("");

    await retry.releaseAnalysisReservation({ sessionId: SESSION, requestId: "req_live", reservationId: joined.reservationId, reason: "retry timed out" });
    expect(counter()).toBe(1);

    await owner.finalizeAnalysisCredit({ sessionId: SESSION, firebaseUid: "uid-owner", requestId: "req_live", tier: "Basic" });
    expect(counter()).toBe(1);
    expect(held.reservationId).not.toBe("");
  });

  it("a release carrying another request's reservation id does nothing", async () => {
    const credit = await loadCredit();
    const other = await reserveWith(credit, "req_other");
    await reserveWith(credit, "req_mine");
    await credit.releaseAnalysisReservation({ sessionId: SESSION, requestId: "req_mine", reservationId: other.reservationId, reason: "wrong id" });
    expect(counter()).toBe(2);
  });
});

describe("Reclaim never touches a legitimately running analysis", () => {
  it("a reservation touched 10 minutes ago (inside the 15-minute window) is not reclaimed when the allowance is full", async () => {
    currentDb.ref = createProductionLikeDb({ usage: { [COUNTER]: 3 } });
    const marker = seedMarker(SESSION, "req_running", "reservation:reserved", 3, minutesAgo(10));
    currentDb.ref._freeUsage.set(marker.uid, marker);
    const credit = await loadCredit();
    await expect(reserveWith(credit, "req_blocked_running")).rejects.toMatchObject({ code: "ANALYSIS_LIMIT_REACHED" });
    expect(currentDb.ref._freeUsage.get(marker.uid).email).toBe("reservation:reserved");
    expect(counter()).toBe(3);
  });

  it("the reservation window is longer than twice the longest function run (vercel.json maxDuration)", async () => {
    const vercel = JSON.parse(readFileSync(resolve(__dirname, "../../vercel.json"), "utf8"));
    const maxSeconds = Math.max(...Object.values<any>(vercel.functions).map((f) => f.maxDuration));
    const credit = await loadCredit();
    expect(credit.RESERVATION_TTL_MS).toBeGreaterThanOrEqual(2 * maxSeconds * 1000);
  });
});

describe("Crash recovery between marker and counter", () => {
  beforeEach(() => {
    currentDb.ref = createProductionLikeDb();
  });

  it("crash after the marker was written but before the counter moved: never decrements the counter, and is swept only when the allowance is full", async () => {
    currentDb.ref = createProductionLikeDb({ usage: { [COUNTER]: 2 } });
    const crashed = seedMarker(SESSION, "req_crash_marker", "reservation:reserved", 0, minutesAgo(16));
    currentDb.ref._freeUsage.set(crashed.uid, crashed);
    const credit = await loadCredit();
    await reserveWith(credit, "req_after_crash_marker");
    expect(counter()).toBe(3);
    // Not full at the time, so the sweep did not run; the stale marker is harmless because it holds no unit.
    expect(currentDb.ref._freeUsage.get(crashed.uid).analyses_used).toBe(0);
  });

  it("crash after the counter moved but before the slot was recorded: the unit is lost, never over-issued", async () => {
    // The counter already includes the crashed unit (3 of 3), and the crashed marker has no slot.
    currentDb.ref = createProductionLikeDb({ usage: { [COUNTER]: 3 } });
    const crashed = seedMarker(SESSION, "req_crash_counter", "reservation:reserved", 0, minutesAgo(16));
    currentDb.ref._freeUsage.set(crashed.uid, crashed);
    const credit = await loadCredit();
    await expect(reserveWith(credit, "req_over")).rejects.toMatchObject({ code: "ANALYSIS_LIMIT_REACHED" });
    expect(counter()).toBe(3);
  });

  it("a claim that has not recorded its unit yet is not reclaimed inside the claim window", async () => {
    currentDb.ref = createProductionLikeDb({ usage: { [COUNTER]: 1 } });
    const claiming = seedMarker(SESSION, "req_claiming", "reservation:reserved", 0, new Date().toISOString());
    currentDb.ref._freeUsage.set(claiming.uid, claiming);
    const credit = await loadCredit();
    await expect(reserveWith(credit, "req_claiming")).rejects.toMatchObject({ statusCode: 409, code: "ANALYSIS_IN_PROGRESS" });
  });

  it("a claim abandoned longer than the claim window does not block its retry for the full TTL", async () => {
    currentDb.ref = createProductionLikeDb({ usage: { [COUNTER]: 1 } });
    const abandoned = seedMarker(SESSION, "req_abandoned_claim", "reservation:reserved", 0, minutesAgo(2));
    currentDb.ref._freeUsage.set(abandoned.uid, abandoned);
    const credit = await loadCredit();
    const retry = await reserveWith(credit, "req_abandoned_claim");
    expect(retry.reservationId).not.toBe("");
    expect(counter()).toBe(2);
  });
});

describe("Pro and Community: forensic analyses per calendar month, quick reviews unlimited", () => {
  beforeEach(() => {
    currentDb.ref = createProductionLikeDb();
  });
  afterEach(async () => {
    const { setCreditClockForTesting } = await loadCredit();
    setCreditClockForTesting(null);
  });

  const reserveFor = (credit: CreditModule, requestId: string, analysisType: "quick" | "forensic", tier = "Pro") =>
    credit.reserveAnalysisCredit({ sessionId: PRO_SESSION, firebaseUid: "uid-pro", tier, requestId, analysisType });

  it("ten quick reviews do not draw on the forensic allowance, and five forensic analyses are allowed per month", async () => {
    const credit = await loadCredit();
    credit.setCreditClockForTesting(() => new Date("2026-03-15T12:00:00Z"));
    for (let i = 0; i < 10; i++) await reserveFor(credit, `pro_quick_${i}`, "quick");
    for (let i = 0; i < 5; i++) await reserveFor(credit, `pro_forensic_${i}`, "forensic");
    expect(currentDb.ref._freeUsage.get(proCounter("2026-03"))?.analyses_used).toBe(5);
    expect(currentDb.ref._freeUsage.get(`paid_session_${PRO_SESSION}_total`)).toBeUndefined();
    await expect(reserveFor(credit, "pro_forensic_6", "forensic")).rejects.toMatchObject({ code: "ANALYSIS_LIMIT_REACHED" });
  });

  it("the Community plans use the same monthly forensic allowance", async () => {
    const credit = await loadCredit();
    credit.setCreditClockForTesting(() => new Date("2026-03-15T12:00:00Z"));
    for (let i = 0; i < 5; i++) await reserveFor(credit, `com_forensic_${i}`, "forensic", "Community10");
    await expect(reserveFor(credit, "com_forensic_6", "forensic", "Community10")).rejects.toMatchObject({ code: "ANALYSIS_LIMIT_REACHED" });
  });

  it("the allowance renews at the calendar-month boundary", async () => {
    const credit = await loadCredit();
    credit.setCreditClockForTesting(() => new Date("2026-01-31T23:59:00Z"));
    for (let i = 0; i < 5; i++) await reserveFor(credit, `jan_${i}`, "forensic");
    await expect(reserveFor(credit, "jan_6", "forensic")).rejects.toMatchObject({ code: "ANALYSIS_LIMIT_REACHED" });

    credit.setCreditClockForTesting(() => new Date("2026-02-01T00:01:00Z"));
    const feb = await reserveFor(credit, "feb_1", "forensic");
    expect(feb.slotIndex).toBe(1);
    expect(currentDb.ref._freeUsage.get(proCounter("2026-02"))?.analyses_used).toBe(1);
  });

  it("releasing a January reservation after the boundary returns the unit to January, not February", async () => {
    const credit = await loadCredit();
    credit.setCreditClockForTesting(() => new Date("2026-01-31T23:59:00Z"));
    const held = await reserveFor(credit, "jan_held", "forensic");
    credit.setCreditClockForTesting(() => new Date("2026-02-01T00:01:00Z"));
    await credit.releaseAnalysisReservation({ sessionId: PRO_SESSION, requestId: "jan_held", reservationId: held.reservationId, reason: "failed" });
    expect(currentDb.ref._freeUsage.get(proCounter("2026-01"))?.analyses_used).toBe(0);
    expect(currentDb.ref._freeUsage.get(proCounter("2026-02"))).toBeUndefined();
  });

  it("concurrent forensic requests across instances never exceed the monthly five", async () => {
    const credit = await loadCredit();
    credit.setCreditClockForTesting(() => new Date("2026-03-15T12:00:00Z"));
    const instances = await Promise.all([loadCredit(), loadCredit(), loadCredit()]);
    instances.forEach((i) => i.setCreditClockForTesting(() => new Date("2026-03-15T12:00:00Z")));
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) => reserveFor(instances[i % 3], `burst_pro_${i}`, "forensic"))
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(5);
    expect(currentDb.ref._freeUsage.get(proCounter("2026-03"))?.analyses_used).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Review findings: re-taken slots, lost responses, finalize, active claims, cycle-correct recording.
// ---------------------------------------------------------------------------

describe("Review findings", () => {
  beforeEach(() => {
    currentDb.ref = createProductionLikeDb();
  });

  it("a released reservation that is re-taken does not carry its old slot", async () => {
    const credit = await loadCredit();
    const first = await reserveWith(credit, "req_retake");
    expect(first.slotIndex).toBe(1);
    await credit.releaseAnalysisReservation({ sessionId: SESSION, requestId: "req_retake", reservationId: first.reservationId, reason: "failed" });
    // Fill the allowance so the re-take cannot claim a unit.
    currentDb.ref._freeUsage.set(COUNTER, { uid: COUNTER, email: null, analyses_used: 3, first_analysis_at: null, last_analysis_at: null });
    await expect(reserveWith(credit, "req_retake")).rejects.toMatchObject({ code: "ANALYSIS_LIMIT_REACHED" });
    expect(currentDb.ref._freeUsage.get(markerFor(SESSION, "req_retake")).analyses_used).toBe(0);
  });

  it("a joined attempt cannot take the unit of an active analysis that was reclaimed by a later claim", async () => {
    // An active analysis (slot 1, touched 2 minutes ago) must not be treated as an abandoned claim.
    currentDb.ref = createProductionLikeDb({ usage: { [COUNTER]: 3 } });
    const active = seedMarker(SESSION, "req_active", "reservation:reserved", 1, minutesAgo(2));
    currentDb.ref._freeUsage.set(active.uid, active);
    const credit = await loadCredit();
    await expect(reserveWith(credit, "req_other_while_active")).rejects.toMatchObject({ code: "ANALYSIS_LIMIT_REACHED" });
    expect(currentDb.ref._freeUsage.get(active.uid).email).toBe("reservation:reserved");
    expect(counter()).toBe(3);
  });

  it("a lost response on the counter write is not retried: the unit is taken once", async () => {
    currentDb.ref = createProductionLikeDb({ usage: { [COUNTER]: 2 } });
    currentDb.ref._faults.commitThenFailUpdates = 1;
    const credit = await loadCredit();
    await expect(reserveWith(credit, "req_lost_response")).rejects.toMatchObject({ statusCode: 503 });
    expect(counter()).toBe(3);
  });

  it("a lost response on the release transition is not retried, and the unit is not returned twice", async () => {
    // The transition committed but its response was lost. The unit is then not returned (under-serve), never returned
    // twice: the retry path would have found the marker already released and given nothing back.
    const credit = await loadCredit();
    const held = await reserveWith(credit, "req_lost_release");
    expect(counter()).toBe(1);
    currentDb.ref._faults.commitThenFailUpdates = 1;
    await credit.releaseAnalysisReservation({ sessionId: SESSION, requestId: "req_lost_release", reservationId: held.reservationId, reason: "failed" });
    expect(currentDb.ref._freeUsage.get(markerFor(SESSION, "req_lost_release")).email).toBe("reservation:released");
    expect(counter()).toBe(1);
    await credit.releaseAnalysisReservation({ sessionId: SESSION, requestId: "req_lost_release", reservationId: held.reservationId, reason: "failed" });
    expect(counter()).toBe(1);
  });

  it("the per-analysis counter uses the billing month the credit was reserved in", async () => {
    const usage = await loadUsage();
    const PRO = "33333333-3333-4333-8333-333333333333";
    await usage.recordPaidUse(PRO, "Pro", null, "forensic", `analyze:${PRO}:straddle`, "2026-01");
    expect(currentDb.ref._freeUsage.get(`paid_session_${PRO}_forensic_2026-01`)?.analyses_used).toBe(1);
    expect(currentDb.ref._freeUsage.get(`paid_session_${PRO}_forensic_2026-02`)).toBeUndefined();
  });

  it("a Pro forensic reservation reports the billing month it was drawn from", async () => {
    const credit = await loadCredit();
    credit.setCreditClockForTesting(() => new Date("2026-04-02T10:00:00Z"));
    const pro = await credit.reserveAnalysisCredit({ sessionId: PRO_SESSION, firebaseUid: "uid-pro", tier: "Pro", requestId: "req_cycle_report", analysisType: "forensic" });
    credit.setCreditClockForTesting(null);
    expect(pro.billingCycle).toBe("2026-04");
    const basic = await reserveWith(credit, "req_basic_cycle_report");
    expect(basic.billingCycle).toBeNull();
  });

  it("a session id outside the safe set is refused before any database write", async () => {
    const credit = await loadCredit();
    await expect(reserveWith(credit, "req_bad_session", "bad/session")).rejects.toMatchObject({ statusCode: 400, code: "INVALID_SESSION" });
    expect(currentDb.ref._freeUsage.size).toBe(0);
  });
});
