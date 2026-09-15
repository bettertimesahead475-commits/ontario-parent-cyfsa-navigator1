# Stage 5 M2-A: Case Intelligence Foundation

## Purpose
Establishes the deterministic database foundation, types, and logic required for downstream Stage 5 capabilities (chronology, claims evolution, contradiction, case intelligence). This milestone focuses strictly on structure, referential integrity, immutability, and deterministic validation—delaying the actual AI extraction pipeline for subsequent milestones.

## Migration Scope
- Created ONE pending migration: `supabase/migrations_pending_approval/create_navigator_m2a_intelligence_foundation.sql`.
- **Status:** Pending approval. NOT executed against any database.

## Entity Model
Canonical case entities (`navigator_entities`), evidence-anchored entity mentions (`navigator_entity_mentions`), and candidate identity resolutions (`navigator_identity_resolutions`) are split into distinct tables. AI may propose a resolution linking a mention to an entity, but humans confirm it. Identical names do not auto-merge. Types supported: PERSON, ORGANIZATION.

## Event & Date Model
Events (`navigator_events`) represent *candidate* historical events. They do not imply verified occurrence. Participants (`navigator_event_participants`) link entities to events with explicit roles (ACTOR, SUBJECT, etc).
Dates are explicitly structured to support ambiguity: EXACT_DATETIME, EXACT_DATE, MONTH_ONLY, YEAR_ONLY, APPROXIMATE, DATE_RANGE, BEFORE, AFTER, UNKNOWN. 

## Provenance
Many-to-many provenance (`navigator_intelligence_provenance`) connects evidence items to derived intelligence objects (events, entities, etc) using strict relation types (ASSERTS, SUPPORTS, DISPUTES, etc). A single evidence ID is not placed flatly on every intelligence object, enforcing that one evidence item may relate to many objects in distinct ways.

## Review Audit & Freshness
All intelligence tables include a `review_state` (PROPOSED, CONFIRMED, REJECTED, DISPUTED) and `freshness_state` (FRESH, STALE). `navigator_intelligence_review_actions` tracks historical state changes in an append-only manner, protected by Postgres triggers.

## Security
- Tables enforce matter-scoped reference isolation via trigger (`navigator_m2a_matter_boundary_guard`).
- Append-only audit logging enforced via trigger.
- Provenance relations are immutable post-creation.
- RLS enabled; full access revoked from public and granted only to `service_role`.

## Deterministic Service Layer
`shared/m2a-deterministic.ts` implements pure unit-tested functions for:
- Structured date validation (`validateStructuredDate`)
- Temporal comparison (`compareDates`) mapping to BEFORE, AFTER, OVERLAPS, SAME_KNOWN_DATE, INDETERMINATE_ORDER.
- Derivation fingerprinting (`computeFingerprint`)
- Provenance typing (`validateProvenanceType`)

## Test Coverage
Verified by `api/services/caseIntelligence.test.ts`. Tests assert that deterministic logic strictly fulfills business requirements without I/O or AI.
