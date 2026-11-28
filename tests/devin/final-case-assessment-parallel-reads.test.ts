/**
 * Verifies Final Case Assessment DB/Storage read/save parallelization, deduplication,
 * deterministic source ordering (stable requestId), bounded source read concurrency,
 * and fail-closed ownership/credit/re-verification invariants. Synthetic data only.
 */
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { handleAssessment } from '../../functions/api/final-case-assessment';

const MATTER = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';
const ENV = {
  ANALYZER_ENABLED: 'true',
  FIREBASE_PROJECT_ID: 'fixture',
  STAGING_SUPABASE_URL: 'https://fixture.supabase.co',
  STAGING_SUPABASE_READ_KEY: 'synthetic-read',
  STAGING_SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service',
};

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex');
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

interface SyntheticDoc {
  id: string;
  filename: string;
  text: string;
  readDelayMs?: number;
  tamperText?: boolean;
}

function makeDocs(count: number, reverseDelays = false): SyntheticDoc[] {
  const docs: SyntheticDoc[] = [];
  for (let i = 0; i < count; i++) {
    const filename = `synthetic-doc-${String(i + 1).padStart(2, '0')}.txt`;
    const text = `Synthetic record ${i + 1}: parent requested disclosure on day ${i + 1}.`;
    const id = sha256(JSON.stringify([filename, text]));
    docs.push({
      id,
      filename,
      text,
      readDelayMs: reverseDelays ? (count - i) * 3 : 10,
    });
  }
  return docs.sort((a, b) => a.id.localeCompare(b.id));
}

