// T-14 (b): a verified user who presents another user's analyzer job id, assessment/report, matter (case file),
// evidence id or paid-session (credit) id gets a refusal with none of the other user's data and no write.
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { PROJECT, installFirebase, sharedFetcher, type Firebase } from './_firebase';
import { fakeSupabase, type FakeSupabase } from './_supabase';
import { handleAnalyzeRequest } from '../../functions/api/analyze';
import { handleDeepScanRequest } from '../../functions/api/deep-scan';
import { handleAssessment } from '../../functions/api/final-case-assessment';
import { handleProfessionalWorkspace } from '../../functions/api/professional-workspace/[[path]]';
import { onRequestGet as jobStatus } from '../../functions/api/analyze/job/[jobId]';
import { onRequestGet as analyzerUsage } from '../../functions/api/analyzer-usage';

const env: any = {
  FIREBASE_PROJECT_ID: PROJECT, ANALYZER_ENABLED: 'true', ANTHROPIC_API_KEY: 'sk-ant-synthetic-not-a-key',
  STAGING_SUPABASE_URL: 'https://synthetic.supabase.test/', STAGING_SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.c2ln',
};
const SESSION_A = '0a0a0a0a-1111-4222-8333-444444444444';
const SESSION_B = '0b0b0b0b-1111-4222-8333-444444444444';
const MATTER_A = 'aaaaaaaa-1111-4222-8333-444444444444';
const MATTER_B = 'bbbbbbbb-1111-4222-8333-444444444444';
const EVIDENCE_B = 'eeeeeeee-1111-4222-8333-444444444444';
const VICTIM_JOB = 'req_1795545140117_victimjob001';
const SECRET = 'VICTIM-PRIVATE-FINDING-7731';

let fb: Firebase; let db: FakeSupabase; let tokenA: string;
const year = 365 * 86400_000;
const paid = (id: string, uid: string) => ({ id, firebase_uid: uid, tier: 'Pro', issued_at: new Date(Date.now() - 1000).toISOString(), expires_at: new Date(Date.now() + year).toISOString(), revoked_at: null });

beforeEach(async () => {
  vi.unstubAllGlobals();
  fb = await installFirebase();
  db = fakeSupabase();
  fb.respond = db.handle;
  tokenA = `Bearer ${await fb.token({ sub: 'user_a', email: 'a@example.test' })}`;
  for (const m of ['warn', 'error', 'info', 'log'] as const) vi.spyOn(console, m).mockImplementation(() => {});
  db.tables = {
    accounts: [{ id: 'acct_a', status: 'active', firebase_uid: 'user_a' }, { id: 'acct_b', status: 'active', firebase_uid: 'user_b' }],
    navigator_paid_sessions: [paid(SESSION_A, 'user_a'), paid(SESSION_B, 'user_b')],
    navigator_matters: [{ id: MATTER_A, title: 'A matter', client_id: 'client_a', account_id: 'acct_a' }, { id: MATTER_B, title: SECRET, client_id: 'client_b', account_id: 'acct_b' }],
    navigator_matter_members: [
      { matter_id: MATTER_A, account_id: 'acct_a', role: 'OWNER' }, { matter_id: MATTER_A, account_id: 'acct_a', role: 'REVIEWER' },
      { matter_id: MATTER_B, account_id: 'acct_b', role: 'OWNER' }, { matter_id: MATTER_B, account_id: 'acct_b', role: 'REVIEWER' },
    ],
    clients: [{ id: 'client_a', account_id: 'acct_a' }, { id: 'client_b', account_id: 'acct_b' }],
    navigator_evidence_items: [{ id: EVIDENCE_B, matter_id: MATTER_B, document_id: 'doc_b', document_version_id: 'v_b', page_id: 'p_b', page_number: 1, summary: SECRET }],
    professional_reviews: [{ id: 'r_b', matter_id: MATTER_B, reviewer_account_id: 'acct_b', notes: SECRET }],
  };
  db.jobs[VICTIM_JOB] = { job_id: VICTIM_JOB, owner_uid: 'user_b', status: 'completed', stage: 'complete', progress: 100 };
  db.objects[VICTIM_JOB] = { uid: 'user_b', status: 'completed', report: { fileSummary: SECRET } };
});

