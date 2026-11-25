import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAnalyzeRequest, type AnalyzerEnv } from '../functions/api/analyze';
import { handleDeepScanRequest } from '../functions/api/deep-scan';
import { readVerifiedPaidSession } from '../functions/api/_supabase-paid-session';

const verify = vi.fn();
vi.mock('../functions/api/_auth-check', () => ({ verifyFirebaseRequest: (...args: unknown[]) => verify(...args) }));
vi.mock('../functions/api/_supabase-paid-session', () => ({ readVerifiedPaidSession: vi.fn() }));

const ENV = {
  // Queue-specific legacy Quick Review tests intentionally opt in. The live default is direct.
  QUEUE_QUICK_ANALYSIS: 'true',
  ANALYZER_ENABLED: 'true', FIREBASE_PROJECT_ID: 'firebase-test', ANTHROPIC_API_KEY: 'test-key',
  STAGING_SUPABASE_URL: 'https://project.supabase.co', STAGING_SUPABASE_SERVICE_ROLE_KEY: 'service-key',
} as unknown as AnalyzerEnv;
const documentText = 'Private affidavit evidence';

function request(id = 'job_producer_1234') {
  return new Request('https://navigator.test/api/analyze', {
    method: 'POST', headers: { Authorization: 'Bearer firebase-token', 'Content-Type': 'application/json', 'X-Analysis-Id': id, Accept: 'application/json' },
    body: JSON.stringify({ documentText, mode: 'fast', stream: false }),
  });
}

function fetcher(options: { storageStatus?: number } = {}) {
  return vi.fn(async (url: string) => {
    if (url.includes('/rpc/analyzer_create_job')) return Response.json({ job_id: 'job_producer_1234' });
    if (url.includes('/storage/v1/object/')) return new Response('', { status: options.storageStatus || 200 });
    return Response.json({ status: 'released' });
  }) as unknown as typeof fetch;
}

