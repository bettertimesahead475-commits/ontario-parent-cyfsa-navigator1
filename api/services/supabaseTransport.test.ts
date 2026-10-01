// Transport-level tests for the Supabase client used by the analyzer's access/usage checks.
// Unlike _server.test.ts these run the REAL access.ts/usage.ts and the real supabase-js client
// against local HTTP servers, so they exercise the actual fetch path (no network mocking).
import http from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const SECRET_KEY = "test-service-role-key-SHOULD-NEVER-BE-LOGGED";

async function startServer(handler: http.RequestListener): Promise<{ url: string; close: () => Promise<void> }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

async function freshUsageModule() {
  vi.resetModules(); // access.ts caches its client; each test needs a client for its own URL
  return import("./usage.js");
}

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  process.env.SUPABASE_SERVICE_ROLE_KEY = SECRET_KEY;
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  vi.restoreAllMocks();
});

describe("Supabase transport for usage validation", () => {
  it("reads free usage through Node's native global fetch", async () => {
    const seen: { path?: string; apikey?: string } = {};
    const server = await startServer((req, res) => {
      seen.path = req.url;
      seen.apikey = req.headers.apikey as string;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify([{ analyses_used: 1 }])); // PostgREST row array
    });
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    try {
      process.env.SUPABASE_URL = server.url;
      const { getFreeUsage } = await freshUsageModule();
      await expect(getFreeUsage("uid-1")).resolves.toBe(1);
      expect(seen.path).toContain("/rest/v1/free_usage");
      expect(seen.path).toContain("uid=eq.uid-1");
      expect(seen.apikey).toBe(SECRET_KEY);
      expect(fetchSpy).toHaveBeenCalled();
      // No custom undici dispatcher is injected into the request.
      for (const call of fetchSpy.mock.calls) expect((call[1] as any)?.dispatcher).toBeUndefined();
    } finally {
      await server.close();
    }
  });

  it("treats a missing usage row as zero analyses used", async () => {
    const server = await startServer((_req, res) => {
      // supabase-js 2.110's maybeSingle() requests a plain row array; no match is [].
      res.setHeader("content-type", "application/json");
      res.end("[]");
    });
    try {
      process.env.SUPABASE_URL = server.url;
      const { getFreeUsage } = await freshUsageModule();
      await expect(getFreeUsage("uid-new")).resolves.toBe(0);
    } finally {
      await server.close();
    }
  });

  it("fails CLOSED on a network failure and logs the real cause without the key", async () => {
    const server = await startServer(() => {});
    const closedUrl = server.url;
    await server.close(); // nothing is listening on this port any more
    process.env.SUPABASE_URL = closedUrl;
    const { getFreeUsage } = await freshUsageModule();

    const started = Date.now();
    const failure = await getFreeUsage("uid-1").then(
      () => null,
      (err) => err
    );
    // One retry layer only: a hard network failure is reported within seconds, not ~20s+.
    expect(Date.now() - started).toBeLessThan(3000);
    // vi.resetModules() loads a fresh LifecycleError class, so compare by name, not instanceof.
    expect(failure?.name).toBe("LifecycleError");
    expect(failure.code).toBe("USAGE_SERVICE_TEMPORARILY_UNAVAILABLE");
    expect(failure.statusCode).toBe(503);

    const logged = errorLog.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
    expect(logged).toContain("free_usage read failed");
    expect(logged).toContain('"kind":"NETWORK"');
    expect(logged).toContain("ECONNREFUSED");
    expect(logged).toContain("127.0.0.1");
    expect(logged).not.toContain(SECRET_KEY);
  });

  it("fails CLOSED when the gateway rejects the key", async () => {
    const server = await startServer((_req, res) => {
      res.statusCode = 401;
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ message: "Invalid API key", hint: "Double check your Supabase `anon` or `service_role` API key." }));
    });
    try {
      process.env.SUPABASE_URL = server.url;
      const { getFreeUsage } = await freshUsageModule();
      await expect(getFreeUsage("uid-1")).rejects.toMatchObject({ code: "USAGE_SERVICE_TEMPORARILY_UNAVAILABLE" });
      const logged = errorLog.mock.calls.map((c: unknown[]) => c.join(" ")).join("\n");
      expect(logged).toContain('"kind":"AUTH"');
      expect(logged).not.toContain(SECRET_KEY);
    } finally {
      await server.close();
    }
  });

  it("fails CLOSED when Supabase is not configured at all", async () => {
    delete process.env.SUPABASE_URL;
    const { getFreeUsage } = await freshUsageModule();
    await expect(getFreeUsage("uid-1")).rejects.toMatchObject({ code: "USAGE_SERVICE_TEMPORARILY_UNAVAILABLE", statusCode: 503 });
  });
});

describe("describeSupabaseFailure", () => {
  it("extracts the network cause from a postgrest-js error without the stack", async () => {
    const { describeSupabaseFailure } = await import("./supabaseDiagnostics.js");
    process.env.SUPABASE_URL = "https://exampleprojectref.supabase.co";
    const described = describeSupabaseFailure({
      message: "TypeError: fetch failed",
      details:
        "TypeError: fetch failed\n\nCaused by: Error: getaddrinfo ENOTFOUND exampleprojectref.supabase.co (ENOTFOUND)\nError: getaddrinfo ENOTFOUND\n    at GetAddrInfoReqWrap.onlookupall",
      code: "",
    });
    expect(described).toEqual({
      kind: "NETWORK",
      host: "exampleprojectref.supabase.co",
      message: "TypeError: fetch failed",
      causeCode: "ENOTFOUND",
      causeMessage: "Error: getaddrinfo ENOTFOUND exampleprojectref.supabase.co",
    });
  });

  it("describes a configured key by format and public claims only", async () => {
    const { describeConfiguredKey } = await import("./supabaseDiagnostics.js");
    process.env.SUPABASE_SERVICE_ROLE_KEY = "sb_secret_abcdef123456";
    expect(describeConfiguredKey()).toEqual({ source: "SUPABASE_SERVICE_ROLE_KEY", format: "sb_secret", jwtRole: null, jwtRef: null });
  });
});
