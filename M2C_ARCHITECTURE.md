# Stage 5 M2-C: Claims, Attribution, and Allegation Evolution

## Boundary and Scope
M2-C establishes the deterministic data layer for modeling claims (who said what), their attribution lineage, and how assertions evolve over time (e.g., REPEATS, EXPANDS, DENIES).
M2-C **DOES NOT** implement M2-D contradiction/corroboration scoring or AI-based truth evaluation.

## Architecture

### 1. Claim Semantics & Truth vs Assertion Distinction
A claim represents an assertion made within a source document, **not an established fact**. The existence of a claim merely proves that a proposition was stated by a specific entity at a specific time. Repeated claims do not automatically become facts.

### 2. Attribution Chains & Source Lineage
Each claim is supported by an attribution model distinguishing between direct observations, reported statements, and professional assessments. Attributions can be nested (`nested_source_attribution_id`) to preserve exactly who said what, preventing hearsay from being misclassified as direct observation.
**No False Corroboration:** Repeated statements derived from the same originating source are recognized through shared nested source attribution IDs. They do not constitute independent corroboration.

### 3. Allegation Evolution Relationships
M2-C defines precise evolution relationships (e.g., `REPEATS`, `EXPANDS`, `NARROWS`, `CHANGES_DATE`, `RETRACTS`, `DENIES`, `DISPUTES`, `CORRECTS`, `INDETERMINATE`). These describe the structural semantic relationship between two assertions without assigning credibility or designating them as "lies".

### 4. Review vs Freshness Separation
M2-C inherits the strict M2-A separation between human review state (`PROPOSED`, `CONFIRMED`, `REJECTED`, `DISPUTED`) and derived freshness state (`FRESH`, `STALE`). System-generated intelligence begins as `PROPOSED` and cannot self-confirm.

### 5. Date Safety
Uses M2-A's robust date bounds, precision models (e.g., `EXACT_DATETIME`, `APPROXIMATE`, `UNKNOWN`), and comparison engines. Unknown dates remain safely unknown and are never fabricated.

### 6. Deterministic Validation
A provider-independent deterministic layer (in TypeScript) validates classifications, attribution types, and evolution types. It produces stable cryptographic semantic fingerprints for claims and evolutions to ensure non-destructive monitoring and lineage tracking.

### 7. Strict Matter Isolation
Attributions and claim evolutions strictly adhere to M2-A matter boundary architecture. Database-level constraints explicitly forbid cross-matter entity references, cross-matter claim evolutions, and cross-matter nested attributions.

### 8. Attribution Cycle Prevention & Deletion Restriction
The nested attribution graph guarantees deterministic integrity:
- **Cycle Prevention**: Database triggers aggressively detect and reject self-reference and multi-node nested attribution cycles (failing closed). Traversal depth is firmly bounded.
- **Lineage Deletion Integrity**: The `nested_source_attribution_id` strictly utilizes `ON DELETE RESTRICT`, preventing silent lineage collapse that would make a reported statement falsely appear independent.

### 9. Root-Lineage Resolution & Corroboration Separation
M2-C provides deterministic infrastructure for resolving the originating root(s) of any given attribution graph (`resolveRootLineages`). 
- **Explicit Distinction**: Identifying independent originating lineages does *not* establish corroboration. Lineage independence evaluates origin, while corroboration involves assessing credibility and contradictions (reserved for M2-D).

### 10. Dependency-Aware Evolution Fingerprints
Evolution fingerprints explicitly incorporate the deterministic semantic fingerprints of both the source and target claims, alongside the evolution relationship type. A change to the semantic inputs of either dependent claim transparently changes the evolution fingerprint, failing closed if dependencies are missing.
