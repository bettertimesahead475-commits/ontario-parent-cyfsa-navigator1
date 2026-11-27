import { describe, expect, it, vi } from 'vitest';
import { SPEND_CAPS_OFF, freeIdentity, withFreeUsage } from './helpers/freeTrialTestEnv';

vi.mock('../functions/api/_auth-check', () => ({
  verifyFirebaseRequest: vi.fn(async (req: Request) => { const uid = req.headers.get('x-test-uid') || 'user_a'; return { status: 'verified', uid, emailVerified: true, email: `${uid}@example.com` }; }),
  onRequestGet: vi.fn(),
}));

import { jobOwnership } from '../functions/api/_durable-analysis-jobs';
import { handleAnalyzeRequest, type AnalyzerEnv } from '../functions/api/analyze';

// Claude's review of PR #137 (DEVIN-SEC-01): every outcome of the analysis-id ownership check, and proof that a
// refusal happens before any credit reservation, AI call or report write.
const env = {
  ANALYZER_ENABLED: 'true',
  ...SPEND_CAPS_OFF,
  STAGING_SUPABASE_URL: 'https://example.supabase.co',
  STAGING_SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_key_0000000000',
  ANTHROPIC_API_KEY: 'test',
  FIREBASE_PROJECT_ID: 'synthetic-project',
} as unknown as AnalyzerEnv;
const ID = 'req_1795545140117_ownerscase01';
const NOT_FOUND = () => new Response('{"statusCode":"404","error":"not_found"}', { status: 400 });

type Answer = () => Response | Promise<Response>;
function world(ledger: Answer, storage: Answer) {
  return vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes('/rpc/analyzer_get_job')) return ledger();
    if (url.includes('/storage/v1/object/authenticated/')) return storage();
    if (url.includes('/storage/v1/object/')) return new Response('{}', { status: 200 }); // writes
    void init;
    if (url.includes('/rest/v1/free_usage')) return Response.json([]);
    return Response.json({});
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}
const timeout = () => { throw new DOMException('The operation timed out.', 'TimeoutError'); };
const interruptedBody = () => new Response(new ReadableStream({ pull(c) { c.error(new TypeError('terminated')); } }), { status: 200 });

describe('jobOwnership outcomes', () => {
  const cases: Array<[string, Answer, Answer, string]> = [
    ['new id: no ledger row, no object', () => Response.json(null), NOT_FOUND, 'clear'],
    ['same-account retry: ledger and object are the caller\'s', () => Response.json({ owner_uid: 'user_a', status: 'failed' }), () => Response.json({ uid: 'user_a' }), 'clear'],
    ['cross-account collision in the ledger', () => Response.json({ owner_uid: 'user_b', status: 'queued' }), NOT_FOUND, 'conflict'],
    ['cross-account collision in Storage', () => Response.json(null), () => Response.json({ uid: 'user_b' }), 'conflict'],
    ['ledger timeout (queued job has a row but no object yet)', timeout, NOT_FOUND, 'unavailable'],
    ['ledger service failure', () => new Response('{"code":"XX000"}', { status: 500 }), NOT_FOUND, 'unavailable'],
    ['Storage timeout', () => Response.json(null), timeout, 'unavailable'],
    ['Storage service failure', () => Response.json(null), () => new Response('bad gateway', { status: 502 }), 'unavailable'],
    ['Storage 200 with an interrupted body', () => Response.json(null), interruptedBody, 'unavailable'],
    ['Storage 200 with a malformed body', () => Response.json(null), () => new Response('{"uid": "us', { status: 200 }), 'conflict'],
    ['Storage record with no owner', () => Response.json(null), () => Response.json({ status: 'completed' }), 'conflict'],
    ['Storage record with an empty owner', () => Response.json(null), () => Response.json({ uid: '' }), 'conflict'],
    ['ledger row with no owner', () => Response.json({ status: 'queued' }), NOT_FOUND, 'conflict'],
  ];
  it.each(cases)('%s → %s', async (_name, ledger, storage, expected) => {
    expect(await jobOwnership(env as any, ID, 'user_a', world(ledger, storage))).toBe(expected);
  });
});

