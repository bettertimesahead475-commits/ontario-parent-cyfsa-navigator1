import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { isVerifiedSiteOwner } from "./access.js";

describe("isVerifiedSiteOwner", () => {
  const saved = { ...process.env };
  beforeEach(() => {
    process.env.ADMIN_EMAILS = "owner-test@example.test";
    process.env.ADMIN_SECRET = "secret-for-test";
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it("grants a verified allowlisted email", () => {
    expect(isVerifiedSiteOwner({ email: "Owner-Test@Example.test", emailVerified: true })).toBe(true);
  });

  it("refuses an allowlisted email that is not verified", () => {
    expect(isVerifiedSiteOwner({ email: "owner-test@example.test", emailVerified: false })).toBe(false);
    expect(isVerifiedSiteOwner({ email: "chris@cyfsanavigator.com" })).toBe(false);
  });

  it("refuses a verified email that is not on the allowlist", () => {
    expect(isVerifiedSiteOwner({ email: "parent@example.test", emailVerified: true })).toBe(false);
  });

  it("accepts the admin secret and rejects a wrong one", () => {
    expect(isVerifiedSiteOwner(null, "secret-for-test")).toBe(true);
    expect(isVerifiedSiteOwner(null, "wrong")).toBe(false);
    expect(isVerifiedSiteOwner(null, null)).toBe(false);
  });
});
