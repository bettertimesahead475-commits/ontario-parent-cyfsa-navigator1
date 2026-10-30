import { describe, expect, it } from 'vitest';
import { validatePaidSessionRow } from '../functions/api/_paid-session-validation';

const now = Date.parse('2026-10-29T12:00:00Z');
const base = { id: 's1', firebase_uid: 'u1', tier: 'Premium', issued_at: '2026-10-01T00:00:00Z', expires_at: '2026-11-01T00:00:00Z', revoked_at: null };
const check = (row: typeof base | null, uid = 'u1', id = 's1') => validatePaidSessionRow(row, uid, id, now);

describe('paid session validation', () => {
  it('accepts matching valid sessions', () => expect(check(base)?.tier).toBe('Premium'));
  it('rejects missing and foreign sessions', () => {
    expect(check(null)).toBeNull();
    expect(check(base, 'other')).toBeNull();
    expect(check(base, 'u1', 'other')).toBeNull();
  });
  it('rejects expired and unknown tiers', () => {
    expect(check({ ...base, expires_at: '2020-01-01' })).toBeNull();
    expect(check({ ...base, tier: 'Unknown' })).toBeNull();
  });
});
