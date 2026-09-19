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
- Next Task: Stage 7E — Lawyer Discovery & Profile Interface.

## Stage 7E Lawyer Directory Discovery UI
- Stage 7E architecture gate passed
- Parent closure SHA: fb84abe4361a96e129b3cca8eea26a1b90e888fc
- Created Stage 7E branch `stage-7e-lawyer-directory-discovery-ui`
- Implemented `/lawyers` public directory route with discovery filtering (locality, CYFSA, virtual, Ontario-wide).
- Implemented `/lawyers/:id` public profile route displaying safe, approved public information without matter access leakage.
- Added `/api/directory/search` and `/api/directory/profiles/:id` API routes bridging to the Stage 7D foundation.
- Translated Stage 7D match-reasons to user-facing readable labels without score, ranking, or win-rate metrics.
- Profile claiming explicitly deferred and omitted from the UI to prevent unverified account ownership escalation.
- Added API tests `api/lawyerDirectoryRoutes.test.ts`.
- **REMEDIATION**: Added genuine behavioral UI tests using `@testing-library/react` and `jsdom` (`src/components/LawyerDirectoryTab.test.tsx`), covering interactive behaviors, error state, and profile-not-found state.
- **REMEDIATION**: Added App routing integration test (`src/App.test.tsx`) proving Stage 7C Gap #4 (parent product integration regression test) is genuinely resolved in Stage 7E.
- **REMEDIATION**: Secured `publicWebsite` links using URL parsing to enforce `http/https`, blocking `javascript:` execution, and added `rel="noopener noreferrer"`.
- Stage 7C Gaps #1-#3 remain explicitly carried to Stage 7F.
- REGIONAL filtering behavior remained deliberately excluded from the UI/search pipeline.
- `npm run test`, `npx tsc --noEmit`, and `npm run build` completed successfully.
- Baseline `npm audit` 11 vulnerabilities (10 moderate, 1 high) unchanged; no `npm audit fix` executed.
- NO PRODUCTION CHANGES. NO MIGRATIONS. NO MERGE.
- Next Task: Stage 7E Re-closure Audit.

## Stage 7F Professional Platform Integration & Security Closure

- Stage 7F branch: `stage-7f-professional-platform-closure`
- Frozen Stage 7E parent SHA: `ba1872fabc80e8b84c0f0e1b94928c64b92bf29b`
- No production code was modified. All Stage 7F work is additive behavioral test coverage.

### Implementation Summary

Stage 7F is not a new feature stage. It closes integration, security, and testing gaps across the professional platform (Stages 7A–7E) by adding genuine behavioral coverage of all six blockers and auxiliary requirements. No production code was rewritten because the existing architecture was structurally correct on all blockers.

**1 file added:** `api/services/stage7f.test.ts` — 114 behavioral tests.

---

### B1 — Professional Status ≠ Matter Authorization

**Result: DENIED / FAIL (blocked correctly)**

- `VERIFIED_LAWYER` without active matter grant → DENIED (`getMatterOverview`, `getIntelligenceCategory`, `saveProfessionalReview`)
- `PARTICIPATING_PROFESSIONAL` without active matter grant → DENIED (same routes)
- `requireProfessionalAccess()` checks `navigator_matter_members` for `role=REVIEWER` only — lifecycle state is irrelevant.
- Removing a member row between two calls denies the second call without any re-authentication.
- Tests exercise the real production authorization path.

---

### B2 — Reviewer ID Spoofing

**Result: BLOCKED / FAIL (blocked correctly)**

- `saveProfessionalReview()` derives `reviewer_account_id` from `findAccount(firebaseUid)` — a server-side lookup from the verified Firebase UID. No client-supplied identity field (`reviewerAccountId`, `account_id`, `userId`, `user_id`, etc.) affects the result.
- Reviewer A cannot create a review as Reviewer B — the stored row is always keyed to ACC_REVIEWER_A.
- Reviewer A cannot overwrite Reviewer B's review — the upsert key is `(finding_type, finding_id, reviewer_account_id)`, so Reviewer B's row is untouched.
- No production vulnerability was found; regression coverage was added.

