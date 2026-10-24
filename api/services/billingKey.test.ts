import { describe, expect, it } from "vitest";
import { forensicBillingKey } from "./billingKey.js";

describe("forensicBillingKey", () => {
  const key = (session: string, doc: string, id: string | null) => forensicBillingKey(session, doc, id);

  it("is the same for a genuine retry of the same document in the same session", () => {
    expect(key("s1", "doc", "req_1")).toBe(key("s1", "doc", "req_1"));
  });

  it("differs when the document differs, so reusing an id cannot ride on an earlier payment", () => {
    expect(key("s1", "doc A", "req_1")).not.toBe(key("s1", "doc B", "req_1"));
  });

  it("differs across paid sessions, so another account cannot reuse someone's id", () => {
    expect(key("s1", "doc", "req_1")).not.toBe(key("s2", "doc", "req_1"));
  });

  it("differs for different client ids", () => {
    expect(key("s1", "doc", "req_1")).not.toBe(key("s1", "doc", "req_2"));
  });

  it("is null when the client sent no id, so such a request is never a retry", () => {
    expect(key("s1", "doc", null)).toBeNull();
    expect(key("s1", "doc", "")).toBeNull();
  });

  it("is fixed length and does not contain the session, document or client id", () => {
    const value = key("session-secret", "private document text", "client-id-123") as string;
    expect(value).toMatch(/^forensic:[0-9a-f]{64}$/);
    expect(value).not.toContain("session-secret");
    expect(value).not.toContain("client-id-123");
  });

  it("does not let field boundaries be shifted to collide", () => {
    expect(key("ab", "c", "id")).not.toBe(key("a", "bc", "id"));
  });
});
