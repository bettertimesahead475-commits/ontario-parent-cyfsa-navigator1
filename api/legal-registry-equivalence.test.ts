import { describe, expect, it } from 'vitest';
import { VERIFIED_AUTHORITIES_REGISTRY } from '../shared/legalVerificationPipeline';

// The registry entries are built by authority(<INSTRUMENT>_DEFAULTS, {...}) (SonarCloud duplication fix, 2026-11-25).
// The refactor was proven byte-identical by serialising the whole registry before and after (md5 20c9405f…).
// These checks keep every entry complete and in the canonical key order the former written-out entries had.
const REQUIRED = ['authorityId', 'citation', 'instrument', 'statuteTitle', 'sectionKey', 'heading', 'exactWording', 'sourceUrl',
  'consolidationPeriod', 'effectiveFrom', 'effectiveTo', 'verificationSourceType', 'verifiedDate'] as const;

describe('verified authorities registry', () => {
  const entries = [...new Set(Object.values(VERIFIED_AUTHORITIES_REGISTRY))];
  it('has 112 distinct entries, each complete', () => {
    expect(entries).toHaveLength(112);
    for (const e of entries as any[]) {
      for (const k of REQUIRED) expect(e, `${e.authorityId} lacks ${k}`).toHaveProperty(k);
      for (const k of REQUIRED.filter((k) => k !== 'effectiveTo')) expect(typeof e[k] === 'string' && e[k].length > 0, `${e.authorityId}.${k}`).toBe(true);
      expect(e.effectiveTo === null || /^\d{4}-\d{2}-\d{2}$/.test(e.effectiveTo)).toBe(true);
      expect(e.id).toBe(e.authorityId);
      expect(e.category).toBe(e.instrument);
    }
  });
  it('keeps the canonical key order', () => {
    for (const e of entries) expect(Object.keys(e).slice(0, REQUIRED.length)).toEqual([...REQUIRED]);
  });
});
