// Stage 10 slice 8 (activation): the lifecycle mutation adapter IS mounted in the real server -- and
// ONLY its three intended POST routes are. This replaces the slice 6 "must remain unmounted" file;
// each slice 6 guarantee maps to its activated counterpart:
//   no lifecycle path in the route table      -> exactly the three lifecycle POST routes, once each
//   each POST unreachable (404)               -> each POST reachable, authenticated, one service each;
//                                                every other method on those paths is still 404
//   no module imports/registers the adapter   -> only api/_server.ts imports and registers it, once
//   exactly the Stage 10 read routes          -> exactly the 3 read GET routes + 3 lifecycle POST routes

import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';

const mocks = vi.hoisted(() => ({
  verifyFirebaseToken: vi.fn(async () => ({ uid: 'uid-owner', email: null })),
  verifyFirebaseIdentity: vi.fn(async (h?: string) => (h === 'Bearer tok' ? { uid: 'uid-owner', email: 'owner@example.test', emailVerified: true } : null)),
  createProfessionalGrant: vi.fn(),
  acceptProfessionalGrant: vi.fn(),
  revokeProfessionalGrant: vi.fn(),
}));
vi.mock('./services/firebaseAdmin.js', () => ({ verifyFirebaseToken: mocks.verifyFirebaseToken, verifyFirebaseIdentity: mocks.verifyFirebaseIdentity }));
vi.mock('./services/professionalMatterAccess.js', () => ({
  createProfessionalGrant: mocks.createProfessionalGrant,
  acceptProfessionalGrant: mocks.acceptProfessionalGrant,
  revokeProfessionalGrant: mocks.revokeProfessionalGrant,
}));

process.env.VERCEL = '1';
const { default: app } = await import('./_server.js');
const { LIFECYCLE_ROUTE_PATHS } = await import('./matterAccessLifecycleRoutes.js');
const { lifecycleWriteLimiter } = await import('./services/lifecycleWriteLimiter.js');

const MATTER = '25000000-0000-4000-8000-00000000000a';
const GRANT = '35000000-0000-4000-8000-000000000001';
const TOKEN = 'Q'.repeat(43);
const ROOT = path.resolve(__dirname, '..');
const CASES = [
  { url: `/api/matters/${MATTER}/access-grants`, body: { recipientEmail: 'pro@example.test' }, service: mocks.createProfessionalGrant },
  { url: '/api/access-invitations/accept', body: { token: TOKEN }, service: mocks.acceptProfessionalGrant },
  { url: `/api/access-grants/${GRANT}/revoke`, body: {}, service: mocks.revokeProfessionalGrant },
];
const SERVICES = CASES.map(c => c.service);

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return ['node_modules', 'dist', '.git'].includes(d.name) ? [] : sourceFiles(p);
    return /\.(ts|tsx|js|mjs|cjs)$/.test(d.name) && !/\.test\.(ts|tsx)$/.test(d.name) ? [p] : [];
  });
}
const routeKeys = () => ((app as any)._router.stack as any[]).filter(l => l.route)
  .flatMap(l => Object.keys(l.route.methods).map(m => `${m.toUpperCase()} ${l.route.path}`));

beforeEach(() => {
  lifecycleWriteLimiter.reset();
  for (const f of SERVICES) f.mockReset();
  mocks.createProfessionalGrant.mockResolvedValue({
    grant: { id: GRANT, matterId: MATTER, status: 'PENDING', expiresAt: 'x', createdAt: 'y', recipientEmail: 'pro@example.test' }, rawToken: TOKEN,
  });
  mocks.acceptProfessionalGrant.mockResolvedValue({ success: true, matterId: MATTER });
  mocks.revokeProfessionalGrant.mockResolvedValue({ success: true, membershipRemoved: true });
});

