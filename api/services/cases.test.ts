// Tests the real createCase() implementation (not mocked, unlike
// api/_server.test.ts, which stubs this whole module out) against a fake
// in-memory Supabase double — same pattern as access.test.ts, for the same
// reason: this exercises the actual atomicity/ownership logic, not a mock
// of it.
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.SUPABASE_URL = "https://example.supabase.co";
process.env.SUPABASE_SERVICE_ROLE_KEY = "test-service-role-key";

// Same technique as access.test.ts: mock the @supabase/supabase-js package
// itself (not access.js), so getSupabase()'s real memoization still runs,
// and swap in a fresh fake db per test via `currentDb.ref`.
const currentDb: { ref: FakeDb | null } = vi.hoisted(() => ({ ref: null }));
vi.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    rpc: (fn: string, args: any) => currentDb.ref!.rpc(fn, args),
  }),
}));

const { createCase } = await import("./cases.js");

type FakeDb = ReturnType<typeof createFakeDb>;

// Mirrors what create_case_with_owner() actually does in Postgres: one call
// either produces a case row AND exactly one case_members OWNER row, or
// (on a simulated failure) produces neither — there is no in-between state,
// which is the entire point of doing this as one Postgres function instead
// of two separate client-issued INSERTs.
function createFakeDb(options: { failOnMembershipInsert?: boolean } = {}) {
  const cases: any[] = [];
  const members: any[] = [];

  return {
    _cases: cases,
    _members: members,
    rpc: async (fn: string, args: any) => {
      if (fn !== "create_case_with_owner") {
        throw new Error(`Unexpected rpc call in test double: ${fn}`);
      }
      if (options.failOnMembershipInsert) {
        // Simulates the membership INSERT failing inside the Postgres
        // function — the whole transaction rolls back, so nothing is
        // returned and nothing is left in either table.
        return { data: null, error: { message: "simulated membership insert failure" } };
      }
      const newCase = {
        id: `case-${cases.length + 1}`,
        owner_uid: args.p_owner_uid,
        title: args.p_title,
        description: null,
        created_at: "2026-01-01T00:00:00.000Z",
        updated_at: "2026-01-01T00:00:00.000Z",
      };
      cases.push(newCase);
      members.push({ case_id: newCase.id, firebase_uid: args.p_owner_uid, role: "OWNER" });
      return { data: newCase, error: null };
    },
  };
}

function useFakeDb(db: FakeDb) {
  currentDb.ref = db;
}

beforeEach(() => {
  currentDb.ref = null;
});

describe("createCase", () => {
  it("creates a case owned by the given uid and its OWNER membership, atomically", async () => {
    const db = createFakeDb();
    useFakeDb(db);

    const result = await createCase("firebase-uid-1", "My CYFSA Case");

    expect(result.ownerUid).toBe("firebase-uid-1");
    expect(result.title).toBe("My CYFSA Case");
    expect(db._cases).toHaveLength(1);
    expect(db._members).toHaveLength(1);
    expect(db._members[0]).toEqual({ case_id: result.id, firebase_uid: "firebase-uid-1", role: "OWNER" });
  });

  it("never leaves an orphaned case if the underlying transaction fails", async () => {
    const db = createFakeDb({ failOnMembershipInsert: true });
    useFakeDb(db);

    await expect(createCase("firebase-uid-2", "Should Not Exist")).rejects.toThrow("Failed to create case");

    // The real point of this test: because the whole operation is one
    // Postgres function call, a simulated failure leaves NEITHER row behind
    // — never a case with no owner.
    expect(db._cases).toHaveLength(0);
    expect(db._members).toHaveLength(0);
  });

  it("maps the returned row's snake_case fields to the Case interface's camelCase fields", async () => {
    const db = createFakeDb();
    useFakeDb(db);

    const result = await createCase("firebase-uid-3", "Field Mapping Check");

    expect(result).toEqual({
      id: expect.any(String),
      ownerUid: "firebase-uid-3",
      title: "Field Mapping Check",
      description: null,
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });
});
