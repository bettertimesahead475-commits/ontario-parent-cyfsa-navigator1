import { describe, expect, it, vi } from 'vitest';

vi.mock('../functions/api/_auth-check', () => ({
  verifyFirebaseRequest: vi.fn(async (req: Request) => ({ status: 'verified', uid: req.headers.get('x-test-uid') || 'user_a', emailVerified: false, email: null })),
  onRequestGet: vi.fn(),
}));

import { jobOwnership } from '../functions/api/_durable-analysis-jobs';
import { handleAnalyzeRequest, type AnalyzerEnv } from '../functions/api/analyze';

// Claude's review of PR #137 (DEVIN-SEC-01): every outcome of the analysis-id ownership check, and proof that a
// refusal happens before any credit reservation, AI call or report write.
const env = {
  ANALYZER_ENABLED: 'true',
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
