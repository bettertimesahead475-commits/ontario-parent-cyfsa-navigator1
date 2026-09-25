// Stage 10 slice 6: the UNMOUNTED lifecycle HTTP adapter, exercised on an isolated Express app
// (the adapter is deliberately not registered in api/_server.ts). The lifecycle service is mocked
// here to pin the adapter's own contract; real behavior is proven on PostgreSQL in
// matterAccessLifecycleRoutes.pg.test.ts.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

const TOKENS: Record<string, string> = { 'tok-owner': 'uid-owner', 'tok-pro': 'uid-pro' };
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

const { registerMatterAccessLifecycleRoutes, LIFECYCLE_ROUTE_PATHS } = await import('./matterAccessLifecycleRoutes.js');
const { LifecycleError } = await import('./services/lifecycleErrors.js');

const MATTER = '24000000-0000-4000-8000-00000000000a';
const OTHER_MATTER = '24000000-0000-4000-8000-0000000000ff';
const GRANT = '34000000-0000-4000-8000-000000000001';
const TOKEN = 'A'.repeat(21) + '_' + 'b'.repeat(20) + '-'; // 43 base64url characters
const RECIPIENT = 'pro@example.test';
const RB = { recipientEmail: RECIPIENT }; // the minimum valid create body since contract v4
const SERVICES = [mocks.createProfessionalGrant, mocks.acceptProfessionalGrant, mocks.revokeProfessionalGrant];
const serviceCalls = () => SERVICES.reduce((n, s) => n + s.mock.calls.length, 0);

function buildApp() {
  const app = express();
  app.use(express.json({ limit: '100mb' }));
  registerMatterAccessLifecycleRoutes(app);
  return app;
}
const app = buildApp();

const createUrl = (m = MATTER) => `/api/matters/${m}/access-grants`;
const revokeUrl = (g = GRANT) => `/api/access-grants/${g}/revoke`;
const ACCEPT_URL = '/api/access-invitations/accept';
const ROUTES = [
  { op: 'create', url: createUrl(), body: RB, service: mocks.createProfessionalGrant, unavailable: 'ACCESS_LIFECYCLE_UNAVAILABLE' },
  { op: 'accept', url: ACCEPT_URL, body: { token: TOKEN }, service: mocks.acceptProfessionalGrant, unavailable: 'ACCESS_LIFECYCLE_UNAVAILABLE' },
  { op: 'revoke', url: revokeUrl(), body: {}, service: mocks.revokeProfessionalGrant, unavailable: 'ACCESS_REVOCATION_UNCONFIRMED' },
] as const;

const post = (url: string, body: unknown = {}, token: string | null = 'tok-owner') => {
  const r = request(app).post(url);
  return (token ? r.set('Authorization', `Bearer ${token}`) : r).send(body as any);
};

beforeEach(() => {
  mocks.verifyFirebaseIdentity.mockReset().mockImplementation(async (h?: string) => {
    const m = /^Bearer (\S+)$/.exec(h ?? '');
    // Stage 10 slice 7: the verified token also carries the email claims.
    return m && TOKENS[m[1]] ? { uid: TOKENS[m[1]], email: `${TOKENS[m[1]].slice(4)}@example.test`, emailVerified: true } : null;
  });
  mocks.createProfessionalGrant.mockReset().mockResolvedValue({
    grant: { id: GRANT, matterId: MATTER, grantorAccountId: 'acct-owner-internal', capability: 'REVIEWER', status: 'PENDING',
      expiresAt: '2026-10-01T00:00:00.000Z', createdAt: '2026-09-24T00:00:00.000Z', recipientEmail: RECIPIENT },
    rawToken: TOKEN,
  });
  mocks.acceptProfessionalGrant.mockReset().mockResolvedValue({ success: true, matterId: MATTER });
  mocks.revokeProfessionalGrant.mockReset().mockResolvedValue({ success: true, membershipRemoved: true });
});

