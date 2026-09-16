import { DatePrecision, TemporalComparison, computeFingerprint } from './m2a-deterministic';

export interface EventTiming {
    id: string;
    matter_id: string;
    date_precision: DatePrecision;
    date_lower_bound: string | null;
    date_upper_bound: string | null;
    created_at?: string; // Should be ignored for sorting
    updated_at?: string; // Should be ignored for sorting
}

export interface ExplicitRelationship {
    id: string;
    matter_id: string;
    source_event_id: string;
    target_event_id: string;
    relationship_type: TemporalComparison;
}

export interface ChronologyConflict {
    type: 'CYCLE_DETECTED' | 'CONFLICTING_CONSTRAINTS';
    eventIds: string[];
    description: string;
}

export interface ChronologyEdge {
    sourceId: string;
    targetId: string;
    relationship: TemporalComparison;
    isExplicit: boolean;
}

export interface ChronologyProjection {
    matterId: string;
    edges: ChronologyEdge[];
    conflicts: ChronologyConflict[];
    fingerprint: string;
}

export function compareChronologyEvents(a: EventTiming, b: EventTiming): TemporalComparison {
    if (a.matter_id !== b.matter_id) {
        throw new Error('Cross-matter comparison rejected');
    }

    if (a.id === b.id) {
        if (a.date_precision === 'UNKNOWN') return 'INDETERMINATE_ORDER';
        if (a.date_precision === 'DATE_RANGE') return 'OVERLAPS';
        if (a.date_precision === 'EXACT_DATETIME' || a.date_precision === 'EXACT_DATE') return 'SAME_KNOWN_DATE';
        return 'INDETERMINATE_ORDER';
    }

    if (a.date_precision === 'UNKNOWN' && b.date_precision === 'UNKNOWN') {
        return 'INDETERMINATE_ORDER';
    }

    const aLower = a.date_lower_bound ? new Date(a.date_lower_bound).getTime() : -Infinity;
    const aUpper = a.date_upper_bound ? new Date(a.date_upper_bound).getTime() : Infinity;
    const bLower = b.date_lower_bound ? new Date(b.date_lower_bound).getTime() : -Infinity;
    const bUpper = b.date_upper_bound ? new Date(b.date_upper_bound).getTime() : Infinity;

    if (aLower !== -Infinity && aUpper !== Infinity && aLower > aUpper) throw new Error('Malformed date bounds: reversed range');
    if (bLower !== -Infinity && bUpper !== Infinity && bLower > bUpper) throw new Error('Malformed date bounds: reversed range');

    if (a.date_precision === 'UNKNOWN' || b.date_precision === 'UNKNOWN') {
        return 'INDETERMINATE_ORDER';
    }

    if (aUpper < bLower) return 'BEFORE';
    if (aLower > bUpper) return 'AFTER';

    if (a.date_precision === 'EXACT_DATETIME' && b.date_precision === 'EXACT_DATETIME') {
        if (aLower === bLower && aUpper === bUpper && aLower !== -Infinity) return 'SAME_KNOWN_DATE'; 
    }

    if (a.date_precision === 'EXACT_DATE' && b.date_precision === 'EXACT_DATE') {
        if (aLower === bLower && aUpper === bUpper && aLower !== -Infinity) return 'SAME_KNOWN_DATE';
    }

    const isRange = (p: DatePrecision) => p === 'DATE_RANGE';
    const isPoint = (p: DatePrecision) => p === 'EXACT_DATETIME'; 
    const hasKnownDuration = (p: DatePrecision) => isRange(p) || isPoint(p);

    if (hasKnownDuration(a.date_precision) && hasKnownDuration(b.date_precision)) {
        if (aLower <= bUpper && aUpper >= bLower) {
            if (a.date_precision === 'EXACT_DATETIME' && b.date_precision === 'EXACT_DATETIME') return 'SAME_KNOWN_DATE';
            return 'OVERLAPS';
        }
    }

    if (isRange(a.date_precision) && !hasKnownDuration(b.date_precision)) {
        if (bLower >= aLower && bUpper <= aUpper && bLower !== -Infinity && bUpper !== Infinity) return 'OVERLAPS';
    }

    if (isRange(b.date_precision) && !hasKnownDuration(a.date_precision)) {
        if (aLower >= bLower && aUpper <= bUpper && aLower !== -Infinity && aUpper !== Infinity) return 'OVERLAPS';
    }

    return 'INDETERMINATE_ORDER';
}

