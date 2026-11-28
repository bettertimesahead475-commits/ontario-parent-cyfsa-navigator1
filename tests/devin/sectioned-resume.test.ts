import { describe, expect, it, vi } from 'vitest';
import { runSectionedAnalysis, type GenerateFn } from '../../api/services/analyzerSections';
import { COMPLETE_ANALYSIS, completeVerification, isVerificationRequest, VERIFICATION_RESULT } from '../../api/analyzerTestFixtures';

const DOC = 'Synthetic page one. The worker stated the child was left alone on March 3, 2026. No record supports this.';

function meter() {
  const calls: { verification: boolean; stage: string }[] = [];
  const generate = vi.fn(async (params: any) => {
    const verification = isVerificationRequest(params);
    calls.push({ verification, stage: String(params.stage ?? '') });
    const body = verification ? completeVerification(VERIFICATION_RESULT as any, params) : COMPLETE_ANALYSIS;
    return { text: JSON.stringify(body), usage: { input_tokens: 1, output_tokens: 1 }, model: 'm', durationMs: 1, stopReason: 'end_turn' };
  }) as unknown as GenerateFn;
  return { generate, calls };
}

const base = (generate: GenerateFn, extra: Record<string, unknown> = {}) => ({
  mode: 'full' as const, documentText: DOC, primaryModel: 'claude-opus-5', verificationModel: 'claude-opus-5',
  generate, deadlineAt: Date.now() + 600_000, requestId: 'req_resume', ...extra,
});

// Report fields that the completed sections would have produced (the shape stored as a checkpoint).
const DONE = {
  overview: { fileSummary: (COMPLETE_ANALYSIS as any).fileSummary },
  redFlags: COMPLETE_ANALYSIS.redFlags,
  chronology: COMPLETE_ANALYSIS.chronology,
};

describe('sectioned pipeline resumes from checkpoints', () => {
  it('does not call the provider for sections that were already completed', async () => {
    const m = meter();
    await runSectionedAnalysis(base(m.generate, { initialSections: DONE, targetSections: ['guidance', 'thresholds', 'timeline'] }) as any);
    const sectionCalls = m.calls.filter((c) => !c.verification);
    expect(sectionCalls).toHaveLength(3);
  });

  it('with every section already complete, only verification runs, and nothing is re-generated', async () => {
    const m = meter();
    const all = { ...DONE, guidance: { whatToVerify: COMPLETE_ANALYSIS.whatToVerify, whatToAskALawyer: COMPLETE_ANALYSIS.whatToAskALawyer, whatIsMissing: COMPLETE_ANALYSIS.whatIsMissing, lawyerCaseBrief: COMPLETE_ANALYSIS.lawyerCaseBrief }, thresholdAnalysis: (COMPLETE_ANALYSIS as any).thresholdAnalysis, proceduralTimelineViolations: (COMPLETE_ANALYSIS as any).proceduralTimelineViolations, charterAndHumanRightsIssues: (COMPLETE_ANALYSIS as any).charterAndHumanRightsIssues };
    await runSectionedAnalysis(base(m.generate, { initialSections: all, targetSections: [] }) as any);
    expect(m.calls.filter((c) => !c.verification)).toHaveLength(0);
  });

  it('with no targets given, every section is generated (the default is unchanged)', async () => {
    const m = meter();
    await runSectionedAnalysis(base(m.generate) as any);
    expect(m.calls.filter((c) => !c.verification)).toHaveLength(6);
  });
});
