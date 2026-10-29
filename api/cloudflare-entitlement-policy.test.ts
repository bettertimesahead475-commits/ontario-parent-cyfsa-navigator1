import { describe, expect, it } from 'vitest';
import { evaluateQuickReviewAccess as decide, type EntitlementEvidence } from '../functions/api/_entitlement-policy';

const base: EntitlementEvidence = { firebaseUid: 'verified-user', ownerUid: 'verified-user' };
describe('Cloudflare entitlement policy (pure, no database or credit mutations)', () => {
  it('fails closed when database evidence is absent', () => {
    expect(decide(base)).toEqual({ allowed: false, reason: 'VERIFICATION_REQUIRED' });
  });
  it('never accepts another user or an unverified identity', () => {
    expect(decide({ ...base, ownerUid: 'other', free: { ownerUid: 'verified-user', used: 0, limit: 3 } }).allowed).toBe(false);
    expect(decide({ ...base, firebaseUid: '', free: { ownerUid: '', used: 0, limit: 3 } }).allowed).toBe(false);
    expect(decide({ ...base, free: { ownerUid: 'other', used: 0, limit: 3 } }).allowed).toBe(false);
  });
  it('enforces free scan limits and rejects malformed counters', () => {
    expect(decide({ ...base, free: { ownerUid: 'verified-user', used: 2, limit: 3 } })).toEqual({ allowed: true, source: 'free' });
    for (const used of [3, 4, -1, NaN, 0.5]) {
      expect(decide({ ...base, free: { ownerUid: 'verified-user', used, limit: 3 } }).allowed).toBe(false);
    }
  });
  it('rejects revoked, expired, depleted and foreign paid sessions', () => {
    const valid = { ownerUid: 'verified-user', tier: 'quick' as const, revokedAt: null, expiresAt: null, remainingCredits: 2 };
    expect(decide({ ...base, session: valid })).toEqual({ allowed: true, source: 'paid' });
    for (const session of [
      { ...valid, ownerUid: 'other' },
      { ...valid, revokedAt: new Date().toISOString() },
      { ...valid, expiresAt: '2020-01-01T00:00:00Z' },
      { ...valid, expiresAt: 'invalid' },
      { ...valid, remainingCredits: null },
      { ...valid, remainingCredits: 0 },
      { ...valid, remainingCredits: -1 },
    ]) expect(decide({ ...base, session }).allowed).toBe(false);
  });
  it('allows verified free entitlement when paid session is revoked', () => {
    expect(decide({
      ...base,
      session: { ownerUid: 'verified-user', tier: 'quick', revokedAt: '2026-01-01', expiresAt: null, remainingCredits: 3 },
      free: { ownerUid: 'verified-user', used: 1, limit: 3 },
    })).toEqual({ allowed: true, source: 'free' });
  });
});
