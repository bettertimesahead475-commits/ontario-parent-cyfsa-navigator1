# PR #164 final independent qualification, head 067446ab96027f9fc09a606af213e236c4ff5a13

- Date: 2026-11-27. Role: Chief Technical Auditor. Read-only. No migration, deployment or paid inference was executed.
- Determination: **Code: PASS for the six remediation items. Release: BLOCKED** pending the owner decisions D1 and D2 below.

## 1. Checks performed
| Check | Result |
|---|---|
| PR head and CI | Head 067446a. Checks `test`, `verify` (x2), SonarCloud, Cloudflare Pages all success; CodeRabbit skipped. SonarCloud quality gate passed with 1 new issue (reported by Devin as fixed in 9f67f99). |
| Typecheck | `tsc --noEmit -p .` clean. |
| Targeted tests (11 files, 178 tests) | PASS: creditAccounting.branches, analyze-refusal-job-state (all six refusal codes), FinalCaseAssessment.limits, exportRedaction.allowlist, exportRedaction, analyzer-deadlines-config, freeScanReservation, forensicPdfRenderer, forensic-lifecycle-replay, queue-progress-heartbeat, cloudflare queue/FCA worker tests. |
| PostgreSQL suites | Not re-run here (no local PostgreSQL). CI `test` job has a postgres:16 service and is green. Devin reports 13/13 free-scan, 13/13 paid, 26/26 total. Accepted as CI evidence; not independently reproduced. |
| Live database routing | Verified. See section 2. |
| Live database state (read-only catalog queries) | Verified. See section 3. |
| NAV-005 probe on head | Verified. Enum values and citations kept; names and dates removed; structural keys with prose are redacted (`kind` sentence and `concern` removed). |
| FCA source reuse | Verified. Source keys are scoped by owner digest and matter; a 409 (or 400 with statusCode 409) is treated as reused. Client set length adds separators as the server does. |
| PDF metadata | Verified. Redacted copy: `<title>` is "Forensic Deep Scan — Confidential Case Document Audit"; the file label is "Analysis report". Unredacted output is unchanged by design. |
| Cloudflare queue settings | Matches `shared/analyzerDeadlines.ts`, wrangler configs and `engineering/evidence/cloudflare-queue-config-20261127.json` (read-only Cloudflare evidence, Devin). |

## 2. Which Supabase database the live Cloudflare application uses
- Every Pages function reads `STAGING_SUPABASE_URL` (credits, free scans, paid sessions, analyzer jobs, admin store, FCA source store).
- The live domain `https://cyfsanavigator.com/api/_supabase-reachability` returns `upstreamStatus 401` from `https://nxfhvebzzobegubefcda.supabase.co/auth/v1/health`. The code accepts only that exact host, so the live Pages binding is the **staging project `nxfhvebzzobegubefcda`**.
- Production project `qboidsfpjuxeqtfotryj` is not referenced by any Pages function. It is used only by the legacy Express server (`api/services/*` via `SUPABASE_URL`) and the owner's older AUDIT notes.
- Conclusion: **live credits, free-scan counters, paid sessions and analyzer job records are stored in the staging project.** The production Pages environment and the staging project are the same data path.
- `CREDIT_ATOMIC_CLAIM.md` (line 80) says the staging project was paused. It now responds. Its current status needs checking.

## 3. Live state of the staging database (read-only; schema only, no rows read)
- Reservation functions exist: `free_reserve_scan`, `free_finalize_scan`, `free_release_scan`, `free_reconcile`, `free_release_marker`, `free_marker_uid`, `paid_reserve_credit`, `paid_finalize_credit`, `paid_release_credit`, `paid_reconcile`, `paid_release_marker`.
- `free_reconcile` **does not contain the prefix fix** (`left(uid, …)`) that the repository's pending migration applies. Under the en_US collation the old range never matches, so expired free-scan reservations are not reclaimed. `paid_reconcile` does contain the fix.
- Neither `free_reconcile` nor `paid_reconcile` contains the live-job skip from `reconcile_skip_live_analyzer_jobs.sql`.
- `navigator_paid_sessions` has `revoked_at` but **not** `is_suspended`, `suspended_at` or `suspended_reason`. The restore and suspend paths therefore run on their legacy fallback (suspension marker in `free_usage`), which F-1 now handles.
- `analyzer_jobs` has the `reservation_id`, `status`, `updated_at` columns the reconcile migration needs.

