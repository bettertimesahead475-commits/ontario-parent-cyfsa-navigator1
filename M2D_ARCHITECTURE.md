# Stage 5 M2-D: Deterministic Contradiction & Corroboration Intelligence

## Overview
M2-D implements the deterministic engine for identifying, comparing, and tracking relationships between claims (contradictions, inconsistencies, and corroborations). M2-D strictly relies on the structured claims, attribution graph, chronology constraints, and provenance provided by prior layers (M2-A, M2-B, M2-C).

## 1. Relationship Semantics
M2-D maps claims to relationship types based on deterministic logical comparison rules. Relationships describe the structural logic between claims (e.g., `DIRECT_CONTRADICTION`, `POTENTIAL_CONTRADICTION`, `DATE_INCONSISTENCY`, `INDEPENDENT_SUPPORT`, `ASSESSMENT_DISAGREEMENT`, `UNKNOWN_RELATIONSHIP`).

## 2. Contradiction Standard
A true `DIRECT_CONTRADICTION` is strictly bounded to mutually incompatible propositions concerning the *exact same* material dimension and event. 
- Disagreement over dates or locations without confirmed event identity yields `POTENTIAL_CONTRADICTION` or `UNKNOWN_RELATIONSHIP`.
- Contradictory professional assessments are typed as `ASSESSMENT_DISAGREEMENT`, explicitly preventing them from being classified as factual lies.

## 3. Dimension-Aware Model
Comparisons specifically capture the dimension of disagreement (e.g., `ACTOR`, `DATE`, `LOCATION`, `AFFIRMATION_DENIAL`). This ensures users understand *what* contradicts, escaping a generic "AI contradiction" flag.

## 4. Source Independence Model
M2-D relies exclusively on the M2-C rooted nested attribution lineage resolver.
- **SAME_ORIGIN**: Both claims derive from the identical originating root(s).
- **DEPENDENT**: There is partial overlap in the originating root(s).
- **INDEPENDENT**: The claims have distinct, non-overlapping originating root lineages.
- **UNKNOWN_INDEPENDENCE**: Occurs on corrupted/dangling attribution graphs. (Fails closed).
*Crucially: 5 documents repeating the same allegation yield `SAME_ORIGIN`, not independent corroboration.*

## 5. Event-Identity Safety
Before flagging contradiction, the system verifies chronological and event identity bounds. If two claims describe different events or have unknown dates, a contradiction cannot be established.

## 6. Persistence Model & Review Separation
Derived intelligence is persisted in `navigator_claim_relationships`.
- **Matter Isolation**: Relationships are fiercely matter-isolated via RLS and PostgreSQL triggers verifying `claim_a` and `claim_b` matter containment.
- **Review**: Relationships start as `PROPOSED`. The system cannot self-confirm. Review state (`PROPOSED`, `CONFIRMED`) is totally independent of derived freshness (`FRESH`, `STALE`).

## 7. Fingerprinting
M2-D relationships generate fingerprints using the semantic fingerprints of the two claims, the evaluated relationship type, dimensions, and source independence status. Extraneous IDs and timestamps are omitted. If a dependency claim's semantic representation is modified, the downstream M2-D relationship fingerprint will drift, shifting it to `STALE`.
