# CYFSA Navigator â€” Engineering Handoff

## Current authoritative status — 2026-09-21 (prompt 62518)

**Stage 9A — FORMALLY CLOSED/FROZEN. Stage 9B — FORMALLY CLOSED/FROZEN. Stage 9C — FORMALLY CLOSED/FROZEN.** Frozen code SHA: `836f21469dd6a3d2248517c1fd0acf44cd9d545a`, on the published `remediate/stage-9abc-trust-boundaries` branch. Do not reopen these milestones absent a concrete regression.

The user supplied the subsequent independent closure result: Stage 9 91/91 pass; full one-worker suite 1,281 passed / 0 failed / 0 skipped; TypeScript and production build pass; npm audit baseline 11 (10 moderate, 1 high). All seven original trust-boundary regressions remain intact and pass; the 13 additional tests were independently reviewed as meaningful; the stored-text/replayed-digest repair remains intact. This documentation task records that evidence, not a new audit or test run. Older BLOCKED/awaiting-audit statements below are historical and superseded by this notice.

**LIVE POSTGRES/RLS/FK/CONCURRENCY VALIDATION: DEFERRED TO RELEASE GATE.** Actual foreign keys, RLS, database constraints, concurrent/revocation races and other DB integration behavior represented by mocked Supabase tests remain unvalidated. The 1,281 passing tests do not prove live-database behavior. This is release-gate work, not a Stage 9A–9C code-closure blocker. Do not access production to resolve it here.

**Next-roadmap decision: C. ROADMAP AMBIGUOUS — DOCUMENTATION DECISION REQUIRED.** [STAGE_9_ROADMAP_DECISION.md](STAGE_9_ROADMAP_DECISION.md) records the evidence, capability classifications, concrete scope choices and next documentation-decision contract. Stage 9's broad objective is Advanced Case-Wide Retrieval / RAG, but no authoritative completion boundary or 9D scope exists. The closed services are not wired to a persisted case-wide discovery workflow or the professional research/work-product surfaces. That observation does not by itself make any particular missing feature a required 9D milestone.

Next action: decide retrieval audience, saved-candidate lookup versus new-authority discovery, required output/integration surface, and overall Stage 9 completion boundary; then adopt an implementation-ready next-milestone contract. No 9D or Stage 10 implementation is authorized or started. Stage 10 remains Firm Collaboration / Permissions / Audit; Stage 11 remains Benchmarking / QA / Release Hardening. Do not move those programmes into Stage 9. Documentation branch: `docs/stage9-roadmap-decision`; code baseline remains frozen. No production, database, migration, secret/environment, deployment or main-merge action was performed.

The sections below preserve prior chronological project/handoff records; their old active-branch and milestone labels are not the current status.

## 1. Project

Product: CYFSA Navigator (historically ParentShield / Ontario Parent Assist).
Repository: `C:\Users\User\Documents\Codex\cyfsa-pr21-split`.
Active branch: `phase-3-account-client-matter-lifecycle`.
Current milestone: Stage 4 closeout. Pre-closeout HEAD: `22384a833cf7889493a0835c2b68af9726e1caf1`.
Resolve the milestone commit using `git log -1 --format=%H -- STAGE_4_CLOSEOUT.md`; verify actual HEAD at every handoff rather than relying on a self-referential hash in this file.

React/Vite frontend; Express backend in `api/_server.ts` with lifecycle/document route modules; Firebase Admin verifies identity; Supabase server RPCs enforce ownership and transactional persistence. Gemini performs per-page OCR; Claude proposes evidence from stored pages. Legacy analyzer, timeline and RAG remain separate existing features. Root `server.ts` is the local server entrypoint.

## 2. Current Milestone

**STAGE 4 â€” COMPLETE WITH RELEASE CONDITIONS**

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

**PASS WITH CONDITIONS** â€” isolated validation on 2026-09-13.
Live concurrency, rollback, RLS/ACL, evidence-run attribution, quote enforcement, source provenance immutability and real Supabase client contracts passed. Actual five-second lock timeout: **5032 ms**, SQLSTATE **55P03**.
Migration installed once as a single transaction with CA and hostname verification. No blocking defect was demonstrated. This closeout does not repeat database operations.

## 7. Remaining Release Conditions

**RELEASE CONDITIONS â€” NOT STAGE 5 BLOCKERS:**
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

## Stage 5â†”6 Integration Closure

- Stage 5 M2-E formally closed
- frozen M2-E SHA: 5543f05a56f82c1527df23c9206913616995b36c
- Stage 5â†”6 integration gates A-K passed
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
- Stage 5â†”6 integration formally closed

## 12. Next Task

NEXT STAGE: **Stage 7**.
NEXT STAGE MICRO-GATE: **Stage 7B**.
NEXT TASK: **Stage 7B Parent-Authorized Matter Access Foundation**.
Stage 5â†”6 integration is formally closed.

## Cross-Agent Handoff Protocol

Codex â†’ Claude Code: commit when authorized or intentionally preserve current state; Claude reads HANDOFF.md first, inspects status/branch/HEAD, receives one scoped task, updates this handoff when milestone/architecture changes, and reports changed files, tests and final Git state.
Claude Code â†’ Codex: use the same process. Prefer independent read-only review before the next correction round. Only one agent edits the shared checkout at a time.
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
- Next Task: Stage 7E â€” Lawyer Discovery & Profile Interface.

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

Stage 7F is not a new feature stage. It closes integration, security, and testing gaps across the professional platform (Stages 7Aâ€“7E) by adding genuine behavioral coverage of all six blockers and auxiliary requirements. No production code was rewritten because the existing architecture was structurally correct on all blockers.

**1 file added:** `api/services/stage7f.test.ts` â€” 114 behavioral tests.

---

### B1 â€” Professional Status â‰  Matter Authorization

**Result: DENIED / FAIL (blocked correctly)**

- `VERIFIED_LAWYER` without active matter grant â†’ DENIED (`getMatterOverview`, `getIntelligenceCategory`, `saveProfessionalReview`)
- `PARTICIPATING_PROFESSIONAL` without active matter grant â†’ DENIED (same routes)
- `requireProfessionalAccess()` checks `navigator_matter_members` for `role=REVIEWER` only â€” lifecycle state is irrelevant.
- Removing a member row between two calls denies the second call without any re-authentication.
- Tests exercise the real production authorization path.

---

### B2 â€” Reviewer ID Spoofing

**Result: BLOCKED / FAIL (blocked correctly)**

- `saveProfessionalReview()` derives `reviewer_account_id` from `findAccount(firebaseUid)` â€” a server-side lookup from the verified Firebase UID. No client-supplied identity field (`reviewerAccountId`, `account_id`, `userId`, `user_id`, etc.) affects the result.
- Reviewer A cannot create a review as Reviewer B â€” the stored row is always keyed to ACC_REVIEWER_A.
- Reviewer A cannot overwrite Reviewer B's review â€” the upsert key is `(finding_type, finding_id, reviewer_account_id)`, so Reviewer B's row is untouched.
- No production vulnerability was found; regression coverage was added.

---

### B3 â€” Six Intelligence Categories

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

**Result: PASS â€” FAIL CLOSED**

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
| OWNER (role â‰  REVIEWER) | DENIED | DENIED |

Authorization is enforced by `requireProfessionalAccess()` checking `navigator_matter_members` for `role=REVIEWER`. All states without an active member row fail closed.

---

### B5 â€” Same-Session Revocation

**Result: PASS**

- Reviewer receives legitimate access â†’ successfully accesses workspace.
- Parent/grantor revokes access by removing the member row (canonical revocation path).
- Reviewer remains logged in â€” no sign-out, no token refresh, no new login.
- Next request is immediately denied.
- This proves authorization is re-evaluated server-side on every request. No bearer token grants matter access between requests.

---

### B6 â€” Cross-Matter Isolation

**Result: PASS â€” NO DATA LEAK**

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
- Directory is optional â€” `searchDirectory({})` returns an empty array when no profiles exist; no error.
- Lawyer selection is not required; `requireProfessionalAccess()` is a per-route opt-in guard.
- Stage 7C App routing integration test confirms parent paths remain available alongside professional platform.

---

### Stage 7 API Surface Inventory

| Route | Method | Classification | Auth Implementation |
|---|---|---|---|
| `POST /api/directory/search` | POST | PUBLIC | No auth required; public DTO only |
| `GET /api/directory/profiles/:id` | GET | PUBLIC | No auth required; public DTO only |
| `POST /api/directory/profiles/:id/claim` | POST | AUTHENTICATED | `verifyFirebaseToken` â†’ fails closed (FORBIDDEN) |
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

1. **`create_professional_profiles.sql`** â€” Stage 7A: professional_profiles table, lifecycle states, RLS zero-policy. Requires accounts table.

2. **`create_navigator_matter_access_grants.sql`** â€” Stage 7B: navigator_matter_access_grants table, REVIEWER role extension to navigator_matter_members, `accept_matter_grant` atomic RPC. Requires accounts, navigator_matters, navigator_matter_members.

