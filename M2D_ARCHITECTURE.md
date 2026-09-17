# Stage 5 M2-D: Deterministic Contradiction & Corroboration Intelligence

## Overview
M2-D implements the deterministic engine for identifying, comparing, and tracking relationships between claims (contradictions, inconsistencies, and corroborations). M2-D strictly relies on the structured claims, attribution graph, chronology constraints, and provenance provided by prior layers (M2-A, M2-B, M2-C).

## 1. Relationship Semantics
M2-D maps claims to relationship types based on deterministic logical comparison rules. Relationships describe the structural logic between claims (e.g., DIRECT_CONTRADICTION, POTENTIAL_CONTRADICTION, DATE_INCONSISTENCY, LOCATION_INCONSISTENCY, ACTOR_INCONSISTENCY, INDEPENDENT_SUPPORT, ASSESSMENT_DISAGREEMENT, UNKNOWN_RELATIONSHIP).

## 2. Contradiction Standard
A true DIRECT_CONTRADICTION is strictly bounded to mutually incompatible propositions concerning the *exact same* material dimension and event. 
- Disagreement over dates or locations without confirmed event identity yields POTENTIAL_CONTRADICTION or UNKNOWN_RELATIONSHIP.
- Contradictory professional assessments are typed as ASSESSMENT_DISAGREEMENT, explicitly preventing them from being classified as factual lies.
- **Location / Actor Semantics**: For confirmed same-event identity, claims with known incompatible locations or actors are flagged as LOCATION_INCONSISTENCY or ACTOR_INCONSISTENCY. If event identity is uncertain, they fall back to POTENTIAL_CONTRADICTION or UNKNOWN.
- **CORRECTS Behavior**: A correction evolution (CORRECTS) does not automatically establish contradiction. It falls through to actual semantic comparison, preserving correction semantics without forcing false inconsistency tags.

## 3. Dimension-Aware Model
Comparisons specifically capture the dimension of disagreement (e.g., ACTOR, DATE, LOCATION, AFFIRMATION_DENIAL). This ensures users understand *what* contradicts, escaping a generic "AI contradiction" flag. Multiple dimensions can be captured simultaneously.

## 4. Source Independence Model
M2-D relies exclusively on the frozen M2-C rooted nested attribution lineage resolver (esolveRootLineages) for **matter-safe lineage reuse**, explicitly inheriting its isolation, cycle, and bounds protection.
- **Genuine Independence Standard**: A root with an attribution type that logically requires an upstream source (e.g. REPORTED_STATEMENT, DOCUMENT_RECORD) is not treated as a genuine independent origin just because 
estedSourceAttributionId is null.
- **Incomplete Lineage Behavior**: If lineage completeness is insufficient (e.g. a REPORTED_STATEMENT missing its origin), the evaluation safely fails closed to UNKNOWN_INDEPENDENCE rather than falsely corroborating.
- **SAME_ORIGIN**: Both claims derive from the identical originating root(s).
- **DEPENDENT**: There is partial overlap in the originating root(s).
- **INDEPENDENT**: The claims have distinct, non-overlapping originating root lineages.
- **UNKNOWN_INDEPENDENCE**: Occurs on corrupted/dangling attribution graphs or incomplete lineage.

## 5. Event-Identity Safety
Before flagging contradiction, the system verifies chronological and event identity bounds. If two claims describe different events or have unknown dates, a contradiction cannot be established.

## 6. Persistence Model & Review Separation
Derived intelligence is persisted in 
avigator_claim_relationships.
- **Matter Isolation**: Relationships are fiercely matter-isolated via RLS and PostgreSQL triggers verifying claim_a and claim_b matter containment.
- **Review**: Relationships start as PROPOSED at the database level by default. The system cannot self-confirm. Review state (PROPOSED, CONFIRMED) is totally independent of derived freshness (FRESH, STALE).
- **Database Test Level**: Currently, migrations are tested structurally (validating SQL constraints, triggers, default states like PROPOSED). Behavioral runtime verification against a live database is an acknowledged limitation pending a safe integration test harness.