export function buildChronologyProjection(
    matterId: string, 
    events: EventTiming[], 
    explicitRelationships: ExplicitRelationship[] = []
): ChronologyProjection {
    const edges: ChronologyEdge[] = [];
    const conflicts: ChronologyConflict[] = [];

    // Ensure all events belong to the matter
    for (const event of events) {
        if (event.matter_id !== matterId) throw new Error('Cross-matter event rejected');
    }
    for (const rel of explicitRelationships) {
        if (rel.matter_id !== matterId) throw new Error('Cross-matter relationship rejected');
    }

    // 1. Compute bounds-based edges for all safely orderable pairs
    // We only compute A -> B to avoid duplicates.
    for (let i = 0; i < events.length; i++) {
        for (let j = i + 1; j < events.length; j++) {
            const a = events[i];
            const b = events[j];
            const comp = compareChronologyEvents(a, b);
            if (comp !== 'INDETERMINATE_ORDER') {
                edges.push({
                    sourceId: a.id,
                    targetId: b.id,
                    relationship: comp,
                    isExplicit: false
                });
            }
        }
    }

    // 2. Add explicit relationships and check for direct contradictions
    for (const rel of explicitRelationships) {
        if (rel.relationship_type === 'INDETERMINATE_ORDER') continue;
        
        const a = events.find(e => e.id === rel.source_event_id);
        const b = events.find(e => e.id === rel.target_event_id);
        if (!a || !b) continue;

        const boundsComp = compareChronologyEvents(a, b);
        let contradiction = false;

        if (boundsComp !== 'INDETERMINATE_ORDER') {
            if (boundsComp === 'BEFORE' && (rel.relationship_type === 'AFTER' || rel.relationship_type === 'SAME_KNOWN_DATE' || rel.relationship_type === 'OVERLAPS')) contradiction = true;
            if (boundsComp === 'AFTER' && (rel.relationship_type === 'BEFORE' || rel.relationship_type === 'SAME_KNOWN_DATE' || rel.relationship_type === 'OVERLAPS')) contradiction = true;
            // Overlaps and SAME_KNOWN_DATE conflicts
            if (boundsComp === 'SAME_KNOWN_DATE' && (rel.relationship_type === 'BEFORE' || rel.relationship_type === 'AFTER')) contradiction = true;
        }

        if (contradiction) {
            conflicts.push({
                type: 'CONFLICTING_CONSTRAINTS',
                eventIds: [a.id, b.id],
                description: `Temporal inconsistency requiring review: Available source dates do not establish a deterministic ordering consistent with the explicit constraint.`
            });
        } else {
            // Check if we need to add it or if it's already represented (e.g. they align)
            const existingEdge = edges.find(e => 
                (e.sourceId === a.id && e.targetId === b.id) ||
                (e.sourceId === b.id && e.targetId === a.id)
            );
            if (!existingEdge) {
                edges.push({
                    sourceId: a.id,
                    targetId: b.id,
                    relationship: rel.relationship_type,
                    isExplicit: true
                });
            }
        }
    }

    // 3. Detect Cycles (A BEFORE B, B BEFORE C, C BEFORE A)
    // Build a directed graph for BEFORE/AFTER
    const adj = new Map<string, string[]>();
    for (const edge of edges) {
        if (!adj.has(edge.sourceId)) adj.set(edge.sourceId, []);
        if (!adj.has(edge.targetId)) adj.set(edge.targetId, []);

        if (edge.relationship === 'BEFORE') {
            adj.get(edge.sourceId)!.push(edge.targetId);
        } else if (edge.relationship === 'AFTER') {
            adj.get(edge.targetId)!.push(edge.sourceId);
        } else if (edge.relationship === 'SAME_KNOWN_DATE' || edge.relationship === 'OVERLAPS') {
            // Technically they share temporal space, so if A BEFORE B, and B SAME C, A BEFORE C.
            // We can model SAME_KNOWN_DATE as bidirectional BEFORE for cycle detection to force a cycle if ordered.
            adj.get(edge.sourceId)!.push(edge.targetId);
            adj.get(edge.targetId)!.push(edge.sourceId);
        }
    }

    // Standard DFS cycle detection
    const visited = new Set<string>();
    const recStack = new Set<string>();
    const cycleNodes: string[] = [];
    
    function isCyclic(node: string, path: string[]): boolean {
        if (recStack.has(node)) {
            cycleNodes.push(...path);
            return true;
        }
        if (visited.has(node)) return false;

        visited.add(node);
        recStack.add(node);

        const neighbors = adj.get(node) || [];
        for (const neighbor of neighbors) {
            if (isCyclic(neighbor, [...path, neighbor])) {
                return true;
            }
        }

        recStack.delete(node);
        return false;
    }

    for (const node of adj.keys()) {
        if (!visited.has(node)) {
            if (isCyclic(node, [node])) {
                conflicts.push({
                    type: 'CYCLE_DETECTED',
                    eventIds: Array.from(new Set(cycleNodes)),
                    description: 'Candidate events have conflicting temporal constraints forming an impossible cycle.'
                });
                break; // Just report one cycle for simplicity
            }
        }
    }

    // 4. Compute fingerprint
    // Sort events purely by ID and deterministic properties, explicitly excluding created_at, updated_at, db order
    const orderedEvents = [...events].sort((a, b) => a.id.localeCompare(b.id)).map(e => ({
        id: e.id,
        precision: e.date_precision,
        lower: e.date_lower_bound,
        upper: e.date_upper_bound
    }));

    const orderedRels = [...explicitRelationships].sort((a, b) => a.id.localeCompare(b.id)).map(r => ({
        id: r.id,
        source: r.source_event_id,
        target: r.target_event_id,
        rel: r.relationship_type
    }));

    const fingerprint = computeFingerprint([], { events: orderedEvents, relationships: orderedRels });

    return {
        matterId,
        edges,
        conflicts,
        fingerprint
    };
}
