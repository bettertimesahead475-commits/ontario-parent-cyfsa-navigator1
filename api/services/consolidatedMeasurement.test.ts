/**
 * Mocked measurement (no provider spend). Same synthetic 50-page document as api/redundancy-baseline.test.ts.
 * Counts provider calls and transmitted characters for the sectioned pipeline and the consolidated pipeline,
 * with and without reuse of completed sections.
 */
import { describe, expect, it, vi } from 'vitest';
import { runConsolidatedForensic } from './consolidatedForensic';
import { runSectionedAnalysis, type GenerateFn } from './analyzerSections';
import { COMPLETE_ANALYSIS, VERIFICATION_RESULT, completeVerification, isVerificationRequest } from '../analyzerTestFixtures';

const PAGE = 'Page text. The worker stated the child was left alone on March 3, 2026, and no record supports this. ';
const DOC = Array.from({ length: 50 }, (_, i) => `[Page ${i + 1}] ${PAGE.repeat(Math.ceil(145_640 / 50 / PAGE.length))}`).join('\n').slice(0, 145_640);

function meter() {
  const calls: { verification: boolean; chars: number }[] = [];
  const generate = vi.fn(async (params: any) => {
    const verification = isVerificationRequest(params);
    calls.push({ verification, chars: JSON.stringify(params.messages).length + String(params.system).length });
    const body = verification ? completeVerification(VERIFICATION_RESULT as any, params) : COMPLETE_ANALYSIS;
    return { text: JSON.stringify(body), usage: { input_tokens: 1, output_tokens: 1 }, model: 'm', durationMs: 1, stopReason: 'end_turn' };
  }) as unknown as GenerateFn;
  return { generate, calls };
}

const totals = (calls: { chars: number }[]) => calls.reduce((s, c) => s + c.chars, 0);
const base = (generate: GenerateFn, extra: Record<string, unknown> = {}) => ({
  mode: 'full' as const, documentText: DOC, primaryModel: 'claude-opus-5', verificationModel: 'claude-opus-5',
  generate, deadlineAt: Date.now() + 600_000, requestId: 'req_measure', ...extra,
});

describe('measured reduction: sectioned vs consolidated Forensic (mocked provider)', () => {
  it('reports calls and transmitted characters for each arm', async () => {
    const sectioned = meter();
    await runSectionedAnalysis(base(sectioned.generate) as any);

    const consolidated = meter();
    await runConsolidatedForensic(base(consolidated.generate) as any);

    // Reuse arm: four sections already completed by an earlier analysis of the same document.
    const reused = meter();
    const initial = {
      overview: { fileSummary: (COMPLETE_ANALYSIS as any).fileSummary },
      redFlags: COMPLETE_ANALYSIS.redFlags,
      chronology: COMPLETE_ANALYSIS.chronology,
      guidance: {
        whatToVerify: COMPLETE_ANALYSIS.whatToVerify,
        whatToAskALawyer: COMPLETE_ANALYSIS.whatToAskALawyer,
        whatIsMissing: COMPLETE_ANALYSIS.whatIsMissing,
        lawyerCaseBrief: COMPLETE_ANALYSIS.lawyerCaseBrief,
      },
    };
    await runConsolidatedForensic(base(reused.generate, { initialSections: initial }) as any);

    const row = (name: string, m: { calls: { verification: boolean; chars: number }[] }) => ({
      arm: name,
      providerCalls: m.calls.length,
      verificationCalls: m.calls.filter((c) => c.verification).length,
      transmittedChars: totals(m.calls),
    });
    const rows = [
      row('Sectioned Forensic (current)', sectioned),
      row('Consolidated Forensic', consolidated),
      row('Consolidated Forensic, 4 sections reused', reused),
    ];
    console.info('[MEASUREMENT]', JSON.stringify(rows));

    expect(consolidated.calls.length).toBeLessThan(sectioned.calls.length);
    expect(totals(consolidated.calls)).toBeLessThan(totals(sectioned.calls));
    expect(reused.calls.length).toBeLessThanOrEqual(consolidated.calls.length);
    expect(totals(reused.calls)).toBeLessThan(totals(consolidated.calls));
  });
});
