# Corrected Migration Sequence (Priority 4)

Status: **proposed, tested on disposable PostgreSQL 16 only.** No migration was applied to any database. No owner-frozen file was changed. Replaces the sequence in `MIGRATION_READINESS_PHASE6.md` section 6.

## Sequence

Files marked **frozen** are unchanged from `supabase/migrations_pending_approval/`. Files marked **proposal** or **patch** live under `supabase/proposals/`.

| # | File | Status | Depends on |
|---|---|---|---|
| 1 | `create_accounts_foundation.sql` | frozen | none |
| 2 | `create_navigator_case_ownership_foundation.sql` | frozen | 1 |
| 3 | `create_navigator_matters_foundation.sql` | frozen | 1, 2 |
| 4 | `read_navigator_owned_matter.sql` | frozen | 3 (not exercised by the tests below) |
| 5 | `create_professional_reviews.sql` | frozen | 1, 3 |
| 6 | `phase7b_reconciled_evidence_foundation.sql` | frozen | 3 |
| 7 | `evidence_schema_additive_v1.sql` | **proposal** | 6. **Replaces** `create_navigator_page_evidence_foundation.sql`, which must not be applied. |
| 8 | `phase7b_reconciled_event_foundation.sql` | frozen | 3 |
| 9 | `phase7b_reconciled_legal_authority_foundation.sql` | frozen | 3 |
| 10 | `phase7b_reconciled_legal_corpus_versioning.sql` | frozen | 1, 9 |
| 11 | `phase7b_reconciled_stage9b_candidates.sql` | frozen | 6, 8, 9 |
| 12 | `phase7b_reconciled_professional_work_product_versions.sql` | frozen | 1, 3 |
| 13 | `phase7b_reconciled_stage9d_research.sql` | frozen | 5, 11 (alters `professional_reviews`) |
| 14 | `create_professional_profiles.sql` | frozen | 1 |
| 15 | `create_lawyer_directory_foundation.sql` | frozen | 14. **Must run after 14**, though it sorts earlier alphabetically. |
| 16 | `create_navigator_matter_access_grants.sql` | frozen | 1, 3 |
| 17 | `create_navigator_matter_access_event_log.sql` | frozen | 3 |
| 18 | `remediate_navigator_matter_access_grants_lifecycle.sql` **+ `supabase/proposals/remediate_replay_safety.patch`** | frozen + **patch** | 16. The patch changes two `create function` statements to `create or replace function`. |
| 19 | `create_navigator_matter_access_lifecycle_audit_v3.sql` | frozen | 18 (raises `PREREQUISITE_MISSING` otherwise) |
| 20 | `create_navigator_matter_access_lifecycle_recipient_v4.sql` | frozen | 19 |
| 21 | `create_navigator_paid_sessions.sql` | frozen | `access_codes` (exists in production; not created by this sequence) |
| 22 | `create_paid_access_credit_ledger_and_enforcement.sql` | frozen | 21, `payments` (exists in production; not created by this sequence). Alters `payments`. |

Not in this sequence, and not tested: `enable_rls_free_usage_gmail_stale.sql` and `expand_tier_constraints_for_analyzer_and_community.sql`. Both change existing production tables. They need their own review.

## Why the order differs from the directory

Alphabetical order fails in three places:

- `create_lawyer_directory_foundation.sql` (15) needs `professional_profiles` (14). Alphabetically "l" sorts before "p".
- `remediate_...` (18) must run after `create_navigator_matter_access_grants.sql` (16) and `event_log` (17). `v3` (19) raises `PREREQUISITE_MISSING` unless 18 has already run.
- `phase7b_reconciled_stage9d_research.sql` (13) alters `professional_reviews`, which must already exist.

## Replay defects (Priority 4 items)

Both defects were reproduced on PostgreSQL 16 before the patch.

1. `remediate_navigator_matter_access_grants_lifecycle.sql`, line 134: `create function public.revoke_matter_grant(...)`. v3 already defines that signature. Re-running the file fails with `function "revoke_matter_grant" already exists`.
2. Same file, line 225: `create function public.navigator_matter_access_lifecycle_contract()`. The same failure mode.

The fix is `supabase/proposals/remediate_replay_safety.patch`, two lines, changed to `create or replace function`. The patch was verified by:

- applying it with `patch -o` to a copy of the frozen file (the frozen file is unchanged, as `git apply --check` confirms);
- applying the full chain in order, with the patched copy at step 18: all OK;
- replaying the patched file on the fully migrated database: OK;
- replaying the **unpatched** frozen file on that database: FAIL (expected, confirms the defect);
- replaying `v4` on the migrated database: FAIL. v3 and v4 are not replay-safe, by design. They run once. This patch does not change that.

## Test results (PostgreSQL 16, UTF-8, disposable databases)

| Test | Result |
|---|---|
| Steps 1–20 in order on one fresh database | **20 of 20 OK** |
| Steps 21–22 with stub `access_codes` and `payments` matching production columns (payments populated with 2 rows, as in production) | **OK** |
| `evidence_schema_additive_v1.test.sql` (12 expectations) | **12 PASS** |
| Proposal re-applied on a populated database (7B evidence row inserted) | **Refused: `NOT_EMPTY`** |
| Replay of patched remediation on a fully migrated database | OK |
| Replay of frozen remediation on a fully migrated database | FAIL (expected) |

Stubs are not production. `access_codes` and `payments` were created locally with production column names and types. Their constraints, defaults, and indexes were not copied. The two stubbed steps need a real verification against a disposable Supabase branch before approval.

## Production state (read-only, at audit time)

Production already contains: `accounts`, `access_codes`, `cases`, `clients`, `navigator_cases`, `navigator_matters`, `navigator_matter_access_grants`, `navigator_matter_access_events`, `navigator_paid_sessions`, `navigator_documents`, `navigator_document_versions`, and the matter-access functions in their final state.

Production does **not** contain: `navigator_evidence_items`, `navigator_document_pages`, `navigator_extraction_runs`, `navigator_events`, any `navigator_legal_*` table, `navigator_matter_legal_research_candidates`, `navigator_matter_research_*`, `professional_profiles`, `professional_reviews`, or `professional_work_product_versions`.

So applying this sequence to production would skip steps already present, and would need a diff against the live schema first. Production navigator tables had 0 matter, document, and version rows. Production `payments` had 2 rows and `access_codes` had 1.

## Rollback

- No file has a down script. Writing one per file is required before any production application.
- The additive proposal (step 7) can be rolled back only while its new tables and columns are empty. The test file shows the guard.
- The patch changes no behaviour, only replay safety. Rolling it back means reverting the patch.

## Not done

- Not run on a Supabase branch, so the RLS behaviour under real `anon` and `authenticated` JWTs is untested.
- The `.pg.test.ts` database suites are not run against this sequence.
- Not reviewed for the source-operation RPC (`navigator_source_operation`), which is not ported.
