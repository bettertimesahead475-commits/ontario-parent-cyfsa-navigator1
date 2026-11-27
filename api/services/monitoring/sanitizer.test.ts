/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect } from "vitest";
import { sanitizeText, sanitizeObject } from "./sanitizer.js";

describe("Monitoring Sanitizer", () => {
  it("scrubs Anthropic API keys", () => {
    const text = "Error calling Anthropic with key sk-ant-api03-abcdef1234567890abcdef1234567890";
    const cleaned = sanitizeText(text);
    expect(cleaned).not.toContain("sk-ant-api");
    expect(cleaned).toContain("[REDACTED]");
  });

  it("scrubs Supabase modern secret keys", () => {
    const text = "Connecting with sb_secret_Z2SpQwtvrkVR6QN1Xwwxsg_VcbsLvmT_xyz";
    const cleaned = sanitizeText(text);
    expect(cleaned).not.toContain("sb_secret_");
    expect(cleaned).toContain("[REDACTED]");
  });

  it("scrubs Bearer tokens and JWTs", () => {
    const jwt = "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNH";
    const cleaned = sanitizeText(jwt);
    expect(cleaned).not.toContain("eyJhbGciOi");
    expect(cleaned).toContain("[REDACTED]");
  });

  it("scrubs email addresses (PII)", () => {
    const text = "Parent email parent.user@example.com requested assistance";
    const cleaned = sanitizeText(text);
    expect(cleaned).not.toContain("parent.user@example.com");
    expect(cleaned).toContain("[REDACTED]");
  });

  it("sanitizes nested objects and sensitive keys", () => {
    const raw = {
      status: "failed",
      apiKey: "super-secret-key-12345",
      serviceRoleSecret: "sb_secret_1234567890abcdef",
      user: {
        email: "test@domain.ca",
        role: "admin",
      },
      nested: [
        { password: "db_password_xyz", name: "db_pool" }
      ]
    };

    const sanitized = sanitizeObject(raw) as any;
    expect(sanitized.apiKey).toBe("[REDACTED]");
    expect(sanitized.serviceRoleSecret).toBe("[REDACTED]");
    expect(sanitized.user.email).toBe("[REDACTED]");
    expect(sanitized.nested[0].password).toBe("[REDACTED]");
    expect(sanitized.nested[0].name).toBe("db_pool");
  });
});

describe("email scrubbing (S8786 linear rewrite)", () => {
  it("scrubs the same addresses as before and stays linear on long address-like runs", () => {
    expect(sanitizeText("Contact ops.team+alerts@example.co.uk now")).toBe("Contact [REDACTED] now");
    expect(sanitizeText("x@y.comz@w.org and a@b.cc1@d.ee")).toBe("[REDACTED]@w.org and [REDACTED][REDACTED]");
    expect(sanitizeText("user@localhost")).toBe("user@localhost");
    const attack = "a".repeat(50_000) + "!";
    const t0 = performance.now();
    expect(sanitizeText(attack)).toBe(attack);
    expect(performance.now() - t0).toBeLessThan(100);
  });
});
