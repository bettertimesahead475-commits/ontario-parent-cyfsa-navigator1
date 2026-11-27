// T-14 (a): every /api route that needs a user or an administrator refuses missing, malformed, expired, forged and
// mis-scoped Firebase tokens with real signature verification, and does nothing (no database, storage, credit or
// provider request) for a refused caller.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROJECT, installFirebase, sharedFetcher, type Firebase } from './_firebase';
import { handleAnalyzeRequest } from '../../functions/api/analyze';
import { handleDeepScanRequest } from '../../functions/api/deep-scan';
import { handleExtractRequest } from '../../functions/api/extract-text';
import { onRequestPost as transcribe } from '../../functions/api/transcribe';
import { onRequestPost as transcribeAudio } from '../../functions/api/transcribe-audio';
import { handleAssessment } from '../../functions/api/final-case-assessment';
import { handleProfessionalWorkspace } from '../../functions/api/professional-workspace/[[path]]';
import { onRequestGet as jobStatus } from '../../functions/api/analyze/job/[jobId]';
import { handleAdminRequest } from '../../functions/api/admin/[[path]]';
import { onRequestGet as geminiModels } from '../../functions/api/admin/gemini-models';
import { onRequestPost as activateCode } from '../../functions/api/activate-code';
import { onRequestGet as analyzerUsage } from '../../functions/api/analyzer-usage';

const env: any = {
  FIREBASE_PROJECT_ID: PROJECT, ANALYZER_ENABLED: 'true', ANTHROPIC_API_KEY: 'sk-ant-synthetic-not-a-key', GEMINI_API_KEY: 'synthetic-gemini',
  STAGING_SUPABASE_URL: 'https://synthetic.supabase.test/', STAGING_SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2ln',
  ADMIN_EMAILS: 'admin@example.test',
};
const JOB = 'req_1795545140117_victimjob001';
let fb: Firebase;
beforeEach(async () => { vi.unstubAllGlobals(); fb = await installFirebase(); vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });

