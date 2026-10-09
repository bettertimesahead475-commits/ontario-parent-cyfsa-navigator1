import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.SESSION_SECRET = "test-session-secret";

const { mockSendMail } = vi.hoisted(() => ({ mockSendMail: vi.fn() }));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: mockSendMail }) },
}));

const currentDb: { ref: any } = vi.hoisted(() => ({ ref: null }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => currentDb.ref.from(table),
  }),
}));

const {
  activateTrustBasedPayment,
  requestAccess,
  PAYMENT_EMAIL,
  resetSupabaseClientForTesting,
} = await import("./access.js");

function createFakeDb(initialPayments: Record<string, any>[] = []) {
  const payments: Map<string, Record<string, any>> = new Map(
    initialPayments.map((p) => [p.reference_number, { ...p }])
  );
  const accessCodes: any[] = [];
  const paidSessions: any[] = [];

  const networkDelay = () => new Promise((resolve) => setTimeout(resolve, 1));

  return {
    _payments: payments,
    _accessCodes: accessCodes,
    _paidSessions: paidSessions,
    from(table: string) {
      if (table === "payments") {
        return {
          select: () => ({
            eq: (_field: string, ref: string) => ({
              maybeSingle: async () => {
                await networkDelay();
                const p = payments.get(ref);
                return { data: p ? { ...p } : null, error: null };
              },
            }),
          }),
          update: (patch: Record<string, any>) => ({
            eq: (_fieldA: string, ref: string) => ({
              eq: (_fieldB: string, status: string) => ({
                select: async () => {
                  await networkDelay();
                  const p = payments.get(ref);
                  if (p && p.status === status) {
                    Object.assign(p, patch);
                    return { data: [{ reference_number: ref }], error: null };
                  }
                  return { data: [], error: null };
                },
              }),
            }),
          }),
          insert: async (row: any) => {
            await networkDelay();
            payments.set(row.reference_number, { ...row });
            return { data: [row], error: null };
          },
        };
      }

      if (table === "access_codes") {
        return {
          insert: async (row: any) => {
            await networkDelay();
            accessCodes.push(row);
            return { error: null };
          },
          select: () => ({
            eq: (_field: string, ref: string) => ({
              maybeSingle: async () => {
                await networkDelay();
                const code = accessCodes.find((c) => c.reference_number === ref);
                return { data: code ? { id: "code_123", ...code } : null, error: null };
              },
            }),
          }),
        };
      }

      if (table === "navigator_paid_sessions") {
        return {
          insert: async (row: any) => {
            await networkDelay();
            const session = { id: `sess_${Date.now()}`, ...row };
            paidSessions.push(session);
            return { data: [session], error: null };
          },
        };
      }

      throw new Error(`Unexpected table in test double: ${table}`);
    },
  };
}

