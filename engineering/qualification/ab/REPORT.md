# A/B local PostgreSQL qualification — 2026-11-27

**Result:** Audited A/B and the repaired release files passed on both tested PostgreSQL majors and both collations. The original release files failed four reclaim checks per major on `en_US.utf8`; their clean result on `C` does not qualify them for the operational collation. The repaired A, B, and B down files are byte-identical to the audited copies. This is local technical evidence, not live execution authorization or closure of the [missing-snapshot incident](../../incidents/2026-11-27-migrations-a-b-applied-without-snapshot.md).

## Reproduce

From the repository root, with local Docker and Python 3 available:

```sh
# If the historical audit commit is missing locally:
git fetch origin audit/pr164-final-067446a

docker pull postgres:17-bookworm
docker pull postgres:16-bookworm
engineering/qualification/ab/run.sh --image postgres:17-bookworm
engineering/qualification/ab/run.sh --image postgres:16-bookworm
```

| Image | Observed `server_version` | Repository digest |
|---|---|---|
| `postgres:17-bookworm` | `17.12 (Debian 17.12-1.pgdg12+1)` | `sha256:1eff563f6c868b9b433566e9f3cf6e5c79fbd3b95bf70ec7277d376cdbfc50d7` |
| `postgres:16-bookworm` | `16.16 (Debian 16.16-1.pgdg12+1)` | `sha256:cd0e9518bda5f2ea667ff84d22795d089720c883f288e215d97ce57437e8ef37` |

Use `--image postgres@<digest>` to pin the image. The repo's [production security runbook](../../../docs/PROD_SECURITY_FIX_RUNBOOK.md#13-evidence-read-only-checks-2026-10-22-postgresql-176) records PostgreSQL 17.6; the prior PR #164 qualification used 16. No current `server_version` was read from `nxfhvebzzobegubefcda`. The [PR #164 approval brief](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/blob/16a10b08f075f62adb21029824d4c6c70b7b27a2/engineering/reviews/pr164-migration-approval-brief.md) identifies `en_US.utf8` as the operational collation; the historical audit reports the same en_US behavior. The runner reads the catalog collation for each test database and also tests `C` as a control.

The runner creates a unique disposable local container with `--network none`, no ports or host mounts, and removes it on exit. It reads the four historical SQL blobs with `git show` and the fixed files from the current checkout. Each package/collation uses its own database. The fixture combines the repo's sanitized live payment-schema fixture (roles, access codes, payments, and paid sessions), the queue schema migration, the paid reservation SQL, and the existing free-usage test table shape with RLS/grants. The pre-A baseline uses the RC's range-based free definitions as a **fixture approximation** of the prior live behavior, not an exact pre-A capture. All data is synthetic.

## Per-test results

Both PostgreSQL majors produced the same results. `FAIL` means the check failed against the historical package; it is not a pass. The runner returns zero only when every expected check passes and the historical negative control reproduces the specified failures.

| Test | Audit C | Audit en_US | Original RC C | Original RC en_US | Fixed C | Fixed en_US |
|---|---|---|---|---|---|---|
| Application RPC contract on pre-A fixture | PASS | PASS | PASS | PASS | PASS | PASS |
| Apply A | PASS | PASS | PASS | PASS | PASS | PASS |
| A function ACLs and fixture RLS | PASS | PASS | PASS | PASS | PASS | PASS |
| A reserve, same-request join, finalize, release, and repeat | PASS | PASS | PASS | PASS | PASS | PASS |
| A reclaims expired reservation without touching neighbor UID | PASS | PASS | PASS | **FAIL** | PASS | PASS |
| Existing A SQL regression suite (`free_scan_reservation_functions.test.sql`) | PASS | PASS | PASS | **FAIL** | PASS | PASS |
| Build standalone concurrent partial index; valid, ready, correct key/predicate | PASS | PASS | PASS | PASS | PASS | PASS |
| Apply B | PASS | PASS | PASS | PASS | PASS | PASS |
| A+B function ACLs and fixture RLS | PASS | PASS | PASS | PASS | PASS | PASS |
| Old and new RPC contracts after A+B | PASS | PASS | PASS | PASS | PASS | PASS |
| Genuine concurrent free reservations respect limit | PASS | PASS | PASS | PASS | PASS | PASS |
| Terminate mid-reserve; no partial update or insert | PASS | PASS | PASS | PASS | PASS | PASS |
| B free retains fresh queued/running markers | PASS | PASS | PASS | PASS* | PASS | PASS |
| B free reclaims otherwise (old, boundary, terminal, missing job) | PASS | PASS | PASS | **FAIL** | PASS | PASS |
| B paid retains fresh queued/running markers | PASS | PASS | PASS | PASS | PASS | PASS |
| B paid reclaims otherwise (old, boundary, terminal, missing job) | PASS | PASS | PASS | PASS | PASS | PASS |
| Reapply A → index → B; definitions, ACLs, index and ledger unchanged | PASS | PASS | PASS | PASS | PASS | PASS |
| B down removes guard; drop index concurrently; RPC interface intact | PASS | PASS | PASS | PASS | PASS | PASS |
| B down free reclaim without job guard | PASS | PASS | PASS | **FAIL** | PASS | PASS |
| B down paid reclaim without job guard | PASS | PASS | PASS | PASS | PASS | PASS |
| A down drops six RPCs/helpers; forward repair restores package and preserves ledger | PASS | PASS | PASS | PASS | PASS | PASS |
| Existing synthetic free counters and active/revoked paid entitlements preserved | PASS | PASS | PASS | PASS | PASS | PASS |

