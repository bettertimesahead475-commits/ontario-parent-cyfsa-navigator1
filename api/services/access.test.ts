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

const {
  approvePayment,
  issueSessionToken,
  verifySessionToken,
  verifyAccessCode,
  createPaidSession,
  getActivePaidSession,
  revokeSession,
  revokeAllSessionsForUid,
} = await import("./access.js");

// Mirrors access.ts's private hashCode() exactly (SHA-256 of the uppercased/trimmed code) -
// there's no way to seed a realistic code_hash into the fake access_codes table otherwise,
// since that function isn't exported (by design - nothing outside this module should ever
// need a plaintext-code-to-hash conversion).
function hashCodeForTest(code: string): string {
  return crypto.createHash("sha256").update(code.toUpperCase().trim()).digest("hex");
}

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

    const token = issueSessionToken("session-abc", Date.now() + 60_000);
    const result = verifySessionToken(token);

    expect(result).toEqual({ jti: "session-abc" });
  });

  it("does not fall back to ADMIN_SECRET when SESSION_SECRET is absent", () => {
    delete process.env.SESSION_SECRET;
    process.env.ADMIN_SECRET = "admin-only-secret";

    // A token forged with what used to be the fallback secret (ADMIN_SECRET) must not verify -
    // proving ADMIN_SECRET is no longer usable as a stand-in session-signing key.
    const payload = Buffer.from(JSON.stringify({ jti: "session-abc", exp: Date.now() + 60_000 })).toString("base64url");
    const sigUsingAdminSecret = crypto.createHmac("sha256", "admin-only-secret").update(payload).digest("base64url");
    const forgedWithAdminSecret = `${payload}.${sigUsingAdminSecret}`;

    expect(() => verifySessionToken(forgedWithAdminSecret)).toThrow(/SESSION_SECRET/);
  });

  it("fails closed - throws, never grants access - when SESSION_SECRET is unavailable", () => {
    delete process.env.SESSION_SECRET;
    delete process.env.ADMIN_SECRET;

    expect(() => issueSessionToken("session-abc", Date.now() + 60_000)).toThrow(/SESSION_SECRET/);
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

    expect(() => issueSessionToken("session-abc", Date.now() + 60_000)).toThrow();
    expect(process.env.ADMIN_SECRET).toBe("admin-only-secret");
  });

  it("still rejects a tampered or wrongly-signed token when SESSION_SECRET is configured", () => {
    process.env.SESSION_SECRET = "real-session-secret";

    const token = issueSessionToken("session-abc", Date.now() + 60_000);
    const [payload] = token.split(".");
    const wrongSig = crypto.createHmac("sha256", "not-the-real-secret").update(payload).digest("base64url");

    expect(verifySessionToken(`${payload}.${wrongSig}`)).toBeNull();
  });

  it("rejects a token whose own exp has passed, independent of any database check", () => {
    process.env.SESSION_SECRET = "real-session-secret";

    const expiredToken = issueSessionToken("session-abc", Date.now() - 1000);

    expect(verifySessionToken(expiredToken)).toBeNull();
  });

  it("rejects a structurally invalid token (no jti in the payload)", () => {
    process.env.SESSION_SECRET = "real-session-secret";

    const payload = Buffer.from(JSON.stringify({ exp: Date.now() + 60_000 })).toString("base64url");
    const sig = crypto.createHmac("sha256", "real-session-secret").update(payload).digest("base64url");

    expect(verifySessionToken(`${payload}.${sig}`)).toBeNull();
  });
});

