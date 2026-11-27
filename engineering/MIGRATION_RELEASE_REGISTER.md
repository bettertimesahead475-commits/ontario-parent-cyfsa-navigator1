# Database migration release register (A–F)

Owner: lead engineer (T-05 session). Last read-only check of the live-bound database: 2026-11-27 18:40 UTC (aggregate queries only; nothing changed).

**Target for every entry:** `nxfhvebzzobegubefcda` (Supabase project named `cyfsa-navigator-staging`, ca-central-1). It is the
database behind production Cloudflare Pages (`cyfsa-navigator-git-staging`, deployment `0cc59589`, commit `82dfe65`,
`STAGING_SUPABASE_URL`). Nothing in this register goes to `qboidsfpjuxeqtfotryj` until ownership is resolved.

**Rules:** nothing is applied without the owner's written approval and Claude's qualification of that entry. Take a backup or confirm PITR first
(none was taken for A/B). Every SQL file runs first on disposable PostgreSQL only.

## Status

| ID | File (`supabase/…`) | State on live (read-only, 2026-11-27) | Depends on | PR / brief |
|---|---|---|---|---|
| **P** | `migrations/20261110004740_preserve_monthly_renewal.sql` | **Not applied (drift).** It sits in the repo's applied folder, but live history jumps from `20261110003928` to `20261127163256`. `access_codes.redeemed_session_id` is missing, and the live `redeem_access_code_atomic` `md5(prosrc)` = `ca9f13a8…`, not `b835b252…` (P's version) | — | this register. Package: `migrations_pending_approval/preserve_monthly_renewal_P.{preflight,postcheck,rollback}.sql`, `tests/devin/migration-p-preserve-monthly-renewal.pg.test.ts` |
| A | `migrations_pending_approval/free_scan_reservation_functions.sql` | Applied 2026-11-27 16:32:56 UTC (version `20261127163256`); owner authorization unconfirmed | — | `engineering/reviews/pr164-migration-approval-brief.md`, `pr164-staging-migration-verification-20261127.md` (branch `devin/1795797327-launch-prep`) |
| B | `migrations_pending_approval/reconcile_skip_live_analyzer_jobs.sql` (+ index `analyzer_jobs_live_reservation_idx`) | Applied 16:33:09 UTC (`20261127163309`); authorization unconfirmed | A | same as A |
| C | `migrations_pending_approval/create_navigator_rate_limit_hits.sql` | Not applied: table and function absent, no history row | — | [#174](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/174), `engineering/reviews/pr168-rate-limit-qualification-20261127.md` |
| D | `migrations_pending_approval/access_codes_one_redemption_per_reference.sql` | Not applied. **Its preflight fails 2 blocking checks on live** (see P): 3 of 4 required columns, and the RPC fingerprint mismatches. Non-blocking: 0 duplicate references, 0 redeemed codes with a reference, 0 unused codes of activated references | **P** | [#175](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/175), `engineering/reviews/s34-one-redemption-per-reference-20261127.md` |
| E | `migrations_pending_approval/paid_sessions_early_renewal_keeps_credits.sql` (+ `.rollback.sql`, `.preflight.sql`) | Not applied; preflight prepared, not run on live | D | [#181](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/181), `engineering/reviews/e-early-renewal-keeps-credits-20261127.md`. **Blocking app fix first (#171):** an admin top-up refund must subtract the pack from `granted_credits`, not only the 30 days |
| F | `migrations_pending_approval/create_transactional_email_outbox.sql` (+ `.down.sql`, `.preflight.sql`, `.test.sql`/`.test.sh`) | Not applied; preflight prepared, not run on live | — (independent of P–E) | [#182](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/182) (Agent B) |

## P: repo/live drift (new launch blocker for payments)

- **Code already expecting P:**
  - `functions/api/admin/[[path]].ts` (on `engineering/integration` and in production `82dfe65`) queries
    `access_codes?select=id&redeemed_session_id=eq.…`. On live, PostgREST rejects an unknown column with HTTP 400.
  - PR #171 also selects `redeemed_session_id` in `_customer-payments.ts`, which `claim-purchase.ts` and `my-payments.ts` use.
  - Those payment paths fail on live until P is applied.
- **Customer data today:** `access_codes` has 0 rows and `navigator_paid_sessions` has 5. Applying P adds a nullable column and
  replaces the RPC; no row changes.
- **What P does:** `add column if not exists redeemed_session_id uuid references navigator_paid_sessions(id)` and
  `create or replace redeem_access_code_atomic(text,text,text)`, which adds 30 days on a monthly renewal instead of replacing the entitlement.
- **Rollback readiness (done 2026-11-27, read-only capture):**
  - The live RPC is the comment-stripped `20261030182320` version (`md5(prosrc)` = `ca9f13a8…`). The repo file of that name has md5 `da9c7103…` because it keeps its comments, so it is **not** a valid rollback source.
  - `preserve_monthly_renewal_P.rollback.sql` embeds the exact `pg_get_functiondef` taken from live. The disposable test applies P and then this rollback, and gets `ca9f13a8…` back.
  - Dependants of `access_codes`: one view (`navigator_payment_summary`), which does not use the new column; no triggers; RLS on; table grants to `service_role` only.
  - The rollback refuses if D's index exists, if the RPC is not P's version, or if dropping the column would lose renewal links. A session setting is needed to accept that loss deliberately.
  - Tests: 7/7 on disposable PostgreSQL. Each of the three guards fails at least one test when removed.

## Execution sequence and owner approval checklist

Single owner approval covers the whole sequence; each step still stops on a failed check. Target: `nxfhvebzzobegubefcda` only.

| Step | Action | Gate (must be true to continue) | Rollback |
|---|---|---|---|
| 0 | Owner ratifies A/B as applied (owner 14:26: preserve; no rollback) | Claude's A/B integrity and authorization note | none planned |
| 1 | Confirm PITR or take a backup | Backup id or PITR window recorded | — |
| 2 | P preflight (`preserve_monthly_renewal_P.preflight.sql`) | All blocking rows `ok` | — |
| 3 | Apply P (`supabase/migrations/20261110004740_preserve_monthly_renewal.sql`) | `preserve_monthly_renewal_P.postcheck.sql` all `ok` | `preserve_monthly_renewal_P.rollback.sql`; if P is re-applied later, run `preserve_monthly_renewal_P.reapply_backfill.sql` straight after it |
| 4 | D preflight, then apply D | D preflight blocking rows `ok`; D brief postchecks | D `.rollback.sql`, then P's if needed |
| 5 | Apply C, with `PERSISTENT_RATE_LIMITS` unset | #174 brief checks | `rollback_navigator_rate_limit_hits.sql` |
| 6 | Apply F | F preflight `ok`; no sends (owner 14:26) | F `.down.sql` |
| 7 | Deploy the RC to Cloudflare production (separate owner approval in `RELEASE_CANDIDATE_20261127.md`) | RELEASE_CHECKLIST smoke tests; the deployed admin refund subtracts a top-up from `granted_credits` | Cloudflare rollback to `0cc59589` (roll back E first if it is applied) |
| 8 | Apply E, only **after** step 7: the live `82dfe65` refund shortens access but leaves `granted_credits`, so E before the RC would let refunded top-ups keep their analyses | The #171 refund reverses `granted_credits` and is live (owner 14:26); E preflight `ok` | E `.rollback.sql` |

**Rollback order:** reverse order only: E, then the Cloudflare deployment, then F, C, D, P. Never run `free_scan_reservation_functions.down.sql` on this database.

Every step needs Claude's qualification of that entry. Before each step, record `select max(version) from supabase_migrations.schema_migrations`.
Apply through Supabase `apply_migration` so a history row is written. The recorded version will be the apply time, not the
repo filename, so note both in this register.

## Out of scope for this release

The other files in `supabase/migrations_pending_approval/` (matters, legal corpus, professional profiles, staged foundations, etc.)
belong to unreleased features and are not part of this register.
