# P0/P1 Remediation Matrix (Priority 5)

Post-audit state. Production is still **NO-GO**. Nothing is merged, deployed, activated, or applied to any database.

Fix status key:
- **Code fix**: committed, tests run in this branch.
- **Proposal**: SQL or patch prepared and tested on disposable PostgreSQL. Not applied.
- **External**: needs access this session does not have.
- **Owner**: needs your approval.

## P0

| ID | Defect | Evidence | Affected feature | Fix status | Test results | Remaining dependency | Production risk |
|---|---|---|---|---|---|---|---|
| P0-1 | Evidence schema cannot support the runtime. The 7B table lacks the page, quote, and review columns. `navigator_document_pages` and `navigator_extraction_runs` are missing. | `phase7b_reconciled_evidence_foundation.sql` has 4 columns. Runtime reads `exact_quote`, `page_id`, `page_number`, `normalized_statement`, `quote_verification`, `review_state` in 7–14 files each. Verified on PG16. | Page-evidence quotes, evidence review, professional workspace | **Proposal**: `supabase/proposals/evidence_schema_additive_v1.sql` (additive) | Test file: **12 of 12 PASS** on PG16. Populated-table guard: `NOT_EMPTY` verified. | **Owner**: approve the schema (legal-provenance fields). **Code**: port `navigator_source_operation` and the document and version guards (separate review). | High if the 7B file is applied as-is: evidence features fail at runtime. No production impact today: the table is absent in production. |
| P0-2 | PR #69 is not in the release chain. Its analyzer changes (metadata allowlist, cost redaction, court-record classification) are missing from the stack. | Two-dot diff: #70 is based on `main`. Merge conflict in `DocumentAnalyzerTab.tsx` (import block). | Analyzer output, customer metadata, court-record handling | **Code fix**: integrated on `feat/integrate-69-chain` (PR #78). Conflict resolved by keeping both sides. Integrated file set equals PR #69's file set. | **3,023 pass, 444 skipped**; typecheck clean; build exit 0. | **Owner**: decide whether #69 merges into #70 or #77 (branch-history choice). | Medium: the chain ships without the redaction and allowlist changes unless #78 is part of it. |
| P0-3 | 20 public tables are GraphQL-visible to `anon` (and `authenticated`). Row-level exposure: 1 table. | Advisor, current: `pg_graphql_anon_table_exposed` (20) and `pg_graphql_authenticated_table_exposed` (20). Row test under `set local role anon`: `document_walkthroughs` returns 3 rows. Others return 0 rows, and RLS hides the owner's rows in `access_codes`, `payments`, `free_usage`, `cyfsa_300rule_access_codes`. | Database API surface; `document_walkthroughs` content | **Proposal**: `docs/SECURITY_EXPOSURE_VERIFICATION.md` (revoke SQL). Not applied. | Verified read-only in production. Revoke not tested (table definitions not in repo). | **Owner**: approve revoke; confirm `document_walkthroughs` is public; confirm no external anon-key consumer. **External**: none for the revoke itself. | Medium now (1 table readable; others latent). High if RLS policies are relaxed or Supabase Auth is adopted without review. |
| P0-4 | Production schema is not reproducible from the repo. Documents disagree about which tables are live. | Read-only check: `navigator_matter_access_*` and `accounts`, `access_codes`, `cases` exist. Evidence, legal, research, professional tables are absent. | Migration planning for every feature | **Code**: corrected sequence and drift list in `docs/MIGRATION_SEQUENCE_CORRECTED.md`. | Sequence: 20 of 20 steps OK on PG16; stubs for two production-only tables. | **External**: a full schema diff against production needs a read-only dump (owner-approved). | Medium: blind migrations could fail or duplicate objects. |

## P1

