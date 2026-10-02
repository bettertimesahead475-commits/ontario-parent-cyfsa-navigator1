import { afterEach, describe, expect, it } from "vitest";
import { configuredSupabaseHost, describeConfiguredKey, describeSupabaseFailure } from "./supabaseDiagnostics.js";

describe("supabaseDiagnostics", () => {
  const origRole = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const origKey = process.env.SUPABASE_SERVICE_KEY;
  const origUrl = process.env.SUPABASE_URL;

  afterEach(() => {
    delete process.env.sb_secret_123_SERVICE_ROLE_KEY;
    delete process.env.sb_secret_123_SUPABASE_URL;
    if (origRole !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = origRole;
    else delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (origKey !== undefined) process.env.SUPABASE_SERVICE_KEY = origKey;
    else delete process.env.SUPABASE_SERVICE_KEY;
    if (origUrl !== undefined) process.env.SUPABASE_URL = origUrl;
    else delete process.env.SUPABASE_URL;
  });

  it("extracts hostname from configuredSupabaseHost", () => {
    process.env.SUPABASE_URL = "https://qboidsfpjuxeqtfotryj.supabase.co";
    expect(configuredSupabaseHost()).toBe("qboidsfpjuxeqtfotryj.supabase.co");
  });

  it("describes integration sb_secret_ service role key", () => {
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_SERVICE_KEY;
    process.env.sb_secret_123_SERVICE_ROLE_KEY = "sb_secret_abc123";

    const keyInfo = describeConfiguredKey();
    expect(keyInfo.source).toBe("sb_secret_123_SERVICE_ROLE_KEY");
    expect(keyInfo.format).toBe("sb_secret");
  });

  it("classifies AUTH failures", () => {
    const desc = describeSupabaseFailure({ message: "Invalid API key", status: 401 });
    expect(desc.kind).toBe("AUTH");
  });
});
