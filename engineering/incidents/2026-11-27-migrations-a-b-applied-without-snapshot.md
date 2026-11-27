# Incident 2026-11-27: migrations A and B applied to the operational database without the required snapshot

Status: open. No live change has been made since. Nothing in this record authorizes one.

## What happened
- A `supabase/migrations_pending_approval/free_scan_reservation_functions.sql` was applied at 16:32:56 UTC
  (`20261127163256`) and B `reconcile_skip_live_analyzer_jobs.sql` (+ `analyzer_jobs_live_reservation_idx`) at 16:33:09 UTC
  (`20261127163309`). Both went to the operational project `nxfhvebzzobegubefcda`, the one bound to the live Cloudflare app,
  through an owner-account MCP from another session.
- Claude's audit (`c287417`, relayed on PR #171 comment 7227191259) found the authorization was conditional on taking a
  snapshot first. No snapshot was taken.

## Impact assessment (repository evidence; live state not yet re-read)
- A and B are DDL only: `create or replace function` and one index. Applying them changed no rows.
- Since 16:32 UTC, live traffic may have written reservation-marker rows to `public.free_usage` through A's functions.
- Production `82dfe65` calls `free_reserve_scan` (`functions/api/_free-credit-reservation.ts`,
  `functions/api/analyzer-usage.ts`). A rollback that drops A's functions would therefore break free Quick Reviews on the
  live site.

## Recovery options, to verify before any further migration
1. **Roll forward (keep A/B):** keep them once Claude qualifies their bodies against the live schema. This needs no live change.
2. **Restore prior function definitions:** the pre-A/B live bodies were never captured, and `paid_reconcile` is not in
   `supabase/migrations` at `82dfe65`. `reconcile_skip_live_analyzer_jobs.down.sql` restores the repository versions, which
   may differ from what live ran (as the redeem RPC does). Do not use it until the prior bodies are recovered and reviewed.
3. **Never** run `free_scan_reservation_functions.down.sql` on the operational database. It drops functions production calls.
4. **Backup or PITR:** whether a backup taken before 16:32 UTC exists and can be restored depends on the project's plan and
   backup retention. That must be read from the Supabase dashboard of the organization that owns `nxfh`; Devin's Supabase
   connection cannot see that project. A whole-database restore would also roll back customer rows written since, so it is
   a last resort.

## Controls going forward
- Before P, D, E, C or F: a fresh backup or confirmed PITR, plus a saved `pg_get_functiondef` dump of every function the
  migration replaces. Both are recorded in `engineering/MIGRATION_RELEASE_REGISTER.md` before the apply.
- Only the owner applies migrations, with written approval for each one. The payment ledger work in #171, #175 and #181 is
  separate from this incident. Its refund and renewal integrity issues remain release blockers.
