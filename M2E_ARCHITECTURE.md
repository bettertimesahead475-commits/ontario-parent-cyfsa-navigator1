# M2-E Architecture: Evidence Gaps, Unanswered Questions & Integrated Case Intelligence

## Scope
M2-E is the final major Stage-5 case-intelligence component. It deterministically identifies where the CASE RECORD appears incomplete, unresolved, weakly supported, internally uncertain, or in need of human review. It does not generate legal conclusions or determine truthfulness.

## Safety Invariants
- ABSENCE OF EVIDENCE IS NOT EVIDENCE OF ABSENCE. Missing evidence never equates to falsehood.
- Use record-scoped language (e.g., "The available record does not currently contain a source...").
- Never allow AI-generated speculation to become established fact.
- Do not let human review mutate the underlying evidence.
- Cross-matter references must fail closed.

## Finding Categories
- \SUPPORT_GAP\: Material claim lacks meaningful supporting evidence.
- \INDEPENDENCE_GAP\: Multiple sources resolve to the same lineage.
- \SOURCE_GAP\: Referenced source not in record.
- \DATE_GAP\: Unresolved, partial, or conflicting chronology.
- \ACTOR_GAP\: Unresolved/ambiguous actor attribution.
- \LOCATION_GAP\: Material location unresolved/ambiguous.
- \UNRESOLVED_CONFLICT\: Open contradiction/inconsistency from M2-D.
- \UNRESOLVED_CLAIM_EVOLUTION\: Claim evolution with uncertain state.
- \ATTRIBUTION_GAP\: Original speaker/source unresolved.
- \EVIDENCE_QUALITY_REVIEW\: Material structured quality uncertainty requiring human review or source verification (e.g., unresolved attribution quality or explicit PROPOSED/DISPUTED review state).
- \UNANSWERED_QUESTION\: Deterministic question from unresolved case-record conditions.
- \HUMAN_REVIEW_REQUIRED\: Safety fallback for unclassifiable unresolved material issues.

## Materiality Rules
Materiality represents deterministic significance within the case-intelligence graph, NOT legal importance.
- \HIGH\: Significant contradiction, multiple dependent claims, highly connected event.
- \MEDIUM\: Standard claims, isolated inconsistencies.
- \LOW\: Trivial missing metadata with no downstream dependencies.

## Provenance
Findings support many-to-many provenance to claims, events, document versions, pages, evidence items, source lineages, M2-C/M2-D relationships, and actors. Provenance objects retain full identifiers.

## Unanswered-Question Rules
- Questions must not be generic AI prompts.
- Must be traceable to deterministic case state with machine-readable provenance.
- Must ask specific questions related to the record (e.g., "What source establishes...").

## Lifecycle States
Findings use statuses: \OPEN\, \UNDER_REVIEW\, \RESOLVED\, \DISMISSED\, \SUPERSEDED\. Historical findings are preserved for auditability.

## Review Separation
Automated detection and human review are separate. Recomputation does not erase historical human review; finding state, review state, and freshness are distinctly managed.

## Freshness / Fingerprint Behavior
Findings are dependency-aware. Any material change in dependencies (e.g., claim content, M2-D relationships, added evidence) alters the semantic fingerprint, rendering the finding stale for recomputation.

## Matter Isolation
Every persisted object is safely scoped to the correct matter. Database and application layers strictly enforce this isolation.

## Source Lineage Independence
Independent support requires genuinely independent lineages. Multiple citations mapping to the same underlying source do not satisfy independence requirements.

## Aggregation / Snapshot Semantics
Produces a structured case-intelligence snapshot counting unresolved gaps, claim classifications, corroboration vs. contradiction, and stale intelligence. It is structured DATA, not prose legal conclusions.

## Explicit Non-Goals
- Deciding who is truthful or ranking parties.
- Calculating "chance of winning".
- Assigning witness credibility scores.
- Generating "generic" AI questions.
- Providing legal advice.

## Migration Validation Level
Migration validation level: STRUCTURAL. (A structural validation test was created in m2eIntelligenceMigration.test.ts to assert against the SQL statements since no disposable/local Postgres environment was authorized.)

## Test Strategy
- Deterministic test matrix (Tests A-AJ) covering gap generation logic, independence, materiality, and status lifecycles.
- Target tests for fingerprint consistency and stale computation.
- Verify migration constraints, including matter isolation and valid state transitions.

## Known Limitations
- Does not infer legal strategy or emotional importance.
- Only operates on structured, extracted case data, ignoring plain text instructions (anti-prompt injection).
