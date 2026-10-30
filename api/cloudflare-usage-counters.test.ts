import { afterEach, describe, expect, it, vi } from "vitest";
import { normalizeCreditBalance, creditPillLabel } from "../src/utils/creditBalance";

const verify = vi.fn();
const readSession = vi.fn();
vi.mock("../functions/api/_auth-check", () => ({ verifyFirebaseRequest: (...a: unknown[]) => verify(...a) }));
vi.mock("../functions/api/_supabase-paid-session", () => ({ readVerifiedPaidSession: (...a: unknown[]) => readSession(...a) }));
const { onRequestGet } = await import("../functions/api/analyzer-usage");

const ENV = { FIREBASE_PROJECT_ID: "p", STAGING_SUPABASE_URL: "https://staging.example.supabase.co", STAGING_SUPABASE_SERVICE_ROLE_KEY: "svc" };
const counters = (rows: Record<string, number>) =>
  vi.fn(async (url: string) => {
    const key = decodeURIComponent(new URL(url).searchParams.get("uid")!.slice(3));
    return new Response(JSON.stringify(key in rows ? [{ analyses_used: rows[key] }] : []), { status: 200 });
  });
const get = (headers: Record<string, string> = {}) => onRequestGet({ request: new Request("https://s/api/analyzer-usage", { headers: { Authorization: "Bearer a.b.c", ...headers } }), env: ENV });

describe("GET /api/analyzer-usage reads the counters reservation enforces", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    verify.mockReset();
    readSession.mockReset();
  });

  it("free account: remaining = 3 - used, from the uid's counter row (was always 3)", async () => {
    verify.mockResolvedValue({ status: "verified", uid: "user-abc", email: null, emailVerified: false });
    vi.stubGlobal("fetch", counters({ "user-abc": 2 }));
    const b = await (await get()).json();
    expect(b).toMatchObject({ type: "free", creditsLimit: 3, creditsRemaining: 1, creditsUsed: 2, remaining: 1, countsAvailable: true });
  });

  it("free account with no usage yet has its full allowance", async () => {
    verify.mockResolvedValue({ status: "verified", uid: "new-user", email: null, emailVerified: false });
    vi.stubGlobal("fetch", counters({}));
    expect(await (await get()).json()).toMatchObject({ creditsRemaining: 3, creditsUsed: 0 });
  });

  it("reports unknown, not a full allowance, when the counter cannot be read", async () => {
    verify.mockResolvedValue({ status: "verified", uid: "user-abc", email: null, emailVerified: false });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("err", { status: 500 })));
    expect(await (await get()).json()).toMatchObject({ creditsRemaining: null, countsAvailable: false });
  });

  it("one-time paid tier: shared total counter and the reservation's limit", async () => {
    verify.mockResolvedValue({ status: "verified", uid: "u", email: null, emailVerified: false });
    const id = "11111111-1111-4111-8111-111111111111";
    readSession.mockResolvedValue({ status: "verified", session: { sessionId: id, tier: "Premium", issuedAt: "2026-10-01T00:00:00Z", ownerUid: "u" } });
    vi.stubGlobal("fetch", counters({ [`paid_session_${id}_total`]: 4 }));
    expect(await (await get({ "x-ps-session": id })).json()).toMatchObject({ type: "paid", tier: "Premium", creditsLimit: 5, creditsRemaining: 1, forensicAnalysesRemaining: 1 });
  });

  it("monthly tier: Forensic period counter; Quick Reviews uncounted", async () => {
    verify.mockResolvedValue({ status: "verified", uid: "u", email: null, emailVerified: false });
    const id = "22222222-2222-4222-8222-222222222222";
    const issuedAt = new Date(Date.now() - 3 * 86_400_000).toISOString();
    readSession.mockResolvedValue({ status: "verified", session: { sessionId: id, tier: "Community10", issuedAt, ownerUid: "u" } });
    const f = counters({});
    vi.stubGlobal("fetch", f);
    const b = await (await get({ "x-ps-session": id })).json();
    expect(b).toMatchObject({ type: "paid", isMonthly: true, creditsLimit: 5, creditsRemaining: 5, quickReviewsRemaining: null });
    expect(decodeURIComponent(String((f.mock.calls[0] as any)[0]))).toContain(`paid_session_${id}_period_${issuedAt.slice(0, 10)}`);
  });
});

describe("credit pill", () => {
  it("shows the numbers for both response shapes (free accounts used to show none)", () => {
    expect(creditPillLabel(normalizeCreditBalance({ type: "free", tier: "Free", limit: 3, remaining: 2 })!)).toBe("Free Account: 2 of 3 analyses remaining");
    expect(creditPillLabel(normalizeCreditBalance({ tier: "Pro", creditsLimit: 5, creditsRemaining: 4 })!)).toBe("Pro: 4 of 5 analyses remaining");
    expect(creditPillLabel(normalizeCreditBalance({ tier: "Free", remaining: null, limit: 3 })!)).toBe("Free Account");
  });
});
