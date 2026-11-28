import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleAnalyzeRequest, type AnalyzerEnv } from '../functions/api/analyze';
import type { GenerateFn } from './services/analyzerSections';
import { completeVerification } from './analyzerTestFixtures';

// Synthetic, non-identifying fixture text only.
const DOC = `SUPERIOR COURT OF JUSTICE (FAMILY COURT)
AFFIDAVIT OF INVESTIGATING WORKER
1. On October 12, 2026, the Society initiated an intake investigation under CYFSA s. 81.
2. The Society previously stated in writing: "we did not inform the court of the kinship option within the statutory window."`;

const SECTIONS: Record<string, unknown> = {
  'section:overview': {
    documentTitle: 'Child Protection Application',
    fileSummary: 'This synthetic document is a Child Protection Application alleging a lack of supervision on October 12, 2026.',
    completenessScore: 80,
    evidenceStrengthIndex: { score: 60, components: {} },
  },
  'section:redFlags': {
    redFlags: [{
      id: 'rf1', severity: 'Worth Raising With Counsel', category: 'Hearsay', evidenceClassification: 'HEARSAY',
      phraseDetected: 'we did not inform the court of the kinship option',
      explanation: 'Kinship option was not raised.', verifyRequirement: 'Request disclosure.',
      legalReference: 'CYFSA s. 101', locationInDocument: 'Paragraph 2',
    }],
  },
  'section:chronology': {
    chronology: [{ date: 'October 12, 2026', event: 'Society initiated an intake investigation under CYFSA s. 81.', locationInDocument: 'Paragraph 1', evidenceClassification: 'DOCUMENTARY' }],
    contradictions: [],
  },
  'section:guidance': {
    whatToVerify: ['Verify intake records.'], whatToAskALawyer: ['Question: Can kinship be raised?'],
    whatIsMissing: ['Supervision logs.'], lawyerCaseBrief: ['ISSUE: Kinship alternatives under CYFSA s. 101.'],
  },
  'section:thresholds': {
    thresholdAnalysis: [{ thresholdChecked: 'Physical Harm Risk', isMet: 'Not Met', reasoning: 'No physical harm.' }],
  },
  'section:timeline': {
    proceduralTimelineViolations: [{ timelineRule: '30-Day Adjournment Limit', documentAssertion: 'Within limits.', evaluation: 'Compliant.' }],
    charterAndHumanRightsIssues: ['Section 7.', 'Section 15.', 'CYFSA Section 2.'],
  },
  forensic_verification: {
    findings: [{ id: 'rf1', verdict: 'SUPPORTED', recommendedSeverity: 'Worth Raising With Counsel', note: 'Supported.' }],
    thresholds: [], overallAssessment: 'Consistent.',
  },
};

const generate: GenerateFn = vi.fn(async (options: any) => ({
  text: JSON.stringify(options.stage === 'forensic_verification' ? completeVerification(SECTIONS[options.stage] as any, options) : SECTIONS[options.stage] ?? {}),
  usage: { input_tokens: 1, output_tokens: 1 },
  model: 'synthetic-opus',
  durationMs: 1,
  stopReason: 'end_turn',
}));

const env: AnalyzerEnv = {
  ANALYZER_ENABLED: 'true',
  FIREBASE_PROJECT_ID: 'synthetic-project',
  STAGING_SUPABASE_URL: 'https://synthetic.supabase.co',
  STAGING_SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service',
  ANTHROPIC_API_KEY: 'synthetic-anthropic',
};

describe('queued Forensic progress reporting', () => {
  const rejections: unknown[] = [];
  const onRejection = (reason: unknown) => { rejections.push(reason); };
  afterEach(() => { process.off('unhandledRejection', onRejection); rejections.length = 0; });

  it('completes the six-section report when the verification progress write is rejected, without an unhandled rejection', async () => {
    process.on('unhandledRejection', onRejection);
    const stages: string[] = [];
    // A plain function, not vi.fn: a spy attaches its own handler to returned promises,
    // which would hide the unhandled rejection this test exists to detect.
    const onProgress = async (stage: string, _percent?: number, message?: string) => {
      stages.push(stage);
      // Simulates the job ledger refusing the fire-and-forget verification-start write (the first one).
      // Later awaited section writes succeed, as they must for the run to continue.
      if (stage === 'verifying_findings' && /^Independent/.test(message ?? '')) throw Object.assign(new Error('Job state could not be persisted.'), { retryable: true });
    };
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    const request = new Request('https://analyzer-queue.internal/api/analyze', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Analysis-Id': 'req_1791000000000_queuedtest' },
      body: JSON.stringify({ documentText: DOC, mode: 'full', stream: false }),
    });

    const response = await handleAnalyzeRequest(request, env, {
      generate,
      fetcher,
      rpc: vi.fn(),
      trustedJob: { owner_uid: 'synthetic-owner', session_id: null, reservation_id: 'res_synthetic', owner_bypass: false, workerToken: 'tok', onProgress },
    });
    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(response.status).toBe(200);
    const report = await response.json() as Record<string, any>;
    expect(report.fileSummary).toBeTruthy();
    expect(Array.isArray(report.redFlags)).toBe(true);
    expect(Array.isArray(report.chronology)).toBe(true);
    expect(Array.isArray(report.whatToVerify)).toBe(true);
    expect(Array.isArray(report.thresholdAnalysis)).toBe(true);
    expect(Array.isArray(report.proceduralTimelineViolations)).toBe(true);
    expect(report.forensicVerification?.status).toBe('completed');
    expect(stages).toContain('verifying_findings');
    expect(rejections).toEqual([]);
  });
});

