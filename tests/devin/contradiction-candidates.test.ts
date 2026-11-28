import { describe, expect, it } from 'vitest';
import { findContradictionCandidates, type StatementRecord } from '../../shared/contradictionCandidates';

const s = (over: Partial<StatementRecord> & { id: string; statement: string }): StatementRecord => ({
  speaker: null, date: null, locator: 'p1', context: null, ...over,
});

describe('contradiction candidates (never proven)', () => {
  it('reports a same-day denial as a candidate that requires review, never as a finding', () => {
    const out = findContradictionCandidates([
      s({ id: 'a', statement: 'the visit occurred', speaker: 'Worker', date: '2026-03-03', context: 'log' }),
      s({ id: 'b', statement: 'the visit did not occur', speaker: 'Worker', date: '2026-03-03', context: 'email' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('CANDIDATE_REQUIRES_REVIEW');
    expect(out[0].considered).toEqual({ sameSpeaker: true, dateAlignment: 'SAME_DAY', contextKnown: true });
    expect(out[0].alternativeExplanations.length).toBeGreaterThanOrEqual(2);
  });

  it('does not report a denial on a different day (both may be true)', () => {
    const out = findContradictionCandidates([
      s({ id: 'a', statement: 'the visit occurred', speaker: 'Worker', date: '2026-03-03' }),
      s({ id: 'b', statement: 'the visit did not occur', speaker: 'Worker', date: '2026-03-05' }),
    ]);
    expect(out).toEqual([]);
  });

  it('keeps the candidate but states the speaker is unknown and the date unknown', () => {
    const out = findContradictionCandidates([
      s({ id: 'a', statement: 'the notice was served' }),
      s({ id: 'b', statement: 'the notice was not served' }),
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].considered.sameSpeaker).toBeNull();
    expect(out[0].considered.dateAlignment).toBe('UNKNOWN');
    expect(out[0].alternativeExplanations.join(' ')).toMatch(/does not say who made/);
    expect(out[0].alternativeExplanations.join(' ')).toMatch(/undated/);
  });

  it('notes that different people may not be inconsistent', () => {
    const out = findContradictionCandidates([
      s({ id: 'a', statement: 'the visit occurred', speaker: 'Worker A', date: '2026-03-03' }),
      s({ id: 'b', statement: 'the visit did not occur', speaker: 'Worker B', date: '2026-03-03' }),
    ]);
    expect(out[0].considered.sameSpeaker).toBe(false);
    expect(out[0].alternativeExplanations.join(' ')).toMatch(/different people/);
  });

  it('never compares statements about different events', () => {
    const out = findContradictionCandidates([
      s({ id: 'a', statement: 'the child was at school', date: '2026-03-03' }),
      s({ id: 'b', statement: 'the parent was not at work', date: '2026-03-03' }),
    ]);
    expect(out).toEqual([]);
  });

  it('is deterministic and independent of input order', () => {
    const records = [
      s({ id: 'a', statement: 'the visit occurred', date: '2026-03-03' }),
      s({ id: 'b', statement: 'the visit did not occur', date: '2026-03-03' }),
    ];
    expect(findContradictionCandidates(records)).toEqual(findContradictionCandidates([...records].reverse()));
  });
});