| ID | Defect | Evidence | Affected feature | Fix status | Test results | Remaining dependency | Production risk |
|---|---|---|---|---|---|---|---|
| P1-1 | Remediation file is not replay-safe: `create function` for `revoke_matter_grant` and `navigator_matter_access_lifecycle_contract`. | Reproduced on PG16: replay fails with `already exists`. | Matter-access migrations (fresh environments only) | **Proposal**: `supabase/proposals/remediate_replay_safety.patch` (two lines). Frozen file untouched. | Patched replay OK; frozen replay FAIL (expected). Full chain 20 of 20 OK with the patch. | **Owner**: approve applying the patch to the frozen file. | Low: production already has the final functions. Matters for staging and disposable environments. |
| P1-2 | Migrations v3 and v4 are not replay-safe (`create function`). | Replay of v4 fails on PG16. | Matter-access migrations | **Not fixed.** Documented; by design they run once. | v4 replay: FAIL (expected). | **Owner**: decide whether replay safety is needed. | Low. |
| P1-3 | Section 6 status and note disagreed with the analyzer's evidence-strength score. | Test failure before fix: note said "no score" while the score was 47 and 30. | Report section 6 | **Code fix**: committed (`217998b`). | 41 tests in `reportContract.test.ts` pass. Full suite passed. | None. | Low (fixed). |
| P1-4 | SECURITY DEFINER functions without `search_path` in historical files. | Pending files: `create_navigator_matter_access_grants.sql` `accept_matter_grant` and v3 `create_matter_grant` lack it. | Matter-access authorization | Production: **verified** every listed SECURITY DEFINER function has `search_path=public, pg_temp` (read-only `pg_proc` check). Historical files are superseded in the chain. | Chain replay tested. | **Owner**: confirm the historical file is never run alone. | Low for production. |
| P1-5 | `document_walkthroughs` rows readable by `anon`. | Row test: 3 rows. Policy `walkthroughs_public` is `USING (true)`. | Walkthrough content | **Proposal** only (see P0-3). | Verified. | **Owner**: confirm intent. | Low (educational content, if confirmed public). |
| P1-6 | Supabase Auth policies are dead code; the app uses Firebase. | Supabase Auth users = 0. `auth.uid()` is NULL for all requests. | Access model clarity | **Not fixed.** | Verified. | **Owner**: keep or remove the policies. | Low today; a future Supabase Auth rollout would activate them without review. |
| P1-7 | Analyzer has never run live in this audit. | No model key or test account here. | Quick Review, Forensic Deep Scan | **External**. | None. | **External**: staging run with a test account and real model calls. | High until verified. |
| P1-8 | No authenticated end-to-end flow tested (Firebase sign-in, matter creation, grant acceptance). | Database suites are skipped without `ADMIN_URL`. | Parent and professional flows | **External**. | 444 tests skipped (not passing). | **External**: a staging environment with `ADMIN_URL`. | High until verified. |
| P1-9 | No browser, mobile, or accessibility testing. | Only jsdom and static checks. | All UI, exports | **External**. | None. | **External**: Vercel preview and browser run. | Medium. |
| P1-10 | Upload path (`navigator_source_operation`) not ported. | Grep: referenced in the original page-evidence file only. | Document upload | **Code**: not started. | None. | **Owner**: decide whether to port now or keep upload disabled. | High if upload is enabled without it. |

## Counts

- P0 items: 4. Code-fixed: 1 (P0-2, integration). Proposal: 2 (P0-1 evidence schema, P0-3 revoke SQL). Code artifact plus external: 1 (P0-4, corrected sequence done, schema diff needs owner approval).
- P1 items: 10. Code-fixed: 2 (P1-3, P1-4 verified). Proposal: 2 (P1-1, P1-5). Not fixed: 3 (P1-2, P1-6, P1-10). External: 3 (P1-7, P1-8, P1-9).

## Test results (this branch and this session)

| Suite | Result |
|---|---|
| `tsc --noEmit` | clean |
| `vitest run` (`feat/integrate-69-chain`) | 159 files passed, 9 skipped; **3,023 tests passed, 444 skipped** |
| `npm run build` | exit 0 |
| Evidence proposal test file (PG16) | 12 of 12 PASS |
| Full corrected sequence (PG16) | 20 of 20 OK; steps 21–22 OK with production-column stubs |
| Replay: patched remediation / frozen remediation / v4 | OK / FAIL (expected) / FAIL (expected) |
| Read-only production checks | Exposure verified; table and function state verified; anon row visibility verified |

Skipped tests: 444. Not passing. Database suites (`*.pg.test.ts` and the matter-access suites) are skipped unless `ADMIN_URL` is set. Official-form artifact suites are skipped unless the real artifacts are present.

## What this does not establish

- Production is not ready. No production behaviour is verified end to end.
- PG16 tests are not Supabase tests. RLS under real JWTs is untested.
- The 444 skipped tests have never run in this branch.
- Stubs for `access_codes` and `payments` are not production copies.

## Owner decisions, in order

1. Approve the evidence schema proposal (P0-1). Decide whether upload stays disabled until `navigator_source_operation` is ported (P1-10).
2. Decide how PR #69 joins the chain (P0-2).
3. Approve or amend the public-table revoke (P0-3), and confirm `document_walkthroughs` intent.
4. Approve a read-only full schema diff against production (P0-4).
5. Approve the replay patch for the frozen file (P1-1).
6. Decide on Supabase Auth policies (P1-6).
