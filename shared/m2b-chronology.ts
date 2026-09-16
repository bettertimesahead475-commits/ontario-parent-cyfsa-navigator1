import { DatePrecision, TemporalComparison, computeFingerprint } from './m2a-deterministic';

export interface EventTiming {
    id: string;
    matter_id: string;
    date_precision: DatePrecision;
    date_lower_bound: string | null;
    date_upper_bound: string | null;
    provenance_id?: string;
    created_at?: string;
    updated_at?: string;
}

export interface ExplicitRelationship {
    id: string;
    matter_id: string;
    source_event_id: string;
    target_event_id: string;
    relationship_type: TemporalComparison;
    provenance_id?: string;
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
    dependencies: string[];
}

export interface ChronologyProjection {
    matterId: string;
    edges: ChronologyEdge[];
    conflicts: ChronologyConflict[];
    fingerprint: string;
}
function validateIso(value: string | null): void {
    if (!value) return;
    const t = Date.parse(value);
    if (isNaN(t)) throw new Error(`Invalid date string: ${value}`);
}

export function compareChronologyEvents(a: EventTiming, b: EventTiming): TemporalComparison {
    if (a.matter_id !== b.matter_id) {
        throw new Error('Cross-matter comparison rejected');
    }

    if (a.id === b.id) {
        return 'INDETERMINATE_ORDER';
    }

    if (a.date_precision === 'UNKNOWN' || b.date_precision === 'UNKNOWN') {
        return 'INDETERMINATE_ORDER';
    }

    validateIso(a.date_lower_bound);
    validateIso(a.date_upper_bound);
    validateIso(b.date_lower_bound);
    validateIso(b.date_upper_bound);

    let aLower = a.date_lower_bound ? Date.parse(a.date_lower_bound) : -Infinity;
    let aUpper = a.date_upper_bound ? Date.parse(a.date_upper_bound) : Infinity;
    let bLower = b.date_lower_bound ? Date.parse(b.date_lower_bound) : -Infinity;
    let bUpper = b.date_upper_bound ? Date.parse(b.date_upper_bound) : Infinity;

    if (isNaN(aLower) || isNaN(aUpper) || isNaN(bLower) || isNaN(bUpper)) {
        throw new Error('NaN timestamp resulted from date parsing');
    }

    if (aLower !== -Infinity && aUpper !== Infinity && aLower > aUpper) throw new Error('Malformed date bounds: reversed range');
    if (bLower !== -Infinity && bUpper !== Infinity && bLower > bUpper) throw new Error('Malformed date bounds: reversed range');

    // EXACT_DATE midnight fix: expand calendar day uncertainty to span the 24h day if both bounds are the same midnight
    if (a.date_precision === 'EXACT_DATE' && aLower !== -Infinity && aLower === aUpper) {
        aUpper += 24 * 60 * 60 * 1000 - 1;
    }
    if (b.date_precision === 'EXACT_DATE' && bLower !== -Infinity && bLower === bUpper) {
        bUpper += 24 * 60 * 60 * 1000 - 1;
    }

    // Identical exact instants -> OVERLAPS
    if (a.date_precision === 'EXACT_DATETIME' && b.date_precision === 'EXACT_DATETIME') {
        if (aLower === bLower && aUpper === bUpper && aLower !== -Infinity) return 'OVERLAPS';
    }

    // SAME_KNOWN_DATE for calendar day match
    if (a.date_precision === 'EXACT_DATE' && b.date_precision === 'EXACT_DATE') {
        if (aLower === bLower && aUpper === bUpper && aLower !== -Infinity) return 'SAME_KNOWN_DATE';
    }

    // Directional bounds checks
    if (aUpper < bLower) return 'BEFORE';
    if (aLower > bUpper) return 'AFTER';

    // DATE_RANGE represents established occurrence interval in M2-A?
    // The audit requires us to define DATE_RANGE conservatively as "occurrence uncertainty" if M2-A does not establish continuous occurrence.
    // Given the ambiguity in M2-A, we treat DATE_RANGE as occurrence uncertainty. 
    // Therefore, containment inside DATE_RANGE does NOT establish OVERLAPS.
    
    return 'INDETERMINATE_ORDER';
}