describe('Stage 10 slice 8: the lifecycle mutation router is mounted, and only as intended', () => {
  it('the route table holds exactly the three lifecycle POST routes, once each, and no other method on them', () => {
    const keys = routeKeys();
    for (const p of Object.values(LIFECYCLE_ROUTE_PATHS)) {
      expect(keys.filter(k => k.endsWith(` ${p}`))).toEqual([`POST ${p}`]);
    }
    expect(new Set(keys).size).toBe(keys.length); // no method/path collision anywhere
    // Its body-parse error handler is mounted exactly once, path-scoped.
    expect(((app as any)._router.stack as any[]).filter(l => l.name === 'lifecycleBodyParseErrors')).toHaveLength(1);
  });

  it('the complete Stage 10 access surface is exactly 3 read GETs + 3 lifecycle POSTs', () => {
    const access = routeKeys().filter(k => /access-(audit|events|history|grants?)|access-invitations/.test(k)).sort();
    expect(access).toEqual([
      'GET /api/matters/:matterId/access-audit',
      'GET /api/matters/:matterId/access-events',
      'GET /api/matters/:matterId/access-history',
      'POST /api/access-grants/:grantId/revoke',
      'POST /api/access-invitations/accept',
      'POST /api/matters/:matterId/access-grants',
    ].sort());
  });

  it.each(CASES)('POST $url is reachable on the real server, authenticated, and reaches only its own service', async ({ url, body, service }) => {
    const unauth = await request(app).post(url).send(body);
    expect(unauth.status).toBe(401);
    expect(SERVICES.every(s => s.mock.calls.length === 0)).toBe(true);
    const res = await request(app).post(url).set('Authorization', 'Bearer tok').send(body);
    expect([200, 201]).toContain(res.status);
    expect(service).toHaveBeenCalledTimes(1);
    expect(service.mock.calls[0][0]).toBe('uid-owner');
    expect(SERVICES.filter(s => s !== service).every(s => s.mock.calls.length === 0)).toBe(true);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(res.headers['x-content-type-options']).toBe('nosniff'); // helmet still applies
  });

  it.each(CASES.flatMap(c => (['get', 'put', 'delete', 'patch'] as const).map(m => ({ ...c, m }))))(
    '$m $url is not a route (404) and reaches no service', async ({ url, m }) => {
      const res = await request(app)[m](url).set('Authorization', 'Bearer tok');
      expect(res.status).toBe(404);
      expect(SERVICES.every(s => s.mock.calls.length === 0)).toBe(true);
    });

  it('the token is never accepted from the URL', async () => {
    for (const url of [`/api/access-invitations/accept?token=${TOKEN}`, `/api/access-invitations/accept/${TOKEN}`]) {
      const res = await request(app).post(url).set('Authorization', 'Bearer tok').send({});
      expect([400, 404]).toContain(res.status);
    }
    expect(mocks.acceptProfessionalGrant).not.toHaveBeenCalled();
  });

  it('only api/_server.ts imports and registers the adapter, exactly once', () => {
    const users = sourceFiles(ROOT)
      .filter(f => !f.endsWith(path.join('api', 'matterAccessLifecycleRoutes.ts')))
      .filter(f => /matterAccessLifecycleRoutes|registerMatterAccessLifecycleRoutes/.test(fs.readFileSync(f, 'utf8')));
    expect(users.map(f => path.relative(ROOT, f))).toEqual([path.join('api', '_server.ts')]);
    const src = fs.readFileSync(path.join(ROOT, 'api', '_server.ts'), 'utf8');
    expect(src.match(/registerMatterAccessLifecycleRoutes\(app\)/g)).toHaveLength(1);
    // The server exposes no lifecycle service directly.
    expect(src).not.toMatch(/createProfessionalGrant|acceptProfessionalGrant|revokeProfessionalGrant/);
  });

  it('the global per-IP /api limiter is still registered, before every lifecycle route', () => {
    const stack: any[] = (app as any)._router.stack;
    // express-rate-limit's middleware is anonymous; it is the one global layer mounted at /api only.
    // Its behavior (a real 429 per IP on a lifecycle route) is proven in matterAccessActivation.pg.test.ts.
    const limiterIdx = stack.findIndex(l => !l.route && l.regexp.test('/api') && !l.regexp.test('/') && l.handle.length === 3);
    const firstLifecycle = stack.findIndex(l => l.route && Object.values(LIFECYCLE_ROUTE_PATHS).includes(l.route.path));
    expect(limiterIdx).toBeGreaterThanOrEqual(0);
    expect(limiterIdx).toBeLessThan(firstLifecycle);
    expect(stack[limiterIdx].match('/api/access-invitations/accept')).toBeTruthy();
  });
});
