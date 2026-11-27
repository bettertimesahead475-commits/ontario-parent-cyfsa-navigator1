/**
 * Evaluation of the analyzer's deterministic safeguards against the labelled synthetic set in ./dataset.ts.
 * Reports precision/recall-style metrics and enforces the release thresholds:
 *   - no non-verbatim passage is ever accepted as a verified quotation (false acceptance = 0);
 *   - every genuine passage is verified (false rejection = 0);
 *   - no invented, wrong-Act, repealed or unidentified citation is ever matched to a CYFSA provision;
 *   - every listed CYFSA provision is matched;
 *   - document delimiters inside an upload never survive into the prompt;
 *   - a report's unsupported findings are downgraded, never shown as corroborated.
 */
import { describe, expect, it } from 'vitest';
import { locateQuote, isVerbatimQuoteStatus } from '../../shared/quoteVerification';
import { classifyCitation } from '../../shared/citationVerification';
import { applyReportGuards, neutralizeDocumentTags, buildSectionPrompt } from '../../api/services/analyzerSections';
import { SOURCE, QUOTES, CITATIONS, INJECTIONS } from './dataset';

function confusion<T>(cases: T[], label: (c: T) => boolean, predicted: (c: T) => boolean) {
  let tp = 0; let fp = 0; let tn = 0; let fn = 0;
  const errors: T[] = [];
  for (const c of cases) {
    const truth = label(c); const pred = predicted(c);
    if (truth && pred) tp++; else if (!truth && pred) { fp++; errors.push(c); } else if (!truth && !pred) tn++; else { fn++; errors.push(c); }
  }
  return { tp, fp, tn, fn, precision: tp + fp ? tp / (tp + fp) : 1, recall: tp + fn ? tp / (tp + fn) : 1, errors };
}

describe('analyzer safeguard evaluation (synthetic, labelled)', () => {
  it('quotation verification: zero false acceptances and zero false rejections', () => {
    const m = confusion(QUOTES, (c) => c.label === 'VERBATIM', (c) => isVerbatimQuoteStatus(locateQuote(SOURCE, c.quote).status));
    console.info('[EVAL quotes]', JSON.stringify({ cases: QUOTES.length, tp: m.tp, fp: m.fp, tn: m.tn, fn: m.fn, precision: m.precision, recall: m.recall }));
    expect(m.errors.map((c: any) => `${c.kind}: ${c.quote} -> ${locateQuote(SOURCE, c.quote).status}`)).toEqual([]);
  });

  it('quotation verification: each non-verbatim kind gets a qualified status, never EXACT', () => {
    const byKind: Record<string, string[]> = {};
    for (const c of QUOTES.filter((q) => q.label === 'NOT_VERBATIM')) (byKind[c.kind] ??= []).push(locateQuote(SOURCE, c.quote).status);
    console.info('[EVAL quote statuses]', JSON.stringify(byKind));
    expect(byKind['ambiguous']).toEqual(['AMBIGUOUS']);
    expect(byKind['case-variant']).toEqual(['CASE_OR_PUNCTUATION_VARIANT']);
    expect(byKind['punctuation-variant']).toEqual(['CASE_OR_PUNCTUATION_VARIANT']);
    for (const kind of ['one-word-changed', 'fabricated', 'paraphrase', 'stitched', 'empty']) expect(new Set(byKind[kind])).toEqual(new Set(['ABSENT']));
  });

  it('citation validation: no invented or misattributed provision is ever matched; every listed provision is', () => {
    const m = confusion(CITATIONS, (c) => c.label === 'MATCH', (c) => classifyCitation(c.citation).status === 'INTERNAL_REFERENCE_MATCH');
    console.info('[EVAL citations]', JSON.stringify({ cases: CITATIONS.length, tp: m.tp, fp: m.fp, tn: m.tn, fn: m.fn, precision: m.precision, recall: m.recall }));
    expect(m.errors.map((c: any) => `${c.kind}: ${c.citation} -> ${classifyCitation(c.citation).status}`)).toEqual([]);
  });

  it('prompt-injection: document delimiters inside an upload never survive into the prompt', () => {
    const tag = /<\s*\/?\s*document\s*>/gi;
    const surviving = INJECTIONS.filter((text) => (neutralizeDocumentTags(text).match(tag) || []).length > 0);
    console.info('[EVAL injection]', JSON.stringify({ cases: INJECTIONS.length, surviving: surviving.length }));
    expect(surviving).toEqual([]);
    // The assembled prompt has exactly one opening and one closing delimiter: the analyzer's own.
    const prompt = buildSectionPrompt('redFlags', 'full', `${SOURCE}\n${INJECTIONS.join('\n')}`);
    expect((prompt.match(/<\s*document\s*>/gi) || []).length).toBe(1);
    expect((prompt.match(/<\s*\/\s*document\s*>/gi) || []).length).toBe(1);
  });

  it('report guards: unsupported findings are limited and never shown as corroborated; supported ones are untouched', () => {
    const report: any = {
      redFlags: [
        { phraseDetected: 'I did not witness any shouting.', severity: 'CRITICAL', evidenceClassification: 'HEARSAY', explanation: 'x', legalReference: 'CYFSA s. 74(2)' },
        { phraseDetected: 'The parent admitted to using drugs in front of the children.', severity: 'CRITICAL', evidenceClassification: 'CORROBORATED', explanation: 'x', legalReference: 'CYFSA s. 999(4)' },
        { phraseDetected: 'I have never left the children alone at night.', severity: 'Worth Raising With Counsel', evidenceClassification: 'DIRECT', explanation: 'x', legalReference: 'Family Law Act, s. 74(2)' },
      ],
      thresholdAnalysis: [], proceduralTimelineViolations: [],
    };
    applyReportGuards(report, SOURCE);
    const [real, invented, nearMiss] = report.redFlags;
    expect(real).toMatchObject({ quoteVerified: true, severity: 'CRITICAL', citationStatus: 'INTERNAL_REFERENCE_MATCH' });
    expect(real.classificationCaveat).toBeUndefined();
    for (const f of [invented, nearMiss]) {
      expect(f.quoteVerified).toBe(false);
      expect(f.quoteVerification).toBe('ABSENT');
      expect(f.severity).not.toBe(f.modelSeverity);
      expect(f.verificationNote).toMatch(/could not be located/);
      expect(f.classificationCaveat).toMatch(/not shown as corroborated/);
      expect(f.citationStatus).toBe('UNVERIFIED');
      expect(f.legalReference).toMatch(/unverified/i);
    }
    // The model's own values are preserved for audit.
    expect(invented.modelSeverity).toBe('CRITICAL');
    console.info('[EVAL report guards]', JSON.stringify({ flags: 3, downgraded: report.redFlags.filter((f: any) => f.severity !== f.modelSeverity).length }));
  });
});
