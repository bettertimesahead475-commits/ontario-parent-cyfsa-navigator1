// Stage 10 slice 7: verifyFirebaseIdentity() -- the only source of the email and email_verified
// claims used by recipient-bound acceptance. Same fake firebase-admin double as firebaseAdmin.test.ts,
// so the real header parsing and checkRevoked handling run.
import { beforeEach, describe, expect, it, vi } from "vitest";

process.env.FIREBASE_SERVICE_ACCOUNT_JSON = JSON.stringify({ project_id: "test-project" });

const currentVerify: { impl: ((idToken: string, checkRevoked?: boolean) => Promise<any>) | null; calls: Array<[string, boolean | undefined]> } =
  vi.hoisted(() => ({ impl: null, calls: [] }));

vi.mock("firebase-admin/app", () => ({
  initializeApp: () => ({}),
  cert: (serviceAccount: any) => serviceAccount,
  getApps: () => [],
}));

vi.mock("firebase-admin/auth", () => ({
  getAuth: () => ({
    verifyIdToken: (idToken: string, checkRevoked?: boolean) => {
      currentVerify.calls.push([idToken, checkRevoked]);
      return currentVerify.impl!(idToken, checkRevoked);
    },
  }),
}));

const { verifyFirebaseIdentity, verifyFirebaseToken } = await import("./firebaseAdmin.js");

beforeEach(() => {
  currentVerify.impl = null;
  currentVerify.calls = [];
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("verifyFirebaseIdentity", () => {
  it("returns the verified email and email_verified=true from the verified token, with revocation checking", async () => {
    currentVerify.impl = async () => ({ uid: "u1", email: "Pro@Example.test", email_verified: true });
    expect(await verifyFirebaseIdentity("Bearer tok")).toEqual({ uid: "u1", email: "Pro@Example.test", emailVerified: true });
    expect(currentVerify.calls).toEqual([["tok", true]]);
  });

  it("reports emailVerified=false when the claim is false", async () => {
    currentVerify.impl = async () => ({ uid: "u1", email: "pro@example.test", email_verified: false });
    expect(await verifyFirebaseIdentity("Bearer tok")).toEqual({ uid: "u1", email: "pro@example.test", emailVerified: false });
  });

  it.each([
    ["absent", undefined], ["the string 'true'", "true"], ["the number 1", 1], ["null", null], ["an object", {}],
  ])("treats an email_verified claim that is %s as NOT verified (only boolean true counts)", async (_l, claim) => {
    currentVerify.impl = async () => ({ uid: "u1", email: "pro@example.test", email_verified: claim });
    expect((await verifyFirebaseIdentity("Bearer tok"))!.emailVerified).toBe(false);
  });

  it.each([["absent", undefined], ["empty", ""], ["not a string", 42]])("reports email=null when the email claim is %s", async (_l, email) => {
    currentVerify.impl = async () => ({ uid: "u1", email, email_verified: true });
    expect(await verifyFirebaseIdentity("Bearer tok")).toEqual({ uid: "u1", email: null, emailVerified: true });
  });

  it.each([[undefined], [""], ["Basic abc"], ["Bearer "], ["Bearer    "], ["bearer tok"]])(
    "returns null without calling Firebase for header %j", async header => {
      currentVerify.impl = async () => ({ uid: "u1", email: "pro@example.test", email_verified: true });
      expect(await verifyFirebaseIdentity(header as any)).toBeNull();
      expect(currentVerify.calls).toEqual([]);
    });

  it("returns null for an invalid or revoked token", async () => {
    currentVerify.impl = async () => { throw Object.assign(new Error("revoked"), { code: "auth/id-token-revoked" }); };
    expect(await verifyFirebaseIdentity("Bearer tok")).toBeNull();
  });

  it("verifyFirebaseToken keeps its frozen shape: uid and email only, no emailVerified", async () => {
    currentVerify.impl = async () => ({ uid: "u1", email: "pro@example.test", email_verified: true });
    const r = await verifyFirebaseToken("Bearer tok");
    expect(r).toEqual({ uid: "u1", email: "pro@example.test" });
    expect(Object.keys(r!).sort()).toEqual(["email", "uid"]);
  });
});
