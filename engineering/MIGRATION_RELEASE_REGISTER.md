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
| **P** | `migrations/20261110004740_preserve_monthly_renewal.sql` | **Not applied (drift).** It sits in the repo's applied folder, but live history jumps from `20261110003928` to `20261127163256`. `access_codes.redeemed_session_id` is missing, and the live `redeem_access_code_atomic` `md5(prosrc)` = `ca9f13a8…`, not `b835b252…` (P's version) | — | this register |
| A | `migrations_pending_approval/free_scan_reservation_functions.sql` | Applied 2026-11-27 16:32:56 UTC (version `20261127163256`); owner authorization unconfirmed | — | `engineering/reviews/pr164-migration-approval-brief.md`, `pr164-staging-migration-verification-20261127.md` (branch `devin/1795797327-launch-prep`) |
| B | `migrations_pending_approval/reconcile_skip_live_analyzer_jobs.sql` (+ index `analyzer_jobs_live_reservation_idx`) | Applied 16:33:09 UTC (`20261127163309`); authorization unconfirmed | A | same as A |
| C | `migrations_pending_approval/create_navigator_rate_limit_hits.sql` | Not applied: table and function absent, no history row | — | [#174](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/174), `engineering/reviews/pr168-rate-limit-qualification-20261127.md` |
| D | `migrations_pending_approval/access_codes_one_redemption_per_reference.sql` | Not applied. **Its preflight fails 2 blocking checks on live** (see P): 3 of 4 required columns, and the RPC fingerprint mismatches. Non-blocking: 0 duplicate references, 0 redeemed codes with a reference, 0 unused codes of activated references | **P** | [#175](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/175), `engineering/reviews/s34-one-redemption-per-reference-20261127.md` |
| E | `migrations_pending_approval/paid_sessions_early_renewal_keeps_credits.sql` (+ `.rollback.sql`, `.preflight.sql`) | Not applied; preflight prepared, not run on live | D | [#181](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/181), `engineering/reviews/e-early-renewal-keeps-credits-20261127.md`. **Blocking app fix first (#171):** an admin top-up refund must subtract the pack from `granted_credits`, not only the 30 days |
| F | (not written yet) transactional email outbox | — | — | Agent B |

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
- **Prerequisites:**
  1. Save the live function (`select pg_get_functiondef('public.redeem_access_code_atomic(text,text,text)'::regprocedure)`),
     because P's rollback is that saved text plus `drop column redeemed_session_id`.
  2. Find which file produced fingerprint `ca9f13a8…`. Likely candidates are `migrations_pending_approval/20261030_reconcile_access_codes_and_atomic_rpc.sql`,
     version `20261030182320` in live history. Confirm the column has no dependants before dropping it in a rollback.
  3. Run P, then D's preflight, on disposable PostgreSQL built to the live schema.
- **Order:** P before D. D's rollback restores P's version, so D must never be applied while P is missing.

## Release order

1. Owner decides on the authorization for A/B, which are already live.
2. Backup or PITR.
3. P, then D's preflight.
4. D.
5. E.
6. C, with the flag off; activate later per the #174 brief.
7. F.

C and F have no data dependency on the others and can move if needed.
Before each step, re-run its read-only preflight and these aggregate checks:
`select max(version) from supabase_migrations.schema_migrations`, and the column and fingerprint checks above.

## Out of scope for this release

The other files in `supabase/migrations_pending_approval/` (matters, legal corpus, professional profiles, staged foundations, etc.)
belong to unreleased features and are not part of this register.