3. **`create_professional_reviews.sql`** â€” Stage 7C: professional_reviews table with `(finding_type, finding_id, reviewer_account_id)` uniqueness constraint. Requires accounts, navigator_matters.

4. **`create_lawyer_directory_foundation.sql`** â€” Stage 7D: professional_office_locations, professional_service_areas, professional_practice_areas, professional_profile_sources child tables. Requires professional_profiles.

5. Stage 7E: No migration (UI/frontend only).

6. Stage 7F: No migration (behavioral test coverage only).

---

### Stage 7 RLS / Database Review

Reviewed all four Stage 7 migrations:

- `professional_profiles`: RLS enabled, zero policies; only `service_role` has DML. âœ“
- `navigator_matter_access_grants`: RLS enabled, zero policies; only `service_role` has DML; `accept_matter_grant` RPC is `security definer` and explicitly revokes `public`/`anon`/`authenticated`. âœ“
- `professional_reviews`: RLS enabled, zero policies; only `service_role` has DML; uniqueness constraint enforces multi-reviewer separation. âœ“
- `create_lawyer_directory_foundation.sql`: Extends professional_profiles with normalized child tables; RLS and grant structure consistent with pattern. âœ“
- Multi-reviewer uniqueness constraint: `(finding_type, finding_id, reviewer_account_id)` in professional_reviews. âœ“
- Foreign keys preserve ownership: all reference `accounts(id)` and `navigator_matters(id)` with appropriate ON DELETE semantics. âœ“
- No direct-table authorization bypass introduced. âœ“

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

**Stage 5â†”6 integration:** 39 passed

**Full test suite:** 37 test files, **1155 tests passed / 0 failed**

**Build:** PASS (vite + esbuild, exit 0)

**npm audit:** 11 total (10 moderate, 1 high) â€” matches known baseline exactly. No npm audit fix executed.

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
# # #   S t a g e   8 D   I n t e g r a t i o n   a n d   S e c u r i t y   C l o s u r e  
  
 -   * * B r a n c h * * :   s t a g e - 8 d - i n t e g r a t i o n - s e c u r i t y - c l o s u r e  
 -   * * P a r e n t   S H A * * :   6 e 3 a f e a 3 5 8 6 9 2 2 9 e 5 0 d 0 6 1 8 9 3 7 4 0 3 5 a 5 c 7 1 6 1 d 8 e  
 -   * * I n t e g r a t i o n   A r c h i t e c t u r e * * :   I m p l e m e n t e d   f u l l   e n d - t o - e n d   l i f e c y c l e   i n t e g r a t i o n   f o r   l i t i g a t i o n   w o r k   p r o d u c t   ( g e n e r a t i o n ,   f i n a l i z a t i o n ,   i m m u t a b i l i t y ,   r e t r i e v a l )   p r o v i n g   h i s t o r i c a l   s n a p s h o t s   r e m a i n   r o b u s t   a g a i n s t   c h a n g e s .  
 -   * * S e c u r i t y   T e s t s * * :   A d d e d   c r o s s - r e v i e w e r   i s o l a t i o n ,   c r o s s - m a t t e r   b o u n d a r i e s ,   d i r e c t - I D   p r o t e c t i o n ,   a n d   r e v o c a t i o n   h a r d e n i n g   t e s t s .  
 -   * * R e v o c a t i o n   E v i d e n c e * * :   M O C K - O N L Y   ( T e s t e d   t h r o u g h   m o c k e d   r e q u i r e P r o f e s s i o n a l A c c e s s ) .  
 -   * * M i g r a t i o n   S t a t u s * * :   N o   n e w   m i g r a t i o n s   r e q u i r e d ;   p e n d i n g   S t a g e   8 C   m i g r a t i o n   r e m a i n s   u n e x e c u t e d .  
 -   * * T e s t   T o t a l s * * :   4 1   f i l e s ,   1 1 9 0   p a s s e d ,   0   f a i l e d .  
 -   * * B u i l d * * :   P a s s e d .  
 -   * * A u d i t   B a s e l i n e * * :   M a t c h e s   ( 1 1   t o t a l ,   1 0   m o d e r a t e ,   1   h i g h ) .  
 -   * * P r o d u c t i o n   C h a n g e s * * :   N o n e .  
 
### Stage 9A Implementation

Branch: stage-9a-authoritative-legal-sources
Parent SHA: 5d59632167d500479f77e7749147ecf2d7b82dbe

Stage 9A established the authoritative legal-source foundation for advanced legal research/RAG.
- Architecture relies on navigator_legal_sources, navigator_legal_source_versions, and navigator_legal_provisions created in prior stages.
- A new pending migration extends the model to support case-specific properties (court, decision_date, docket_number) and OTHER_OFFICIAL_AUTHORITY.
- A narrow retrieval interface api/services/legalSources.ts supports fetching sources, versions, provisions, resolving deterministic applicable versions based on effective dates, and deterministic internal citations.
- Deterministic behavior and provenance/integrity requirements are completely tested. No LLMs or automated conclusions were introduced.
- Existing tests passed entirely, baseline is untouched.

Tests passed: 1204 in full suite.
Build passed.
NPM Audit: 11 vulnerabilities (10 moderate, 1 high) (matches baseline).
Production unchanged.
Migrations created but unexecuted.

## STAGE 9A NARROW REMEDIATION

The independent audit blocked the initial Stage 9A candidate due to missing constraints:
- **Provision-Version Integrity**: Was not proven; the system did not verify that a requested provision belonged to the requested source version.
- **Content Integrity**: Was not implemented.
- **Provenance**: `AuthorityCitation` dropped important provenance fields (`title`, `officialPublisher`).

### Remediation
- Implemented a database lookup in `getAuthorityCitation` to ensure the requested provision exists in the requested source version via the `navigator_legal_provision_versions` relationship.
- Added `computeLegalContentHash` and `verifyLegalContentIntegrity` functions, leveraging the existing SHA-256 and normalization logic from Stage 6.
- Retained `title` and `officialPublisher` in the `AuthorityCitation` return type.
- Applied conservative pinpoint validation (`unverifiedCallerPinpoint`) to explicitly mark arbitrary pinpoint strings as caller-supplied.
- Corrected the prior overstatement: The initial candidate's claim that provenance and integrity were completely tested was **not supported by the independent audit**. The test suite was heavily mock-dominant. Actual production-boundary verification tests have now been appended.

**Status**: Stage 9A is NOT formally closed. Ready for independent re-audit.


==================================================
STAGE 9B IMPLEMENTATION
==================================================
BRANCH: stage-9b-matter-to-law-research
PARENT SHA: 180276dfca62dd224c768d2ba2b0cc854acc769b
ARCHITECTURE REUSED: legalAuthority.ts, legalSources.ts, legalCorpusRetrieval.ts, access.ts, accounts.ts. Reused Stage 9A's getAuthorityCitation and verifyLegalContentIntegrity safeguards. Reused Stage 5 classification enums and Stage 7/8 professionalMatterAccess.
NEW ARCHITECTURE: api/services/matterLegalResearch.ts containing buildMatterLegalResearchCandidate, saveMatterLegalResearchCandidate, listMatterLegalResearchCandidates. Migration create_navigator_stage9b_matter_research.sql.
MATTER PRIVACY MODEL: Explicit RLS check mapping via navigator_matter_members. Caller must be an active member of the matter (OWNER, REVIEWER, etc). Identity verified server-side.
EFFECTIVE-DATE BEHAVIOR: Uses Stage 9A's getAuthorityCitation resolving exact applicable versions per event date. Automatically fails closed (REQUIRES_RESEARCH) if version resolution is ambiguous or unavailable.
INTEGRITY BEHAVIOR: Checks expectedContentHash vs actualContent using verifyLegalContentIntegrity. Returns VERIFIED, UNVERIFIED, FAILED, or NOT_CHECKED. A mismatch fails closed.
MIGRATION STATUS: Pending migration created in supabase/migrations_pending_approval/create_navigator_stage9b_matter_research.sql. Not executed.
TESTS: Added matterLegalResearch.test.ts exercising pure function construction and RLS-like enforcement proofs at the service boundary.
KNOWN LIMITATIONS: Hash persistence limitation handled gracefully by marking 'NOT_CHECKED' if not present. Live AI explicitly avoided; extraction and matching depend on deterministic outputs.

## STAGE 9B NARROW REMEDIATION

The independent audit blocked the initial Stage 9B candidate due to missing constraints:
- **Effective-Date Resolution**: Trusted caller-supplied legalSourceVersionId instead of dynamically resolving event dates.
- **Content Integrity**: Trusted caller-supplied expected hashes.
- **Database RLS**: Used auth.uid() which mismatched application account UUID mapping conventions.
- **Idempotence**: Duplicated candidates on insert.
- **Reviewer Privacy**: Shared matter-level review state violated reviewer isolation.

