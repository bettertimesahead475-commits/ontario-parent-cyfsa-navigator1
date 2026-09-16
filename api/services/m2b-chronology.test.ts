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
        it('1. EXACT_DATE vs later timestamp same day -> NOT false BEFORE', () => {
            const e1 = makeEvent('1', 'EXACT_DATE', '2025-06-15', '2025-06-15');
            const e2 = makeEvent('2', 'EXACT_DATETIME', '2025-06-15T18:00:00Z', '2025-06-15T18:00:00Z');
            expect(compareChronologyEvents(e1, e2)).toBe('INDETERMINATE_ORDER');
        });

        it('2. EXACT_DATE vs earlier timestamp same day -> NOT false AFTER', () => {
            const e1 = makeEvent('1', 'EXACT_DATE', '2025-06-15', '2025-06-15');
            const e2 = makeEvent('2', 'EXACT_DATETIME', '2025-06-15T09:00:00Z', '2025-06-15T09:00:00Z');
            expect(compareChronologyEvents(e1, e2)).toBe('INDETERMINATE_ORDER');
        });

        it('3. two same EXACT_DATE -> SAME_KNOWN_DATE', () => {
            const e1 = makeEvent('1', 'EXACT_DATE', '2025-06-15T00:00:00Z', '2025-06-15T23:59:59Z');
            const e2 = makeEvent('2', 'EXACT_DATE', '2025-06-15T00:00:00Z', '2025-06-15T23:59:59Z');
            expect(compareChronologyEvents(e1, e2)).toBe('SAME_KNOWN_DATE');
            const e3 = makeEvent('3', 'EXACT_DATE', '2025-06-16', '2025-06-16');
            const e4 = makeEvent('4', 'EXACT_DATE', '2025-06-16', '2025-06-16');
            expect(compareChronologyEvents(e3, e4)).toBe('SAME_KNOWN_DATE');
        });

        it('4. two different exact dates -> BEFORE/AFTER', () => {
            const e1 = makeEvent('1', 'EXACT_DATE', '2025-06-15', '2025-06-15');
            const e2 = makeEvent('2', 'EXACT_DATE', '2025-06-16', '2025-06-16');
            expect(compareChronologyEvents(e1, e2)).toBe('BEFORE');
            expect(compareChronologyEvents(e2, e1)).toBe('AFTER');
        });

        it('5. identical exact datetime instants -> OVERLAPS', () => {
            const e1 = makeEvent('1', 'EXACT_DATETIME', '2025-06-15T10:00:00Z', '2025-06-15T10:00:00Z');
            const e2 = makeEvent('2', 'EXACT_DATETIME', '2025-06-15T10:00:00Z', '2025-06-15T10:00:00Z');
            expect(compareChronologyEvents(e1, e2)).toBe('OVERLAPS');
        });

        it('6. different exact datetime instants same day -> BEFORE/AFTER', () => {
            const e1 = makeEvent('1', 'EXACT_DATETIME', '2025-06-15T10:00:00Z', '2025-06-15T10:00:00Z');
            const e2 = makeEvent('2', 'EXACT_DATETIME', '2025-06-15T11:00:00Z', '2025-06-15T11:00:00Z');
            expect(compareChronologyEvents(e1, e2)).toBe('BEFORE');
            expect(compareChronologyEvents(e2, e1)).toBe('AFTER');
        });

        it('7. same-event comparison -> safe behavior', () => {
            const e1 = makeEvent('1', 'EXACT_DATE', '2025-06-15T00:00:00Z', '2025-06-15T23:59:59Z');
            expect(compareChronologyEvents(e1, e1)).toBe('INDETERMINATE_ORDER');
        });

        it('8. malformed date -> throws', () => {
            const e1 = makeEvent('1', 'EXACT_DATE', 'malformed', 'malformed');
            const e2 = makeEvent('2', 'EXACT_DATE', '2025-06-15T00:00:00Z', '2025-06-15T23:59:59Z');
            expect(() => compareChronologyEvents(e1, e2)).toThrow();
        });

        it('9. impossible date -> throws', () => {
            const e1 = makeEvent('1', 'EXACT_DATE', '2025-13-40', '2025-13-40');
            const e2 = makeEvent('2', 'EXACT_DATE', '2025-06-15T00:00:00Z', '2025-06-15T23:59:59Z');
            expect(() => compareChronologyEvents(e1, e2)).toThrow();
        });

        it('10. NaN-producing date -> throws', () => {
            const e1 = makeEvent('1', 'EXACT_DATE', 'Not a date', 'Not a date');
            const e2 = makeEvent('2', 'EXACT_DATE', '2025-06-15T00:00:00Z', '2025-06-15T23:59:59Z');
            expect(() => compareChronologyEvents(e1, e2)).toThrow();
        });

        it('11. reversed range -> throws', () => {
            const e1 = makeEvent('1', 'DATE_RANGE', '2025-06-20T00:00:00Z', '2025-06-10T00:00:00Z');
            const e2 = makeEvent('2', 'EXACT_DATE', '2025-06-15T00:00:00Z', '2025-06-15T23:59:59Z');
            expect(() => compareChronologyEvents(e1, e2)).toThrow();
        });

        it('12. overlapping uncertainty windows -> INDETERMINATE_ORDER', () => {
            const e1 = makeEvent('1', 'MONTH_ONLY', '2025-06-01T00:00:00Z', '2025-06-30T23:59:59Z');
            const e2 = makeEvent('2', 'MONTH_ONLY', '2025-06-01T00:00:00Z', '2025-06-30T23:59:59Z');
            expect(compareChronologyEvents(e1, e2)).toBe('INDETERMINATE_ORDER');
        });

        it('13. approximate contained in range -> no false OVERLAPS', () => {
            const e1 = makeEvent('1', 'DATE_RANGE', '2025-06-01T00:00:00Z', '2025-06-20T00:00:00Z');
            const e2 = makeEvent('2', 'APPROXIMATE', '2025-06-10T00:00:00Z', '2025-06-10T23:59:59Z');
            expect(compareChronologyEvents(e1, e2)).toBe('INDETERMINATE_ORDER');
        });

        it('14. month uncertainty intersection -> no false OVERLAPS', () => {
            const e1 = makeEvent('1', 'MONTH_ONLY', '2025-06-01T00:00:00Z', '2025-06-30T23:59:59Z');
            const e2 = makeEvent('2', 'MONTH_ONLY', '2025-06-15T00:00:00Z', '2025-07-15T23:59:59Z');
            expect(compareChronologyEvents(e1, e2)).toBe('INDETERMINATE_ORDER');
        });

        it('15. year uncertainty intersection -> no false OVERLAPS', () => {
            const e1 = makeEvent('1', 'YEAR_ONLY', '2025-01-01T00:00:00Z', '2025-12-31T23:59:59Z');
            const e2 = makeEvent('2', 'YEAR_ONLY', '2025-06-15T00:00:00Z', '2026-06-15T23:59:59Z');
            expect(compareChronologyEvents(e1, e2)).toBe('INDETERMINATE_ORDER');
        });

        it('16. established occurrence intervals that truly overlap -> OVERLAPS only if model supports it', () => {
            const e1 = makeEvent('1', 'DATE_RANGE', '2025-06-01T00:00:00Z', '2025-06-20T00:00:00Z');
            const e2 = makeEvent('2', 'DATE_RANGE', '2025-06-10T00:00:00Z', '2025-06-30T00:00:00Z');
            expect(compareChronologyEvents(e1, e2)).toBe('INDETERMINATE_ORDER');
        });

        it('17. SAME_KNOWN_DATE does not create cycle', () => {
            const e1 = makeEvent('1', 'EXACT_DATE', '2025-06-15T00:00:00Z', '2025-06-15T23:59:59Z');
            const e2 = makeEvent('2', 'EXACT_DATE', '2025-06-15T00:00:00Z', '2025-06-15T23:59:59Z');
            const proj = buildChronologyProjection(MATTER, [e1, e2]);
            expect(proj.conflicts.length).toBe(0);
        });

        it('18. OVERLAPS does not create cycle', () => {
            const e1 = makeEvent('1', 'EXACT_DATETIME', '2025-06-15T10:00:00Z', '2025-06-15T10:00:00Z');
            const e2 = makeEvent('2', 'EXACT_DATETIME', '2025-06-15T10:00:00Z', '2025-06-15T10:00:00Z');
            const proj = buildChronologyProjection(MATTER, [e1, e2]);
            expect(proj.conflicts.length).toBe(0);
        });

        it('19. direct A BEFORE B + A AFTER B -> CONFLICTING_CONSTRAINTS', () => {
            const e1 = makeEvent('1', 'UNKNOWN', null, null);
            const e2 = makeEvent('2', 'UNKNOWN', null, null);
            const rel1: ExplicitRelationship = { id: 'r1', matter_id: MATTER, source_event_id: '1', target_event_id: '2', relationship_type: 'BEFORE' };
            const rel2: ExplicitRelationship = { id: 'r2', matter_id: MATTER, source_event_id: '1', target_event_id: '2', relationship_type: 'AFTER' };
            const proj = buildChronologyProjection(MATTER, [e1, e2], [rel1, rel2]);
            expect(proj.conflicts.some(c => c.type === 'CONFLICTING_CONSTRAINTS')).toBe(true);
        });

        it('20. A BEFORE B, B BEFORE C, C BEFORE A -> CYCLE_DETECTED', () => {
            const e1 = makeEvent('1', 'UNKNOWN', null, null);
            const e2 = makeEvent('2', 'UNKNOWN', null, null);
            const e3 = makeEvent('3', 'UNKNOWN', null, null);
            const rel1: ExplicitRelationship = { id: 'r1', matter_id: MATTER, source_event_id: '1', target_event_id: '2', relationship_type: 'BEFORE' };
            const rel2: ExplicitRelationship = { id: 'r2', matter_id: MATTER, source_event_id: '2', target_event_id: '3', relationship_type: 'BEFORE' };
            const rel3: ExplicitRelationship = { id: 'r3', matter_id: MATTER, source_event_id: '3', target_event_id: '1', relationship_type: 'BEFORE' };
            const proj = buildChronologyProjection(MATTER, [e1, e2, e3], [rel1, rel2, rel3]);
            expect(proj.conflicts.some(c => c.type === 'CYCLE_DETECTED')).toBe(true);
        });

        it('21. cross-matter event -> reject', () => {
            const e1 = makeEvent('1', 'UNKNOWN', null, null, MATTER);
            const e2 = makeEvent('2', 'UNKNOWN', null, null, MATTER_2);
            expect(() => buildChronologyProjection(MATTER, [e1, e2])).toThrow('Cross-matter event rejected');
        });

        it('22. constraint references missing event -> reject', () => {
            const e1 = makeEvent('1', 'UNKNOWN', null, null);
            const rel1: ExplicitRelationship = { id: 'r1', matter_id: MATTER, source_event_id: '1', target_event_id: '2', relationship_type: 'BEFORE' };
            expect(() => buildChronologyProjection(MATTER, [e1], [rel1])).toThrow('Constraint references missing event');
        });

        it('23. constraint references cross-matter event -> reject', () => {
            const e1 = makeEvent('1', 'UNKNOWN', null, null);
            const e2 = makeEvent('2', 'UNKNOWN', null, null);
            const rel1: ExplicitRelationship = { id: 'r1', matter_id: MATTER_2, source_event_id: '1', target_event_id: '2', relationship_type: 'BEFORE' };
            expect(() => buildChronologyProjection(MATTER, [e1, e2], [rel1])).toThrow('Cross-matter relationship rejected');
        });

        it('24. self-directional constraint -> reject', () => {
            const e1 = makeEvent('1', 'UNKNOWN', null, null);
            const rel1: ExplicitRelationship = { id: 'r1', matter_id: MATTER, source_event_id: '1', target_event_id: '1', relationship_type: 'BEFORE' };
            expect(() => buildChronologyProjection(MATTER, [e1], [rel1])).toThrow('Self-directional constraint rejected');
        });

        it('25. provenance/dependency references survive projection', () => {
            const e1 = makeEvent('1', 'EXACT_DATE', '2025-06-15T00:00:00Z', '2025-06-15T23:59:59Z');
            e1.provenance_id = 'prov-1';
            const e2 = makeEvent('2', 'EXACT_DATE', '2025-06-16T00:00:00Z', '2025-06-16T23:59:59Z');
            e2.provenance_id = 'prov-2';
            const proj = buildChronologyProjection(MATTER, [e1, e2]);
            expect(proj.edges[0].dependencies).toContain('prov-1');
            expect(proj.edges[0].dependencies).toContain('prov-2');
        });

        it('26. fingerprint changes on semantic dependency change', () => {
            const e1 = makeEvent('1', 'EXACT_DATE', '2025-06-15', '2025-06-15');
            const e2 = makeEvent('2', 'EXACT_DATE', '2025-06-16', '2025-06-16');
            const proj1 = buildChronologyProjection(MATTER, [e1, e2]);
            
            const e1b = makeEvent('1', 'EXACT_DATE', '2025-06-20', '2025-06-20');
            const proj2 = buildChronologyProjection(MATTER, [e1b, e2]);
            expect(proj1.fingerprint).not.toBe(proj2.fingerprint);
        });

        it('27. fingerprint stable under event input reorder', () => {
            const e1 = makeEvent('1', 'EXACT_DATE', '2025-06-15', '2025-06-15');
            const e2 = makeEvent('2', 'EXACT_DATE', '2025-06-16', '2025-06-16');
            const proj1 = buildChronologyProjection(MATTER, [e1, e2]);
            const proj2 = buildChronologyProjection(MATTER, [e2, e1]);
            expect(proj1.fingerprint).toBe(proj2.fingerprint);
        });

        it('28. fingerprint stable under irrelevant metadata', () => {
            const e1 = makeEvent('1', 'EXACT_DATE', '2025-06-15', '2025-06-15');
            const e2 = makeEvent('2', 'EXACT_DATE', '2025-06-16', '2025-06-16');
            const proj1 = buildChronologyProjection(MATTER, [e1, e2]);
            
            const e1b = { ...e1, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
            const proj2 = buildChronologyProjection(MATTER, [e1b, e2]);
            expect(proj1.fingerprint).toBe(proj2.fingerprint);
        });

        it('29. event limit boundary accepted', () => {
            const events = Array.from({ length: 1000 }, (_, i) => makeEvent(`${i}`, 'UNKNOWN', null, null));
            const proj = buildChronologyProjection(MATTER, events);
            expect(proj.matterId).toBe(MATTER);
        });

        it('30. event limit exceeded -> fail closed', () => {
            const events = Array.from({ length: 1001 }, (_, i) => makeEvent(`${i}`, 'UNKNOWN', null, null));
            expect(() => buildChronologyProjection(MATTER, events)).toThrow('Chronology event limit exceeded');
        });

        it('31. UNKNOWN remains indeterminate', () => {
            const e1 = makeEvent('1', 'UNKNOWN', null, null);
            const e2 = makeEvent('2', 'EXACT_DATE', '2025-06-15T00:00:00Z', '2025-06-15T23:59:59Z');
            expect(compareChronologyEvents(e1, e2)).toBe('INDETERMINATE_ORDER');
        });
        
        it('32. BEFORE / AFTER constraint exact date comparison', () => {
            const e1 = makeEvent('1', 'BEFORE', null, '2025-06-15T00:00:00Z');
            const e2 = makeEvent('2', 'EXACT_DATE', '2025-06-20T00:00:00Z', '2025-06-20T23:59:59Z');
            expect(compareChronologyEvents(e1, e2)).toBe('BEFORE');
        });
    });
});
