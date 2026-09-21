// Tests the real verifyFirebaseToken() implementation (not mocked, unlike
// api/_server.test.ts, which stubs this whole module out) against a fake
// firebase-admin double — same pattern as access.test.ts/cases.test.ts: mock
// the external SDK packages, not this module, so the actual verification
// logic (including the checkRevoked fix below) runs for real.
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ project_id: "test-project" });

const currentVerify: { impl: ((idToken: string, checkRevoked?: boolean) => Promise<any>) | null } = vi.hoisted(() => ({ impl: null }));

vi.mock("firebase-admin/app", () => ({
  initializeApp: () => ({}),
  cert: (serviceAccount: any) => serviceAccount,
  getApps: () => [],
}));

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    verifyIdToken: (idToken: string, checkRevoked?: boolean) => currentVerify.impl!(idToken, checkRevoked),
  }),
}));

const { verifyFirebaseToken } = await import("./firebaseAdmin.js");

beforeEach(() => {
  currentVerify.impl = null;
});

describe("verifyFirebaseToken", () => {
  it("returns null when the Authorization header is missing", async () => {
    expect(await verifyFirebaseToken(undefined)).toBeNull();
  });

  it("returns null when the header is not a Bearer token", async () => {
    expect(await verifyFirebaseToken("Basic abc123")).toBeNull();
  });

  it("authenticates a normally valid Firebase token, and enables revocation checking", async () => {
    let receivedCheckRevoked: boolean | undefined;
    currentVerify.impl = async (idToken, checkRevoked) => {
      receivedCheckRevoked = checkRevoked;
      return { uid: "valid-uid", email: "parent@example.com" };
    };

    const result = await verifyFirebaseToken("Bearer valid-token");

    expect(result).toEqual({ uid: "valid-uid", email: "parent@example.com" });
    // The actual fix: verifyIdToken() must be called with checkRevoked=true,
    // otherwise a disabled/revoked identity would keep authenticating until
    // its token's own natural expiry.
    expect(receivedCheckRevoked).toBe(true);
  });

  it("rejects a revoked Firebase token the same way as any other invalid token", async () => {
    currentVerify.impl = async () => {
      throw Object.assign(new Error("Firebase ID token has been revoked."), { code: "auth/id-token-revoked" });
    };

    expect(await verifyFirebaseToken("Bearer revoked-token")).toBeNull();
  });

  it("rejects a token belonging to a disabled Firebase user", async () => {
    currentVerify.impl = async () => {
      throw Object.assign(new Error("The user record has been disabled."), { code: "auth/user-disabled" });
    };

    expect(await verifyFirebaseToken("Bearer disabled-user-token")).toBeNull();
  });

  it("still rejects an expired token", async () => {
    currentVerify.impl = async () => {
      throw Object.assign(new Error("Firebase ID token has expired."), { code: "auth/id-token-expired" });
    };

    expect(await verifyFirebaseToken("Bearer expired-token")).toBeNull();
  });

  it("still rejects a malformed/invalid token", async () => {
    currentVerify.impl = async () => {
      throw new Error("Decoding Firebase ID token failed.");
    };

    expect(await verifyFirebaseToken("Bearer garbage")).toBeNull();
  });
});
