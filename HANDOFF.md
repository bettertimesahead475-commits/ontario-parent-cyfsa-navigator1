# CYFSA Navigator — Engineering Handoff

## 1. Project

Product: CYFSA Navigator (historically ParentShield / Ontario Parent Assist).
Repository: `C:\Users\User\Documents\Codex\cyfsa-pr21-split`.
Active branch: `phase-3-account-client-matter-lifecycle`.
Current milestone: Stage 4 closeout. Pre-closeout HEAD: `22384a833cf7889493a0835c2b68af9726e1caf1`.
Resolve the milestone commit using `git log -1 --format=%H -- STAGE_4_CLOSEOUT.md`; verify actual HEAD at every handoff rather than relying on a self-referential hash in this file.

React/Vite frontend; Express backend in `api/_server.ts` with lifecycle/document route modules; Firebase Admin verifies identity; Supabase server RPCs enforce ownership and transactional persistence. Gemini performs per-page OCR; Claude proposes evidence from stored pages. Legacy analyzer, timeline and RAG remain separate existing features. Root `server.ts` is the local server entrypoint.

## 2. Current Milestone

**STAGE 4 — COMPLETE WITH RELEASE CONDITIONS**

The page-anchored document/evidence foundation is implemented. Its migration passed read-only audits and was installed only on the disposable validation project. Live isolated PostgreSQL validation returned PASS WITH CONDITIONS. No production migration has been authorized. Stage 5 may begin under a separate scoped task; it is not implemented by this closeout.

## 3. Validated Stage 4 Capabilities

Stable document identity and content-hashed versions; structurally split physical PDF pages; preserved page text and checksums; extraction/evidence runs; page-anchored evidence; deterministic exact and normalized-whitespace quotes with Unicode code-point offsets; constrained run attribution; explicit classifications and review states; completed-source immutability; transactional authorization; deduplication and extraction retries; independent-session concurrency protection; atomic rollback; restricted RLS/ACL model.

See `PAGE_ANCHORED_FOUNDATION.md` for contracts and `STAGE_4_CLOSEOUT.md` for validation provenance. Review-state changes were validated at the database layer; a human review API/workspace is the next feature, not an existing Stage 4 capability.

## 4. Important Invariants

- Allegations must never become facts automatically; AI FACT proposals are downgraded.
- Verified evidence retains document/version/page/quote/run attribution. Containment is not proof of truth.
- Matter/document/version/page relationships remain constrained and ownership checked.
- Evidence provenance remains immutable after completion; supported review-state changes cannot change source coordinates.
- Evidence INSERT requires a valid active evidence run for the exact source hierarchy and page.
- Legal conclusions remain reviewable, never definitive automated findings.
- Uploaded documents are untrusted content, not instructions.
- exactQuote verification remains deterministic: exact first, declared whitespace normalization second; no fuzzy punctuation repair.
- Authorization and sensitive retrieval remain inside the same protected transaction.
- Unsupported or ambiguous quotations require source review and null offsets.

## 5. Database State

Disposable validation project: `unfepurousallhocgehl`. **This is NOT Production.**
The page-evidence migration was installed here for validation only. It remains at `supabase/migrations_pending_approval/create_navigator_page_evidence_foundation.sql`; do not replay it there or treat the directory name as proof it has never run.
Production status and authorization are separate. Production execution requires explicit approval.
Excluded historical projects: `tblunklkpzvcfjfknaqw`, `tayiwcwyfaesplqxeeau`, `lrygsrwjjmonhzujckoq`, `nvpfbshqnnhqakvjugkh`. Do not touch them.
Credentials are not handoff material. Never expose environment files or certificate contents.

## 6. Stage 4 Validation Result

**PASS WITH CONDITIONS** — isolated validation on 2026-09-13.
Live concurrency, rollback, RLS/ACL, evidence-run attribution, quote enforcement, source provenance immutability and real Supabase client contracts passed. Actual five-second lock timeout: **5032 ms**, SQLSTATE **55P03**.
Migration installed once as a single transaction with CA and hostname verification. No blocking defect was demonstrated. This closeout does not repeat database operations.