const call = (path: string, method = 'GET', body?: unknown, headers: Record<string, string> = {}) => new Request(`https://cyfsa.test${path}`, {
  method, headers: { Authorization: tokenA, 'Content-Type': 'application/json', ...headers }, body: body === undefined ? undefined : JSON.stringify(body),
});
const noLeak = async (res: Response) => { const text = await res.text(); expect(text).not.toContain(SECRET); expect(text).not.toMatch(/user_b|acct_b|client_b|0b0b0b0b/); };
const noWrites = () => expect(db.writes).toEqual([]);

describe('IDOR: analyzer jobs and reports', () => {
  it("polling another user's ledger job is 403 and the report object is never read", async () => {
    const res = await jobStatus({ request: call(`/api/analyze/job/${VICTIM_JOB}`), env, params: { jobId: VICTIM_JOB } });
    expect(res.status).toBe(403);
    await noLeak(res);
    expect(db.reads).not.toContain('object:' + VICTIM_JOB);
    noWrites();
  });

  it("polling another user's legacy storage-only job is 403 with no data", async () => {
    delete db.jobs[VICTIM_JOB];
    const res = await jobStatus({ request: call(`/api/analyze/job/${VICTIM_JOB}`), env, params: { jobId: VICTIM_JOB } });
    expect(res.status).toBe(403);
    await noLeak(res);
    noWrites();
  });

  it("polling a retry suffix of another user's job is still refused", async () => {
    const retry = VICTIM_JOB + '-r1';
    db.jobs[retry] = { ...db.jobs[VICTIM_JOB], job_id: retry };
    const res = await jobStatus({ request: call(`/api/analyze/job/${retry}`), env, params: { jobId: retry } });
    expect(res.status).toBe(403);
    await noLeak(res);
  });

  it.each([
    ['/api/analyze', handleAnalyzeRequest],
    ['/api/deep-scan', handleDeepScanRequest],
  ] as const)("%s refuses another user's job id as X-Analysis-Id before any credit, inference or write", async (path, handler) => {
    const rpc = vi.fn(); const generate = vi.fn();
    const res = await handler(call(path, 'POST', { documentText: 'Synthetic affidavit text.', mode: 'fast', stream: false }, { 'X-Analysis-Id': VICTIM_JOB }), env, { fetcher: sharedFetcher(), rpc, generate });
    expect(res.status).toBe(409);
    expect(await res.clone().json()).toMatchObject({ code: 'ANALYSIS_ID_CONFLICT' });
    await noLeak(res);
    expect(rpc).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    noWrites();
  });
});

describe('IDOR: paid sessions (credits)', () => {
  it("analyzer-usage with another user's session id returns the caller's own free usage, not the paid session", async () => {
    const res = await analyzerUsage({ request: call(`/api/analyzer-usage?sessionId=${SESSION_B}`, 'GET', undefined, { 'x-ps-session': SESSION_B }), env });
    const body = await res.clone().json();
    expect(body.type).toBe('free');
    expect(body.tier).toBe('Free');
    await noLeak(res);
    noWrites();
  });

  it("a Pro session belonging to another user does not unlock Final Case Assessment", async () => {
    const res = await handleAssessment(call(`/api/final-case-assessment?matterId=${MATTER_B}`, 'GET', undefined, { 'X-PS-Session': SESSION_B }), env, { fetcher: sharedFetcher(), rpc: vi.fn(), generate: vi.fn() } as any);
    expect(res.status).toBe(403);
    expect(await res.clone().json()).toMatchObject({ code: 'INDIVIDUAL_CASE_ACCESS_REQUIRED' });
    await noLeak(res);
    expect(db.reads.filter((r) => r !== 'navigator_paid_sessions')).toEqual([]);
    noWrites();
  });

  it("analyze with another user's paid session id never reserves against that session", async () => {
    const rpc = vi.fn(async () => { throw new Error('stop after reservation attempt'); });
    const res = await handleAnalyzeRequest(call('/api/analyze', 'POST', { documentText: 'Synthetic affidavit text.', mode: 'full', stream: false }, { 'X-PS-Session': SESSION_B }), env, { fetcher: sharedFetcher(), rpc, generate: vi.fn() } as any);
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify([rpc.mock.calls, db.rpcs, db.writes])).not.toContain(SESSION_B);
    await noLeak(res);
  });
});