---

### B3 — Six Intelligence Categories

**Result: ALL SIX PASS**

For each of `EVIDENCE` (navigator_evidence_items), `CHRONOLOGY` (navigator_events), `CLAIMS` (navigator_claims), `RELATIONSHIPS` (navigator_claim_relationships), `GAPS` (navigator_evidence_gap_findings), and `LEGAL` (navigator_case_intelligence_snapshots):

- Authorized access returns data from the canonical source table (not a duplicate engine).
- Cross-matter isolation enforced: Matter B records do not appear in Matter A result.
- Unauthorized access (no REVIEWER membership) is denied.
- Professional reviews are stored in `professional_reviews`, not in the canonical table.
- The canonical source records are not modified by professional review writes.
- `getIntelligenceCategory` returns separate `items` (canonical) and `reviews` (professional annotation) arrays.

---

### Authorization Matrix

**Result: PASS — FAIL CLOSED**

| Principal | Expected | Actual |
|---|---|---|
| Anonymous (no account) | DENIED | DENIED |
| Authenticated non-professional (parent) | DENIED | DENIED |
| PUBLIC_LISTING lifecycle alone | DENIED | DENIED |
| CLAIMED_PROFILE lifecycle alone | DENIED | DENIED |
| VERIFIED_LAWYER lifecycle alone | DENIED | DENIED |
| PARTICIPATING_PROFESSIONAL lifecycle alone | DENIED | DENIED |
| PENDING grant (no member row) | DENIED | DENIED |
| EXPIRED grant (no member row) | DENIED | DENIED |
| REVOKED grant (member row removed) | DENIED | DENIED |
| ACCEPTED grant without REVIEWER membership | DENIED | DENIED |
| Active REVIEWER membership | ALLOWED | ALLOWED |
| OWNER (role ≠ REVIEWER) | DENIED | DENIED |

Authorization is enforced by `requireProfessionalAccess()` checking `navigator_matter_members` for `role=REVIEWER`. All states without an active member row fail closed.

---

### B5 — Same-Session Revocation

**Result: PASS**

- Reviewer receives legitimate access → successfully accesses workspace.
- Parent/grantor revokes access by removing the member row (canonical revocation path).
- Reviewer remains logged in — no sign-out, no token refresh, no new login.
- Next request is immediately denied.
- This proves authorization is re-evaluated server-side on every request. No bearer token grants matter access between requests.

---

### B6 — Cross-Matter Isolation

**Result: PASS — NO DATA LEAK**

Reviewer A (authorized for Matter A only) was denied access to all Matter B workspace endpoints:
- Workspace overview
- EVIDENCE, CHRONOLOGY, CLAIMS, RELATIONSHIPS, GAPS, LEGAL INTELLIGENCE
- Professional review create
- Professional review update

Client-supplied Matter B identifiers (passed directly to the service layer, as a malicious client would) do not override authorization.

---

### Multi-Reviewer Isolation

**Result: PASS**

- Reviewer A and B can both legitimately access the same matter.
- A's review and B's review are separate, keyed by `reviewer_account_id`.
- A cannot overwrite B's review; B cannot overwrite A's review.
- Each reviewer may update their own review (upsert by `(finding_type, finding_id, reviewer_account_id)`).
- Canonical machine findings remain unchanged after both reviewers submit.

---

### Machine/Human Separation

**Result: PASS**

`saveProfessionalReview()` writes only to `professional_reviews`. None of the six canonical source tables (`navigator_evidence_items`, `navigator_events`, `navigator_claims`, `navigator_claim_relationships`, `navigator_evidence_gap_findings`, `navigator_case_intelligence_snapshots`) are modified.

---

### Public/Private Boundary

**Result: PASS**

`getPublicProfile()` and `searchDirectory()` exclude from their DTOs:
- `accountId` / `account_id`
- `firebaseUid` / `firebase_uid`
- `verificationNotes` / `verification_notes`
- Matter memberships and grants
- Grant tokens/digests
- Professional reviews and review notes
- Matter IDs, matter names, matter intelligence
- Parent/client identity

