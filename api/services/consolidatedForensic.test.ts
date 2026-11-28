import { describe, expect, it, vi } from 'vitest';
import { runConsolidatedForensic, buildConsolidatedPrompt } from './consolidatedForensic';
import { runSectionedAnalysis, type GenerateFn } from './analyzerSections';
import { COMPLETE_ANALYSIS, VERIFICATION_RESULT, completeVerification, isVerificationRequest } from '../analyzerTestFixtures';

const DOC = 'Worker note dated March 3, 2026: the child was left alone. Second paragraph of evidence text. '.repeat(40);

type Call = { prompt: string; verification: boolean; chars: number };

/** Mock provider. `respond` decides the text for each call from its prompt; default returns the complete analysis. */
function provider(respond?: (prompt: string, index: number) => { text: string; stopReason?: string } | undefined) {
  const calls: Call[] = [];
  const generate = vi.fn(async (params: any) => {
    const prompt: string = params.messages[0].content[0].text;
    const verification = isVerificationRequest(params);
    calls.push({ prompt, verification, chars: JSON.stringify(params.messages).length });
    const custom = respond?.(prompt, calls.length);
    const text = custom?.text ?? JSON.stringify(verification ? completeVerification(VERIFICATION_RESULT as any, params) : COMPLETE_ANALYSIS);
    return { text, usage: { input_tokens: 100, output_tokens: 50 }, model: 'm', durationMs: 1, stopReason: custom?.stopReason ?? 'end_turn' };
  }) as unknown as GenerateFn;
  return { generate, calls };
}

const base = (generate: GenerateFn, extra: Record<string, unknown> = {}) => ({
  mode: 'full' as const,
  documentText: DOC,
  primaryModel: 'claude-opus-5',
  verificationModel: 'claude-opus-5',
  generate,
  deadlineAt: Date.now() + 400_000,
  requestId: 'req_consolidated_test',
  ...extra,
});

const sections = (calls: Call[]) => calls.filter((c) => !c.verification);

describe('experimental consolidated Forensic pipeline', () => {
  it('produces every Forensic section in one comprehensive call plus one verification call', async () => {
    const p = provider();
    const run = await runConsolidatedForensic(base(p.generate) as any);
    expect(sections(p.calls)).toHaveLength(1);
    expect(p.calls.filter((c) => c.verification)).toHaveLength(1);
    for (const key of ['fileSummary', 'redFlags', 'chronology', 'whatToVerify', 'thresholdAnalysis', 'proceduralTimelineViolations']) {
      expect(run.report).toHaveProperty(key);
    }
    expect(run.report.forensicVerification).toBeDefined();
  });

  it('sends the document once in the comprehensive call', async () => {
    const p = provider();
    await runConsolidatedForensic(base(p.generate) as any);
    const docOccurrences = sections(p.calls)[0].prompt.split(DOC).length - 1;
    expect(docOccurrences).toBe(1);
  });

  it('transmits fewer characters than the sectioned pipeline on the same input', async () => {
    const consolidated = provider();
    await runConsolidatedForensic(base(consolidated.generate) as any);
    const sectioned = provider();
    await runSectionedAnalysis(base(sectioned.generate) as any);
    const sum = (calls: Call[]) => calls.reduce((s, c) => s + c.chars, 0);
    expect(consolidated.calls.length).toBeLessThan(sectioned.calls.length);
    expect(sum(consolidated.calls)).toBeLessThan(sum(sectioned.calls));
  });

  it('never requests a section that was supplied as reusable input', async () => {
    const reused = {
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
    const p = provider();
    await runConsolidatedForensic(base(p.generate, { initialSections: reused }) as any);
    const prompt = sections(p.calls)[0].prompt;
    expect(prompt).toContain('thresholdAnalysis');
    expect(prompt).not.toContain('"whatToVerify"');
    expect(prompt).not.toContain('"chronology"');
  });

  it('repairs only the section that did not validate', async () => {
    let first = true;
    const p = provider((prompt) => {
      if (first && prompt.includes('TASK: Produce the following sections')) {
        first = false;
        return { text: JSON.stringify({ ...COMPLETE_ANALYSIS, redFlags: 'not a list' }) };
      }
      return undefined;
    });
    const run = await runConsolidatedForensic(base(p.generate) as any);
    const repairs = sections(p.calls).slice(1);
    expect(repairs.length).toBeGreaterThanOrEqual(1);
    // The repair asks only for the one section that failed, through the existing per-section path.
    for (const r of repairs) {
      expect(r.prompt).toContain('TASK: Produce ONLY the "Evidence findings" section');
      expect(r.prompt).not.toContain('thresholdAnalysis');
    }
    expect(run.report.redFlags).toBeDefined();
    expect(Array.isArray(run.report.redFlags)).toBe(true);
  });

  it('falls back to the per-section pipeline when the comprehensive answer is cut off', async () => {
    let first = true;
    const p = provider((prompt) => {
      if (first && prompt.includes('TASK: Produce the following sections')) {
        first = false;
        return { text: '{', stopReason: 'max_tokens' };
      }
      return undefined;
    });
    const run = await runConsolidatedForensic(base(p.generate) as any);
    expect(sections(p.calls).length).toBeGreaterThan(2);
    expect(run.report).toHaveProperty('thresholdAnalysis');
  });

  it('builds a prompt with every requested schema key and no others', () => {
    const prompt = buildConsolidatedPrompt(['redFlags', 'thresholds'], DOC);
    expect(prompt).toContain('redFlags');
    expect(prompt).toContain('thresholdAnalysis');
    expect(prompt).not.toContain('whatToAskALawyer');
  });
});
