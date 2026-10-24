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
  const sessionId = `vfy_${randomUUID()}`;

  beforeAll(() => {
    process.env.SUPABASE_URL = stagingUrl;
    process.env.SUPABASE_SERVICE_ROLE_KEY = stagingKey;
  });

  afterAll(async () => {
    const { getSupabase } = await import("./access.js");
    await getSupabase().from("free_usage").delete().like("uid", `*${sessionId}*`);
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
    const retrySession = `vfy_retry_${randomUUID()}`;
    const instances = await Promise.all(Array.from({ length: 3 }, () => loadCredit()));
    await Promise.allSettled(instances.map((credit) => reserve(credit, "vfy_same_request", retrySession)));
    const credit = await loadCredit();
    expect((await credit.getCreditBalance(retrySession, "Basic")).creditsConsumed).toBe(1);
  });

  it("a failed analysis gives its credit back; a finished one keeps it", async () => {
    const releaseSession = `vfy_release_${randomUUID()}`;
    const credit = await loadCredit();
    await reserve(credit, "vfy_fails", releaseSession);
    await credit.releaseAnalysisReservation({ sessionId: releaseSession, requestId: "vfy_fails", reason: "timeout" });
    expect((await credit.getCreditBalance(releaseSession, "Basic")).creditsConsumed).toBe(0);

    await reserve(credit, "vfy_works", releaseSession);
    await credit.finalizeAnalysisCredit({ sessionId: releaseSession, firebaseUid: "vfy-uid", requestId: "vfy_works", tier: "Basic" });
    await credit.releaseAnalysisReservation({ sessionId: releaseSession, requestId: "vfy_works", reason: "late" });
    expect((await credit.getCreditBalance(releaseSession, "Basic")).creditsConsumed).toBe(1);
  });

  it("with an invalid service key the reservation fails closed with a retryable 503", async () => {
    process.env.SUPABASE_SERVICE_ROLE_KEY = "invalid-key-for-verification";
    try {
      const credit = await loadCredit();
      await expect(reserve(credit, "vfy_bad_key", `vfy_badkey_${randomUUID()}`)).rejects.toMatchObject({
        statusCode: 503,
        code: "USAGE_SERVICE_TEMPORARILY_UNAVAILABLE",
      });
    } finally {
      process.env.SUPABASE_SERVICE_ROLE_KEY = stagingKey;
    }
  });
});
