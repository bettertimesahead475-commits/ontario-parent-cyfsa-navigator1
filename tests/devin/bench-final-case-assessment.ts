/**
 * Reproducible mocked-RTT benchmark for Final Case Assessment (handleAssessment).
 * Zero paid AI calls, zero live DB writes, synthetic documents only.
 * Run: npx tsx tests/devin/bench-final-case-assessment.ts
 */
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { handleAssessment } from '../../functions/api/final-case-assessment';

const MATTER = '11111111-1111-4111-8111-111111111111';
const SESSION = '22222222-2222-4222-8222-222222222222';
const ENV: any = {
  ANALYZER_ENABLED: 'true',
  FIREBASE_PROJECT_ID: 'fixture',
  STAGING_SUPABASE_URL: 'https://fixture.supabase.co',
  STAGING_SUPABASE_READ_KEY: 'synthetic-read',
  STAGING_SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service',
};

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function makeDocs(count: number) {
  const docs = [];
  for (let i = 0; i < count; i++) {
    const filename = `synthetic-case-doc-${String(i + 1).padStart(2, '0')}.txt`;
    const text = `Synthetic CYFSA case document ${i + 1}. `.repeat(60);
    const id = sha256(JSON.stringify([filename, text]));
    docs.push({ id, filename, text });
  }
  return docs.sort((a, b) => a.id.localeCompare(b.id));
}

async function runOnce(docCount: number, rttMs: number, aiMs: number) {
  const docs = makeDocs(docCount);
  const byId = new Map(docs.map((d) => [d.id, d]));
  const store = new Map<string, any>();
  let httpCalls = 0;
  let rpcCalls = 0;
  let peakInFlight = 0;
  let inFlight = 0;
  const ledger = new Map<string, string>();

  const rpc = async (name: string, args: any) => {
    rpcCalls++;
    await sleep(rttMs);
    const id = args.p_request;
    if (name === 'paid_reserve_credit') {
      ledger.set(id, 'reserved');
      return { status: 'reserved' as const, reservation_id: 'res-1' };
    }
    if (name === 'paid_finalize_credit') {
      ledger.set(id, 'consumed');
      return { status: 'consumed' as const };
    }
    ledger.set(id, 'released');
    return { status: 'released' as const };
  };

  const fetcher = (async (input: any, init?: RequestInit) => {
    httpCalls++;
    inFlight++;
    peakInFlight = Math.max(peakInFlight, inFlight);
    try {
      await sleep(rttMs);
      const url = new URL(String(input));
      const table = url.pathname.split('/').pop()!;
      if (url.pathname.endsWith('/object/list/analysis_jobs')) {
        return Response.json(docs.map((d) => ({ name: d.id + '.json' })));
      }
      if (url.pathname.includes('/storage/')) {
        const key = url.pathname.replace('/authenticated/', '/');
        if (init?.method === 'POST') {
          store.set(key, JSON.parse(String(init.body)));
          return Response.json({});
        }
        if (url.pathname.includes('/assessment_sources/')) {
          const id = url.pathname.split('/').pop()!.replace(/\.json$/, '');
          const doc = byId.get(id)!;
          return Response.json({
            uid: 'parent',
            matterId: MATTER,
            source: { id: doc.id, document: doc.filename, version: doc.id, page: 1, text: doc.text },
          });
        }
        if (store.has(key)) return Response.json(store.get(key));
        return new Response('', { status: 404 });
      }
      if (table === 'navigator_paid_sessions') {
        return Response.json([{ id: SESSION, firebase_uid: 'parent', tier: 'Pro', issued_at: '2026-01-01T00:00:00Z', expires_at: '2099-01-01T00:00:00Z', revoked_at: null }]);
      }
      if (table === 'accounts') return Response.json([{ id: 'account-1', status: 'active' }]);
      if (table === 'navigator_matters') return Response.json([{ id: MATTER, title: 'Synthetic matter', client_id: 'client-1' }]);
      if (table === 'navigator_matter_members') return Response.json([{ role: 'OWNER' }]);
      if (table === 'clients') return Response.json([{ id: 'client-1' }]);
      throw new Error('Unexpected URL ' + url);
    } finally {
      inFlight--;
    }
  }) as unknown as typeof fetch;

  const output = Object.fromEntries(
    ['overview', 'chronology', 'conflicts', 'gaps', 'questions'].map((k) => [
      k,
      [{ text: `Synthetic ${k}`, sources: [docs[0].id] }],
    ]),
  );
  const generate = async () => {
    if (aiMs > 0) await sleep(aiMs);
    return { text: JSON.stringify(output), durationMs: aiMs, usage: null, model: 'synthetic' };
  };
  const authenticate = async () => ({ status: 'verified' as const, uid: 'parent', email: null, emailVerified: true });

  const req = new Request(`https://preview.test/api/final-case-assessment?matterId=${MATTER}`, {
    method: 'POST',
    headers: { 'X-PS-Session': SESSION },
  });

  const t0 = performance.now();
  const res = await handleAssessment(req, ENV, { fetcher, rpc, generate, authenticate });
  const elapsedMs = performance.now() - t0;
  if (res.status !== 200) throw new Error(`Unexpected status ${res.status}: ${await res.text()}`);
  return { elapsedMs, dbStorageMs: elapsedMs - aiMs, httpCalls, rpcCalls, peakInFlight };
}

function percentile(sorted: number[], p: number) {
  const idx = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[Math.max(0, idx)];
}

async function main() {
  const scenarios = [
    { docCount: 5, rttMs: 50, runs: 5 },
    { docCount: 20, rttMs: 50, runs: 5 },
    { docCount: 5, rttMs: 100, runs: 5 },
    { docCount: 20, rttMs: 100, runs: 5 },
    { docCount: 20, rttMs: 150, runs: 3 },
  ];
  console.log('docs | rttMs | p50_ms | p95_ms | httpCalls | rpcCalls | peakInFlight');
  for (const s of scenarios) {
    const times: number[] = [];
    let last: any;
    for (let i = 0; i < s.runs; i++) {
      last = await runOnce(s.docCount, s.rttMs, 0);
      times.push(last.dbStorageMs);
    }
    times.sort((a, b) => a - b);
    console.log(
      `${String(s.docCount).padStart(4)} | ${String(s.rttMs).padStart(5)} | ${percentile(times, 50).toFixed(1).padStart(6)} | ${percentile(times, 95).toFixed(1).padStart(6)} | ${String(last.httpCalls).padStart(9)} | ${String(last.rpcCalls).padStart(8)} | ${String(last.peakInFlight).padStart(12)}`,
    );
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