### Remediation
- **Effective-Date Resolution**: Dropped trust in caller-supplied legalSourceVersionId. Now accepts eventId and authoritatively fetches date_lower_bound from 
avigator_events, resolving to the exact version via Stage 9A.
- **Content Integrity**: Fetches the authoritative 	ext_sha256 from 
avigator_legal_provision_versions. Rejects caller verification trust.
- **Database RLS**: Removed invalid auth.uid() policies. Restored the verified Stage 4 service-role application pattern.
- **Idempotence**: Added a compound UNIQUE constraint on (matter_id, evidence_item_id, event_id, legal_source_id, provision_id, retrieval_basis) and implemented an upsert strategy.
- **Reviewer Privacy**: Removed eview_state completely from candidate rows to enforce isolation via the existing professional_reviews model from Stage 7.
- **Mutations & Tests**: Added missing regression tests explicitly for cross-matter query filter protection, inactive membership blocking, historical versioning, caller hash trust rejection, and idempotence.

**Status**: STAGE 9B REMEDIATED — READY FOR INDEPENDENT RE-AUDIT.

==================================================
STAGE 9C IMPLEMENTATION
==================================================
BRANCH: stage-9c-citation-authority-validation
PARENT SHA: 24fff685c76ed1a44b399a2fb59c59f4ad0872f6
ARCHITECTURE REUSED: legalSources.ts, legalCorpus.ts, access.ts, accounts.ts, Stage 9B matter research candidate architecture.
NEW ARCHITECTURE: api/services/citationValidation.ts (validateCandidateCitation). 
VALIDATION STATES: VALIDATED, PARTIALLY_VALIDATED, REQUIRES_RESEARCH, UNVERIFIED, INVALID.
SOURCE EXISTENCE: Verified against authoritative navigator_legal_sources.
SOURCE/VERSION RELATIONSHIP: Verified. Version must belong to specified source.
EFFECTIVE-DATE CONSISTENCY: Authoritative effective context loaded; historic dates retained.
PROVISION EXISTENCE & PROVISION-VERSION INTEGRITY: Provision existence verified, and provision-version mapping verified against navigator_legal_provision_versions.
CONTENT-INTEGRITY TRUST MODEL: Checked prior candidate integrity. Hashes obtained server-side.
EXPECTED HASH SOURCE: navigator_legal_provision_versions
CALLER EXPECTED HASH TRUST: Untrusted.
CITATION METADATA: Deterministic loading from authoritative records.
CASE AUTHORITY: Metadata explicitly propagated. No holding/ratio inference.
PINPOINT VALIDATION: Caller-supplied pinpoints remain UNVERIFIED and flag citation as REQUIRES_RESEARCH.
EXACT QUOTE VALIDATION: Verified against exact_text from DB using established normalization. Altered quotes marked ALTERED and citation INVALID.
PROVENANCE: Fully preserved via citation metadata.
MATTER AUTHORIZATION: Uses Stage 9B server-authoritative checks (navigator_matter_members).
CROSS-MATTER & DIRECT-ID SAFETY: Query scoped strictly by matter_id.
REVOKED ACCESS: Gracefully fails closed if membership revoked.
SERVER-ONLY PRIVATE ACCESS: Retained.
REVIEWER PRIVACY: No reviewer-specific annotations exposed.
DETERMINISM: Enforced.
LEGAL-CORRECTNESS LIMITATION: Explicitly stated in 'limitations' output.
UNTRUSTED CONTENT: Quote parsing handles input safely.
PERSISTENCE: Computed deterministically; no new migrations required.
LIVE AI, FABRICATED AUTHORITY, AUTOMATED CONCLUSIONS: Prohibited and successfully avoided.
TESTS: Added comprehensive tests (citationValidation.test.ts) covering valid mappings, altered quotes, cross-matter safety, missing sources, and caller pinpoint behaviors.


## 2026-09-20 Stage 9 recovery and citation integrity correction

Recovery source: the local Stage 9C branch at 539988dbccaeaa2673a3a497881215a75124c228. No Stage 9D branch, commit, or uncommitted Stage 9D work was present in that checkout. The previous HANDOFF entries describe 9A and 9B as awaiting independent re-audit and 9C as implemented without formal closure. Stage 9D requirements have not been specified in repository documentation. Do not represent 9D as started or closed from this evidence.

A Stage 9C integrity defect was demonstrated: matching a caller-supplied hash to the stored hash could mark content VERIFIED without hashing stored authoritative text. Citation validation now hashes the stored provision text against its stored hash and treats caller hashes only as assertions. A regression test changes the authoritative text while repeating the stored hash and requires INVALID/FAILED. Prior candidate FAILED state remains fail-closed.

Validation: citationValidation.test.ts 14/14; Stage 9 legal tests 61/61; full suite 44 files and 1251/1251 with one worker; TypeScript no errors; production build passed; npm audit 11 advisories (10 moderate, 1 high), matching recorded baseline. Parallel full-suite runs had unrelated 5-second timeouts and worker startup failures; serial run passed. No migration, deployment, production change, or merge was performed.

Next: conduct independent closure audit of Stages 9A-9C, resolve any demonstrated defects, then define Stage 9D from an explicit repository milestone contract before implementation. No 9D freeze is claimed.

## 2026-09-20 Independent Stage 9A–9C closure audit

The independent audit is recorded in `STAGE_9ABC_CLOSURE_AUDIT.md` on branch `audit/stage-9abc-closure`, based on repaired Stage 9C candidate `408bf8c78accc6af228d750c4592b0c623495a5f`. **Stage 9A, 9B and 9C are BLOCKED, not formally closed/frozen.** Seven new behavioral regression tests demonstrate: 9A issues a citation for an unverified source; 9B accepts foreign/unverified/caller-asserted candidate fields; 9C marks unverified sources, versions and provisions `VALIDATED`. The 408bf8c stored-text hash repair itself passes its regression test. Full serial suite: 1,255 pass / 7 fail (the audit cases); typecheck and build pass; npm audit remains 11 advisories (10 moderate, 1 high). No production or migration action occurred. Stage 9D contract is deferred until 9A–9C pass closure; do not implement 9D yet.

## 2026-09-20 Stage 9A–9C narrow trust-boundary remediation

Branch: `remediate/stage-9abc-trust-boundaries`, based on audit commit `0e9bc76ae94a68148f3fcd19e4cf2f6d341cc88d`. The seven preserved closure regressions now pass without changing them. Stage 9A citation issuance requires verified source/version/provision; Stage 9B derives evidence classification from a matter-scoped persisted row and reconstructs trusted candidate fields before save; Stage 9C requires authority-chain verification separately from stored-text integrity. The 408bf8c replayed-digest fix remains intact. See `STAGE_9ABC_CLOSURE_AUDIT.md` for defect mapping, test evidence, and limits.

Gates: 9A 32/32; 9B 25/25; 9C 21/21; Stage 9 78/78; related security/integration 215/215; full one-worker suite 1,268/1,268 across 44 files; TypeScript and production build passed; npm audit remains 11 advisories (10 moderate, 1 high). Stage 9A/9B migrations remain pending and were not executed. No production, deployment, main-merge, or Stage 9D action occurred.

**Milestone status: Stage 9A, 9B and 9C REMEDIATED — AWAITING INDEPENDENT CLOSURE AUDIT.** No frozen SHA is assigned here. Stage 9D remains deferred.

## 2026-09-21 Stage 9 remediation verification continuation

The existing remediation at 289f02f0a14a1a2b20512ebe3c940165239ea173 was retained on remediate/stage-9abc-trust-boundaries. The original audit and 408bf8c stored-text hash repair remain in history. Added 13 tests for composed citation/research/save/validation behavior, trust downgrade, save-time persisted-record mutations, caller verification assertions, missing/unknown trust states, and mismatched provision-version links. All seven original audit regression bodies remain unchanged. No further production-code changes were needed.

Sequential gates: preserved regressions 7/7; Stage 9A 32/32; 9B 34/34; 9C 25/25; complete Stage 9 91/91; related security/integration 215/215; full one-worker suite 1,281 passed, 0 failed, 0 skipped across 44 files. TypeScript and production build passed (existing chunk warning). npm audit completed with exit 1 and baseline counts of 11 vulnerable packages: 10 moderate, 1 high. Dependencies unchanged.

## 2026-09-21 STAGE 9D-1 — DATA MODEL & PERSISTENCE FOUNDATION

Branch: `stage-9d-case-wide-legal-discovery`, based on `f5c17fe5945b6222c00e5653a1aef565d575d0b4` (Stage 9 roadmap-decision record; 9A–9C frozen SHA `836f21469dd6a3d2248517c1fd0acf44cd9d545a` remains an ancestor and is **not reopened** by this entry). This is a deliberately narrow sub-stage of Stage 9D: schema/persistence foundation only. **No discovery algorithm, ranking algorithm, research API/route, UI, or case-brief integration is implemented here.** That is explicitly out of scope for 9D-1 and deferred to 9D-2/3/4.

**Structures reused (not duplicated):** Stage 9A/6 authority identity (`navigator_legal_sources`, `navigator_legal_source_versions`, `navigator_legal_provisions`); Stage 9B `navigator_matter_legal_research_candidates` (a discovery result always points at a candidate row, never a re-stored citation); Stage 7C `professional_reviews` (its `finding_type` check is extended with `'LEGAL_RESEARCH_RESULT'` so machine-discovered research results can be professionally reviewed through the existing generic finding_type/finding_id model, instead of a second review framework); Stage 8 `professional_work_product_versions` (linkage target, not reimplemented).

