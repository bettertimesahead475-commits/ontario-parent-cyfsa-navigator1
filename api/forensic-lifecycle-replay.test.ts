// Full-lifecycle replay of a queued Forensic Deep Scan: the real queue Worker (processJob), the real analyze handler
// (handleAnalyzeRequest with a trusted job) and the real section pipeline, with every I/O call delayed under fake timers.
// Mocked inference only; synthetic text; no network, database, binding or migration.
//
// Durations (production, 2026-11-26 incident Workers telemetry, as in forensic-budget-replay.test.ts): redFlags 92.5 s,
// thresholds 37.7 s, chronology 81.3 s (7,500 tokens at ~94 tokens/s + 1.5 s), guidance 57.8 s, timeline 45.3 s,
// overview 36.7 s, verification 30 s (upper bound from the 2026-11-25 run).
// I/O latency is NOT measured. The only recorded figure is the ~30-80 ms per Supabase round trip estimated in
// engineering/SECURITY_REGISTER.md. The replay uses conservative values above it: 250 ms per RPC and 600 ms per
// Storage write ("typical"), and 2 s / 4 s ("slow tail"). Worker startup: 1 s. Real deadlines checked: the 178 s AI
// deadline, the handler's hard deadline (budget + 5 s from the start of the analysis), the 240 s claim lease renewed
// to 4 min by each running write, and the 15-minute Queue consumer wall-time limit (Cloudflare Workers limits).
import { describe, it, expect, vi, beforeEach } from 'vitest';

const H = vi.hoisted(() => ({
  durations: {} as Record<string, number>,
  rpcMs: 250, storageMs: 600, startupMs: 1_000,
  failFirst: new Set<string>(), // stage names whose first call fails fast with a retryable provider error
  jitter: 0, seed: 1,
  calls: [] as { stage: string; start: number; end: number; timeoutMs: number; ok: boolean }[],
  writes: [] as { t: number; status: string; stage?: string }[],
  saved: null as any,
}));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let rng = 1;
const rand = () => { rng = (rng * 1_103_515_245 + 12_345) % 2_147_483_648; return rng / 2_147_483_648; };
const vary = (ms: number) => ms * (1 + H.jitter * (2 * rand() - 1));

vi.mock('../functions/api/_durable-analysis-jobs', async (orig) => {
  const actual: any = await orig();
  const io = async <T>(v: T) => { await sleep(vary(H.rpcMs)); return v; };
  return {
    ...actual,
    claimDurableJob: vi.fn(() => io({ job_id: 'job_lifecycle01', owner_uid: 'synthetic-owner', mode: 'full', status: 'running', input_key: 'inputs/x.json', session_id: null, reservation_id: 'res_1', owner_bypass: false, attempt_count: 1 })),
    readDurableJob: vi.fn(() => io(null)),
    loadDurableInput: vi.fn(() => io({ documentText: DOC, fileName: 'synthetic.txt' })),
    loadPersistedReport: vi.fn(() => io(H.saved)),
    updateDurableJob: vi.fn(async (_env: unknown, input: any) => { await sleep(vary(H.rpcMs)); H.writes.push({ t: Date.now(), status: input.status, stage: input.stage }); return true; }),
  };
});
vi.mock('../functions/api/_staging-credit-rpc', () => ({ createStagingCreditRpc: vi.fn() }));
vi.mock('../functions/api/_free-credit-lifecycle', () => ({
  finalizeFreeScan: vi.fn(async () => { await sleep(vary(H.rpcMs)); return { status: 'consumed' }; }),
  releaseFreeScan: vi.fn(async () => { await sleep(vary(H.rpcMs)); return { status: 'released' }; }),
}));
vi.mock('../functions/api/_paid-credit-lifecycle', () => ({ finalizePaidReservation: vi.fn(), releasePaidReservation: vi.fn() }));
vi.mock('../functions/api/analyze', async (orig) => {
  const actual: any = await orig();
  const fetcher = async (url: any, init?: RequestInit) => {
    await sleep(vary(H.storageMs));
    if (init?.method && init.method !== 'GET' && String(url).includes('/storage/')) {
      const body = JSON.parse(String(init.body));
      if (body.status === 'completed') H.saved = body.report;
    }
    return new Response('{}', { status: 200 });
  };
  const generate = async (o: any) => {
    const start = Date.now();
    if (H.failFirst.has(o.stage) && !H.calls.some((c) => c.stage === o.stage)) {
      await sleep(5_000);
      H.calls.push({ stage: o.stage, start, end: Date.now(), timeoutMs: o.timeoutMs, ok: false });
      throw Object.assign(new Error('provider overloaded'), { status: 529, retryable: true });
    }
    const dur = vary(H.durations[o.stage]);
    if (dur > o.timeoutMs) {
      await sleep(o.timeoutMs);
      H.calls.push({ stage: o.stage, start, end: Date.now(), timeoutMs: o.timeoutMs, ok: false });
      throw new Error(`provider deadline of ${o.timeoutMs} ms exceeded`);
    }
    await sleep(dur);
    H.calls.push({ stage: o.stage, start, end: Date.now(), timeoutMs: o.timeoutMs, ok: true });
    const text = o.stage === 'forensic_verification' ? JSON.stringify(verifierReply(o)) : JSON.stringify(SECTIONS[o.stage]);
    return { text, model: 'synthetic-opus', durationMs: dur, stopReason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } };
  };
  return { ...actual, handleAnalyzeRequest: (req: Request, env: any, deps: any) => actual.handleAnalyzeRequest(req, env, { ...deps, generate, fetcher, rpc: vi.fn() }) };
});

