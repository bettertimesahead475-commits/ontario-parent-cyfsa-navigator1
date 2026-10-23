// Payment-request identity, idempotency, and approval rollback for access.ts.
// Uses an in-memory Supabase double that supports exactly the query shapes requestAccess()
// and approvePayment() issue, so the tests exercise the real code paths.
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

const { requestAccess, approvePayment, PAYMENT_EMAIL, resetSupabaseClientForTesting } = await import("./access.js");

type Row = Record<string, any>;

// A chainable query double. Filters accumulate; the query runs when awaited, or when
// maybeSingle() is requested. update() applies to the rows its filters match.
function createFakeDb(opts: { failCodeInsert?: boolean; failRelease?: boolean } = {}) {
  const tables: Record<string, Row[]> = { payments: [], access_codes: [], navigator_paid_sessions: [] };

  function builder(table: string) {
    const filters: Array<(r: Row) => boolean> = [];
    let op: "select" | "insert" | "update" = "select";
    let insertRow: Row | null = null;
    let patch: Row | null = null;
    let single = false;
    let limitN: number | null = null;

    const matches = () => {
      let rows = tables[table].filter((r) => filters.every((f) => f(r)));
      if (limitN !== null) rows = rows.slice(0, limitN);
      return rows;
    };

    const run = () => {
      if (op === "insert") {
        if (table === "access_codes" && opts.failCodeInsert) {
          return { data: null, error: { message: "simulated code insert outage" } };
        }
        // Mirror the table's column default so the 24-hour window filter sees a real timestamp.
        const defaults = table === "payments" ? { submitted_at: new Date().toISOString() } : {};
        tables[table].push({ ...defaults, ...insertRow });
        return { data: [insertRow], error: null };
      }
      if (op === "update") {
        if (opts.failRelease && patch && patch.status === "pending") {
          return { data: null, error: { message: "simulated release outage" } };
        }
        const rows = matches();
        rows.forEach((r) => Object.assign(r, patch));
        return { data: rows.map((r) => ({ reference_number: r.reference_number })), error: null };
      }
      const rows = matches();
      if (single) return { data: rows[0] ? { ...rows[0] } : null, error: null };
      return { data: rows.map((r) => ({ ...r })), error: null };
    };

    const q: any = {
      select: () => q,
      eq: (field: string, value: any) => {
        filters.push((r) => r[field] === value);
        return q;
      },
      gte: (field: string, value: any) => {
        filters.push((r) => String(r[field]) >= String(value));
        return q;
      },
      like: (field: string, pattern: string) => {
        // Only the "%fragment%" shape used by requestAccess is needed.
        const needle = pattern.replace(/%/g, "");
        filters.push((r) => String(r[field] ?? "").includes(needle));
        return q;
      },
      order: () => q,
      limit: (n: number) => {
        limitN = n;
        return q;
      },
      maybeSingle: () => {
        single = true;
        return q;
      },
      insert: (row: Row) => {
        op = "insert";
        insertRow = row;
        return q;
      },
      update: (p: Row) => {
        op = "update";
        patch = p;
        return q;
      },
      then: (resolve: any, reject: any) => Promise.resolve(run()).then(resolve, reject),
    };
    return q;
  }

  return {
    _tables: tables,
    from: (table: string) => {
      if (!tables[table]) throw new Error(`Unexpected table in test double: ${table}`);
      return builder(table);
    },
  };
}

const UID_A = "uidAlpha123";
const UID_B = "uidBeta456";