**Structures added (`supabase/migrations_pending_approval/create_navigator_stage9d1_research_foundation.sql`, PENDING APPROVAL, NOT EXECUTED):**
- `navigator_matter_research_runs` — a matter-bound discovery/research run (matter_id FK, triggered_by_account_id, trigger_type MANUAL/SCHEDULED/SYSTEM, status, timestamps). A check constraint forbids a triggering account on a non-MANUAL run.
- `navigator_matter_research_run_results` — authorities discovered during a run. `candidate_id` is a same-matter composite FK into the Stage 9B candidate table (so authority identity, evidence/event linkage and evidence classification are never re-derived or re-asserted here — they are read through the candidate row). `discovery_status` (CANDIDATE_DISCOVERED/RANKED/SUPERSEDED) is a machine-only state, structurally separate from `professional_reviews.review_state`. `ranking_method`/`ranking_score`/`ranking_factors` (jsonb) hold structured explainability metadata, not a bare score. `staleness_checked_at` is a bare revalidation timestamp — current trust is always re-read live from the Stage 9A tables, never cached here.
- `navigator_matter_research_work_product_links` — a nullable/unused join table preparing for a future reviewed-research → work-product linkage, pointing at `professional_work_product_versions` by same-matter composite FK. Not written or read by any code in this stage.
- Additive `unique(id, matter_id)` composite-identity constraints added to `navigator_matter_legal_research_candidates` and `professional_work_product_versions` so the above composite FKs can enforce same-matter references (the same pattern the Stage 6/9A migration already uses for evidence/version/provision tables).

**Matter isolation:** every new table carries its own `matter_id` FK to `navigator_matters`, and every cross-table reference (run→matter, result→run, result→candidate, link→result, link→work-product) is a composite FK on `(id, matter_id)`, not a plain id FK — a row cannot reference another matter's run, candidate or work-product row even if a caller supplies a mismatched id. `api/services/matterResearchRuns.ts` enforces the same boundary at the application layer (server-verified matter membership before every read/write; run and candidate existence re-checked against the caller's matter, not trusted from input).

**Trust model:** no column in the new schema lets a caller substitute a value for server-derived authority verification, provenance or evidence classification — `ranking_factors` is opaque explainability jsonb that the service never reads back as a trust signal, and the mapped result/run types expose no `verificationState`/`trustState`/`citation` field. Authority identity, evidence classification and date/version resolution remain solely the responsibility of the reused Stage 9A/9B code paths.

**Professional review relationship:** kept structurally distinct — `discovery_status` on results tracks only machine discovery/ranking progress; professional confirmation happens exclusively through a `professional_reviews` row keyed on `(finding_type='LEGAL_RESEARCH_RESULT', finding_id=<result id>)`, reusing Stage 7C's existing review-state vocabulary rather than inventing a second one.

**Work-product linkage preparation:** `navigator_matter_research_work_product_links` exists and is matter-isolated, but is nullable/unpopulated and unconsumed by any code in this stage — a later 9D increment decides when/how a research result may be linked into a finalized work-product version.

**New service:** `api/services/matterResearchRuns.ts` — `createMatterResearchRun`, `listMatterResearchRuns`, `recordMatterResearchRunResult`, `listMatterResearchRunResults`. This is a persistence/validation layer only: it does not choose, discover or rank candidates; it records caller-supplied discovery/ranking results only after independently re-verifying the run and candidate belong to the authorized matter. `api/services/matterLegalResearch.ts` (Stage 9B) was not modified.

**Tests:** `api/services/matterResearchRuns.test.ts`, 16 new tests covering matter-bound run creation, cross-matter run/candidate rejection, canonical-candidate-only authority identity, machine-discovery/review-state separation, ranking-metadata bounds (score range, method-required-with-score/factors, no trust-field leakage), orphan-linkage rejection (nonexistent run/candidate), and matter-scoped listing.

**Gates (sequential):** 9D-1 targeted 16/16; Stage 9A (`legalSources.test.ts`) 32/32 unchanged; Stage 9B (`matterLegalResearch.test.ts`) 34/34 unchanged; Stage 9C (`citationValidation.test.ts`) 25/25 unchanged; complete Stage 9 incl. 9D-1 (4 files) 107/107; related security/integration (`access`, `humanReviewAccess`, `professionalMatterAccess`, `professionalWorkspace`) 53/53; `tsc --noEmit` zero errors; `npm run build` passed (existing large-chunk warning only, unchanged from prior gates). **Full one-worker suite was NOT run in this task** (deferred to the later full-integration gate for budget reasons) — no full-suite number is claimed or fabricated here.

**Unexecuted-migration status:** `create_navigator_stage9d1_research_foundation.sql` was written to `supabase/migrations_pending_approval/` only. It was not applied to any database, staging or production. RLS on the three new tables follows the existing service_role-only baseline (enabled, zero policies, revoked from public/anon/authenticated); row-level matter-membership predicates beyond that baseline are explicitly deferred to the release/integration gate, not invented here.

**Remaining work for 9D-2/3/4 (explicitly not started):** the actual discovery algorithm that populates `navigator_matter_research_runs`/`_results` from matter evidence and legal authority; the ranking/relevance algorithm behind `ranking_method`/`ranking_score`/`ranking_factors`; an authenticated research API route and any UI; wiring `navigator_matter_research_work_product_links` into real case-brief/work-product generation; live Postgres FK/RLS/constraint/concurrency validation of this migration (deferred to the release gate, same as 9A–9C).

**Milestone status: STAGE 9D-1 — IMPLEMENTED — AWAITING REVIEW.** Stage 9A, 9B and 9C remain frozen at `836f214...` and are unaffected by this entry — only additive `unique(id, matter_id)` constraints and one `professional_reviews.finding_type` check-constraint value were added on top of their tables, and no existing 9A/9B/9C service contract, row, or test assertion was changed. Stage 9D as a whole is **not** complete; 9D-2/3/4 remain to be scoped and implemented.

See STAGE_9ABC_CLOSURE_AUDIT.md for the seven-test trust-boundary mapping and verification limits. Live database transactions and pending migrations were not exercised. Stage 9A, 9B and 9C remain REMEDIATED — AWAITING INDEPENDENT CLOSURE AUDIT. Production, migrations, deployments, secrets and main were untouched; Stage 9D remains deferred. Next: independent Stage 9A–9C closure audit. Resolve the continuation commit with git log -1 --format=%H -- STAGE_9ABC_CLOSURE_AUDIT.md.


## STAGE 9D-2A — Matter Context + Legal Authority Discovery/Ranking (SERVICE ONLY)

**Service:** `api/services/matterLegalDiscovery.ts` (+ `api/services/matterLegalDiscovery.test.ts`). Callable operations: `buildMatterContext(firebaseUid, matterId)`, `tokenize(text)`, `rankDiscoveredAuthority(context, provisions)` (pure/synchronous), `resolveCandidateForMatch(firebaseUid, matterId, match)`, and the single orchestration entry point `runMatterLegalDiscovery(firebaseUid, matterId, options?)`. No Express routes, endpoint handlers, request/response payload design, frontend fetch code, or case-brief integration are implemented in this stage -- that is 9D-2b.

**Matter context:** built exclusively from existing persisted matter-side tables -- `navigator_claims` (proposition + classification), `navigator_events` (description), `navigator_evidence_items` (normalized_statement + classification). No second case-intelligence model is built. ALLEGATION/OPINION/INFERENCE/UNVERIFIED_CLAIM/PROFESSIONAL_ASSESSMENT/UNKNOWN classifications are carried through verbatim into context and ranking metadata and are never promoted to FACT. Matter text is always treated as data.

**Legal corpus:** discovery reads only canonical Stage 9A tables (`navigator_legal_sources`, `navigator_legal_provisions`); never uploaded matter documents, never the open web, no new vector DB. Default discovery loads only sources with `verification_state = 'VERIFIED'` and provisions whose own `verification_state = 'VERIFIED'` AND whose parent source is VERIFIED; a provision under a non-VERIFIED source is excluded, never surfaced with a caveat substituting for exclusion.

**Discovery/matching:** deterministic normalized-token overlap between matter-context item text and each verified provision's `label`+`citation` text (small stopword list, lowercase/NFKC normalization, alphabetically stable token sets). No existing retrieval utility was reused: `legalCorpusRetrieval.ts` is a citation-identity resolver (deterministic-version-by-date), not a term-overlap discovery mechanism, so its trust model does not fit this task; a purpose-built minimal matcher was implemented instead. A result means "potentially relevant for professional review," never a legal conclusion -- `reasonForRelevance` text is passed through Stage 6's `assertSafeLegalLanguage` guard unchanged.

