# PR #168 (T-05 rate limiter): lead-engineer pre-qualification and Claude handoff (2026-11-27)

Reviewed: commit `5f57810` (PR head). It was merged into `engineering/integration` as `1c1ac21`.
**Status: merged, not wired, not activated.**
- No route calls `persistentRateLimitRetryAfter`.
- `PERSISTENT_RATE_LIMITS` is unset.
- The migration is not applied. A read-only check on `nxfhvebzzobegubefcda` at 17:40 UTC found no `navigator_rate_limit_hits` table, no `navigator_rate_limit_hit` function and no matching migration.

This follow-up changes only `functions/api/_persistent-rate-limit.ts` and its unit test (item 5), and adds this document.
**Claude remains the qualification authority.** Items marked *Claude* are for Claude's independent check.

## Owner checklist (2026-11-27 12:32 EST)

| # | Owner item | Lead-engineer finding | Evidence | Claude |
|---|---|---|---|---|
| 1 | Independent review of `5f57810` | Prepared here; not yet done by Claude | — | **Review** |
| 2a | Database permissions | Table: RLS on; `revoke all` from `public`, `anon`, `authenticated`. Function: `security definer`, `set search_path = public, pg_temp`, EXECUTE revoked from `public`/`anon`/`authenticated`, granted to `service_role` | `rate-limit-migration.pg.test.ts` "role grants" | Verify against Supabase default privileges, which grant new tables and functions to `anon`/`authenticated`. The explicit revokes cover this. |
| 2b | Atomic concurrency | `insert … on conflict do update … where hits < p_limit` takes the row lock on the key; refusals don't increment | PG test: 40 parallel connections at limit 8 allow exactly 8. Re-run 2026-11-27 on postgres:16: **7/7 pass**, unit tests **16/16** | Verify |
| 2c | Counter expiry | Fixed window from `clock_timestamp()`; rows older than 1 day are pruned | See item 3 | Verify |
| 2d | Indexes | PK `(key_hash, window_start)` handles lookups and upserts; `navigator_rate_limit_hits_window_idx` handles pruning | Migration SQL | — |
| 2e | Rollback | `rollback_navigator_rate_limit_hits.sql` drops only the function and table. It is idempotent and touches no customer data. **Order: revert the call sites / unset the flag first, then roll back.** With the flag still on, the RPC returns 404: open buckets fall back to per-isolate limits, closed buckets refuse with 503 | PG test "rollback idempotent" | Verify |
| 3 | Expired rows can't pile up indefinitely | Bounded. Only an allowed call inserts a row (at most one), and every allowed call deletes up to 50 rows older than 1 day. When traffic stops, nothing is added. Steady state is about one day of distinct (subject, window) keys. Under contention, pruning slows but no deadlocks occurred | Disposable PG: 20,000 seeded old rows, then 1,200 allowed calls from 60 parallel sessions → 12,300 old rows deleted (about 10 per call against the nominal 50), 0 errors, 0 deadlocks | Optional: `for update skip locked` in the prune subquery to restore the full 50 per call. Not needed for correctness |
| 4 | Fallback cost and security during a DB outage | See below. **Fallback is no worse than today's production, which only has per-isolate limits** | Code read | Verify |
| 5 | Separate a real limit from an unavailable DB in HTTP responses | **Fixed in this PR.** The original code returned 429 `RATE_LIMITED` "Too many requests" when a closed bucket couldn't reach the store. That now returns 503 `RATE_LIMIT_STORE_UNAVAILABLE`, `Retry-After: 30`, "temporarily unavailable … Nothing was charged." A real limit stays 429 `RATE_LIMITED` | New `persistentRateLimitDecision` + `persistentRateLimitResponse`; 2 new unit tests (18/18 pass). `persistentRateLimitRetryAfter` keeps its contract | Verify |
| 6 | Real production DB binding | `nxfhvebzzobegubefcda` (project named "staging"). Cloudflare Pages production `STAGING_SUPABASE_URL` points there; deployment `0cc59589`, commit `82dfe65` | `pr164-staging-migration-verification-20261127.md` (branch `devin/1795797327-launch-prep`) | — |
| 7 | Request overhead on a safe preview, no paid inference | Measured from this VM against the PR #168 preview (`devin-1795799329-ratelimit-t…pages.dev`), 25 requests each. `/api/health` (no DB call): p50 87 ms, p90 105 ms. `/api/_supabase-reachability` (one Pages→Supabase `ca-central-1` HTTPS round trip): p50 90 ms, p90 111 ms. **Added: ~3 ms p50, ~6 ms p90.** Function time on postgres:16: 0.41 ms per call (1,000 calls in 409 ms). Expected total: **under ~10 ms per limited request**, capped at 1.5 s by the client timeout | Proxy measurement: the RPC can't run on the preview until the migration exists. Re-measure in a preview DB after approval | Accept the method or ask for a re-measure |
| 8 | Fold into the migration and release plan | Added as **migration C** below | — | — |

