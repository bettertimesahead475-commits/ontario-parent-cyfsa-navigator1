# Database migration release register (A–G, P)

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
| E | `migrations_pending_approval/paid_sessions_early_renewal_keeps_credits.sql` (+ `.rollback.sql`, `.preflight.sql`) | Not applied; preflight prepared, not run on live | D | [#181](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/181), `engineering/reviews/e-early-renewal-keeps-credits-20261127.md`. Top-up refund is now one DB function in E, `paid_refund_one_off_pack` (commit `d51dea0`): one pack and 30 days, under the reservation lock, once per refund key, never below the tier default; the reserve wrapper reads the allowance under that lock. Awaiting Claude qualification |
| F | `migrations_pending_approval/create_transactional_email_outbox.sql` (+ `.down.sql`, `.preflight.sql`, `.test.sql`/`.test.sh`) | Not applied; preflight prepared, not run on live | — (independent of P–E) | [#182](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/182) (Agent B) |
| **G** | `migrations_pending_approval/payments_service_role_review_update.sql` (+ `.rollback.sql`, `.preflight.sql`) | Not applied. **Live `service_role` has no `UPDATE` on `payments`** (read-only, 2026-11-27), so admin approve and pending-order refund get 502 and issue nothing. G grants `UPDATE (status, approved_at)` only | — (independent of P–F; needed before any live e-Transfer sale) | [#188](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/188) |

## Qualification: real PostgreSQL + PostgREST harness ([#188](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/188))

Real handlers through the real PostgREST 12.2.3 binary on disposable PostgreSQL 16, with a live-schema baseline (`md5(prosrc) = ca9f13a8…`).
Only Firebase verification is stubbed. 27/27 pass locally; detail in `engineering/reviews/payment-schema-qualification-20261127.md`.
Claude has not yet re-qualified.

| Entry | Result |
|---|---|
| Baseline (today, before P) | Claim 503 `ACTIVATION_UNAVAILABLE`, nothing written. My Orders 503 and refund of an activated order 501 on #171 head `1773183`; #188 fixes both (orders listed without `accessActive`; refund revokes). Monthly renewal makes 2 overlapping entitlements |
| G | Without G: approve 502, nothing issued. With G: approve, reissue and refund work before P |
| P | 1 activation from 5 concurrent claims; approve versus claim, approve then claim, 3 interruption points (after code insert, after RPC, before refund history) all end with 1 entitlement; monthly renewal extends one entitlement by 30 days. Two live codes of one payment still both activate (S-34) |
| P + D | Same as P, and D refuses the second code (`ORDER_ALREADY_ACTIVATED`): 1 entitlement |
| Refund versus reissue (P and P + D) | On #171 head the reissued code activated a refunded order; #188 cancels it (409 `PAYMENT_REFUNDED`) |
| E | Disposable PG with P + D + E (`tests/devin/early-renewal-credits-migration.pg.test.ts`, 21/21 at `d51dea0`): refund with analyses used, reserved, retried, concurrent (separate connections) and with other entitlements; a reservation racing a refund waits and gets `limit` (it got `reserved` before the wrapper fix). Not yet qualified by Claude |

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
| 1 | Logical backup: `supabase db dump` (schema, then `--data-only`) stored off-site. The org is on the **Free plan**, which has no daily backups or PITR | Dump files exist, are non-empty and were taken after the last write | Restore from the dump (downtime while restoring) |
| 2 | Apply G (`payments_service_role_review_update.sql`, [#188](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/188)) | G preflight `ok`; `has_column_privilege('service_role','public.payments','status','UPDATE')` is true | G `.rollback.sql` |
| 3 | P preflight (`preserve_monthly_renewal_P.preflight.sql`), then apply P (`supabase/migrations/20261110004740_preserve_monthly_renewal.sql`) | Preflight blocking rows `ok`; `preserve_monthly_renewal_P.postcheck.sql` all `ok` | `preserve_monthly_renewal_P.rollback.sql`; if P is re-applied later, run `preserve_monthly_renewal_P.reapply_backfill.sql` straight after it |
| 4 | D preflight, then apply D | D preflight blocking rows `ok`; D brief postchecks | D `.rollback.sql`, then P's if needed |
| 5 | Apply C, with `PERSISTENT_RATE_LIMITS` unset | #174 brief checks | `rollback_navigator_rate_limit_hits.sql` |
| 6 | Apply F | F preflight `ok`; no sends (owner 14:26) | F `.down.sql` |
| 7 | Deploy the frozen RC commit to Cloudflare production | RELEASE_CHECKLIST smoke tests | Cloudflare rollback to the deployment that was live before step 7 (today `0cc59589`) |
| — | E is **not in this release** (it is a feature; owner 15:01: no additional features). When it is scheduled: deploy #181's handler first (it calls `paid_refund_one_off_pack` only once `granted_credits` exists), then apply E | Claude qualification of #181 at `d51dea0` or later | E `.rollback.sql` |

Steps 2–6 are compatible with the code live today (`82dfe65`):
- P keeps the RPC's signature and its `activated`/`reused` statuses.
- D's new `ORDER_ALREADY_ACTIVATED` can only occur for a second code of one payment. Live has 0 access codes.
- G only adds a column grant.
- C and F only add objects.

So step 7 can roll back the app alone, without rolling back the database.

**Rollback order:** reverse order only: the Cloudflare deployment, then F, C, D, P, G. Never run `free_scan_reservation_functions.down.sql` on this database.

Every step needs Claude's qualification of that entry. Before each step, record `select max(version) from supabase_migrations.schema_migrations`.
Apply through Supabase `apply_migration` so a history row is written. The recorded version will be the apply time, not the
repo filename, so note both in this register.

## Out of scope for this release

The other files in `supabase/migrations_pending_approval/` (matters, legal corpus, professional profiles, staged foundations, etc.)
belong to unreleased features and are not part of this register.