describe('Stage 10 slice 6: adapter contract (isolated app)', () => {
  it('declares exactly three POST routes', () => {
    const stack: any[] = (app as any)._router.stack;
    const routes = stack.filter(l => l.route).map(l => `${Object.keys(l.route.methods).join(',')} ${l.route.path}`);
    expect(routes).toEqual([
      `post ${LIFECYCLE_ROUTE_PATHS.create}`, `post ${LIFECYCLE_ROUTE_PATHS.accept}`, `post ${LIFECYCLE_ROUTE_PATHS.revoke}`,
    ]);
  });

  it('create: 201 with the path matter, the grant and the one-time token; nothing internal', async () => {
    const res = await post(createUrl(), { ...RB, expiresInDays: 3 });
    expect(res.status).toBe(201);
    expect(res.body).toEqual({
      matterId: MATTER,
      grant: { id: GRANT, status: 'PENDING', expiresAt: '2026-10-01T00:00:00.000Z', createdAt: '2026-09-24T00:00:00.000Z', recipientEmail: RECIPIENT },
      invitationToken: TOKEN,
    });
    expect(res.text).not.toContain('acct-owner-internal');
    expect(res.headers['cache-control']).toBe('no-store');
    expect(mocks.createProfessionalGrant).toHaveBeenCalledWith('uid-owner', MATTER, { recipientEmail: RECIPIENT, expiresInDays: 3 });
  });

  it('create: omitting expiresInDays leaves the service default in charge', async () => {
    await post(createUrl(), RB);
    expect(mocks.createProfessionalGrant).toHaveBeenCalledWith('uid-owner', MATTER, { recipientEmail: RECIPIENT });
  });

  it('create: the path matter is canonicalized and authoritative', async () => {
    await post(createUrl(MATTER.toUpperCase()), RB);
    expect(mocks.createProfessionalGrant.mock.calls[0][1]).toBe(MATTER);
  });

  it.each([
    ['matterId', { matterId: OTHER_MATTER }],
    ['matter_id', { matter_id: OTHER_MATTER }],
    ['uid', { uid: 'uid-other' }],
    ['role', { role: 'OWNER' }],
    ['grantorAccountId', { grantorAccountId: 'x' }],
    ['tokenDigest', { tokenDigest: 'a'.repeat(64) }],
  ])('create: a body %s cannot override anything; it is refused before the service', async (_k, body) => {
    const res = await post(createUrl(), { ...RB, ...body });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe('INVALID_REQUEST');
    expect(serviceCalls()).toBe(0);
  });

  it('create: query parameters (e.g. a second matterId) are refused', async () => {
    const res = await post(`${createUrl()}?matterId=${OTHER_MATTER}`, RB);
    expect(res.status).toBe(400);
    expect(serviceCalls()).toBe(0);
  });

  it.each([[0], [366], [1.5], ['7'], [null], [-1]])('create: expiresInDays %j is refused', async days => {
    const res = await post(createUrl(), { ...RB, expiresInDays: days });
    expect(res.status).toBe(400);
    expect(serviceCalls()).toBe(0);
  });

  it.each(['not-a-uuid', '24000000-0000-4000-8000-00000000000', "' OR 1=1 --"])('create: malformed matter id %j is a 400 without a service call', async m => {
    const res = await post(`/api/matters/${encodeURIComponent(m)}/access-grants`, RB);
    expect(res.status).toBe(400);
    expect(serviceCalls()).toBe(0);
  });

  it('create: a service result for a different matter is never returned (identity guard)', async () => {
    mocks.createProfessionalGrant.mockResolvedValue({ grant: { id: GRANT, matterId: OTHER_MATTER, status: 'PENDING' }, rawToken: TOKEN });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post(createUrl(), RB);
    spy.mockRestore();
    expect(res.status).toBe(503);
    expect(res.text).not.toContain(OTHER_MATTER);
    expect(res.text).not.toContain(TOKEN);
  });

  it('accept: 200 with the matter and REVIEWER role; the token comes only from the body', async () => {
    const res = await post(ACCEPT_URL, { token: TOKEN }, 'tok-pro');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ matterId: MATTER, role: 'REVIEWER' });
    expect(mocks.acceptProfessionalGrant).toHaveBeenCalledWith('uid-pro', TOKEN, { email: 'pro@example.test', emailVerified: true });
  });

  it.each([
    ['in the query string', `${ACCEPT_URL}?token=${TOKEN}`, {}],
    ['in the query string alongside the body', `${ACCEPT_URL}?token=${TOKEN}`, { token: TOKEN }],
  ])('accept: a token %s is refused', async (_l, url, body) => {
    const res = await post(url, body, 'tok-pro');
    expect(res.status).toBe(400);
    expect(serviceCalls()).toBe(0);
  });

  it.each([
    ['missing', {}], ['short', { token: 'abc' }], ['too long', { token: TOKEN + 'x' }], ['non-base64url', { token: TOKEN.slice(0, 42) + '=' }],
    ['a number', { token: 12345 }], ['an array', { token: [TOKEN] }], ['with extra fields', { token: TOKEN, matterId: MATTER }],
    ['an array body', [TOKEN]],
  ])('accept: a %s token is a 400 without a service call', async (_l, body) => {
    const res = await post(ACCEPT_URL, body, 'tok-pro');
    expect(res.status).toBe(400);
    expect(serviceCalls()).toBe(0);
  });

  it('accept: a form-encoded (simple cross-site) request never reaches the service', async () => {
    const res = await request(app).post(ACCEPT_URL).set('Authorization', 'Bearer tok-pro')
      .type('form').send(`token=${TOKEN}`);
    expect(res.status).toBe(400);
    expect(serviceCalls()).toBe(0);
  });

  it('revoke: 200 reporting only what this request did', async () => {
    const res = await post(revokeUrl(GRANT.toUpperCase()), {});
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ grantId: GRANT, status: 'REVOKED', accessRemovedByThisRequest: true });
    expect(mocks.revokeProfessionalGrant).toHaveBeenCalledWith('uid-owner', GRANT);
    mocks.revokeProfessionalGrant.mockResolvedValue({ success: true, membershipRemoved: false });
    expect((await post(revokeUrl(), {})).body.accessRemovedByThisRequest).toBe(false);
  });

  it.each([[{ matterId: MATTER }], [{ grantId: 'other' }]])('revoke: any body field is refused (%j)', async body => {
    const res = await post(revokeUrl(), body);
    expect(res.status).toBe(400);
    expect(serviceCalls()).toBe(0);
  });

  it('revoke: a malformed grant id is a 400 without a service call', async () => {
    expect((await post(revokeUrl('nope'), {})).status).toBe(400);
    expect(serviceCalls()).toBe(0);
  });
});

