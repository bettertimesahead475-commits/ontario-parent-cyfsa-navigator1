// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";

vi.mock("firebase/auth", async (orig) => ({
  ...(await orig<typeof import("firebase/auth")>()),
  signOut: vi.fn(async () => {}),
}));

import { SHARED_LEGACY_ACCOUNT_KEYS, signOutOfAccount } from "./firebase";

describe("signOutOfAccount", () => {
  it("deletes the legacy shared coach-chat and bookmark keys but keeps per-account data", async () => {
    for (const key of SHARED_LEGACY_ACCOUNT_KEYS) localStorage.setItem(key, "[\"shared\"]");
    localStorage.setItem("OPA_STATUTE_BOOKMARKS_user-a", "[\"mine\"]");
    await signOutOfAccount();
    expect(localStorage.getItem("OPA_COACH_CHAT_MESSAGES")).toBeNull();
    expect(localStorage.getItem("OPA_STATUTE_BOOKMARKS")).toBeNull();
    expect(localStorage.getItem("OPA_STATUTE_BOOKMARKS_user-a")).toBe("[\"mine\"]");
  });
});