describe('queued Forensic progress ordering (independent review finding 2)', () => {
  it('never reports progress going backwards after early verification starts', async () => {
    const delays: Record<string, number> = { 'section:guidance': 60, 'section:timeline': 40, 'section:overview': 30, 'section:chronology': 50 };
    const slowGenerate: GenerateFn = async (options: any) => {
      await new Promise((r) => setTimeout(r, delays[options.stage] ?? 5));
      return { text: JSON.stringify(SECTIONS[options.stage] ?? {}), usage: { input_tokens: 1, output_tokens: 1 }, model: 'm', durationMs: 1, stopReason: 'end_turn' };
    };
    const seen: Array<{ stage: string; percent: number }> = [];
    const onProgress = async (stage: string, percent: number) => { seen.push({ stage, percent }); };
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    const request = new Request('https://analyzer-queue.internal/api/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Analysis-Id': 'req_1791000000000_monotonic1' }, body: JSON.stringify({ documentText: DOC, mode: 'full', stream: false }) });
    const res = await handleAnalyzeRequest(request, env, { generate: slowGenerate, fetcher, rpc: vi.fn(), trustedJob: { owner_uid: 'o', session_id: null, reservation_id: null, owner_bypass: true, workerToken: 't', onProgress } });
    expect(res.status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    const percents = seen.map((s) => s.percent);
    for (let i = 1; i < percents.length; i++) expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1]);
    const firstVerify = seen.findIndex((s) => s.stage === 'verifying_findings');
    expect(firstVerify).toBeGreaterThan(-1);
    expect(seen.slice(firstVerify).some((s) => s.stage === 'reviewing_evidence')).toBe(false);
  });
});

describe('queued analysis persists only under a held lease (lease takeover guard)', () => {
  const persistedCompletions = (fetcher: ReturnType<typeof vi.fn>) =>
    fetcher.mock.calls.filter(([url, init]: any[]) => String(url).includes('/storage/') && String(init?.body ?? '').includes('"status":"completed"'));
  const request = (id: string) => new Request('https://analyzer-queue.internal/api/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Analysis-Id': id },
    body: JSON.stringify({ documentText: DOC, mode: 'full', stream: false }),
  });

  it('a Worker whose lease check fails never writes the completed report', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as ReturnType<typeof vi.fn>;
    const assertLeaseHeld = vi.fn(async () => { throw Object.assign(new Error('lease lost'), { retryable: true, code: 'JOB_LEASE_LOST' }); });
    const response = await handleAnalyzeRequest(request('req_1791000000000_leaseguard1'), env, {
      generate, fetcher: fetcher as unknown as typeof fetch, rpc: vi.fn(),
      trustedJob: { owner_uid: 'synthetic-owner', session_id: null, reservation_id: 'res_synthetic', owner_bypass: false, workerToken: 'tok', assertLeaseHeld },
    });
    expect(assertLeaseHeld).toHaveBeenCalled();
    expect(response.status).not.toBe(200);
    expect(persistedCompletions(fetcher)).toHaveLength(0);
  });

  it('a Worker that still holds the lease persists the completed report (positive control)', async () => {
    const fetcher = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as ReturnType<typeof vi.fn>;
    const assertLeaseHeld = vi.fn(async () => undefined);
    const response = await handleAnalyzeRequest(request('req_1791000000000_leaseguard2'), env, {
      generate, fetcher: fetcher as unknown as typeof fetch, rpc: vi.fn(),
      trustedJob: { owner_uid: 'synthetic-owner', session_id: null, reservation_id: 'res_synthetic', owner_bypass: false, workerToken: 'tok', assertLeaseHeld },
    });
    expect(response.status).toBe(200);
    expect(persistedCompletions(fetcher).length).toBeGreaterThanOrEqual(1);
  });
});