const req = (path: string, auth: string | null, method = 'POST', body: unknown = { documentText: 'Synthetic note.', mode: 'fast', stream: false }, extra: Record<string, string> = {}) =>
  new Request(`https://cyfsa.test${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'X-PS-Session': '11111111-2222-4333-8444-555555555555', ...(auth === null ? {} : { Authorization: auth }), ...extra },
    body: method === 'GET' ? undefined : JSON.stringify(body),
  });

type Route = { name: string; call: (auth: string | null) => Promise<Response> };
const rpc = vi.fn(); const generate = vi.fn();
const deps = () => ({ fetcher: sharedFetcher(), rpc, generate });
const ROUTES: Route[] = [
  { name: 'POST /api/analyze', call: (a) => handleAnalyzeRequest(req('/api/analyze', a), env, deps()) },
  { name: 'POST /api/deep-scan', call: (a) => handleDeepScanRequest(req('/api/deep-scan', a), env, deps()) },
  { name: 'POST /api/extract-text', call: (a) => handleExtractRequest(req('/api/extract-text', a, 'POST', { fileData: { base64: btoa('Synthetic text.'), mimeType: 'text/plain' } }), env, { fetcher: sharedFetcher() }) },
  { name: 'POST /api/transcribe', call: (a) => transcribe({ request: req('/api/transcribe', a, 'POST', { audioData: btoa('RIFF'), mimeType: 'audio/wav' }), env }) },
  { name: 'POST /api/transcribe-audio', call: (a) => transcribeAudio({ request: req('/api/transcribe-audio', a, 'POST', { audioData: btoa('RIFF'), mimeType: 'audio/wav' }), env }) },
  { name: 'GET /api/final-case-assessment', call: (a) => handleAssessment(req('/api/final-case-assessment', a, 'GET'), env, deps()) },
  { name: 'POST /api/final-case-assessment?action=create-matter', call: (a) => handleAssessment(req('/api/final-case-assessment?action=create-matter', a, 'POST', { title: 'x', requestId: '11111111-2222-4333-8444-555555555555' }), env, deps()) },
  { name: 'GET /api/professional-workspace/matters', call: (a) => handleProfessionalWorkspace(req('/api/professional-workspace/matters', a, 'GET'), env, { fetcher: sharedFetcher() }) },
  { name: 'GET /api/analyze/job/:id', call: (a) => jobStatus({ request: req(`/api/analyze/job/${JOB}`, a, 'GET'), env, params: { jobId: JOB } }) },
  { name: 'POST /api/activate-code', call: (a) => activateCode({ request: req('/api/activate-code', a, 'POST', { code: 'CYFSA-AAAA-BBBB-CCCC', email: 'a@example.test' }), env } as any) },
  { name: 'GET /api/admin/customers', call: (a) => handleAdminRequest(req('/api/admin/customers', a, 'GET'), env, { fetcher: sharedFetcher() }) },
  { name: 'POST /api/admin/credits/restore', call: (a) => handleAdminRequest(req('/api/admin/credits/restore', a, 'POST', { uid: 'user_a', amount: 99 }), env, { fetcher: sharedFetcher() }) },
];

const now = () => Math.floor(Date.now() / 1000);
const BAD_TOKENS: Array<[string, () => Promise<string | null>]> = [
  ['no Authorization header', async () => null],
  ['a non-Bearer scheme', async () => `Basic ${btoa('user_a:pw')}`],
  ['a malformed token', async () => 'Bearer not.a-token'],
  ['an expired token', async () => `Bearer ${await fb.token({ exp: now() - 1 })}`],
  ['a token for another Firebase project', async () => `Bearer ${await fb.token({ aud: 'other-project' })}`],
  ['a token from another issuer', async () => `Bearer ${await fb.token({ iss: 'https://evil.test/' + PROJECT })}`],
  ['an unsigned alg=none token', async () => { const t = await fb.token({}, { alg: 'none' }); return `Bearer ${t}`; }],
  ['an HS256 token', async () => `Bearer ${await fb.token({}, { alg: 'HS256' })}`],
  ['a token signed by an attacker key under Google\'s key id', async () => `Bearer ${await fb.token({}, { signer: 'attacker' })}`],
  ['a token with a tampered uid', async () => { const [h, , s] = (await fb.token()).split('.'); const p = Buffer.from(JSON.stringify({ aud: PROJECT, iss: `https://securetoken.google.com/${PROJECT}`, sub: 'victim', iat: now() - 60, auth_time: now() - 60, exp: now() + 3600 })).toString('base64url'); return `Bearer ${h}.${p}.${s}`; }],
  ['a token issued in the future', async () => `Bearer ${await fb.token({ iat: now() + 600 })}`],
  ['a token without a subject', async () => `Bearer ${await fb.token({ sub: '' })}`],
];

describe('authz bypass: refused tokens never reach data', () => {
  for (const route of ROUTES) {
    it.each(BAD_TOKENS)(`${route.name} refuses %s with 401 and makes no request`, async (_label, make) => {
      const res = await route.call(await make());
      expect(res.status).toBe(401);
      expect(fb.calls).toEqual([]);
      expect(rpc).not.toHaveBeenCalled();
      expect(generate).not.toHaveBeenCalled();
      const text = await res.text();
      expect(text).not.toMatch(/user_a|victim|synthetic\.supabase|service_role/);
    });
  }

  it('an unknown key id is refused, and a burst of forged key ids cannot force more than one key refresh', async () => {
    const fetchSpy = globalThis.fetch as any;
    const first = await ROUTES[0].call(`Bearer ${await fb.token({}, { kid: 'forged-1' })}`);
    expect(first.status).toBe(401);
    const second = await ROUTES[0].call(`Bearer ${await fb.token({}, { kid: 'forged-2' })}`);
    expect(second.status).toBe(503);
    const keyFetches = fetchSpy.mock.calls.filter(([u]: [string]) => String(u).includes('securetoken@system')).length;
    expect(keyFetches).toBe(2);
    expect(fb.calls).toEqual([]);
  });

  it('GET /api/analyzer-usage without a valid token returns only the static free allowance and reads nothing', async () => {
    for (const [, make] of BAD_TOKENS) {
      const res = await analyzerUsage({ request: req('/api/analyzer-usage?sessionId=11111111-2222-4333-8444-555555555555', await make(), 'GET'), env });
      expect(res.status).toBe(200);
      expect(await res.json()).toMatchObject({ type: 'free', signedIn: false });
    }
    expect(fb.calls).toEqual([]);
  });
});