---

### URL Security

**Result: PASS**

`isSafeWebsiteUrl()` in `src/utils/urlValidator.ts` correctly:
- Allows `http:` and `https:` only
- Rejects `javascript:`, `JAVASCRIPT:` (mixed case), `data:`, `vbscript:`, `file:`, `blob:`, `about:`, relative URLs, protocol-relative URLs, malformed URLs, null, undefined, empty string

Production code was not modified.

---

### Profile Claiming

**Result: DISABLED (correctly fail-closed)**

`claimProfile()` unconditionally throws `LifecycleError(403, 'FORBIDDEN', 'Profile claiming is deferred until a verified claim workflow is implemented.')` for any input.

---

### Directory Neutrality

**Result: NONE (no ranking or AI endorsement)**

Search results contain no `score`, `winRate`, `successRate`, `aiEndorsement`, `starRating`, or similar fields. `matchReasons` contains only neutral factual labels (`OFFICE_NEARBY`, `SERVES_AREA`, `ONTARIO_WIDE`, `VIRTUAL`, `CHILD_PROTECTION_PRACTICE`, `VERIFIED_LAWYER`, `PARTICIPATING_PROFESSIONAL`).

---

### Parent Product Regression

**Result: PASS**

- Parent workflow (document analyzer, extract evidence, case timeline, RAG) remains unaffected.
- Directory is optional — `searchDirectory({})` returns an empty array when no profiles exist; no error.
- Lawyer selection is not required; `requireProfessionalAccess()` is a per-route opt-in guard.
- Stage 7C App routing integration test confirms parent paths remain available alongside professional platform.

---

### Stage 7 API Surface Inventory

| Route | Method | Classification | Auth Implementation |
|---|---|---|---|
| `POST /api/directory/search` | POST | PUBLIC | No auth required; public DTO only |
| `GET /api/directory/profiles/:id` | GET | PUBLIC | No auth required; public DTO only |
| `POST /api/directory/profiles/:id/claim` | POST | AUTHENTICATED | `verifyFirebaseToken` → fails closed (FORBIDDEN) |
| `GET /api/professional-workspace/matters` | GET | MATTER-AUTHORIZED | `verifyFirebaseToken` + `findAccount` + `role=REVIEWER` check |
| `GET /api/professional-workspace/matters/:id/overview` | GET | MATTER-AUTHORIZED | `verifyFirebaseToken` + `findAccount` + `requireProfessionalAccess` |
| `GET /api/professional-workspace/matters/:id/intelligence/:cat` | GET | MATTER-AUTHORIZED | `verifyFirebaseToken` + `findAccount` + `requireProfessionalAccess` |
| `POST /api/professional-workspace/matters/:id/review` | POST | MATTER-AUTHORIZED | `verifyFirebaseToken` + `findAccount` + `requireProfessionalAccess`; reviewer_account_id always server-derived |
| `PATCH /api/matters/:id/intelligence/review` | PATCH | AUTHENTICATED | `verifyFirebaseToken`; identity from token only |
| `GET /api/health` | GET | PUBLIC | No auth |
| `GET /api/access-pricing` | GET | PUBLIC | No auth |
| `POST /api/request-access` | POST | PUBLIC | No auth; creates payment record |
| `POST /api/activate-code` | POST | AUTHENTICATED | `verifyFirebaseToken` required |
| `POST /api/cases` | POST | AUTHENTICATED | `verifyFirebaseToken` + paid session |
| `POST /api/analyze` | POST | AUTHENTICATED | `verifyFirebaseToken` + paid session |
| `POST /api/extract-evidence` | POST | AUTHENTICATED | `verifyFirebaseToken` + paid session |
| `POST /api/extract-text` | POST | AUTHENTICATED | `verifyFirebaseToken` + paid session |
| `POST /api/case-timeline` | POST | AUTHENTICATED | `verifyFirebaseToken` + paid session |
| `POST /api/rag-query` | POST | AUTHENTICATED | `verifyFirebaseToken` + paid session |
| `POST /api/deep-scan` | POST | AUTHENTICATED | `verifyFirebaseToken` + paid session |
| `POST /api/transcribe` | POST | AUTHENTICATED | `verifyFirebaseToken` + paid session |
| `POST /api/transcribe-audio` | POST | AUTHENTICATED | `verifyFirebaseToken` + paid session |
| `POST /api/lawyer-intake` | POST | PUBLIC (informational) | No auth |
| `POST /api/admin/approve-payment` | POST | SERVER/INTERNAL | `x-admin-secret` header |
| `POST /api/admin/revoke-session` | POST | SERVER/INTERNAL | `x-admin-secret` header |
| `POST /api/admin/revoke-sessions-for-uid` | POST | SERVER/INTERNAL | `x-admin-secret` header |
| `GET /api/admin/gmail-auth-url` | GET | SERVER/INTERNAL | `x-admin-secret` header |
| `GET /api/admin/gmail-callback` | GET | SERVER/INTERNAL | `x-admin-secret` header |
| `GET /api/admin/check-payments` | GET | SERVER/INTERNAL | `x-admin-secret` header |
| Lifecycle routes (`/api/account`, `/api/clients`, `/api/matters`, etc.) | VARIOUS | AUTHENTICATED | `verifyFirebaseToken` |

