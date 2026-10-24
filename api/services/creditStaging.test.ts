// Runs the credit reservation path against a real Supabase project through PostgREST, not a fake.
// This is the check the mocked tests cannot make: that PostgREST translates the store's filters, and that
// "update ... returning" reports the rows it changed.
//
// Skipped unless STAGING_SUPABASE_URL and STAGING_SUPABASE_SERVICE_ROLE_KEY are set. It refuses to run against
// the production project. It uses synthetic session ids only, and deletes every row it creates.
//
//   STAGING_SUPABASE_URL=https://<staging-ref>.supabase.co \
//   STAGING_SUPABASE_SERVICE_ROLE_KEY=<staging service key> \
//   npx vitest run api/services/creditStaging.test.ts

import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const PRODUCTION_PROJECT_REF = "qboidsfpjuxeqtfotryj";
const stagingUrl = process.env.STAGING_SUPABASE_URL;
const stagingKey = process.env.STAGING_SUPABASE_SERVICE_ROLE_KEY;
const enabled = Boolean(stagingUrl && stagingKey);

if (enabled && stagingUrl!.includes(PRODUCTION_PROJECT_REF)) {
  throw new Error("Refusing to run: STAGING_SUPABASE_URL points at the production project.");
}

type CreditModule = typeof import("./creditAccounting.js");

async function loadCredit(): Promise<CreditModule> {
  vi.resetModules();
  return await import("./creditAccounting.js");
}

