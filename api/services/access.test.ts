// Tests the real approvePayment() implementation (not mocked, unlike api/_server.test.ts
// and gmailAgent.test.ts, which both stub this whole module out) against a fake in-memory
// Supabase double built to allow genuine async interleaving between concurrent calls.
//
// This exists specifically to lock in the fix for a real race: two near-simultaneous calls
// for the same reference number (an admin approving by hand while the Gmail agent's cron is
// mid-run, or two overlapping cron invocations - now a real possibility at the 2-minute
// interval, vs. effectively never at the old daily one) used to both pass the "is this still
// pending" check before either had written anything, so both would mint and issue a
// separate access code for one payment. approvePayment() now claims the payment with an
// UPDATE ... WHERE status = 'pending' and only proceeds if that update actually matched a
// row - see the comment above it in access.ts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import crypto from "node:crypto";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";
process.env.SESSION_SECRET = "test-session-secret";

const { mockSendMail } = vi.hoisted(() => ({ mockSendMail: vi.fn() }));
vi.mock("nodemailer", () => ({
  default: { createTransport: () => ({ sendMail: mockSendMail }) },
}));

// getSupabase() in access.ts memoizes createClient()'s return value on first call and reuses
// it for the rest of the process, so mocking createClient() itself to return a thin proxy -
// one that reads `currentDb.ref` fresh on every `.from()` call - is what lets each test swap
// in its own fake db afterwards despite that memoization. Mocking the external
// @supabase/supabase-js package (rather than access.js itself, or spying on its exports)
// also means approvePayment() runs as real, unmocked code - which is the whole point here.
const currentDb: { ref: FakeDb | null } = vi.hoisted(() => ({ ref: null }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    from: (table: string) => currentDb.ref!.from(table),
  }),
}));

const { approvePayment, issueSessionToken, verifySessionToken } = await import("./access.js");

type FakeDb = ReturnType<typeof createFakeDb>;

// A fake Supabase client covering exactly the chains approvePayment() uses against a single
// in-memory `payments` row and an `access_codes` array. `update().eq().eq().select()` mutates
// the row synchronously once its (simulated) network delay resolves, and reports back whether
// it actually matched - this is what real Postgres row-level locking guarantees for an
// UPDATE ... WHERE, and is the exact behavior the fix in access.ts depends on.
function createFakeDb(initialPayment: Record<string, any>) {
  let paymentsRow: Record<string, any> = { ...initialPayment };
  const accessCodes: any[] = [];
  // A real network round-trip yields to the event loop; without this, two calls made via
  // Promise.all would never actually interleave in single-threaded JS and the race this test
  // exists to catch could never occur even with the bug still present.
  const networkDelay = () => new Promise((resolve) => setTimeout(resolve, 0));

  return {
    _accessCodes: accessCodes,
    _paymentsRow: () => paymentsRow,
    from(table: string) {
      if (table === "payments") {
        return {
          select: () => ({
            eq: (fieldA: string, valueA: any) => ({
              eq: (fieldB: string, valueB: any) => ({
                maybeSingle: async () => {
                  await networkDelay();
                  const match = paymentsRow[fieldA] === valueA && paymentsRow[fieldB] === valueB;
                  return { data: match ? { ...paymentsRow } : null, error: null };
                },
              }),
            }),
          }),
          update: (patch: Record<string, any>) => ({
            eq: (fieldA: string, valueA: any) => ({
              eq: (fieldB: string, valueB: any) => ({
                select: async () => {
                  await networkDelay();
                  const matched = paymentsRow[fieldA] === valueA && paymentsRow[fieldB] === valueB;
                  if (matched) paymentsRow = { ...paymentsRow, ...patch };
                  return { data: matched ? [{ reference_number: paymentsRow.reference_number }] : [], error: null };
                },
              }),
            }),
          }),
        };
      }
      if (table === "access_codes") {
        return {
          insert: async (row: any) => {
            await networkDelay();
            accessCodes.push(row);
            return { error: null };
          },
        };
      }
      throw new Error(`Unexpected table in test double: ${table}`);
    },
  };
}

function useFakeDb(db: FakeDb) {
  currentDb.ref = db;
}

