# Staging Readiness Report

Branch `feat/staging-readiness` (new draft PR, stacked on #79). Verdict at the end.

**Scope of this report:** code, SQL proposals, and tests in this repository, verified in this session. Production was read but not changed. No migration was applied to any database. No production feature flag was enabled. Nothing was merged or deployed.

## 1. Integration matrix

| PR | Branch | Head | Base | Contents | Integration status |
|---|---|---|---|---|---|
| #69 | `feat/court-record-classification-cost-scrub` | `6577c44` | `main` | Metadata allowlist, cost and model redaction, court-record classification | Not in the stacked chain on its own. Integrated via #78 with one conflict resolved (import block). Integrated file set equals #69's. |
| #70 | `feat/parent-report-experience` | `bb163b1` | `main` | Parent presentation layer | Based on `main`, not #69. Non-conflicting with #78's chain. |
| #71 | `feat/parent-rights-module` | `46be506` | #70 | Parental rights module | Linear ancestry verified. |
| #72 | `feat/report-contract-v2` | `129be8c` | #71 | Report contract, 16 sections | Linear. |
| #73 | `feat/report-sections-ui` | `350fcda` | #72 | Sections UI behind flag | Linear. |
| #74 | `feat/phase3-analysis` | `808c33a` | #73 | Analysis intelligence | Linear. |
| #75 | `feat/court-prep-workspace` | `73ff4ce` | #74 | Court-prep workspace | Linear. |
| #76 | `feat/parent-professional-experience` | `0df61f5` | #75 | Parent and professional UI, Q&A, account state | Linear. |
| #77 | `feat/release-audit` | `ff5ae2d` | #76 | Section 6 fix, audit docs | Linear. |
| #78 | `feat/integrate-69-chain` | `1a2797a` | #77 | PR #69 merged in | Typecheck, tests and build verified. |
| #79 | `feat/post-audit-remediation` | `61b0595` | #78 | Exposure check, evidence proposal v1, replay patch, matrix | Verified. |
| #80 | `feat/staging-readiness` | (this PR) | #79 | Evidence pipeline v2, revoke proposal, tests, this report | See PR. |

Every branch in the chain contains all earlier branches (ancestry verified). The full suite was run on the chain head, not per PR.

## 2. Evidence pipeline

| Requirement | Status | Where | Verification |
|---|---|---|---|
| `navigator_source_operation` | **Ported verbatim** into an additive proposal | `supabase/proposals/evidence_pipeline_additive_v2.sql` | Copied byte-for-byte from the original (`diff` against the source lines), applied on PostgreSQL 16, 8 expectations pass |
| Document and version guards | **Ported verbatim** (document and version triggers only) | same | Expectations 6 and 7 pass (identity and content hash immutable) |
| Extraction-run and page provenance | Tables, keys, guards | `evidence_schema_additive_v1.sql` | Expectations 9 and 11 pass |
| Exact quote validation | Verbatim helper functions, run on every evidence insert | v1 | Expectations 1–4 pass (valid, unsupported, fabricated, wrong offsets) |
| Cross-matter isolation | Same-matter composite keys; ownership check in the RPC | v1, v2 | v1 expectations 5, 6; v2 expectations 2, 3 pass |
| Immutable evidence | Provenance immutable; review state may change | v1 | v1 expectations 7, 8 pass |
| Analyzer integration | Runtime wiring: `documentRoutes.ts` → `documentSources.ts` → RPC | existing code | Unit tests mock the RPC. The RPC itself is exercised only by the database tests. **Not run against live Gemini OCR.** |

**Hard prerequisite:** the upload route calls the RPC. On any database where v2 is not applied, the upload route fails at runtime. This is a staging gate, not a code gap.

**Preserved:** nothing is dropped or replaced. The original page-evidence file is not modified. Guards that the proposals do not port (for pages, runs and evidence) are re-implemented in v1 and tested. Original ownership checks are unchanged.

## 3. Security

| # | Finding | Severity | Status | Evidence |
|---|---|---|---|---|
| S-1 | `anon` and `authenticated` hold **all seven table privileges** on 20 public tables, including **TRUNCATE**, which RLS does not restrict | **P0** | Proposal: `supabase/proposals/revoke_api_role_grants.sql`, rollback, test. Not applied. | Read-only snapshot of `information_schema.role_table_grants`. Test: 4 checks pass on a disposable database. |
| S-2 | `document_walkthroughs`: 3 rows readable by `anon` | P3 | Kept as intended public content, pending owner confirmation | `AUDIT.md` describes it as static reference content. The table has no user column. A count-only check found no email, phone or case-number patterns. No row contents were printed. Nothing in `api`, `shared` or `src` reads the table. |
| S-3 | RLS policies use `auth.uid()`, but Supabase Auth has 0 users | P2 | Documented; no change proposed without owner decision | Read-only count |
| S-4 | `lawyer_profiles` has a public read policy (approved and active) | P2 | Review fields before first approval | Policy text |
| S-5 | SECURITY DEFINER functions without `search_path` in historical files | P1 | Closed for production: every SECURITY DEFINER function in production has `search_path=public, pg_temp`. Historical files are superseded in the chain. | `pg_proc` read-only check |
| S-6 | Matter-access remediation is not replay-safe | P1 | Patch: `supabase/proposals/remediate_replay_safety.patch`. Verified on PostgreSQL 16. | Replay test |
| S-7 | Production `payments` and `access_codes` have TRUNCATE and write grants for API roles | P0 (part of S-1) | Covered by S-1 | Snapshot |

Not reviewed in this session: authorization logic inside every SECURITY DEFINER body; Firebase token verification on each route; rate limits; retention and deletion.

## 4. Database test results

All run on PostgreSQL 16, UTF-8, on disposable databases. Supabase roles were simulated (`anon`, `authenticated`, `service_role`). Stub tables were used only in the revoke test.

| Suite | Result |
|---|---|
| Ordered chain (21 steps, remediation patched) on a fresh database | **21 of 21 OK** |
| `evidence_schema_additive_v1.test.sql` | **12 of 12 PASS** |
| `evidence_pipeline_additive_v2.test.sql` | **8 of 8 PASS** |
| `revoke_api_role_grants.test.sh` (before, after revoke, after rollback) | **ALL PASS** |
| Replay: patched remediation OK; unpatched remediation FAIL (expected); v4 FAIL (expected) | As expected |
| Repository `*.pg.test.ts` database suites, with `NAVIGATOR_PG_TEST_ADMIN_URL` on local PostgreSQL | **Enabled, passing.** They build their own databases from the migration files. |

Before enabling the local database, 444 tests were skipped. With it enabled, the skipped count falls to 102, all in official-form artifact suites (see section 6).

## 5. Analyzer verification

| Area | Test evidence | Live AI run? |
|---|---|---|
| Quick Review report generation | `analyzerEndToEnd`, `analyzerRealPdfE2E` (mocked provider, real PDF bytes) | **No** |
| Forensic Deep Scan report generation | Forensic route and pipeline tests (mocked provider) | **No** |
| All 16 report sections | `reportContract.test.ts` (32 tests), `reportSections.test.ts`, and the Section 6 matrix (this session) | No |
| Evidence citations | Quote validation tests (v1 proposal, and existing `pageSources` tests) | No |
| Court-order classification | `courtRecordClassification.test.ts`, `reportContract` tests | No |
| Missing-record classification | `reportContract` tests (missing referenced records → S08) | No |
| User permissions | Route tests with mocked access layer | No |
| Credit consumption | `creditAccounting.test.ts` | No |
| Error recovery | `analyzerErrors.providerFailure.test.ts` | No |

**No live AI test was run. No claim of live analyzer success is made.**

## 6. Remaining external dependencies

| Item | Needed for | Owner action or access |
|---|---|---|
| Isolated Supabase staging branch with JWT-minting RLS tests | RLS and JWT verification (beyond PG16) | Authorize a branch. A staging project exists (`cyfsa-navigator-staging`), but no write authorization for it is recorded in this session. Not used. |
| Official form artifacts (102 tests) | Official-form semantic and real-artifact tests | Supply the artifacts. Not fetchable from this environment. |
| Live model keys and approved spend | Live Quick Review, Forensic Deep Scan, Gemini OCR | Owner approval for staging test budget |
| Firebase test accounts | Authenticated end-to-end flows | Owner provisioning |
| Vercel preview with staging backend | Browser, mobile, accessibility, exports | Owner approval |
| Legal-services review | Parental rights wording, court-prep and Q&A content | External reviewer |

## 7. Priority status

| Priority | Item | Status |
|---|---|---|
| P0 | S-1 anon TRUNCATE and write grants on 20 tables | Proposed, tested. **Owner approval required.** |
| P0 | Evidence pipeline (RPC, guards) missing from schema | Proposed (v2), tested. Staging gate. |
| P0 | Evidence schema (7B table lacks runtime columns) | Proposed (v1), tested. |
| P0 | Chain integration of #69 | Done (#78). |
| P1 | Remediation replay defects | Patched (proposal), tested |
| P1 | Live analyzer verification | **Not done** (external) |
| P1 | Authenticated and browser E2E | **Not done** (external) |
| P1 | Staging RLS and JWT tests | **Not done** (external) |
| P2 | Auth-dependent policies inert | Documented |
| P2 | `lawyer_profiles` public read policy | Documented |
| P2 | v3 and v4 not replay-safe | Documented; they run once |
| P3 | `document_walkthroughs` anon read | Intended, pending confirmation |

## 8. Exact staging release sequence

Nothing here runs without owner approval. Each step is for a non-production environment.

1. **Approvals:** staging branch authorization; approval of the v2 pipeline and S-1 revoke proposals; approval of the replay patch; model-spend budget.
2. **Staging database, in order:** the 21-step chain, with the patched remediation; then `evidence_schema_additive_v1.sql`; then `read_navigator_owned_matter.sql` (already in the chain); then `evidence_pipeline_additive_v2.sql`. Do not apply `create_navigator_page_evidence_foundation.sql`.
3. **Staging security:** apply `revoke_api_role_grants.sql`. Verify with the same privilege checks used in the test.
4. **Staging tests:** RLS and JWT integration tests on the staging branch (to be written). Repository database suites run against a local database, as they require it.
5. **Staging application:** deploy a Vercel preview pointing at the staging database. Run a live Quick Review and Forensic Deep Scan with a test document under the approved budget. Record results.
6. **Feature flags:** enable `VITE_REPORT_SECTIONS_UI`, `VITE_COURT_PREP_UI`, and `VITE_PARENT_QA_UI` in the **preview environment only**, after step 5.
7. **Production:** not covered by this report. Requires a separate owner decision, a production-state diff, and a rollback plan for each step.

## 9. Go / No-Go

**NO-GO for staging today.**

Blocking reasons, in order:

1. The S-1 grants are still in place on production (proposal only). This is not a staging blocker, but it needs an owner decision.
2. The staging database does not exist in the required state: no staging branch is authorized, and the v2 pipeline is not applied anywhere except the local scratch database.
3. No live analyzer run has been performed. Live AI behaviour is unverified.
4. No authenticated or browser test has been run.

**GO for staging when:** items 2–4 above are resolved, and the owner has approved the proposals in section 8, step 1.

**Not a blocker for staging:** the 102 official-form artifact tests. They are skipped for a reason that cannot be fixed here, and they do not gate the analyzer pipeline.

## 10. Owner approvals required

1. Authorize an isolated Supabase staging branch for write and JWT tests.
2. Approve `evidence_pipeline_additive_v2.sql` (ported source operation and guards) as the upload path.
3. Approve `revoke_api_role_grants.sql` for production (S-1). Confirm `document_walkthroughs` should remain publicly readable.
4. Approve applying `remediate_replay_safety.patch` to the frozen remediation file.
5. Approve a model-spend budget for live staging analyzer tests.
6. Provide official form artifacts, or accept that those 102 tests remain skipped.
