# Database Migration Decision Matrix

Live project: `qboidsfpjuxeqtfotryj` (cyfsa-navigator live). Read-only. No migration was executed.

Repo: `supabase/migrations_pending_approval/` on `origin/main` (`0130a96f`) holds **45 files**. The audit said 38; the difference is `.rollback` and `.test` companions and the drift noted below.

## Applied on live (per `list_migrations`)

Latest applied: `20261025142350` `paid_credit_reservation_functions`. Also applied: `20260909144539` (content of `enable_rls_free_usage_gmail_stale`).

## Decision matrix for the pending items named in the audit

| Pending file | Live state | Decision | Owner approval needed |
|---|---|---|---|
| `enable_rls_free_usage_gmail_stale.sql` | Already applied (`20260909144539`). RLS on, 0 policies, anon/authenticated grants remain. | Do **not** re-run. Remove from pending. Add a narrow follow-up migration that REVOKEs `anon`/`authenticated` on `free_usage`, `gmail_processed_messages`, `stale_payment_alerts`, `submissions`, `free_tool_usage`, `access_codes`, `cyfsa_300rule_access_codes`. | Yes |
| `payment_requests_request_key_unique.sql` (+ rollback, test) | `payment_requests` table does **not exist** on live. App uses `payments`. | Do not apply. Retire it, or rewrite against `payments` after checking `reference_number` uniqueness on live. | Yes |
| `create_accounts_foundation.sql` | Applied per earlier check | Mark as applied in repo; no SQL run | No (repo bookkeeping) |
| `create_navigator_case_ownership_foundation.sql` | Applied per earlier check | Mark as applied in repo | No |
| `create_navigator_matters_foundation.sql` | Applied per earlier check; `navigator_matters` present, RLS on, 0 policies | Mark as applied in repo | No |
| `create_navigator_paid_sessions.sql` | Applied per earlier check; `navigator_paid_sessions` present, RLS on, 0 policies | Mark as applied in repo | No |
| `paid_credit_reservation_functions.sql` (+ down) | Applied (`20261025142350`). Functions `paid_reserve_credit`, `paid_finalize_credit`, `paid_release_credit` exist. | Mark as applied in repo | No |

## Notes on live state

- Tables with RLS on and zero policies (`navigator_*`, `accounts`, `clients`, `free_usage`, `gmail_processed_messages`, `stale_payment_alerts`, `submissions`, `access_codes`) deny all non-owner access. Server-side code uses the service role, so this is safe for the app but should be confirmed against the service-role code paths.
- `document_walkthroughs.walkthroughs_public` allows public SELECT on all rows. Confirm this content is meant to be public.
- Not checked in this pass: whether `payments.reference_number` is unique on live. Needed before retiring the `payment_requests` migration.

## Repo drift

Five migrations applied on live are missing from the repo's applied folder. Fix by adding them to the repo's history, not by re-running SQL.