describe('durable analyzer queue producer', () => {
  beforeEach(() => {
    verify.mockReset().mockResolvedValue({ status: 'verified', uid: 'owner_1234', emailVerified: false, email: null });
  });

  it('fails a Queue-required Deep Scan before reserving or charging if Pages has no binding', async () => {
    const rpc = vi.fn();
    const fetchImpl = vi.fn();
    const generate = vi.fn();
    const req = new Request('https://navigator.test/api/deep-scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ documentText, mode: 'full' }),
    });
    const response = await handleDeepScanRequest(req, {
      ...ENV, FORENSIC_REQUIRE_QUEUE: 'true',
    }, { rpc, fetcher: fetchImpl as unknown as typeof fetch, generate });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: 'FORENSIC_QUEUE_UNAVAILABLE', retryable: true,
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('stores private input and enqueues only an opaque job identifier with HTTP 202', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const rpc = vi.fn(async () => ({ status: 'reserved', reservation_id: 'reservation_1' }));
    const fetchImpl = fetcher() as unknown as ReturnType<typeof vi.fn>;
    const response = await handleAnalyzeRequest(request(), { ...ENV, ANALYZER_JOBS_QUEUE: { send } } as AnalyzerEnv, { rpc, fetcher: fetchImpl as unknown as typeof fetch });
    const body = await response.json();
    expect(response.status).toBe(202);
    expect(body).toMatchObject({ jobId: 'job_producer_1234', status: 'queued', statusUrl: '/api/analyze/job/job_producer_1234' });
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({ version: 1, jobId: 'job_producer_1234' });
    expect(JSON.stringify(send.mock.calls)).not.toContain(documentText);
    const storagePost = fetchImpl.mock.calls.find(([url, init]) => String(url).includes('/storage/v1/object/') && init?.method === 'POST');
    expect(storagePost?.[1]?.body).toContain(documentText);
    expect(storagePost?.[0]).toContain('/analysis_jobs/inputs/job_producer_1234.json');
    for (const [url, init] of fetchImpl.mock.calls) {
      if (String(url).includes('/rpc/analyzer_create_job') || String(url).includes('/storage/v1/object/')) {
        expect(init?.redirect).toBe('manual');
      }
    }
  });

  it('enqueues an entitled Premium Deep Scan as full mode without calling Opus on Pages', async () => {
    verify.mockResolvedValueOnce({ status: 'verified', uid: 'premium_user_1', emailVerified: false, email: null });
    vi.mocked(readVerifiedPaidSession).mockResolvedValueOnce({
      status: 'verified',
      session: {
        sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
        ownerUid: 'premium_user_1',
        tier: 'Premium',
        issuedAt: '2026-11-01T00:00:00Z',
        expiresAt: '2026-12-01T00:00:00Z',
      },
    });
    const id = 'job_forensic_queued_123';
    const send = vi.fn().mockResolvedValue(undefined);
    const rpc = vi.fn(async () => ({ status: 'reserved', reservation_id: 'paid_reservation_1' }));
    const mockGenerate = vi.fn();
    const fetchImpl = fetcher() as unknown as ReturnType<typeof vi.fn>;
    const req = new Request('https://navigator.test/api/deep-scan', {
      method: 'POST',
      headers: { Authorization: 'Bearer firebase-token', 'Content-Type': 'application/json',
        'X-Analysis-Id': id, Accept: 'text/event-stream, application/json' },
      body: JSON.stringify({ documentText, mode: 'fast', stream: true,
        sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }),
    });
    const res = await handleDeepScanRequest(req,
      { ...ENV, ANALYZER_JOBS_QUEUE: { send } } as AnalyzerEnv,
      { rpc, fetcher: fetchImpl as unknown as typeof fetch, generate: mockGenerate });
    expect(res.status).toBe(202);
    expect(await res.json()).toMatchObject({
      jobId: id, status: 'queued', statusUrl: '/api/analyze/job/' + id, stream: 'poll',
    });
    expect(send).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith({ version: 1, jobId: id });
    expect(JSON.stringify(send.mock.calls)).not.toContain(documentText);
    expect(mockGenerate).not.toHaveBeenCalled();
    const insert = fetchImpl.mock.calls.find(([url]) => String(url).includes('/rpc/analyzer_create_job'));
    expect(JSON.parse(insert?.[1]?.body)).toMatchObject({
      p_mode: 'full',
      p_session_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      p_reservation_id: 'paid_reservation_1',
    });
    expect(rpc).toHaveBeenCalledWith('paid_reserve_credit', expect.objectContaining({ p_scope: 'total' }));
  });

  it('enqueues owner Forensic Deep Scan without a paid session or credit reservation', async () => {
    verify.mockResolvedValueOnce({ status: 'verified', uid: 'owner_1234', emailVerified: true, email: 'mr.pelkie@gmail.com' });
    const id = 'job_owner_forensic_123';
    const send = vi.fn().mockResolvedValue(undefined);
    const rpc = vi.fn();
    const req = new Request('https://navigator.test/api/deep-scan', {
      method: 'POST',
      headers: { Authorization: 'Bearer firebase-token', 'Content-Type': 'application/json', 'X-Analysis-Id': id },
      body: JSON.stringify({ documentText, mode: 'full', stream: false }),
    });
    const res = await handleDeepScanRequest(req, { ...ENV, ANALYZER_JOBS_QUEUE: { send } } as AnalyzerEnv,
      { rpc, fetcher: fetcher() });
    expect(res.status).toBe(202);
    expect(send).toHaveBeenCalledWith({ version: 1, jobId: id });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('releases the reservation and records failure if enqueue fails', async () => {
    const send = vi.fn().mockRejectedValue(new Error('Queue unavailable'));
    const rpc = vi.fn(async (name: string) => name === 'free_reserve_scan' ? { status: 'reserved', reservation_id: 'reservation_1' } : { status: 'released' });
    const response = await handleAnalyzeRequest(request('job_enqueue_fail_123'), { ...ENV, ANALYZER_JOBS_QUEUE: { send } } as AnalyzerEnv, { rpc, fetcher: fetcher() });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'ANALYSIS_ENQUEUE_FAILED' });
    expect(rpc.mock.calls.map(([name]) => name)).toContain('free_release_scan');
  });

  describe('duplicate analysis id (browser retry of the same click)', () => {
    function duplicateFetcher(existing: Record<string, unknown> | null) {
      return vi.fn(async (url: string) => {
        if (url.includes('/rpc/analyzer_create_job')) return Response.json({ code: '23505', message: 'duplicate key' }, { status: 409 });
        if (url.includes('/rpc/analyzer_get_job')) return Response.json(existing);
        if (url.includes('/rpc/analyzer_update_job')) return Response.json(true);
        return Response.json({ status: 'released' });
      }) as unknown as ReturnType<typeof vi.fn>;
    }
    function ownerForensic(id: string) {
      verify.mockResolvedValueOnce({ status: 'verified', uid: 'owner_1234', emailVerified: true, email: 'mr.pelkie@gmail.com' });
      return new Request('https://navigator.test/api/deep-scan', {
        method: 'POST',
        headers: { Authorization: 'Bearer firebase-token', 'Content-Type': 'application/json', 'X-Analysis-Id': id },
        body: JSON.stringify({ documentText, mode: 'full', stream: false }),
      });
    }

    it('points the caller at its existing queued job instead of failing it', async () => {
      // Regression: the producer marked the existing queued job failed (token-less queued -> failed).
      const id = 'job_owner_retry_123';
      const send = vi.fn();
      const fetchImpl = duplicateFetcher({ job_id: id, owner_uid: 'owner_1234', status: 'queued', mode: 'full' });
      const res = await handleDeepScanRequest(ownerForensic(id), { ...ENV, ANALYZER_JOBS_QUEUE: { send } } as AnalyzerEnv,
        { rpc: vi.fn(), fetcher: fetchImpl as unknown as typeof fetch });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'ANALYSIS_IN_PROGRESS', jobId: id, statusUrl: '/api/analyze/job/' + id });
      expect(fetchImpl.mock.calls.some(([url]) => String(url).includes('/rpc/analyzer_update_job'))).toBe(false);
      expect(send).not.toHaveBeenCalled();
    });

    it('sends the caller to recover an existing completed report', async () => {
      const id = 'job_owner_done_1234';
      const fetchImpl = duplicateFetcher({ job_id: id, owner_uid: 'owner_1234', status: 'completed', mode: 'full' });
      const res = await handleDeepScanRequest(ownerForensic(id), { ...ENV, ANALYZER_JOBS_QUEUE: { send: vi.fn() } } as AnalyzerEnv,
        { rpc: vi.fn(), fetcher: fetchImpl as unknown as typeof fetch });
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'ANALYSIS_ALREADY_COMPLETED', jobId: id });
    });

    it('never touches a job with the same id owned by someone else', async () => {
      const id = 'job_foreign_dupe_12';
      const fetchImpl = duplicateFetcher({ job_id: id, owner_uid: 'someone_else', status: 'queued', mode: 'full' });
      const res = await handleDeepScanRequest(ownerForensic(id), { ...ENV, ANALYZER_JOBS_QUEUE: { send: vi.fn() } } as AnalyzerEnv,
        { rpc: vi.fn(), fetcher: fetchImpl as unknown as typeof fetch });
      // Refused up front (security review): the id belongs to another user, so no credit is reserved,
      // no job is created, and the other user's job is never modified.
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({ code: 'ANALYSIS_ID_CONFLICT', retryable: false });
      expect(fetchImpl.mock.calls.some(([url]) => String(url).includes('/rpc/analyzer_create_job'))).toBe(false);
      expect(fetchImpl.mock.calls.some(([url]) => String(url).includes('/rpc/analyzer_update_job'))).toBe(false);
    });

    it('treats an unconfirmed insert as this request\'s own job: fails it and never reports it as running', async () => {
      // The insert may have committed even though its reply was lost; that row has no input or delivery.
      const id = 'job_ambiguous_ins1';
      const send = vi.fn();
      const fetchImpl = vi.fn(async (url: string) => {
        if (url.includes('/rpc/analyzer_create_job')) return new Response('upstream timeout', { status: 504 });
        if (url.includes('/rpc/analyzer_get_job')) return Response.json({ job_id: id, owner_uid: 'owner_1234', status: 'queued', mode: 'full' });
        if (url.includes('/rpc/analyzer_update_job')) return Response.json(true);
        return Response.json({ status: 'released' });
      }) as unknown as ReturnType<typeof vi.fn>;
      const res = await handleDeepScanRequest(ownerForensic(id), { ...ENV, ANALYZER_JOBS_QUEUE: { send } } as AnalyzerEnv,
        { rpc: vi.fn(), fetcher: fetchImpl as unknown as typeof fetch });
      expect(res.status).toBe(503);
      expect(await res.json()).toMatchObject({ code: 'ANALYSIS_ENQUEUE_FAILED' });
      const update = fetchImpl.mock.calls.find(([url]) => String(url).includes('/rpc/analyzer_update_job'));
      expect(JSON.parse(update?.[1]?.body)).toMatchObject({ p_job_id: id, p_status: 'failed', p_worker_token: null });
      expect(send).not.toHaveBeenCalled();
    });

    it('releases a reservation this request took when the existing job settles a different one', async () => {
      // Same analysis id under a different paid session: reservations are scoped by session, jobs are not.
      const id = 'job_other_session1';
      vi.mocked(readVerifiedPaidSession).mockResolvedValueOnce({ status: 'verified', session: {
        sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', ownerUid: 'owner_1234', tier: 'Premium', issuedAt: '2026-11-01T00:00:00Z', expiresAt: '2099-01-01T00:00:00Z',
      } });
      const rpc = vi.fn(async (name: string) => name === 'paid_reserve_credit' ? { status: 'reserved', reservation_id: 'fresh_res' } : { status: 'released' });
      const fetchImpl = duplicateFetcher({ job_id: id, owner_uid: 'owner_1234', status: 'running', mode: 'full', reservation_id: 'original_res' });
      const req = new Request('https://navigator.test/api/deep-scan', {
        method: 'POST',
        headers: { Authorization: 'Bearer firebase-token', 'Content-Type': 'application/json', 'X-Analysis-Id': id },
        body: JSON.stringify({ documentText, mode: 'full', stream: false, sessionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' }),
      });
      const res = await handleDeepScanRequest(req, { ...ENV, ANALYZER_JOBS_QUEUE: { send: vi.fn() } } as AnalyzerEnv,
        { rpc, fetcher: fetchImpl as unknown as typeof fetch });
      expect(res.status).toBe(409);
      expect(rpc).toHaveBeenCalledWith('paid_release_credit', expect.objectContaining({ p_reservation_id: 'fresh_res' }));
    });

    it('releases a fresh reservation when the existing job with that id already failed', async () => {
      const id = 'job_failed_dupe_123';
      const rpc = vi.fn(async (name: string) => name === 'free_reserve_scan' ? { status: 'reserved', reservation_id: 'reservation_2' } : { status: 'released' });
      const fetchImpl = duplicateFetcher({ job_id: id, owner_uid: 'owner_1234', status: 'failed', mode: 'fast' });
      const res = await handleAnalyzeRequest(request(id), { ...ENV, ANALYZER_JOBS_QUEUE: { send: vi.fn() } } as AnalyzerEnv,
        { rpc, fetcher: fetchImpl as unknown as typeof fetch });
      expect(res.status).toBe(503);
      expect(rpc.mock.calls.map(([name]) => name)).toContain('free_release_scan');
    });
  });

  it('fails closed when private Storage rejects the input write and never enqueues', async () => {
    const send = vi.fn();
    const rpc = vi.fn(async (name: string) => name === 'free_reserve_scan' ? { status: 'reserved', reservation_id: 'reservation_1' } : { status: 'released' });
    const response = await handleAnalyzeRequest(request('job_storage_fail_1'), { ...ENV, ANALYZER_JOBS_QUEUE: { send } } as AnalyzerEnv, { rpc, fetcher: fetcher({ storageStatus: 503 }) });
    expect(response.status).toBe(503);
    expect(send).not.toHaveBeenCalled();
    expect(rpc.mock.calls.map(([name]) => name)).toContain('free_release_scan');
  });
});

