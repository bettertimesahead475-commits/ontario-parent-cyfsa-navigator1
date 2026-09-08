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
import { beforeEach, describe, expect, it, vi } from "vitest";

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

const { approvePayment } = await import("./access.js");

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
