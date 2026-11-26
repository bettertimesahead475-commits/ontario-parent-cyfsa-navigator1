/**
 * DEVIN-P2-01 / DEVIN-P2-02: deterministic analyzer guards must not certify text the document does not contain.
 * Synthetic documents only; no model calls.
 */
import { describe, expect, it } from 'vitest';
import { locateQuote, severityCeiling, isVerbatimQuoteStatus } from '../../shared/quoteVerification';
import { classifyCitation, citedSections } from '../../shared/citationVerification';
import { applyReportGuards, guardCitation } from '../../api/services/analyzerSections';
import { verifyQuoteInDocumentText } from '../../api/services/analyzerRequirementExtractor';

const AFFIDAVIT =
  '[Page 1]\nAFFIDAVIT OF J. SAMPLE (synthetic)\n1. It is untrue that the father struck the child on March 3.\n' +
  '2. The mother denied that she hit the children.\n[Page 2]\n3. The worker attended the home and observed no injuries.';

describe('DEVIN-P2-01 quotation verification is word-bounded', () => {
  it.each([
    ['true that the father struck the child', 'inverts "It is untrue that..."'],
    ['he hit the child', 'is carved out of "she hit the children"'],
    ['other denied that she hit', 'drops the first letter of "mother"'],
    ['observed no injuries.\nzzz', 'adds text not present'],
  ])('%j (%s) is not located', (quote) => {
    const loc = locateQuote(AFFIDAVIT, quote);
    expect(isVerbatimQuoteStatus(loc.status)).toBe(false);
    expect(severityCeiling(loc.status)).not.toBe('CRITICAL');
  });

  it('a fabricated quotation carved from a denial cannot carry CRITICAL severity in a report', () => {
    const report = {
      redFlags: [{ phraseDetected: 'true that the father struck the child', severity: 'CRITICAL', explanation: 'Physical harm admitted.' }],
    };
    applyReportGuards(report, AFFIDAVIT);
    const flag = report.redFlags[0] as Record<string, unknown>;
    expect(flag.quoteVerified).toBe(false);
    expect(flag.severity).not.toBe('CRITICAL');
  });

  it('requirement proposals reject a quotation carved from inside words', () => {
    expect(verifyQuoteInDocumentText(AFFIDAVIT, 'true that the father struck the child')).toBe(false);
    expect(verifyQuoteInDocumentText(AFFIDAVIT, 'It is untrue that the father struck the child')).toBe(true);
  });

  it.each([
    ['It is untrue that the father struck the child', 'EXACT'],
    ['the mother denied that she hit the children', 'CASE_OR_PUNCTUATION_VARIANT'],
    ['"The worker attended the home"', 'EXACT'],
    ['3. The worker attended', 'EXACT'],
    ['observed no injuries.', 'EXACT'],
    ['she hit the children.\n[Page 2]\n3. The worker', 'EXACT'],
    ['The   mother denied', 'NORMALIZED_WHITESPACE'],
  ])('genuine quotation %j is still located (%s)', (quote, status) => {
    expect(locateQuote(AFFIDAVIT, quote).status).toBe(status);
  });

  it('a word occurring once on its own and once inside another word is not ambiguous', () => {
    expect(locateQuote('The child said no. Another note was made.', 'no').status).toBe('EXACT');
    expect(locateQuote('The child said no. Another note was made.', 'note').status).toBe('EXACT');
  });
});

describe('DEVIN-P2-02 citation pinpoints are parsed whole', () => {
  it.each([
    'CYFSA s. 1003',
    'CYFSA s. 1143',
    'CYFSA s. 74(2)(zz)',
    'CYFSA s. 81(12)3',
    'CYFSA s. 7474(2)',
    'CYFSA ss. 74(2) and 1003',
  ])('fabricated pinpoint %j is not shown as an internal reference match', (cite) => {
    expect(classifyCitation(cite).status).toBe('UNVERIFIED');
    expect(guardCitation(cite).status).toBe('UNVERIFIED');
  });

  it.each([
    ['CYFSA s. 74(2)', ['74(2)']],
    ['CYFSA s.74(2).', ['74(2)']],
    ['CYFSA ss. 74(2) and 125(1)', ['74(2)', '125(1)']],
    ['CYFSA s. 74(1)-(3)', ['74(1)', '74(2)', '74(3)']],
    ['CYFSA ss. 94(1) and (2)', ['94(1)', '94(2)']],
    ['CYFSA s. 101(1), para. 1', ['101(1), para. 1']],
    ['CYFSA s. 74(2)(d.1)', ['74(2)(d.1)']],
    ['CYFSA s. 74(2) (as in force in 2018)', ['74(2)']],
  ])('genuine citation %j still parses', (cite, sections) => {
    expect(citedSections(cite)).toEqual(sections);
  });

  it('a genuine bundled citation is still matched', () => {
    expect(classifyCitation('CYFSA ss. 74(2) and 125(1)').status).toBe('INTERNAL_REFERENCE_MATCH');
  });
  it('does not verify a quotation clipped from a "n\'t" negation', () => {
    const doc = 'I cannot attend on Monday. I can\u2019t attend on Tuesday either.';
    expect(locateQuote(doc, 'I can').status).not.toBe('EXACT');
    expect(locateQuote("She won't sign the plan.", 'She wo').status).not.toBe('EXACT');
    expect(locateQuote("The child's sister was present.", "The child").status).toBe('EXACT');
  });
  it('verifies provisions joined by an unspaced conjunction', () => {
    expect(citedSections('CYFSA s. 74(2)and s. 125(1)')).toEqual(['74(2)', '125(1)']);
  });
});