let db: ReturnType<typeof createFakeDb>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.SMTP_HOST = "smtp.example.com";
  process.env.SMTP_USER = "user";
  process.env.SMTP_PASS = "pass";
  mockSendMail.mockResolvedValue({});
  db = createFakeDb();
  currentDb.ref = db;
  resetSupabaseClientForTesting();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("requestAccess - idempotency and identity", () => {
  it("creates one pending request stamped with the verified uid", async () => {
    const result = await requestAccess("owner@example.com", "Pro", { uid: UID_A });
    expect(result.reused).toBe(false);
    expect(db._tables.payments).toHaveLength(1);
    expect(db._tables.payments[0].notes).toContain(`uid:${UID_A}`);
    expect(db._tables.payments[0].status).toBe("pending");
    expect(result.instructions).toContain(result.referenceNumber);
  });

  it("returns the same pending reference on a repeated click instead of creating a second request", async () => {
    const first = await requestAccess("owner@example.com", "Pro", { uid: UID_A });
    const second = await requestAccess("owner@example.com", "Pro", { uid: UID_A });
    expect(second.referenceNumber).toBe(first.referenceNumber);
    expect(second.reused).toBe(true);
    expect(db._tables.payments).toHaveLength(1);
  });

  it("does not reuse a request across different accounts", async () => {
    const a = await requestAccess("a@example.com", "Pro", { uid: UID_A });
    const b = await requestAccess("b@example.com", "Pro", { uid: UID_B });
    expect(b.referenceNumber).not.toBe(a.referenceNumber);
    expect(db._tables.payments).toHaveLength(2);
  });

  it("does not reuse a request for a different package", async () => {
    await requestAccess("owner@example.com", "Pro", { uid: UID_A });
    const other = await requestAccess("owner@example.com", "Premium", { uid: UID_A });
    expect(other.reused).toBe(false);
    expect(db._tables.payments).toHaveLength(2);
  });

  it("does not reuse a pending request when the account's verified email has changed", async () => {
    const original = await requestAccess("old@example.com", "Pro", { uid: UID_A });
    const changed = await requestAccess("new@example.com", "Pro", { uid: UID_A });
    expect(changed.reused).toBe(false);
    expect(changed.referenceNumber).not.toBe(original.referenceNumber);
    expect(db._tables.payments.find((p: Row) => p.reference_number === changed.referenceNumber).notes).toContain("email:new@example.com");
  });

  it("matches the uid exactly, so a uid that is a prefix of another never reuses its request", async () => {
    await requestAccess("short@example.com", "Pro", { uid: "uidAlpha12" });
    const other = await requestAccess("long@example.com", "Pro", { uid: UID_A });
    expect(other.reused).toBe(false);
  });

  it("creates a new request once the previous one is older than 24 hours", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-10T12:00:00Z"));
    const first = await requestAccess("owner@example.com", "Pro", { uid: UID_A });
    vi.setSystemTime(new Date("2026-10-11T12:01:00Z"));
    const later = await requestAccess("owner@example.com", "Pro", { uid: UID_A });
    expect(later.reused).toBe(false);
    expect(later.referenceNumber).not.toBe(first.referenceNumber);
  });

  it("rejects a uid that is not a plain identifier, before it reaches a query pattern", async () => {
    await expect(requestAccess("x@example.com", "Pro", { uid: "a%b" })).rejects.toMatchObject({ statusCode: 400 });
    expect(db._tables.payments).toHaveLength(0);
  });
});

describe("approvePayment - rollback and single issuance", () => {
  async function seedPending(ref: string, amount = 49.99) {
    db._tables.payments.push({
      reference_number: ref,
      plan: "Pro",
      amount,
      status: "pending",
      notes: `email:owner@example.com;uid:${UID_A}`,
      payment_email: PAYMENT_EMAIL,
    });
  }

  it("approves, issues one code, and sends it", async () => {
    await seedPending("PS-OKAY1");
    const result = await approvePayment("PS-OKAY1", 49.99);
    expect(result.emailSent).toBe(true);
    expect(db._tables.payments[0].status).toBe("approved");
    expect(db._tables.access_codes).toHaveLength(1);
    expect(db._tables.access_codes[0].code_hash).toBeTruthy();
    expect(mockSendMail).toHaveBeenCalledTimes(1);
  });

  it("releases the claim when code creation fails, so the payment is not left approved with no code", async () => {
    db = createFakeDb({ failCodeInsert: true });
    currentDb.ref = db;
    resetSupabaseClientForTesting();
    await seedPending("PS-FAIL1");

    await expect(approvePayment("PS-FAIL1", 49.99)).rejects.toMatchObject({ statusCode: 500 });
    expect(db._tables.payments[0].status).toBe("pending");
    expect(db._tables.payments[0].approved_at).toBeNull();
    expect(db._tables.access_codes).toHaveLength(0);
    expect(mockSendMail).not.toHaveBeenCalled();
  });

  it("refuses a second approval for the same reference, so no second code is issued", async () => {
    await seedPending("PS-TWICE");
    await approvePayment("PS-TWICE", 49.99);
    await expect(approvePayment("PS-TWICE", 49.99)).rejects.toMatchObject({ statusCode: 404 });
    expect(db._tables.access_codes).toHaveLength(1);
  });
  it("says plainly that the payment is approved without a code when the release also fails", async () => {
    db = createFakeDb({ failCodeInsert: true, failRelease: true });
    currentDb.ref = db;
    resetSupabaseClientForTesting();
    await seedPending("PS-STUCK1");

    await expect(approvePayment("PS-STUCK1", 49.99)).rejects.toMatchObject({
      statusCode: 500,
      code: "APPROVED_WITHOUT_CODE",
    });
    expect(db._tables.payments[0].status).toBe("approved");
    expect(db._tables.access_codes).toHaveLength(0);
  });
});