// M-2 / Finding 3 remediation: verifyAccessCode() now requires a verified Firebase identity
// and binds the resulting session to it (not to the submitted email), redemption is made
// atomic against concurrent replay, and the token embeds only { jti, exp } backed by a real
// navigator_paid_sessions row. Uses a dedicated fake db (access_codes +
// navigator_paid_sessions only - no payments table needed here) rather than the
// payments-focused createFakeDb() above, to keep the two concerns independently testable.
function createAccessCodeFakeDb(seedAccessCodes: any[] = []) {
  const accessCodes: any[] = seedAccessCodes.map((c) => ({ used_at: null, ...c }));
  const paidSessions: any[] = [];
  let nextSessionId = 1;
  const networkDelay = () => new Promise((resolve) => setTimeout(resolve, 0));

  return {
    _accessCodes: accessCodes,
    _paidSessions: paidSessions,
    from(table: string) {
      if (table === "access_codes") {
        return {
          select: () => ({
            eq: (field: string, value: any) => ({
              is: (field2: string, _value2: null) => ({
                order: async () => {
                  await networkDelay();
                  const rows = accessCodes.filter((c) => c[field] === value && c[field2] == null);
                  return { data: rows.map((r) => ({ ...r })), error: null };
                },
              }),
            }),
          }),
          update: (patch: Record<string, any>) => ({
            eq: (field: string, value: any) => ({
              is: (field2: string, _value2: null) => ({
                select: async () => {
                  await networkDelay();
                  const idx = accessCodes.findIndex((c) => c[field] === value && c[field2] == null);
                  if (idx === -1) return { data: [], error: null };
                  accessCodes[idx] = { ...accessCodes[idx], ...patch };
                  return { data: [{ id: accessCodes[idx].id }], error: null };
                },
              }),
            }),
          }),
        };
      }
      if (table === "navigator_paid_sessions") {
        return {
          insert: (row: Record<string, any>) => ({
            select: () => ({
              single: async () => {
                await networkDelay();
                // Mirrors the migration's UNIQUE(access_code_id) constraint (multiple NULLs
                // allowed, same as real Postgres).
                if (row.access_code_id != null && paidSessions.some((s) => s.access_code_id === row.access_code_id)) {
                  return { data: null, error: { message: "duplicate key value violates unique constraint", code: "23505" } };
                }
                const id = `session-${nextSessionId++}`;
                const newRow: any = { revoked_at: null, revocation_reason: null, issued_at: new Date().toISOString(), ...row, id };
                paidSessions.push(newRow);
                return { data: { id: newRow.id, expires_at: newRow.expires_at }, error: null };
              },
            }),
          }),
          select: () => ({
            eq: (field: string, value: any) => ({
              maybeSingle: async () => {
                await networkDelay();
                const row = paidSessions.find((s) => s[field] === value);
                return { data: row ? { ...row } : null, error: null };
              },
            }),
          }),
          update: (patch: Record<string, any>) => ({
            eq: (field: string, value: any) => ({
              is: (field2: string, _value2: null) => ({
                select: async () => {
                  await networkDelay();
                  const matches = paidSessions.filter((s) => s[field] === value && s[field2] == null);
                  matches.forEach((m) => Object.assign(m, patch));
                  return { data: matches.map((m) => ({ id: m.id })), error: null };
                },
              }),
            }),
          }),
        };
      }
      throw new Error(`Unexpected table in test double: ${table}`);
    },
  };
}

function useAccessCodeFakeDb(db: ReturnType<typeof createAccessCodeFakeDb>) {
  currentDb.ref = db as unknown as FakeDb;
}

const IDENTITY = { uid: "firebase-uid-1", email: "parent@example.com" };

