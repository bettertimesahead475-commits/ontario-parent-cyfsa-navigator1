import { describe, it, expect } from 'vitest';
import { compareChronologyEvents, buildChronologyProjection, EventTiming, ExplicitRelationship } from '../../shared/m2b-chronology';

const MATTER = 'matter-123';
const MATTER_2 = 'matter-999';

function makeEvent(id: string, precision: any, lower: string | null, upper: string | null, matter: string = MATTER): EventTiming {
    return {
        id,
        matter_id: matter,
        date_precision: precision,
        date_lower_bound: lower,
        date_upper_bound: upper,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
    };
}

describe('M2-B Deterministic Chronology Engine', () => {

    describe('Test Matrix', () => {
        it('A. exact datetime before exact datetime', () => {
            const e1 = makeEvent('1', 'EXACT_DATETIME', '2025-06-15T10:00:00Z', '2025-06-15T10:00:00Z');
            const e2 = makeEvent('2', 'EXACT_DATETIME', '2025-06-15T11:00:00Z', '2025-06-15T11:00:00Z');
            expect(compareChronologyEvents(e1, e2)).toBe('BEFORE');
        });

        it('B. exact datetime after exact datetime', () => {
            const e1 = makeEvent('1', 'EXACT_DATETIME', '2025-06-15T12:00:00Z', '2025-06-15T12:00:00Z');
            const e2 = makeEvent('2', 'EXACT_DATETIME', '2025-06-15T11:00:00Z', '2025-06-15T11:00:00Z');
            expect(compareChronologyEvents(e1, e2)).toBe('AFTER');
        });

        it('C. exact date vs later exact date', () => {
            const e1 = makeEvent('1', 'EXACT_DATE', '2025-06-15T00:00:00Z', '2025-06-15T23:59:59Z');
            const e2 = makeEvent('2', 'EXACT_DATE', '2025-06-16T00:00:00Z', '2025-06-16T23:59:59Z');
            expect(compareChronologyEvents(e1, e2)).toBe('BEFORE');
        });

        it('D. same exact date without times', () => {
            const e1 = makeEvent('1', 'EXACT_DATE', '2025-06-15T00:00:00Z', '2025-06-15T23:59:59Z');
            const e2 = makeEvent('2', 'EXACT_DATE', '2025-06-15T00:00:00Z', '2025-06-15T23:59:59Z');
            expect(compareChronologyEvents(e1, e2)).toBe('SAME_KNOWN_DATE');
        });

        it('E. exact timestamps same date but ordered', () => {
            const e1 = makeEvent('1', 'EXACT_DATETIME', '2025-06-15T10:00:00Z', '2025-06-15T10:00:00Z');
            const e2 = makeEvent('2', 'EXACT_DATETIME', '2025-06-15T11:00:00Z', '2025-06-15T11:00:00Z');
            expect(compareChronologyEvents(e1, e2)).toBe('BEFORE');
        });

        it('F. month-only vs later non-overlapping month', () => {
            const e1 = makeEvent('1', 'MONTH_ONLY', '2025-05-01T00:00:00Z', '2025-05-31T23:59:59Z');
            const e2 = makeEvent('2', 'MONTH_ONLY', '2025-06-01T00:00:00Z', '2025-06-30T23:59:59Z');
            expect(compareChronologyEvents(e1, e2)).toBe('BEFORE');
        });

        it('G. year-only vs later non-overlapping year', () => {
            const e1 = makeEvent('1', 'YEAR_ONLY', '2024-01-01T00:00:00Z', '2024-12-31T23:59:59Z');
            const e2 = makeEvent('2', 'YEAR_ONLY', '2025-01-01T00:00:00Z', '2025-12-31T23:59:59Z');
            expect(compareChronologyEvents(e1, e2)).toBe('BEFORE');
        });

        it('H. overlapping supported actual ranges', () => {
            const e1 = makeEvent('1', 'DATE_RANGE', '2025-06-01T00:00:00Z', '2025-06-10T00:00:00Z');
            const e2 = makeEvent('2', 'DATE_RANGE', '2025-06-05T00:00:00Z', '2025-06-15T00:00:00Z');
            expect(compareChronologyEvents(e1, e2)).toBe('OVERLAPS');
        });

        it('I. overlapping uncertainty windows that must remain INDETERMINATE', () => {
            const e1 = makeEvent('1', 'MONTH_ONLY', '2025-06-01T00:00:00Z', '2025-06-30T23:59:59Z');
            const e2 = makeEvent('2', 'MONTH_ONLY', '2025-06-01T00:00:00Z', '2025-06-30T23:59:59Z');
            expect(compareChronologyEvents(e1, e2)).toBe('INDETERMINATE_ORDER');
        });

        it('J. approximate date vs exact date', () => {
            // Overlapping
            const e1 = makeEvent('1', 'APPROXIMATE', '2025-06-01T00:00:00Z', '2025-06-30T23:59:59Z');
            const e2 = makeEvent('2', 'EXACT_DATE', '2025-06-15T00:00:00Z', '2025-06-15T23:59:59Z');
            expect(compareChronologyEvents(e1, e2)).toBe('INDETERMINATE_ORDER');
            // Non-overlapping
            const e3 = makeEvent('3', 'EXACT_DATE', '2025-07-15T00:00:00Z', '2025-07-15T23:59:59Z');
            expect(compareChronologyEvents(e1, e3)).toBe('BEFORE');
        });

        it('K. UNKNOWN vs exact date', () => {
            const e1 = makeEvent('1', 'UNKNOWN', null, null);
            const e2 = makeEvent('2', 'EXACT_DATE', '2025-06-15T00:00:00Z', '2025-06-15T23:59:59Z');
            expect(compareChronologyEvents(e1, e2)).toBe('INDETERMINATE_ORDER');
        });

        it('L. UNKNOWN vs UNKNOWN', () => {
            const e1 = makeEvent('1', 'UNKNOWN', null, null);
            const e2 = makeEvent('2', 'UNKNOWN', null, null);
            expect(compareChronologyEvents(e1, e2)).toBe('INDETERMINATE_ORDER');
        });

        it('M. explicit BEFORE constraint', () => {
            const e1 = makeEvent('1', 'BEFORE', null, '2025-06-10T00:00:00Z');
            const e2 = makeEvent('2', 'EXACT_DATE', '2025-06-15T00:00:00Z', '2025-06-15T23:59:59Z');
            expect(compareChronologyEvents(e1, e2)).toBe('BEFORE');
        });

        it('N. explicit AFTER constraint', () => {
            const e1 = makeEvent('1', 'AFTER', '2025-06-20T00:00:00Z', null);
            const e2 = makeEvent('2', 'EXACT_DATE', '2025-06-15T00:00:00Z', '2025-06-15T23:59:59Z');
            expect(compareChronologyEvents(e1, e2)).toBe('AFTER');
        });

        it('O. date range vs exact date', () => {
            const e1 = makeEvent('1', 'DATE_RANGE', '2025-06-01T00:00:00Z', '2025-06-20T00:00:00Z');
            const e2 = makeEvent('2', 'EXACT_DATE', '2025-06-10T00:00:00Z', '2025-06-10T23:59:59Z');
            expect(compareChronologyEvents(e1, e2)).toBe('OVERLAPS');
        });

        it('P. two date ranges with established overlap', () => {
            const e1 = makeEvent('1', 'DATE_RANGE', '2025-06-01T00:00:00Z', '2025-06-20T00:00:00Z');
            const e2 = makeEvent('2', 'DATE_RANGE', '2025-06-10T00:00:00Z', '2025-06-30T00:00:00Z');
            expect(compareChronologyEvents(e1, e2)).toBe('OVERLAPS');
        });

        it('Q. two ranges whose uncertainty prevents actual overlap determination', () => {
            // Wait, DATE_RANGE does not have uncertainty, it's actual duration.
            // If they mean two EXACT_DATEs? We already have I (overlapping uncertainty windows).
            // Let's test BEFORE vs BEFORE
            const e1 = makeEvent('1', 'BEFORE', null, '2025-06-20T00:00:00Z');
            const e2 = makeEvent('2', 'BEFORE', null, '2025-06-30T00:00:00Z');
            expect(compareChronologyEvents(e1, e2)).toBe('INDETERMINATE_ORDER');
        });

        it('R. cross-matter rejection', () => {
            const e1 = makeEvent('1', 'EXACT_DATE', '2025-06-15T00:00:00Z', '2025-06-15T23:59:59Z', MATTER);
            const e2 = makeEvent('2', 'EXACT_DATE', '2025-06-16T00:00:00Z', '2025-06-16T23:59:59Z', MATTER_2);
            expect(() => compareChronologyEvents(e1, e2)).toThrow('Cross-matter comparison rejected');
        });

        it('S. same event comparison behavior', () => {
            const e1 = makeEvent('1', 'EXACT_DATE', '2025-06-15T00:00:00Z', '2025-06-15T23:59:59Z');
            expect(compareChronologyEvents(e1, e1)).toBe('SAME_KNOWN_DATE');
            const e2 = makeEvent('2', 'DATE_RANGE', '2025-06-01T00:00:00Z', '2025-06-20T00:00:00Z');
            expect(compareChronologyEvents(e2, e2)).toBe('OVERLAPS');
        });
        
        it('T. deterministic fingerprint', () => {
            const e1 = makeEvent('1', 'EXACT_DATE', '2025-06-15T00:00:00Z', '2025-06-15T23:59:59Z');
            const e2 = makeEvent('2', 'EXACT_DATE', '2025-06-16T00:00:00Z', '2025-06-16T23:59:59Z');
            const proj1 = buildChronologyProjection(MATTER, [e1, e2]);
            const proj2 = buildChronologyProjection(MATTER, [e2, e1]); // reversed array
            expect(proj1.fingerprint).toBe(proj2.fingerprint);
            expect(proj1.fingerprint).toBeTruthy();
        });

        it('U. fingerprint changes when semantic date dependency changes', () => {
            const e1 = makeEvent('1', 'EXACT_DATE', '2025-06-15T00:00:00Z', '2025-06-15T23:59:59Z');
            const e2 = makeEvent('2', 'EXACT_DATE', '2025-06-16T00:00:00Z', '2025-06-16T23:59:59Z');
            const proj1 = buildChronologyProjection(MATTER, [e1, e2]);

            const e2_modified = makeEvent('2', 'EXACT_DATE', '2025-06-17T00:00:00Z', '2025-06-17T23:59:59Z');
            const proj2 = buildChronologyProjection(MATTER, [e1, e2_modified]);

            expect(proj1.fingerprint).not.toBe(proj2.fingerprint);
        });

        it('V. fingerprint unchanged by irrelevant metadata/order', () => {
            const e1 = makeEvent('1', 'EXACT_DATE', '2025-06-15T00:00:00Z', '2025-06-15T23:59:59Z');
            const e1_meta = { ...e1, created_at: '2020-01-01T00:00:00Z' }; // mutated irrelevant meta
            const proj1 = buildChronologyProjection(MATTER, [e1]);
            const proj2 = buildChronologyProjection(MATTER, [e1_meta]);
            expect(proj1.fingerprint).toBe(proj2.fingerprint);
        });

        it('Z. cycle/conflicting-constraint detection', () => {
            const e1 = makeEvent('1', 'UNKNOWN', null, null);
            const e2 = makeEvent('2', 'UNKNOWN', null, null);
            const e3 = makeEvent('3', 'UNKNOWN', null, null);

            // A BEFORE B, B BEFORE C, C BEFORE A
            const explicit: ExplicitRelationship[] = [
                { id: 'r1', matter_id: MATTER, source_event_id: '1', target_event_id: '2', relationship_type: 'BEFORE' },
                { id: 'r2', matter_id: MATTER, source_event_id: '2', target_event_id: '3', relationship_type: 'BEFORE' },
                { id: 'r3', matter_id: MATTER, source_event_id: '3', target_event_id: '1', relationship_type: 'BEFORE' }
            ];

            const proj = buildChronologyProjection(MATTER, [e1, e2, e3], explicit);
            expect(proj.conflicts.length).toBeGreaterThan(0);
            expect(proj.conflicts[0].type).toBe('CYCLE_DETECTED');
        });

        it('Edge Cases: malformed bounds reversed', () => {
            const e1 = makeEvent('1', 'EXACT_DATE', '2025-06-20T00:00:00Z', '2025-06-15T23:59:59Z');
            const e2 = makeEvent('2', 'UNKNOWN', null, null);
            expect(() => compareChronologyEvents(e1, e2)).toThrow('reversed range');
        });
        
        it('Edge Cases: duplicate constraints', () => {
            const e1 = makeEvent('1', 'UNKNOWN', null, null);
            const e2 = makeEvent('2', 'UNKNOWN', null, null);
            const explicit: ExplicitRelationship[] = [
                { id: 'r1', matter_id: MATTER, source_event_id: '1', target_event_id: '2', relationship_type: 'BEFORE' },
                { id: 'r2', matter_id: MATTER, source_event_id: '1', target_event_id: '2', relationship_type: 'BEFORE' }
            ];
            const proj = buildChronologyProjection(MATTER, [e1, e2], explicit);
            expect(proj.edges.length).toBe(1); // deduplicated edge
            expect(proj.conflicts.length).toBe(0);
        });
    });
});