### Item 4 detail: per-bucket outage behaviour

| Bucket | Store down | Paid work possible during a DB outage? | Exposure vs today |
|---|---|---|---|
| `analyze` | open | **No.** Credit reservation needs the same DB and fails closed (503 `RESERVATION_UNAVAILABLE` / `SESSION_INVALID`) before any Anthropic call | Same as today |
| `extractText` | open | **Yes: Gemini OCR.** It needs only a Firebase token, no DB | Same as today: 20/min per uid **per isolate** |
| `transcribe` | open | **Yes: Gemini audio.** Firebase token only | Same as today: 10/min per uid per isolate |
| `adminWrite` | open | No AI; admin writes need the DB | Same as today |
| `activateCode`, `requestAccess` (+ `claimPurchase` in PR #171) | closed → 503 | No | Stricter than today |

Residual risk: `extractText`/`transcribe` Gemini spend from one signed-in account spread across isolates during an outage. Today's production carries this risk all the time, not only during outages.
Mitigation without new spend: a Gemini API key quota or budget alert in Google Cloud. Owner action; no code needed.

### Other observations (not blockers)
- The key is unsalted SHA-256 of `bucket:subject`. For IP subjects (unsigned `activateCode`), IPv4 can be brute-forced, so the stored hashes are pseudonymous, not anonymous. Rows are kept for 1 day or less.
  Optional: HMAC with a server secret.
- Fixed windows allow up to 2× a limit across one window boundary (documented in the PR).
- PR #171 (e-Transfer) adds buckets `myPayments` (open) and `claimPurchase` (closed) to the same failure-mode map. This PR doesn't restructure the map, so #171 rebases cleanly.

## Migration plan entry: C, `create_navigator_rate_limit_hits.sql`

Placed after A (`free_scan_reservation_functions.sql`) and B (`reconcile_skip_live_analyzer_jobs.sql`). Both were found applied on `nxfhvebzzobegubefcda` on 2026-11-27 16:32–16:33 UTC; owner authorization is still unconfirmed.

| | C: `supabase/migrations_pending_approval/create_navigator_rate_limit_hits.sql` |
|---|---|
| Target | `nxfhvebzzobegubefcda` (the live Pages ledger). Not `qboidsfpjuxeqtfotryj` |
| Objects | New table `public.navigator_rate_limit_hits` + index `navigator_rate_limit_hits_window_idx`; new function `public.navigator_rate_limit_hit(text, integer, integer)` |
| Existing objects touched | None. It reads and changes no customer table |
| Customer impact on apply | None until code is wired **and** `PERSISTENT_RATE_LIMITS=true`. After activation, limits apply across all isolates, so heavy users may hit them sooner |
| Prerequisites | 1. Owner written approval. 2. Claude qualification of this document and the code. 3. Supabase backup or PITR confirmed (none was taken for A/B). 4. Apply on a preview/disposable DB first and re-measure item 7. 5. A separate PR that wires the 6 call sites using `persistentRateLimitDecision` + `persistentRateLimitResponse`, qualified by Claude |
| Activation order | Apply C → deploy wired code with the flag off → set the flag in **preview** → measure → set the flag in production |
| Rollback | Unset `PERSISTENT_RATE_LIMITS` (instant, no deploy needed) → optionally revert the wiring → `rollback_navigator_rate_limit_hits.sql` |

## Claude handoff: please verify
1. The SQL in `create_navigator_rate_limit_hits.sql` at `1c1ac21`: grants, `security definer` + `search_path`, the atomic upsert guard, argument validation, prune bound.
2. `functions/api/_persistent-rate-limit.ts` on this PR's branch: decision and response split, fail-open/closed map, no subject in logs, HTTPS-only, `redirect: 'manual'`, 1.5 s timeout.
3. Items 3, 4 and 7 above: accept the reasoning and measurements, or ask for more.
4. Migration C prerequisites and rollback order.