function makeFixture(opts: {
  docs?: SyntheticDoc[];
  listNames?: string[];
  dbDelayMs?: number;
  storageDelayMs?: number;
} = {}) {
  const docs = opts.docs ?? makeDocs(12, true);
  const docsById = new Map(docs.map((d) => [d.id, d]));
  const store = new Map<string, any>();
  const tableCounts: Record<string, number> = {};
  const dbDelayMs = opts.dbDelayMs ?? 15;
  const storageDelayMs = opts.storageDelayMs ?? 15;

  let activeSourceReads = 0;
  let peakSourceReads = 0;
  let activeCompletedSaves = 0;
  let peakCompletedSaves = 0;
  let inPostGenPhase = false;
  let activePostGenChecks = 0;
  let peakPostGenChecks = 0;

  let accountActive = true;
  let matterOwned = true;
  let memberOwner = true;
  let currentClientId = 'client-1';
  const ownedClients = new Set<string>(['client-1']);
  let paidExpired = false;

  let balance = 5;
  let charged = 0;
  let released = 0;
  const ledger = new Map<string, string>();

  const rpc = vi.fn(async (name: string, args: any) => {
    const id = args.p_request;
    if (name === 'paid_reserve_credit') {
      const state = ledger.get(id);
      if (state === 'consumed') return { status: 'consumed' };
      if (state === 'reserved') return { status: 'in_progress' };
      if (!balance) return { status: 'limit' };
      ledger.set(id, 'reserved');
      return { status: 'reserved', reservation_id: 'res-1' };
    }
    if (name === 'paid_finalize_credit') {
      if (ledger.get(id) === 'reserved') {
        balance--;
        charged++;
        ledger.set(id, 'consumed');
      }
      return { status: ledger.get(id) || 'missing' };
    }
    if (ledger.get(id) === 'reserved') {
      ledger.set(id, 'released');
      released++;
    }
    return { status: ledger.get(id) === 'consumed' ? 'consumed' : 'released' };
  });

  const fetcher = vi.fn(async (input: any, init?: RequestInit) => {
    const url = new URL(String(input));
    const table = url.pathname.split('/').pop()!;

    if (url.pathname.endsWith('/object/list/analysis_jobs')) {
      await delay(storageDelayMs);
      const names = opts.listNames ?? docs.map((d) => d.id + '.json');
      return Response.json(names.map((name) => ({ name })));
    }

    if (url.pathname.includes('/storage/')) {
      const key = url.pathname.replace('/authenticated/', '/');
      if (init?.method === 'POST') {
        const body = JSON.parse(String(init.body));
        const isCompletedSave = body?.status === 'completed';
        if (isCompletedSave) {
          activeCompletedSaves++;
          peakCompletedSaves = Math.max(peakCompletedSaves, activeCompletedSaves);
        }
        try {
          await delay(storageDelayMs);
          store.set(key, body);
          return Response.json({});
        } finally {
          if (isCompletedSave) activeCompletedSaves--;
        }
      }
      if (url.pathname.includes('/assessment_sources/')) {
        const id = url.pathname.split('/').pop()!.replace(/\.json$/, '');
        activeSourceReads++;
        peakSourceReads = Math.max(peakSourceReads, activeSourceReads);
        try {
          const doc = docsById.get(id);
          await delay(doc?.readDelayMs ?? storageDelayMs);
          if (!doc) return new Response('', { status: 404 });
          return Response.json({
            uid: 'parent',
            matterId: MATTER,
            source: {
              id: doc.id,
              document: doc.filename,
              version: doc.id,
              page: 1,
              text: doc.tamperText ? doc.text + ' TAMPERED' : doc.text,
            },
          });
        } finally {
          activeSourceReads--;
        }
      }
      await delay(storageDelayMs);
      if (store.has(key)) return Response.json(store.get(key));
      return new Response('', { status: 404 });
    }

    tableCounts[table] = (tableCounts[table] || 0) + 1;
    const trackPostGen = inPostGenPhase;
    if (trackPostGen) {
      activePostGenChecks++;
      peakPostGenChecks = Math.max(peakPostGenChecks, activePostGenChecks);
    }
    try {
      await delay(dbDelayMs);
      if (table === 'navigator_paid_sessions') {
        return Response.json([{
          id: SESSION,
          firebase_uid: 'parent',
          tier: 'Pro',
          issued_at: '2026-01-01T00:00:00Z',
          expires_at: paidExpired ? '2020-01-01T00:00:00Z' : '2099-01-01T00:00:00Z',
          revoked_at: null,
        }]);
      }
      if (table === 'accounts') {
        return Response.json([{ id: 'account-1', status: accountActive ? 'active' : 'suspended' }]);
      }
      if (table === 'navigator_matters') {
        return Response.json(matterOwned ? [{ id: MATTER, title: 'Synthetic matter', client_id: currentClientId }] : []);
      }
      if (table === 'navigator_matter_members') {
        return Response.json(memberOwner ? [{ role: 'OWNER' }] : []);
      }
      if (table === 'clients') {
        const requestedId = url.searchParams.get('id')?.replace(/^eq\./, '') ?? '';
        return Response.json(ownedClients.has(requestedId) ? [{ id: requestedId }] : []);
      }
      throw new Error('Unexpected URL ' + url);
    } finally {
      if (trackPostGen) activePostGenChecks--;
    }
  }) as unknown as typeof fetch;

  const firstId = docs[0]?.id ?? 'p1';
  const output = Object.fromEntries(
    ['overview', 'chronology', 'conflicts', 'gaps', 'questions'].map((k) => [
      k,
      [{ text: `Synthetic ${k}`, sources: [firstId] }],
    ]),
  );
  const generate = vi.fn(async () => {
    inPostGenPhase = true;
    return { text: JSON.stringify(output), durationMs: 1, usage: null, model: 'synthetic' };
  });
  const authenticate = vi.fn(async () => ({
    status: 'verified' as const,
    uid: 'parent',
    email: null,
    emailVerified: true,
  }));

  const call = (method = 'POST') =>
    handleAssessment(
      new Request(`https://preview.test/api/final-case-assessment?matterId=${MATTER}`, {
        method,
        headers: { 'X-PS-Session': SESSION },
      }),
      ENV,
      { fetcher, rpc, generate, authenticate },
    );

  return {
    docs,
    store,
    tableCounts,
    rpc,
    fetcher,
    generate,
    call,
    get peakSourceReads() { return peakSourceReads; },
    get peakCompletedSaves() { return peakCompletedSaves; },
    get peakPostGenChecks() { return peakPostGenChecks; },
    get balance() { return balance; },
    get charged() { return charged; },
    get released() { return released; },
    deactivateAccount() { accountActive = false; },
    removeMatter() { matterOwned = false; },
    revokeMember() { memberOwner = false; },
    setClient(id: string, owned: boolean) {
      currentClientId = id;
      if (owned) ownedClients.add(id);
      else ownedClients.delete(id);
    },
    expirePaid() { paidExpired = true; },
  };
}

