import { describe, expect, it } from 'vitest';
import { monthlyCreditScope } from '../functions/api/_monthly-credit-scope';

describe('monthly forensic billing cycles', () => {
  it('clamps 31st to February and returns to 31st in March', () => {
    const issued = '2026-01-31T12:00:00Z';
    expect(monthlyCreditScope(issued, new Date('2026-02-28T11:59:59Z'))).toBe('period:2026-01-31');
    expect(monthlyCreditScope(issued, new Date('2026-02-28T12:00:00Z'))).toBe('period:2026-02-28');
    expect(monthlyCreditScope(issued, new Date('2026-03-31T12:00:00Z'))).toBe('period:2026-03-31');
  });
  it('rejects future and invalid issue dates', () => {
    expect(() => monthlyCreditScope('not-a-date', new Date())).toThrow();
    expect(() => monthlyCreditScope('2030-01-01T00:00:00Z', new Date('2026-01-01T00:00:00Z'))).toThrow();
  });
});
