// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("firebase/auth", async (orig) => ({
  ...(await orig<typeof import("firebase/auth")>()),
  signOut: vi.fn(async () => {}),
}));

import { signOutOfAccount } from "./firebase";
import { LEGACY_SHARED_KEYS } from "./legacySharedData";

describe("signOutOfAccount", () => {
  it("leaves legacy shared data for the one-time import choice and keeps per-account data", async () => {
    for (const key of LEGACY_SHARED_KEYS) localStorage.setItem(key, "[\"shared\"]");
    localStorage.setItem("OPA_STATUTE_BOOKMARKS_user-a", "[\"mine\"]");
    await signOutOfAccount();
    expect(localStorage.getItem("OPA_COACH_CHAT_MESSAGES")).toBe("[\"shared\"]");
    expect(localStorage.getItem("OPA_STATUTE_BOOKMARKS")).toBe("[\"shared\"]");
    expect(localStorage.getItem("OPA_STATUTE_BOOKMARKS_user-a")).toBe("[\"mine\"]");
  });
});