describe('Final Case Assessment parallel reads and saves', () => {
  it('deduplicates initial accounts/navigator_matters queries on GET ?matterId', async () => {
    const f = makeFixture({ docs: makeDocs(2) });
    const res = await f.call('GET');
    expect(res.status).toBe(200);
    expect(f.tableCounts.accounts).toBe(1);
    expect(f.tableCounts.navigator_matters).toBe(1);
    expect(f.tableCounts.navigator_matter_members).toBe(1);
    expect(f.tableCounts.clients).toBe(1);
  });

  it('loads source docs in parallel with bounded concurrency (<=6), preserves deterministic order/requestId, and parallelizes post-gen re-verification and final saves', async () => {
    const f = makeFixture({ docs: makeDocs(12, true) });
    const res = await f.call('POST');
    expect(res.status).toBe(200);
    const body = await res.json();

    // Parallel source reads, bounded to Cloudflare Workers 6-connection limit
    expect(f.peakSourceReads).toBeGreaterThan(1);
    expect(f.peakSourceReads).toBeLessThanOrEqual(6);

    // Deterministic order matches ascending docs list even under reversed read delays
    const expectedSources = f.docs.map((d) => ({
      id: d.id,
      document: d.filename,
      version: d.id,
      page: 1,
      text: d.text,
    }));
    expect(body.report.sources).toEqual(expectedSources);

    // requestId matches exact sequential digest
    const expectedRequestId = 'assessment_' + sha256(JSON.stringify({
      uid: 'parent',
      sessionId: SESSION,
      matterId: MATTER,
      sources: expectedSources,
    }));
    expect(body.report.reportId).toBe(expectedRequestId);

    // Initial ownership deduplicated: 1 initial + 1 post-gen = 2 total
    expect(f.tableCounts.accounts).toBe(2);
    expect(f.tableCounts.navigator_matters).toBe(2);

    // Post-generation re-verification checks overlap in parallel
    expect(f.peakPostGenChecks).toBeGreaterThanOrEqual(4);

    // Final completed saves (requestId + latestId) run in parallel
    expect(f.peakCompletedSaves).toBe(2);

    // Exactly one credit charged
    expect(f.charged).toBe(1);
    expect(f.balance).toBe(4);
  });

  it('rejects malformed source filenames before issuing any storage object reads', async () => {
    const f = makeFixture({
      docs: makeDocs(3),
      listNames: [makeDocs(1)[0].id + '.json', 'not-a-sha256.json'],
    });
    const res = await f.call('POST');
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('SOURCE_NOT_READY');
    expect(f.peakSourceReads).toBe(0);
    expect(f.rpc).not.toHaveBeenCalled();
  });

  it('rejects tampered source checksum during parallel reads without reserving credit', async () => {
    const docs = makeDocs(8);
    docs[5].tamperText = true;
    const f = makeFixture({ docs });
    const res = await f.call('POST');
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('SOURCE_NOT_READY');
    expect(f.rpc).not.toHaveBeenCalled();
    expect(f.generate).not.toHaveBeenCalled();
  });

  it.each([
    ['account deactivated', (f: ReturnType<typeof makeFixture>) => f.deactivateAccount()],
    ['matter removed', (f: ReturnType<typeof makeFixture>) => f.removeMatter()],
    ['membership revoked', (f: ReturnType<typeof makeFixture>) => f.revokeMember()],
    ['client ownership removed', (f: ReturnType<typeof makeFixture>) => f.setClient('client-1', false)],
    ['client reassigned to unowned client', (f: ReturnType<typeof makeFixture>) => f.setClient('client-foreign', false)],
  ])('releases reserved credit and returns 404 if %s mid-generation', async (_label, mutate) => {
    const f = makeFixture({ docs: makeDocs(2) });
    const orig = f.generate.getMockImplementation()!;
    f.generate.mockImplementationOnce(async () => {
      const result = await orig();
      mutate(f);
      return result;
    });
    const res = await f.call('POST');
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe('MATTER_NOT_FOUND');
    expect(f.charged).toBe(0);
    expect(f.released).toBe(1);
    expect(f.balance).toBe(5);
  });

  it('succeeds if client_id changes mid-generation to another client owned by the same account', async () => {
    const f = makeFixture({ docs: makeDocs(2) });
    const orig = f.generate.getMockImplementation()!;
    f.generate.mockImplementationOnce(async () => {
      const result = await orig();
      f.setClient('client-2', true);
      return result;
    });
    const res = await f.call('POST');
    expect(res.status).toBe(200);
    expect(f.charged).toBe(1);
    expect(f.balance).toBe(4);
  });

  it('releases reserved credit and returns 403 ACCESS_CHANGED if paid session expires mid-generation', async () => {
    const f = makeFixture({ docs: makeDocs(2) });
    const orig = f.generate.getMockImplementation()!;
    f.generate.mockImplementationOnce(async () => {
      const result = await orig();
      f.expirePaid();
      return result;
    });
    const res = await f.call('POST');
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('ACCESS_CHANGED');
    expect(f.charged).toBe(0);
    expect(f.released).toBe(1);
    expect(f.balance).toBe(5);
  });
});