## 7. Remaining Release Conditions

**RELEASE CONDITIONS — NOT STAGE 5 BLOCKERS:**
Dedicated Firebase-authenticated HTTP integration; dependency advisories; separately reviewed production migration/deployment readiness; volume/retention controls and production hardening.
Historical security documents also identify session-error handling, code-claim/session-creation recovery, legacy-token rollout, and CORS/rate-limit verification without test bypass. Reassess these against current code before release; Stage 4 validation does not assert that historical issues are resolved. See `PHASE_1_SECURITY_VERIFICATION.md` and `PHASE_1_FINAL_SECURITY_GATE.md`.

## 8. Stage 5 Objective

**MATTER-SCOPED EVIDENCE REVIEW AND CASE INTELLIGENCE**
Planned capabilities: evidence review workspace; matter-wide chronology; contradiction/inconsistency detection; corroboration linking; allegation evolution tracking; evidence-gap detection; unanswered-question generation; case-wide summary; direct source jump-back to document/page/quote; review-state propagation.

*Update:* Stage 5 M2-A (Case Intelligence Foundation), M2-B (Deterministic Chronology), and M2-C (Claims, Attribution, Evolution) have been implemented as pending migrations. They establish the deterministic database structures and pure functions for Entities, Events, Dates, Claims, Attributions, Evolution, Provenance, and Review tracking, but do not deploy them or build the AI pipelines yet.

## 9. Future Roadmap

| Stage | Objective |
|---|---|
| 5 | Matter Intelligence (M2-A, M2-B, M2-C, M2-D Foundations complete, M2-E pending) |
| 6 | CYFSA Legal Intelligence and Authority Mapping |
| 7 | Professional Lawyer Review Workspace |
| 8 | Litigation Work Product |
| 9 | Advanced Case-Wide Retrieval / RAG |
| 10 | Firm Collaboration / Permissions / Audit |
| 11 | Benchmarking / QA / Release Hardening |

## 10. Current Technical Debt / Known Limitations

Firebase HTTP integration is not fully validated. Dependency advisories remain. Account-wide serialization favors correctness over throughput. Evidence aggregation is unpaginated. Stale evidence-run maintenance is outstanding. OCR metadata records configured fallback models rather than observed provider revisions. Duplicate evidence analysis requests can create separate runs. Completed immutable disposable fixtures remain intentionally retained (inventory in the closeout). No full contradiction engine, persisted matter-wide chronology engine or legal mapper exists yet (only foundational tables). Existing legacy timeline/RAG features do not constitute those future engines.

Pages over 30,000 characters cannot enter evidence extraction until bounded chunking is designed. Binary retention, deletion, queue execution, OCR cost accounting and large-volume behavior need review. The build retains its large-chunk warning.

## 11. Agent Operating Rules

Any AI coding agent must:
1. Read HANDOFF.md before modifying the repository.
2. Verify repository, branch and HEAD.
3. Inspect git status before work.
4. Never assume Production authorization.
5. Never execute pending migrations unless explicitly authorized.
6. Never expose secrets.
7. Preserve existing security and evidence invariants.
8. Run tests/typecheck/build before declaring completion.
9. Update HANDOFF.md if architecture, milestone state or next task changes.
10. End every work session with an exact summary of files changed, tests, branch, HEAD, working-tree state, database/deployment actions and next recommended task.

## Stage 5↔6 Integration Closure

- Stage 5 M2-E formally closed
- frozen M2-E SHA: 5543f05a56f82c1527df23c9206913616995b36c
- Stage 5↔6 integration gates A-K passed
- integration adapter verified
- dependency blocker was local incomplete node_modules only
- npm ci restored pg/@types/pg
- no integration source remediation was required
- typecheck passed after dependency restoration
- build passed
- relevant Stage 5/6 tests passed
- npm audit remains 11 total / 10 moderate / 1 high unchanged baseline
- no production changes
- no migrations executed
- Stage 5↔6 integration formally closed

