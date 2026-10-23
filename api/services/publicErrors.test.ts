import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { logServerError, publicErrorMessage } from "./publicErrors.js";

const FALLBACK = "Please try again.";

describe("publicErrorMessage", () => {
  it("shows the message of a client error, which the server writes as fixed text", () => {
    const err = Object.assign(new Error("This access code has already been redeemed."), { statusCode: 409 });
    expect(publicErrorMessage(err, FALLBACK)).toBe("This access code has already been redeemed.");
  });

  it("replaces a server error's raw text with the fallback", () => {
    const err = Object.assign(new Error("duplicate key value violates unique constraint ZQDB_KEY"), { statusCode: 500 });
    expect(publicErrorMessage(err, FALLBACK)).toBe(FALLBACK);
  });

  it("replaces the message of an error that carries no status", () => {
    expect(publicErrorMessage(new Error("ZQDB connection refused"), FALLBACK)).toBe(FALLBACK);
  });

  it("replaces the message of a non-error value", () => {
    expect(publicErrorMessage("ZQDB raw string", FALLBACK)).toBe(FALLBACK);
    expect(publicErrorMessage(null, FALLBACK)).toBe(FALLBACK);
  });

  it("replaces an empty client-error message with the fallback", () => {
    expect(publicErrorMessage(Object.assign(new Error(""), { statusCode: 400 }), FALLBACK)).toBe(FALLBACK);
  });
});

describe("logServerError", () => {
  afterEach(() => vi.restoreAllMocks());

  it("logs the detail for operators with secrets redacted", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const err = Object.assign(new Error("Failed to read usage"), {
      statusCode: 500,
      supabaseError: { message: "bad token sk_live_ABCDEFGH12345678 for ZQDB" },
    });
    logServerError("/api/example", err);
    const line = String(spy.mock.calls[0][0]);
    expect(line).toContain("ZQDB");
    expect(line).not.toContain("sk_live_ABCDEFGH12345678");
  });
});

describe("access service customer messages", () => {
  // Static guard: every failed database or provider call in access.ts must go through dbFailure,
  // so a raw database message cannot become customer-facing text again.
  const source = readFileSync(new URL("./access.ts", import.meta.url), "utf8");

  it("does not interpolate a raw error message into any thrown error text", () => {
    expect(source).not.toMatch(/new Error\(`[^`]*\$\{\w+\.message\}/);
    expect(source).not.toMatch(/new Error\(\w+\.message\)/);
    expect(source).not.toMatch(/new Error\("[^"]*" \+ \w+\.message\)/);
  });

  it("routes database failures through the fixed-message helper", () => {
    expect(source).toContain('dbFailure("');
  });
});
