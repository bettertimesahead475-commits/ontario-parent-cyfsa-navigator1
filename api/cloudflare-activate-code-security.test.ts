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
    const rpcCall = f.mock.calls.find((c: any) => String(c[0]).includes("redeem_access_code_atomic")) as any;
    const sent = JSON.parse(rpcCall[1].body);
    expect(sent).toEqual({ p_firebase_uid: "verified-uid", p_code: "ABCD-EFGH", p_email: "p@example.test" });
    const body = await r.json();
    expect(body).toMatchObject({ success: true, tier: "Pro" });
    expect(body.token).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  });

  it("never shows RPC or database text to the customer", async () => {
    // The signed-in verified email matches the code email, so these tests exercise RPC error handling only.
    verify.mockResolvedValue({ status: "verified", uid: "u", email: "p@example.test", emailVerified: true });
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
    // The signed-in verified email matches the code email, so these tests exercise RPC error handling only.
    verify.mockResolvedValue({ status: "verified", uid: "u", email: "p@example.test", emailVerified: true });
    // The purchase lookup succeeds (bound to the signed-in email); only the redemption function fails.
    const rpcOnly = (payload: unknown, status: number) => vi.fn(async (url: string) => String(url).includes("/rest/v1/access_codes")
      ? new Response(JSON.stringify([{ email: "p@example.test", reference_number: "PS-TESTREF1" }]), { status: 200, headers: { "content-type": "application/json" } })
      : new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } }));
    vi.stubGlobal("fetch", rpcOnly({ message: "Could not find the function" }, 404));
    expect((await post({ code: "ABCD-EFGH", email: "p@example.test" })).status).toBe(503);
    vi.stubGlobal("fetch", rpcOnly({ message: "simulated failure", code: "P0001" }, 400));
    const r = await post({ code: "ABCD-EFGH", email: "p@example.test" });
    expect(r.status).toBe(500);
    expect(await r.text()).not.toContain("simulated failure");
  });
});

describe("access code purchase binding (security review finding 4)", () => {
  afterEach(() => { vi.unstubAllGlobals(); verify.mockReset(); });
  const activated = { status: "activated", session_id: "11111111-1111-4111-8111-111111111111", tier: "Premium", expires_at: new Date(Date.now() + 86_400_000).toISOString() };
  const route = (purchase: unknown, lookupStatus = 200) => vi.fn(async (url: string) => {
    if (String(url).includes("/rest/v1/access_codes")) return new Response(JSON.stringify(purchase), { status: lookupStatus, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify(activated), { status: 200, headers: { "content-type": "application/json" } });
  });
  const calledRpc = (f: ReturnType<typeof vi.fn>) => f.mock.calls.some(([u]) => String(u).includes("redeem_access_code_atomic"));

  it("redeems without a reference when the verified sign-in email matches the code email (ownership is still read first)", async () => {
    verify.mockResolvedValue({ status: "verified", uid: "u1", email: "buyer@example.test", emailVerified: true });
    const f = route([{ email: "buyer@example.test", reference_number: "CYF-7K2M" }]); vi.stubGlobal("fetch", f);
    expect((await post({ code: "ABCD-EFGH", email: "buyer@example.test" })).status).toBe(200);
    expect(f.mock.calls.some(([u]) => String(u).includes("/rest/v1/access_codes"))).toBe(true);
    expect(calledRpc(f)).toBe(true);
  });

  it("asks for the payment reference when the code email differs from the signed-in email", async () => {
    verify.mockResolvedValue({ status: "verified", uid: "u1", email: "other@example.test", emailVerified: true });
    const f = route([]); vi.stubGlobal("fetch", f);
    const r = await post({ code: "ABCD-EFGH", email: "buyer@example.test" });
    expect(r.status).toBe(403);
    expect(await r.json()).toMatchObject({ code: "PURCHASE_REFERENCE_REQUIRED" });
    expect(calledRpc(f)).toBe(false);
  });

  it("redeems a legitimate purchase made with a different email when the reference matches", async () => {
    verify.mockResolvedValue({ status: "verified", uid: "u1", email: "other@example.test", emailVerified: true });
    const f = route([{ email: "buyer@example.test", reference_number: "CYF-7K2M" }]); vi.stubGlobal("fetch", f);
    const r = await post({ code: "ABCD-EFGH", email: "buyer@example.test", referenceNumber: " cyf-7k2m " });
    expect(r.status).toBe(200);
    expect(calledRpc(f)).toBe(true);
  });

  it("refuses an intercepted code with a wrong reference using the generic answer", async () => {
    verify.mockResolvedValue({ status: "verified", uid: "attacker", email: "attacker@example.test", emailVerified: true });
    const f = route([{ email: "buyer@example.test", reference_number: "CYF-7K2M" }]); vi.stubGlobal("fetch", f);
    const r = await post({ code: "ABCD-EFGH", email: "buyer@example.test", referenceNumber: "CYF-0000" });
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "Invalid email or code." });
    expect(calledRpc(f)).toBe(false);
  });

  it("treats an unverified sign-in email as different, and fails closed if the purchase lookup is down", async () => {
    verify.mockResolvedValue({ status: "verified", uid: "u1", email: "buyer@example.test", emailVerified: false });
    // Ownership is read first, so an outage fails closed (503) whether or not a reference was sent.
    const down = route({}, 503); vi.stubGlobal("fetch", down);
    expect((await post({ code: "ABCD-EFGH", email: "buyer@example.test" })).status).toBe(503);
    const r = await post({ code: "ABCD-EFGH", email: "buyer@example.test", referenceNumber: "CYF-7K2M" });
    expect(r.status).toBe(503);
    expect(calledRpc(down)).toBe(false);
  });
});
