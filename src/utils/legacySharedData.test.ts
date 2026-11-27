// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LEGACY_CLAIM_KEY, decideLegacy, legacyOfferFor, resumeLegacyDecision } from "./legacySharedData";

const CHAT = "OPA_COACH_CHAT_MESSAGES";
const BOOKS = "OPA_STATUTE_BOOKMARKS";
const seedLegacy = () => {
  localStorage.setItem(CHAT, JSON.stringify([{ id: "m1", text: "legacy chat" }]));
  localStorage.setItem(BOOKS, JSON.stringify([{ id: "b1" }, { id: "b2" }]));
};
const get = (key: string) => JSON.parse(localStorage.getItem(key) ?? "null");

describe("legacy shared-data migration", () => {
  beforeEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it("offers the first account counts only and imports only after it confirms", () => {
    seedLegacy();
    localStorage.setItem(`${BOOKS}_user-a`, JSON.stringify([{ id: "b2" }, { id: "a1" }]));
    expect(legacyOfferFor("user-a")).toEqual({ chatMessages: 1, bookmarks: 2 });
    expect(localStorage.getItem(`${CHAT}_user-a`)).toBeNull();
    expect(decideLegacy("user-a", "import")).toBe(true);
    expect(get(`${CHAT}_user-a`)).toEqual([{ id: "m1", text: "legacy chat" }]);
    expect(get(`${BOOKS}_user-a`)).toEqual([{ id: "b2" }, { id: "a1" }, { id: "b1" }]);
    expect([localStorage.getItem(CHAT), localStorage.getItem(BOOKS), localStorage.getItem(LEGACY_CLAIM_KEY)]).toEqual([null, null, null]);
  });

  it("discard removes the legacy keys without copying anything", () => {
    seedLegacy();
    legacyOfferFor("user-a");
    expect(decideLegacy("user-a", "discard")).toBe(true);
    expect(Object.keys(localStorage)).toEqual([]);
  });

  it("never offers the data to a second account, even after the first signs out undecided", () => {
    seedLegacy();
    legacyOfferFor("user-a");
    expect(legacyOfferFor("user-b")).toBeNull();
    expect(decideLegacy("user-b", "import")).toBe(false);
    expect(localStorage.getItem(`${BOOKS}_user-b`)).toBeNull();
    expect(legacyOfferFor("user-a")).toEqual({ chatMessages: 1, bookmarks: 2 });
  });

  it("keeps the legacy data when the copy fails, then finishes the recorded import on the next load", () => {
    seedLegacy();
    legacyOfferFor("user-a");
    const realSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key: string, value: string) {
      if (key === `${BOOKS}_user-a`) throw new DOMException("quota", "QuotaExceededError");
      return realSet.call(this, key, value);
    });
    expect(decideLegacy("user-a", "import")).toBe(false);
    expect(localStorage.getItem(BOOKS)).not.toBeNull();
    expect(get(LEGACY_CLAIM_KEY)).toEqual({ uid: "user-a", decision: "import" });
    vi.restoreAllMocks();
    // Next page load, signed in as someone else: A's recorded choice completes, B is offered nothing.
    expect(legacyOfferFor("user-b")).toBeNull();
    expect(get(`${CHAT}_user-a`)).toEqual([{ id: "m1", text: "legacy chat" }]);
    expect(get(`${BOOKS}_user-a`)).toEqual([{ id: "b1" }, { id: "b2" }]);
    expect(localStorage.getItem(`${BOOKS}_user-b`)).toBeNull();
    expect([localStorage.getItem(CHAT), localStorage.getItem(BOOKS), localStorage.getItem(LEGACY_CLAIM_KEY)]).toEqual([null, null, null]);
  });

  it("keeps legacy notes and court date for a statute bookmarked in both, without duplicating them on resume", () => {
    localStorage.setItem(BOOKS, JSON.stringify([{ id: "s74", userNotes: "legacy note", courtDate: "2026-12-01" }]));
    localStorage.setItem(`${BOOKS}_user-a`, JSON.stringify([{ id: "s74", userNotes: "" }]));
    legacyOfferFor("user-a");
    decideLegacy("user-a", "import");
    expect(get(`${BOOKS}_user-a`)).toEqual([{ id: "s74", userNotes: "legacy note", courtDate: "2026-12-01" }]);
    localStorage.setItem(BOOKS, JSON.stringify([{ id: "s74", userNotes: "legacy note" }]));
    localStorage.setItem(LEGACY_CLAIM_KEY, JSON.stringify({ uid: "user-a", decision: "import" }));
    resumeLegacyDecision();
    expect(get(`${BOOKS}_user-a`)[0].userNotes).toBe("legacy note");
  });

  it("keeps the shared coach greeting first, then the imported chat, then the account's own messages", () => {
    localStorage.setItem(CHAT, JSON.stringify([{ id: "coach-welcome" }, { id: "legacy-q" }, { id: "legacy-a" }]));
    localStorage.setItem(`${CHAT}_user-a`, JSON.stringify([{ id: "coach-welcome" }, { id: "mine" }]));
    legacyOfferFor("user-a");
    decideLegacy("user-a", "import");
    expect(get(`${CHAT}_user-a`).map((m: { id: string }) => m.id)).toEqual(["coach-welcome", "legacy-q", "legacy-a", "mine"]);
  });

  it("a resumed import does not duplicate items already copied", () => {
    seedLegacy();
    localStorage.setItem(`${CHAT}_user-a`, JSON.stringify([{ id: "m1", text: "legacy chat" }]));
    localStorage.setItem(LEGACY_CLAIM_KEY, JSON.stringify({ uid: "user-a", decision: "import" }));
    resumeLegacyDecision();
    expect(get(`${CHAT}_user-a`)).toEqual([{ id: "m1", text: "legacy chat" }]);
  });
});
