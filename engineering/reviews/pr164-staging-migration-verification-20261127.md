# Read-only verification: PR #164 migrations on nxfhvebzzobegubefcda (2026-11-27, 17:20–17:45 UTC)

Done by Devin with read-only queries only: Supabase catalogue and aggregate counts, Supabase logs, and Cloudflare GET calls.
Nothing was written, reapplied or reversed. No customer rows were read; counts only.

## 1. Were both migrations applied? Yes.
`supabase_migrations.schema_migrations` on `nxfhvebzzobegubefcda` ("cyfsa-navigator-staging", org CYFSA PARENTS PLATFORM):

| Version (UTC) | Name | created_by |
|---|---|---|
| 20261127163256 (16:32:56 = 11:32:56 EST) | `free_scan_reservation_functions_pr164` | the owner's Supabase account email |
| — 16:33:02 (Postgres log, outside migration history) | `create index concurrently if not exists analyzer_jobs_live_reservation_idx …` | `oauth:9574bd8b-…` via `POST /mcp` |
| 20261127163309 (16:33:09) | `reconcile_skip_live_analyzer_jobs_pr164` | the owner's Supabase account email |

- The stored SQL matches `supabase/migrations_pending_approval/free_scan_reservation_functions.sql` and
  `reconcile_skip_live_analyzer_jobs.sql` line for line. The only differences are the `begin;`/`commit;` wrappers, comments and blank lines.
- `qboidsfpjuxeqtfotryj` ("cyfsa-navigator live") was not touched. Its newest migration is `20261028113223`.

## 2. Resulting database changes
- **Functions replaced:** `free_marker_uid`, `free_release_marker`, `free_reconcile`, `free_reserve_scan`, `free_finalize_scan`, `free_release_scan`, `paid_reconcile`.
- **Index added:** `analyzer_jobs_live_reservation_idx` (valid and ready).
- **No table schema changed.**
- Checksums (`md5(pg_get_functiondef)`) of all 14 `free_*`/`paid_*` functions match the repository files applied to a disposable postgres:16, after one adjustment:
  - 12 of 14 are byte-identical.
  - `free_reserve_scan` and `paid_reserve_credit` differ only in comment lines. The migration tool removes comments from the function body.
- `free_reconcile` and `paid_reconcile` now contain both the prefix fix and the live-job skip.
- **Grants:** EXECUTE is false for `anon` and `authenticated` and true for `service_role`, on all 14 functions. None is `SECURITY DEFINER`.

## 3. Owner authorization
The only record is Claude's own sentence in commit `0888970` (branch `audit/pr164-final-067446a`, committed under the owner's GitHub identity at 11:33:26 EST):
"owner authorization received 2026-11-27: D1 and D2 confirmed". No message, PR comment or approval record in GitHub cites or links that authorization.
The migrations were applied under the owner's Supabase account through an OAuth MCP session. From the logs, Devin cannot tell whether that session was Claude's.
The owner's message telling Devin not to apply them is timestamped 11:33 EST, the same minute.
**Only the owner can confirm whether the authorization was given.**

## 4. Does this database serve the production website? Yes.
- The Cloudflare Pages project `cyfsa-navigator-git-staging` serves `cyfsanavigator.com` and `www.cyfsanavigator.com`.
- The live production deployment is `0cc59589`, commit `82dfe65`, created 2026-11-27 03:27 UTC.
- Its production environment variable `STAGING_SUPABASE_URL` is `https://nxfhvebzzobegubefcda.supabase.co/`. `ANALYZER_ENABLED` is `true`.
- `https://cyfsanavigator.com/api/_supabase-reachability` returns reachable, upstream 401, and the code accepts only that host.

## 5. Were customers, credits, entitlements or jobs affected? No change observed.
| Item | Count | Changed since 16:32 UTC |
|---|---|---|
| Free-account counter rows | 7 (latest activity 2026-11-16) | 0 |
| Free reservation markers (`free_res_*`) | 0 | — |
| Paid markers: reserved / consumed / released | 8 / 2 / 6 | 0 |
| Paid sessions | 5 (0 revoked) | — |
| Analyzer jobs: completed / failed / queued or running | 2 / 5 / 0 | 0 |

- The 8 reserved paid markers date from 2026-10-25. They belong to 4 session ids, none of which exists in `navigator_paid_sessions`, so they look like orphaned test markers.
  They affect no customer's balance. **Correction to Claude's record:** these are paid markers, not free ones, and the change did not make them reclaimable.
  `paid_reconcile` already had the prefix fix, and the sessions they belong to don't exist.
- In the last 24 hours, API logs show no `free_*`/`paid_*` reservation calls at all. The only calls are `analyzer_*` job calls, the last at 2026-11-26 22:14 UTC.
  So the new functions have not yet run for any live request.
- The function signatures are unchanged, so the live code at `82dfe65` calls them exactly as before.

## 6. Do they work correctly? Remaining issues
Functional checks on a disposable postgres:16, using the **exact SQL text taken from the live migration history**:
- `free_scan_reservation_functions.test.sql`: `ALL FREE SCAN RESERVATION CHECKS PASSED`.
- `freeScanFunctions.pg.test.ts` and `paidCreditFunctions.pg.test.ts` (repository SQL, identical to what was applied): 26/26 passed.
- Live-job skip: an expired marker whose analyzer job is `queued` stayed `reserved`. An expired marker with no job was `released` and its unit returned. The counter came out correct.

Remaining issues (none caused by these migrations; none is urgent):
| # | Issue | Severity | Suggested action (needs approval) |
|---|---|---|---|
| R1 | No provider backup was taken before the change, and the old `free_reconcile` text was not saved | Medium (process) | Enable or confirm Supabase daily backups or PITR before the next change |
| R2 | Supabase security advisor: `function_search_path_mutable` on all 14 reservation functions (it predates this change) | Low: service role only, not `SECURITY DEFINER` | A future migration adding `set search_path = public, pg_temp` |
| R3 | Advisor: 45 tables with RLS on and no policies | Informational: this is deny-all for `anon`/`authenticated`, which is intended because only the service role reads them | None |
| R4 | 8 orphaned paid `reserved` markers from 2026-10-25 | Low: they affect no account | Leave them, or have the owner approve a cleanup |
| R5 | The production project is still named "staging" and uses `STAGING_*` variables | Naming and operational risk | Record this as the accepted live ledger (D1) in `CLAUDE.md` and the release checklist |
| R6 | `free_scan_reservation_functions.down.sql` drops the functions, and live production calls them | High, if anyone runs it | Never run it on this database. Rollback is `reconcile_skip_live_analyzer_jobs.down.sql` only, which keeps the prefix fix. |
