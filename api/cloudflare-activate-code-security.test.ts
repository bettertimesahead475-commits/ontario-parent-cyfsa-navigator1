import { afterEach, describe, expect, it, vi } from "vitest";

const verify = vi.fn();
vi.mock("../functions/api/_auth-check", () => ({ verifyFirebaseRequest: (...a: unknown[]) => verify(...a) }));
const { onRequestPost } = await import("../functions/api/activate-code");

const ENV = { FIREBASE_PROJECT_ID: "p", SESSION_SECRET: "s".repeat(32), STAGING_SUPABASE_URL: "https://staging.example.supabase.co", STAGING_SUPABASE_SERVICE_ROLE_KEY: "service-key" };
const post = (body: unknown, env: Record<string, string> = ENV) =>
  onRequestPost({ request: new Request("https://staging.example/api/activate-code", { method: "POST", body: JSON.stringify(body), headers: { Authorization: "Bearer a.b.c" } }), env });
const rpc = (payload: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } }));

describe("POST /api/activate-code (Cloudflare)", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    verify.mockReset();
  });

  it("requires a verified Firebase sign-in and makes no database call without one", async () => {
    verify.mockResolvedValue({ status: "denied" });
    const f = rpc({});
    vi.stubGlobal("fetch", f);
    const r = await post({ code: "ABCD-EFGH", email: "p@example.test" });
    expect(r.status).toBe(401);
    expect(f).not.toHaveBeenCalled();
  });

  it("sends the verified token's UID, never one from the request body", async () => {
    verify.mockResolvedValue({ status: "verified", uid: "verified-uid", email: "p@example.test", emailVerified: true });
    const f = rpc({ status: "activated", session_id: "11111111-1111-4111-8111-111111111111", tier: "Pro", expires_at: new Date(Date.now() + 86_400_000).toISOString() });
    vi.stubGlobal("fetch", f);
    const r = await post({ code: " abcd-efgh ", email: " P@Example.test ", uid: "attacker-uid", p_firebase_uid: "attacker-uid" });
    expect(r.status).toBe(200);
    const sent = JSON.parse((f.mock.calls[0] as any)[1].body);
    expect(sent).toEqual({ p_firebase_uid: "verified-uid", p_code: "ABCD-EFGH", p_email: "p@example.test" });
    const body = await r.json();
    expect(body).toMatchObject({ success: true, tier: "Pro" });
    expect(body.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("never shows RPC or database text to the customer", async () => {
    verify.mockResolvedValue({ status: "verified", uid: "u", email: null, emailVerified: false });
    vi.stubGlobal("fetch", rpc({ status: "error", error: 'relation "navigator_paid_sessions" violates check constraint', code: "23514" }));
    const r = await post({ code: "ABCD-EFGH", email: "p@example.test" });
    expect(r.status).toBe(500);
    const text = await r.text();
    expect(text).not.toMatch(/relation|constraint|23514/);
    for (const [status, http] of [["invalid", 401], ["expired", 401], ["consumed", 409], ["denied", 400]] as const) {
      vi.stubGlobal("fetch", rpc({ status, error: "SECRET DB DETAIL", code: "X" }));
      const res = await post({ code: "ABCD-EFGH", email: "p@example.test" });
      expect(res.status).toBe(http);
      expect(await res.text()).not.toContain("SECRET DB DETAIL");
    }
  });

  it("fails closed when the database function is missing or errors", async () => {
    verify.mockResolvedValue({ status: "verified", uid: "u", email: null, emailVerified: false });
    vi.stubGlobal("fetch", rpc({ message: "Could not find the function" }, 404));
    expect((await post({ code: "ABCD-EFGH", email: "p@example.test" })).status).toBe(503);
    vi.stubGlobal("fetch", rpc({ message: "simulated failure", code: "P0001" }, 400));
    const r = await post({ code: "ABCD-EFGH", email: "p@example.test" });
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain("simulated failure");
  });
});
