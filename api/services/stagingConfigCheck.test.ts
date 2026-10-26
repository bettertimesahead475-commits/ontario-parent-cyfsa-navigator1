import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

// Runs the readiness checker with a controlled environment and checks its verdict. Never prints or stores a key.
function check(env: Record<string, string | undefined>) {
  const clean = Object.fromEntries(Object.entries({ PATH: process.env.PATH, ...env }).filter(([, v]) => v !== undefined));
  return spawnSync(process.execPath, ["scripts/staging/check-staging-config.mjs"], { env: clean, encoding: "utf8" });
}

describe("staging configuration readiness", () => {
  it("is not ready when neither variable is set", () => {
    const r = check({});
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("STAGING_SUPABASE_URL: NOT SET");
    expect(r.stdout).toContain("STAGING_SUPABASE_SERVICE_ROLE_KEY: NOT SET");
  });

  it("refuses the production project even when a key is present", () => {
    const r = check({ STAGING_SUPABASE_URL: "https://qboidsfpjuxeqtfotryj.supabase.co", STAGING_SUPABASE_SERVICE_ROLE_KEY: "present-but-not-printed" });
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("PRODUCTION project. Refusing.");
    expect(r.stdout).not.toContain("present-but-not-printed");
  });

  it("is ready for the staging project with a key, and never prints the key", () => {
    const r = check({ STAGING_SUPABASE_URL: "https://nxfhvebzzobegubefcda.supabase.co", STAGING_SUPABASE_SERVICE_ROLE_KEY: "present-but-not-printed" });
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("project ref nxfhvebzzobegubefcda, not production");
    expect(r.stdout).not.toContain("present-but-not-printed");
  });
});