describe.each(ROUTES)('Stage 10 slice 6: $op authentication and failure contract', ({ op, url, body, service, unavailable }) => {
  it.each([
    ['no Authorization header', null],
    ['an unverifiable token', 'tok-expired-or-revoked'],
  ])('refuses %s with 401 before the service', async (_l, token) => {
    const res = await post(url, body, token);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ code: 'SIGN_IN_REQUIRED', error: 'Authentication required.' });
    expect(serviceCalls()).toBe(0);
  });

  it('refuses a non-Bearer scheme', async () => {
    const res = await request(app).post(url).set('Authorization', 'Basic dG9r').send(body);
    expect(res.status).toBe(401);
    expect(serviceCalls()).toBe(0);
  });

  it('passes the verified uid only; a uid in the body or query cannot be used', async () => {
    await post(url, body, 'tok-pro');
    expect(service.mock.calls[0][0]).toBe('uid-pro');
    expect(JSON.stringify(service.mock.calls[0])).not.toContain('uid-owner');
  });

  it('fails closed with a fixed 503 when identity verification throws', async () => {
    mocks.verifyFirebaseIdentity.mockRejectedValueOnce(new Error('firebase-admin: private_key parse failure'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post(url, body);
    const logged = JSON.stringify(spy.mock.calls);
    spy.mockRestore();
    expect(res.status).toBe(503);
    expect(res.body.code).toBe(unavailable);
    expect(res.text).not.toMatch(/private_key|firebase/i);
    expect(logged).not.toMatch(/private_key/);
    expect(serviceCalls()).toBe(0);
  });

  it.each([
    ['a raw database error', new Error('ERROR: insert or update on table "navigator_matter_access_grants" violates foreign key; uid-owner; SELECT *')],
    ['the contract error', new Error('Professional access is unavailable: the required access lifecycle contract is not installed.')],
    ['a thrown string', 'NOT_OWNER: raw'],
    ['an unexpected LifecycleError', new LifecycleError(500, 'INTERNAL', 'stack at /var/task/api/x.ts:12')],
  ])('maps %s to a fixed 503 and never echoes it (response or log)', async (_l, err) => {
    service.mockRejectedValue(err);
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await post(url, body);
    const logged = JSON.stringify(spy.mock.calls);
    spy.mockRestore();
    expect(res.status).toBe(503);
    expect(res.body.code).toBe(unavailable);
    expect(Object.keys(res.body).sort()).toEqual(['code', 'error']);
    expect(res.text).not.toMatch(/navigator_|SELECT|uid-owner|NOT_OWNER|contract|stack|var\/task/);
    expect(logged).not.toMatch(/navigator_|uid-owner|NOT_OWNER|var\/task/);
    expect(logged).toContain(`${op.toUpperCase()}_FAILED`);
  });

  it('handles a malformed JSON body with a fixed 400 (no parser internals)', async () => {
    const res = await request(app).post(url).set('Authorization', 'Bearer tok-owner')
      .set('Content-Type', 'application/json').send('{"token": "x",');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ code: 'INVALID_REQUEST_BODY', error: 'Invalid request body.' });
    expect(res.text).not.toMatch(/Unexpected|JSON\.parse|at /);
    expect(serviceCalls()).toBe(0);
  });

  it.each(['get', 'put', 'patch', 'delete'] as const)('has no %s handler', async method => {
    const res = await request(app)[method](url).set('Authorization', 'Bearer tok-owner');
    expect(res.status).toBe(404);
    expect(serviceCalls()).toBe(0);
  });
});

