import { describe, expect, it } from 'vitest';
import { planAnalysisReuse, type ReuseCandidate, type ReuseRequest } from '../../functions/api/_analysis-reuse';
import { REPORT_CACHE_KEY_VERSION } from '../../functions/api/_report-cache';

const NOW = Date.parse('2026-11-28T12:00:00Z');
const versions = {
  mode: 'full' as const,
  analyzerVersion: 'an-1',
  promptVersion: 'pr-7',
  primaryModel: 'claude-opus-5',
  verificationModel: 'claude-opus-5',
  legalReferenceVersion: 'law-3',
  legalEffectiveDate: '2026-01-01',
};
const fp = 'a'.repeat(64);

function candidate(over: Partial<ReuseCandidate> = {}, entryOver: Record<string, unknown> = {}): ReuseCandidate {
  return {
    entry: {
      ownerUid: 'owner-1',
      cacheKey: 'k1',
      jobId: 'req_basic_1',
      status: 'completed',
      completedAt: '2026-11-27T00:00:00Z',
      expiresAt: '2026-12-27T00:00:00Z',
      deletedAt: null,
      keyVersion: REPORT_CACHE_KEY_VERSION,
      ...entryOver,
    } as any,
    versions: { ...versions, mode: 'fast' },
    documentFingerprint: fp,
    completedSections: ['S01', 'S02', 'S03'],
    ...over,
  };
}

const request = (over: Partial<ReuseRequest> = {}): ReuseRequest => ({
  ownerUid: 'owner-1',
  cacheKey: 'k1',
  documentFingerprint: fp,
  versions,
  requiredSections: ['S01', 'S02', 'S03', 'S04'],
  now: NOW,
  ...over,
});

describe('Deep Scan reuse of a completed Basic analysis', () => {
  it('reuses every compatible section and runs only the missing one', () => {
    const d = planAnalysisReuse(candidate(), request());
    expect(d.reuse).toBe(true);
    expect(d.sectionsReused).toEqual(['S01', 'S02', 'S03']);
      expect(d.sectionsToRun).toEqual(['S04']);
      expect(d.reusedFrom).toBe('req_basic_1');
  });

  it('reuses nothing for a different account', () => {
    const d = planAnalysisReuse(candidate(), request({ ownerUid: 'owner-2' }));
    expect(d.reuse).toBe(false);
    expect(d.reasons).toContain('OWNER_MISMATCH');
  });

  it('reuses nothing when the document changed', () => {
    const d = planAnalysisReuse(candidate(), request({ documentFingerprint: 'b'.repeat(64) }));
    expect(d.reuse).toBe(false);
    expect(d.reasons).toContain('DOCUMENT_CHANGED');
  });

  it('reuses nothing when the prompt version differs (sections would not be comparable)', () => {
    const d = planAnalysisReuse(candidate(), request({ versions: { ...versions, promptVersion: 'pr-8' } }));
    expect(d.reuse).toBe(false);
    expect(d.reasons).toContain('VERSION_PROMPTVERSION');
  });

  it('reuses nothing when the legal reference version differs', () => {
    const d = planAnalysisReuse(candidate(), request({ versions: { ...versions, legalReferenceVersion: 'law-4' } }));
    expect(d.reuse).toBe(false);
    expect(d.reasons).toContain('VERSION_LEGALREFERENCEVERSION');
  });

  it('does not reuse an expired or deleted candidate', () => {
    expect(planAnalysisReuse(candidate({}, { expiresAt: '2026-11-01T00:00:00Z' }), request()).reuse).toBe(false);
    expect(planAnalysisReuse(candidate({}, { deletedAt: '2026-11-20T00:00:00Z' }), request()).reuse).toBe(false);
  });

  it('does not reuse an incomplete candidate', () => {
    expect(planAnalysisReuse(candidate({}, { status: 'running' }), request()).reuse).toBe(false);
  });

  it('runs everything when there is no candidate', () => {
    const d = planAnalysisReuse(null, request());
    expect(d).toEqual({ reuse: false, reasons: ['NO_CANDIDATE'], reusedFrom: null, sectionsReused: [], sectionsToRun: ['S01', 'S02', 'S03', 'S04'] });
  });

  it('never reports a reused section that the candidate did not complete', () => {
    const d = planAnalysisReuse(candidate({ completedSections: ['S02'] }), request());
    expect(d.reuse).toBe(true);
    expect(d.sectionsReused).toEqual(['S02']);
      expect(d.sectionsToRun).toEqual(['S01', 'S03', 'S04']);
  });
});