describe("paymentActivation - Trust-Based Automated Activation & Settlement Controls", () => {
  beforeEach(() => {
    mockSendMail.mockClear();
    mockSendMail.mockResolvedValue({});
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_USER = "chris@cyfsanavigator.com";
    process.env.SMTP_PASS = "secret";
  });

  afterEach(() => {
    delete process.env.SMTP_HOST;
    delete process.env.SMTP_USER;
    delete process.env.SMTP_PASS;
  });

  describe("Document Analyzer Basic ($19.99 CAD) Activation", () => {
    it("activates trust-based access immediately on matching Interac notification, grants 3 credits, sets pending_settlement", async () => {
      const db = createFakeDb([
        {
          reference_number: "PS-BASIC-001",
          plan: "Basic",
          amount: 19.99,
          status: "pending",
          notes: "email:parent@example.com",
        },
      ]);
      currentDb.ref = db;

      const result = await activateTrustBasedPayment("PS-BASIC-001", 19.99, {
        senderInfo: "Jane Doe (Autodeposit)",
      });

      expect(result.email).toBe("parent@example.com");
      expect(result.tier).toBe("Basic");
      expect(result.creditsGranted).toBe(3);
      expect(result.status).toBe("notification_accepted_trust_grant");
      expect(result.settlementStatus).toBe("pending_settlement");
      expect(result.code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{4}-[A-Z0-9]{2}$/);
      expect(result.emailSent).toBe(true);

      // Verify payment row updated
      const paymentRow = db._payments.get("PS-BASIC-001");
      expect(paymentRow?.status).toBe("approved");
      expect(paymentRow?.bank_settlement_status).toBe("pending_settlement");
      expect(paymentRow?.notification_accepted_at).toBeDefined();

      // Verify email sent with accurate copy
      expect(mockSendMail).toHaveBeenCalledTimes(1);
      const mailCall = mockSendMail.mock.calls[0][0];
      expect(mailCall.to).toBe("parent@example.com");
      expect(mailCall.text).toContain("for Basic has been accepted");
      expect(mailCall.text).toContain("your 3 document analyses are active immediately");
      expect(mailCall.text).toContain("while bank settlement processes");
      expect(mailCall.text).toContain("https://cyfsanavigator.com/analyzer");
    });
  });

  describe("Document Analyzer Premium ($49.99 CAD) Activation", () => {
    it("activates trust-based access immediately, grants exactly 5 analyses, sets pending_settlement", async () => {
      const db = createFakeDb([
        {
          reference_number: "PS-PREM-002",
          plan: "Premium",
          amount: 49.99,
          status: "pending",
          notes: "email:parent.premium@example.com",
        },
      ]);
      currentDb.ref = db;

      const result = await activateTrustBasedPayment("PS-PREM-002", 49.99);

      expect(result.email).toBe("parent.premium@example.com");
      expect(result.tier).toBe("Premium");
      expect(result.creditsGranted).toBe(5);
      expect(result.status).toBe("notification_accepted_trust_grant");
      expect(result.settlementStatus).toBe("pending_settlement");

      // Verify email copy
      expect(mockSendMail).toHaveBeenCalledTimes(1);
      const mailCall = mockSendMail.mock.calls[0][0];
      expect(mailCall.text).toContain("for Premium has been accepted");
      expect(mailCall.text).toContain("your 5 document analyses are active immediately");
      expect(mailCall.text).toContain("while bank settlement processes");
    });
  });

  describe("Auto-Provisioning Session When Firebase UID is Attached", () => {
    it("provisions paid session directly when payment was requested by signed-in parent", async () => {
      const db = createFakeDb([
        {
          reference_number: "PS-AUTH-003",
          plan: "Basic",
          amount: 19.99,
          status: "pending",
          firebase_uid: "firebase_user_789",
          notes: "email:authparent@example.com;uid:firebase_user_789",
        },
      ]);
      currentDb.ref = db;

      const result = await activateTrustBasedPayment("PS-AUTH-003", 19.99);

      expect(result.activatedSessionId).toBeDefined();
      expect(result.creditsGranted).toBe(3);
    });
  });

  describe("Security Gates & Defenses", () => {
    it("rejects underpaid notification and does not grant access", async () => {
      const db = createFakeDb([
        {
          reference_number: "PS-UNDERPAID-004",
          plan: "Premium",
          amount: 49.99,
          status: "pending",
          notes: "email:cheap@example.com",
        },
      ]);
      currentDb.ref = db;

      await expect(
        activateTrustBasedPayment("PS-UNDERPAID-004", 19.99)
      ).rejects.toMatchObject({
        statusCode: 400,
        message: expect.stringContaining("less than expected $49.99"),
      });

      // Status remains pending, no access code generated
      const paymentRow = db._payments.get("PS-UNDERPAID-004");
      expect(paymentRow?.status).toBe("pending");
      expect(db._accessCodes.length).toBe(0);
    });

    it("prevents double-activation and replay attacks", async () => {
      const db = createFakeDb([
        {
          reference_number: "PS-REPLAY-005",
          plan: "Basic",
          amount: 19.99,
          status: "pending",
          notes: "email:parent@example.com",
        },
      ]);
      currentDb.ref = db;

      // First run succeeds
      await activateTrustBasedPayment("PS-REPLAY-005", 19.99);
      expect(db._accessCodes.length).toBe(1);

      // Second run is blocked
      await expect(
        activateTrustBasedPayment("PS-REPLAY-005", 19.99)
      ).rejects.toMatchObject({
        statusCode: 409,
        message: expect.stringContaining("already processed"),
      });

      // No duplicate access code issued
      expect(db._accessCodes.length).toBe(1);
    });

    it("throws 404 if reference number does not exist", async () => {
      const db = createFakeDb([]);
      currentDb.ref = db;

      await expect(
        activateTrustBasedPayment("PS-NONEXISTENT", 19.99)
      ).rejects.toMatchObject({
        statusCode: 404,
        message: "No payment request found for that reference number.",
      });
    });
  });
});
