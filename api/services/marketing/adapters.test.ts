// Tests the adapter layer's HONESTY guarantees — the whole point of this
// architecture. With no credentials an adapter must report
// waiting_for_credentials and must never pretend to publish; a permissions
// rejection from a live call must map to waiting_for_platform_approval, not a
// fake success; and content that violates a platform's rules must be rejected
// before any network call.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { classifyPlatformError, platformErrorMessage } from "./adapters/base.js";
import { getAdapter, getAllAdapters } from "./adapters/registry.js";

const SOCIAL_ENV = [
  "FACEBOOK_PAGE_ID", "FACEBOOK_PAGE_ACCESS_TOKEN",
  "INSTAGRAM_ACCOUNT_ID", "INSTAGRAM_ACCESS_TOKEN",
  "LINKEDIN_ACCESS_TOKEN", "LINKEDIN_ORG_URN",
  "X_USER_ACCESS_TOKEN",
  "TIKTOK_ACCESS_TOKEN",
];

beforeEach(() => {
  for (const name of SOCIAL_ENV) delete process.env[name];
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("adapter status — no credentials", () => {
  it("every platform reports waiting_for_credentials with the env it needs, and never calls the network", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    for (const adapter of getAllAdapters()) {
      const state = await adapter.getStatus();
      expect(state.status).toBe("waiting_for_credentials");
      expect(state.credentialsPresent).toBe(false);
      expect(state.missingEnv.length).toBeGreaterThan(0);
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("publish refuses honestly (no fabricated success) when unconfigured", async () => {
    const result = await getAdapter("facebook").publish({ content: "hello" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe("waiting_for_credentials");
      expect(result.missingEnv).toContain("FACEBOOK_PAGE_ID");
    }
  });
});

describe("adapter status — credentials present, live check maps errors honestly", () => {
  it("maps a 403 permission rejection to waiting_for_platform_approval", async () => {
    process.env.FACEBOOK_PAGE_ID = "123";
    process.env.FACEBOOK_PAGE_ACCESS_TOKEN = "tok";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "(#200) Requires pages_manage_posts permission" } }), { status: 403 })
    );
    const state = await getAdapter("facebook").getStatus();
    expect(state.status).toBe("waiting_for_platform_approval");
    expect(state.credentialsPresent).toBe(true);
  });

  it("reports a verified connection only when the platform returns a real account", async () => {
    process.env.X_USER_ACCESS_TOKEN = "tok";
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "42", username: "cyfsanav" } }), { status: 200 })
    );
    const state = await getAdapter("x").getStatus();
    expect(state.status).toBe("connected");
    expect(state.accountName).toBe("@cyfsanav");
  });
});

describe("content validation happens before any network call", () => {
  it("rejects over-length content for X (280) without publishing", async () => {
    process.env.X_USER_ACCESS_TOKEN = "tok";
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await getAdapter("x").publish({ content: "a".repeat(281) });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe("error");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects an Instagram post with no media (Instagram is media-only)", async () => {
    process.env.INSTAGRAM_ACCOUNT_ID = "1";
    process.env.INSTAGRAM_ACCESS_TOKEN = "tok";
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await getAdapter("instagram").publish({ content: "caption only" });
    expect(result.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("error classification helpers", () => {
  it("treats permission/scope/approval signals as platform-approval waiting", () => {
    expect(classifyPlatformError(403, {})).toBe("waiting_for_platform_approval");
    expect(classifyPlatformError(400, { error: { message: "missing scope" } })).toBe("waiting_for_platform_approval");
    expect(classifyPlatformError(400, "app review required")).toBe("waiting_for_platform_approval");
  });
  it("treats other failures as plain errors", () => {
    expect(classifyPlatformError(401, { error: "bad token" })).toBe("error");
    expect(classifyPlatformError(500, {})).toBe("error");
  });
  it("extracts a readable message from a platform error body", () => {
    expect(platformErrorMessage(400, { error: { message: "nope" } })).toContain("nope");
    expect(platformErrorMessage(500, null)).toContain("500");
  });
});
