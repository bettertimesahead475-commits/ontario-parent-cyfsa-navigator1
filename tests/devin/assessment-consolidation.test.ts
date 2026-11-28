import { describe, expect, it } from 'vitest';
import { assembleAssessmentInput, CURRENT_ANALYZER_FOR_ASSESSMENT, type AssessmentSourceRef, type VerifiedAnalysisDigest } from '../../shared/assessmentConsolidation';

const src = (id: string, text = `Original text of ${id}. Worker says child was left alone.`): AssessmentSourceRef => ({ id, document: `doc-${id}.pdf`, version: id, page: 1, text });

const digestFor = (s: AssessmentSourceRef, over: Partial<VerifiedAnalysisDigest> = {}, findingOver: Partial<VerifiedAnalysisDigest['findings'][number]> = {}): VerifiedAnalysisDigest => ({
  sourceId: s.id,
  sourceVersion: s.version,
  analyzerVersion: CURRENT_ANALYZER_FOR_ASSESSMENT,
  findings: [{ id: 'rf1', claim: 'Child left alone', quote: 'left alone', quoteVerified: true, verdict: 'SUPPORTED', ...findingOver }],
  chronology: [{ date: 'March 3, 2026', event: 'Worker visit' }],
  ...over,
});

describe('Final Case Assessment input consolidation', () => {
  it('uses a verified digest instead of the original text when every finding verified', () => {
    const a = src('a1');
    const map = new Map([[a.id, digestFor(a)]]);
    const out = assembleAssessmentInput([a], map, 100_000);
    expect(out.digestSourceIds).toEqual(['a1']);
    expect(out.rawSourceIds).toEqual([]);
    expect(out.consultedOriginalIds).toEqual([]);
    expect(out.text).not.toContain('Original text of a1');
    expect(out.text).toContain('Quote (verified)');
  });

  it('falls back to the original text when there is no analysis', () => {
    const a = src('a2');
    const out = assembleAssessmentInput([a], new Map(), 100_000);
    expect(out.rawSourceIds).toEqual(['a2']);
    expect(out.text).toContain('Original text of a2');
  });

  it('consults the original when a finding did not verify', () => {
    const a = src('a3');
    const map = new Map([[a.id, digestFor(a, {}, { quoteVerified: false })]]);
    const out = assembleAssessmentInput([a], map, 100_000);
    expect(out.consultedOriginalIds).toEqual(['a3']);
    expect(out.text).toContain('ORIGINAL TEXT (consulted for unverified findings)');
    expect(out.text).toContain('Original text of a3');
  });

  it('consults the original when a finding is marked MISQUOTED or UNSUPPORTED', () => {
    const a = src('a4');
    const misquoted = assembleAssessmentInput([a], new Map([[a.id, digestFor(a, {}, { verdict: 'MISQUOTED' })]]), 100_000);
    expect(misquoted.consultedOriginalIds).toEqual(['a4']);
  });

  it('rejects a digest for an older source version or analyzer version', () => {
    const a = src('a5');
    const oldVersion = assembleAssessmentInput([a], new Map([[a.id, digestFor(a, { sourceVersion: 'v0' })]]), 100_000);
    expect(oldVersion.rawSourceIds).toEqual(['a5']);
    const oldAnalyzer = assembleAssessmentInput([a], new Map([[a.id, digestFor(a, { analyzerVersion: 'sectioned-v0' })]]), 100_000);
    expect(oldAnalyzer.rawSourceIds).toEqual(['a5']);
  });

  it('reports the input as over budget instead of truncating it silently', () => {
    const a = src('a6', 'x'.repeat(5_000));
    const out = assembleAssessmentInput([a], new Map(), 1_000);
    expect(out.overBudget).toBe(true);
    expect(out.text).toContain('x'.repeat(5_000));
  });

  it('keeps every source represented exactly once', () => {
    const sources = [src('b1'), src('b2'), src('b3')];
    const map = new Map([['b1', digestFor(sources[0])], ['b3', digestFor(sources[2], {}, { quoteVerified: false })]]);
    const out = assembleAssessmentInput(sources, map, 100_000);
    expect(out.digestSourceIds).toEqual(['b1', 'b3']);
    expect(out.rawSourceIds).toEqual(['b2']);
    expect(out.consultedOriginalIds).toEqual(['b3']);
  });
});
