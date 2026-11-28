import { describe, expect, it, vi } from 'vitest';
import { runConsolidatedForensic, runConsolidatedBasic, buildConsolidatedPrompt, CONSOLIDATED_BUDGET } from './consolidatedForensic';
import { runSectionedAnalysis, type GenerateFn } from './analyzerSections';
import { AnalyzerError } from './analyzerErrors';
import { COMPLETE_ANALYSIS, VERIFICATION_RESULT, completeVerification, isVerificationRequest } from '../analyzerTestFixtures';

const DOC = 'Worker note dated March 3, 2026: the child was left alone. Second paragraph of evidence text. '.repeat(40);

type Call = { prompt: string; verification: boolean; chars: number; maxTokens: number };
type Reply = { text: string; stopReason?: string } | 'throw' | undefined;

/**
 * Mock provider. `respond(prompt, verification, index)` may override a reply. Every call is recorded, including calls
 * that the code under test refuses before sending (those never reach this function, so they are not recorded).
 */
function provider(respond?: (prompt: string, verification: boolean, index: number) => Reply) {
  const calls: Call[] = [];
  const generate = vi.fn(async (params: any) => {
    const prompt: string = params.messages[0].content[0].text;
    const verification = isVerificationRequest(params);
    calls.push({ prompt, verification, chars: JSON.stringify(params.messages).length, maxTokens: params.max_tokens });
    const custom = respond?.(prompt, verification, calls.length);
    if (custom === 'throw') throw new Error('upstream failure');
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

const comprehensive = (calls: Call[]) => calls.filter((c) => !c.verification);
const isPerSection = (c: Call) => c.prompt.includes('Produce ONLY the');

describe('consolidated Forensic pipeline: success path', () => {
  it('produces every Forensic section in one comprehensive call plus one verification call', async () => {
    const p = provider();
    const run = await runConsolidatedForensic(base(p.generate) as any);
    expect(comprehensive(p.calls)).toHaveLength(1);
    expect(p.calls.filter((c) => c.verification)).toHaveLength(1);
    for (const key of ['fileSummary', 'redFlags', 'chronology', 'whatToVerify', 'thresholdAnalysis', 'proceduralTimelineViolations']) {
      expect(run.report).toHaveProperty(key);
    }
    expect(run.report.forensicVerification).toBeDefined();
  });

  it('sends the document once in the comprehensive call', async () => {
    const p = provider();
    await runConsolidatedForensic(base(p.generate) as any);
    expect(comprehensive(p.calls)[0].prompt.split(DOC).length - 1).toBe(1);
  });

  it('transmits fewer calls and characters than the sectioned pipeline on the same input', async () => {
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
    const prompt = comprehensive(p.calls)[0].prompt;
    expect(prompt).toContain('thresholdAnalysis');
    expect(prompt).not.toContain('"whatToVerify"');
    expect(prompt).not.toContain('"chronology"');
  });

  it('builds a prompt with every requested schema key and no others', () => {
    const prompt = buildConsolidatedPrompt(['redFlags', 'thresholds'], DOC);
    expect(prompt).toContain('redFlags');
    expect(prompt).toContain('thresholdAnalysis');
    expect(prompt).not.toContain('whatToAskALawyer');
  });
});

describe('consolidated Forensic pipeline: failure paths are bounded', () => {
  it('a cut-off comprehensive answer gets one targeted repair, not a per-section pipeline', async () => {
    let first = true;
    const p = provider((prompt, verification) => {
      if (!verification && first) {
        first = false;
        return { text: '{', stopReason: 'max_tokens' };
      }
      return undefined;
    });
    const run = await runConsolidatedForensic(base(p.generate) as any);
    expect(comprehensive(p.calls)).toHaveLength(2);
    expect(p.calls.some(isPerSection)).toBe(false);
    expect(run.report).toHaveProperty('thresholdAnalysis');
  });

  it('a repair asks only for the section that failed validation', async () => {
    let first = true;
    const p = provider((prompt, verification) => {
      if (!verification && first) {
        first = false;
        return { text: JSON.stringify({ ...COMPLETE_ANALYSIS, redFlags: 'not a list' }) };
      }
      return undefined;
    });
    const run = await runConsolidatedForensic(base(p.generate) as any);
    const repair = comprehensive(p.calls)[1];
    expect(repair.prompt).toContain('CORRECTION REQUIRED');
    expect(repair.prompt).toContain('"redFlags"');
    expect(repair.prompt).not.toContain('thresholdAnalysis');
    expect(Array.isArray(run.report.redFlags)).toBe(true);
  });

  it('when the repair also fails, the run stops with an explicit incomplete-output error after two calls', async () => {
    const p = provider((_prompt, verification) => (verification ? undefined : { text: '{', stopReason: 'max_tokens' }));
    const err = await runConsolidatedForensic(base(p.generate) as any).catch((e) => e);
    expect(err).toBeInstanceOf(AnalyzerError);
    expect(err.code).toBe('AI_RESPONSE_INVALID');
    expect(err.message).toMatch(/no partial report was saved as complete/);
    expect(p.calls).toHaveLength(2);
    expect(p.calls.some((c) => c.verification)).toBe(false);
    expect(p.calls.some(isPerSection)).toBe(false);
  });

  it('provider failures are bounded the same way: two calls, then an explicit error', async () => {
    const p = provider(() => 'throw');
    await expect(runConsolidatedForensic(base(p.generate) as any)).rejects.toThrow();
    expect(p.calls).toHaveLength(2);
  });

  it('a verification that keeps failing cannot exceed the run budget', async () => {
    const p = provider((_prompt, verification) => (verification ? { text: '{' } : undefined));
    const run = await runConsolidatedForensic(base(p.generate) as any);
    expect(p.calls.length).toBeLessThanOrEqual(CONSOLIDATED_BUDGET.full.maxGenerationCalls);
    expect(run.report.forensicVerification).toBeDefined();
  });

  it('worst-case requested output stays within the cumulative token ceiling', async () => {
    const p = provider((_prompt, verification) => (verification ? { text: '{' } : { text: '{', stopReason: 'max_tokens' }));
    await runConsolidatedForensic(base(p.generate) as any).catch(() => undefined);
    const requested = p.calls.reduce((s, c) => s + c.maxTokens, 0);
    expect(requested).toBeLessThanOrEqual(CONSOLIDATED_BUDGET.full.maxOutputTokens);
    expect(p.calls.length).toBeLessThanOrEqual(CONSOLIDATED_BUDGET.full.maxGenerationCalls);
  });

  it('refuses without sending when the deadline has almost passed', async () => {
    const p = provider();
    const err = await runConsolidatedForensic(base(p.generate, { deadlineAt: Date.now() + 1_000 }) as any).catch((e) => e);
    expect(err).toBeInstanceOf(AnalyzerError);
    expect(p.calls).toHaveLength(0);
  });
});

describe('consolidated Basic (separate flag; Basic default unchanged)', () => {
  it('produces the Basic sections in one call with no verification', async () => {
    const p = provider();
    const run = await runConsolidatedBasic(base(p.generate, { mode: 'fast', verificationModel: undefined, primaryModel: 'claude-sonnet-5' }) as any);
    expect(p.calls).toHaveLength(1);
    expect(p.calls[0].verification).toBe(false);
    expect(run.report).toHaveProperty('redFlags');
    expect(run.report).toHaveProperty('whatToVerify');
    expect(run.report).not.toHaveProperty('thresholdAnalysis');
  });
});