## 4. Remediation items
| Item | Status | Notes |
|---|---|---|
| F-1 admin restore | PASS | Non-legacy column errors return 503; 42703 and PGRST204 take the legacy marker path. Staging uses the legacy path. Test covers both. |
| F-2 refusal persistence | PASS | `refuseAfterClaim` retries the failed-state write and logs `[ANALYZER_REFUSAL_STATE_UNSAVED]` (ids and code only). All six refusal codes are tested. Nothing is charged. A `claimed` (earlier) record is untouched. |
| FCA separators and duplicate reuse | PASS | Client set length matches server join. Duplicate upload returns `reused: true`. |
| Free-scan SQL concurrency | PASS in CI and Devin's PostgreSQL run; **repository files correct; staging DB stale** (see D2) |
| NAV-004 | PARTIAL | Deadlines centralized and tested. Queue-wait model: N=3 jobs with concurrency 2 finalize inside the TTL. Gap: a job retried through all five deliveries can exceed the 15-minute TTL and lose its credit; closed only by `reconcile_skip_live_analyzer_jobs.sql` (not applied). The consumer logs `[ANALYZER_RESERVATION_PAST_TTL]`. |
| NAV-005 | PASS | Per-key validated allowlists, dates never pass, default deny. Analytical enum values kept. |
| Real-PG free-scan defect (found by Devin) | Fixed in repository | Prefix match. Not yet in the staging database. |

## 5. Determinations
- **Code at 067446a: PASS.** No defect in the six remediation items. The changes are tested, typecheck is clean and CI is green.
- **Release: BLOCKED** on:
  - **D1 (owner decision):** confirm that the staging project `nxfhvebzzobegubefcda` is the intended live credit and job ledger for launch. If it is not, the production Pages binding and data path must be redesigned, which is a larger change than this PR.
  - **D2 (owner authorization):** apply the repository reservation and reconcile migrations to that database in the order in section 6. Until then, expired free-scan reservations are not reclaimed (a customer loses a free scan after an abandoned attempt), and long queue waits can lose credit.

## 6. Genuine blockers vs minor improvements
**Genuine blockers (launch):**
1. D1 (ledger location) and D2 (migration of the live credit ledger). Both need owner sign-off; neither is a code change.

**Minor, do not block launch:**
- `saveJobState` retry loop: already in place; a double write failure is logged, and the stale record times out through `effectiveJob`.
- `p_now` comes from the application clock, not the database clock. Consistent within one clock source; low risk.
- Marker rows share `free_usage` with account counters, so any admin count of `free_usage` rows includes markers. Check the admin counts before launch (minor).
- `down.sql` for reconcile restores the prefix version, not the staging database's current `free_reconcile`. Rolling back would change behaviour. Record this if rollback is needed.
- The 15-minute Worker wall limit is asserted in `shared/analyzerDeadlines.ts`; confirm it against Cloudflare's current queue consumer limit before launch.
- Modeled timings (replay): Forensic execution ~134 s; live staging measurement still needs spend approval.

## 7. Safe migration and deployment sequence (for owner approval; nothing executed)
Pre-steps (read-only):
1. Record `pg_get_functiondef` md5 for every reservation function on staging. Compare against the repository files. Record the result in TEST_REGISTER.
2. Record counts only: `free_usage` rows by marker state (`reservation:%`, `reservation:consumed`), and `analyzer_jobs` by status. No customer rows.

