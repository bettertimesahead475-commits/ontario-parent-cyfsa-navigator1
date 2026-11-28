import { describe, expect, it } from 'vitest';
import { buildDeterministicChronology, CHRONOLOGY_INTELLIGENCE_VERSION } from '../../shared/chronologyIntelligence';

const grounded = (isoDate: string | null, status = 'GROUNDED') => ({
  dateGrounding: { status, isoDate, note: '' },
});

describe('deterministic chronology intelligence (M2B projection, no model call)', () => {
  it('orders dated rows and leaves undated rows out of the ordering', () => {
    const rows = [
      { date: 'March 5, 2026', event: 'b', ...grounded('2026-03-05') },
      { date: 'sometime', event: 'x', ...grounded(null, 'UNDATED') },
      { date: 'March 3, 2026', event: 'a', ...grounded('2026-03-03') },
    ];
    const result = buildDeterministicChronology('m1', rows as any);
    expect(result.version).toBe(CHRONOLOGY_INTELLIGENCE_VERSION);
    expect(result.datedRowIndexes).toEqual([0, 2]);
    expect(result.undatedRowIndexes).toEqual([1]);
    expect(result.orderedPairCount).toBe(1);
    expect(result.notes.some((n) => /no valid calendar date/.test(n))).toBe(true);
  });

  it('reports no conflicts when no explicit constraints exist, and says so', () => {
    const result = buildDeterministicChronology('m1', [{ ...grounded('2026-01-01') }, { ...grounded('2026-02-01') }] as any);
    expect(result.conflicts).toEqual([]);
    expect(result.notes.some((n) => /No explicit ordering constraints/.test(n))).toBe(true);
  });

  it('never alters the input rows', () => {
    const rows = [{ date: 'March 3, 2026', event: 'a', ...grounded('2026-03-03') }];
    const snapshot = JSON.stringify(rows);
    buildDeterministicChronology('m1', rows as any);
    expect(JSON.stringify(rows)).toBe(snapshot);
  });

  it('handles an empty chronology', () => {
    const result = buildDeterministicChronology('m1', []);
    expect(result.datedRowIndexes).toEqual([]);
    expect(result.orderedPairCount).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it('marks truncation above the projection limit instead of failing', () => {
    const rows = Array.from({ length: 1005 }, (_, i) => ({ ...grounded(`2026-01-${String((i % 28) + 1).padStart(2, '0')}`) }));
    const result = buildDeterministicChronology('m1', rows as any);
    expect(result.truncated).toBe(true);
    expect(result.datedRowIndexes.length).toBe(1005);
    expect(result.notes.some((n) => /Only the first 1000/.test(n))).toBe(true);
  });
});