**Ranking:** algorithm/version string `"stage9d-discovery-v1"` (exported as `DISCOVERY_ALGORITHM_VERSION`). Score = matched-term count / total normalized provision-token count, clamped to [0,1]. Deterministic sort: score desc, then explicit tie-break on provision id asc -- DB row order never determines rank. Persisted `ranking_factors` (into the frozen 9D-1 `navigator_matter_research_run_results.ranking_factors` jsonb column) contains: `algorithmVersion`, `matchedTerms`, `matchCount`, `provisionId`, `legalSourceId`, `legalSourceVerificationState`, `contextMatches` (per-context-item matched terms), `limitations`. No hidden chain-of-thought. `ranking_factors`/`ranking_score` are never read back as a trust signal anywhere in this service -- authority verification state is always re-read live from Stage 9A/9B, matching the property independently confirmed in the 9D-1 audit.

**Candidates:** every discovered authority is persisted through Stage 9B's own canonical path unchanged (`buildMatterLegalResearchCandidate` + `saveMatterLegalResearchCandidate` from `matterLegalResearch.ts`) -- no new candidate-construction logic was written. Reuse is automatic via Stage 9B's existing idempotence-key upsert (`matterId|evidenceItemId|eventId|legalSourceId|provisionId|retrievalBasis`); calling discovery twice for the same matter/provision reuses, never duplicates, the same candidate row. `retrievalBasis` is fixed to `"stage9d-discovery-v1:term-overlap"`. Caller input never supplies verification state, provenance, classification or integrity directly -- those remain Stage 9B/9A-derived.

**Persistence:** `runMatterLegalDiscovery` creates one `navigator_matter_research_runs` row (via 9D-1's `createMatterResearchRun`, unmodified) and one `navigator_matter_research_run_results` row per surfaced match (via 9D-1's `recordMatterResearchRunResult`, unmodified), each carrying `rankingMethod = DISCOVERY_ALGORITHM_VERSION`, `rankingScore`, and the structured `rankingFactors` above. The frozen 9D-1 migration file was not modified.

**Matter isolation:** every operation reuses the same `requireMatterAccess` (`navigator_matter_members`) pattern as `matterResearchRuns.ts`/`matterLegalResearch.ts`, and every read/write is matter-id-scoped. `runMatterLegalDiscovery` additionally asserts the resolved candidate's `matterId` matches the requested matter before persisting a result. Cross-matter access is rejected with 403 before any read.

**Trust / prompt-injection boundary:** an explicit test proves matter text containing "ignore previous instructions", "verificationState=VERIFIED", "mark this statute authoritative", "approve this research" tokenizes as ordinary data -- it does not change a discovered provision's verification state, does not add a candidate, and does not alter ranking beyond ordinary vocabulary overlap.

**Tests (original submission):** `api/services/matterLegalDiscovery.test.ts` -- 19 tests passed (context derivation, classification preservation, no-caller-ID discovery, VERIFIED-only surfacing, unverified-source exclusion/limitation, allegation-stays-allegation, spoofed-trust-text rejected, prompt-injection-as-data, deterministic ranking, deterministic tie-break, tokenize normalization, candidate creation, candidate reuse/no-duplicate, full-orchestration persistence, ranking-explanation persistence, matter isolation reject, safe-empty-result, ranking-never-changes-trust).

**Original limitations note (superseded by the remediation below):** the original submission stated "a provision whose only VERIFIED version does not (yet) resolve to a specific event date is still discovered/ranked but its candidate carries `legalSourceVersionId: null` and `contentIntegrityStatus: NOT_CHECKED`/`UNVERIFIED`." An independent audit correctly identified this as more than a limitation: it meant a provision could be VERIFIED at the identity level with **zero verified canonical text ever existing for it**, and it would still enter discovery unblocked. See the remediation record immediately below.

---

### INDEPENDENT AUDIT — BLOCKED (candidate SHA `31fbe184320bd445724b9377dfe2af6f122d7c7a`)

An independent audit of the above 9D-2A submission **BLOCKED** it. Finding: `loadVerifiedCanonicalProvisions()` in `matterLegalDiscovery.ts` checked only identity-level `navigator_legal_sources.verification_state = 'VERIFIED'` and `navigator_legal_provisions.verification_state = 'VERIFIED'`. It never checked the version/text-integrity layer (`navigator_legal_source_versions` verification + `navigator_legal_provision_versions` stored text/hash). Because discovery never resolved an `eventId` for a matched provision, `resolveCandidateForMatch` always called `buildMatterLegalResearchCandidate` with no event date to resolve a version from; `buildMatterLegalResearchCandidate`'s version resolution branch only ever ran off an `eventId`-derived case date, so it never ran; `getAuthorityCitation` was called with `versionId = undefined`, which (correctly, per its own contract) skips version verification; and the resulting Stage 9B candidate was persisted with `contentIntegrityStatus: 'NOT_CHECKED'` and no bound version -- yet discovery still surfaced, ranked and persisted it as a research result. A provision VERIFIED only at the identity level, with no verified canonical text ever ingested for it, was fully discoverable.

### 9D-2A REMEDIATION (this entry)

**Root cause, verified against the actual schema (not assumed from the audit's prompt):** confirmed in `supabase/migrations_pending_approval/create_navigator_legal_authority_foundation.sql` (Stage 6 M1) and `create_navigator_legal_corpus_versioning.sql` (Stage 6 M2A -- both pre-existing, neither touched here). The real canonical chain is: `navigator_legal_sources` (source identity, `verification_state`) → `navigator_legal_source_versions` (dated version of a source, its own `verification_state`, `status`) → `navigator_legal_provisions` (stable conceptual/citation identity, its own `verification_state`) → `navigator_legal_provision_versions` (the actual wording of one provision during one source-version's effective period: `exact_text`, `text_sha256`, `effective_from`/`effective_to`, plus a separate `verification_status` curation column). Content integrity is `text_sha256 = sha256(normalized_text)`, checked via `legalSources.ts`'s `verifyLegalContentIntegrity`. `citationValidation.ts`'s `validateCandidateCitation` (step 7) reports `contentIntegrityStatus: 'VERIFIED'` only when a `navigator_legal_provision_versions` row exists for the exact `(provision_id, legal_source_version_id)` pair and its stored `exact_text` genuinely hashes to its stored `text_sha256` -- it does **not** additionally gate on that row's own `verification_status` curation column. The fix below reuses this exact semantics rather than inventing a stricter or different one.

