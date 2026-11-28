import { describe, expect, it } from 'vitest';
import { extractFoundation, foundationPromptBlock, quoteIsInDocument, FOUNDATION_SCHEMA_VERSION } from '../../shared/analyticalFoundation';

const DOC = 'On March 3, 2026 Jane Example wrote that the child was left alone at home. Mother was at work that day.';
const FP = 'a'.repeat(64);

const report = (over: Record<string, any> = {}) => ({
  metadata: { applicantName: 'Jane Example', respondentName: 'Not In Document' },
  redFlags: [
    {
      phraseDetected: 'the child was left alone at home',
      quoteVerified: true,
      evidenceClassification: 'DIRECT',
      locationInDocument: 'Page 1',
      explanation: 'Interpretation that must not be carried forward.',
      severity: 'CRITICAL',
    },
    { phraseDetected: 'the child was never fed', quoteVerified: true, locationInDocument: 'Page 2' }, // not in document
    { phraseDetected: 'Mother was at work that day.', quoteVerified: false, locationInDocument: 'Page 1' }, // unverified
  ],
  chronology: [
    { date: 'March 3, 2026', event: 'Worker wrote the note.', locationInDocument: 'Page 1', dateGrounding: { status: 'GROUNDED', isoDate: '2026-03-03', note: '' } },
    { date: 'February 30, 2026', event: 'Impossible date.', locationInDocument: 'Page 2', dateGrounding: { status: 'INVALID_CALENDAR_DATE', isoDate: null, note: '' } },
  ],
  fileSummary: 'Interpretive summary.',
  ...over,
});

const base = { documentText: DOC, documentFingerprint: FP, sourceJobId: 'req_basic_1', sourceMode: 'fast' as const };

describe('analytical foundation: facts kept, interpretations excluded', () => {
  it('keeps only verified quotations that appear in the document', () => {
    const f = extractFoundation({ ...base, report: report() });
    expect(f.quotes.map((q) => q.quote)).toEqual(['the child was left alone at home']);
  });

  it('keeps only grounded calendar dates', () => {
    const f = extractFoundation({ ...base, report: report() });
    expect(f.dates).toHaveLength(1);
    expect(f.dates[0].isoDate).toBe('2026-03-03');
  });

  it('keeps a party name only when it appears in the document', () => {
    const f = extractFoundation({ ...base, report: report() });
    expect(f.parties).toEqual([{ role: 'applicantName', name: 'Jane Example' }]);
  });

  it('never carries interpretation text forward', () => {
    const f = extractFoundation({ ...base, report: report() });
    const serialised = JSON.stringify(f);
    expect(serialised).not.toContain('Interpretation that must not be carried forward');
    expect(serialised).not.toContain('Interpretive summary');
    expect(serialised).not.toContain('CRITICAL');
    expect(f.excludedInterpretations).toContain('redFlags.explanation');
  });

  it('is mode-independent: the same facts come out of a Basic or a Forensic report', () => {
    const basic = extractFoundation({ ...base, report: report() });
    const forensic = extractFoundation({ ...base, sourceMode: 'full', report: report({ fileSummary: 'different wording' }) });
    expect(forensic.quotes).toEqual(basic.quotes);
    expect(forensic.dates).toEqual(basic.dates);
    expect(forensic.parties).toEqual(basic.parties);
    expect(basic.schemaVersion).toBe(FOUNDATION_SCHEMA_VERSION);
  });
});

describe('analytical foundation: quotation check', () => {
  it('rejects very short strings and strings absent from the document', () => {
    expect(quoteIsInDocument('left', DOC)).toBe(false);
    expect(quoteIsInDocument('the child was never fed', DOC)).toBe(false);
    expect(quoteIsInDocument('the   child was left\nalone at home', DOC)).toBe(true);
  });
});

describe('analytical foundation: prompt block invites challenge', () => {
  it('lists facts and tells the model it may challenge them', () => {
    const block = foundationPromptBlock(extractFoundation({ ...base, report: report() }));
    expect(block).toContain('the child was left alone at home');
    expect(block).toContain('2026-03-03');
    expect(block).toMatch(/challenge or extend/);
    expect(block).not.toContain('Interpretation that must not be carried forward');
  });
});
