import { describe, expect, it } from 'vitest';
import { FREE_OCR_LIFETIME_LIMIT, FREE_TRIAL_LIMITS } from '../functions/api/_free-trial';

// Owner policy (2026-11-27): OCR is included only in support of an authorised analysis. There is no standalone free
// OCR allowance, so the lifetime OCR budget for an account without a paid session equals its free analyses.
describe('free-trial OCR policy', () => {
  it('grants one OCR read per free analysis and no standalone allowance', () => {
    expect(FREE_TRIAL_LIMITS).toEqual({ quick: 1, forensic: 1 });
    expect(FREE_OCR_LIFETIME_LIMIT).toBe(FREE_TRIAL_LIMITS.quick + FREE_TRIAL_LIMITS.forensic);
  });
});
