# Pending database migrations: approval brief (2026-11-27)

Status: **Devin has not applied either migration.** However, Claude's branch `audit/pr164-final-067446a`
(commit `0888970`, 11:33 EST) records that **both were applied to `nxfhvebzzobegubefcda`**, citing "owner authorization received
2026-11-27: D1 and D2 confirmed". That conflicts with the owner's 11:33 directive not to apply them. Devin cannot verify the
database state (no Supabase access). The owner needs to confirm which is true. This brief is based on [PR #164](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/164) at `067446a`.
Target, if ever approved: only the database that is verified to serve the live analyzer. The binding currently recorded is
`nxfhvebzzobegubefcda` (staging-named). Nothing goes to `qboidsfpjuxeqtfotryj` until ownership is resolved.
I have no access to either project (the Supabase connection reaches a different organization), so every statement
below about the live database's contents comes from repository records, not my own inspection.

## A. `supabase/migrations_pending_approval/free_scan_reservation_functions.sql`
Companion files: `free_scan_reservation_functions.down.sql`, `free_scan_reservation_functions.test.sql`.

| | |
|---|---|
| Functions (all `create or replace`) | `free_marker_uid(text,text)`, `free_release_marker(text,text,timestamptz)`, `free_reconcile(text,text,timestamptz,interval)`, `free_reserve_scan(text,text,integer,timestamptz,interval)`, `free_finalize_scan(text,text,timestamptz)`, `free_release_scan(text,text,text,timestamptz)` |
| Grants | EXECUTE revoked from `public`, `anon`, `authenticated`; granted to `service_role` only |
| Tables | None created or altered. At run time the functions read and write `public.free_usage`: the counter row (`uid` = Firebase uid) and marker rows (`free_res_<uid>_<32 hex>`). |
| Already live? | `PHASE10_FREE_SCAN_RESERVATION_REPORT.md` records all six functions on `nxfhvebzzobegubefcda` with matching signatures, and the live code calls `free_reserve_scan` (`functions/api/_free-credit-reservation.ts`, limit 3). **Not independently verified.** |
| What changes | Only the `free_reconcile` body (commit `4da0582`). Its range test `uid >= 'free_res_<uid>_' and uid < 'free_res_<uid>`'` matches no rows under `en_US.utf8` collation. It becomes `left(uid, length(lo)) = lo` plus the existing exact-length check. |

**Customer impact**
- No downtime and no schema change. Each reservation already takes a per-account lock for milliseconds; that is unchanged.
- Behaviour fix: a free reservation left in `reserved` for more than 15 minutes (its attempt died before release) is now
  returned on that account's next free request. Affected users get back a free scan that was wrongly counted as used.
  No one's allowance goes down.
- Data effect: each reclaimed marker gets `email = 'reservation:released'`, and the counter's `analyses_used` drops by 1.
- How many accounts are affected (read-only; run before deciding):
  `select count(*) from public.free_usage where uid like 'free\_res\_%' and email like 'reservation:reserved%' and coalesce(last_analysis_at, first_analysis_at) < now() - interval '15 minutes';`

**Prerequisites**
1. Confirm which project serves https://cyfsanavigator.com and who owns its data (open item from 2026-11-26).
2. Back up the six current definitions and their grants:
   `select pg_get_functiondef(p.oid) from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname like 'free\_%';`
   plus `\df+ public.free_*` for the grants. Save the output; it is the rollback.
3. Diff the saved definitions against the repository file. If anything other than `free_reconcile` differs, stop and re-derive the file from the live version.
4. Run `free_scan_reservation_functions.test.sql` only on a disposable database, never on the live project. It writes test rows inside one transaction and ends with `rollback`. Expected output: `ALL FREE SCAN RESERVATION CHECKS PASSED`.
5. Point-in-time recovery or a backup is available. Owner approval, and Claude's qualification of PR #164, are recorded.

**Rollback**
- **Do not run `free_scan_reservation_functions.down.sql` on the live database.** It drops all six functions. The live
  analyzer calls them, so every free analysis would fail with 503 `RESERVATION_UNAVAILABLE`.
- Rolling back the application does not make the `.down.sql` safe either: the code now in production (`82dfe65`)
  calls `free_reserve_scan` too, and so did every earlier release since the free-scan reservation work.
- Instead, re-run the definitions saved in prerequisite 2 (`create or replace`, then the same grants).
- Released markers are not restored. They are ordinary rows that can be listed by
  `email = 'reservation:released'` and `last_analysis_at` within the change window, if a manual reversal is ever needed.

## B. `supabase/migrations_pending_approval/reconcile_skip_live_analyzer_jobs.sql`
Companion file: `reconcile_skip_live_analyzer_jobs.down.sql`. Security register S-17, blocker B-10, NAV-004.

| | |
|---|---|
| Functions (`create or replace`, one transaction) | `paid_reconcile(text,text,timestamptz,interval)`, `free_reconcile(text,text,timestamptz,interval)` |
| Grants | Revoked from `public`, `anon`, `authenticated`; granted to `service_role` |
| Optional index (separate step, outside a transaction) | `create index concurrently if not exists analyzer_jobs_live_reservation_idx on public.analyzer_jobs (reservation_id) where status in ('queued','running');` |
| Tables | Reads `public.analyzer_jobs` (`reservation_id`, `status`, `updated_at`; created by `supabase/migrations/20261104230000_durable_analyzer_queue.sql`). Releases rows in `public.free_usage` through the existing `paid_release_marker` and `free_release_marker`. No table is altered. |
| What changes | Both functions skip a reservation whose analyzer job is still `queued` or `running` and was updated in the last 2 hours. `free_reconcile` also includes the collation fix from A. |

**Customer impact**
- Fixes credit accounting for jobs that wait in the queue more than 15 minutes (backlog or retries). Today such a job's
  reservation is released while the job is still going to run. A paid customer then gets the report without being charged, and a free user
  gets the scan back. After the change those jobs consume exactly one credit, as the pricing intends. No one is charged twice.
- Jobs stuck in `queued` or `running` for more than 2 hours are still reconciled, so a dead job cannot hold a credit forever.
- Cost: one indexed lookup in `analyzer_jobs` per stale marker on each reservation. Building the index `concurrently` does not lock writes.
- No downtime.

**Prerequisites**
1. Same project confirmation and backup as A, prerequisites 1–2, for `paid_reconcile` and `free_reconcile`.
   Use the pre-check `pg_get_functiondef` queries at the top of the file.
2. The live `paid_reconcile` and `free_reconcile` match the repository versions in `reconcile_skip_live_analyzer_jobs.down.sql`.
   If they don't, stop.
3. `paid_release_marker`, `free_release_marker` and `analyzer_jobs.reservation_id` exist.
4. **Order:** if both migrations are approved, apply A before B. Applying A after B would replace B's `free_reconcile` and remove the guard.
   B on its own also carries the collation fix.
5. Optionally build the index first.

**Rollback**
- `reconcile_skip_live_analyzer_jobs.down.sql` restores the repository versions of both functions. It changes no data and is safe to run on the live database.
- Then, optionally: `drop index concurrently if exists public.analyzer_jobs_live_reservation_idx;`
- Any reservation that was kept rather than released has already been charged correctly; nothing needs reversing.

## Evidence
On a disposable postgres:16 database (local only, created and dropped for each run), `freeScanFunctions.pg.test.ts` and
`paidCreditFunctions.pg.test.ts` passed 26/26, and the standalone `.test.sql` passed. See `engineering/TEST_REGISTER.md`.
Neither file has been run against any Supabase project.

## If Claude's record is accurate (applied 2026-11-27)
- Claude recorded the counts before and after the change: 8 `reserved`, 2 `consumed` and 6 `released` markers, plus 7 counter rows, all unchanged.
  The 8 reserved markers become reclaimable when each account next requests a free scan, so those accounts may get scans back.
- Claude did not take a provider backup. Claude recorded the old `free_reconcile` logic but not its full text, so it cannot be restored word for word.
  It is the range version, which never reclaimed anything; restoring it would bring the defect back.
- Safe rollback for B: `reconcile_skip_live_analyzer_jobs.down.sql` (function bodies only; the prefix fix is kept).
- Rollback for A: **do not drop the functions.** Production calls them.
- Read-only check worth doing: `select proname, md5(pg_get_functiondef(oid)) from pg_proc where proname like any (array['free\_%','paid\_%']);`
  Compare the result with the repository files, then record it in `engineering/TEST_REGISTER.md`.