describe("verifyAccessCode", () => {
  it("creates a paid session bound to the verified Firebase uid, not the submitted email", async () => {
    const db = createAccessCodeFakeDb([
      { id: "code-1", email: "parent@example.com", tier: "Pro", code_hash: hashCodeForTest("AAAA-BBBB"), expires_at: null },
    ]);
    useAccessCodeFakeDb(db);

    // A different email is submitted than the Firebase identity's own - the resulting session
    // must still be bound to the verified uid, and its email column to the identity's email,
    // not this submitted lookup string.
    const result = await verifyAccessCode(IDENTITY, "parent@example.com", "AAAA-BBBB");

    expect(result.tier).toBe("Pro");
    expect(db._paidSessions).toHaveLength(1);
    expect(db._paidSessions[0].firebase_uid).toBe("firebase-uid-1");
    expect(db._paidSessions[0].email).toBe("parent@example.com"); // from identity.email
    expect(db._paidSessions[0].access_code_id).toBe("code-1");
    expect(db._accessCodes[0].used_at).not.toBeNull();
  });

  it("still creates a session when the Firebase identity has no email (email is nullable)", async () => {
    const db = createAccessCodeFakeDb([
      { id: "code-2", email: "noemail@example.com", tier: "Premium", code_hash: hashCodeForTest("CCCC-DDDD"), expires_at: null },
    ]);
    useAccessCodeFakeDb(db);

    const result = await verifyAccessCode({ uid: "uid-no-email", email: null }, "noemail@example.com", "CCCC-DDDD");

    expect(result.tier).toBe("Premium");
    expect(db._paidSessions[0].firebase_uid).toBe("uid-no-email");
    expect(db._paidSessions[0].email).toBeNull();
  });

  it("issues a token containing only jti/exp, never email or tier", async () => {
    process.env.SESSION_SECRET = "test-session-secret";
    const db = createAccessCodeFakeDb([
      { id: "code-3", email: "parent@example.com", tier: "Pro", code_hash: hashCodeForTest("EEEE-FFFF"), expires_at: null },
    ]);
    useAccessCodeFakeDb(db);

    const result = await verifyAccessCode(IDENTITY, "parent@example.com", "EEEE-FFFF");
    const [payload] = result.token.split(".");
    const decoded = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));

    expect(Object.keys(decoded).sort()).toEqual(["exp", "jti"]);
    expect(decoded.jti).toBe(db._paidSessions[0].id);
  });

  it("rejects an invalid code", async () => {
    const db = createAccessCodeFakeDb([
      { id: "code-4", email: "parent@example.com", tier: "Pro", code_hash: hashCodeForTest("REAL-CODE"), expires_at: null },
    ]);
    useAccessCodeFakeDb(db);

    await expect(verifyAccessCode(IDENTITY, "parent@example.com", "WRONG-CODE")).rejects.toThrow("Invalid email or code.");
    expect(db._paidSessions).toHaveLength(0);
  });

  it("rejects an already-used code and creates no session", async () => {
    const db = createAccessCodeFakeDb([
      { id: "code-5", email: "parent@example.com", tier: "Pro", code_hash: hashCodeForTest("USED-CODE"), expires_at: null, used_at: "2026-01-01T00:00:00.000Z" },
    ]);
    useAccessCodeFakeDb(db);

    await expect(verifyAccessCode(IDENTITY, "parent@example.com", "USED-CODE")).rejects.toThrow("Invalid email or code.");
    expect(db._paidSessions).toHaveLength(0);
  });

  it("rejects an expired code and creates no session", async () => {
    const db = createAccessCodeFakeDb([
      {
        id: "code-6",
        email: "parent@example.com",
        tier: "Pro",
        code_hash: hashCodeForTest("EXPIRED1"),
        expires_at: new Date(Date.now() - 1000).toISOString(),
      },
    ]);
    useAccessCodeFakeDb(db);

    await expect(verifyAccessCode(IDENTITY, "parent@example.com", "EXPIRED1")).rejects.toThrow("expired");
    expect(db._paidSessions).toHaveLength(0);
  });

  // The actual point of this test: closes the TOCTOU race a prior audit identified in the old
  // `UPDATE ... WHERE id = ?` (unconditioned on used_at). Two near-simultaneous redemptions of
  // the SAME code must never both succeed - exactly one session may ever be created.
  it("never lets two concurrent redemptions of the same code both succeed", async () => {
    const db = createAccessCodeFakeDb([
      { id: "code-race", email: "parent@example.com", tier: "Pro", code_hash: hashCodeForTest("RACE-CODE"), expires_at: null },
    ]);
    useAccessCodeFakeDb(db);

    const results = await Promise.allSettled([
      verifyAccessCode(IDENTITY, "parent@example.com", "RACE-CODE"),
      verifyAccessCode(IDENTITY, "parent@example.com", "RACE-CODE"),
    ]);

    const fulfilled = results.filter((r) => r.status === "fulfilled");
    const rejected = results.filter((r) => r.status === "rejected");

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason.message).toContain("already redeemed by a concurrent request");
    // The real point: exactly one session row, never two, regardless of the race.
    expect(db._paidSessions).toHaveLength(1);
  });
});

