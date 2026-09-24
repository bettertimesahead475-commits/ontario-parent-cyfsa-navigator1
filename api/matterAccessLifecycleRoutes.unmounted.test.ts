// Stage 10 slice 6: the lifecycle mutation adapter must NOT be reachable through the real
// application. Mounting it is a separate, decision-gated step (see STAGE_10_LIFECYCLE_HTTP_ADAPTER.md);
// this file fails the moment it is registered anywhere in the server composition.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import fs from 'fs';
import path from 'path';

const mocks = vi.hoisted(() => ({
  verifyFirebaseToken: vi.fn(async () => ({ uid: 'uid-owner', email: null })),
  createProfessionalGrant: vi.fn(),
  acceptProfessionalGrant: vi.fn(),
  revokeProfessionalGrant: vi.fn(),
}));
vi.mock('./services/firebaseAdmin.js', () => ({ verifyFirebaseToken: mocks.verifyFirebaseToken }));
vi.mock('./services/professionalMatterAccess.js', () => ({
  createProfessionalGrant: mocks.createProfessionalGrant,
  acceptProfessionalGrant: mocks.acceptProfessionalGrant,
  revokeProfessionalGrant: mocks.revokeProfessionalGrant,
}));

process.env.VERCEL = '1';
const { default: app } = await import('./_server.js');
const { LIFECYCLE_ROUTE_PATHS } = await import('./matterAccessLifecycleRoutes.js');

const MATTER = '25000000-0000-4000-8000-00000000000a';
const GRANT = '35000000-0000-4000-8000-000000000001';
const TOKEN = 'Q'.repeat(43);
const URLS = [
  `/api/matters/${MATTER}/access-grants`,
  '/api/access-invitations/accept',
  `/api/access-grants/${GRANT}/revoke`,
];
const ROOT = path.resolve(__dirname, '..');

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(d => {
    const p = path.join(dir, d.name);
    if (d.isDirectory()) return ['node_modules', 'dist', '.git'].includes(d.name) ? [] : sourceFiles(p);
    return /\.(ts|tsx|js|mjs|cjs)$/.test(d.name) && !/\.test\.(ts|tsx)$/.test(d.name) ? [p] : [];
  });
}

beforeEach(() => {
  for (const f of [mocks.createProfessionalGrant, mocks.acceptProfessionalGrant, mocks.revokeProfessionalGrant]) f.mockReset();
});

describe('Stage 10 slice 6: the lifecycle mutation router is NOT mounted', () => {
  it('no lifecycle path is in the application route table', () => {
    const stack: any[] = (app as any)._router.stack;
    const paths = stack.filter(l => l.route).map(l => String(l.route.path));
    for (const p of Object.values(LIFECYCLE_ROUTE_PATHS)) expect(paths).not.toContain(p);
    // Nor its path-scoped body-parse error handler.
    expect(stack.filter(l => l.name === 'lifecycleBodyParseErrors')).toEqual([]);
  });

  it.each(URLS)('POST %s on the real server is unreachable (404) and reaches no lifecycle service', async url => {
    const res = await request(app).post(url).set('Authorization', 'Bearer any').send({ token: TOKEN, expiresInDays: 7 });
    expect(res.status).toBe(404);
    expect(res.body?.invitationToken).toBeUndefined();
    expect(mocks.createProfessionalGrant).not.toHaveBeenCalled();
    expect(mocks.acceptProfessionalGrant).not.toHaveBeenCalled();
    expect(mocks.revokeProfessionalGrant).not.toHaveBeenCalled();
  });

  it('no application entry point or server module imports or registers the adapter', () => {
    const offenders = sourceFiles(ROOT)
      .filter(f => !f.endsWith(path.join('api', 'matterAccessLifecycleRoutes.ts')))
      .filter(f => /matterAccessLifecycleRoutes|registerMatterAccessLifecycleRoutes/.test(fs.readFileSync(f, 'utf8')));
    expect(offenders.map(f => path.relative(ROOT, f))).toEqual([]);
  });

  it('the server composition still registers exactly the known Stage 10 read routes and no access mutation', () => {
    const src = fs.readFileSync(path.join(ROOT, 'api', '_server.ts'), 'utf8');
    expect(src).not.toMatch(/access-grants|access-invitations|createProfessionalGrant|acceptProfessionalGrant|revokeProfessionalGrant/);
    const stack: any[] = (app as any)._router.stack;
    const accessRoutes = stack.filter(l => l.route && /access-(audit|events|history|grants?)|invitation|\/grants?\b/.test(l.route.path))
      .map(l => `${Object.keys(l.route.methods).join(',').toUpperCase()} ${l.route.path}`).sort();
    expect(accessRoutes).toEqual([
      'GET /api/matters/:matterId/access-audit',
      'GET /api/matters/:matterId/access-events',
      'GET /api/matters/:matterId/access-history',
    ]);
  });
});
