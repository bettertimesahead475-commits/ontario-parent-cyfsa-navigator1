// Stage 10 slice 8: the per-account lifecycle WRITE limiter as enforced by the adapter.
// Isolated app, services mocked; real-server + real-PostgreSQL behavior is in matterAccessActivation.pg.test.ts.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const TOKENS: Record<string, string> = { 'tok-a': 'uid-account-a', 'tok-b': 'uid-account-b' };
const mocks = vi.hoisted(() => ({
  verifyFirebaseIdentity: vi.fn(),
  createProfessionalGrant: vi.fn(),
  acceptProfessionalGrant: vi.fn(),
  revokeProfessionalGrant: vi.fn(),
}));
vi.mock('./services/firebaseAdmin.js', () => ({ verifyFirebaseIdentity: mocks.verifyFirebaseIdentity }));
vi.mock('./services/professionalMatterAccess.js', () => ({
  createProfessionalGrant: mocks.createProfessionalGrant,
  acceptProfessionalGrant: mocks.acceptProfessionalGrant,
  revokeProfessionalGrant: mocks.revokeProfessionalGrant,
}));
const { registerMatterAccessLifecycleRoutes } = await import('./matterAccessLifecycleRoutes.js');
const { createAccountWriteLimiter } = await import('./services/lifecycleWriteLimiter.js');

const LIMIT = 3;
const limiter = createAccountWriteLimiter({ limit: LIMIT });
const app = express();
app.set('trust proxy', true); // so X-Forwarded-For really changes req.ip in this app
app.use(express.json());
registerMatterAccessLifecycleRoutes(app, { writeLimiter: limiter });

const MATTER = '26000000-0000-4000-8000-00000000000a';
const GRANT = '36000000-0000-4000-8000-000000000001';
const tok = (c: string) => c.repeat(43);
const create = (t: string | null, ip = '203.0.113.1') => {
  const r = request(app).post(`/api/matters/${MATTER}/access-grants`).set('X-Forwarded-For', ip);
  return (t ? r.set('Authorization', `Bearer ${t}`) : r).send({ recipientEmail: 'pro@example.test' });
};
const accept = (t: string | null, token = tok('A'), ip = '203.0.113.1') => {
  const r = request(app).post('/api/access-invitations/accept').set('X-Forwarded-For', ip);
  return (t ? r.set('Authorization', `Bearer ${t}`) : r).send({ token });
};
const revoke = (t: string | null) => request(app).post(`/api/access-grants/${GRANT}/revoke`).set('Authorization', `Bearer ${t}`).send({});
const RATE_LIMITED = { code: 'RATE_LIMITED', error: 'Too many invitation actions. Please wait a few minutes and try again.' };

beforeEach(() => {
  limiter.reset();
  mocks.verifyFirebaseIdentity.mockReset().mockImplementation(async (h?: string) => {
    const m = /^Bearer (\S+)$/.exec(h ?? '');
    return m && TOKENS[m[1]] ? { uid: TOKENS[m[1]], email: 'x@example.test', emailVerified: true } : null;
  });
  mocks.createProfessionalGrant.mockReset().mockResolvedValue({
    grant: { id: GRANT, matterId: MATTER, status: 'PENDING', expiresAt: 'x', createdAt: 'y', recipientEmail: 'pro@example.test' }, rawToken: tok('R'),
  });
  mocks.acceptProfessionalGrant.mockReset().mockRejectedValue(new Error('Invalid token.'));
  mocks.revokeProfessionalGrant.mockReset().mockResolvedValue({ success: true, membershipRemoved: false });
});

describe('Stage 10 slice 8: per-account lifecycle write limiter (adapter)', () => {
  it('owner create attempts consume the owner budget; the next is a constant 429 with Retry-After and no service call', async () => {
    for (let i = 0; i < LIMIT; i++) expect((await create('tok-a')).status).toBe(201);
    const res = await create('tok-a');
    expect(res.status).toBe(429);
    expect(res.body).toEqual(RATE_LIMITED);
    expect(Number(res.headers['retry-after'])).toBeGreaterThan(0);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(mocks.createProfessionalGrant).toHaveBeenCalledTimes(LIMIT);
  });

  it('accept attempts consume the authenticated professional budget -- failed attempts count too', async () => {
    for (let i = 0; i < LIMIT; i++) expect((await accept('tok-b')).status).toBe(410);
    expect((await accept('tok-b')).status).toBe(429);
    expect(mocks.acceptProfessionalGrant).toHaveBeenCalledTimes(LIMIT);
  });

  it('revoke attempts consume the owner budget, shared with create (one lifecycle-write budget per account)', async () => {
    await create('tok-a'); await revoke('tok-a'); await revoke('tok-a');
    expect((await revoke('tok-a')).status).toBe(429);
    expect((await create('tok-a')).status).toBe(429);
  });

  it('account A cannot exhaust account B', async () => {
    for (let i = 0; i < LIMIT + 5; i++) await create('tok-a');
    expect((await create('tok-a')).status).toBe(429);
    expect((await create('tok-b')).status).toBe(201);
    expect((await accept('tok-b')).status).toBe(410);
  });

  it('changing IP does not reset an account budget', async () => {
    for (let i = 0; i < LIMIT; i++) await create('tok-a', `198.51.100.${i}`);
    expect((await create('tok-a', '192.0.2.77')).status).toBe(429);
  });

  it('the same IP with different accounts does not share one budget', async () => {
    for (let i = 0; i < LIMIT; i++) await create('tok-a', '203.0.113.9');
    expect((await create('tok-a', '203.0.113.9')).status).toBe(429);
    expect((await create('tok-b', '203.0.113.9')).status).toBe(201);
  });

  it('changing the invitation token does not reset the budget, and no token is ever a key', async () => {
    const tokens = ['A', 'B', 'C', 'D', 'E'].map(tok);
    const statuses = [];
    for (const t of tokens) statuses.push((await accept('tok-b', t)).status);
    expect(statuses).toEqual([410, 410, 410, 429, 429]);
    expect(limiter.keys()).toEqual(['uid-account-b']);
    for (const t of tokens) expect(JSON.stringify(limiter.keys())).not.toContain(t);
  });

  it('unauthenticated requests are refused (401) before the limiter and never spend any budget', async () => {
    for (let i = 0; i < 20; i++) {
      expect((await create(null)).status).toBe(401);
      expect((await create('tok-unknown')).status).toBe(401);
      expect((await accept(null)).status).toBe(401);
    }
    expect(limiter.size()).toBe(0);
    expect((await create('tok-a')).status).toBe(201);
  });

  it('the 429 carries no uid, email, matter, grant or token', async () => {
    for (let i = 0; i < LIMIT; i++) await accept('tok-b');
    const res = await accept('tok-b', tok('Z'));
    expect(res.status).toBe(429);
    for (const s of ['uid-account-b', 'x@example.test', MATTER, GRANT, tok('Z')]) {
      expect(res.text).not.toContain(s);
      expect(JSON.stringify(res.headers)).not.toContain(s);
    }
  });
});
