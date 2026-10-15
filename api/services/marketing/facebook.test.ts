// Facebook Page connection tests. Meta's Graph API is mocked with fetch stubs,
// the Supabase-backed connection store is mocked, and no real Facebook account
// or token is used. Covered: encryption, signed OAuth state, the authorization
// URL, the callback (including rejection paths), the owner's Page selection,
// admin gating, adapter credential use, expired-token handling, and the rule
// that no token is ever returned to a caller.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import express from "express";
import { randomBytes } from "node:crypto";

process.env.ADMIN_SECRET = "test-admin-secret";
process.env.META_APP_ID = "1234567890";
process.env.META_APP_SECRET = "meta-app-secret-for-tests";
process.env.APP_PUBLIC_URL = "https://cyfsanavigator.com";
process.env.MARKETING_TOKEN_ENCRYPTION_KEY = randomBytes(32).toString("base64");
for (const k of ["FACEBOOK_PAGE_ID", "FACEBOOK_PAGE_ACCESS_TOKEN"]) delete process.env[k];

const conn = vi.hoisted(() => ({
  getFacebookConnectionView: vi.fn(),
  savePendingPages: vi.fn(),
  selectPendingPage: vi.fn(),
  disconnectFacebook: vi.fn(),
  loadFacebookCredentials: vi.fn(),
  markFacebookExpired: vi.fn(async () => undefined),
}));
vi.mock("./connections.js", () => conn);
vi.mock("./ai.js", () => ({ generateMarketingPosts: vi.fn() }));
vi.mock("./scheduler.js", () => ({ runScheduler: vi.fn(), refreshAllChannelStates: vi.fn() }));
vi.mock("./publisher.js", () => ({ publishPost: vi.fn(), refreshMetricsFor: vi.fn() }));
vi.mock("./store.js", async (importOriginal) => ({
  ...(await importOriginal<any>()),
  logAgentAction: vi.fn().mockResolvedValue(undefined),
  upsertChannelState: vi.fn().mockResolvedValue(undefined),
}));

const { marketingRouter } = await import("./routes.js");
const secrets = await import("./secrets.js");
const { FacebookAdapter } = await import("./adapters/facebook.js");

const ADMIN = { "x-admin-secret": "test-admin-secret" };
const app = express();
app.use(express.json());
app.use("/api/admin/marketing", marketingRouter);

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  fetchSpy = vi.spyOn(globalThis, "fetch");
});
afterEach(() => fetchSpy.mockRestore());

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

describe("encryption of stored Page tokens", () => {
  it("round-trips a token and never stores it in plaintext", () => {
    const cipher = secrets.encryptSecret("EAAB-page-token-value");
    expect(cipher).not.toContain("EAAB-page-token-value");
    expect(cipher.startsWith("v1.")).toBe(true);
    expect(secrets.decryptSecret(cipher)).toBe("EAAB-page-token-value");
  });

  it("uses a fresh IV, so the same token encrypts differently each time", () => {
    expect(secrets.encryptSecret("same")).not.toBe(secrets.encryptSecret("same"));
  });

  it("rejects tampered ciphertext instead of returning garbage", () => {
    const parts = secrets.encryptSecret("token").split(".");
    parts[3] = Buffer.from("tampered").toString("base64url");
    expect(() => secrets.decryptSecret(parts.join("."))).toThrow();
  });

  it("refuses to run without a valid 32-byte key", () => {
    const saved = process.env.MARKETING_TOKEN_ENCRYPTION_KEY;
    process.env.MARKETING_TOKEN_ENCRYPTION_KEY = Buffer.from("too-short").toString("base64");
    expect(() => secrets.encryptSecret("x")).toThrow(/32 bytes/);
    delete process.env.MARKETING_TOKEN_ENCRYPTION_KEY;
    expect(() => secrets.encryptSecret("x")).toThrow(/not configured/);
    process.env.MARKETING_TOKEN_ENCRYPTION_KEY = saved;
  });
});

