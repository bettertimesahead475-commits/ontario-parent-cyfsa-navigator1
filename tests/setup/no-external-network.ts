import { beforeAll } from 'vitest';

// Tests must never reach real services. Before this guard, a few analyzer tests sent requests to the real Supabase
// project (with a fake key) whenever a code path was not mocked, which made them slow and flaky under load.
// External calls now fail immediately, exactly like a network outage; tests that need a service inject a fetcher.
beforeAll(() => {
  const real = globalThis.fetch;
  if ((real as { __externalNetworkGuard?: boolean }).__externalNetworkGuard) return;
  const guarded = (async (input: RequestInfo | URL, init?: RequestInit) => {
    let host = '';
    try { host = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url).hostname; } catch { /* relative URL */ }
    if (host && host !== 'localhost' && host !== '127.0.0.1') {
      throw new TypeError(`fetch failed: external network is disabled in tests (${host})`);
    }
    return real(input, init);
  }) as typeof fetch & { __externalNetworkGuard?: boolean };
  guarded.__externalNetworkGuard = true;
  globalThis.fetch = guarded;
});
