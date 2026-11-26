import { describe, expect, it, vi } from 'vitest';
import { jobOwnerConflict } from '../../functions/api/_durable-analysis-jobs';

// DEVIN-SEC-01: the ownership check that protects `<id>.json` (written with x-upsert:true by the direct path)
// must not report "no conflict" when ownership could not be determined.
const env = { STAGING_SUPABASE_URL: 'https://example.supabase.co', STAGING_SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test_key_0000000000' };
const victimId = 'req_1795545140117_victimjob002';

function fetcherFor(ledger: () => Response | Promise<Response>, storage: () => Response | Promise<Response>) {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/rest/v1/rpc/analyzer_get_job')) return ledger();
    if (url.includes('/storage/v1/object/')) return storage();
    throw new Error('unexpected request ' + url);
  }) as unknown as typeof fetch;
}

describe('DEVIN-SEC-01 jobOwnerConflict fails closed when ownership is unknown', () => {
  it('ledger unreachable and storage 503: refuses the id', async () => {
    const f = fetcherFor(() => { throw new TypeError('network'); }, () => new Response('{}', { status: 503 }));
    expect(await jobOwnerConflict(env, victimId, 'attacker_uid', f)).toBe(true);
  });
  it('ledger unreachable and storage times out: refuses the id', async () => {
    const f = fetcherFor(() => { throw new TypeError('network'); }, () => { throw new DOMException('timeout', 'TimeoutError'); });
    expect(await jobOwnerConflict(env, victimId, 'attacker_uid', f)).toBe(true);
  });
  it('ledger 500 and storage 502: refuses the id', async () => {
    const f = fetcherFor(() => new Response('{"code":"XX000"}', { status: 500 }), () => new Response('bad gateway', { status: 502 }));
    expect(await jobOwnerConflict(env, victimId, 'attacker_uid', f)).toBe(true);
  });
  it('storage sends 200 headers but the body read fails: refuses the id', async () => {
    const body = new ReadableStream({ pull(controller) { controller.error(new DOMException('timeout', 'TimeoutError')); } });
    const f = fetcherFor(() => Response.json(null), () => new Response(body, { status: 200 }));
    expect(await jobOwnerConflict(env, victimId, 'attacker_uid', f)).toBe(true);
  });
  it('still allows a fresh id (no ledger row, storage 404) and the caller\'s own id', async () => {
    const fresh = fetcherFor(() => Response.json(null), () => new Response('{"statusCode":"404"}', { status: 400 }));
    expect(await jobOwnerConflict(env, 'req_1795545140117_fresh0000001', 'me', fresh)).toBe(false);
    const own = fetcherFor(() => Response.json({ owner_uid: 'me', status: 'completed' }), () => Response.json({ uid: 'me', status: 'completed' }));
    expect(await jobOwnerConflict(env, 'req_1795545140117_mine00000001', 'me', own)).toBe(false);
  });
});
