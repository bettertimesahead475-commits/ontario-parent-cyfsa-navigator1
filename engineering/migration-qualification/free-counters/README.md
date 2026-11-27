# Separate free Quick and Forensic counters — qualification

**Verdict: PASS for the ledger on A+B; FAIL for mixed-version deployment; operational release BLOCKED.**
The release branch `dd02ef34` only grants free Quick Reviews. The implementation under test is the separately owned [free-trial candidate `12d79e0`](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/commit/12d79e04d91006ea49fbfe748c3d6a7af5b5836f), not a migration on the release branch. It uses the existing `public.free_usage` and the same RPC signatures: `fq:<email hash>` and `ff:<email hash>` are independent one-use lanes. A UID with a positive legacy Quick count keeps the three-use ceiling on that same UID key; no rows are backfilled, reset or moved. A zero or absent legacy count takes the new Quick lane under this candidate. No new SQL migration is needed for the split.

## Exact SQL and sequence

The package in [PR #164, head `067446ab`](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/164/commits/067446ab96027f9fc09a606af213e236c4ff5a13) is the source for A/B below. The [operations verification](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/blob/16a10b08f075f62adb21029824d4c6c70b7b27a2/engineering/reviews/pr164-staging-migration-verification-20261127.md) records matching SQL semantics, deployed Pages `0cc59589`, and the actual binding `STAGING_SUPABASE_URL` to `nxfhvebzzobegubefcda`; release Worker configuration names the same host. No independent live connection or current binding check was performed for this qualification. **Do not target `qboidsfpjuxeqtfotryj` or infer a target from the project name.**

| Order on a disposable database | Version/source | SHA-256 of SQL file |
|---|---|---|
| 1. Operational table contract and Supabase roles | `fixture.sql` models `free_usage(uid text primary key, email text, analyses_used integer not null, first_analysis_at timestamptz, last_analysis_at timestamptz)`, RLS and service-role grants; not a live schema dump | synthetic fixture only |
| 2. Queue table and paid functions (B dependencies) | `supabase/migrations/20261104230000_durable_analyzer_queue.sql`; `supabase/migrations_pending_approval/paid_credit_reservation_functions.sql` | paid SQL: `594c42a8e6e640744c27d467da13ecd1b70512a245298c18cc68353ab11d6e69` |
| 3. Partial live-reservation index | `CREATE INDEX CONCURRENTLY analyzer_jobs_live_reservation_idx ON public.analyzer_jobs (reservation_id) WHERE status IN ('queued','running');` outside a transaction | standalone index, not a history row |
| 4. A | `20261127163256`, `supabase/migrations_pending_approval/free_scan_reservation_functions.sql`, from PR #164 | `89d5e381e00800e1b654130ec32a55b22de1df691f8c40b0d9fd955e619f6e9b` |
| 5. B | `20261127163309`, `supabase/migrations_pending_approval/reconcile_skip_live_analyzer_jobs.sql`, from PR #164 | `9c12c84701f22b169329ea6fa2eb3ad21c81f283108de5a8e3e2bf24c504c763` |
| 6. Split counter app | `12d79e0` Pages + queue consumer; **no DDL** | The candidate copy of A is byte-identical to PR #164 A. Do not apply it after B. |

The copies of A/B at the requested release base are older: both use the locale-sensitive range, whereas the #164 bodies use a prefix comparison. Do not substitute those release-branch copies for the package above.

## Reproduce

Use local PostgreSQL server/client binaries (`pg_config`, `initdb`, `pg_ctl`, `psql`, `pg_dump`, `pg_restore`), the `en_US.UTF-8` locale, and Node 22 for the optional application tests. The harness creates its own temporary cluster with no TCP listener. Both the Unix socket and its enclosing directory are mode `0700`; all clients use that socket. Do not run it as root. `FREE_COUNTER_TEST_PORT` controls the socket filename suffix (default 54329).

```sh
git fetch origin refs/pull/164/head
git fetch origin devin/1795810799-free-trial-policy
git worktree add --detach ../free-trial-candidate 12d79e04d91006ea49fbfe748c3d6a7af5b5836f
npm ci --ignore-scripts --prefix ../free-trial-candidate
bash engineering/migration-qualification/free-counters/qualify.sh ../free-trial-candidate
```

Omit the last argument to run the SQL-only portion. The harness exits nonzero on an unexpected result; the three printed `FAIL` lines are asserted reproductions of rollout defects, not flaky tests. The candidate Vitest suite executes its TypeScript helpers against real PostgreSQL with a synthetic REST read adapter. It installs A in a separate scratch database; the shell/SQL portion explicitly exercises A+B. Neither path calls paid inference, Firebase, Supabase, or any deployed service.

## Evidence — PostgreSQL 14.24, `en_US.UTF-8`

| Check | Verdict and evidence |
|---|---|
| Existing entitlement preservation | **PASS.** Seeded legacy counts 0, 2 and 3 and a paid count of 2 before applying A+B; all survived unchanged. Confirmed exactly one remaining legacy Quick at 2, none at 3, an independent Forensic reservation, and unchanged paid count. Candidate app suite additionally checked the legacy balance returned to the client. |
| Genuine concurrent Quick / Forensic and independence | **PASS.** Held each mode's reservation open in a separate transaction, verified the blocked contender via `pg_blocking_pids`, completed the other mode under a 2s timeout before commit, and observed `limit` from the loser on each lane. |
| Reservation and failure restoration | **PASS.** Both lanes joined identical requests, rejected a wrong marker, restored a failed reservation once, allowed retry, and kept consumed units. B kept an expired queued marker reserved and returned the unit after the job failed. |
| Interrupted transaction | **PASS.** Terminated a backend after reservation and before commit; no counter or marker survived and retry succeeded. |
| Reapplication and recovery | **PASS** for A→B ordered reapplication (rows unchanged), disposable backup restore, and forward repair (reapply B and retain later commits). **FAIL** for A applied alone over A+B: the exact candidate A removed B's queue guard; a different request reclaimed an expired unit while its job was still queued. |
| Permissions, RLS, indexes and constraints | **PASS** against the synthetic role contract. No free RPC was SECURITY DEFINER or executable by anon/authenticated; those roles also failed an actual RPC call and counter write. Service role reserved and settled both lanes. The UID primary key, NOT NULL constraint and valid partial index were checked. |
| Old/new compatibility | **PASS** for existing and new caller signatures on prior A+B; new worker's marker-key choice supports old and new markers. **FAIL** for mixed deployment: old Pages can grant Quick on the raw UID after new Pages consumes `fq:`; old queue consumer returns `missing`/ `noop` when finalizing/releasing a new `ff:` job because it sends `owner_uid`. The release branch has no free Forensic admission path of its own. |
| Application checks | **PASS.** `npx tsc --noEmit -p .` exited 0 without output at `12d79e0`. Targeted Vitest: `Test Files  5 passed (5)`, `Tests  42 passed (42)`. No browser or deployed end-to-end check. |
| Operational release | **BLOCKED.** Mixed versions are not safe; verify actual bindings, A/B definitions and backup/PITR, and qualify a coordinated cutover before approving any operational change. |

The SQL checks in `compatibility.sql` reproduce the compatibility failures using the exact key choices: release `functions/api/_free-credit-reservation.ts::reserveFreeScan` passes the verified UID, and `workers/analyzer-queue-consumer.ts::finalizeReservation/releaseReservation` use `owner_uid` on the free path. Candidate `reserveFreeTrial` selects the lane; candidate `handleAnalyzeRequest` puts its marker in the queued job's `reservation_id`, and the updated worker decodes it with `freeCounterKey`. This is a cutover risk, not evidence that any live customers were affected.

## Read-only gate and recovery

1. Before a coordinated cutover, confirm the current Pages and Worker deployment IDs and their actual Supabase URL using read-only deployment metadata. Run [inspect.sql](inspect.sql) to check the catalog, table grants, RLS, invoker-mode RPCs and index readiness. Separately query `SELECT version, name FROM supabase_migrations.schema_migrations WHERE version IN ('20261127163256','20261127163309') ORDER BY version;` and compare the stored functions with #164 (allow for migration-tool comment stripping). In particular verify that `free_reconcile` has both the prefix comparison and the live-job exclusion. Missing history, unexpected fingerprints, role drift or wrong project means stop, not reapply.
2. For any approved database repair, confirm provider backup/PITR coverage and save the installed function definitions and grants before changing anything. Tested locally: `pg_dump -Fc` and `pg_restore --exit-on-error` to a **different** database (cluster roles already provisioned). The restored copy correctly omitted transactions committed after backup; replacing the source from that dump would erase them. Do not use A's down script or restore over the operational database.
3. Keep SQL unchanged if A+B match. Before exposing the new trial keys, deploy/verify the backwards-compatible worker, then prevent old Pages versions from admitting new trial requests during cutover. On rollback, keep that worker until all jobs referencing split markers settle; do not turn old Quick admission back on without an entitlement-compatible bridge or a temporary pause on free admission. Do not reset or merge counters to make old code work. The production cutover mechanism and any downtime are not measured here; a free-admission pause can interrupt new free starts, and the drain time depends on outstanding jobs and retries.
4. After an approved cutover, rerun the read-only inventory and check only aggregate counts per known lane (no customer identifiers). If A was accidentally reapplied over B, the tested repair is **reapply verified B**, then repeat fingerprint and index checks. That preserves later rows but cannot undo effects from requests processed while the guard was missing. Reconcile any such transactions separately with owner approval.

No application code, migration body, production data, deployment or authoritative register was changed. The free-trial implementation is owned by its existing session; the qualification does not duplicate it.
