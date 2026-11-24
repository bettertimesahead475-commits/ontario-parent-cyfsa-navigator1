import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleAnalyzeRequest, type AnalyzerEnv } from '../functions/api/analyze';
import type { GenerateFn } from './services/analyzerSections';

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
  text: JSON.stringify(SECTIONS[options.stage] ?? {}),
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
    const onProgress = async (stage: string) => {
      stages.push(stage);
      // Simulates the job ledger refusing the write, e.g. after a lost lease.
      if (stage === 'verifying_findings') throw Object.assign(new Error('Job state could not be persisted.'), { retryable: true });
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