describe("signed OAuth state", () => {
  it("accepts a state the server just minted", () => {
    expect(secrets.verifyOAuthState(secrets.signOAuthState())).toBe(true);
  });

  it("rejects a forged or altered state", () => {
    const state = secrets.signOAuthState();
    const [body, sig] = state.split(".");
    const forgedBody = Buffer.from(JSON.stringify({ n: "x", t: Date.now() })).toString("base64url");
    expect(secrets.verifyOAuthState(`${forgedBody}.${sig}`)).toBe(false);
    expect(secrets.verifyOAuthState(`${body}.AAAA`)).toBe(false);
    expect(secrets.verifyOAuthState(undefined)).toBe(false);
    expect(secrets.verifyOAuthState("no-dot")).toBe(false);
  });

  it("rejects a state older than ten minutes", () => {
    const issuedAt = Date.now();
    const state = secrets.signOAuthState(issuedAt);
    expect(secrets.verifyOAuthState(state, issuedAt + 9 * 60 * 1000)).toBe(true);
    expect(secrets.verifyOAuthState(state, issuedAt + 11 * 60 * 1000)).toBe(false);
  });
});

describe("connect URL", () => {
  it("requests exactly the three Page scopes and the derived redirect URI, with no secret", async () => {
    const res = await request(app).get("/api/admin/marketing/facebook/connect").set(ADMIN);
    expect(res.status).toBe(200);
    const url = new URL(res.body.authorizationUrl);
    expect(url.hostname).toBe("www.facebook.com");
    expect(url.searchParams.get("scope")).toBe("pages_show_list,pages_manage_posts,pages_read_engagement");
    expect(url.searchParams.get("redirect_uri")).toBe("https://cyfsanavigator.com/api/admin/marketing/facebook/callback");
    expect(url.searchParams.get("client_id")).toBe("1234567890");
    expect(url.searchParams.get("state")).toBeTruthy();
    expect(res.body.authorizationUrl).not.toContain("meta-app-secret-for-tests");
  });

  it("requires the admin secret", async () => {
    expect((await request(app).get("/api/admin/marketing/facebook/connect")).status).toBe(401);
  });
});

describe("OAuth callback", () => {
  const cb = (q: Record<string, string>) => request(app).get("/api/admin/marketing/facebook/callback").query(q);

  it("redirects back with a rejected state and makes no Meta call", async () => {
    const res = await cb({ code: "abc", state: "forged.state" });
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://cyfsanavigator.com/admin/marketing?facebook=invalid_state");
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(conn.savePendingPages).not.toHaveBeenCalled();
  });

  it("reports when the owner denies consent", async () => {
    const res = await cb({ error: "access_denied", state: secrets.signOAuthState() });
    expect(res.headers.location).toMatch(/facebook=denied$/);
  });

  it("exchanges the code, stores only Pages with CREATE_CONTENT, and asks the owner to select", async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "short-user" }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "long-user" }))
      .mockResolvedValueOnce(
        jsonResponse(200, {
          data: [
            { id: "111", name: "CYFSA Navigator", access_token: "page-token-111", tasks: ["CREATE_CONTENT", "MODERATE"] },
            { id: "222", name: "View Only Page", access_token: "page-token-222", tasks: ["ANALYZE"] },
          ],
        })
      );
    const res = await cb({ code: "good-code", state: secrets.signOAuthState() });
    expect(res.headers.location).toBe("https://cyfsanavigator.com/admin/marketing?facebook=select_page");
    const saved = conn.savePendingPages.mock.calls[0][0];
    expect(saved.map((p: any) => p.id)).toEqual(["111"]);
    expect(String(fetchSpy.mock.calls[1][0])).toContain("fb_exchange_token");
  });

  it("reports no_pages when the user manages no Page they can post to", async () => {
    fetchSpy
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "s" }))
      .mockResolvedValueOnce(jsonResponse(200, { access_token: "l" }))
      .mockResolvedValueOnce(jsonResponse(200, { data: [] }));
    const res = await cb({ code: "c", state: secrets.signOAuthState() });
    expect(res.headers.location).toMatch(/facebook=no_pages$/);
    expect(conn.savePendingPages).not.toHaveBeenCalled();
  });

  it("fails closed with a generic result if Meta rejects the exchange", async () => {
    fetchSpy.mockResolvedValueOnce(jsonResponse(400, { error: { message: "Invalid code", code: 100 } }));
    const res = await cb({ code: "bad", state: secrets.signOAuthState() });
    expect(res.headers.location).toMatch(/facebook=failed$/);
    expect(res.headers.location).not.toContain("Invalid code");
  });
});

