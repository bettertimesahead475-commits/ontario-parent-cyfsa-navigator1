import { describe, expect, it, vi } from 'vitest';
import { planForensicReuse } from '../../functions/api/analyze';
import { analysisVersionsFor } from '../../functions/api/_analysis-reuse';
import { documentFingerprint, reportCacheKey, REPORT_CACHE_KEY_VERSION } from '../../functions/api/_report-cache';

const SECRET = 'x'.repeat(40);
const DOC = 'Worker note dated March 3, 2026. Child left alone.';
const models = { primaryModel: 'claude-opus-5', verificationModel: 'claude-opus-5' };

async function candidateFor(owner: string, versions: Awaited<ReturnType<typeof analysisVersionsFor>>, sections: string[]) {
  const fp = await documentFingerprint(SECRET, owner, DOC);
  const key = await reportCacheKey(SECRET, owner, fp, versions);
  return {
    fp,
    candidate: {
      entry: {
        ownerUid: owner,
        cacheKey: key,
        jobId: 'req_prior_1',
        status: 'completed' as const,
        completedAt: '2026-11-27T00:00:00Z',
        expiresAt: '2026-12-27T00:00:00Z',
        deletedAt: null,
        keyVersion: REPORT_CACHE_KEY_VERSION,
      },
      versions,
      documentFingerprint: fp,
      completedSections: sections,
    },
    sections: Object.fromEntries(sections.map((s) => [s, { [s]: `value-${s}` }])),
  };
}

describe('Forensic reuse wiring (experimental consolidated path)', () => {
  it('reuses nothing without a lookup or a secret', async () => {
    const versions = await analysisVersionsFor('full', 'consolidated', models);
    const none = await planForensicReuse({ env: { REPORT_CACHE_SECRET: SECRET }, ownerUid: 'a', documentText: DOC, versions });
    expect(none.initialSections).toEqual({});
    expect(none.targetSections).toBeUndefined();
    const noSecret = await planForensicReuse({ env: {}, reuseLookup: vi.fn(), ownerUid: 'a', documentText: DOC, versions });
    expect(noSecret.initialSections).toEqual({});
  });

  it('reuses compatible completed sections and asks only for the rest', async () => {
    const versions = await analysisVersionsFor('full', 'consolidated', models);
    const prior = await candidateFor('owner-1', versions, ['overview', 'redFlags']);
    const lookup = vi.fn(async () => ({ candidate: prior.candidate, sections: prior.sections }));
    const plan = await planForensicReuse({ env: { REPORT_CACHE_SECRET: SECRET }, reuseLookup: lookup, ownerUid: 'owner-1', documentText: DOC, versions });
    expect(Object.keys(plan.initialSections).sort()).toEqual(['overview', 'redFlags']);
    expect(plan.targetSections).toEqual(['chronology', 'guidance', 'thresholds', 'timeline']);
  });

  it('never reuses another account\'s sections', async () => {
    const versions = await analysisVersionsFor('full', 'consolidated', models);
    const prior = await candidateFor('owner-2', versions, ['overview']);
    // The lookup returns a candidate for another owner. The key is bound to owner-2, so owner-1 cannot match it.
    const lookup = vi.fn(async () => ({ candidate: prior.candidate, sections: prior.sections }));
    const plan = await planForensicReuse({ env: { REPORT_CACHE_SECRET: SECRET }, reuseLookup: lookup, ownerUid: 'owner-1', documentText: DOC, versions });
    expect(plan.initialSections).toEqual({});
  });

  it('does not reuse Basic sections for a Deep Scan (different prompt version)', async () => {
    const basic = await analysisVersionsFor('fast', 'sectioned', { primaryModel: 'claude-sonnet-5', verificationModel: null });
    const deep = await analysisVersionsFor('full', 'sectioned', models);
    const prior = await candidateFor('owner-1', basic, ['overview', 'redFlags', 'chronology', 'guidance']);
    const lookup = vi.fn(async () => ({ candidate: prior.candidate, sections: prior.sections }));
    const plan = await planForensicReuse({ env: { REPORT_CACHE_SECRET: SECRET }, reuseLookup: lookup, ownerUid: 'owner-1', documentText: DOC, versions: deep });
    expect(plan.initialSections).toEqual({});
    expect(plan.reasons.length).toBeGreaterThan(0);
  });

  it('a changed document reuses nothing', async () => {
    const versions = await analysisVersionsFor('full', 'consolidated', models);
    const prior = await candidateFor('owner-1', versions, ['overview']);
    const lookup = vi.fn(async () => ({ candidate: { ...prior.candidate, documentFingerprint: 'f'.repeat(64) }, sections: prior.sections }));
    const plan = await planForensicReuse({ env: { REPORT_CACHE_SECRET: SECRET }, reuseLookup: lookup, ownerUid: 'owner-1', documentText: DOC, versions });
    expect(plan.initialSections).toEqual({});
  });
});