**What changed:**
- `api/services/matterLegalDiscovery.ts` — `loadVerifiedCanonicalProvisions()` now additionally loads `navigator_legal_source_versions` (VERIFIED only) and all `navigator_legal_provision_versions`, and resolves, per provision, the currently-effective provision-version whose (a) `legal_source_version_id` is a VERIFIED source-version, (b) that source-version's own `legal_source_id` agrees with the provision-version's own `legal_source_id` (defensive chain-mismatch guard, mirroring the 9A migration's composite-FK guarantee at the service layer), (c) `effective_from <= today` and (`effective_to` is null or in the future), and (d) `exact_text` genuinely hashes to `text_sha256` via `verifyLegalContentIntegrity`. A provision with no such version is dropped from discovery entirely -- `CanonicalProvision` now carries `verifiedLegalSourceVersionId` for every provision it returns.
- `resolveCandidateForMatch` now passes that resolved version id into `buildMatterLegalResearchCandidate` as a new field, `serverResolvedVersionId` (see below), instead of leaving version resolution entirely to the (event-date-only) 9B path.
- `api/services/matterLegalResearch.ts` — `ResearchCandidateInput` gains an optional `serverResolvedVersionId`, populated **only** by a trusted server-side caller (discovery) that has already independently resolved and verified it against Stage 9A -- never accepted from an HTTP request body or any caller-controlled ranking metadata. `buildMatterLegalResearchCandidate` uses it **only** when no `eventId`-based date resolution already produced a version (the existing event-date path is completely unchanged and still takes priority), and even then it is independently re-verified again from scratch: `getSourceVersion` is re-fetched, its `legalSourceId` must match, and its `verificationState` must be `'VERIFIED'` -- the value is never trusted as-is. `saveMatterLegalResearchCandidate`'s own re-derivation (which rebuilds the canonical candidate from persisted records before writing) now also threads `serverResolvedVersionId: candidate.legalSourceVersionId` through so a discovery-resolved version survives that re-verification pass too, exactly as an event-resolved version already did.
- `api/services/matterResearchRuns.ts` — added `updateMatterResearchRunStatus(firebaseUid, {matterId, researchRunId, status})`, using only status values the frozen 9D-1 schema already defines (`RUNNING`/`COMPLETED`/`FAILED`) and stamping `completed_at` exactly as the migration's own check constraint requires. No schema/migration change.
- `api/services/matterLegalDiscovery.ts` — `runMatterLegalDiscovery`'s per-match loop is now wrapped in try/catch: on any failure (candidate creation or result persistence) the run is marked `FAILED` (with `completed_at` stamped) before the original error is rethrown; on success the run is marked `COMPLETED`. Earlier, already-persisted results/candidates from before the failure point remain correctly persisted and returned/thrown-with -- nothing is rolled back or hidden.
- No file under `supabase/migrations_pending_approval/` was modified. `create_navigator_stage9d1_research_foundation.sql` is byte-identical to the frozen 9D-1 commit (`sha1sum` verified before and after this remediation).

**Discovery eligibility rule (new, precise):** a provision is trusted-discovery-eligible iff: its own `verification_state = 'VERIFIED'`; its source's `verification_state = 'VERIFIED'`; AND there exists a `navigator_legal_provision_versions` row for that provision whose `legal_source_version_id` refers to a `navigator_legal_source_versions` row with `verification_state = 'VERIFIED'` and the same `legal_source_id`, whose effective window covers today, and whose stored `exact_text` genuinely hashes to its stored `text_sha256`. Absent any of these, the provision is excluded from discovery outright -- not surfaced with a caveat substituting for exclusion.

**Version binding:** every discovered/persisted Stage 9B candidate now carries the resolved `legalSourceVersionId` (never `null`) when a verified version exists, and `contentIntegrityStatus: 'VERIFIED'` (never `NOT_CHECKED`) for that path -- verified by the new regression "binds the server-resolved verified version and reports VERIFIED content integrity."

**Candidate integrity/provenance:** unchanged trust boundary -- caller/ranking metadata (matched terms, score, discovery's own `DiscoveredMatch`) still never supplies verification state, provenance or integrity directly; the new `serverResolvedVersionId` path is independently re-verified against live Stage 9A data every time, including inside `saveMatterLegalResearchCandidate`'s re-derivation. Regression "never trusts a caller-asserted version identity that does not independently re-verify" proves a spoofed/unrelated version id is rejected (404), not silently accepted.

**Partial-failure run-status investigation (Step 4, done for real, not assumed):** before this fix, `runMatterLegalDiscovery` never updated `navigator_matter_research_runs.status` at all after creation -- every run, whether it succeeded, discovered zero matches, or failed partway through, was left at `status = 'PENDING'` forever. This did not literally violate "a failed run reads as COMPLETED" (nothing was ever marked COMPLETED), but it meant a genuine mid-run failure was indistinguishable from an in-progress or never-executed run, and the schema's own `FAILED`/`COMPLETED` states (which the 9D-1 migration explicitly supports and gates on `completed_at`) were never used. Confirmed defect: **YES** (an honest status signal was never produced at all, for either outcome). Remediation: the smallest service-layer fix described above (`updateMatterResearchRunStatus`, called from `runMatterLegalDiscovery`'s try/catch) -- no 9D-1 migration change needed or made. Regression tests added, all in `matterLegalDiscovery.test.ts` under "partial-failure run status honesty": (A) run created then candidate persistence fails → run ends `FAILED` with `completed_at` set; (B) candidate succeeds then result persistence fails → run ends `FAILED`; (C) two matches, first result write succeeds and second fails → the first result row remains correctly persisted (`navigator_matter_research_run_results.length === 1`) and the run is honestly `FAILED`, never `COMPLETED`. A companion test confirms a genuinely successful run (including the zero-match case) is now marked `COMPLETED` with `completed_at` set.

**Tests (after remediation):** `api/services/matterLegalDiscovery.test.ts` -- **33 tests passed** (the original 19, unweakened, plus 14 new: eligibility rules 1/2/3/4/5/6 + superseded/not-yet-effective edge cases, candidate version-binding + integrity regression, caller-cannot-spoof-version regression, successful-run-marked-COMPLETED regression, and the three partial-failure run-status regressions A/B/C). Two of the original 19 assertions were adjusted, not weakened, as this remediation's own subject matter required: (1) fixtures for the "positive path" tests now include a valid verified `navigator_legal_source_versions`/`navigator_legal_provision_versions` pair, since identity-only VERIFIED rows are no longer sufficient; (2) the "fails safely (empty result)" test's assertion changed from `run.status === 'PENDING'` to `run.status === 'COMPLETED'`, which is precisely the Step 4 fix this entry documents, not a loosened correctness check.

**Deferred to 9D-2b (explicitly not started here, unchanged from the original submission):** Express routes/endpoint handlers, request/response payload/schema design, per-endpoint authentication/authorization wiring, IDOR tests, any UI, case-brief/work-product integration via `navigator_matter_research_work_product_links`.

**Milestone status: 9D-2A REMEDIATED — AWAITING INDEPENDENT CLOSURE AUDIT.** Stage 9A, 9B and 9C remain independently frozen/closed at `836f21469dd6a3d2248517c1fd0acf44cd9d545a` as recorded above; Stage 9D-1 remains frozen at `33fb2d4d96f5101f6d3d8f97306746ea8b5a79fa` (its migration file is byte-identical throughout this remediation, verified by `sha1sum` before and after). `matterResearchRuns.ts` (a 9D-1 *service* file, not the frozen migration) gained one additive function, `updateMatterResearchRunStatus`; no existing 9D-1 function, test or schema was changed. Stage 9D as a whole is **not** complete; 9D-2b, 9D-3 and 9D-4 remain to be implemented. This remediation resolves the specific audit-blocked defect above; it does not itself constitute the independent closure audit this entry's status name refers to.

## STAGE 9D-2B — Authenticated API Wrapper over Frozen Stage 9D-2a Discovery (API/AUTH ONLY)

Branch: `stage-9d-case-wide-legal-discovery`, parent `8dddde9ccceb9a4d3f6bcba079999726ddab4847` (the independently-audited CLOSED/FROZEN Stage 9D-2a remediation commit, unchanged by this entry). Scope is deliberately narrow: authentication, matter authorization and API surface only. No line of `api/services/matterLegalDiscovery.ts` or `api/services/matterResearchRuns.ts` was modified; both are called exactly as their existing exported signatures already allow. No professional-review mutation (9D-3) or work-product integration (9D-4) is implemented. No schema/migration change.

**New file:** `api/matterLegalDiscoveryRoutes.ts` (`registerMatterLegalDiscoveryRoutes`), registered in `api/_server.ts` alongside the other route modules (`registerLifecycleRoutes`, `registerEvidenceReviewRoutes`, etc.), mounted after the app's shared CORS/rate/payload middleware, matching the existing convention exactly.

**Routes:**
- `POST /api/matters/:matterId/legal-discovery/runs` — starts discovery. Body is narrowly allowlisted to `{triggerType?, maxResults?}`; every other field is silently ignored. Calls `runMatterLegalDiscovery(uid, matterId, options)` verbatim. Returns `201 {run, resultCount, results}`.
- `GET /api/matters/:matterId/legal-discovery/runs` — lists research runs for an authorized matter via `listMatterResearchRuns`, exposing the real lifecycle status (`PENDING`/`RUNNING`/`COMPLETED`/`FAILED`) unmodified.
- `GET /api/matters/:matterId/legal-discovery/runs/:runId/results` — retrieves discovery results for an authorized matter+run. Re-derives the caller's run set via `listMatterResearchRuns` and checks the requested `runId` is a member of it (compound `matterId`+`runId` scoping) before calling `listMatterResearchRunResults`; returns `200 {run, results}` so the run's real status (including `FAILED`) always travels with whatever results exist. A run that does not exist, or belongs to another matter, yields the identical `404 {code:'RESEARCH_RUN_NOT_FOUND', ...}` shape — no existence signal is leaked either way.
- No separate single-result-detail endpoint was added; the results-list endpoint is already matter+run scoped, satisfying the actual invariant (no result retrievable outside its authorized matter/run context) without adding route surface.

**Authentication:** identity is resolved only via `verifyFirebaseToken(req.header('authorization'))`, exactly as `lifecycleRoutes.ts`/`evidenceReviewRoutes.ts` already do. uid is never read from the request body or query string; the route handler receives only the verified `{uid, email}` identity object.

**Matter authorization:** every route delegates matter-membership verification to the underlying frozen service call itself (`runMatterLegalDiscovery` / `listMatterResearchRuns` / `listMatterResearchRunResults`, each of which independently re-checks `navigator_matter_members` via the same `requireMatterAccess` helper already established in 9D-1/9D-2a) — this route layer introduces no separate, potentially-divergent authorization path. Route params are UUID-validated (via the services' own `requireUuid`, surfaced as a `LifecycleError`) before any query executes.

**IDOR defenses (full matrix implemented as route-level tests in `api/matterLegalDiscoveryRoutes.test.ts`, 24 tests, real Express handlers via supertest, not service-only unit tests):** authorized start succeeds; unauthenticated denied (start/list/results); authenticated-but-unauthorized-for-matter denied; professional-profile-only (no matter membership) denied; verified-lawyer-only (no matter membership) denied; Matter-A-authorized user requesting Matter-B start denied; Matter-A user listing Matter-B runs denied; Matter-A user supplying a Matter-B run ID while claiming Matter A → 404 `RESEARCH_RUN_NOT_FOUND`; mixing a valid Matter-A run ID with Matter-B caller access → 404; valid run ID alone without matter access on that matter → 403; run/result ID knowledge alone (a random run id under an authorized matter) → 404, no candidate/authority ID is ever accepted as a lookup key by any route; nonexistent matter → 403 (fails closed exactly like an unauthorized matter, same as the existing `requireMatterAccess` contract); malformed matter id and malformed run id both rejected with 400 before any DB access.

**Request validation:** `parseStartDiscoveryOptions` allowlists only `triggerType` (`MANUAL`/`SCHEDULED`/`SYSTEM`) and `maxResults` (integer 1–100); anything else in the body is dropped, never read, never forwarded to the discovery service.

**Trust-input adversarial test:** `matterLegalDiscoveryRoutes.test.ts` sends a start-discovery body containing `verificationState: 'VERIFIED'`, `contentIntegrityStatus: 'VERIFIED'`, `approved: true`, `validated: true`, `sourceVersionId`, `provisionVersionId`, `rankingScore: 999`, `rankingFactors`, `candidateId`, `legalSourceId` — all attacker-supplied — and asserts the persisted `rankingFactors.algorithmVersion` is still the server's own `'stage9d-discovery-v1'`, the persisted `rankingScore` is not the injected `999`, and the run/results are scoped to the real matter, proving none of the injected fields reach or alter the service's server-derived trust state.

**Response shaping:** only the frozen services' own mapped return objects are serialized; the `authenticated()` wrapper's catch clause converts any non-`LifecycleError` into a fixed, generic `{code, error}` body and logs only a static failure code server-side — raw DB errors, stack traces, Firebase internals and env/secret values are never included, verified by a dedicated response-shaping test that injects a DB error containing the literal strings `SQL`/`secret`/`internal_table`/`service_role_key` and asserts none appear in the response body.

**Failed/partial-run semantics:** the results endpoint always returns `{run, results}` together — the run's live, real `status` (never hidden or remapped) travels with whatever result rows are persisted, so a `FAILED` (or partially-persisted) run can never be represented to the caller as `COMPLETED`. Tested via a route-level scenario that forces the run-results insert to fail mid-loop and confirms the run is readable afterward as `FAILED` through `GET .../runs`, and a companion scenario confirming a genuinely eligible-but-empty discovery still reports `COMPLETED` with zero results rather than any false-FAILED state.

**Prompt-injection boundary:** unchanged — this layer adds no new code path that reads matter-document/claim/event text as anything other than the same DATA-only input the frozen `matterLegalDiscovery.ts` already treats it as; the API layer never re-serializes or re-interprets that text itself.

**Concurrency/idempotence:** a route-level test issues two authorized start requests for the same matter in sequence and asserts exactly one candidate row exists afterward (Stage 9B/9D-2a idempotent candidate reuse holds through the new API layer) while two distinct run rows are created, confirming the API does not itself introduce duplicate candidate creation.

**Tests:** `api/matterLegalDiscoveryRoutes.test.ts` — 24/24 passing, calling real registered Express route handlers (via `express()` + `supertest`), with only the DB transport (`access.js`), account resolution (`accounts.js`) and Firebase token verification doubled — matching the rigor level of `lifecycleRoutes.test.ts`.

**Known limitations:** no single-result-detail-by-id route was added (list-only, matter+run scoped, was judged sufficient and narrower); `maxResults` upper bound (100) is a route-level convenience cap layered on top of the service's own `DEFAULT_MAX_RESULTS`/positive-integer validation, not a new business rule; this stage does not add any new persistence, so run/result staleness (`stalenessCheckedAt`) is exposed exactly as the frozen 9D-1 schema already produces it, unexamined further here.

**Gates (sequential):** 9D-2b targeted route tests 24/24; 9D-2a (`matterLegalDiscovery.test.ts`) 33/33 unchanged; 9D-1 (`matterResearchRuns.test.ts`) unchanged, part of the 107/107 combined Stage-9D-1-era run below; Stage 9A (`legalSources.test.ts`), 9B (`matterLegalResearch.test.ts`), 9C (`citationValidation.test.ts`) plus `matterResearchRuns.test.ts` together 107/107 unchanged; auth/matter-access/security (`access.test.ts`, `humanReviewAccess.test.ts`, `professionalMatterAccess.test.ts`, `professionalWorkspace.test.ts`) 53/53 unchanged; broader Stage-9 sweep (`legalAuthority`, `legalCorpus`, `legalCorpusIngestion`, `legalCorpusMigration`, `legalCorpusMonitoring`, `legalCorpusRetrieval`, `legalCorpusValidation`) 352/352 unchanged; `tsc --noEmit` zero errors; `npm run build` passed (existing large-chunk warning only, unchanged from prior gates); full one-worker whole-project suite (`vitest run --maxWorkers=1`) RUN: 1354/1354 passed across 47 test files.

**Milestone status: 9D-2B IMPLEMENTED — AWAITING INDEPENDENT REVIEW.** Stage 9A, 9B and 9C remain independently frozen/closed at `836f21469dd6a3d2248517c1fd0acf44cd9d545a`; Stage 9D-1 remains frozen at `33fb2d4d96f5101f6d3d8f97306746ea8b5a79fa`; Stage 9D-2a remains closed/remediated at `8dddde9ccceb9a4d3f6bcba079999726ddab4847`, and none of their files were modified by this entry (only a new route file was added, plus two additive lines in `api/_server.ts` registering it). Stage 9D as a whole is **not** complete; 9D-3 (professional review mutation) and 9D-4 (work-product integration) remain to be implemented.

## STAGE 9D-3 — Professional-Facing Legal Research Workspace UI

Branch: `stage-9d-case-wide-legal-discovery`, parent `2f1c324234fba9a991f9255012d0c245f4a6d076` (the independently-audited CLOSED/FROZEN Stage 9D-2b commit). **`api/services/matterLegalDiscovery.ts` and `api/matterLegalDiscoveryRoutes.ts` were not modified** — both are called exactly as their existing exported/route contracts already allow. No Stage 9D-4 work-product/case-brief integration was implemented.

**Workspace location:** a new `LEGAL_DISCOVERY` tab inside the existing professional matter workspace (`src/components/ProfessionalWorkspace.tsx`), following the same tab-array/`activeTab` pattern already used for `EVIDENCE`/`CHRONOLOGY`/`CLAIMS`/etc. New component: `src/components/LegalDiscoveryTab.tsx`, rendered only when a matter is selected and receiving `matterId` as a prop — it is not a standalone/disconnected page.

**API consumption (verified against the actual route code, not guessed):**
- `POST /api/matters/:matterId/legal-discovery/runs` (frozen 9D-2b) — starts discovery, body `{triggerType:'MANUAL'}`.
- `GET /api/matters/:matterId/legal-discovery/runs` (frozen 9D-2b) — run history with real `PENDING`/`RUNNING`/`COMPLETED`/`FAILED` status, rendered unmodified/unremapped.
- `GET /api/matters/:matterId/legal-discovery/runs/:runId/results` (frozen 9D-2b) — results for a run, in server-provided array order; never re-sorted client-side (proven by a dedicated test that supplies a low-score-first server order and asserts the DOM order matches it exactly).
- `GET /api/matters/:matterId/legal-research/candidates` (NEW, additive) — the frozen 9D-2b results route returns only `candidateId`/`rankingScore`/`rankingFactors` per result (no citation text, source name or classification), so authority/provenance detail is unavailable without a join. A new route file, `api/matterLegalResearchCandidatesRoutes.ts`, was added calling the existing, unmodified `listMatterLegalResearchCandidates` export from Stage 9B's `api/services/matterLegalResearch.ts` (that function independently re-verifies matter membership itself — no new authorization path). This is the same "wrap a frozen service in a small new route" pattern 9D-2b itself used; it does not touch either of the two explicitly frozen 9D-2 files.
- `GET /api/professional-workspace/matters/:matterId/reviews/:findingType` (NEW, additive) and reuse of the existing `POST /api/professional-workspace/matters/:matterId/review` — see PROFESSIONAL REVIEW below.

**Run lifecycle UX:** a "Start Legal Discovery" button (disabled while a start request is in flight, preventing duplicate submission) triggers the POST route; run history renders as a clickable list, most-recent first, each row showing a distinct status badge (PENDING = slate, RUNNING = blue, COMPLETED = emerald, FAILED = red, each with a textual label, never color-only). Selecting a run loads its results.

**POST failure asymmetry (tested):** on POST success, run history and candidates are refetched. On POST failure (network error or non-2xx), a safe, generic error message is shown AND run history is unconditionally refetched — the frozen route's documented behavior (a run can be persisted as FAILED even though the POST throws) is never assumed away. `src/components/LegalDiscoveryTab.test.tsx` — `"POST failure asymmetry: shows a safe error AND refetches run history (run may have persisted as FAILED)"` — mocks a 500 POST response, then a second GET runs call that now returns a persisted FAILED run, and asserts both the error alert and the FAILED run badge appear. Passes.

**Result presentation:** each result shows a "Machine-discovered" badge, its raw `discoveryStatus` (`CANDIDATE_DISCOVERED`/`RANKED`/`SUPERSEDED`), the candidate's `authorityIdentifier` (citation text), `contentIntegrityStatus`, and `sourceProvenance` rendered only as a link when `isSafeWebsiteUrl()` (existing Stage 7 utility, reused unchanged) approves it. A FAILED run shows an explicit red banner stating results shown are not a complete set; a COMPLETED run with zero results shows an explicit "discovered no potentially relevant authorities" message — neither state is ever presented as the other.

**Ranking explanation ("why this surfaced"):** rendered from the server's own persisted `rankingFactors` (matched terms, matched-context-item count/types, limitations, algorithm version) inside a labeled, collapsible section — never a raw JSON dump, and nothing is invented beyond what `rankingFactors` actually contains.

**Authority/provenance presentation:** citation identifier, content-integrity status and source URL come only from the new read-only candidates route (Stage 9B data), never re-derived or asserted client-side; all of these are read-only display — there is no UI path to edit them.

**Matter-context classification:** `candidate.evidenceClassification` (ALLEGATION/FACT/OPINION/INFERENCE/UNVERIFIED_CLAIM/etc., Stage 9B-derived) is displayed verbatim as "Matter context: <value>", never reworded toward a factual or legal-conclusion claim. Non-conclusory language ("potentially relevant authority", "machine-discovered", "why this surfaced", "verified source text") is used throughout; "applicable law", "legal violation" and "definitively relevant" never appear.

**Machine vs. professional review:** every result's machine-discovered content and its professional-review control are rendered in visually distinct blocks (a plain white card vs. a separately bordered/colored "Professional Review (human, separate from machine discovery)" box with its own `data-testid`); nothing about ranking or verification state implies a professional disposition.

**Professional review — EXISTING WRITE CONTRACT REUSED, not blocked.** Investigation found `api/services/professionalWorkspace.ts`'s `saveProfessionalReview` / `POST /api/professional-workspace/matters/:matterId/review` (Stage 7C) already accepts an arbitrary `finding_type` string with no application-layer allowlist, and the frozen (pending-approval, unexecuted) Stage 9D-1 migration `create_navigator_stage9d1_research_foundation.sql` already extends `professional_reviews`'s `finding_type` CHECK constraint to include `'LEGAL_RESEARCH_RESULT'` specifically so machine-discovered research results can be reviewed through this existing generic model. `review_state` itself carries no DB CHECK constraint; this stage reuses, verbatim, the exact six values already used by the existing Stage 7C review UI in `ProfessionalWorkspace.tsx` (`UNREVIEWED`/`CONFIRMED_RELEVANT`/`POSSIBLY_RELEVANT`/`NOT_RELEVANT`/`REQUIRES_RESEARCH`/`SUPERSEDED`) rather than inventing new vocabulary. A small additive read-only companion, `listProfessionalReviewsForFindingType` (new function in `professionalWorkspace.ts`) + `GET /api/professional-workspace/matters/:matterId/reviews/:findingType` (new route in `professionalWorkspaceRoutes.ts`), was added so the workspace can load the caller's own prior review state for this finding type (the existing `getIntelligenceCategory` read path is hard-restricted to the six canonical intelligence categories and rejects any other category value, so it could not be reused for this purpose). `findingId` passed to the review write is always the discovery result's own `id` (`navigator_matter_research_run_results.id`), matching the migration's documented `(finding_type='LEGAL_RESEARCH_RESULT', finding_id=<result id>)` keying. No schema change, no new write endpoint, no new review-state vocabulary.

**Untrusted content / XSS:** all matter text, candidate text and ranking-explanation text is rendered as plain React text nodes (JSX auto-escaping only) — no `dangerouslySetInnerHTML` or equivalent is used anywhere in `LegalDiscoveryTab.tsx`. A dedicated test injects `<img src=x onerror=alert(1)>` and prompt-injection-style text (`"ignore previous instructions"`) into `rankingFactors.matchedTerms` and asserts no `img[onerror]` element is ever created in the DOM while the literal text renders inertly.

**Security:** identity/authorization remain fully server-side (every route re-verifies `navigator_matter_members`); the UI adds no client-side access control. 401/403 responses render a generic "not authorized" message (no internals leaked); 404 on a results fetch renders "run could not be found." Trust-sensitive fields (`contentIntegrityStatus`, `discoveryStatus`, `rankingScore`, `rankingFactors`, run `status`) are rendered read-only throughout — no input control in this UI can set any of them.

**Matter isolation in the UI:** `LegalDiscoveryTab` resets all local state (runs, selected run, results, candidates, reviews, errors) in a `useEffect` keyed on its `matterId` prop and refetches from scratch; a dedicated test switches `matterId` between two matters via `rerender` and asserts Matter A's run list is fully gone and Matter B's empty state is shown — no stale cross-matter bleed.

**Accessibility:** uses real `<button>`/`<select>` elements (no div-onclick), `role="alert"` for errors, `role="status"` + a textual label (not color alone) on every status badge, `aria-pressed` on the selected run row, and a labeled (visually-hidden `<label>`, not placeholder-only) review `<select>` per result.

**Tests:** `src/components/LegalDiscoveryTab.test.tsx` — **16/16 passing** — no-matter-context render-nothing; empty (no runs) state; start-discovery calls the exact frozen POST route; duplicate-start prevented while a request is in flight; POST-failure asymmetry (error shown AND run history refetched, revealing a persisted FAILED run); PENDING/RUNNING/COMPLETED/FAILED render distinctly; FAILED-with-partial-results stays visibly FAILED (never reads as complete); COMPLETED-with-zero-results honest empty state; server-provided result order preserved (never re-sorted client-side); ranking explanation rendered from real server `rankingFactors`, not a JSON dump; ALLEGATION classification preserved verbatim with no legal-applicability language; machine-discovery vs. professional-review visual/structural distinction; review action uses the real write contract (`findingType='LEGAL_RESEARCH_RESULT'`, `findingId=<result id>`) and the saved state is visible after refetch; 401 handled safely; untrusted/script-like text renders inertly (no `onerror` execution); matter switch clears/refetches with no stale bleed.

**Files changed:**
- `src/components/LegalDiscoveryTab.tsx` (new)
- `src/components/LegalDiscoveryTab.test.tsx` (new)
- `src/components/ProfessionalWorkspace.tsx` (added `LEGAL_DISCOVERY` tab + render branch; no existing tab's behavior changed)
- `api/matterLegalResearchCandidatesRoutes.ts` (new, additive read-only route)
- `api/services/professionalWorkspace.ts` (added `listProfessionalReviewsForFindingType`; `saveProfessionalReview`/`getMatterOverview`/`getIntelligenceCategory` unchanged)
- `api/professionalWorkspaceRoutes.ts` (added one GET route registration)
- `api/_server.ts` (two additive lines registering the new candidates route module)
- **Not modified:** `api/services/matterLegalDiscovery.ts`, `api/matterLegalDiscoveryRoutes.ts`, `api/services/matterResearchRuns.ts`, `api/services/matterLegalResearch.ts`, any `supabase/migrations_pending_approval/*.sql` file.

**Schema:** NO schema change. No migration file was touched.

**Gates (sequential, all run this task):** 9D-3 targeted UI tests 16/16; 9D-2b API tests (`matterLegalDiscoveryRoutes.test.ts`) 24/24 unchanged; 9D-2a (`matterLegalDiscovery.test.ts`) 33/33 unchanged; 9D-1 (`matterResearchRuns.test.ts`) unchanged; 9A (`legalSources.test.ts`) unchanged; 9B (`matterLegalResearch.test.ts`) unchanged; 9C (`citationValidation.test.ts`) unchanged — the five together: 140/140; professional workspace/review + auth/access/security (`professionalWorkspace.test.ts`, `access.test.ts`, `humanReviewAccess.test.ts`, `professionalMatterAccess.test.ts`) 24 + 41 = combined 53/53 (some overlap between the two invocations run this task, both fully green); broader Stage-9 sweep (`legalAuthority`, `legalCorpus`, `legalCorpusIngestion`, `legalCorpusMigration`, `legalCorpusMonitoring`, `legalCorpusRetrieval`, `legalCorpusValidation`) 352/352 unchanged; `tsc --noEmit` zero errors; `npm run build` passed (existing large-chunk warning only, unchanged from prior gates); full one-worker whole-project suite (`vitest run --maxWorkers=1`) RUN: **1370/1370 passed across 48 test files** (up from 1354/47 — the 16 new 9D-3 tests, 0 regressions).

**Known limitations:** no single-result detail route; candidates are fetched as one matter-scoped list and joined to results client-side by `candidateId` (matches the granularity the frozen services already expose — no new per-candidate route was added); review UI reuses the pre-existing six-value vocabulary from the Stage 7C review UI as-is rather than defining research-specific labels, since `review_state` has no DB-level canonical list to consult and inventing new values was avoided; `stalenessCheckedAt` is displayed nowhere new (out of scope, matches 9D-2b's own note).

**Deferred to 9D-4 (explicitly not started):** any wiring of `navigator_matter_research_work_product_links`, promotion of a reviewed research result into a case brief/work product, or any other work-product integration.

**Milestone status: 9D-3 IMPLEMENTED — AWAITING INDEPENDENT REVIEW.** Stage 9A, 9B, 9C, 9D-1, 9D-2a and 9D-2b remain independently frozen/closed exactly as recorded above; neither `api/services/matterLegalDiscovery.ts` nor `api/matterLegalDiscoveryRoutes.ts` was modified. Stage 9D as a whole is **not** complete; 9D-4 (work-product integration) remains to be implemented.
