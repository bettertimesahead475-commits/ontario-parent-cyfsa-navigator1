// Stage 10 slice 5: the three Stage 10 read routes, exercised THROUGH THE REAL SERVER COMPOSITION
// (api/_server.ts: helmet, CORS, rate limiter, JSON parser, registration order). The services are
// mocked here only to prove delegation and the route-level contracts; real authorization and
// real data are proven against PostgreSQL in matterAccessRoutes.pg.test.ts.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';

const TOKENS: Record<string, string> = { 'tok-owner': 'uid-owner', 'tok-stranger': 'uid-stranger' };
const mockFirebaseAdmin = vi.hoisted(() => ({ verifyFirebaseToken: vi.fn() }));
const svc = vi.hoisted(() => ({
  getMatterAccessAudit: vi.fn(),
  listMatterAccessEvents: vi.fn(),
  getMatterAccessHistory: vi.fn(),
}));

vi.mock('./services/firebaseAdmin.js', () => mockFirebaseAdmin);
vi.mock('./services/matterAccessAudit.js', () => ({ getMatterAccessAudit: svc.getMatterAccessAudit }));
vi.mock('./services/matterAccessEvents.js', () => ({ listMatterAccessEvents: svc.listMatterAccessEvents }));
vi.mock('./services/matterAccessHistory.js', () => ({ getMatterAccessHistory: svc.getMatterAccessHistory }));

// Must be set before _server.ts is evaluated (see api/_server.test.ts).
process.env.VERCEL = '1';
const { default: app } = await import('./_server.js');
const { LifecycleError } = await import('./services/lifecycleErrors.js');

const MATTER = '22000000-0000-4000-8000-00000000000a';
const ROUTES = [
  { path: `/api/matters/${MATTER}/access-audit`, service: svc.getMatterAccessAudit, unavailable: 'ACCESS_AUDIT_UNAVAILABLE' },
  { path: `/api/matters/${MATTER}/access-events`, service: svc.listMatterAccessEvents, unavailable: 'ACCESS_EVENTS_UNAVAILABLE' },
  { path: `/api/matters/${MATTER}/access-history`, service: svc.getMatterAccessHistory, unavailable: 'ACCESS_HISTORY_UNAVAILABLE' },
] as const;
const STAGE10_PATHS = ['/api/matters/:matterId/access-audit', '/api/matters/:matterId/access-events', '/api/matters/:matterId/access-history'];
const allServiceCalls = () => ROUTES.reduce((n, r) => n + r.service.mock.calls.length, 0);

function routeTable(): { method: string; path: string }[] {
  const stack: any[] = (app as any)._router.stack;
  return stack.filter(l => l.route).flatMap(l => Object.keys(l.route.methods).map(m => ({ method: m.toUpperCase(), path: String(l.route.path) })));
}

beforeEach(() => {
  mockFirebaseAdmin.verifyFirebaseToken.mockReset().mockImplementation(async (header?: string) => {
    const m = /^Bearer (\S+)$/.exec(header ?? '');
    return m && TOKENS[m[1]] ? { uid: TOKENS[m[1]], email: null } : null;
  });
  for (const r of ROUTES) r.service.mockReset().mockResolvedValue({ ok: true });
});