No route was found to be weaker than its intended classification. The professional workspace routes correctly enforce MATTER-AUTHORIZED access.

---

### Stage 7 Migration Dependency Order

The following migrations are in `supabase/migrations_pending_approval/`. They are NOT executed. The Stage 7 subset listed in dependency order:

1. **`create_professional_profiles.sql`** — Stage 7A: professional_profiles table, lifecycle states, RLS zero-policy. Requires accounts table.

2. **`create_navigator_matter_access_grants.sql`** — Stage 7B: navigator_matter_access_grants table, REVIEWER role extension to navigator_matter_members, `accept_matter_grant` atomic RPC. Requires accounts, navigator_matters, navigator_matter_members.

3. **`create_professional_reviews.sql`** — Stage 7C: professional_reviews table with `(finding_type, finding_id, reviewer_account_id)` uniqueness constraint. Requires accounts, navigator_matters.

4. **`create_lawyer_directory_foundation.sql`** — Stage 7D: professional_office_locations, professional_service_areas, professional_practice_areas, professional_profile_sources child tables. Requires professional_profiles.

5. Stage 7E: No migration (UI/frontend only).

6. Stage 7F: No migration (behavioral test coverage only).

---

### Stage 7 RLS / Database Review

Reviewed all four Stage 7 migrations:

- `professional_profiles`: RLS enabled, zero policies; only `service_role` has DML. ✓
- `navigator_matter_access_grants`: RLS enabled, zero policies; only `service_role` has DML; `accept_matter_grant` RPC is `security definer` and explicitly revokes `public`/`anon`/`authenticated`. ✓
- `professional_reviews`: RLS enabled, zero policies; only `service_role` has DML; uniqueness constraint enforces multi-reviewer separation. ✓
- `create_lawyer_directory_foundation.sql`: Extends professional_profiles with normalized child tables; RLS and grant structure consistent with pattern. ✓
- Multi-reviewer uniqueness constraint: `(finding_type, finding_id, reviewer_account_id)` in professional_reviews. ✓
- Foreign keys preserve ownership: all reference `accounts(id)` and `navigator_matters(id)` with appropriate ON DELETE semantics. ✓
- No direct-table authorization bypass introduced. ✓

---

### Verification Results

**TypeScript typecheck:** PASS (0 errors)

**Stage 7F targeted tests:** 114 passed / 0 failed

**Stage 7E:** 5 passed

**Stage 7D:** 17 passed

**Stage 7C:** 17 passed (professionalWorkspace.test.ts: 9, caseIntelligenceReview.test.ts: 8)

**Stage 7B:** 12 passed

**Stage 7A:** 9 passed

**Auth/access/security:** 39 passed (access.test.ts: 29, humanReviewAccess.test.ts: 3, firebaseAdmin.test.ts: 7)

