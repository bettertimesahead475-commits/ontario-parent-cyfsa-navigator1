import { describe, expect, it } from 'vitest';
import { legalReferenceMetadata, analysisVersionsFor } from '../../functions/api/_analysis-reuse';
import { ALL_PARENT_ASSISTANCE_RULES } from '../../shared/parentAssistanceLibrary';

describe('legal reference metadata (derived, not placeholder)', () => {
  it('derives the effective date from the rule tables, not a typed constant', async () => {
    const meta = await legalReferenceMetadata();
    const latest = ALL_PARENT_ASSISTANCE_RULES.map((r) => r.effectiveDate).sort().at(-1);
    expect(meta.legalEffectiveDate).toBe(latest);
    expect(meta.legalEffectiveDate).not.toBe('1970-01-01');
    expect(meta.legalEffectiveDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('gives a stable content-derived version label that is not the placeholder', async () => {
    const a = await legalReferenceMetadata();
    const b = await legalReferenceMetadata();
    expect(a.legalReferenceVersion).toBe(b.legalReferenceVersion);
    expect(a.legalReferenceVersion).toMatch(/^parent-assistance-[0-9a-f]{16}$/);
    expect(a.legalReferenceVersion).not.toContain('unversioned');
  });

  it('carries the derived metadata into the analysis versions used for cache keys', async () => {
    const v = await analysisVersionsFor('full', 'consolidated', { primaryModel: 'claude-opus-5', verificationModel: 'claude-opus-5' });
    const meta = await legalReferenceMetadata();
    expect(v.legalReferenceVersion).toBe(meta.legalReferenceVersion);
    expect(v.legalEffectiveDate).toBe(meta.legalEffectiveDate);
  });
});