describe('/api/analyze refuses before reserving credit, calling the AI or writing a report', () => {
  async function submit(ledger: Answer, storage: Answer, uid = 'user_a') {
    const fetcher = world(ledger, storage);
    const rpc = vi.fn(async () => ({ status: 'reserved', reservation_id: 'r1' }));
    const generate = vi.fn();
    const response = await handleAnalyzeRequest(new Request('https://navigator.test/api/analyze', {
      method: 'POST',
      headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json', 'X-Analysis-Id': ID, Accept: 'application/json', 'x-test-uid': uid },
      body: JSON.stringify({ documentText: 'Synthetic CAS file note. '.repeat(40), mode: 'fast', stream: false }),
    }), env, { rpc, fetcher, generate } as never);
    const writes = fetcher.mock.calls.filter(([url, init]) => String(url).includes('/storage/v1/object/') && !String(url).includes('/authenticated/') && (init as RequestInit | undefined)?.method === 'POST');
    return { status: response.status, body: await response.json(), rpc, generate, writes };
  }

  it.each([
    ['ledger timeout', timeout, NOT_FOUND, 503, 'OWNERSHIP_CHECK_UNAVAILABLE'],
    ['Storage failure', () => Response.json(null), () => new Response('x', { status: 503 }), 503, 'OWNERSHIP_CHECK_UNAVAILABLE'],
    ['interrupted body', () => Response.json(null), interruptedBody, 503, 'OWNERSHIP_CHECK_UNAVAILABLE'],
    ['malformed record', () => Response.json(null), () => new Response('not json', { status: 200 }), 409, 'ANALYSIS_ID_CONFLICT'],
    ['record without owner', () => Response.json(null), () => Response.json({}), 409, 'ANALYSIS_ID_CONFLICT'],
    ['another account\'s id', () => Response.json({ owner_uid: 'user_b', status: 'completed' }), () => Response.json({ uid: 'user_b' }), 409, 'ANALYSIS_ID_CONFLICT'],
  ] as Array<[string, Answer, Answer, number, string]>)('%s: refused with the expected code; no credit, no AI, no write', async (_n, ledger, storage, status, code) => {
    const r = await submit(ledger, storage);
    expect(r.status).toBe(status);
    expect(r.body.code).toBe(code);
    expect(r.rpc).not.toHaveBeenCalled();
    expect(r.generate).not.toHaveBeenCalled();
    expect(r.writes).toHaveLength(0);
  });

  it('a legitimate same-account retry proceeds to the credit reservation', async () => {
    const r = await submit(() => Response.json(null), () => Response.json({ uid: 'user_a', status: 'failed' }));
    expect(r.rpc).toHaveBeenCalled();
  });

  it('two concurrent submissions of a new id by the same account both pass the check; the reservation decides', async () => {
    const [a, b] = await Promise.all([submit(() => Response.json(null), NOT_FOUND), submit(() => Response.json(null), NOT_FOUND)]);
    expect(a.rpc).toHaveBeenCalled();
    expect(b.rpc).toHaveBeenCalled();
  });

  it('a different account racing for the same new id is refused once the first record exists', async () => {
    const r = await submit(() => Response.json({ owner_uid: 'user_a', status: 'running' }), () => Response.json({ uid: 'user_a' }), 'user_b');
    expect(r.status).toBe(409);
    expect(r.rpc).not.toHaveBeenCalled();
  });
});