## 12. Next Task

NEXT STAGE: **Stage 7**.
NEXT STAGE MICRO-GATE: **Stage 7B**.
NEXT TASK: **Stage 7B Parent-Authorized Matter Access Foundation**.
Stage 5↔6 integration is formally closed.

## Cross-Agent Handoff Protocol

Codex → Claude Code: commit when authorized or intentionally preserve current state; Claude reads HANDOFF.md first, inspects status/branch/HEAD, receives one scoped task, updates this handoff when milestone/architecture changes, and reports changed files, tests and final Git state.
Claude Code → Codex: use the same process. Prefer independent read-only review before the next correction round. Only one agent edits the shared checkout at a time.
Neither agent should rely on the other's conversational memory. The repository and HANDOFF.md are the source of truth. A handoff is not authorization to push, deploy or mutate a database.

## Historical handoff provenance

The previous security-split/historical audit handoff is preserved in Git at `22384a833cf7889493a0835c2b68af9726e1caf1:HANDOFF.md`. Its dated claims (including absent domain routes and no automated tests) are historical, not current status. Existing Phase 1/2 audit files remain unchanged.

## Stage 5 M2-D Blocker Remediation
- **event-identity fingerprint dependency**: Enforced deterministic fingerprints to include \EventDependency\, preventing uncertain claims from triggering definitive contradiction fingerprints.
- **structured actor comparison**: Removed hardcoded actor logic in favor of \StructuredActor\ matching.
- **structured location comparison**: Removed hardcoded location logic in favor of \StructuredLocation\ matching.
- **role-aware actor semantics**: Actors are now evaluated by their specific semantic role before determining inconsistency.
- **multi-dimension comparison**: Deterministically evaluates all dimensions simultaneously (e.g., extracting both ACTOR and LOCATION dimensions if both exist).
- **J/K/L/M/N/T behavioral coverage**: Filled missing stubs with strict verification that M2-D doesn't generate fact mutations, truth judgements, or lie labels.
- **retraction semantics**: Integrated \evolutionContext\ to explicitly track retraction origin even when mapped to contradictions.



## Stage 5 M2-E Blocker Remediation
- **Test Integrity**: Replaced all 36 A-AJ placeholders with real behavioral assertions ensuring proper classification and matter isolation.
- **Matter Isolation**: Implemented strict matter isolation failing closed on cross-matter inputs for generateEvidenceGaps and generateSnapshot. Added matter_id to database schema constraints.
- **Source Gap & Independence**: Replaced hardcoded checks with graph-aware source lineage independence enforcement (SAME_ORIGIN, INDEPENDENT).
- **Materiality & Freshness**: Shifted materiality from static constants to dependency-count evaluation. Introduced semantic-fingerprint hashing for precise freshness detection.
- **Migration & RLS**: Created create_navigator_m2e_intelligence_foundation.sql matching standard service_role privileges and table definitions. Added structural migration tests.

## Stage 7A Professional Identity & Profile Foundation
- Stage 7 architecture gate passed
- Parent closure SHA: d0fcb46a64512bbad3aea7b8b4fd63f1685bbdb2
- Created professional_profiles schema linking securely to the existing accounts model.
- Designed distinct verification states (identity, licence, practice, participation) rather than a single boolean.
- Implemented pi/services/professionalProfiles.ts establishing the service contract and strictly enforcing self-escalation protection and authorization.
- Added comprehensive unit tests in professionalProfiles.test.ts verifying cross-account isolation, verification immutability from client updates, and non-escalation of matter access.
- MIGRATION NOT EXECUTED.
- PRODUCTION NOT CHANGED.
- Remaining Stage 7B dependency: The architecture currently supports profile creation and distinct verification lifecycle states, but a VERIFIED_LAWYER currently possesses NO matter access. Stage 7B must implement explicit parent-authorized grants (
avigator_matter_access_grants) and map them to 
avigator_matter_members.