// Concurrency review 2026-11-25, finding 3: a Retry of a document whose queued job failed.
describe('Retry after a failed queued job', () => {
  beforeEach(() => {
    verify.mockReset().mockResolvedValue({ status: 'verified', uid: 'owner_1234', emailVerified: false, email: null });
  });
  function ledger(rows: Record<string, { owner_uid: string; status: string } | null>) {
    return vi.fn(async (url: string, init?: RequestInit) => {
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (url.includes('/rpc/analyzer_get_job')) return Response.json(rows[body.p_job_id] ? { job_id: body.p_job_id, ...rows[body.p_job_id] } : null);
      if (url.includes('/rpc/analyzer_create_job')) return rows[body.p_job_id] ? Response.json({ code: '23505' }, { status: 409 }) : Response.json({ job_id: body.p_job_id });
      if (url.includes('/storage/v1/object/')) return new Response('', { status: url.includes('/authenticated/') ? 400 : 200 });
      return Response.json({ status: 'released' });
    }) as unknown as ReturnType<typeof vi.fn>;
  }

  it('continues under the next attempt id: reservation, job and polled id all use it', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const rpc = vi.fn(async (_n: string, _a: Record<string, unknown>) => ({ status: 'reserved', reservation_id: 'reservation_r1' }));
    const fetchImpl = ledger({ job_producer_1234: { owner_uid: 'owner_1234', status: 'failed' } });
    const response = await handleAnalyzeRequest(request(), { ...ENV, ANALYZER_JOBS_QUEUE: { send } } as AnalyzerEnv, { rpc, fetcher: fetchImpl as unknown as typeof fetch });
    const body = await response.json();
    expect(response.status).toBe(202);
    expect(body).toMatchObject({ jobId: 'job_producer_1234-r1', statusUrl: '/api/analyze/job/job_producer_1234-r1' });
    expect(send).toHaveBeenCalledWith({ version: 1, jobId: 'job_producer_1234-r1' });
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_request: 'job_producer_1234-r1' });
  });

  it('follows a later attempt that is still running, and never touches rows of another user', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const rpc = vi.fn(async () => ({ status: 'reserved', reservation_id: 'reservation_x' }));
    const fetchImpl = ledger({
      job_producer_1234: { owner_uid: 'owner_1234', status: 'failed' },
      'job_producer_1234-r1': { owner_uid: 'someone_else', status: 'queued' },
      'job_producer_1234-r2': { owner_uid: 'owner_1234', status: 'running' },
    });
    const response = await handleAnalyzeRequest(request(), { ...ENV, ANALYZER_JOBS_QUEUE: { send } } as AnalyzerEnv, { rpc, fetcher: fetchImpl as unknown as typeof fetch });
    expect((rpc.mock.calls as unknown as Array<[string, Record<string, unknown>]>)[0]?.[1]).toMatchObject({ p_request: 'job_producer_1234-r2' });
    expect(response.status).not.toBe(202); // the live attempt is followed, not started again
  });

  it('keeps the original id when the existing job is not failed', async () => {
    const send = vi.fn().mockResolvedValue(undefined);
    const rpc = vi.fn(async () => ({ status: 'reserved', reservation_id: 'reservation_1' }));
    const fetchImpl = ledger({});
    const response = await handleAnalyzeRequest(request(), { ...ENV, ANALYZER_JOBS_QUEUE: { send } } as AnalyzerEnv, { rpc, fetcher: fetchImpl as unknown as typeof fetch });
    expect((await response.json()).jobId).toBe('job_producer_1234');
  });
});
