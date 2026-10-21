# Pending Migration Readiness (Phase 6)

Status: **Not ready for approval.** No migration has been applied. The target database was not accessed. Everything below comes from reading the SQL files in `supabase/migrations_pending_approval/` (38 files) and grepping them for table, reference, and function definitions.

## 1. Blockers found by static reading

1. **Duplicate table definitions.** Ten tables are created by two different files. Applying both fails on the second `CREATE TABLE`, or it silently diverges if one file uses `IF NOT EXISTS`.

   | Table | Files |
   |---|---|
   | navigator_events | `create_navigator_m2a_intelligence_foundation.sql`, `phase7b_reconciled_event_foundation.sql` |
   | navigator_evidence_items | `create_navigator_page_evidence_foundation.sql`, `phase7b_reconciled_evidence_foundation.sql` |
   | navigator_legal_sources | `create_navigator_legal_authority_foundation.sql`, `phase7b_reconciled_legal_authority_foundation.sql` |
   | navigator_legal_source_versions | same pair as above |
   | navigator_legal_provisions | same pair as above |
   | navigator_legal_provision_versions | `create_navigator_legal_corpus_versioning.sql`, `phase7b_reconciled_legal_corpus_versioning.sql` |
   | navigator_matter_legal_research_candidates | `create_navigator_stage9b_matter_research.sql`, `phase7b_reconciled_stage9b_candidates.sql` |
   | navigator_matter_research_runs / _run_results | `create_navigator_stage9d1_research_foundation.sql`, `phase7b_reconciled_stage9d_research.sql` |
   | professional_work_product_versions | `create_professional_work_product_versions.sql`, `phase7b_reconciled_professional_work_product_versions.sql` |

   The `phase7b_reconciled_*` set looks like a reconciled replacement for the `create_navigator_*` set. Nothing in the directory says which set is authoritative. **Owner decision required:** pick one set per table and delete or archive the other. Do not apply both.

2. **Alphabetical filename order breaks dependencies.** `create_lawyer_directory_foundation.sql` references `professional_profiles`, which is created by `create_professional_profiles.sql`. "lawyer" sorts before "professional", so a plain alphabetical run fails. The same kind of problem applies to any file that references a later-sorted file. A real apply order must be written down, not inferred from names.

3. **Redefined functions.** `accept_matter_grant`, `create_matter_grant`, and `revoke_matter_grant` are each defined in up to three files: `create_navigator_matter_access_grants.sql`, `create_navigator_matter_access_lifecycle_audit_v3.sql`, `create_navigator_matter_access_lifecycle_recipient_v4.sql`, and `remediate_navigator_matter_access_grants_lifecycle.sql`. `create or replace` means the last file applied wins. Only the recipient-bound v4 path plus the 7B remediation should remain live. Confirm that before approval. The earlier `accept_matter_grant` path must not be reachable.

4. **Missing from the directory.** `create_accounts_foundation.sql` defines `accounts`, which every other file references. It is itself pending. Nothing applied to production can reference `accounts` until it is applied, so it must be applied first.

## 2. Dependency order (provisional; confirm against the stage docs)

Dependencies below are from `REFERENCES` clauses and function bodies. The stage `*.md` files in the repo root may define an intended order. I did not verify this yet.

1. `create_accounts_foundation.sql`
2. `create_navigator_matters_foundation.sql` (needs `accounts`, `navigator_cases`; `navigator_cases` comes from case ownership, so case ownership must come first)
3. `create_case_ownership_foundation.sql` and `create_navigator_case_ownership_foundation.sql` (these two overlap and need reconciling; see 1 above)
4. `create_navigator_page_evidence_foundation.sql` (needs matters, document versions, extraction runs)
5. `create_navigator_evidence_review.sql` (needs evidence items, accounts)
6. Legal authority, then legal corpus versioning
7. M2A, M2C, M2D, M2E intelligence (M2C and M2D need claims and entities; M2E needs gap findings)
8. Stage 9A/9B/9D research (needs legal provisions, events, candidates)
9. `create_professional_profiles.sql`, then `create_lawyer_directory_foundation.sql`, then `create_professional_reviews.sql`, `create_professional_work_product_versions.sql`
10. Matter access: grants, then event log, then lifecycle v3, then recipient v4, then 7B remediation (only the last definition of each function should stay)
11. `create_navigator_paid_sessions.sql` needs `access_codes`. Nothing in this directory creates `access_codes`. **It must already exist in production or be added to this set.**
12. `create_paid_access_credit_ledger_and_enforcement.sql` needs paid sessions
13. `enable_rls_free_usage_gmail_stale.sql` and `expand_tier_constraints_for_analyzer_and_community.sql` have no dependency on the new tables. They touch existing tables. Review them separately, since they change existing production behavior.
14. `read_navigator_owned_matter.sql` depends on matters and must come after that set.

## 3. Missing or unverified

- `access_codes`: referenced, not defined here. Check production.
- `navigator_cases`, `documents`, `document_versions`: referenced. Two overlapping case-ownership files define similar tables. Check which exists in production.
- `free_usage`, `gmail_processed_messages`, `stale_payment_alerts`: RLS enabled here, but I did not confirm they exist in production or that enabling RLS will not break existing server code paths that use the anon key. Server code must use service_role for these.
- No file in this directory has a rollback. Every migration is forward-only. A rollback plan is required for each one before approval.

## 4. Security checks that must pass before approval

- Every new table has RLS enabled. Client policies should be deny-all, with access through service_role or security-definer RPCs. Confirm this per file, not from the general pattern.
- Each `security definer` function sets `search_path` explicitly. Confirm with `grep -i "security definer" -A3`. I have not checked this file by file.
- Professional tables are not granted to `anon` or `authenticated`. `create_professional_profiles.sql` does this. Check the others.
- `navigator_matter_access_events` is append-only: an update or delete guard exists. Test it on a disposable branch.
- Professional verification stays server-side. `adminVerifyProfile` checks the server-side admin role. Confirm no column is writable by the client.
- Matter sharing stays disabled. Access grants can be created only after the feature flag is enabled, and that flag stays off.

## 5. Tests required before approval

- Apply the full ordered set to a **disposable Supabase branch** (not production). Record the exact result for each file.
- Run the `.pg.test.ts` suites against that branch. They are currently skipped (444 skipped tests in the suite). Those skips must be resolved, not reported as passing.
- For each RLS table: an `anon` client and an `authenticated` client with no grants must both get zero rows and be unable to write.
- Grant lifecycle: create, accept with unverified email (must fail), accept with wrong token digest (must fail), accept with correct token (succeeds once), revoke, expired grant. Replays must fail.
- Event log: update and delete attempts must fail.
- Re-running the set must fail cleanly or be idempotent. Record which.

## 6. Rollback strategy (proposed, not implemented)

- Take a logical backup of the target schema before applying anything.
- Apply to a branch first. Only promote after the tests above pass on the branch.
- For each file, write a matching `down` script. Drop tables only if they are empty and no code path references them. Otherwise the rollback is a feature-flag disable plus a data export.
- Feature flags for the Parent and Professional portals stay off during application. Turning them on is a separate, owner-approved step.

## 7. What this report does not establish

- It does not say the migrations are correct. It says they are not yet safe to apply.
- No database was read. Production state is unknown.
- The stage documents were not checked for an intended apply order.
- No migration was executed, and no flag was turned on.

## 8. Owner decisions needed

1. Which of the two overlapping file sets is authoritative for each duplicated table.
2. Whether `access_codes` and the other production-only objects already exist.
3. Whether to split enabling RLS on existing tables into its own change.
4. Approval to create a disposable Supabase branch for the test run.