describe('authz bypass: administrator routes', () => {
  const adminCall = (auth: string, e = env) => handleAdminRequest(req('/api/admin/customers', auth, 'GET'), e, { fetcher: sharedFetcher() });

  it.each([
    ['a verified non-administrator', { email: 'a@example.test' }, env],
    ['the administrator email, unverified', { email: 'admin@example.test', email_verified: false }, env],
    ['a look-alike administrator email', { email: 'admin@example.test.evil.test' }, env],
    ['the administrator email on an account outside ADMIN_UIDS', { email: 'admin@example.test', sub: 'not_pinned' }, { ...env, ADMIN_UIDS: 'pinned_admin_uid' }],
    ['the administrator email in an uppercase claim on an unpinned uid', { email: 'ADMIN@EXAMPLE.TEST', sub: 'Pinned_admin_uid' }, { ...env, ADMIN_UIDS: 'pinned_admin_uid' }],
  ])('%s gets 403 and no database read', async (_l, claims, e) => {
    const res = await adminCall(`Bearer ${await fb.token(claims)}`, e);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'ADMIN_REQUIRED' });
    expect(fb.calls).toEqual([]);
  });

  it('a genuine administrator token is accepted (the refusals above are not blanket failures)', async () => {
    fb.respond = () => Response.json([]);
    const res = await handleAdminRequest(req('/api/admin/access-codes', `Bearer ${await fb.token({ email: 'admin@example.test', sub: 'pinned_admin_uid' })}`, 'GET'), { ...env, ADMIN_UIDS: 'pinned_admin_uid' }, { fetcher: sharedFetcher() });
    expect(res.status).toBe(200);
    expect(fb.calls.length).toBeGreaterThan(0);
  });

  it('every administrator route requires the administrator check before any request', async () => {
    const routes = ['session', 'payments/overview', 'payments/audit-history', 'customers', 'access-codes', 'jobs', 'usage', 'revenue', 'audit', 'monitoring/status'].map((r) => ['GET', r])
      .concat(['payments/approve', 'payments/confirm-bank', 'payments/dispute', 'payments/reset-settlement', 'payments/refund', 'payments/reissue-code', 'payments/suspend', 'payments/restore', 'access-codes/revoke', 'credits/restore', 'monitoring/run'].map((r) => ['POST', r]));
    const userToken = `Bearer ${await fb.token({ email: 'a@example.test' })}`;
    for (const [method, route] of routes) {
      const anonymous = await handleAdminRequest(req(`/api/admin/${route}`, null, method, {}), env, { fetcher: sharedFetcher() });
      const user = await handleAdminRequest(req(`/api/admin/${route}`, userToken, method, {}), env, { fetcher: sharedFetcher() });
      expect([route, anonymous.status, user.status]).toEqual([route, 401, 403]);
    }
    expect(fb.calls).toEqual([]);
  });

  it('GET /api/admin/gemini-models accepts only the configured admin secret, never a Firebase token', async () => {
    const adminToken = `Bearer ${await fb.token({ email: 'admin@example.test' })}`;
    for (const [e, headers] of [
      [env, { Authorization: adminToken }],
      [{ ...env, ADMIN_SECRET: '' }, { 'x-admin-secret': '' }],
      [{ ...env, ADMIN_SECRET: 'synthetic-admin-secret' }, { 'x-admin-secret': 'synthetic-admin-secreT' }],
      [{ ...env, ADMIN_SECRET: 'synthetic-admin-secret' }, { 'x-admin-secret': 'synthetic-admin-secret-and-more' }],
    ] as const) {
      const res = await geminiModels({ request: new Request('https://cyfsa.test/api/admin/gemini-models', { headers: headers as any }), env: e as any });
      expect(res.status).toBe(401);
    }
    expect(fb.calls).toEqual([]);
  });

  it('the job-status admin header is refused when ADMIN_SECRET is unset or does not match', async () => {
    for (const [e, secret] of [[env, 'anything'], [{ ...env, ADMIN_SECRET: 'synthetic-admin-secret' }, 'synthetic-admin-secre']] as const) {
      const res = await jobStatus({ request: req(`/api/analyze/job/${JOB}`, null, 'GET', undefined, { 'x-admin-secret': secret }), env: e, params: { jobId: JOB } });
      expect(res.status).toBe(401);
    }
    expect(fb.calls).toEqual([]);
  });
});
