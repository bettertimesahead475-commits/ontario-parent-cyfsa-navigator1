// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  currentUser: null as { uid: string } | null,
  listeners: new Set<(u: { uid: string } | null) => void>(),
}));

vi.mock("../utils/firebase", () => ({
  auth: {
    get currentUser() {
      return authState.currentUser;
    },
    onAuthStateChanged(cb: (u: { uid: string } | null) => void) {
      authState.listeners.add(cb);
      return () => authState.listeners.delete(cb);
    },
  },
}));

import { useAccountStorage } from "./useAccountStorage";

function switchTo(uid: string | null) {
  authState.currentUser = uid ? { uid } : null;
  act(() => authState.listeners.forEach((cb) => cb(authState.currentUser)));
}

const KEY = "OPA_STATUTE_BOOKMARKS";

describe("useAccountStorage", () => {
  beforeEach(() => {
    localStorage.clear();
    authState.currentUser = null;
    authState.listeners.clear();
  });

  it("saves under the signed-in account's key and never the shared key", () => {
    authState.currentUser = { uid: "user-a" };
    const { result } = renderHook(() => useAccountStorage<string[]>(KEY, () => []));
    act(() => result.current[1](["s. 74"]));
    expect(JSON.parse(localStorage.getItem(`${KEY}_user-a`)!)).toEqual(["s. 74"]);
    expect(localStorage.getItem(KEY)).toBeNull();
  });

  it("does not read legacy shared-key data into the account that signs in", () => {
    localStorage.setItem(KEY, JSON.stringify(["someone else's bookmark"]));
    authState.currentUser = { uid: "user-a" };
    const { result } = renderHook(() => useAccountStorage<string[]>(KEY, () => []));
    expect(result.current[0]).toEqual([]);
    expect(localStorage.getItem(`${KEY}_user-a`)).toBe("[]");
  });

  it("switches to the next account's data and does not write the previous account's data under it", () => {
    localStorage.setItem(`${KEY}_user-b`, JSON.stringify(["b's bookmark"]));
    authState.currentUser = { uid: "user-a" };
    const { result } = renderHook(() => useAccountStorage<string[]>(KEY, () => []));
    act(() => result.current[1](["a's bookmark"]));

    switchTo(null);
    expect(result.current[0]).toEqual([]);

    switchTo("user-b");
    expect(result.current[0]).toEqual(["b's bookmark"]);
    expect(JSON.parse(localStorage.getItem(`${KEY}_user-b`)!)).toEqual(["b's bookmark"]);
    expect(JSON.parse(localStorage.getItem(`${KEY}_user-a`)!)).toEqual(["a's bookmark"]);

    switchTo("user-a");
    expect(result.current[0]).toEqual(["a's bookmark"]);
  });

  it("drops a late update from the previous account after a switch", () => {
    authState.currentUser = { uid: "user-a" };
    const { result } = renderHook(() => useAccountStorage<string[]>(KEY, () => []));
    const setAsA = result.current[1];

    switchTo("user-b");
    act(() => setAsA((prev) => [...prev, "a's late reply"]));
    expect(result.current[0]).toEqual([]);
    expect(localStorage.getItem(`${KEY}_user-b`)).toBe("[]");

    switchTo(null);
    act(() => setAsA(["a's late reply"]));
    expect(result.current[0]).toEqual([]);
  });

  it("keeps signed-out state in memory only", () => {
    const { result } = renderHook(() => useAccountStorage<string[]>(KEY, () => []));
    act(() => result.current[1](["anonymous"]));
    expect(result.current[0]).toEqual(["anonymous"]);
    expect(Object.keys(localStorage)).toEqual([]);
  });
});