## 7. Fingerprinting & Versioning
M2-D relationships generate fingerprints using the semantic fingerprints of the two claims, the evaluated relationship type, dimensions, and source independence status.
- **Algorithm Fingerprint Version**: Fingerprinting incorporates an explicit algorithm/version identifier (M2D_RELATIONSHIP_ALGORITHM_VERSION). 
- Changes to the algorithm version, claim semantics, or relationship type invalidate the fingerprint.

## 8. Adversarial Test Coverage (A-T Mapping)
The implementation rigorously meets the original A-T adversarial requirements via behavioral tests in m2dRelationships.test.ts or indirect validation:
- A: "A. Same originating allegation copied..." (Tested Behaviorally)
- B: "B. Same originating allegation copied through different workers..." (Tested Behaviorally)
- C: "C. Independent witness + original allegation..." (Tested Behaviorally)
- D: "D. Claim says event occurred vs did not occur..." (Tested Behaviorally)
- E: "E. Monday vs Tuesday with uncertain event identity..." (Tested Behaviorally)
- F: "F. Different locations for confirmed same event..." (Tested Behaviorally)
- G: "G. Different actors for confirmed same event..." (Tested Behaviorally)
- H: "H. Professional assessment disagreement..." (Tested Behaviorally)
- I: "I. ALLEGATION repeated in affidavit..." (Tested Indirectly in M2-C)
- J: "J. ALLEGATION + independent support != automatically FACT" (Tested Behaviorally/Conceptually)
- K: "K. REPORTED_STATEMENT != DIRECT_OBSERVATION" (Tested Behaviorally/Conceptually)
- L: "L. INDEPENDENT_SUPPORT != truth determination" (Tested Behaviorally/Conceptually)
- M: "M. SYSTEM_INFERENCE != confirmed finding" (Tested Behaviorally/Conceptually)
- N: "N. No deterministic M2-D function should infer lie/fabrication" (Tested Behaviorally/Conceptually)
- O: "O. Missing lineage => independence UNKNOWN" (Tested Behaviorally)
- P: "P. Cycle/dangling attribution => fail closed" (Tested Behaviorally)
- Q: "Q. Input ordering => deterministic identical output" (Tested Behaviorally)
- R: "R. Semantic claim mutation => derived fingerprint changes" (Tested Behaviorally)
- S: "S. CORRECTS does not automatically return POTENTIAL_CONTRADICTION" (Tested Behaviorally)
- T: "T. Retraction semantics preserved" (Tested Indirectly in deterministic logic)

## 9. Remediated Deterministic Semantics (Stage 5 Final Audit)

**Event-Identity Fingerprint Dependency**: 
Relationship evaluation and fingerprint generation now strictly require an explicit event-identity dependency (\EventDependency { isSameEvent, eventId? }\). Fingerprints fail closed if a requested relationship requires confirmed same-event identity but the dependency indicates uncertainty. This prevents accidental cross-event contradiction marking.

**Structured Comparisons**:
Hard-coded fixture values (e.g., toronto, john) have been removed from the production evaluation engine. Instead, comparisons are powered by \M2DComparisonContext\.
- **Structured Location Comparison**: Locations are compared via normalized \StructuredLocation\ properties. Conflicting location IDs within a confirmed same-event context yield \LOCATION_INCONSISTENCY\.
- **Structured Actor Comparison**: Actors are compared via \StructuredActor\ objects containing \id\ and \ole\.
- **Role-Aware Actor Semantics**: Actor comparison is explicitly role-aware. Two different actors participating in the same event do not trigger an inconsistency unless they are asserted to occupy the exact same semantic role.

**Multi-Dimension Comparison**:
M2-D does not stop processing upon detecting the first contradiction dimension. Multiple genuine dimensions (e.g., both \LOCATION\ and \ACTOR\) are deterministically aggregated, preserving full semantic visibility for conflicting reports in a single event.

**Retraction Semantics**:
A \RETRACTS\ evolution propagates into a \DIRECT_CONTRADICTION\ with \AFFIRMATION_DENIAL\ dimensions. However, M2-D preserves the original evolution relationship via an explicitly preserved \evolutionContext\ field on the relationship, ensuring the system safely represents the retraction without deleting context or wrongly inferring the original source lied.

**Behavioral Test Coverage (A-T)**:
All previously stubbed J/K/L/M/N/T behavioral invariants have been explicitly tested.