describe("Page selection and disconnect", () => {
  it("rejects a malformed Page ID before touching storage", async () => {
    const res = await request(app).post("/api/admin/marketing/facebook/select").set(ADMIN).send({ pageId: "1; DROP TABLE" });
    expect(res.status).toBe(400);
    expect(conn.selectPendingPage).not.toHaveBeenCalled();
  });

  it("returns the store's refusal for a Page that was not in the saved list", async () => {
    conn.selectPendingPage.mockRejectedValueOnce(Object.assign(new Error("not in the list"), { statusCode: 400 }));
    const res = await request(app).post("/api/admin/marketing/facebook/select").set(ADMIN).send({ pageId: "999" });
    expect(res.status).toBe(400);
  });

  it("selects a Page and returns only its name and ID", async () => {
    conn.selectPendingPage.mockResolvedValueOnce({ id: "111", name: "CYFSA Navigator" });
    const res = await request(app).post("/api/admin/marketing/facebook/select").set(ADMIN).send({ pageId: "111" });
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ page: { id: "111", name: "CYFSA Navigator" } });
  });

  it("disconnects and returns a token-free status", async () => {
    conn.getFacebookConnectionView.mockResolvedValueOnce({ status: "disconnected", pageId: null, pageName: null, connectedAt: null, lastError: null, pendingPages: [] });
    const res = await request(app).post("/api/admin/marketing/facebook/disconnect").set(ADMIN);
    expect(res.status).toBe(200);
    expect(conn.disconnectFacebook).toHaveBeenCalledTimes(1);
    expect(res.body.connection.status).toBe("disconnected");
  });

  it("gates every Facebook management route behind the admin secret", async () => {
    const base = "/api/admin/marketing/facebook";
    expect((await request(app).get(`${base}/connection`)).status).toBe(401);
    expect((await request(app).post(`${base}/select`).send({ pageId: "1" })).status).toBe(401);
    expect((await request(app).post(`${base}/disconnect`)).status).toBe(401);
  });

  it("never returns a page token from the connection view", async () => {
    conn.getFacebookConnectionView.mockResolvedValueOnce({
      status: "pending_selection",
      pageId: null,
      pageName: null,
      connectedAt: null,
      lastError: null,
      pendingPages: [{ id: "111", name: "CYFSA Navigator" }],
    });
    const res = await request(app).get("/api/admin/marketing/facebook/connection").set(ADMIN);
    expect(res.status).toBe(200);
    expect(JSON.stringify(res.body)).not.toMatch(/accessToken|access_token|page-token/);
  });
});

describe("Facebook adapter uses the connected Page", () => {
  const adapter = new FacebookAdapter();
  const input = { content: "Learn how to organise your CYFSA documents.", hashtags: ["CYFSA"], linkUrl: null, mediaUrl: null };

  it("posts to the connected Page's feed with the stored token", async () => {
    conn.loadFacebookCredentials.mockResolvedValueOnce({ ok: true, pageId: "111", token: "page-token-111" });
    fetchSpy.mockResolvedValueOnce(jsonResponse(200, { id: "111_987" }));
    const out = await adapter.publish(input);
    expect(out.ok).toBe(true);
    expect(out.externalPostId).toBe("111_987");
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toContain("/111/feed");
    expect(String(init.body)).toContain("access_token=page-token-111");
  });

  it("reports an expired token clearly, records it, and does not fabricate success", async () => {
    conn.loadFacebookCredentials.mockResolvedValueOnce({ ok: true, pageId: "111", token: "old" });
    fetchSpy.mockResolvedValueOnce(jsonResponse(400, { error: { message: "Session has expired", code: 190 } }));
    const out = await adapter.publish(input);
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/expired/i);
    expect(out.error).toMatch(/Reconnect/);
    expect(conn.markFacebookExpired).toHaveBeenCalledTimes(1);
  });

  it("makes no Meta call when the stored connection is already expired", async () => {
    conn.loadFacebookCredentials.mockResolvedValueOnce({ ok: false, reason: "expired", message: "Facebook connection expired." });
    const out = await adapter.publish(input);
    expect(out.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("reports waiting_for_credentials, not a failure, when nothing is connected", async () => {
    conn.loadFacebookCredentials.mockResolvedValueOnce({ ok: false, reason: "none", message: "not connected" });
    const out = await adapter.publish(input);
    expect(out.ok).toBe(false);
    expect(out.status).toBe("waiting_for_credentials");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses to publish an empty post before calling Meta", async () => {
    conn.loadFacebookCredentials.mockResolvedValueOnce({ ok: true, pageId: "111", token: "t" });
    const out = await adapter.publish({ content: "   ", hashtags: [], linkUrl: null, mediaUrl: null });
    expect(out.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
