import { describe, expect, it } from 'vitest';
import { groundChronology, groundDate, isoIfValid, parseChronologyDate } from '../../shared/chronologyGrounding';

const DOC = 'On March 3, 2026 the worker attended. The affidavit was affirmed on 28 September 2026. Ref 113, 2026-01-05 noted.';

describe('deterministic chronology date grounding', () => {
  it('accepts only real calendar days', () => {
    expect(isoIfValid(2026, 2, 28)).toBe('2026-02-28');
    expect(isoIfValid(2026, 2, 29)).toBeNull(); // 2026 is not a leap year
    expect(isoIfValid(2024, 2, 29)).toBe('2024-02-29');
    expect(isoIfValid(2026, 2, 30)).toBeNull();
    expect(isoIfValid(2026, 13, 1)).toBeNull();
  });

  it('does not let a rollover pass an impossible written date', () => {
    expect(parseChronologyDate('February 30, 2026')).toEqual({ iso: null, invalid: true, matched: true });
    expect(groundDate('February 30, 2026', DOC).status).toBe('INVALID_CALENDAR_DATE');
  });

  it('grounds written, day-first and ISO dates found in the document', () => {
    expect(groundDate('March 3, 2026', DOC)).toMatchObject({ status: 'GROUNDED', isoDate: '2026-03-03' });
    expect(groundDate('28 September 2026', DOC)).toMatchObject({ status: 'GROUNDED', isoDate: '2026-09-28' });
    expect(groundDate('2026-01-05', DOC)).toMatchObject({ status: 'GROUNDED', isoDate: '2026-01-05' });
  });

  it('flags a valid date that the document does not contain', () => {
    expect(groundDate('July 9, 2026', DOC)).toMatchObject({ status: 'NOT_FOUND_IN_DOCUMENT', isoDate: '2026-07-09' });
  });

  it('does not match a day inside a longer number', () => {
    expect(groundDate('January 13, 2026', DOC).status).toBe('NOT_FOUND_IN_DOCUMENT');
  });

  it('reports undated and unreadable entries without guessing', () => {
    expect(groundDate('Undated', DOC).status).toBe('UNDATED');
    expect(groundDate('', DOC).status).toBe('UNDATED');
    expect(groundDate('early spring', DOC).status).toBe('UNPARSEABLE');
  });

  it('adds a grounding note to each row and leaves the AI row otherwise unchanged', () => {
    const rows = [{ date: 'March 3, 2026', event: 'Visit', locationInDocument: 'para 3' }];
    const out = groundChronology(rows, DOC);
    expect(out[0]).toEqual({ ...rows[0], dateGrounding: expect.objectContaining({ status: 'GROUNDED' }) });
    expect(rows[0]).not.toHaveProperty('dateGrounding');
  });
});