beforeEach(() => {
  mockSendMail.mockClear();
  mockSendMail.mockResolvedValue({});
  delete process.env.SMTP_HOST;
  delete process.env.SMTP_USER;
  delete process.env.SMTP_PASS;
});

describe("approvePayment - concurrency", () => {
  it("approves a single valid request normally", async () => {
    const db = createFakeDb({ reference_number: "PS-ABCDE", amount: 19, plan: "Pro", status: "pending", notes: "email:parent@example.com" });
    useFakeDb(db);

    const result = await approvePayment("PS-ABCDE", 19);

    expect(result.email).toBe("parent@example.com");
    expect(result.tier).toBe("Pro");
    expect(db._paymentsRow().status).toBe("approved");
    expect(db._accessCodes).toHaveLength(1);
  });

  it("closes the race: two near-simultaneous approvals for the same reference issue exactly one access code", async () => {
    const db = createFakeDb({ reference_number: "PS-RACE1", amount: 19, plan: "Pro", status: "pending", notes: "email:parent@example.com" });
    useFakeDb(db);

    const results = await Promise.allSettled([approvePayment("PS-RACE1", 19), approvePayment("PS-RACE1", 19)]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toContain("already approved by a concurrent request");
    expect((rejected[0] as PromiseRejectedResult).reason.statusCode).toBe(409);

    // The real point of the fix: only one access code was ever minted for this payment,
    // regardless of how many callers raced to approve it.
    expect(db._accessCodes).toHaveLength(1);
    expect(db._paymentsRow().status).toBe("approved");
  });

  it("rejects approving an already-approved payment (sequential, not a race)", async () => {
    const db = createFakeDb({ reference_number: "PS-DONE1", amount: 19, plan: "Pro", status: "approved", notes: "email:parent@example.com" });
    useFakeDb(db);

    await expect(approvePayment("PS-DONE1", 19)).rejects.toThrow("No pending payment found");
    expect(db._accessCodes).toHaveLength(0);
  });
});

// This is the actual point of tonight's work: a parent who pays must automatically receive
// their code with zero human step, on BOTH the manual admin-approve route and the automated
// Gmail-agent path. Both routes call this exact same approvePayment() (see api/_server.ts's
// /api/admin/approve-payment and api/services/gmailAgent.ts's scanForPayments()), so proving
// the email fires here proves it for both callers - see gmailAgent.test.ts for the
// automated path's own coverage of what happens when this send fails.
describe("approvePayment - parent email delivery", () => {
  it("emails the access code directly to the parent when SMTP is configured", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_USER = "user";
    process.env.SMTP_PASS = "pass";

    const db = createFakeDb({ reference_number: "PS-MAIL1", amount: 49, plan: "Premium", status: "pending", notes: "email:parent@example.com" });
    useFakeDb(db);

    const result = await approvePayment("PS-MAIL1", 49);

    expect(result.emailSent).toBe(true);
    expect(mockSendMail).toHaveBeenCalledTimes(1);
    const sentMail = mockSendMail.mock.calls[0][0];
    expect(sentMail.to).toBe("parent@example.com");
    expect(sentMail.subject).toContain("Premium");
    expect(sentMail.text).toContain("PS-MAIL1");
    expect(sentMail.text).toContain(result.code);
    expect(sentMail.text).toContain("Membership page");
  });

  it("returns emailSent: false without failing the approval when SMTP isn't configured", async () => {
    // beforeEach already leaves SMTP_HOST/USER/PASS unset.
    const db = createFakeDb({ reference_number: "PS-MAIL2", amount: 19, plan: "Pro", status: "pending", notes: "email:parent@example.com" });
    useFakeDb(db);

    const result = await approvePayment("PS-MAIL2", 19);

    expect(result.emailSent).toBe(false);
    expect(mockSendMail).not.toHaveBeenCalled();
    // The approval itself must still have gone through - the code is real and exists,
    // it just wasn't delivered automatically.
    expect(db._paymentsRow().status).toBe("approved");
    expect(db._accessCodes).toHaveLength(1);
  });

  it("still approves and mints the code even if the email send itself fails", async () => {
    process.env.SMTP_HOST = "smtp.example.com";
    process.env.SMTP_USER = "user";
    process.env.SMTP_PASS = "pass";
    mockSendMail.mockRejectedValueOnce(new Error("SMTP connection refused"));

    const db = createFakeDb({ reference_number: "PS-MAIL3", amount: 19, plan: "Pro", status: "pending", notes: "email:parent@example.com" });
    useFakeDb(db);

    const result = await approvePayment("PS-MAIL3", 19);

    expect(result.emailSent).toBe(false);
    expect(db._paymentsRow().status).toBe("approved");
    expect(db._accessCodes).toHaveLength(1);
  });
});

