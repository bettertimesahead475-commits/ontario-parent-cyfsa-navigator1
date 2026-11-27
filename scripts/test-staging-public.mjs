// Real HTTP checks only. No Firebase session, provider call, or credit mutation.
const base = new URL(process.argv[2] || 'https://cyfsa-navigator-staging.pages.dev');
if (base.protocol !== 'https:' || base.port || base.username || base.password || base.pathname !== '/' || base.search || base.hash || !/(^|\.)cyfsa-navigator-staging\.pages\.dev$/.test(base.hostname)) {
  throw new Error('Only the isolated staging HTTPS origin is allowed.');
}
const checks = [
  { path: '/', expected: 200 },
  { path: '/api/_auth-check', expected: 401 },
  { path: '/api/_auth-check', expected: 401, token: 'invalid' },
  { path: '/api/_auth-check', expected: 401, token: 'e30.e30.invalid' },
  { path: '/api/extract-text', expected: 401, body: { fileData: { base64: 'JVBERi0xLjQK', mimeType: 'application/pdf' } } },
  ...['fast', 'full'].map(mode => ({ path: '/api/analyze', expected: 401, body: { documentText: '[Page 1] Synthetic readiness probe.', mode, stream: false } })),
  { path: '/api/analyze/job/job_readiness_probe_123', expected: 401 },
];
const results = await Promise.all(checks.map(async ({ path, expected, token, body }) => {
  const started = Date.now();
  try {
    const response = await fetch(new URL(path, base), {
      method: body ? 'POST' : 'GET',
      headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      redirect: 'error', signal: AbortSignal.timeout(30000),
    });
    await response.arrayBuffer();
    return { path, method: body ? 'POST' : 'GET', expected, actual: response.status, pass: response.status === expected, elapsedMs: Date.now() - started };
  } catch (error) {
    return { path, expected, pass: false, elapsedMs: Date.now() - started, transportError: error.name, cause: error.cause?.code || null };
  }
}));
console.log(JSON.stringify({ origin: base.origin, results, passed: results.filter(r => r.pass).length, total: results.length }, null, 2));
if (results.some(r => !r.pass)) process.exitCode = 1;