describe('create-once claim of the direct-path job record (T-20 / review finding 7)', () => {
  async function claim(store: Map<string, string>, uid: string, opts: { writeStatus?: number; readFails?: boolean } = {}) {
    const { claimJobRecord } = await import('../functions/api/_analysis-jobs');
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const key = url.split('/analysis_jobs/')[1];
      if (url.includes('/authenticated/')) {
        if (opts.readFails) return new Response('x', { status: 503 });
        return store.has(key) ? new Response(store.get(key)!, { status: 200 }) : new Response('{"statusCode":"404"}', { status: 400 });
      }
      if (opts.writeStatus) return new Response('{}', { status: opts.writeStatus });
      const headers = new Headers(init?.headers as HeadersInit);
      // Like Storage (unique object name in the database): the existence check and the create are one atomic step.
      if (store.has(key) && headers.get('x-upsert') !== 'true') return new Response('{"statusCode":"409","error":"Duplicate"}', { status: 400 });
      store.set(key, String(init?.body));
      await new Promise((r) => setTimeout(r, 1)); // response latency, so the two requests overlap
      return Response.json({ Key: key });
    }) as unknown as typeof fetch;
    return claimJobRecord(env as any, ID, uid, fetcher);
  }

  it('two accounts racing for the same new id: exactly one claims it, the other is refused', async () => {
    const store = new Map<string, string>();
    const results = await Promise.all([claim(store, 'user_a'), claim(store, 'user_b')]);
    expect([...results].sort()).toEqual(['claimed', 'conflict']);
  });

  it('the owner re-claiming its own record (retry) succeeds; owner-less or foreign records are refused', async () => {
    const store = new Map<string, string>([[`${ID}.json`, JSON.stringify({ uid: 'user_a' })]]);
    expect(await claim(store, 'user_a')).toBe('claimed');
    expect(await claim(store, 'user_b')).toBe('conflict');
    expect(await claim(new Map([[`${ID}.json`, '{}']]), 'user_a')).toBe('conflict');
    expect(await claim(new Map([[`${ID}.json`, 'not json']]), 'user_a')).toBe('conflict');
  });

  it('fails closed when the claim or the re-read cannot be completed', async () => {
    expect(await claim(new Map(), 'user_a', { writeStatus: 500 })).toBe('unavailable');
    expect(await claim(new Map([[`${ID}.json`, JSON.stringify({ uid: 'user_a' })]]), 'user_a', { readFails: true })).toBe('unavailable');
  });

  it('/api/analyze refuses the losing account before any credit, AI call or report write', async () => {
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/rpc/analyzer_get_job')) return Response.json(null);
      // The ownership read saw nothing, but another account's create landed first.
      if (url.includes('/authenticated/')) return fetcher.mock.calls.filter(([u]) => String(u).includes('/authenticated/')).length === 1 ? NOT_FOUND() : Response.json({ uid: 'user_b' });
      if (url.includes('/storage/v1/object/')) return new Response('{"statusCode":"409"}', { status: 400 });
      if (url.includes('/rest/v1/free_usage')) return Response.json([]);
      return Response.json({});
    }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
    const rpc = vi.fn(async () => ({ status: 'reserved', reservation_id: 'r1' }));
    const generate = vi.fn();
    const response = await handleAnalyzeRequest(new Request('https://navigator.test/api/analyze', {
      method: 'POST',
      headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json', 'X-Analysis-Id': ID, Accept: 'application/json', 'x-test-uid': 'user_a' },
      body: JSON.stringify({ documentText: 'Synthetic CAS file note. '.repeat(40), mode: 'fast', stream: false }),
    }), env, { rpc, fetcher, generate } as never);
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('ANALYSIS_ID_CONFLICT');
    expect(rpc).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });
});

describe('queued producer claims the report object too (re-review residual 2)', () => {
  it('a queued request whose id is already held by another account\'s direct analysis is refused, failed and released', async () => {
    const calls: string[] = [];
    let ownershipReads = 0;
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      calls.push(`${init?.method || 'GET'} ${url.replace('https://example.supabase.co', '')}`);
      if (url.includes('/rpc/analyzer_get_job')) return Response.json(null);
      if (url.includes('/rpc/analyzer_create_job')) return Response.json({ job_id: ID });
      if (url.includes('/rpc/analyzer_update_job')) return Response.json(true);
      // First read (ownership pre-check): nothing yet. Later reads: another account's direct-path claim landed.
      if (url.includes('/authenticated/')) return ++ownershipReads === 1 ? NOT_FOUND() : Response.json({ uid: 'user_b' });
      if (url.includes('/storage/v1/object/')) return new Response('{"statusCode":"409"}', { status: 400 });
      if (url.includes('/rest/v1/free_usage')) return Response.json([]);
      return Response.json({});
    }) as unknown as typeof fetch;
    const rpc = vi.fn(async (name: string) => (name === 'free_reserve_scan' ? { status: 'reserved', reservation_id: 'r1' } : { status: 'released' }));
    const send = vi.fn();
    const response = await handleAnalyzeRequest(new Request('https://navigator.test/api/analyze', {
      method: 'POST',
      headers: { Authorization: 'Bearer t', 'Content-Type': 'application/json', 'X-Analysis-Id': ID, Accept: 'application/json', 'x-test-uid': 'user_a' },
      body: JSON.stringify({ documentText: 'Synthetic CAS file note. '.repeat(40), mode: 'fast', stream: false }),
    }), { ...env, QUEUE_QUICK_ANALYSIS: 'true', ANALYZER_JOBS_QUEUE: { send } } as never, { rpc, fetcher } as never);
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe('ANALYSIS_ID_CONFLICT');
    expect(send).not.toHaveBeenCalled();
    expect(rpc.mock.calls.map(([n]) => n)).toContain('free_release_scan');
    expect(calls.some((c) => c.includes('/rpc/analyzer_update_job'))).toBe(true); // the queued job is marked failed
  });
});
