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

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.SESSION_SECRET = "test-session-secret";

interface FakeSessionRow {
  id: string;
  tier: string;
  credits_granted: number;
  credits_consumed: number;
  is_suspended: boolean;
  suspended_reason?: string | null;
  revoked_at?: string | null;
}

interface FakeReservationRow {
  id: string;
  session_id: string;
  firebase_uid: string;
  slot_index: number;
  request_id: string;
  analysis_type: string;
  status: "reserved" | "finalized" | "released";
  document_name?: string | null;
}

function createFakeDb(initialSessions: FakeSessionRow[] = []) {
  const sessions: Map<string, FakeSessionRow> = new Map(
    initialSessions.map((s) => [s.id, { ...s }])
  );
  const reservations: FakeReservationRow[] = [];
  const freeUsage: Map<string, any> = new Map();
  const auditLedger: any[] = [];

  const networkDelay = () => new Promise((resolve) => setTimeout(resolve, 1));

  return {
    _sessions: sessions,
    _reservations: reservations,
    _auditLedger: auditLedger,
    from(table: string) {
      if (table === "navigator_paid_sessions") {
        return {
          select: (_cols?: string) => ({
            eq: (_field: string, id: string) => ({
              maybeSingle: async () => {
                await networkDelay();
                const session = sessions.get(id);
                return { data: session ? { ...session } : null, error: null };
              },
            }),
          }),
          update: (patch: Partial<FakeSessionRow>) => ({
            eq: (_field: string, id: string) => {
              const session = sessions.get(id);
              if (session) {
                Object.assign(session, patch);
              }
              return Promise.resolve({ error: null });
            },
          }),
        };
      }

      if (table === "analysis_credit_reservations") {
        return {
          insert: async (row: any) => {
            await networkDelay();
            // Check unique constraint on (session_id, slot_index) and request_id
            const duplicateSlot = reservations.find(
              (r) => r.session_id === row.session_id && r.slot_index === row.slot_index && r.status !== "released"
            );
            const duplicateReq = reservations.find((r) => r.request_id === row.request_id);

            if (duplicateSlot || duplicateReq) {
              const err: any = new Error("Unique constraint violation");
              err.code = "23505";
              return { data: null, error: err };
            }

            const newRow: FakeReservationRow = {
              id: row.id || `res_${Date.now()}_${Math.random()}`,
              session_id: row.session_id,
              firebase_uid: row.firebase_uid,
              slot_index: row.slot_index,
              request_id: row.request_id,
              analysis_type: row.analysis_type,
              status: row.status || "reserved",
              document_name: row.document_name,
            };
            reservations.push(newRow);
            return { data: [newRow], error: null };
          },
          select: (_cols?: string) => ({
            eq: (field: string, val: any) => {
              const getFiltered = () => reservations.filter((r) => (r as any)[field] === val);
              return {
                then: (onfulfilled: any, onrejected: any) => {
                  return networkDelay()
                    .then(() => ({ data: getFiltered().map((r) => ({ ...r })), error: null }))
                    .then(onfulfilled, onrejected);
                },
                maybeSingle: async () => {
                  await networkDelay();
                  const found = reservations.find((r) => (r as any)[field] === val);
                  return { data: found ? { ...found } : null, error: null };
                },
              };
            },
          }),
          update: (patch: Partial<FakeReservationRow>) => ({
            eq: (fieldA: string, valA: any) => {
              const applyPatch = (fieldB?: string, valB?: any) => {
                for (const res of reservations) {
                  if ((res as any)[fieldA] === valA && (!fieldB || (res as any)[fieldB] === valB)) {
                    Object.assign(res, patch);
                  }
                }
                return { error: null };
              };
              return {
                then: (onfulfilled: any, onrejected: any) => {
                  return networkDelay()
                    .then(() => applyPatch())
                    .then(onfulfilled, onrejected);
                },
                eq: (fieldB: string, valB: any) => {
                  return networkDelay().then(() => applyPatch(fieldB, valB));
                },
              };
            },
          }),
        };
      }

      if (table === "free_usage") {
        return {
          select: () => ({
            eq: (_field: string, uid: string) => ({
              maybeSingle: async () => {
                await networkDelay();
                const row = freeUsage.get(uid);
                return { data: row ? { ...row } : null, error: null };
              },
            }),
          }),
          upsert: async (row: any) => {
            await networkDelay();
            freeUsage.set(row.uid, { ...row });
            return { error: null };
          },
          delete: () => ({
            eq: (_field: string, uid: string) => {
              freeUsage.delete(uid);
              return Promise.resolve({ error: null });
            },
          }),
        };
      }

      if (table === "credit_audit_ledger") {
        return {
          insert: async (entry: any) => {
            auditLedger.push(entry);
            return { error: null };
          },
        };
      }

      throw new Error(`Unexpected table: ${table}`);
    },
  };
}

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
      const db = createFakeDb([
        {
          id: "session_basic_1",
          tier: "Basic",
          credits_granted: 3,
          credits_consumed: 0,
          is_suspended: false,
        },
      ]);
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
      const db = createFakeDb([
        {
          id: "session_basic_forensic",
          tier: "Basic",
          credits_granted: 3,
          credits_consumed: 0,
          is_suspended: false,
        },
      ]);
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
      const db = createFakeDb([
        {
          id: "session_premium_1",
          tier: "Premium",
          credits_granted: 5,
          credits_consumed: 0,
          is_suspended: false,
        },
      ]);
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
      const db = createFakeDb([
        {
          id: "session_race_1",
          tier: "Basic",
          credits_granted: 3,
          credits_consumed: 2, // Only 1 credit left
          is_suspended: false,
        },
      ]);
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
      const db = createFakeDb([
        {
          id: "session_heavy_race",
          tier: "Basic",
          credits_granted: 3,
          credits_consumed: 0,
          is_suspended: false,
        },
      ]);
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
      const db = createFakeDb([
        {
          id: "session_idempotent",
          tier: "Basic",
          credits_granted: 3,
          credits_consumed: 0,
          is_suspended: false,
        },
      ]);
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

      expect(second.reservationId).toBe(first.reservationId);
      expect(second.slotIndex).toBe(first.slotIndex);
    });
  });

  describe("Safe Release on Pipeline Failure", () => {
    it("releases reservation and restores credit slot when analysis pipeline fails", async () => {
      const db = createFakeDb([
        {
          id: "session_release_test",
          tier: "Basic",
          credits_granted: 3,
          credits_consumed: 0,
          is_suspended: false,
        },
      ]);
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
      const db = createFakeDb([
        {
          id: "session_suspend_test",
          tier: "Basic",
          credits_granted: 3,
          credits_consumed: 0,
          is_suspended: false,
        },
      ]);
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