Migrations (owner authorization required; each needs a fresh backup or snapshot first):
3. Verify `paid_credit_reservation_functions.sql` matches staging (paid_reconcile already has the fix; confirm the rest). Apply only if it differs.
4. Apply `free_scan_reservation_functions.sql`. It uses `create or replace` and changes no rows. Expected effect: expired free reservations are reclaimed.
5. Run `free_scan_reservation_functions.test.sql` **only on a disposable database**, not on staging (it writes and deletes test rows).
6. Create the index on its own, outside a transaction: `create index concurrently if not exists analyzer_jobs_live_reservation_idx on public.analyzer_jobs (reservation_id) where status in ('queued','running');`
7. Apply `reconcile_skip_live_analyzer_jobs.sql` after steps 3–4. Confirm the definitions with `pg_get_functiondef`.

Application:
8. Deploy head 067446a to the Cloudflare **preview** only. Verify `/api/status` and `/api/_supabase-reachability` (expect the staging host).
9. One free scan and one paid scan, with owner-approved inference budget. Verify markers move from `reserved` to `consumed`, and that a deliberately expired reservation is reclaimed.
10. Promote to production only per `engineering/RELEASE_CHECKLIST.md`, recording the current live deployment (`0cc59589`, commit `82dfe65`) and the rollback candidate (`4c902955`, commit `b9617a8`) first.

Rollback: revert the application deployment first, then run the matching `.down.sql` files in reverse order (reconcile, then free scan). Never drop the functions while the application that calls them is live.

## 8. Requests to Devin and the owner
- Devin: none blocking. Optional: record the staging database function md5 values in the register.
- Owner: decide D1 and D2 (section 5). Authorize steps 3–7 only after a snapshot. Decide the spend for the live NAV-004 measurement (step 9).

## 9. Application record (owner authorization received 2026-11-27: D1 and D2 confirmed)

Staging project `nxfhvebzzobegubefcda` (live credit ledger) was changed as follows. No production project (`qboidsfpjuxeqtfotryj`) was touched. No row was written by any step.

Pre-change state (read-only, recorded before any change):
- `free_reconcile` used the range `uid >= lo and uid < hi` (no prefix fix, no live-job skip).
- `paid_reconcile` already had the prefix fix; `paid_release_marker` matched the repository body. The paid pending file was therefore not re-applied.
- `free_reserve_scan` matched the repository body.
- `free_usage` marker counts: reserved 8, consumed 2, released 6; counter rows 7.

Applied, in order:
1. `free_scan_reservation_functions` (migration name `free_scan_reservation_functions_pr164`). `free_marker_uid`, `free_release_marker`, `free_reconcile` (now prefix-fixed), `free_reserve_scan`, `free_finalize_scan`, `free_release_scan`; grants: service_role only.
2. `create index concurrently analyzer_jobs_live_reservation_idx` on `analyzer_jobs (reservation_id) where status in ('queued','running')`. Result: valid.
3. `reconcile_skip_live_analyzer_jobs` (migration name `reconcile_skip_live_analyzer_jobs_pr164`). `paid_reconcile` and `free_reconcile` now skip markers of live analyzer jobs; grants: service_role only.

Verified after the change (catalogue reads):
- `free_reconcile` and `paid_reconcile`: prefix fix present, live-job skip present.
- EXECUTE for anon and authenticated: false on all reservation functions; service_role: true.
- Marker counts unchanged: reserved 8, consumed 2, released 6; counter rows 7.

Behaviour change to note: the 8 `reservation:reserved` markers are now reclaimable. When an account next reserves a scan, any of its expired markers are released and their units return to that account's counter. This is the intended fix and gives back free scans, but it happens at runtime, not at apply time.

Not done (still required before release):
- Deploy head 067446a to the Cloudflare preview only and verify `/api/status` and `/api/_supabase-reachability` (steps 8-9 of section 7).
- Production promotion remains a separate decision (step 10). Production Pages is still `0cc59589` (commit `82dfe65`).
- Provider-level backup: no Supabase backup was created by this audit. The rollback path is the repository `.down.sql` files; the pre-change function definitions are recorded in this section.
