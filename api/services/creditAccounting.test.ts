import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BASIC_ANALYSES_LIMIT,
  PREMIUM_ANALYSES_LIMIT,
  getPackageAllowance,
  getCreditBalance,
  reserveAnalysisCredit,
  releaseAnalysisReservation,
  finalizeAnalysisCredit,
  suspendSession,
  restoreSession,
  resetCreditAccountingCachesForTesting,
} from "./creditAccounting.js";
import { LifecycleError } from "./lifecycleErrors.js";
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

describe("creditAccounting - Server-Authoritative Package Limits & Cutoffs", () => {
  beforeEach(() => {
    resetCreditAccountingCachesForTesting();
  });

  afterEach(() => {
    resetCreditAccountingCachesForTesting();
  });

  it("enforces statutory package allowances", () => {
    expect(BASIC_ANALYSES_LIMIT).toBe(3);
    expect(PREMIUM_ANALYSES_LIMIT).toBe(5);

    const basic = getPackageAllowance("Basic");
    expect(basic.totalLimit).toBe(3);
    expect(basic.allowsForensic).toBe(false);

    const premium = getPackageAllowance("Premium");
    expect(premium.totalLimit).toBe(5);
    expect(premium.allowsForensic).toBe(true);

    const pro = getPackageAllowance("Pro");
    expect(pro.totalLimit).toBe(5);
    expect(pro.allowsForensic).toBe(true);
    expect(pro.isMonthly).toBe(true);
  });

  describe("Document Analyzer Basic ($19.99 CAD) — Exactly 3 Analyses Cutoff", () => {
    it("allows exactly 3 analyses and strictly blocks the 4th with ANALYSIS_LIMIT_REACHED", async () => {
      const db = createProductionLikeDb();
      currentDb.ref = db;

      // Check initial balance
      const initialBal = await getCreditBalance("session_basic_1", "Basic");
      expect(initialBal.creditsRemaining).toBe(3);
      expect(initialBal.creditsConsumed).toBe(0);

      // 1st analysis
      const res1 = await reserveAnalysisCredit({
        sessionId: "session_basic_1",
        firebaseUid: "user_1",
        tier: "Basic",
        requestId: "req_basic_1",
        analysisType: "quick",
        documentName: "Form 8A.pdf",
      });
      expect(res1.slotIndex).toBe(1);
      expect(res1.creditsRemainingAfterReservation).toBe(2);

      await finalizeAnalysisCredit({
        sessionId: "session_basic_1",
        firebaseUid: "user_1",
        requestId: "req_basic_1",
        tier: "Basic",
        documentName: "Form 8A.pdf",
      });

      // 2nd analysis
      const res2 = await reserveAnalysisCredit({
        sessionId: "session_basic_1",
        firebaseUid: "user_1",
        tier: "Basic",
        requestId: "req_basic_2",
        analysisType: "quick",
        documentName: "Affidavit.pdf",
      });
      expect(res2.slotIndex).toBe(2);
      expect(res2.creditsRemainingAfterReservation).toBe(1);

      await finalizeAnalysisCredit({
        sessionId: "session_basic_1",
        firebaseUid: "user_1",
        requestId: "req_basic_2",
        tier: "Basic",
        documentName: "Affidavit.pdf",
      });

      // 3rd analysis
      const res3 = await reserveAnalysisCredit({
        sessionId: "session_basic_1",
        firebaseUid: "user_1",
        tier: "Basic",
        requestId: "req_basic_3",
        analysisType: "quick",
        documentName: "Conference Brief.pdf",
      });
      expect(res3.slotIndex).toBe(3);
      expect(res3.creditsRemainingAfterReservation).toBe(0);

      await finalizeAnalysisCredit({
        sessionId: "session_basic_1",
        firebaseUid: "user_1",
        requestId: "req_basic_3",
        tier: "Basic",
        documentName: "Conference Brief.pdf",
      });

      const zeroBal = await getCreditBalance("session_basic_1", "Basic");
      expect(zeroBal.creditsRemaining).toBe(0);
      expect(zeroBal.creditsConsumed).toBe(3);

      // 4th analysis MUST be blocked server-side
      await expect(
        reserveAnalysisCredit({
          sessionId: "session_basic_1",
          firebaseUid: "user_1",
          tier: "Basic",
          requestId: "req_basic_4",
          analysisType: "quick",
          documentName: "Excess Document.pdf",
        })
      ).rejects.toMatchObject({
        statusCode: 402,
        code: "ANALYSIS_LIMIT_REACHED",
        message: "You've used all analyses included in your package. Purchase additional analyses to continue.",
      });
    });

    it("rejects Forensic In-Depth Dual-Pass scans on Basic tier with 403 FORENSIC_UPGRADE_REQUIRED", async () => {
      const db = createProductionLikeDb();
      currentDb.ref = db;

      await expect(
        reserveAnalysisCredit({
          sessionId: "session_basic_forensic",
          firebaseUid: "user_1",
          tier: "Basic",
          requestId: "req_forensic_attempt",
          analysisType: "forensic",
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: "FORENSIC_UPGRADE_REQUIRED",
      });
    });
  });

  describe("Document Analyzer Premium ($49.99 CAD) — Exactly 5 Analyses Cutoff", () => {
    it("allows up to 5 dual-pass or quick analyses and blocks the 6th with ANALYSIS_LIMIT_REACHED", async () => {
      const db = createProductionLikeDb();
      currentDb.ref = db;

      for (let i = 1; i <= 5; i++) {
        const reqId = `req_prem_${i}`;
        const res = await reserveAnalysisCredit({
          sessionId: "session_premium_1",
          firebaseUid: "user_prem",
          tier: "Premium",
          requestId: reqId,
          analysisType: i % 2 === 0 ? "forensic" : "quick",
          documentName: `Document_${i}.pdf`,
        });
        expect(res.slotIndex).toBe(i);
        expect(res.creditsRemainingAfterReservation).toBe(5 - i);

        await finalizeAnalysisCredit({
          sessionId: "session_premium_1",
          firebaseUid: "user_prem",
          requestId: reqId,
          tier: "Premium",
          documentName: `Document_${i}.pdf`,
        });
      }

      const bal = await getCreditBalance("session_premium_1", "Premium");
      expect(bal.creditsRemaining).toBe(0);
      expect(bal.creditsConsumed).toBe(5);

      // 6th analysis MUST be blocked server-side
      await expect(
        reserveAnalysisCredit({
          sessionId: "session_premium_1",
          firebaseUid: "user_prem",
          tier: "Premium",
          requestId: "req_prem_6",
          analysisType: "forensic",
        })
      ).rejects.toMatchObject({
        statusCode: 402,
        code: "ANALYSIS_LIMIT_REACHED",
        message: "You've used all analyses included in your package. Purchase additional analyses to continue.",
      });
    });
  });

  describe("Concurrency & Race Condition Defenses", () => {
    it("handles 2 concurrent reservation requests with 1 credit remaining: exactly 1 succeeds, 1 blocked", async () => {
      const db = createProductionLikeDb({ usage: { [`paid_session_session_race_1_total`]: 2 } });
      currentDb.ref = db;

      const reqA = reserveAnalysisCredit({
        sessionId: "session_race_1",
        firebaseUid: "user_race",
        tier: "Basic",
        requestId: "race_req_A",
        analysisType: "quick",
      });

      const reqB = reserveAnalysisCredit({
        sessionId: "session_race_1",
        firebaseUid: "user_race",
        tier: "Basic",
        requestId: "race_req_B",
        analysisType: "quick",
      });

      const results = await Promise.allSettled([reqA, reqB]);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      expect(fulfilled.length).toBe(1);
      expect(rejected.length).toBe(1);

      const err = (rejected[0] as PromiseRejectedResult).reason;
      expect(err).toBeInstanceOf(LifecycleError);
      expect(err.statusCode).toBe(402);
      expect(err.code).toBe("ANALYSIS_LIMIT_REACHED");
    });

    it("handles 10 concurrent requests with 3 credits remaining: exactly 3 succeed, 7 blocked", async () => {
      const db = createProductionLikeDb();
      currentDb.ref = db;

      const promises = Array.from({ length: 10 }, (_, i) =>
        reserveAnalysisCredit({
          sessionId: "session_heavy_race",
          firebaseUid: "user_heavy",
          tier: "Basic",
          requestId: `heavy_req_${i + 1}`,
          analysisType: "quick",
        })
      );

      const results = await Promise.allSettled(promises);

      const fulfilled = results.filter((r) => r.status === "fulfilled");
      const rejected = results.filter((r) => r.status === "rejected");

      expect(fulfilled.length).toBe(3);
      expect(rejected.length).toBe(7);

      for (const rej of rejected) {
        const err = (rej as PromiseRejectedResult).reason;
        expect(err.statusCode).toBe(402);
        expect(err.code).toBe("ANALYSIS_LIMIT_REACHED");
      }
    });
  });

  describe("Idempotency", () => {
    it("returns existing reservation when same requestId is called multiple times without consuming extra credits", async () => {
      const db = createProductionLikeDb();
      currentDb.ref = db;

      const first = await reserveAnalysisCredit({
        sessionId: "session_idempotent",
        firebaseUid: "user_idem",
        tier: "Basic",
        requestId: "idem_req_100",
        analysisType: "quick",
      });

      const second = await reserveAnalysisCredit({
        sessionId: "session_idempotent",
        firebaseUid: "user_idem",
        tier: "Basic",
        requestId: "idem_req_100",
        analysisType: "quick",
      });

      // Only the attempt that owns the reservation carries its id; the joining retry carries none.
      expect(first.reservationId).not.toBe("");
      expect(second.reservationId).toBe("");
      expect(second.slotIndex).toBe(first.slotIndex);
    });
  });

  describe("Safe Release on Pipeline Failure", () => {
    it("releases reservation and restores credit slot when analysis pipeline fails", async () => {
      const db = createProductionLikeDb();
      currentDb.ref = db;

      const res = await reserveAnalysisCredit({
        sessionId: "session_release_test",
        firebaseUid: "user_rel",
        tier: "Basic",
        requestId: "req_failing",
        analysisType: "quick",
      });

      expect(res.slotIndex).toBe(1);

      // Simulate failure in AI call -> release reservation
      await releaseAnalysisReservation({
        sessionId: "session_release_test",
        requestId: "req_failing",
        reservationId: res.reservationId,
        reason: "Claude API timeout",
      });

      // The reservation status is released and credits_consumed was never incremented
      const bal = await getCreditBalance("session_release_test", "Basic");
      expect(bal.creditsConsumed).toBe(0);
      expect(bal.creditsRemaining).toBe(3);
    });
  });

  describe("Account Suspension & Administrative Cutoff Controls", () => {
    it("blocks access immediately with 403 ACCOUNT_SUSPENDED when session is suspended", async () => {
      const db = createProductionLikeDb();
      currentDb.ref = db;

      // Admin suspends session
      await suspendSession({
        sessionId: "session_suspend_test",
        reason: "Payment reversed by issuing bank",
      });

      await expect(
        reserveAnalysisCredit({
          sessionId: "session_suspend_test",
          firebaseUid: "user_susp",
          tier: "Basic",
          requestId: "req_suspended_attempt",
          analysisType: "quick",
        })
      ).rejects.toMatchObject({
        statusCode: 403,
        code: "ACCOUNT_SUSPENDED",
        message: "Payment reversed by issuing bank",
      });

      // Admin restores session
      await restoreSession("session_suspend_test");

      // Can now reserve successfully
      const res = await reserveAnalysisCredit({
        sessionId: "session_suspend_test",
        firebaseUid: "user_susp",
        tier: "Basic",
        requestId: "req_restored_attempt",
        analysisType: "quick",
      });
      expect(res.slotIndex).toBe(1);
    });
  });
});
