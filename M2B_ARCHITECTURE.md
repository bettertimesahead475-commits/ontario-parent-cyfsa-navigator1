# Stage 5 M2-B: Deterministic Chronology

## Partial-Order Chronology
M2-B implements a partial-order timeline, explicitly surfacing uncertainty (INDETERMINATE_ORDER) rather than forcing a total sort that manufactures false certainty. The design produces a deterministic projection of edges and conflicts rather than persisting N² relationships in the database.

## Relationship Semantics
- **BEFORE/AFTER**: Event constraints establish sequential ordering.
- **SAME_KNOWN_DATE**: Events independently known to occur on the same calendar day but without known intra-day sequence.
- **OVERLAPS**: Intervals or identical instants that are explicitly known to intersect in time.
- **INDETERMINATE_ORDER**: Temporal bounds intersect or lack constraint such that ordering cannot be definitively derived.

## Exact Date vs Exact Datetime
- **EXACT_DATETIME** represents an exact known instant in time.
- **EXACT_DATE** means "The calendar date is known; time-of-day is not." It is an uncertainty window spanning the day. A day-level date is not falsely interpreted as UTC midnight to generate false relationships against datetimes later on the same day.

## Uncertainty Windows vs Occurrence Intervals
The model strictly differentiates:
- **Occurrence Interval**: Evidence establishes an event occupied an interval. (M2-A currently does not mandate continuous occurrence).
- **Occurrence Uncertainty**: Evidence establishes only that an event occurred somewhere within a window.

## DATE_RANGE Interpretation
`DATE_RANGE` is treated conservatively as *occurrence uncertainty*, not *continuous occurrence interval*. Containment of an uncertain point inside a `DATE_RANGE` does not falsely claim `OVERLAPS`.

## Directional vs Non-Directional Graph Relationships
- **Directional**: BEFORE, AFTER. These participate in Topological/DFS Cycle Detection.
- **Non-Directional**: SAME_KNOWN_DATE, OVERLAPS. These represent shared or overlapping temporal space but are excluded from DFS to prevent false two-node cycle reporting.

## Cycle vs Direct Conflict
- **Cycle Detected**: Reported when 3+ events form an impossible directional loop (e.g. A BEFORE B, B BEFORE C, C BEFORE A).
- **Conflicting Constraints**: Direct contradictions, such as an explicit A BEFORE B overriding an explicit A AFTER B constraint or disagreeing with deterministic event bounds.

## Explicit Constraint Trust Model
Explicit constraints (`ExplicitRelationship`) represent human or system overrides. They can resolve `INDETERMINATE_ORDER` bounds. Direct conflicts with established deterministic bounds are flagged for review. They do not silently override facts.

## Provenance / Dependency Model
Chronology edges (`ChronologyEdge`) explicitly retain the IDs of the source events, constraints, and provenance IDs (if available) that derived the edge, satisfying auditing requirements. Fingerprint validation acts as an integrity check but does not replace explicit trace dependencies.

## O(N²) Runtime and Event Limit
Projection requires evaluating pairs, resulting in O(N²) bounds checking. Input is conservatively hard-limited to 1,000 events per projection request to prevent resource exhaustion. If exceeded, the engine fails closed securely.

## No Chronology Persistence Decision
The chronology projection is a runtime operation evaluated via deterministic pure functions. No new tables are created for M2-B beyond the `M2-A` foundation.

## Review / Freshness Capability vs Persistence Distinction
The engine computes a deterministic `fingerprint` from semantically relevant dependencies. Downstream systems can use this to build review/freshness state logic. M2-B itself does not persist or execute human review APIs.

## Stage 6 UNKNOWN_DATE Compatibility
`UNKNOWN` bounds correctly fall through to `INDETERMINATE_ORDER` without generating false associations, maintaining Stage 6 support.

## M2-C Boundary
M2-B is strictly the chronology engine. It does not implement allegation evolution, source contradiction evaluation, or AI entity mapping (M2-C).
