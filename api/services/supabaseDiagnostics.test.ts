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

describe("'Caused by' extraction (S8786 linear rewrite)", () => {
  // The former pattern, kept here as the reference the rewrite must agree with.
  const OLD = /Caused by: ([^\n]*?)(?: \(([A-Z0-9_]+)\))?\s*(?:\n|$)/;
  const cause = (details: string) => {
    const d = describeSupabaseFailure({ message: "TypeError: fetch failed", details });
    return { code: d.causeCode, message: d.causeMessage };
  };
  const expected = (details: string) => {
    const m = details.match(OLD)!;
    return { code: m[2] ?? null, message: m[1] };
  };

  it("keeps the message and code of the first 'Caused by' line exactly as before", () => {
    const samples = [
      "TypeError: fetch failed\n\nCaused by: Error: getaddrinfo ENOTFOUND x.supabase.co (ENOTFOUND)\n    at stack",
      "Caused by: Error: connect ECONNREFUSED 127.0.0.1:443 (ECONNREFUSED)   \r\nstack",
      "Caused by: Error: socket hang up",
      "Caused by: Error: weird (lower_case)\n",
      "Caused by: Error: (A) (B_2)  ",
      "Caused by: (CODE)",
      "Caused by:  (CODE)\nCaused by: second (X)",
      "Caused by: Error: x (CODE) trailing\n",
      "Caused by:    \n",
    ];
    for (const s of samples) expect(cause(s), JSON.stringify(s)).toEqual(expected(s));
    expect(cause(samples[0])).toEqual({ code: "ENOTFOUND", message: "Error: getaddrinfo ENOTFOUND x.supabase.co" });
  });

  it("agrees with the former pattern on random 'Caused by' lines", () => {
    const parts = ["Error:", " ", "  ", "\t", "\r", "\n", "(", ")", " (", "CODE", "E_1", "x", "y z"];
    let seed = 5;
    for (let i = 0; i < 5000; i++) {
      let s = "Caused by: ";
      for (let j = 0; j < 7; j++) { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; s += parts[seed % parts.length]; }
      expect(cause(s), JSON.stringify(s)).toEqual(expected(s));
    }
  });

  it("is linear on a 'Caused by' line holding 50,000 spaces", () => {
    const t0 = performance.now();
    cause("Caused by: " + " ".repeat(50_000) + "x");
    expect(performance.now() - t0).toBeLessThan(100);
  });
});
