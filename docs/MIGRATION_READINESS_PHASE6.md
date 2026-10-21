# Pending Migration Readiness (Phase 6, corrected)

Status: **Not ready to apply.** Nothing was applied. The production database was not accessed. Verification used a disposable local PostgreSQL 16 cluster (scratch databases `replay_b` through `replay_f`, Supabase roles `anon`, `authenticated`, `service_role` simulated). That cluster has no Supabase auth schema, no Supabase-managed roles beyond those three, and no production data.

This replaces the earlier draft of this file. Items that the earlier draft left open are now resolved, or are listed below as blockers.

## 1. Duplicate table definitions: resolved by comparison

Seven `phase7b_reconciled_*` files duplicate tables that the `create_navigator_*` and `create_professional_work_product_versions.sql` files also create. The Phase 7B1 design (`INTEGRATION_PHASE_7B1_MIGRATION_DESIGN.md`) and Phase 7A plan (`INTEGRATION_PHASE_7A_DATABASE_REMEDIATION_PLAN.md`) both name the reconciled files as the replacements, and list the originals under "DO NOT DEPLOY AS-IS".

| Table | Authoritative file | Evidence |
|---|---|---|
| navigator_events | `phase7b_reconciled_event_foundation.sql` | Adds the date-range CHECK and `UNIQUE(id, matter_id)`. Applies cleanly on PG16. |
| navigator_legal_sources, _source_versions, _provisions | `phase7b_reconciled_legal_authority_foundation.sql` | Keeps composite co-ownership keys. Applies cleanly on PG16. |
| navigator_legal_provision_versions | `phase7b_reconciled_legal_corpus_versioning.sql` | Adds `UNIQUE(provision_id, legal_source_version_id)` and SHA-256 check. Applies cleanly on PG16. |
| navigator_matter_legal_research_candidates | `phase7b_reconciled_stage9b_candidates.sql` | Same-matter FKs for evidence and events. Applies cleanly on PG16. |
| navigator_matter_research_runs, _run_results; professional_reviews check | `phase7b_reconciled_stage9d_research.sql` | Applies cleanly on PG16 after `create_professional_reviews.sql`. |
| professional_work_product_versions | `phase7b_reconciled_professional_work_product_versions.sql` | Adds explicit transaction and server-only grants. |
| **navigator_evidence_items** | **None. Blocker.** | See section 2. |

Verified on PG16: applying the originals and the reconciled files in one database fails at whichever comes second, with `relation already exists`.

## 2. P0 blocker: the reconciled evidence table cannot support the runtime

`phase7b_reconciled_evidence_foundation.sql` creates `navigator_evidence_items` with four columns (`id`, `matter_id`, `classification`, timestamps). The runtime reads and writes far more. Verified on PG16 after applying the reconciled chain:

- Missing: `exact_quote`, `page_id`, `page_number`, `normalized_statement`, `document_id`, `quote_verification`, `review_state`.
- Missing table: `navigator_document_pages`. It is created only in `create_navigator_page_evidence_foundation.sql`, which Phase 7A marks "DO NOT DEPLOY AS-IS".

Code that depends on these: `api/services/pageSources.ts` (quote verification, page binding), `api/services/professionalWorkspace.ts` (reads `navigator_document_pages`), `api/services/professionalOutputs.ts`, `api/services/litigationWorkProduct.ts`, `api/services/caseActionWorkspace.ts`, `shared/evidenceReview.ts`.

Consequence if the reconciled chain is applied as-is: the evidence and page-provenance features fail at runtime with missing-column errors. Nothing in the test suite catches this, because the database suites are skipped.

**Required before approval:** an owner-approved evidence schema that keeps the original page, quote and review columns, adds the reconciled `CHECK` and `UNIQUE(id, matter_id)`, and includes `navigator_document_pages` and its extraction-run link. I did not draft this file, because it is a schema decision with legal-provenance consequences.

## 3. Matter-access chain: correct order, and two non-replay-safe statements

Verified order on PG16 (all OK on a fresh database):

1. `create_accounts_foundation.sql`
2. `create_navigator_case_ownership_foundation.sql`
3. `create_navigator_matters_foundation.sql`
4. `create_navigator_matter_access_grants.sql`
5. `create_navigator_matter_access_event_log.sql`
6. `remediate_navigator_matter_access_grants_lifecycle.sql`
7. `create_navigator_matter_access_lifecycle_audit_v3.sql` (aborts with `PREREQUISITE_MISSING` if step 6 is missing)
8. `create_navigator_matter_access_lifecycle_recipient_v4.sql`

Alphabetical order is wrong. Running v3 before the remediation fails with `PREREQUISITE_MISSING`.

