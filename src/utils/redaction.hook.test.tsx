// @vitest-environment jsdom
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ currentUser: null as { uid: string } | null }));

vi.mock("./firebase", () => ({
  auth: {
    get currentUser() {
      return authState.currentUser;
    },
  },
}));

import { redactPiiText, useRedaction } from "./redaction";

const KEY = "OPA_REDACTION_ENABLED";

beforeEach(() => {
  localStorage.clear();
  authState.currentUser = { uid: "parent-a" };
});

afterEach(() => vi.restoreAllMocks());

describe("useRedaction", () => {
  it("starts off and returns values unchanged", () => {
    const { result } = renderHook(() => useRedaction());
    expect(result.current.enabled).toBe(false);
    expect(result.current.redact("Jordan Example")).toBe("Jordan Example");
    expect(result.current.redactDocumentText("Call 416-555-0199", ["Jordan"])).toBe("Call 416-555-0199");
  });

  it("when on, replaces known values and masks document text", () => {
    const { result } = renderHook(() => useRedaction());
    act(() => result.current.toggle());
    expect(result.current.enabled).toBe(true);
    expect(result.current.redact("Jordan Example")).toBe("[REDACTED]");
    expect(result.current.redact("FC-19-1234", "[FILE]")).toBe("[FILE]");
    expect(result.current.redactDocumentText("Jordan called 416-555-0199 on 2019-04-03", ["Jordan"])).toBe(
      "[NAME] called [PHONE] on [DATE]"
    );
  });

  it("returns an empty string for missing values whether on or off", () => {
    const { result } = renderHook(() => useRedaction());
    expect(result.current.redact(undefined)).toBe("");
    expect(result.current.redact(null)).toBe("");
    act(() => result.current.toggle());
    expect(result.current.redact(undefined)).toBe("");
    expect(result.current.redact("")).toBe("");
  });

  it("saves the setting per account and restores it on the next mount", () => {
    const first = renderHook(() => useRedaction());
    act(() => first.result.current.toggle());
    expect(localStorage.getItem(`${KEY}_parent-a`)).toBe("true");
    first.unmount();

    expect(renderHook(() => useRedaction()).result.current.enabled).toBe(true);

    authState.currentUser = { uid: "parent-b" };
    expect(renderHook(() => useRedaction()).result.current.enabled).toBe(false);
  });

  it("uses the unscoped key when nobody is signed in", () => {
    authState.currentUser = null;
    localStorage.setItem(KEY, "true");
    expect(renderHook(() => useRedaction()).result.current.enabled).toBe(true);
  });

  it("starts off and keeps working when storage is unavailable", () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    const { result } = renderHook(() => useRedaction());
    expect(result.current.enabled).toBe(false);
    act(() => result.current.toggle());
    expect(result.current.enabled).toBe(true);
    expect(result.current.redact("Jordan")).toBe("[REDACTED]");
  });
});

describe("redactPiiText patterns", () => {
  it.each([
    ["(416) 555-0199", "[PHONE]"],
    ["416.555.0199", "[PHONE]"],
    ["4165550199", "[PHONE]"],
    ["April 3, 2019", "[DATE]"],
    ["Sept. 3rd 2019", "[DATE]"],
    ["3rd of April, 2019", "[DATE]"],
    ["04/03/2019", "[DATE]"],
    ["03-APR-2019", "[DATE]"],
  ])("masks %s", (value, mask) => {
    expect(redactPiiText(`Seen ${value} here.`)).toBe(`Seen ${mask} here.`);
  });

  it("returns empty input unchanged", () => {
    expect(redactPiiText("")).toBe("");
  });

  it("leaves text without identifiers unchanged", () => {
    const text = "Section 74(2) of the CYFSA was considered at the hearing.";
    expect(redactPiiText(text, ["Jordan"])).toBe(text);
  });
});