describe('IDOR: Final Case Assessment matters and reports', () => {
  const fca = (path: string, method = 'GET', body?: unknown) =>
    handleAssessment(call(path, method, body, { 'X-PS-Session': SESSION_A }), env, { fetcher: sharedFetcher(), rpc: vi.fn(), generate: vi.fn() } as any);

  it.each([
    ['read the latest report', `/api/final-case-assessment?matterId=${MATTER_B}`, 'GET', undefined],
    ['generate a report', `/api/final-case-assessment?matterId=${MATTER_B}`, 'POST', {}],
    ['add a source', `/api/final-case-assessment?matterId=${MATTER_B}&action=source`, 'POST', { filename: 'x.txt', text: 'Synthetic.' }],
  ])("another user's matter id cannot be used to %s: 404, no object read, no write", async (_l, path, method, body) => {
    const res = await fca(path, method, body);
    expect(res.status).toBe(404);
    expect(await res.clone().json()).toMatchObject({ code: 'MATTER_NOT_FOUND' });
    await noLeak(res);
    expect(db.reads.some((r) => r.startsWith('object:'))).toBe(false);
    noWrites();
  });

  it('listing matters returns only the caller\'s own', async () => {
    const res = await fca('/api/final-case-assessment');
    expect(res.status).toBe(200);
    expect((await res.clone().json()).matters).toEqual([expect.objectContaining({ id: MATTER_A })]);
    await noLeak(res);
  });

  it("a stored assessment whose owner fields name another user is refused even on the caller's own matter", async () => {
    db.objects = new Proxy({}, { has: (_t, k) => String(k).startsWith('assessment_'), get: () => ({ uid: 'user_b', matterId: MATTER_A, status: 'completed', report: { summary: SECRET } }) }) as any;
    const res = await fca(`/api/final-case-assessment?matterId=${MATTER_A}`);
    expect(res.status).toBe(404);
    expect(await res.clone().json()).toMatchObject({ code: 'REPORT_NOT_FOUND' });
    await noLeak(res);
  });
});

describe('IDOR: professional workspace case files', () => {
  const ws = (path: string) => handleProfessionalWorkspace(call(`/api/professional-workspace/${path}`), env, { fetcher: sharedFetcher() });
  const DATA_TABLES = ['navigator_documents', 'navigator_events', 'navigator_claims', 'navigator_evidence_items', 'professional_reviews', 'navigator_document_pages', 'navigator_action_evidence_links'];

  it.each(['overview', 'evidence', `evidence/${EVIDENCE_B}/source`, 'reviews', 'reviews/EVIDENCE'])(
    "another user's matter %s is 403 before any case-file table is read", async (suffix) => {
      const res = await ws(`matters/${MATTER_B}/${suffix}`);
      expect(res.status).toBe(403);
      await noLeak(res);
      expect(db.reads.filter((t) => DATA_TABLES.includes(t))).toEqual([]);
      noWrites();
    });

  it("another matter's evidence id under the caller's own matter is 404 with no page read", async () => {
    const res = await ws(`matters/${MATTER_A}/evidence/${EVIDENCE_B}/source`);
    expect(res.status).toBe(404);
    await noLeak(res);
    expect(db.reads).not.toContain('navigator_document_pages');
    noWrites();
  });

  it("the matter list contains only the caller's reviewer memberships", async () => {
    db.tables.navigator_matter_members = db.tables.navigator_matter_members.map((m) => ({ ...m, navigator_matters: { title: m.matter_id === MATTER_B ? SECRET : 'A matter' } }));
    const res = await ws('matters');
    expect(res.status).toBe(200);
    expect((await res.clone().json()).map((m: any) => m.id)).toEqual([MATTER_A]);
    await noLeak(res);
  });

  it.each(['../matters', `matters/${MATTER_B.toUpperCase()}%2F..%2F${MATTER_A}/overview`, 'matters/not-a-uuid/overview'])('path tricks %s do not reach another matter', async (p) => {
    const res = await ws(p);
    expect([403, 404]).toContain(res.status);
    await noLeak(res);
    expect(db.reads.filter((t) => DATA_TABLES.includes(t))).toEqual([]);
  });
});
