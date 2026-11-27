/** DEVIN-P2-03: the single-CRITICAL rule must be applied after quotation verification, not before it. */
import { describe, expect, it } from 'vitest';
import { applyReportGuards, validateRedFlags } from '../../api/services/analyzerSections';

const DOC = '[Page 1]\nSYNTHETIC CASE NOTE\nThe worker recorded: "The child was left alone overnight on two occasions."\nThe parent disputes the timeline.';

function guarded(raw: unknown) {
  const v = validateRedFlags(raw, 'full');
  if (v.ok !== true) throw new Error('validation failed');
  const report = { redFlags: v.value.redFlags } as Record<string, any>;
  applyReportGuards(report, DOC);
  return report.redFlags as Array<Record<string, any>>;
}

describe('one CRITICAL red flag per document, chosen after verification', () => {
  it('a fabricated CRITICAL listed first does not displace the located CRITICAL finding', () => {
    const flags = guarded({ redFlags: [
      { severity: 'CRITICAL', category: 'Safety', phraseDetected: 'the parent struck the child with a belt', explanation: 'Alleged physical harm.' },
      { severity: 'CRITICAL', category: 'Supervision', phraseDetected: 'The child was left alone overnight on two occasions.', explanation: 'Recorded supervision concern.' },
    ] });
    expect(flags[0].quoteVerified).toBe(false);
    expect(flags[0].severity).not.toBe('CRITICAL');
    expect(flags[1].quoteVerified).toBe(true);
    expect(flags[1].severity).toBe('CRITICAL');
    expect(flags[1].modelSeverity).toBe('CRITICAL');
  });

  it('still allows only one CRITICAL when several are located', () => {
    const flags = guarded({ redFlags: [
      { severity: 'CRITICAL', phraseDetected: 'The child was left alone overnight', explanation: 'a' },
      { severity: 'CRITICAL', phraseDetected: 'The parent disputes the timeline.', explanation: 'b' },
    ] });
    expect(flags.filter((f) => f.severity === 'CRITICAL')).toHaveLength(1);
    expect(flags[0].severity).toBe('CRITICAL');
    expect(flags[1].severity).toBe('Worth Raising With Counsel');
  });
});