describe('Stage 10 slice 6: service refusals through the adapter (non-enumeration)', () => {
  it('create: missing account, non-owner and suspended account are one 403', async () => {
    const bodies = new Set<string>();
    for (const err of [new Error('Account not found'), new Error('UNAUTHORIZED: Only OWNER can grant access.'),
      new LifecycleError(403, 'ACCOUNT_UNAVAILABLE', 'Account is unavailable.')]) {
      mocks.createProfessionalGrant.mockRejectedValueOnce(err);
      const res = await post(createUrl(), RB);
      expect(res.status).toBe(403);
      bodies.add(res.text);
    }
    expect(bodies.size).toBe(1);
  });

  it('accept: unknown, used, revoked and expired invitations are one 410', async () => {
    const bodies = new Set<string>();
    for (const m of ['Invalid token.', 'Invitation is no longer pending.', 'Invitation has expired.']) {
      mocks.acceptProfessionalGrant.mockRejectedValueOnce(new Error(m));
      const res = await post(ACCEPT_URL, { token: TOKEN }, 'tok-pro');
      expect(res.status).toBe(410);
      bodies.add(res.text);
    }
    expect(bodies.size).toBe(1);
  });

  it('accept: an owner is told plainly (409) and is never reported as accepted', async () => {
    mocks.acceptProfessionalGrant.mockRejectedValueOnce(new Error('A matter owner cannot accept a professional invitation to their own matter.'));
    const res = await post(ACCEPT_URL, { token: TOKEN });
    expect(res.status).toBe(409);
    expect(res.body.code).toBe('OWNER_CANNOT_ACCEPT');
  });

  it('accept: a service result that is not a confirmed acceptance is not reported as success', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const r of [{ success: false, matterId: MATTER }, { success: true }, { success: true, matterId: 'not-a-uuid' }, null]) {
      mocks.acceptProfessionalGrant.mockResolvedValueOnce(r);
      expect((await post(ACCEPT_URL, { token: TOKEN }, 'tok-pro')).status).toBe(503);
    }
    spy.mockRestore();
  });

  it('revoke: missing account, unknown grant, non-owner and suspended account are one 404', async () => {
    const bodies = new Set<string>();
    for (const err of [new Error('Account not found'), new Error('Grant not found'),
      new Error('UNAUTHORIZED: Only OWNER can revoke access.'), new LifecycleError(403, 'ACCOUNT_UNAVAILABLE', 'x')]) {
      mocks.revokeProfessionalGrant.mockRejectedValueOnce(err);
      const res = await post(revokeUrl(), {});
      expect(res.status).toBe(404);
      bodies.add(res.text);
    }
    expect(bodies.size).toBe(1);
  });

  it('revoke: an unconfirmed revocation says access may not have been removed', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.revokeProfessionalGrant.mockRejectedValueOnce(new Error('Revocation failed. Access may not have been removed.'));
    const res = await post(revokeUrl(), {});
    mocks.revokeProfessionalGrant.mockResolvedValueOnce({ success: true });
    const res2 = await post(revokeUrl(), {});
    spy.mockRestore();
    for (const r of [res, res2]) {
      expect(r.status).toBe(503);
      expect(r.body).toEqual({ code: 'ACCESS_REVOCATION_UNCONFIRMED', error: 'Revocation could not be confirmed. Access may not have been removed.' });
    }
  });
});