## Stage 7B Parent-Authorized Matter Access
- Stage 7B architecture gate passed
- Parent closure SHA: a217f1a0d34dc563e2f9adc03626b5b6cda6614a
- Created navigator_matter_access_grants schema to handle cryptographically secure single-use invitation tokens.
- Added REVIEWER role to navigator_matter_members constraints via an additive migration.
- Tokens are generated server-side and hashed before storage. Raw tokens are never stored.
- Acceptance runs in an atomic RPC to prevent split-brain state between grant status and member role.
- Revocation explicitly tombstones the grant and removes the REVIEWER role.
- Strict cross-matter isolation and explicit constraints prevent unauthorized escalation.
- Added 12 rigorous behavioral tests proving that verifying a professional profile does not grant matter access, non-owners cannot invite, and expired/used tokens fail.
- MIGRATION NOT EXECUTED.
- PRODUCTION NOT CHANGED.
- Remaining Stage 7C dependency: With the REVIEWER role and invitation cycle complete, the frontend can now build the Professional Workspace relying on a secure, audited access foundation.

## Stage 7C Professional Workspace & Review
- Stage 7C architecture gate passed
- Parent closure SHA: ad89c48ecc0818e3d3b5fe5553b44b17f9d349f0
- Created professional_reviews schema to store professional review state completely separate from machine findings.
- Implemented api/services/professionalWorkspace.ts and api/professionalWorkspaceRoutes.ts to serve matters to authorized REVIEWERs.
- Created src/components/ProfessionalWorkspace.tsx with specialized overview dashboard and individual category review interfaces.
- Added comprehensive test suite api/services/professionalWorkspace.test.ts verifying cross-matter isolation, REVIEWER role access, empty state handling, and independent multi-reviewer persistence.
- Typecheck, full test suite (1010 tests), and build passed successfully.
- Baseline npm audit 11 vulnerabilities (10 moderate, 1 high) unchanged; no npm audit fix executed.
- MIGRATION NOT EXECUTED.
- PRODUCTION NOT CHANGED.
- Next Task: Stage 8 (Litigation Work Product) or Stage 7D (Frontend Integration/Styling refinements if required).

## Stage 7D Ontario Lawyer Directory Data Foundation
- Stage 7D architecture gate passed
- Parent closure SHA: b55e7dbf6e6dc1f4b4311507ff5a331c2c57c69b
- Created comprehensive lawyer directory schema (create_lawyer_directory_foundation.sql) with normalized child tables: professional_office_locations, professional_service_areas, professional_practice_areas, and professional_profile_sources.
- Successfully reused canonical professional_profiles identity without creating parallel truth models.
- Implemented api/services/lawyerDirectory.ts providing deterministic backend search semantics supporting locality matching, Ontario-wide fallback, virtual office capabilities, and CYFSA practice filtering. REGIONAL service areas are represented by the Stage 7D schema, but REGIONAL search/matching is not implemented in Stage 7D and is explicitly deferred to Stage 7E.
- Guaranteed a safe public directory projection explicitly excluding internal UUIDs, Firebase identities, private emails, review data, and security metadata.
- Implemented comprehensive match-reason deterministic labeling (e.g. OFFICE_NEARBY, ONTARIO_WIDE, CHILD_PROTECTION_PRACTICE) devoid of quality or win-rate ranking.
- Included robust tests ensuring an unclaimed PUBLIC_LISTING cannot authenticate or gain capabilities, and profile ownership guarantees Stage 7B matter access separation natively. Profile ownership claiming is deferred until a verified claim workflow is implemented. Stage 7D does not permit an authenticated lawyer-role account to claim an unclaimed public listing. The Stage 7D claimProfile path fails closed and performs no ownership mutation.
- No new AI endpoints, scraping, or real lawyer data was introduced. 
- MIGRATION NOT EXECUTED.
- PRODUCTION NOT CHANGED.
- Next Task: Stage 7E � Lawyer Discovery & Profile Interface.