export function buildChronologyProjection(
    matterId: string, 
    events: EventTiming[], 
    explicitRelationships: ExplicitRelationship[] = []
): ChronologyProjection {
    if (events.length > 1000) {
        throw new Error('Chronology event limit exceeded (max 1000)');
    }

    const edges: ChronologyEdge[] = [];
    const conflicts: ChronologyConflict[] = [];

    for (const event of events) {
        if (event.matter_id !== matterId) throw new Error('Cross-matter event rejected');
    }
    for (const rel of explicitRelationships) {
        if (rel.matter_id !== matterId) throw new Error('Cross-matter relationship rejected');
        if (rel.source_event_id === rel.target_event_id) throw new Error('Self-directional constraint rejected');
        
        const aExists = events.some(e => e.id === rel.source_event_id);
        const bExists = events.some(e => e.id === rel.target_event_id);
        if (!aExists || !bExists) throw new Error('Constraint references missing event');
    }

    // 1. Compute bounds-based edges
    for (let i = 0; i < events.length; i++) {
        for (let j = i + 1; j < events.length; j++) {
            const a = events[i];
            const b = events[j];
            const comp = compareChronologyEvents(a, b);
            if (comp !== 'INDETERMINATE_ORDER') {
                const dependencies = [a.id, b.id];
                if (a.provenance_id) dependencies.push(a.provenance_id);
                if (b.provenance_id) dependencies.push(b.provenance_id);
                edges.push({
                    sourceId: a.id,
                    targetId: b.id,
                    relationship: comp,
                    isExplicit: false,
                    dependencies
                });
            }
        }
    }

    // 2. Explicit Constraints and Direct Conflicts
    const explicitMap = new Map<string, ExplicitRelationship[]>();
    for (const rel of explicitRelationships) {
        if (rel.relationship_type === 'INDETERMINATE_ORDER') continue;
        const key = `${rel.source_event_id}|${rel.target_event_id}`;
        if (!explicitMap.has(key)) explicitMap.set(key, []);
        explicitMap.get(key)!.push(rel);
    }

    for (const rel of explicitRelationships) {
        if (rel.relationship_type === 'INDETERMINATE_ORDER') continue;
        
        const a = events.find(e => e.id === rel.source_event_id);
        const b = events.find(e => e.id === rel.target_event_id);
        if (!a || !b) continue;

        let directConflict = false;
        
        // Same direction explicit conflicts
        const sameRels = explicitMap.get(`${rel.source_event_id}|${rel.target_event_id}`) || [];
        for (const sr of sameRels) {
            if (rel.relationship_type === 'BEFORE' && (sr.relationship_type === 'AFTER' || sr.relationship_type === 'SAME_KNOWN_DATE' || sr.relationship_type === 'OVERLAPS')) directConflict = true;
            if (rel.relationship_type === 'AFTER' && (sr.relationship_type === 'BEFORE' || sr.relationship_type === 'SAME_KNOWN_DATE' || sr.relationship_type === 'OVERLAPS')) directConflict = true;
            if (rel.relationship_type === 'SAME_KNOWN_DATE' && (sr.relationship_type === 'BEFORE' || sr.relationship_type === 'AFTER')) directConflict = true;
            if (rel.relationship_type === 'OVERLAPS' && (sr.relationship_type === 'BEFORE' || sr.relationship_type === 'AFTER')) directConflict = true;
        }

        // Reverse direction explicit conflicts
        const revRels = explicitMap.get(`${rel.target_event_id}|${rel.source_event_id}`) || [];
        for (const rr of revRels) {
            if (rel.relationship_type === 'BEFORE' && (rr.relationship_type === 'BEFORE' || rr.relationship_type === 'SAME_KNOWN_DATE' || rr.relationship_type === 'OVERLAPS')) directConflict = true;
            if (rel.relationship_type === 'AFTER' && (rr.relationship_type === 'AFTER' || rr.relationship_type === 'SAME_KNOWN_DATE' || rr.relationship_type === 'OVERLAPS')) directConflict = true;
            if (rel.relationship_type === 'SAME_KNOWN_DATE' && (rr.relationship_type === 'BEFORE' || rr.relationship_type === 'AFTER')) directConflict = true;
            if (rel.relationship_type === 'OVERLAPS' && (rr.relationship_type === 'BEFORE' || rr.relationship_type === 'AFTER')) directConflict = true;
        }

        // Check against deterministic bounds
        const boundsComp = compareChronologyEvents(a, b);
        if (boundsComp !== 'INDETERMINATE_ORDER') {
            if (boundsComp === 'BEFORE' && (rel.relationship_type === 'AFTER' || rel.relationship_type === 'SAME_KNOWN_DATE' || rel.relationship_type === 'OVERLAPS')) directConflict = true;
            if (boundsComp === 'AFTER' && (rel.relationship_type === 'BEFORE' || rel.relationship_type === 'SAME_KNOWN_DATE' || rel.relationship_type === 'OVERLAPS')) directConflict = true;
            if (boundsComp === 'SAME_KNOWN_DATE' && (rel.relationship_type === 'BEFORE' || rel.relationship_type === 'AFTER')) directConflict = true;
            if (boundsComp === 'OVERLAPS' && (rel.relationship_type === 'BEFORE' || rel.relationship_type === 'AFTER')) directConflict = true;
        }

        if (directConflict) {
            // Avoid pushing duplicate conflict for the same pair
            const existingConflict = conflicts.find(c => c.type === 'CONFLICTING_CONSTRAINTS' && c.eventIds.includes(a.id) && c.eventIds.includes(b.id));
            if (!existingConflict) {
                conflicts.push({
                    type: 'CONFLICTING_CONSTRAINTS',
                    eventIds: [a.id, b.id],
                    description: `Temporal inconsistency requiring review: Available source dates do not establish a deterministic ordering consistent with the explicit constraint.`
                });
            }
        } else {
            const existingEdge = edges.find(e => 
                (e.sourceId === a.id && e.targetId === b.id) ||
                (e.sourceId === b.id && e.targetId === a.id)
            );
            if (!existingEdge) {
                const dependencies = [rel.id];
                if (rel.provenance_id) dependencies.push(rel.provenance_id);
                edges.push({
                    sourceId: a.id,
                    targetId: b.id,
                    relationship: rel.relationship_type,
                    isExplicit: true,
                    dependencies
                });
            } else if (existingEdge.isExplicit) {
                // Combine dependencies if multiple constraints yield same edge
                if (!existingEdge.dependencies.includes(rel.id)) existingEdge.dependencies.push(rel.id);
                if (rel.provenance_id && !existingEdge.dependencies.includes(rel.provenance_id)) existingEdge.dependencies.push(rel.provenance_id);
            }
        }
    }

    // 3. DFS Cycle Detection (only directional edges)
    const adj = new Map<string, string[]>();
    for (const edge of edges) {
        if (!adj.has(edge.sourceId)) adj.set(edge.sourceId, []);
        if (!adj.has(edge.targetId)) adj.set(edge.targetId, []);

        if (edge.relationship === 'BEFORE') {
            adj.get(edge.sourceId)!.push(edge.targetId);
        } else if (edge.relationship === 'AFTER') {
            adj.get(edge.targetId)!.push(edge.sourceId);
        }
    }

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
                break;
            }
        }
    }

    // 4. Compute fingerprint
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
