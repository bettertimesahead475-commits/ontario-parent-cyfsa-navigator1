/**
 * The experimental reasoning switch changes only the section request when asked for. The default must leave every
 * generate parameter exactly as before, so Basic and the production Forensic path are unchanged.
 */
import { describe, expect, it, vi } from 'vitest';
import { runSectionedAnalysis, type GenerateFn } from '../../api/services/analyzerSections';
import { COMPLETE_ANALYSIS, VERIFICATION_RESULT, completeVerification, isVerificationRequest } from '../../api/analyzerTestFixtures';

const DOC = 'The worker states that a neighbour told her the child was left alone on March 3, 2026.';

function recorder() {
  const seen: any[] = [];
  const generate = vi.fn(async (params: any) => {
    seen.push(params);
    const body = isVerificationRequest(params) ? completeVerification(VERIFICATION_RESULT as any, params) : COMPLETE_ANALYSIS;
    return { text: JSON.stringify(body), usage: { input_tokens: 1, output_tokens: 1 }, model: 'm', durationMs: 1, stopReason: 'end_turn' };
  }) as unknown as GenerateFn;
  return { generate, seen };
}

const base = (generate: GenerateFn, extra: Record<string, unknown> = {}) => ({
  mode: 'full' as const, documentText: DOC, primaryModel: 'claude-opus-5', verificationModel: 'claude-opus-5',
  generate, deadlineAt: Date.now() + 200_000, requestId: 'req_reasoning_config', ...extra,
});

describe('experimental Forensic reasoning switch', () => {
  it('by default no section request carries a thinking flag', async () => {
    const r = recorder();
    await runSectionedAnalysis(base(r.generate) as any);
    const sections = r.seen.filter((p) => !isVerificationRequest(p));
    expect(sections.length).toBeGreaterThanOrEqual(6);
    for (const p of sections) expect(p).not.toHaveProperty('enableThinking');
  });

  it('"off" is identical to the default', async () => {
    const r = recorder();
    await runSectionedAnalysis(base(r.generate, { reasoning: 'off' }) as any);
    for (const p of r.seen.filter((p) => !isVerificationRequest(p))) expect(p).not.toHaveProperty('enableThinking');
  });

  it('"adaptive" asks for thinking on section requests only, never on verification', async () => {
    const r = recorder();
    await runSectionedAnalysis(base(r.generate, { reasoning: 'adaptive' }) as any);
    const sections = r.seen.filter((p) => !isVerificationRequest(p));
    expect(sections.length).toBeGreaterThanOrEqual(6);
    for (const p of sections) expect(p.enableThinking).toBe(true);
    for (const p of r.seen.filter((p) => isVerificationRequest(p))) expect(p).not.toHaveProperty('enableThinking');
  });
});
