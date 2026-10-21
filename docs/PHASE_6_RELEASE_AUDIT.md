# CYFSA Navigator: Phase 6 Release Audit

Branch: `feat/release-audit` (draft PR #77, stacked on #76). Code audited at `217998b`, with migration and documentation work in the same branch.

**Verdict: NO-GO for production.** No feature is activated. No migration is applied. No production database was modified. The reasons are in section 10.

Every claim below carries a verification level:

- **[T]** unit or jsdom test ran and passed in this session
- **[S]** static reading of code or SQL, with file and line references
- **[P]** PostgreSQL 16 replay on a disposable local cluster (not Supabase)
- **[N]** not verified in this session (needs live data, live auth, or a browser)

---

## 1. Verified completed functionality

| Area | What is done | Level |
|---|---|---|
| Analyzer customer metadata | Only `engineName`, `mode`, `modeName`, `durationMs` reach the customer. Cost, model and verifier identity are stripped. | [T] PR #69 tests |
| Court-record classification | Judicial orders and endorsements are placed in S04, not treated as evidence. Missing referenced records go to S08, not S09. | [T] |
| Report contract | 16 sections (S01–S16), a legacy adapter, and a schema version. | [T] 32 tests in `reportContract.test.ts` |
| Section 6 status | Court records get NOT_APPLICABLE when no S06 findings exist. A populated section always has findings. | [T] fixed in `7924e4a`, tested |
| Section 6 note | The note names a heuristic score when the analyzer reports one. Previously it always said no score existed. | [T] fixed in `217998b`, tested |
| Parental rights | Entries are checked against the consolidated CYFSA text in the repo. Applicability is shown as "possibly relevant", with conditions not established. | [T] |
| Court-prep chronology, forms, notes | Built as pure functions with tests. Notes are page-state only. No deadline calculation. | [T] |
| Account state | Derived only from server-reported facts. | [T] |
| Educational Q&A | Answers are grounded in findings and sources, without a model. | [T] |
| Feature flags | Three UI flags: `VITE_REPORT_SECTIONS_UI`, `VITE_COURT_PREP_UI`, `VITE_PARENT_QA_UI`. Each is on only when exactly `"true"`. Defaults are off. | [S] `src/config/featureFlags.ts` |
| Type check, build | `tsc --noEmit` clean. `npm run build` exit 0. | [T] |

## 2. Incomplete functionality

- **Analyzer live runs.** Neither Quick Review (Sonnet) nor Forensic Deep Scan (Opus) was run against a model in this session. There is no API key or test account here. [N]
- **Authenticated parent and professional flows.** Firebase sign-in, matter creation, grant acceptance, and admin verification were not exercised end to end. [N]
- **Professional portal.** There is no professional workspace UI, no matter sharing, and no consent flow. The database tables for them are pending migrations. [S]
- **Section 10 and Section 11 (case law, other side's arguments).** Not produced. Notes say so honestly. [S] `reportContract.ts` notes map
- **Section 14 (forms) and Section 15 (deadlines).** Not generated. Deadlines are not calculated. [S]
- **Official sources.** e-Laws was unreachable from this environment (DNS). Parental rights text was checked against a local consolidation file, not the live source. [S]
- **Browser testing.** No browser E2E, no mobile-width check, no real PDF/HTML export check in a browser. Static and jsdom tests are not end-to-end validation. [N]
- **Accessibility.** Only static markup review. No screen-reader or keyboard run. [N]

## 3. Actual defects

| # | Defect | Status | Level |
|---|---|---|---|
| D1 | Section 6 said "populated with 0 findings" and "no score" when a score existed. | Fixed, tested | [T] |
| D2 | Reconciled evidence table lacks columns and the page table that the runtime reads. | **Open, P0** | [P][S] |
| D3 | Matter-access remediation is not replay-safe (two `create function` statements). | **Open, P1**, patch verified on a copy | [P] |
| D4 | PR #70 is based on `main`, not on #69. #69 is missing from the stack. Merging #69 into the top of the stack conflicts in `DocumentAnalyzerTab.tsx` (import block). The keep-both resolution passes typecheck and tests (3,014 pass, 444 skipped). | **Open, P0** integration | [T][S] |
| D5 | Migration sets are inconsistent with the live-verification doc: one says `navigator_matter_access_grants` exists in production, while the migrations are pending. | **Open, P0** until verified read-only | [S] |
| D6 | Repository has one applied migration. The production baseline (`accounts`, `cases`, `access_codes`) is not reproducible from the repo. | **Open, P1** | [S] |

## 4. Security vulnerabilities

| # | Finding | Severity | Status |
|---|---|---|---|
| S1 | Live-verification doc records 20 legacy public tables (`access_codes`, `cases`, `documents`, `users`, `payments`, and others) readable by the `anon` role through GraphQL/PostgREST (`pg_graphql_anon_table_exposed`). This is a documented finding, not re-checked today. | **P0 if still true** | [N] needs owner-approved read-only check |
| S2 | Eleven pending files define SECURITY DEFINER functions. Final chain sets `search_path`. Two earlier definitions do not, and are replaced later in the chain. Risk only if applied out of order. | P1 | [P][S] |
| S3 | Remediation drops and recreates `accept_matter_grant`. The drop-then-create is correct in order. | Info | [P] |
| S4 | Server-only RLS model: client policies are deny-all, service_role or security-definer RPCs only. Verified on the matter-access chain via grants and revokes in the SQL text. Not tested against a real `anon` or `authenticated` JWT. | P1 | [S][P partial] |
| S5 | Parent UI reads only page state for notes. No localStorage or sessionStorage for sensitive notes in phase files. | Info | [S] |
| S6 | Feature flags are build-time `VITE_*` values. Anyone with the build can see the flag values, which are not secrets. | Info | [S] |

Not reviewed in this session: the authorization logic inside each SECURITY DEFINER body, Firebase token verification on every route, rate limiting, and retention or deletion behaviour.

## 5. Database migration conflicts

Full detail is in `docs/MIGRATION_READINESS_PHASE6.md`.

- **Duplicate tables:** 10 tables are defined by two files each. Nine are resolved by choosing the `phase7b_reconciled_*` file. The evidence table has no working definition (D2).
- **Ordering:** alphabetical order fails. `create_lawyer_directory_foundation.sql` must run after `create_professional_profiles.sql`. Matter-access must run grants → event log → remediation → v3 → v4.
- **Replay:** remediation is not replay-safe. Patch verified on a copy.
- **Dependencies:** `accounts` is required first. `access_codes` is referenced by paid sessions but defined nowhere in the repo. `navigator_cases` and the legacy `cases` table overlap in concept.

## 6. Test evidence and limitations

| Suite | Result | Notes |
|---|---|---|
| `tsc --noEmit` | Pass | [T] |
| `vitest run` (branch at `217998b`) | 157 files passed, 9 skipped; **3,008 tests passed, 444 skipped** | [T] |
| `npm run build` | Exit 0 | [T] |
| Stack integration (#69 merged into #77, scratch worktree) | 1 conflict, resolved by keeping both import blocks. Then 159 files passed, 9 skipped; **3,014 tests passed, 444 skipped**. | [T] not committed |
| PostgreSQL 16 replay | Phase 7B reconciled chain applies cleanly. Matter-access chain applies cleanly in the correct order. Replay of remediation fails before the patch and succeeds after it. | [P] |

**The 444 skipped tests, explicitly:** they are not passing. Two causes:

- Database suites (`*.pg.test.ts`, the `matterAccess*` suites, and `professionalMatterAccess*`): `describe.skip` unless `ADMIN_URL` (or the equivalent database variable) is set. They have never run in this session or in CI.
- Official-form artifact suites (`form*SemanticFieldMap`, `officialFormRealArtifactIntegration`, `docxFieldInventoryRealArtifacts`): skipped unless the real form artifacts are present.

Passing unit tests are not proof of production behaviour. The database suites have never run against a database in this branch.

## 7. P0 / P1 / P2 / P3 remediation priorities

**P0 (blocks any production or staging activation)**

1. Author an owner-approved `navigator_evidence_items` and `navigator_document_pages` schema that keeps the runtime columns (D2).
2. Integrate #69: merge it into the stack, or rebase #70 on it, and resolve the `DocumentAnalyzerTab.tsx` import conflict (D4).
3. Read-only production check of anon-readable legacy tables and of whether `navigator_matter_access_*` exists (S1, D5). Owner-approved.

**P1 (blocks any migration approval)**

4. Approve the two-line remediation patch, or restate it (D3).
5. Replay the full approved sequence on a disposable Supabase branch and run the `.pg.test.ts` suites there (section 7 of the migration document).
6. Analyzer end-to-end on staging with a test account and a real model call, including a check that cost fields do not leak.
7. Browser E2E on a Vercel preview: parent report view, court-prep flow, Q&A, export buttons, mobile width.

**P2**

8. Confirm each SECURITY DEFINER body's authorization logic and grant behaviour (S2, S4).
9. Resolve the `cases` and `navigator_cases` overlap, and document the production baseline in the repo (D6).
10. Accessibility run with keyboard and a screen reader.

**P3**

11. Remove the superseded `create_navigator_matter_access_grants` accept function from the chain documentation, or label it clearly as historical.
12. Consolidate the stage and phase docs into one index.

## 8. Safe PR integration order

The stack, verified by ancestry and base refs:

| PR | Head | Base | Status |
|---|---|---|---|
| #69 | `6577c44` | `main` | **Not in the stack.** Merge into #70 or into #77 before anything else (D4). |
| #70 | `bb163b1` | `main` | Based on `main`, not #69. |
| #71 to #77 | linear | previous PR | Ancestry verified. |

Recommended order: resolve D4 first, then #69 → #70 → #71 → #72 → #73 → #74 → #75 → #76 → #77. Merge each only after its checks are green and the owner approves. Nothing has been merged.

## 9. Feature-flag activation requirements

| Flag | Gates | Required before enabling |
|---|---|---|
| `VITE_REPORT_SECTIONS_UI` | 16-section report | Integrated stack (D4). Browser test on preview. Copy review. Accessibility pass. |
| `VITE_COURT_PREP_UI` | Court-prep workspace | Same, plus a check of form and deadline wording by legal-services review. |
| `VITE_PARENT_QA_UI` | Educational Q&A | Same, plus a review that Q&A stays within the grounded sources. |
| (none yet) | Professional portal | Not built. Needs the evidence schema (P0 1), the migrations (section 5), and owner approval. |

All three stay off. Turning any on is an owner decision.

## 10. Production go/no-go

**NO-GO.**

Blocking reasons:

1. The evidence schema cannot support the runtime (D2, P0).
2. #69 is not integrated with the stack (D4, P0).
3. Production state is unknown and possibly exposed (S1, D5, P0).
4. No migration has run against a real database, and the remediation patch is unapproved (D3).
5. The analyzer has not been run live, and no authenticated flow has been tested (section 2).
6. No browser, mobile, or accessibility test has been run (section 2).

What would change this to GO: the P0 items above resolved, the P1 migration sequence replayed on a disposable branch with the database suites passing, an analyzer and authenticated end-to-end run on staging, and owner approval of each flag and migration.

## Exact owner decisions needed

1. Approve bringing #69 into the stack, and how: merge it into #70, or into #77.
2. Approve drafting the evidence schema (P0 1). Legal-provenance fields need your review.
3. Approve the two-line remediation patch in `remediate_navigator_matter_access_grants_lifecycle.sql` (lines 134 and 225). The file is part of the frozen set, so this needs your sign-off.
4. Authorise a read-only check of production, covering anon-readable tables and the existence of `accounts`, `access_codes`, `cases`, and `navigator_matter_access_*`.
5. Decide whether #77 should be marked ready for review. It is still a draft.
