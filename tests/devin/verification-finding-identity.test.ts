/**
 * DEVIN-P3-01: the second review's verdicts are matched to findings by id. Model-supplied ids are not unique, so a
 * verdict on one finding must never remove or recalibrate a different finding. Synthetic document; no model calls.
 */
import { describe, expect, it } from 'vitest';
import { applyReportGuards, mergeVerification, validateRedFlags } from '../../api/services/analyzerSections';

const DOC = '[Page 1]\n1. The father struck the child on March 3.\n2. The mother was late to two visits.';
const STRUCK = { severity: 'CRITICAL', phraseDetected: 'The father struck the child on March 3.', explanation: 'Physical harm alleged.' };
const LATE = { severity: 'Worth Raising With Counsel', phraseDetected: 'The mother was late to two visits.', explanation: 'Visit lateness.' };

function reviewed(raw: { redFlags: unknown[] }, verdictFor: (ids: string[]) => Record<string, unknown>[]) {
  const v = validateRedFlags(raw, 'full') as { ok: true; value: { redFlags: Record<string, unknown>[] } };
  const report: Record<string, any> = { redFlags: v.value.redFlags };
  applyReportGuards(report, DOC);
  const ids = report.redFlags.map((f: { id: string }) => f.id);
  mergeVerification(report, { findings: verdictFor(ids) }, 'model');
  return { ids, report };
}

describe('DEVIN-P3-01 second-review verdicts reach only their own finding', () => {
  it.each([
    ['the model repeats an id', [{ id: 'rf1', ...STRUCK }, { id: 'rf1', ...LATE }]],
    ['a model id collides with a default id', [{ id: 'rf2', ...STRUCK }, LATE]],
  ])('%s: findings get distinct ids and an UNSUPPORTED verdict removes only its target', (_label, flags) => {
    const { ids, report } = reviewed({ redFlags: flags }, (ids) => [{ id: ids[1], verdict: 'UNSUPPORTED', note: 'Not significant.' }]);
    expect(new Set(ids).size).toBe(2);
    expect(report.redFlags.map((f: { phraseDetected: string }) => f.phraseDetected)).toEqual([STRUCK.phraseDetected]);
    expect(report.redFlags[0].severity).toBe('CRITICAL');
    expect(report.auditTrail.unsupportedFindings.map((f: { phraseDetected: string }) => f.phraseDetected)).toEqual([LATE.phraseDetected]);
  });

  it('a verdict for an id shared by findings already in a report (resumed job) is applied to none of them', () => {
    const report: Record<string, any> = { redFlags: [{ id: 'rf1', ...STRUCK }, { id: 'rf1', ...LATE }] };
    applyReportGuards(report, DOC);
    expect(mergeVerification(report, { findings: [{ id: 'rf1', verdict: 'UNSUPPORTED' }] }, 'model')).toBe(0);
    expect(report.redFlags).toHaveLength(2);
    expect(report.redFlags.every((f: Record<string, unknown>) => f.forensicVerification === undefined)).toBe(true);
  });

  it('distinct model ids are kept as written', () => {
    const v = validateRedFlags({ redFlags: [{ id: 'a7', ...STRUCK }, { id: 'rf1', ...LATE }] }, 'full') as { ok: true; value: { redFlags: { id: string }[] } };
    expect(v.value.redFlags.map((f) => f.id)).toEqual(['a7', 'rf1']);
  });

  it('a repeated id never takes an id that a later finding already has', () => {
    const v = validateRedFlags({ redFlags: [{ id: 'rf1', ...STRUCK }, { id: 'rf1', ...LATE }, { id: 'rf2', ...LATE, phraseDetected: 'two visits' }] }, 'full') as { ok: true; value: { redFlags: { id: string }[] } };
    expect(v.value.redFlags.map((f) => f.id)).toEqual(['rf1', 'rf3', 'rf2']);
  });
});
