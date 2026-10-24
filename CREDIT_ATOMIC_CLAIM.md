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

## 10. Release preparation (current revision)

### 10.1 Vercel function duration

- The team's plan tier is **not readable** with the tools available here (the team record has no plan field, and the billing export exceeds the tool's limits). It must be confirmed in the Vercel dashboard.
- `vercel.json` sets `maxDuration: 300` for `api/index.ts`, which serves every analyzer route.
- Published limits conflict. An older guide lists 60 s (Hobby) / 300 s (Pro) / 900 s (Enterprise). Vercel's Fluid-compute changelog lists 300 s as the default for all plans and 800 s for Pro and Enterprise. Under both, 300 s is supported on a paid plan. The older guide does **not** allow 300 s on Hobby.
- **Owner check:** confirm the plan is Pro or higher, and re-read Vercel's current "Configuring Maximum Duration" page before any deploy.

### 10.2 Pro and Community terms versus enforcement

Published copy (`src/components/PricingTab.tsx` and `api/_server.ts` plan descriptions):

- "5 Forensic In-Depth Analyses per monthly billing cycle"
- "forensic quota refreshes monthly"
- "refreshes its 5-analysis quota on every monthly renewal"

Enforcement (this revision): UTC calendar month, `paid_session_<id>_cycle_<YYYY-MM>`.

**Conflict.** "Every monthly renewal" means the allowance resets on the customer's renewal date. A calendar-month reset does not. Example: a customer who renews on the 15th and uses all five on the 1st of the month has no allowance until the 1st of the next month, not until their 15th-day renewal. In other cases, the calendar reset grants a refresh earlier than the renewal. The enforcement is therefore inconsistent with the published terms, and I have **not** changed either the copy or the enforcement.

**Decision required (recommended default: option B).**

- **A.** Keep calendar-month enforcement and change the copy to "per calendar month". Customer-facing terms change.
- **B. (recommended)** Anchor the cycle to each session's renewal date, so the copy is true as written. This needs the renewal date stored per session. The current schema does not show one, and the code change is larger.

### 10.3 Reconciliation of incomplete reservations

Two kinds of incomplete reservation exist.

| Crash point | Recovery now | Customer effect |
|---|---|---|
| After the unit is recorded (slot > 0) | Returned on the next reserve after 15 min (new in this revision: reconciled on **every** reserve, not only when full) | None after 15 min |
| After the counter moves, before the slot is recorded (slot 0) | None: the claim does not record whether the counter moved | One unit lost per crash, in a window of milliseconds |

**Atomic option.** The database cannot make the counter change and the marker write atomic through the REST API. Production has no credit-related function (verified read-only), so an atomic transaction would need a new `plpgsql` RPC. That is a new migration, which needs approval.

**Decision required (recommended default: A now, B after staging).**

- **A. (recommended, implemented)** Reconcile on every reserve. Accept the one-unit slot-0 window.
- **B.** Add a single RPC that performs the marker write, counter change and slot write in one transaction. This removes the window. It is a new function only, with no table change, but it is a database change and needs approval, plus a staging test.

### 10.4 Pending migration

- `supabase/migrations_pending_approval/paid_payments_columns_minimal.sql` (new). It adds only the four payment columns absent in production (`bank_settlement_status`, `notification_accepted_at`, `client_ip`, `user_agent`). It has been applied to a throwaway database with a stub table and is not applied to production.
- The original file is marked superseded for credit accounting in its header. It is not applied.
- Production check (read-only): `payments` has 2 rows, so the CHECK validation is negligible.
- **Decision required.** The payment columns belong to the payments work. Recommended default: the payments owner approves this minimal file in the payments PR, not in this one.

### 10.5 Staging verification procedure

**Prerequisites**

- Staging project: `nxfhvebzzobegubefcda` (paused). Restoring it may cost money, so it needs your approval before restore.
- A staging service-role key, supplied locally as an environment variable. Never paste it into chat or a PR.
- Staging must have `free_usage` (primary key `uid`) and `navigator_paid_sessions` (with `revoked_at`), matching production. No migration is needed for this change.
- Do not use a Vercel preview for testing. Previews share production variables.

**Procedure**

1. Restore staging (with approval). Confirm the URL does not contain `qboidsfpjuxeqtfotryj`.
2. Run:
   ```
   STAGING_SUPABASE_URL=https://nxfhvebzzobegubefcda.supabase.co \
   STAGING_SUPABASE_SERVICE_ROLE_KEY=<local env only> \
   npx vitest run api/services/creditStaging.test.ts
   ```
3. Expected: all six scenarios pass.
   - 12 concurrent reservations across 4 instances, 3 credits: exactly 3 reserved.
   - One request ID across 3 instances: charged once.
   - Release gives back a failed analysis's credit; a finished one keeps it.
   - Invalid service key: 503.
   - Crashed reservation on staging is reconciled by the next reserve. This exercises the prefix listing (`like` with `*`) against real PostgREST.
   - Pro quick reviews are not counted; Pro forensic counts per UTC month.
4. The test removes every row it creates (`vfy_` IDs only).
5. **Abort** if any scenario fails, or if the listing returns no reconciled row (the `*` wildcard is then wrong for this PostgREST).
6. Record the output in the PR.

### 10.6 Status

- Tests: credit suites 54 passed; full suite 3318 passed, 0 failed, 454 skipped (the staging and PostgreSQL tests skip without credentials); `tsc` clean; `npm run build` passes.
- Not performed: staging run, live Supabase verification, any production change.
