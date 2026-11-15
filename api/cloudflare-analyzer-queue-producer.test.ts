import { beforeEach, describe, expect, it, vi } from 'vitest';
import { handleAnalyzeRequest, type AnalyzerEnv } from '../functions/api/analyze';
import { handleDeepScanRequest } from '../functions/api/deep-scan';
import { readVerifiedPaidSession } from '../functions/api/_supabase-paid-session';

const verify = vi.fn();
vi.mock('../functions/api/_auth-check', () => ({ verifyFirebaseRequest: (...args: unknown[]) => verify(...args) }));
vi.mock('../functions/api/_supabase-paid-session', () => ({ readVerifiedPaidSession: vi.fn() }));

const ENV = {
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

  it('fails closed when private Storage rejects the input write and never enqueues', async () => {
    const send = vi.fn();
    const rpc = vi.fn(async (name: string) => name === 'free_reserve_scan' ? { status: 'reserved', reservation_id: 'reservation_1' } : { status: 'released' });
    const response = await handleAnalyzeRequest(request('job_storage_fail_1'), { ...ENV, ANALYZER_JOBS_QUEUE: { send } } as AnalyzerEnv, { rpc, fetcher: fetcher({ storageStatus: 503 }) });
    expect(response.status).toBe(503);
    expect(send).not.toHaveBeenCalled();
    expect(rpc.mock.calls.map(([name]) => name)).toContain('free_release_scan');
  });
});