**Replay defect (verified):** after step 8, re-running the remediation file fails with `function "revoke_matter_grant" already exists`. The cause is line 134, `create function public.revoke_matter_grant(`, which duplicates v3's definition, and line 225, `create function public.navigator_matter_access_lifecycle_contract()`, which duplicates an earlier definition. The file is wrapped in `begin`/`commit`, so a failed replay rolls back cleanly.

**Proposed patch (not applied, because the remediation file is part of the frozen, owner-reviewed set):**

```diff
-create function public.revoke_matter_grant(
+create or replace function public.revoke_matter_grant(
...
-create function public.navigator_matter_access_lifecycle_contract()
+create or replace function public.navigator_matter_access_lifecycle_contract()
```

Verified on a scratchpad copy only: with both lines changed, the remediation applies, v3 and v4 apply after it, and a second run of the patched remediation succeeds.

## 4. Dependencies: accounts, access_codes, navigator_cases, professional_profiles

- **accounts:** defined only in `create_accounts_foundation.sql`. Referenced by 14 or more pending files. Required first. The earlier live-verification doc says it is already live; the Phase 7A live check says the seven prerequisite tables are absent. These disagree, so production state is unknown.
- **access_codes:** not defined anywhere in the repo, including the applied history (one file). `create_navigator_paid_sessions.sql` has a foreign key to it. The live-verification doc lists it as present. It must be confirmed present in production before paid-session migrations are applied.
- **navigator_cases:** created by `create_navigator_case_ownership_foundation.sql`. `create_case_ownership_foundation.sql` creates a different, legacy `cases` table and a `create_case_with_owner` function that is SECURITY INVOKER. The two files overlap in concept. The navigator version is the one the matters foundation references.
- **professional_profiles:** created by `create_professional_profiles.sql`, which depends on `accounts`. `create_lawyer_directory_foundation.sql` depends on it. The directory file must run after it.

## 5. SECURITY DEFINER functions

Eleven pending files define SECURITY DEFINER functions. Verified per function with line numbers:

- Every function in the final chain sets `search_path` (`public, pg_temp` or `pg_catalog, pg_temp`).
- `create_navigator_matter_access_grants.sql` defines `accept_matter_grant` as SECURITY DEFINER without `search_path`. It is replaced later in the chain (remediation, which sets it). This is only a risk if that file is applied alone, so it must never be run without the rest of the chain.
- `create_navigator_matter_access_lifecycle_audit_v3.sql` defines `create_matter_grant` without `search_path`. Replaced by v4 (`create or replace`, with `search_path`).
- `create_case_with_owner` is SECURITY INVOKER. The earlier scan flagged it because a comment mentioned SECURITY DEFINER. It is not a defect.

Not verified: the authorization logic inside each function, grant behaviour for every function, and whether `public` is revoked for every function. Those need the chain applied to a disposable database and tested, which is listed in section 7.

## 6. Recommended sequence (proposed, not applied)

1. `create_accounts_foundation.sql` (after confirming production state read-only)
2. `create_navigator_case_ownership_foundation.sql`
3. `create_navigator_matters_foundation.sql`
4. **Evidence schema: blocked, see section 2**
5. `phase7b_reconciled_event_foundation.sql`
6. `phase7b_reconciled_legal_authority_foundation.sql`
7. `phase7b_reconciled_legal_corpus_versioning.sql`
8. `phase7b_reconciled_stage9b_candidates.sql` (needs evidence and events)
9. `create_professional_reviews.sql`, then `phase7b_reconciled_professional_work_product_versions.sql`, then `phase7b_reconciled_stage9d_research.sql`
10. `create_professional_profiles.sql`, then `create_lawyer_directory_foundation.sql`
11. `create_navigator_matter_access_grants.sql`, `create_navigator_matter_access_event_log.sql`, remediation (patched), v3, v4
12. `create_navigator_paid_sessions.sql` (only after `access_codes` is confirmed in production)
13. `create_paid_access_credit_ledger_and_enforcement.sql`

Not sequenced, and not reviewed here: `enable_rls_free_usage_gmail_stale.sql` and `expand_tier_constraints_for_analyzer_and_community.sql`. They change existing tables in production, so they need their own approval.

## 7. Tests required before any approval

- Apply the sequence above to a disposable Supabase branch, not production. Record each file's result.
- Run the `.pg.test.ts` suites against that branch. They are skipped in CI unless `ADMIN_URL` is set.
- For each new table: `anon` and `authenticated` clients get zero rows and cannot write.
- Grant lifecycle: create, accept with unverified email (fails), wrong token digest (fails), correct token once (succeeds), replay (fails), revoke, expiry.
- Event log: update and delete fail.

## 8. Rollback

- Take a logical backup before any apply.
- Apply to a branch first; promote only after section 7 passes there.
- None of the files has a down script. Writing one per file is required before approval.
- Feature flags stay off during apply.