describe('Stage 10 slice 7: recipient binding through the adapter', () => {
  it.each([
    ['missing', {}], ['empty', { recipientEmail: '' }], ['not a string', { recipientEmail: ['pro@example.test'] }],
    ['no @', { recipientEmail: 'pro.example.test' }], ['two @', { recipientEmail: 'a@b@c.test' }],
    ['non-ASCII', { recipientEmail: 'prö@example.test' }], ['too long', { recipientEmail: 'x'.repeat(251) + '@b.c' }],
    ['control character', { recipientEmail: 'pro\u0001@example.test' }],
  ])('create: a %s recipientEmail is one constant 400 that never echoes the input; no service call', async (_l, body) => {
    const res = await post(createUrl(), body);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ code: 'INVALID_REQUEST', error: 'recipientEmail must be a valid email address.' });
    const raw = (body as any).recipientEmail;
    if (typeof raw === 'string' && raw) expect(res.text).not.toContain(raw);
    expect(serviceCalls()).toBe(0);
  });

  it('create: the recipient is canonicalized (trim + ASCII lower-case) before reaching the service', async () => {
    const res = await post(createUrl(), { recipientEmail: '  Pro@Example.TEST ' });
    expect(res.status).toBe(201);
    expect(mocks.createProfessionalGrant).toHaveBeenCalledWith('uid-owner', MATTER, { recipientEmail: RECIPIENT });
  });

  it('create: a service result bound to a different recipient is not reported as success', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    mocks.createProfessionalGrant.mockResolvedValueOnce({
      grant: { id: GRANT, matterId: MATTER, status: 'PENDING', expiresAt: 'x', createdAt: 'y', recipientEmail: 'other@example.test' }, rawToken: TOKEN,
    });
    const res = await post(createUrl(), RB);
    spy.mockRestore();
    expect(res.status).toBe(503);
    expect(res.text).not.toContain('other@example.test');
    expect(res.text).not.toContain(TOKEN);
  });

  it('create: the service refusing an invalid recipient is the same constant 400', async () => {
    mocks.createProfessionalGrant.mockRejectedValueOnce(new Error('Recipient email must be a valid address.'));
    const res = await post(createUrl(), RB);
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ code: 'INVALID_REQUEST', error: 'recipientEmail must be a valid email address.' });
  });

  it.each([['email'], ['recipientEmail'], ['emailVerified'], ['email_verified'], ['uid']])(
    'accept: a body %s is refused as an extra field; identity never comes from the request', async key => {
      const res = await post(ACCEPT_URL, { token: TOKEN, [key]: key.startsWith('email') && key !== 'email' ? true : 'owner@example.test' }, 'tok-pro');
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_REQUEST');
      expect(serviceCalls()).toBe(0);
    });

  it('accept: an email in the query string is refused', async () => {
    const res = await post(`${ACCEPT_URL}?email=owner@example.test`, { token: TOKEN }, 'tok-pro');
    expect(res.status).toBe(400);
    expect(serviceCalls()).toBe(0);
  });

  it('accept: the email and its verification status are passed exactly as the verified token reported them', async () => {
    mocks.verifyFirebaseIdentity.mockResolvedValueOnce({ uid: 'uid-pro', email: 'Pro@Example.test', emailVerified: false });
    mocks.acceptProfessionalGrant.mockRejectedValueOnce(new Error('Verified email required.'));
    await post(ACCEPT_URL, { token: TOKEN }, 'tok-pro');
    expect(mocks.acceptProfessionalGrant).toHaveBeenCalledWith('uid-pro', TOKEN, { email: 'Pro@Example.test', emailVerified: false });
  });

  it('accept: an unverified email is a token-independent 403 EMAIL_NOT_VERIFIED', async () => {
    const bodies = new Set<string>();
    for (const t of [TOKEN, 'Z'.repeat(43)]) {
      mocks.acceptProfessionalGrant.mockRejectedValueOnce(new Error('Verified email required.'));
      const res = await post(ACCEPT_URL, { token: t }, 'tok-pro');
      expect(res.status).toBe(403);
      expect(res.body).toEqual({ code: 'EMAIL_NOT_VERIFIED', error: 'Sign in with a verified email address to accept this invitation.' });
      bodies.add(res.text);
    }
    expect(bodies.size).toBe(1);
  });

  it('accept: a non-recipient gets exactly the same 410 as an unknown token', async () => {
    mocks.acceptProfessionalGrant.mockRejectedValueOnce(new Error('Invalid token.'));
    const nonRecipient = await post(ACCEPT_URL, { token: TOKEN }, 'tok-pro');
    mocks.acceptProfessionalGrant.mockRejectedValueOnce(new Error('Invalid token.'));
    const unknown = await post(ACCEPT_URL, { token: 'Z'.repeat(43) }, 'tok-pro');
    expect(nonRecipient.status).toBe(410);
    expect(nonRecipient.text).toBe(unknown.text);
  });

  it('accept: a successful acceptance response carries no email', async () => {
    const res = await post(ACCEPT_URL, { token: TOKEN }, 'tok-pro');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('@');
  });
});
