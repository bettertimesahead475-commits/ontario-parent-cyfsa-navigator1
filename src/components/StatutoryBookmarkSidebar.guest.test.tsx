// @vitest-environment jsdom
import React from "react";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  currentUser: null as { uid: string } | null,
  listeners: new Set<(u: { uid: string } | null) => void>(),
}));
vi.mock("../utils/firebase", () => ({
  auth: {
    get currentUser() { return authState.currentUser; },
    onAuthStateChanged(cb: (u: { uid: string } | null) => void) {
      authState.listeners.add(cb);
      return () => authState.listeners.delete(cb);
    },
  },
}));
const { default: StatutoryBookmarkSidebar } = await import("./StatutoryBookmarkSidebar");

const KEY = "OPA_STATUTE_BOOKMARKS";
function switchTo(uid: string | null) {
  authState.currentUser = uid ? { uid } : null;
  act(() => authState.listeners.forEach((cb) => cb(authState.currentUser)));
}
function unloadIsBlocked() {
  const event = new Event("beforeunload", { cancelable: true });
  window.dispatchEvent(event);
  return event.defaultPrevented;
}
function openAndBookmarkFirst() {
  fireEvent.click(screen.getByTitle("Open CYFSA Statutory Bookmarks Sidebar Desk"));
  fireEvent.click(screen.getByRole("button", { name: /Statute Library/ }));
  fireEvent.click(screen.getAllByTitle("Add Bookmark to Case Strategy Workspace")[0]);
  fireEvent.click(screen.getByRole("button", { name: /My Bookmarks/ }));
}
function writeNote(text: string, finish: RegExp) {
  fireEvent.click(screen.getAllByTitle("Click to write case notes")[0]);
  fireEvent.change(screen.getByPlaceholderText(/Enter your case notes/), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: finish }));
}

describe("Statute Desk guest bookmarks", () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    authState.currentUser = null;
    authState.listeners.clear();
  });
  afterEach(() => cleanup());

  it("says guest bookmarks are page-only before anything is entered, and never writes them to browser storage", () => {
    render(<StatutoryBookmarkSidebar />);
    expect(screen.getByRole("note").textContent).toContain("kept only while this page is open");
    expect(unloadIsBlocked()).toBe(false);
    openAndBookmarkFirst();
    writeNote("cancelled note", /^Cancel$/);
    expect(screen.queryByText("cancelled note")).toBeNull();
    writeNote("guest note", /Keep Notes \(this page only\)/);
    expect(screen.queryByRole("button", { name: /Save Notes/ })).toBeNull();
    expect(Object.keys(localStorage)).toEqual([]);
    expect(Object.keys(sessionStorage)).toEqual([]);
    expect(unloadIsBlocked()).toBe(true);
  });

  it("loses guest edits on refresh, as the notice says, and leaves nothing behind", () => {
    const first = render(<StatutoryBookmarkSidebar />);
    openAndBookmarkFirst();
    first.unmount();
    render(<StatutoryBookmarkSidebar />);
    expect(screen.getByRole("button", { name: /My Bookmarks \(0\)/ })).toBeTruthy();
    expect(Object.keys(localStorage)).toEqual([]);
  });

  it("offers to move guest bookmarks at sign-in, keeps them until the user chooses, and saves only on Move", () => {
    render(<StatutoryBookmarkSidebar />);
    openAndBookmarkFirst();
    writeNote("guest note", /Keep Notes/);
    switchTo("user-a");
    const offer = screen.getByRole("status");
    expect(offer.textContent).toContain("You added 1 bookmark while signed out");
    expect(localStorage.getItem(`${KEY}_user-a`)).toBe("[]");
    expect(unloadIsBlocked()).toBe(true);
    fireEvent.click(within(offer).getByRole("button", { name: "Move these 1 bookmark to your account" }));
    const saved = JSON.parse(localStorage.getItem(`${KEY}_user-a`)!);
    expect(saved).toHaveLength(1);
    expect(saved[0].userNotes).toBe("guest note");
    expect(screen.queryByRole("status")).toBeNull();
    expect(unloadIsBlocked()).toBe(false);
  });

  it("Discard drops guest bookmarks without saving them", () => {
    render(<StatutoryBookmarkSidebar />);
    openAndBookmarkFirst();
    switchTo("user-a");
    fireEvent.click(within(screen.getByRole("status")).getByRole("button", { name: "Discard" }));
    expect(localStorage.getItem(`${KEY}_user-a`)).toBe("[]");
  });

  it("on an account switch, B is not shown A's bookmarks or A's undecided guest edits", () => {
    localStorage.setItem(`${KEY}_user-a`, JSON.stringify([{ id: "a-only", title: "A", citation: "A", category: "Custom Reference", content: "A", userNotes: "", dateBookmarked: "2026-01-01" }]));
    render(<StatutoryBookmarkSidebar />);
    openAndBookmarkFirst();
    switchTo("user-a");
    switchTo("user-b");
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.getByRole("button", { name: /My Bookmarks \(0\)/ })).toBeTruthy();
    expect(JSON.parse(localStorage.getItem(`${KEY}_user-a`)!)).toHaveLength(1);
    expect(localStorage.getItem(`${KEY}_user-b`)).toBe("[]");
  });
});