// SECURITY FIX: getSessionSecret() used to fall back to ADMIN_SECRET when SESSION_SECRET was
// unset, coupling admin-route authentication and paid-session signing into one shared secret.
// These tests lock in the separation: SESSION_SECRET is its own required secret with no
// fallback, and access.ts's session functions never read ADMIN_SECRET at all.
describe("session-signing secret separation", () => {
  const ORIGINAL_SESSION_SECRET = process.env.SESSION_SECRET;
  const ORIGINAL_ADMIN_SECRET = process.env.ADMIN_SECRET;

  afterEach(() => {
    if (ORIGINAL_SESSION_SECRET === undefined) delete process.env.SESSION_SECRET;
    else process.env.SESSION_SECRET = ORIGINAL_SESSION_SECRET;
    if (ORIGINAL_ADMIN_SECRET === undefined) delete process.env.ADMIN_SECRET;
    else process.env.ADMIN_SECRET = ORIGINAL_ADMIN_SECRET;
  });

  it("signs and verifies a session token using SESSION_SECRET when it is configured", () => {
    process.env.SESSION_SECRET = "real-session-secret";
    delete process.env.ADMIN_SECRET;

    const token = issueSessionToken("parent@example.com", "Pro");
    const result = verifySessionToken(token);

    expect(result).toEqual({ email: "parent@example.com", tier: "Pro" });
  });

  it("does not fall back to ADMIN_SECRET when SESSION_SECRET is absent", () => {
    delete process.env.SESSION_SECRET;
    process.env.ADMIN_SECRET = "admin-only-secret";

    // A token forged with what used to be the fallback secret (ADMIN_SECRET) must not verify -
    // proving ADMIN_SECRET is no longer usable as a stand-in session-signing key.
    const payload = Buffer.from(
      JSON.stringify({ email: "attacker@example.com", tier: "Premium", exp: Date.now() + 60_000 })
    ).toString("base64url");
    const sigUsingAdminSecret = crypto.createHmac("sha256", "admin-only-secret").update(payload).digest("base64url");
    const forgedWithAdminSecret = `${payload}.${sigUsingAdminSecret}`;

    expect(() => verifySessionToken(forgedWithAdminSecret)).toThrow(/SESSION_SECRET/);
  });

  it("fails closed - throws, never grants access - when SESSION_SECRET is unavailable", () => {
    delete process.env.SESSION_SECRET;
    delete process.env.ADMIN_SECRET;

    expect(() => issueSessionToken("parent@example.com", "Pro")).toThrow(/SESSION_SECRET/);
    expect(() => verifySessionToken("anything.here")).toThrow(/SESSION_SECRET/);
  });

  it("leaves ADMIN_SECRET and administrative authentication untouched", () => {
    // x-admin-secret checks in api/_server.ts compare the header directly against
    // process.env.ADMIN_SECRET and never call into access.ts's session-signing code - this
    // documents the other half of the separation: access.ts's session functions neither read
    // nor depend on ADMIN_SECRET in any way, so admin authentication cannot be affected by
    // paid-session configuration.
    process.env.ADMIN_SECRET = "admin-only-secret";
    delete process.env.SESSION_SECRET;

    expect(() => issueSessionToken("parent@example.com", "Pro")).toThrow();
    expect(process.env.ADMIN_SECRET).toBe("admin-only-secret");
  });

  it("still rejects a tampered or wrongly-signed token when SESSION_SECRET is configured", () => {
    process.env.SESSION_SECRET = "real-session-secret";

    const token = issueSessionToken("parent@example.com", "Premium");
    const [payload] = token.split(".");
    const wrongSig = crypto.createHmac("sha256", "not-the-real-secret").update(payload).digest("base64url");

    expect(verifySessionToken(`${payload}.${wrongSig}`)).toBeNull();
  });
});
