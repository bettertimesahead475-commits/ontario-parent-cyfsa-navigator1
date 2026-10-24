# Credit accounting: atomic reservations without a new table

Status: branch `fix/credit-atomic-claim` (PR #103, draft). Tested in the repository, including real PostgreSQL row guarantees. **Not verified against a live Supabase project.** No migration. Nothing applied to production.

## 1. Defects found and fixed

| # | Defect (before) | Fix |
|---|---|---|
| F1 | A reservation lived in per-process memory. Two instances could both take the last credit. | Reservations are rows in the existing `free_usage` table. The counter moves by compare-and-set. |
| F2 | The reservations table is absent in production, so its insert error was ignored and no claim happened. | No dependency on that table. |
| F3 | Retry de-duplication for per-analysis counters was in memory. | A marker row per analysis (`paid_use_…`). |
| F4 | Concurrent counter increments lost updates (20 concurrent increments produced 3 on PostgreSQL). | Compare-and-set with retry on contention. |
| F5 | Suspension and revocation were not enforced in the fallback. | Read from the session row and the `suspended_<id>` row. |
| F6 | With no database client, the balance failed open. | Fails closed (503). |
| F7 | If the per-analysis write failed, the reservation was not finalized and expired, making the analysis free. | Finalize runs regardless. |
| F8 | A retry that joined a live reservation could release the owner's unit. | Only the owner (the attempt that claimed) gets a reservation id and may release. |
| F9 | A crashed claim blocked retries for 15 minutes. | A claim that recorded no unit within 60 seconds is abandoned. Active reservations are not affected. |
| F10 | Pro and Community were gated by one lifetime total of 5. That blocked quick reviews after five, and never renewed. | Forensic analyses only, per calendar month (UTC). Quick reviews unlimited. |
| F11 | Deep Scan replays of a finished analysis ran the model again. | Refused with 409 `ANALYSIS_ALREADY_COMPLETED` before the model runs. |
| F12 | A joined retry of a running Deep Scan ran the model with no unit. | Refused with 409 `ANALYSIS_IN_PROGRESS` before the model runs. |
| F13 | A released reservation that was re-taken kept its old slot number. | The slot is zeroed in the same conditional write. |
| F14 | A lost response on a counter write could be retried into a second write. | Writes are never retried. An ambiguous write fails closed (503). |
| F15 | A failed charge write was swallowed, so a delivered analysis could become free. | Finalize throws. The result is withheld and the reservation released. |
| F16 | A billing-month boundary could move the per-analysis counter. | The reservation's billing month is passed to the per-analysis counter. |

## 2. Design

**Counters** (in `free_usage`):

- Basic and Premium: `paid_session_<id>_total`, all analysis types together (Basic 3, Premium 5).
- Pro and Community: `paid_session_<id>_cycle_<YYYY-MM>`, forensic analyses only (5 per month). Quick reviews draw on no counter.

**Markers** (in `free_usage`): `paid_res_<id>_<sha256(requestId)[0:32]>`. The `email` field holds the state, and `analyses_used` holds the claimed slot.

| State | Meaning |
|---|---|
| `reservation:reserved` / `reservation:reserved:cycle:<YYYY-MM>` / `reservation:reserved:none` | Claimed (or claiming). The suffix says which counter the unit came from. |
| `reservation:consumed` | Analysis delivered and charged. |
| `reservation:released` | Unit returned. |

**Ownership.** Only the attempt that creates or re-takes a reservation gets a non-empty `reservationId`. It is the only attempt allowed to release. A retry that joins a live reservation gets an empty id, and the route refuses to run the model for it.

**Reclaim rules.**

- A claim (slot 0) unrecorded for 60 seconds is abandoned. It is released without returning anything, since no unit was recorded.
- A reservation with a unit (slot > 0) is reclaimed only when untouched for `RESERVATION_TTL_MS` (15 minutes). The longest function run is 300 seconds (`vercel.json`, `api/index.ts`), and a test asserts the window is at least twice that.
- Reclaim runs only when the counter is full.

**Month boundary.** A reservation's unit is tied to the month in its marker state. Release decrements that month's counter, so a January reservation released in February returns to January. The per-analysis counter is also written to the reservation's month.

## 3. Failure behaviour

These outcomes are deliberate. Every residual case errs toward **under-serving** (a customer loses one unit), never toward giving out extra units.

| Crash or failure point | Outcome |
|---|---|
| After the marker is claimed, before the counter moves | Marker is reclaimed; no unit lost. |
| After the counter moves, before the slot is recorded | **One unit lost**. The claim has no slot, so reclaim cannot tell whether the counter moved. |
| Lost response on the counter write | Not retried. Request fails 503. Same as the row above: at most one unit lost. |
| Lost response on the release transition | Not retried. Unit not returned. Marker is `released`, so it cannot be returned twice. |
| Release fails after the analysis failed | Marker stays reserved and is reclaimed after 15 minutes (returned then). |
| Charge (finalize) cannot be recorded | Result withheld (503). Release runs and returns the unit, because nothing was delivered. |
| Two requests with the same id, on any instance | One owns the unit; the other gets 409 or the saved report. |

## 4. Repository changes

- `api/services/freeUsageStore.ts` (new): all `free_usage` access. Reads may retry. **Writes never retry.**
- `api/services/creditAccounting.ts`: reserve, finalize, release, sweep, balance; ownership and reclaim rules; month scopes.
- `api/services/usage.ts`: per-analysis counters, idempotent by marker, with an explicit billing month.
- `api/_server.ts`: Quick Review and Deep Scan refuse replays and joined attempts before the model runs; charge is recorded before the result is returned; the reservation's month is passed to the per-analysis counter.
- Tests: `creditAtomicClaim.test.ts` (cross-instance, ownership, crash points, claim window, monthly, lost responses), `creditAccounting.test.ts` (original behaviour), `_server.test.ts` (route refusals), `freeUsageStore.pg.test.ts` (real PostgreSQL, gated), `creditStaging.test.ts` (real Supabase, gated, refuses the production project).

## 5. PostgREST compatibility

Checked against `@supabase/postgrest-js` 2.110.0 typings and source in `node_modules`, **not** against a live PostgREST:

- `insert` returns `error.code === "23505"` for a primary-key conflict. The store relies on this for one-winner claims.
- `update(...).eq(...).eq(...).select("uid")` returns the matched rows. The store uses the row count as the compare-and-set result.
- `.retry(false)` exists on the builder (typings line 823). The library retries only GET, HEAD and OPTIONS, so writes are never retried by it.
- `like` uses PostgREST's documented `*` wildcard. Prefixes are restricted to `[A-Za-z0-9_-]`, so no escaping is needed. A `_` in a prefix is still a single-character wildcard in SQL, so listings over-match; the code filters the results by exact prefix. Rows per session are few, so the server's row cap is not reached in practice.
- **Not verified:** `*` wildcard behaviour, the 23505 code passthrough, row-return shape after update, the row cap, RLS and grants on `free_usage`. All must be checked against staging (section 6).

## 6. Verification performed and not performed

Performed:

- Credit suites: 52 tests, stable over repeated runs.
- Mutation checks: owner check removed, claim window removed, monthly scope removed, Deep Scan refusal removed. Each is caught by a test.
- Full suite: 3316 passed, 0 failed, 452 skipped (gated tests skip without credentials).
- `tsc --noEmit`: clean. `npm run build`: passes.
- Real PostgreSQL (local 16): 4 of 4 row-guarantee tests pass.

Not performed:

- Live Supabase or staging. `creditStaging.test.ts` has not been run. Restoring staging costs money and needs approval.
- Lost-response behaviour against a real network. Covered by an injected fault only.
- Clock skew between instances. Timestamps are written by the app; the reclaim window tolerates skew of minutes, not hours.

## 7. Remaining release blockers

1. **Real Supabase verification** (`creditStaging.test.ts` against staging, including the `*` wildcard and the 23505 code). Required before the first paid sale.
2. **Billing-cycle convention.** Pro and Community use the calendar month (UTC), matching the existing per-analysis convention. If the owner wants the billing anniversary, a per-session anchor is needed. This is a decision, not a bug.
3. **Pending migration.** Its reservations table and audit ledger duplicate this design and are not used by the code. Withdraw those parts (section 8).

## 8. Migration assessment

File: `supabase/migrations_pending_approval/create_paid_access_credit_ledger_and_enforcement.sql`.

- Withdraw the `analysis_credit_reservations` and `credit_audit_ledger` parts, and the `credits_*` and `is_suspended` columns. This code does not use them.
- Parts 1 and 3 (tier constraints and payment columns) belong to the payments work. Review separately.

## 9. Safest deployment order

1. Merge PR #103 only after CI is green and the owner has accepted section 7. Keep both feature flags off.
2. Run `creditStaging.test.ts` against staging (restore staging with approval). Do not use a Vercel preview for testing, because previews share production variables.
3. Deploy with the paid-analysis route unchanged from production's current behaviour. Monitor 503 and 409 rates on `free_usage`.
4. Do not apply any migration. Do not enable paid sales until steps 2 and 3 pass.
5. Rebase PR #102 on the merged result before any review of it. It touches the same credit code and the same `_server.ts` section.