\* Retention alone is not evidence that the RC free job guard works: under en_US the RC also retained every non-live marker. The standalone range probe returned `t` under `C` and `f` under `en_US.utf8`. Under en_US, A returned `limit` with an expired marker still reserved; the repo A suite independently failed at check 6c. B left the free counters at 1 for all five non-live cases where the expected count was 0. B down left the same incorrect state. Paid reconciliation still reclaimed non-live markers, consistent with its prefix matcher.

**Concurrency and interruption:** One open transaction reserved a free slot and held the account advisory lock. Six separate sessions were observed in `pg_stat_activity` waiting for that lock before it committed. The six produced two more reservations and four limits (three marker rows and a counter of three). To interrupt mid-reserve, a synthetic trigger paused before marker insertion, after the counter update. The runner observed the pause and terminated the backend; the original counter and zero markers remained, and a new request succeeded.

**Access and compatibility:** The database tests checked function ACLs (including no `PUBLIC` grant), fixture RLS, real denied calls and reads as `anon`/`authenticated`, and successful calls as `service_role`. The runner reads the six paid/free reserve/finalize/release argument lists used by `functions/api/analyze.ts` via its credit helpers at `b9617a8` (previous), `82dfe65` (recorded production), and `dd02ef3` (RC) and verifies argument names/order, SQL types and JSONB return types in the PostgreSQL catalog. This is a database RPC contract check, not a deployed HTTP or inference test.

## SHA-256 of tested SQL files

| Migration file (under `supabase/migrations_pending_approval/`) | Audit `0888970` and fixed | Original RC `dd02ef3` |
|---|---|---|
| `free_scan_reservation_functions.sql` | `89d5e381e00800e1b654130ec32a55b22de1df691f8c40b0d9fd955e619f6e9b` | `95cdcb773313036b7aad972dc321480b2234c934bd507566d2739894f9d43b2c` |
| `reconcile_skip_live_analyzer_jobs.sql` | `9c12c84701f22b169329ea6fa2eb3ad21c81f283108de5a8e3e2bf24c504c763` | `6a97b17a03fa56f09c79a897383fcbfbf9f0cfcfaa4d6cd7cd57468e34dca3d5` |
| `free_scan_reservation_functions.down.sql` | `e01d92f439bd824d8d47a2e2ef313d0484827ffe8706c6fff77f94783a7e1d34` | `e01d92f439bd824d8d47a2e2ef313d0484827ffe8706c6fff77f94783a7e1d34` |
| `reconcile_skip_live_analyzer_jobs.down.sql` | `b8897600afe5dbfd17c6e505725cbc5a351329153393cec243c67a5d56ebb7f0` | `0dd1c212172bc09f0ae59e274d71f222b677714d71fe70052251059c62d71527` |

| Supporting SQL | SHA-256 |
|---|---|
| `supabase/migrations_pending_approval/free_scan_reservation_functions.test.sql` | `d4f66dbf058dd00263ac40cc1889afde2bd7b9585769378a50f0ba194286faae` |
| `supabase/migrations_pending_approval/paid_credit_reservation_functions.sql` | `594c42a8e6e640744c27d467da13ecd1b70512a245298c18cc68353ab11d6e69` |
| `supabase/migrations/20261104230000_durable_analyzer_queue.sql` | `d4e8f3b360608f4699ec317a314112568faa957e7d5d6ee0747445613eafea66` |
| `tests/devin/fixtures/live-nxfh-payment-schema.sql` | `53bbc69d708366dbf94c3e401b9d496e2ee8720e56d7428e68c7d0909c1f8ab7` |
| `engineering/qualification/ab/fixture.sql` | `14227565c37f5270bb418eb16f448f657c1705a83b14954246cd885e6cdf29a4` |

The hashes describe repository bytes, not the operational migration-history wrappers. The runner extracts B's commented concurrent index create/drop statements from the corresponding tested SQL blobs and runs them separately, outside transactions.

## Operational disposition

- Do not reapply A/B just to make live match this branch: the [historical verification](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/blob/16a10b08f075f62adb21029824d4c6c70b7b27a2/engineering/reviews/pr164-staging-migration-verification-20261127.md) already records the audited behavior and index on the operational project. Prefer keeping those functions if current read-only schema/ACL/history checks and independent review corroborate that evidence and the owner ratifies the decision.
- The local down/forward sequence is not a production rollback recipe. A down breaks production's free Quick RPCs. B down removes the live-job guard and is not a verified restore of pre-B live function bodies. Both leave later reservation/entitlement changes in place.
- The missing snapshot remains open. The owning organization must verify pre-apply backup/PITR availability and recover exact prior definitions if considering a restore. Before further operational migration, record the verified binding, exact SQL/version, a fresh backup or confirmed PITR, saved definitions and grants, and a recovery plan that preserves transactions created since backup. No remote database was contacted.