describe.skipIf(!enabled)("credit reservation against a real Supabase project (staging only)", () => {
  // navigator_paid_sessions.id is a uuid, so synthetic session ids are uuids too.
  const sessionId = randomUUID();
  // Every synthetic session a case creates is recorded here, so afterAll removes it even when an assertion fails.
  const synthetic = new Set<string>([sessionId]);
  const track = <T extends string>(id: T): T => {
    synthetic.add(id);
    return id;
  };

  beforeAll(() => {
    process.env.SUPABASE_URL = stagingUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = stagingKey;
  });

  afterAll(async () => {
    const { getSupabase } = await import("./access.js");
    const db = getSupabase();
    for (const id of synthetic) {
      const { error } = await db.from("free_usage").delete().like("uid", `*${id}*`);
      if (error) throw new Error(`cleanup of synthetic free_usage rows failed: ${error.message}`);
    }
    const { error } = await db.from("navigator_paid_sessions").delete().in("id", [...synthetic]);
    if (error) throw new Error(`cleanup of synthetic paid sessions failed: ${error.message}`);
  });

  const reserve = (credit: CreditModule, requestId: string, sid = sessionId) =>
    credit.reserveAnalysisCredit({ sessionId: sid, firebaseUid: "vfy-uid", tier: "Basic", requestId, analysisType: "quick" });

  it("twelve concurrent requests across four instances with three credits: exactly three reserved", async () => {
    const instances = await Promise.all(Array.from({ length: 4 }, () => loadCredit()));
    const results = await Promise.allSettled(
      Array.from({ length: 12 }, (_, i) => reserve(instances[i % 4], `vfy_burst_${sessionId}_${i}`))
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(3);
    for (const r of results) {
      if (r.status === "rejected") expect((r.reason as any).code).toBe("ANALYSIS_LIMIT_REACHED");
    }
    const credit = await loadCredit();
    expect((await credit.getCreditBalance(sessionId, "Basic")).creditsConsumed).toBe(3);
  });

  it("one request id sent to three instances at once is charged once", async () => {
    const retrySession = track(randomUUID());
    const instances = await Promise.all(Array.from({ length: 3 }, () => loadCredit()));
    await Promise.allSettled(instances.map((credit) => reserve(credit, "vfy_same_request", retrySession)));
    const credit = await loadCredit();
    expect((await credit.getCreditBalance(retrySession, "Basic")).creditsConsumed).toBe(1);
  });

  it("a failed analysis gives its credit back; a finished one keeps it", async () => {
    const releaseSession = track(randomUUID());
    const credit = await loadCredit();
    const failed = await reserve(credit, "vfy_fails", releaseSession);
    await credit.releaseAnalysisReservation({ sessionId: releaseSession, requestId: "vfy_fails", reservationId: failed.reservationId, reason: "timeout" });
    expect((await credit.getCreditBalance(releaseSession, "Basic")).creditsConsumed).toBe(0);

    const works = await reserve(credit, "vfy_works", releaseSession);
    await credit.finalizeAnalysisCredit({ sessionId: releaseSession, firebaseUid: "vfy-uid", requestId: "vfy_works", tier: "Basic" });
    await credit.releaseAnalysisReservation({ sessionId: releaseSession, requestId: "vfy_works", reservationId: works.reservationId, reason: "late" });
    expect((await credit.getCreditBalance(releaseSession, "Basic")).creditsConsumed).toBe(1);
  });

  it("with an invalid service key the reservation fails closed with a retryable 503", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "invalid-key-for-verification";
    try {
      const credit = await loadCredit();
      await expect(reserve(credit, "vfy_bad_key", track(randomUUID()))).rejects.toMatchObject({
        statusCode: 503,
        code: "USAGE_SERVICE_TEMPORARILY_UNAVAILABLE",
      });
    } finally {
      process.env.SUPABASE_SERVICE_ROLE_KEY = stagingKey;
    }
  });

  // Exercises the prefix listing against real PostgREST: a stale reservation with a recorded unit is found and returned
  // on the next reserve. The row is written with the same statements the store uses; nothing is mocked.
  it("a crashed reservation on staging is reconciled by the next reserve", async () => {
    const reconcileSession = track(randomUUID());
    const { getSupabase } = await import("./access.js");
    const { createHash } = await import("node:crypto");
    const digest = createHash("sha256").update("vfy_crashed").digest("hex").slice(0, 32);
    const old = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const db = getSupabase();
    const seeded = await db.from("free_usage").insert([
      { uid: `paid_session_${reconcileSession}_total`, email: null, analyses_used: 1, first_analysis_at: old, last_analysis_at: old },
      { uid: `paid_res_${reconcileSession}_${digest}`, email: "reservation:reserved", analyses_used: 1, first_analysis_at: old, last_analysis_at: old },
    ]);
    expect(seeded.error).toBeNull();

    const credit = await loadCredit();
    await reserve(credit, "vfy_next", reconcileSession);
    expect((await credit.getCreditBalance(reconcileSession, "Basic")).creditsConsumed).toBe(1);
  });

  // Pro: forensic analyses renew on the session's own renewal date (issued_at), not the calendar month.
  it("a Pro session's quick reviews are not counted, and its forensic allowance renews on its anniversary", async () => {
    const proSession = track(randomUUID());
    const issued = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    const { getSupabase } = await import("./access.js");
    const db = getSupabase();
    const row = await db.from("navigator_paid_sessions").insert({
      id: proSession,
      firebase_uid: "vfy-uid",
      tier: "Pro",
      issued_at: issued.toISOString(),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
    });
    expect(row.error).toBeNull();
    const credit = await loadCredit();
    for (let i = 0; i < 2; i++) {
      await credit.reserveAnalysisCredit({ sessionId: proSession, firebaseUid: "vfy-uid", tier: "Pro", requestId: `vfy_pq_${i}`, analysisType: "quick" });
    }
    const pro = await credit.reserveAnalysisCredit({ sessionId: proSession, firebaseUid: "vfy-uid", tier: "Pro", requestId: "vfy_pf_1", analysisType: "forensic" });
    expect(pro.billingCycle).toBe(issued.toISOString().slice(0, 10));
    const period = await db.from("free_usage").select("analyses_used").eq("uid", `paid_session_${proSession}_period_${issued.toISOString().slice(0, 10)}`).retry(false);
    expect(period.data?.[0]?.analyses_used).toBe(1);
  });
});