describe("createPaidSession / getActivePaidSession", () => {
  it("creates a session with an explicit expiry and it is immediately active", async () => {
    const db = createAccessCodeFakeDb();
    useAccessCodeFakeDb(db);

    const created = await createPaidSession({ firebaseUid: "uid-1", email: "a@b.com", tier: "Pro", accessCodeId: "code-1" });
    const active = await getActivePaidSession(created.id);

    expect(active).toEqual({ id: created.id, firebaseUid: "uid-1", tier: "Pro" });
  });

  it("returns null for a nonexistent session id (forged/garbage jti)", async () => {
    const db = createAccessCodeFakeDb();
    useAccessCodeFakeDb(db);

    expect(await getActivePaidSession("no-such-session")).toBeNull();
  });

  it("returns null once a session has been revoked", async () => {
    const db = createAccessCodeFakeDb();
    useAccessCodeFakeDb(db);

    const created = await createPaidSession({ firebaseUid: "uid-1", email: "a@b.com", tier: "Pro", accessCodeId: "code-1" });
    await revokeSession(created.id, "refund issued");

    expect(await getActivePaidSession(created.id)).toBeNull();
  });

  it("returns null once a session's database expires_at has passed, independent of any token", async () => {
    const db = createAccessCodeFakeDb();
    useAccessCodeFakeDb(db);

    const created = await createPaidSession({ firebaseUid: "uid-1", email: "a@b.com", tier: "Pro", accessCodeId: "code-1", ttlHours: -1 });

    expect(await getActivePaidSession(created.id)).toBeNull();
  });

  it("reflects a changed tier as authoritative (the database, not the token, decides)", async () => {
    const db = createAccessCodeFakeDb();
    useAccessCodeFakeDb(db);

    const created = await createPaidSession({ firebaseUid: "uid-1", email: "a@b.com", tier: "Pro", accessCodeId: "code-1" });
    const row = db._paidSessions.find((s: any) => s.id === created.id);
    row.tier = "Premium"; // simulates an admin/support change made directly against the row

    const active = await getActivePaidSession(created.id);
    expect(active?.tier).toBe("Premium");
  });

  it("rejects two sessions for the same access_code_id (UNIQUE backstop)", async () => {
    const db = createAccessCodeFakeDb();
    useAccessCodeFakeDb(db);

    await createPaidSession({ firebaseUid: "uid-1", email: "a@b.com", tier: "Pro", accessCodeId: "shared-code" });

    await expect(
      createPaidSession({ firebaseUid: "uid-2", email: "b@b.com", tier: "Pro", accessCodeId: "shared-code" })
    ).rejects.toMatchObject({ statusCode: 409 });
  });
});

describe("revocation", () => {
  it("revokes a single session by id and leaves other sessions untouched", async () => {
    const db = createAccessCodeFakeDb();
    useAccessCodeFakeDb(db);

    const sessionA = await createPaidSession({ firebaseUid: "uid-1", email: "a@b.com", tier: "Pro", accessCodeId: "code-a" });
    const sessionB = await createPaidSession({ firebaseUid: "uid-1", email: "a@b.com", tier: "Pro", accessCodeId: "code-b" });

    const revoked = await revokeSession(sessionA.id, "requested by user");

    expect(revoked).toBe(true);
    expect(await getActivePaidSession(sessionA.id)).toBeNull();
    expect(await getActivePaidSession(sessionB.id)).not.toBeNull();
  });

  it("returns false when revoking an already-revoked or nonexistent session", async () => {
    const db = createAccessCodeFakeDb();
    useAccessCodeFakeDb(db);

    const session = await createPaidSession({ firebaseUid: "uid-1", email: "a@b.com", tier: "Pro", accessCodeId: "code-a" });
    await revokeSession(session.id);

    expect(await revokeSession(session.id)).toBe(false);
    expect(await revokeSession("no-such-session")).toBe(false);
  });

  it("revokes every active session for a Firebase uid and leaves another user's sessions unaffected", async () => {
    const db = createAccessCodeFakeDb();
    useAccessCodeFakeDb(db);

    const userASessionA = await createPaidSession({ firebaseUid: "uid-A", email: "a@b.com", tier: "Pro", accessCodeId: "code-a1" });
    const userASessionB = await createPaidSession({ firebaseUid: "uid-A", email: "a@b.com", tier: "Premium", accessCodeId: "code-a2" });
    const userBSession = await createPaidSession({ firebaseUid: "uid-B", email: "b@b.com", tier: "Pro", accessCodeId: "code-b1" });

    const count = await revokeAllSessionsForUid("uid-A", "abuse report");

    expect(count).toBe(2);
    expect(await getActivePaidSession(userASessionA.id)).toBeNull();
    expect(await getActivePaidSession(userASessionB.id)).toBeNull();
    // The unrelated user's session must remain completely unaffected.
    expect(await getActivePaidSession(userBSession.id)).not.toBeNull();
  });
});