describe('Stage 10 slice 5: route registration in api/_server.ts', () => {
  it('mounts exactly the three Stage 10 GET routes, each once, with no method/path collision anywhere', () => {
    const table = routeTable();
    const keys = table.map(r => `${r.method} ${r.path}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const p of STAGE10_PATHS) {
      expect(table.filter(r => r.path === p)).toEqual([{ method: 'GET', path: p }]);
    }
    // No Stage 10 write surface of any kind.
    expect(table.filter(r => /access-(audit|events|history)/.test(r.path) && r.method !== 'GET')).toEqual([]);
  });

  it('registers after every global middleware (helmet, CORS, limiter, parser) and before nothing that could shadow it', () => {
    const stack: any[] = (app as any)._router.stack;
    const firstStage10 = stack.findIndex(l => l.route && STAGE10_PATHS.includes(l.route.path));
    const lastMiddleware = stack.reduce((idx, l, i) => (!l.route && !['query', 'expressInit'].includes(l.name) ? i : idx), -1);
    expect(firstStage10).toBeGreaterThan(lastMiddleware);
    // No earlier route can match a Stage 10 URL (e.g. GET /api/matters/:matterId is one segment shorter).
    for (const l of stack.slice(0, firstStage10)) {
      if (!l.route) continue;
      for (const r of ROUTES) expect(l.match(r.path) && l.route.methods.get).toBeFalsy();
    }
  });

  it('does not shadow the existing single-matter route', async () => {
    const stack: any[] = (app as any)._router.stack;
    const matching = stack.filter(l => l.route && l.route.methods.get && l.match(`/api/matters/${MATTER}`));
    expect(matching.map(l => l.route.path)).toEqual(['/api/matters/:matterId']);
  });
});

describe.each(ROUTES)('Stage 10 slice 5: $path through the real server', ({ path, service, unavailable }) => {
  it('delegates the verified uid and the raw matter id to the service (the authorization boundary)', async () => {
    service.mockResolvedValue({ matterId: MATTER, payload: 1 });
    const res = await request(app).get(path).set('Authorization', 'Bearer tok-owner');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ matterId: MATTER, payload: 1 });
    expect(service).toHaveBeenCalledTimes(1);
    expect(service.mock.calls[0][0]).toBe('uid-owner');
    expect(service.mock.calls[0][1]).toBe(MATTER);
    expect(res.headers['cache-control']).toBe('no-store');
    // helmet still applies
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('forwards an unauthorized-looking caller to the service instead of deciding at the HTTP layer', async () => {
    // HTTP reachability is not authorization: the route has no allow/deny list of its own.
    service.mockRejectedValue(new LifecycleError(403, 'FORBIDDEN', 'Refused.'));
    const res = await request(app).get(path).set('Authorization', 'Bearer tok-stranger');
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ code: 'FORBIDDEN', error: 'Refused.' });
    expect(service.mock.calls[0][0]).toBe('uid-stranger');
  });

  it.each([
    ['no Authorization header', undefined],
    ['a non-Bearer scheme', 'Basic dG9rLW93bmVy'],
    ['an empty bearer token', 'Bearer '],
    ['an unverifiable (malformed, expired or revoked) token', 'Bearer tok-expired-or-revoked'],
  ])('refuses %s with 401 before any service call', async (_label, header) => {
    const req = request(app).get(path);
    const res = await (header === undefined ? req : req.set('Authorization', header));
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ code: 'SIGN_IN_REQUIRED', error: 'Authentication required.' });
    expect(allServiceCalls()).toBe(0);
  });

  it('maps an unexpected failure to a fixed 503 with no internals', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    service.mockRejectedValue(new Error('relation "public.navigator_matter_access_events" does not exist; service_role key sk-123; token_digest=ab12'));
    const res = await request(app).get(path).set('Authorization', 'Bearer tok-owner');
    expect(res.status).toBe(503);
    expect(res.body.code).toBe(unavailable);
    expect(Object.keys(res.body).sort()).toEqual(['code', 'error']);
    expect(res.text).not.toMatch(/relation|navigator_|service_role|sk-123|digest|stack|at\s+\w+\s\(/);
    // The server log does not get the raw error either.
    expect(JSON.stringify(spy.mock.calls)).not.toMatch(/sk-123|token_digest/);
    spy.mockRestore();
  });

  it('also fails closed when identity verification itself throws', async () => {
    mockFirebaseAdmin.verifyFirebaseToken.mockRejectedValueOnce(new Error('firebase-admin internal: private_key'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app).get(path).set('Authorization', 'Bearer tok-owner');
    spy.mockRestore();
    expect(res.status).toBe(503);
    expect(res.text).not.toMatch(/private_key|firebase/i);
    expect(allServiceCalls()).toBe(0);
  });

  it.each(['post', 'put', 'patch', 'delete'] as const)('exposes no %s handler (append-only / read-only surface)', async method => {
    const res = await request(app)[method](path).set('Authorization', 'Bearer tok-owner').send({ eventType: 'GRANT_REVOKED' });
    expect(res.status).toBe(404);
    expect(allServiceCalls()).toBe(0);
  });

  it('keeps the CORS allowlist: allowed origin is echoed, missing origin is allowed, unknown origin is refused before the handler', async () => {
    const ok = await request(app).get(path).set('Origin', 'https://cyfsanavigator.com').set('Authorization', 'Bearer tok-owner');
    expect(ok.status).toBe(200);
    expect(ok.headers['access-control-allow-origin']).toBe('https://cyfsanavigator.com');
    expect(ok.headers['access-control-allow-credentials']).toBeUndefined();

    const none = await request(app).get(path).set('Authorization', 'Bearer tok-owner');
    expect(none.status).toBe(200);
    expect(none.headers['access-control-allow-origin']).toBeUndefined();

    service.mockClear();
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = await request(app).get(path).set('Origin', 'https://evil.example').set('Authorization', 'Bearer tok-owner');
    spy.mockRestore();
    expect(bad.status).not.toBe(200);
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
    expect(service).not.toHaveBeenCalled();
  });

  it('answers a cross-origin preflight only for an allowlisted origin', async () => {
    const ok = await request(app).options(path).set('Origin', 'https://cyfsanavigator.com').set('Access-Control-Request-Method', 'GET');
    expect(ok.status).toBe(204);
    expect(ok.headers['access-control-allow-origin']).toBe('https://cyfsanavigator.com');
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const bad = await request(app).options(path).set('Origin', 'https://evil.example').set('Access-Control-Request-Method', 'GET');
    spy.mockRestore();
    expect(bad.headers['access-control-allow-origin']).toBeUndefined();
    expect(allServiceCalls()).toBe(0);
  });
});

describe('Stage 10 slice 5: route-specific parameter handling through the real server', () => {
  it('access-events validates paging before the service and passes only numbers', async () => {
    const base = ROUTES[1].path;
    for (const q of ['after=-1', 'after=abc', 'limit=1e3', 'after=1&after=2']) {
      const res = await request(app).get(`${base}?${q}`).set('Authorization', 'Bearer tok-owner');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_REQUEST');
    }
    expect(svc.listMatterAccessEvents).not.toHaveBeenCalled();
    await request(app).get(`${base}?after=5&limit=10`).set('Authorization', 'Bearer tok-owner');
    expect(svc.listMatterAccessEvents).toHaveBeenCalledWith('uid-owner', MATTER, { afterSequence: 5, limit: 10 });
  });

  it('access-history passes the cursor through verbatim (the service, not the route, validates and binds it)', async () => {
    const base = ROUTES[2].path;
    await request(app).get(`${base}?cursor=h1.abc&pageSize=2`).set('Authorization', 'Bearer tok-owner');
    expect(svc.getMatterAccessHistory).toHaveBeenCalledWith('uid-owner', MATTER, { cursor: 'h1.abc', pageSize: 2 });
    const arr = await request(app).get(`${base}?cursor=a&cursor=b`).set('Authorization', 'Bearer tok-owner');
    expect(arr.status).toBe(400);
    expect(arr.body.code).toBe('INVALID_CURSOR');
    const size = await request(app).get(`${base}?pageSize=-1`).set('Authorization', 'Bearer tok-owner');
    expect(size.status).toBe(400);
    expect(svc.getMatterAccessHistory).toHaveBeenCalledTimes(1);
  });

  it.each(ROUTES)('$path takes identity only from the token and the matter only from the path', async ({ path, service }) => {
    const OTHER = '22000000-0000-4000-8000-0000000000ff';
    const q = `uid=uid-owner&as=uid-owner&role=OWNER&scope=MATTER&matter=${OTHER}&matterId=${OTHER}`;
    await request(app).get(`${path}?${q}`).set('Authorization', 'Bearer tok-stranger');
    expect(service).toHaveBeenCalledTimes(1);
    expect(service.mock.calls[0][0]).toBe('uid-stranger');
    expect(service.mock.calls[0][1]).toBe(MATTER);
    expect(JSON.stringify(service.mock.calls[0])).not.toContain(OTHER);
    expect(JSON.stringify(service.mock.calls[0])).not.toContain('uid-owner');
  });
});