import { processJob } from '../workers/analyzer-queue-consumer';

const DOC = `SUPERIOR COURT OF JUSTICE (FAMILY COURT)
AFFIDAVIT OF INVESTIGATING WORKER
1. On October 12, 2026, the Society initiated an intake investigation under CYFSA s. 81.
2. The Society previously stated in writing: "we did not inform the court of the kinship option within the statutory window."`;
const SECTIONS: Record<string, unknown> = {
  'section:overview': { documentTitle: 'Child Protection Application', fileSummary: 'This synthetic document is a Child Protection Application alleging a lack of supervision on October 12, 2026.', completenessScore: 80, evidenceStrengthIndex: { score: 60, components: {} } },
  'section:redFlags': { redFlags: [{ id: 'rf1', severity: 'Worth Raising With Counsel', category: 'Hearsay', evidenceClassification: 'HEARSAY', phraseDetected: 'we did not inform the court of the kinship option', explanation: 'Kinship option was not raised.', verifyRequirement: 'Request disclosure.', legalReference: 'CYFSA s. 101', locationInDocument: 'Paragraph 2' }] },
  'section:chronology': { chronology: [{ date: 'October 12, 2026', event: 'Society initiated an intake investigation under CYFSA s. 81.', locationInDocument: 'Paragraph 1', evidenceClassification: 'DOCUMENTARY' }], contradictions: [] },
  'section:guidance': { whatToVerify: ['Verify intake records.'], whatToAskALawyer: ['Question: Can kinship be raised?'], whatIsMissing: ['Supervision logs.'], lawyerCaseBrief: ['ISSUE: Kinship alternatives under CYFSA s. 101.'] },
  'section:thresholds': { thresholdAnalysis: [{ thresholdChecked: 'Physical Harm Risk', isMet: 'Not Met', reasoning: 'No physical harm.' }] },
  'section:timeline': { proceduralTimelineViolations: [{ timelineRule: '30-Day Adjournment Limit', documentAssertion: 'Within limits.', evaluation: 'Compliant.' }], charterAndHumanRightsIssues: ['Section 7.'] },
};
// A complete verifier reply: a verdict for the finding and for every threshold row named in the prompt.
const verifierReply = (o: any) => ({
  findings: [{ id: 'rf1', verdict: 'SUPPORTED', note: 'Supported.' }],
  thresholds: [...JSON.stringify(o.messages).matchAll(/\\"thresholdChecked\\": \\"([^\\]+)\\"/g)].map((m) => ({ thresholdChecked: m[1], verdict: 'SUPPORTED' })),
  overallAssessment: 'Consistent.',
});
const PRODUCTION_MS: Record<string, number> = {
  'section:redFlags': 92_500, 'section:thresholds': 37_700, 'section:chronology': 1_500 + (7_500 / 94) * 1000,
  'section:guidance': 57_800, 'section:timeline': 45_300, 'section:overview': 36_700, forensic_verification: 30_000,
};
const scaled = (f: number, only?: string) => Object.fromEntries(Object.entries(PRODUCTION_MS).map(([k, v]) => [k, !only || k === only ? v * f : v]));
const QUEUE_WALL_MS = 15 * 60_000, LEASE_MS = 240_000;
const env = { ANALYZER_ENABLED: 'true', FIREBASE_PROJECT_ID: 'synthetic-project', STAGING_SUPABASE_URL: 'https://synthetic.supabase.co', STAGING_SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service', ANTHROPIC_API_KEY: 'synthetic-anthropic' };

export async function lifecycle(durations: Record<string, number>, o: { rpcMs?: number; storageMs?: number; jitter?: number; seed?: number; failFirst?: string[] } = {}) {
  Object.assign(H, { durations, rpcMs: o.rpcMs ?? 250, storageMs: o.storageMs ?? 600, jitter: o.jitter ?? 0, calls: [], writes: [], saved: null, failFirst: new Set(o.failFirst ?? []) });
  rng = o.seed ?? 1;
  vi.useFakeTimers({ now: 0 });
  const msg = { body: { version: 1, jobId: 'job_lifecycle01' }, attempts: 1, ack: vi.fn(), retry: vi.fn() };
  let endedAt = -1;
  const p = sleep(H.startupMs).then(() => processJob(msg as any, env as any)).finally(() => { endedAt = Date.now(); });
  await vi.advanceTimersByTimeAsync(QUEUE_WALL_MS + 60_000);
  await p.catch(() => undefined);
  vi.useRealTimers();
  const aiStart = H.writes.find((w) => w.stage === 'reviewing_evidence')?.t ?? NaN;
  const running = H.writes.filter((w) => w.status === 'running').map((w) => w.t);
  const leaseTimes = [H.calls.length ? 0 : 0, ...running];
  const maxLeaseGap = Math.max(...leaseTimes.slice(1).map((t, i) => t - leaseTimes[i]), endedAt - (running.at(-1) ?? 0));
  return {
    acked: msg.ack.mock.calls.length === 1, retried: msg.retry.mock.calls.length === 1, endedAt, aiStart, maxLeaseGap,
    completedWrite: H.writes.some((w) => w.status === 'completed'),
    verification: H.saved?.forensicVerification ?? null,
    calls: [...H.calls], first: (s: string) => H.calls.find((c) => c.stage === `section:${s}`)!,
  };
}

beforeEach(() => { vi.spyOn(console, 'info').mockImplementation(() => {}); vi.spyOn(console, 'warn').mockImplementation(() => {}); vi.spyOn(console, 'error').mockImplementation(() => {}); });

const TYPICAL = { rpcMs: 250, storageMs: 600 }, SLOW = { rpcMs: 2_000, storageMs: 4_000 };
const completesVerified = (r: Awaited<ReturnType<typeof lifecycle>>) => {
  expect(r.acked && !r.retried).toBe(true);
  expect(r.completedWrite).toBe(true);
  expect(r.verification).toMatchObject({ status: 'completed' });
  expect(r.verification.checkedFindings).toBe(r.verification.totalFindings);
  expect(r.maxLeaseGap).toBeLessThan(LEASE_MS);
  expect(r.endedAt).toBeLessThan(QUEUE_WALL_MS);
};
const notCompleted = (r: Awaited<ReturnType<typeof lifecycle>>) => {
  expect(r.acked && r.completedWrite && r.verification?.status === 'completed').toBe(false);
};

describe('Forensic full-lifecycle replay (queue Worker -> handler -> sections -> verification -> persistence)', () => {
  it('production timings: completes, verified, in ~134 s; startup and awaited writes move overview to 95.4 s with an 81.4 s timeout', async () => {
    const r = await lifecycle(PRODUCTION_MS, TYPICAL);
    completesVerified(r);
    expect(r.aiStart).toBe(2_600); // startup 1 s, claim, persisted-report check, input load, job-state write, first progress write
    expect(r.first('overview').start).toBe(95_350);
    expect(r.first('overview').timeoutMs).toBe(81_400);
    expect(r.endedAt).toBe(133_900);
    const slow = await lifecycle(PRODUCTION_MS, SLOW);
    completesVerified(slow);
    expect(slow.first('overview').timeoutMs).toBe(74_500);
  });

  // Corrected figures. The section-only replay (forensic-budget-overview-last.test.ts) gave redFlags 1.55x,
  // uniform 1.35x and overview 2.25x; the full lifecycle gives the values below.
  it.each([
    ['typical I/O', TYPICAL, 'section:redFlags', 1.55, 1.6],
    ['typical I/O', TYPICAL, undefined, 1.3, 1.35],
    ['typical I/O', TYPICAL, 'section:overview', 2.2, 2.25],
    ['typical I/O', TYPICAL, 'section:chronology', 1.35, 1.4],
    ['slow I/O', SLOW, 'section:redFlags', 1.5, 1.55],
    ['slow I/O', SLOW, undefined, 1.25, 1.3],
    ['slow I/O', SLOW, 'section:overview', 2.0, 2.05],
  ] as const)('%s: %s completes verified at %sx and not at %sx', async (_l, lat, only, okAt, failAt) => {
    completesVerified(await lifecycle(scaled(okAt, only), lat));
    notCompleted(await lifecycle(scaled(failAt, only), lat));
  });

  it('variable latency (+/-15% on every call, 20 seeds): all complete verified to 1.15x; at 1.2x one seed loses chronology', async () => {
    for (const f of [1.0, 1.1, 1.15]) for (let seed = 1; seed <= 20; seed++) completesVerified(await lifecycle(scaled(f), { ...TYPICAL, jitter: 0.15, seed }));
    const lost: number[] = [];
    for (let seed = 1; seed <= 20; seed++) {
      const r = await lifecycle(scaled(1.2), { ...TYPICAL, jitter: 0.15, seed });
      if (r.acked && r.completedWrite) { completesVerified(r); continue; }
      lost.push(seed);
      // Chronology (81.3 s x 1.2 x up to 1.15) passes its unchanged 110 s limit; the retry cannot fit. Nothing is saved.
      expect(r.calls.filter((c) => !c.ok).map((c) => c.stage)).toEqual(['section:chronology', 'section:chronology']);
      expect(r.verification).toBeNull();
    }
    expect(lost).toEqual([4]);
  });

  it('a fast provider failure on the first redFlags and first verification attempt is retried and still completes verified', async () => {
    const r = await lifecycle(PRODUCTION_MS, { ...TYPICAL, failFirst: ['section:redFlags', 'forensic_verification'] });
    completesVerified(r);
    expect(r.calls.filter((c) => c.stage === 'section:redFlags').map((c) => c.ok)).toEqual([false, true]);
    expect(r.calls.filter((c) => c.stage === 'forensic_verification').map((c) => c.ok)).toEqual([false, true]);
  });

  it('verification that cannot finish inside the AI deadline is saved as incomplete, never as a completed second review', async () => {
    const r = await lifecycle(scaled(3.0, 'forensic_verification'), TYPICAL);
    expect(r.acked && r.completedWrite).toBe(true);
    expect(r.calls.filter((c) => c.stage === 'forensic_verification').every((c) => !c.ok)).toBe(true);
    expect(r.verification).toMatchObject({ status: 'incomplete', checkedFindings: 0 });
  });

  it('a run past its deadlines saves nothing and is redelivered, with no completed state written', async () => {
    const r = await lifecycle(scaled(1.5), TYPICAL);
    expect(r.retried).toBe(true);
    expect(r.completedWrite).toBe(false);
    expect(r.verification).toBeNull();
    expect(r.endedAt).toBeLessThan(QUEUE_WALL_MS);
  });
});
