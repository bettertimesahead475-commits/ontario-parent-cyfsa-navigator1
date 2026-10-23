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
function createFakeDb(opts: { failCodeInsert?: boolean; failRelease?: boolean; missingIdentityColumns?: boolean } = {}) {
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
        if (table === "payments" && opts.missingIdentityColumns && ("firebase_uid" in insertRow || "request_key" in insertRow)) {
          return { data: null, error: { code: "42703", message: "column \"request_key\" of relation \"payments\" does not exist" } };
        }
        // Mirror the partial unique index on (firebase_uid, request_key) where request_key is set.
        if (table === "payments" && insertRow && insertRow.request_key) {
          const clash = tables[table].some((r) => r.firebase_uid === insertRow.firebase_uid && r.request_key === insertRow.request_key);
          if (clash) return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint payments_firebase_uid_request_key_uidx" } };
        }
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
  it("creates one pending request stamped with the verified uid and checkout key", async () => {
    const result = await requestAccess("owner@example.com", "Pro", { uid: UID_A, requestKey: "attempt-0001" });
    expect(result.reused).toBe(false);
    expect(db._tables.payments).toHaveLength(1);
    expect(db._tables.payments[0].firebase_uid).toBe(UID_A);
    expect(db._tables.payments[0].request_key).toBe("attempt-0001");
    expect(db._tables.payments[0].status).toBe("pending");
    expect(result.instructions).toContain(result.referenceNumber);
  });

  it("returns the same pending reference on a repeated click instead of creating a second request", async () => {
    const first = await requestAccess("owner@example.com", "Pro", { uid: UID_A, requestKey: "attempt-0001" });
    const second = await requestAccess("owner@example.com", "Pro", { uid: UID_A, requestKey: "attempt-0001" });
    expect(second.referenceNumber).toBe(first.referenceNumber);
    expect(second.reused).toBe(true);
    expect(db._tables.payments).toHaveLength(1);
  });

  it("returns one reference when two submissions of the same attempt race", async () => {
    const [a, b] = await Promise.all([
      requestAccess("owner@example.com", "Pro", { uid: UID_A, requestKey: "attempt-race" }),
      requestAccess("owner@example.com", "Pro", { uid: UID_A, requestKey: "attempt-race" }),
    ]);
    expect(b.referenceNumber).toBe(a.referenceNumber);
    expect([a.reused, b.reused].sort()).toEqual([false, true]);
    expect(db._tables.payments).toHaveLength(1);
  });

  it("treats a new checkout attempt as a new purchase, even for the same account and package", async () => {
    const first = await requestAccess("owner@example.com", "Pro", { uid: UID_A, requestKey: "attempt-0001" });
    const repeat = await requestAccess("owner@example.com", "Pro", { uid: UID_A, requestKey: "attempt-0002" });
    expect(repeat.reused).toBe(false);
    expect(repeat.referenceNumber).not.toBe(first.referenceNumber);
    expect(db._tables.payments).toHaveLength(2);
  });

  it("does not reuse without a checkout key, so only a keyed retry is treated as the same purchase", async () => {
    await requestAccess("owner@example.com", "Pro", { uid: UID_A });
    const again = await requestAccess("owner@example.com", "Pro", { uid: UID_A });
    expect(again.reused).toBe(false);
    expect(db._tables.payments).toHaveLength(2);
  });

  it("does not reuse a request across different accounts, even with the same key", async () => {
    const a = await requestAccess("a@example.com", "Pro", { uid: UID_A, requestKey: "attempt-same" });
    const b = await requestAccess("b@example.com", "Pro", { uid: UID_B, requestKey: "attempt-same" });
    expect(b.referenceNumber).not.toBe(a.referenceNumber);
    expect(db._tables.payments).toHaveLength(2);
  });

  it("does not reuse an unkeyed request for a different package", async () => {
    await requestAccess("owner@example.com", "Pro", { uid: UID_A });
    const other = await requestAccess("owner@example.com", "Premium", { uid: UID_A });
    expect(other.reused).toBe(false);
    expect(db._tables.payments).toHaveLength(2);
  });

  it("refuses a used key whose verified email has since changed, instead of reusing it", async () => {
    await requestAccess("old@example.com", "Pro", { uid: UID_A, requestKey: "attempt-0001" });
    await expect(
      requestAccess("new@example.com", "Pro", { uid: UID_A, requestKey: "attempt-0001" })
    ).rejects.toMatchObject({ statusCode: 409, code: "REQUEST_KEY_USED" });
    expect(db._tables.payments).toHaveLength(1);
  });

  it("refuses a used key whose stored amount is no longer the current price", async () => {
    db._tables.payments.push({
      reference_number: "PS-OLDPRC",
      plan: "Pro",
      amount: 19.99,
      status: "pending",
      notes: `email:owner@example.com;uid:${UID_A};key:attempt-0001`,
      payment_email: PAYMENT_EMAIL,
      firebase_uid: UID_A,
      request_key: "attempt-0001",
      submitted_at: new Date().toISOString(),
    });
    await expect(
      requestAccess("owner@example.com", "Pro", { uid: UID_A, requestKey: "attempt-0001" })
    ).rejects.toMatchObject({ statusCode: 409, code: "REQUEST_KEY_USED" });
    expect(db._tables.payments).toHaveLength(1);
  });

  it("refuses a key that was already approved, so a replay cannot create a second request", async () => {
    await requestAccess("owner@example.com", "Pro", { uid: UID_A, requestKey: "attempt-0001" });
    db._tables.payments[0].status = "approved";
    await expect(
      requestAccess("owner@example.com", "Pro", { uid: UID_A, requestKey: "attempt-0001" })
    ).rejects.toMatchObject({ statusCode: 409, code: "REQUEST_KEY_USED" });
    expect(db._tables.payments).toHaveLength(1);
  });

  it("does not leave a keyed request without its key when the migration is not applied", async () => {
    db = createFakeDb({ missingIdentityColumns: true });
    currentDb.ref = db;
    resetSupabaseClientForTesting();
    await expect(
      requestAccess("owner@example.com", "Pro", { uid: UID_A, requestKey: "attempt-0001" })
    ).rejects.toMatchObject({ statusCode: 503, code: "PAYMENT_STORAGE_NOT_READY" });
    expect(db._tables.payments).toHaveLength(0);
  });

  it("matches the uid exactly, so a uid that is a prefix of another never reuses its request", async () => {
    await requestAccess("short@example.com", "Pro", { uid: "uidAlpha12", requestKey: "attempt-0001" });
    const other = await requestAccess("long@example.com", "Pro", { uid: UID_A, requestKey: "attempt-0001" });
    expect(other.reused).toBe(false);
  });

  it("rejects a uid that is not a plain identifier, before it reaches a query", async () => {
    await expect(requestAccess("x@example.com", "Pro", { uid: "a%b" })).rejects.toMatchObject({ statusCode: 400 });
    expect(db._tables.payments).toHaveLength(0);
  });

  it("rejects a malformed request key", async () => {
    await expect(
      requestAccess("x@example.com", "Pro", { uid: UID_A, requestKey: "short" })
    ).rejects.toMatchObject({ statusCode: 400, code: "INVALID_REQUEST_KEY" });
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
