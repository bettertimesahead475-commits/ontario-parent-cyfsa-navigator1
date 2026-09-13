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
Begin with the review workspace. These are roadmap objectives, not claims of existing implementation or blanket permission to implement all of Stage 5.

## 9. Future Roadmap

| Stage | Objective |
|---|---|
| 5 | Matter Intelligence |
| 6 | CYFSA Legal Intelligence and Authority Mapping |
| 7 | Professional Lawyer Review Workspace |
| 8 | Litigation Work Product |
| 9 | Advanced Case-Wide Retrieval / RAG |
| 10 | Firm Collaboration / Permissions / Audit |
| 11 | Benchmarking / QA / Release Hardening |

## 10. Current Technical Debt / Known Limitations

Firebase HTTP integration is not fully validated. Dependency advisories remain. Account-wide serialization favors correctness over throughput. Evidence aggregation is unpaginated. Stale evidence-run maintenance is outstanding. OCR metadata records configured fallback models rather than observed provider revisions. Duplicate evidence analysis requests can create separate runs. Completed immutable disposable fixtures remain intentionally retained (inventory in the closeout). No full contradiction engine, persisted matter-wide chronology engine or legal mapper exists. Existing legacy timeline/RAG features do not constitute those future engines.

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

## 12. Next Task

NEXT STAGE: **Stage 5**.
NEXT TASK: **Design and implement the matter-scoped Evidence Review workspace as the first Stage 5 feature.**
Do not begin Stage 5 automatically. Inspect existing endpoints first; additional database capabilities require separate review and execution authorization.

## Cross-Agent Handoff Protocol

Codex → Claude Code: commit when authorized or intentionally preserve current state; Claude reads HANDOFF.md first, inspects status/branch/HEAD, receives one scoped task, updates this handoff when milestone/architecture changes, and reports changed files, tests and final Git state.
Claude Code → Codex: use the same process. Prefer independent read-only review before the next correction round. Only one agent edits the shared checkout at a time.
Neither agent should rely on the other's conversational memory. The repository and HANDOFF.md are the source of truth. A handoff is not authorization to push, deploy or mutate a database.

## Historical handoff provenance

The previous security-split/historical audit handoff is preserved in Git at `22384a833cf7889493a0835c2b68af9726e1caf1:HANDOFF.md`. Its dated claims (including absent domain routes and no automated tests) are historical, not current status. Existing Phase 1/2 audit files remain unchanged.