**Stage 5 M2:** 181 passed (6 files)

**Stage 6:** 331 passed (6 files)

**Stage 5↔6 integration:** 39 passed

**Full test suite:** 37 test files, **1155 tests passed / 0 failed**

**Build:** PASS (vite + esbuild, exit 0)

**npm audit:** 11 total (10 moderate, 1 high) — matches known baseline exactly. No npm audit fix executed.

**Migrations executed:** NONE

**Production changes:** NONE

**Merged:** NO

---

### Important Note

Stage 7 was formally closed by independent audit.

### Stage 8A Implementation

Branch: stage-8a-litigation-work-product-foundation
Parent SHA: a8f01041db41b1bba40a67acb7d4a6c888248339

Stage 8A added on-demand generation of deterministic CASE_BRIEF work product. Persistence was avoided because deterministic on-demand assembly is sufficient for the current requirements, simplifying architecture and avoiding unnecessary data duplication. A new endpoint `/api/professional-workspace/matters/:matterId/work-product/case-brief` is exposed under MATTER-AUTHORIZED scope.

Reviewer-private professional annotations have been successfully isolated from canonical machine intelligence, establishing machine/human separation.

Provenance behavior and reproducibility behavior have been preserved.

Tests passed: 1162 in full suite.
Build passed.
NPM Audit: 11 vulnerabilities (10 moderate, 1 high) (matches baseline).
Production unchanged.
Migrations unexecuted.

### Stage 8B Implementation

Branch: stage-8b-professional-case-brief-export
Parent SHA: dc464ea055d22feaef2350101389484ff5c4c656

Stage 8B added professional rendering and export capability for the CASE_BRIEF work product.
A new `CaseBriefViewer` React component replaces the raw JSON view in the Professional Workspace, rendering 11 formal sections: Overview, People, Chronology, Evidence, Claims, Relationships, Inconsistencies, Gaps, Legal Relevance, Professional Review, and Source Index.

The rendering enforces reviewer privacy: Reviewer A sees only their own notes and review states, preventing cross-reviewer data leaks. Classifications, uncertain chronologies, exact quotes, and provenance links are preserved. A browser-native print stylesheet enables clean PDF export without new backend dependencies or extra database queries. The UI tests use DOM matching to ensure structural correctness and reviewer isolation.

Tests passed: 1177 in full suite.
Build passed.
NPM Audit: 11 vulnerabilities (10 moderate, 1 high) (matches baseline).
Production unchanged.
Migrations unexecuted.

### Stage 8C Implementation

Branch: stage-8c-work-product-finalization-versioning
Parent SHA: c34533a42c7cd367f208b67a56b2254d9695efba

Stage 8C adds professional review lifecycle finalization, immutable snapshots, and version history.
A new persistence table professional_work_product_versions has been defined via migration (create_professional_work_product_versions.sql) to store JSONB snapshots of finalized work products securely. The snapshots are strictly scoped per reviewer (eviewer_account_id constraint) and enforce version integrity natively.

Endpoints were added to finalize the brief, retrieve all versions, and fetch a specific version. Server-side identity resolution guarantees that reviewers cannot see or modify other reviewers' versions. The UI was updated with a "Finalize Case Brief" feature and a "VERSIONS" tab for retrieving and viewing historical snapshots identically to the current view but explicitly marked as finalized.

Tests passed: 1186 in full suite.
Build passed.
NPM Audit: 11 vulnerabilities (10 moderate, 1 high) (matches baseline).
Production unchanged.
Migrations created but unexecuted.

### Stage 8C Remediation

Blocked SHA: c058440293bef33f1436208c95589dbb8b55451a
Audit Blocker: TypeScript TS2339 errors during tsc --noEmit.
Remediation performed: Resolved 'versionNumber' by creating a separated finalizedSnapshot object. Resolved 'reviewer_account_id' by adding it to the Supabase select query.
Typecheck result: 0 errors.
Test result: 1186 tests passed.
Migration still unexecuted.
Production unchanged.
