# PR #164 independent qualification and NAV-004 / NAV-005 reproduction details

- Date: 2026-11-27
- Author role: Chief Technical Auditor (read-only qualification; no production change, no paid inference, no migration, no deployment)
- PR: https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/164 (open; base `engineering/integration`)
- Head reviewed: `9b37cc5897b8124e48e1c3b90cf66842a336c975`
- Method: diff review of 22 files against `82dfe65`; targeted vitest run with v8 coverage; `tsc --noEmit -p .`; a synthetic redaction probe (`shared/exportRedaction.ts`); check-run listing via the public GitHub API.

Classifications: VERIFIED (reproduced by code or test in this audit), PASSED (automated test passed, scope noted), FAILED, IN PROGRESS, BLOCKED, NOT TESTED.

## 1. Results summary

| Item | Result | Evidence |
|---|---|---|
| CI on head | PASSED | check-runs on `9b37cc5`: `test` success, `verify` success (two runs), `SonarCloud Code Analysis` success, `Cloudflare Pages` success, `CodeRabbit` skipped |
| Typecheck | PASSED | `tsc --noEmit -p .` printed no errors |
| Targeted tests | PASSED | 7 files, 237 tests: `freeScanReservation.test.ts`, `creditAccounting.branches.test.ts`, `analyze-refusal-job-state.test.ts`, `forensicPdfRenderer.test.ts`, `FinalCaseAssessment.limits.test.tsx`, `_server.test.ts`, `analysis-id-ownership.test.ts` |
| Lawyer-intake privacy logging | VERIFIED (code) | `api/_server.ts` logs only `referenceNum`, `lawyerId`, `hasCity`, `detailsChars`, `receivedAt`; the SMTP failure log keeps only the reference and the error name and code. Route is served only by the legacy Express server (not live). |
| Trust-grant, access-code and gmail-agent email errors | VERIFIED (code) | `api/services/access.ts`, `api/services/gmailAgent.ts` log `errorName` and `code` only |
| Forensic PDF renderer redaction | PASSED, VERIFIED (code) | `src/utils/forensicPdfRenderer.ts` redacts a copy when `redactionEnabled` is set, independent of the caller; the test confirms no canary names, file number or free text appear in the HTML and the caller's object is not changed. Only the redacted path changed; unredacted output is unchanged by design. |
| Admin restore | PARTIAL | See finding F-1 below |
| Refused direct analyzer request | PARTIAL | See finding F-2 below |
| freeScanReservation.ts coverage | PASSED (100%), meaningfulness PARTIAL | See section 3 |
| Final Case Assessment input limits | PASSED (server-consistent) | See section 4 |
| NAV-004 | Reproduction and timing details in section 5 | |
| NAV-005 | Classification and probe in section 6 | |

No confirmed live exposure of confidential content was found in this PR.

## 2. Findings from this qualification

**F-1 (medium, admin integrity): `restoreSession` discards the column update error.**
- Location: `api/services/creditAccounting.ts:456-483` (PR head). The update to `navigator_paid_sessions.is_suspended` is destructured as `error` and then `void error;`.
- Effect: enforcement (`reserve`, `getCreditBalance`) reads the `suspended_<id>` marker and `revoked_at`, so a restored session is not blocked. But if the column update fails with a real database error, restore still reports success and `navigator_paid_sessions.is_suspended` stays `true`. The admin status read in `api/_server.ts:899` (`matchedSession.is_suspended` → `accessStatus = "suspended"`) then shows the account as suspended.
- Not covered by the new tests: the three restore tests cover marker-delete failure (503), revoked (409) and leftover marker removal with a successful column update. There is no case for a failing column update.
- Recommended repair: treat a column update error as 503 unless the error is "column does not exist" (`42703`, the fallback case the production-like DB models). Add a test for a non-42703 column error.

**F-2 (low-medium): refusal cleanup covers one refusal in tests.**
- Location: `functions/api/analyze.ts` `refuseAfterClaim` wraps the SESSION_INVALID, CREDIT_LIMIT_REACHED, RESERVATION_UNAVAILABLE (paid), UPGRADE_REQUIRED, FREE_LIMIT_REACHED and RESERVATION_UNAVAILABLE (free) returns.
- Tests: `api/analyze-refusal-job-state.test.ts` exercises only UPGRADE_REQUIRED (403) for a `created` claim, plus the `claimed` case where nothing is written. The other five refusal codes share the same wrapper but are not exercised.
- `saveJobState` return value is not checked inside `refuseAfterClaim`. If that write fails, the record remains `running`, which is the stale-record defect the change is meant to remove. Log or retry this write.

**F-3 (informational): the CI SonarCloud step now fails the job on scan failure.**
- `.github/workflows/ci.yml`: `continue-on-error` removed and a coverage-ownership check added. The PR's SonarCloud check passed, but the owner must confirm that automatic analysis is off in SonarCloud. The workflow comment says a CI scan is rejected while automatic analysis is enabled; a green check on this head does not show which configuration ran.

**F-4 (informational): `functions/api/analyze.ts` relies on RPCs not yet applied.**
- `free_reserve_scan`, `free_finalize_scan` and `free_release_scan` exist only in `supabase/migrations_pending_approval/free_scan_reservation_functions.sql`. Until that migration is applied in a given database, those calls return an error, and the code fails closed with 503. This is correct behaviour, but the owner must confirm which database the live path uses.

## 3. freeScanReservation.ts: coverage and what the tests prove

- Measured on PR head: 31/31 statements, 16/16 branches, 6/6 functions, 25/25 lines (100%). The file was 8% before this PR.
- What the `freeScanReservation` suite proves: the client maps each RPC outcome correctly (reserved, joined, consumed, limit, released, missing); retries transient failures three times with 150 ms backoff and throws after the last attempt; fails closed with 503 on transport or database errors; refuses to release for the wrong account or a forged reservation id; and refuses to deliver an unfinished scan.
- What they do not prove:
  1. **The RPC is mocked.** `db.rpc` is an in-memory JavaScript model. The "concurrent" tests run as separate JavaScript turns in one event loop; they test the client's handling of outcomes, not database concurrency.
  2. **The database guarantees live in SQL that no CI job runs.** `free_scan_reservation_functions.sql` uses `pg_advisory_xact_lock(hashtextextended(p_uid, 0))` plus `select ... for update` on `free_usage`, which is the real per-account serialization. The verification script `free_scan_reservation_functions.test.sql` (167 lines) must be run manually against staging with the migration applied. Nothing in the repository shows that it has been run.
  3. The model's TTL expiry is an injected `expire()` call, not the SQL's `p_ttl` comparison.
- Financial integrity verdict: the client logic is well tested and fails closed. Financial integrity at the database layer is **NOT TESTED** in this PR. Required before relying on it: run the SQL verification against staging with the migration applied, and record the result.

## 4. Final Case Assessment input limits

- Server rule (`functions/api/final-case-assessment.ts:157-158`): the source text is the join of `'[' + id + '] ' + document + ' page ' + page + '\n' + text` entries with `'\n\n'`; the total `.length` must be at most 75,000.
- Client helper (`shared/assessmentLimits.ts` `sourceSetEntryLength`): `1 + 64 + 2 + filename.length + ' page 1\n'.length + text.length`, which matches the server's per-entry length. Page is always 1 for `.txt` uploads, and the server requires `page === 1`.
- Gap (low): the helper does not count the `'\n\n'` separator between entries (2 characters per boundary). The server is authoritative, so no document is wrongly accepted; the only effect is that a multi-document matter can be refused by the server with the set-level message rather than caught on the client.
- Verified by test: a 75,000-character body with a name is refused on the client with the name-inclusive count (75,080 in the test) and the message now states that the name counts toward the total.

## 5. NAV-004: verification replay excludes startup overhead

Status: **REPAIRED IN PART** in PR #164 (the replay now includes startup and storage latency). Remaining gaps are listed below. These are the owner's requested reproduction details. All timings are modeled in the replay, not measured live. No paid inference was spent.

### 5.1 Exact code locations (PR head 9b37cc5)
- Replay test: `api/forensic-lifecycle-replay.test.ts` — `PRODUCTION_MS` table, `lifecycle()`, and the `production timings` case.
- Section timeouts: `api/services/analyzerSections.ts:913` (`SECTION_TIMEOUT_MS` fast 75,000 ms, full 110,000 ms), `:916` (`FORENSIC_SECTION_TIMEOUT_MS` redFlags 145,000 ms).
- Clamp to the shared deadline: `api/services/analyzerSections.ts:938-942` (`timeoutMs = min(sectionLimit, deadlineAt - now - 3,000)`) and `:1244-1255`.
- Reservation TTL: `api/services/creditAccounting.ts:32` (`RESERVATION_TTL_MS = 15 min`). The SQL (`free_reserve_scan`) reclaims an expired reservation, so queue wait counts against this TTL.
- Lease: `functions/api/_durable-analysis-jobs.ts:224` (`claimDurableJob`, default `leaseSeconds = 240`).
- Consumer: `workers/analyzer-queue-consumer.ts:137-225` (lease held by token; ack only on completion; unacknowledged messages are redelivered).
- Queue settings: `wrangler.analyzer-queue-staging.jsonc` (`max_batch_size 1`, `max_batch_timeout 1`, `max_retries 5`, `retry_delay 20`, `max_concurrency 2`, dead-letter queue configured). Production consumer config `wrangler.production-analyzer-queue-consumer.jsonc` has `ANALYZER_ENABLED "false"` and no consumer attached (not live).

### 5.2 Reproduction procedure (offline; no inference or queue traffic)
1. `git checkout 9b37cc5` (or a worktree at that commit), `npm ci --ignore-scripts`.
2. `NODE_OPTIONS=--no-experimental-webstorage npx vitest run api/forensic-lifecycle-replay.test.ts`.
3. Expected: the `production timings` case passes with `endedAt = 133,900 ms`, `overview` start `95,350 ms`, overview timeout `81,400 ms`; with the SLOW latency profile, overview timeout `74,500 ms`; both complete with `status: completed`.
4. Negative control: set `STARTUP` to 0 or drop the storage latency and confirm the overview timeout grows (the startup-overhead defect the test now guards).

### 5.3 Timing measurements (from the replay's `PRODUCTION_MS` table, typical latency RPC 250 ms, storage 600 ms)

| Stage | Modeled duration |
|---|---|
| Worker startup (before `processJob`) | 1.0 s |
| Claim, persisted-report check, input load, first progress write (`aiStart`) | 2.6 s |
| redFlags | 92.5 s |
| thresholds | 37.7 s |
| chronology | ~81.3 s (1.5 s + 7.5 s/94 tokens scaled) |
| guidance | 57.8 s |
| timeline | 45.3 s |
| overview (starts at 95.35 s) | 36.7 s |
| forensic verification | 30.0 s |
| **Worker execution end (wall)** | **133.9 s** |

Under SLOW latency (RPC 2 s, storage 4 s), the overview timeout falls to 74.5 s and the run still completes verified.

### 5.4 Queue waiting time vs Worker execution time (distinguish them)
- **Worker execution time** (above): ~134 s typical for a Forensic run; deadline assumptions: 15-minute Worker wall limit (`QUEUE_WALL_MS` in the replay; not verified against the Cloudflare plan limit in this audit), 240 s lease, section and overall deadline clamps.
- **Queue waiting time** (not modeled): time from `ANALYZER_JOBS_QUEUE.send` to delivery. With `max_concurrency 2` and one message per batch, a job behind N earlier jobs waits roughly `ceil((N+1)/2) × execution time` ≈ 134 s per round. Two Forensic jobs queued behind another run wait about 134 s before their own 134 s execution, so the user sees ~270 s.
- **Reservation interaction:** the reservation's 15-minute TTL starts at reservation, so a job waiting more than ~15 minutes can have its reservation reclaimed by a later reservation in the same account. The consumer already handles `released`/`missing` (`workers/analyzer-queue-consumer.ts:75-87`), but the owner should know the threshold.
- Delivery retries: `retry_delay 20` s, `max_retries 5`. A lease held by a prior Worker is kept alive until it finishes or expires (240 s).

### 5.5 Gaps still open in NAV-004
1. Queue delivery latency is not in the replay (it starts at `processJob`).
2. Submit-time credit reservation RPCs are not modeled for untrusted jobs.
3. The 15-minute Worker wall limit and the 240 s lease are assumed constants, not checked against the deployed configuration.
4. The earlier 60-second Forensic target is not met; modeled execution is ~134 s.

### 5.6 Proposed acceptance criteria
- A: the replay's `production timings` case passes with `endedAt ≤ 15 min` and no lease gap ≥ 240 s, and fails if startup or storage latency is removed.
- B: a queued-job test with N = 3 Forensic jobs and `max_concurrency 2` asserts that the third job's queue wait is ≥ one execution time and that its reservation TTL is not exceeded, or the job is refused with a retryable code before running.
- C: the live staging measurement records `send` time, first `running` write, `completed` write, and the reservation timestamps for at least one Forensic run and one Quick run. Measurements are taken only with owner approval for inference spend.
- D: the deadline constants (15-minute wall, 240 s lease, 15-minute TTL) are sourced from one module and cross-referenced in the test, so a configuration change fails the test.

## 6. NAV-005: redacted reports lose meaningful findings and excerpts

Status: **PRESENT, by design** in PR #164 (not repaired). Confirmed by the synthetic probe below.

### 6.1 Code locations
- `shared/exportRedaction.ts:42-61` (`redactNode`): every string not under a `STRUCTURAL_KEYS` key or a valid `CITATION_KEYS` value is replaced with `[removed from redacted copy]`.
- `shared/exportRedaction.ts:20-37`: `STRUCTURAL_KEYS` accept any string value, with no validation of content.
- `src/utils/finalAssessmentExport.ts:59-72`: `FINDING_WITHHELD` and `EXCERPT_WITHHELD` replace finding text and excerpts; the `neutralized` helper keeps counts.

### 6.2 Synthetic probe (run in this audit; all values synthetic)
Input (fictional):
```
id "rf_1", type "redFlag", kind "procedural", classification "Procedural", severity "high",
category "disclosure", status "verified", confidence "high", verdict "supported",
title "Synthetic delay in disclosure", quote "Synthetic quote text", legalReference "CYFSA s. 74(2)",
citationStatus "verified", supportingEntryIds ["e1","e2"], pageNumber 3, date "2026-01-05",
metadata { fileNumber "FC-SYN-1" }
```
Output of `redactForExport`:
```
id "rf_1", type "redFlag", kind "procedural", classification "Procedural" → kept per STRUCTURAL_KEYS
severity → "[removed from redacted copy]"
category → "[removed from redacted copy]"
status → "[removed from redacted copy]"
confidence → "[removed from redacted copy]"
verdict "supported" → kept
title, quote → "[removed from redacted copy]"
legalReference "CYFSA s. 74(2)" → kept
citationStatus "verified" → kept
supportingEntryIds → kept
pageNumber 3 → kept
date → "[removed from redacted copy]"
metadata → {}
```
Note: `type` is kept but the output shows `classification` kept too, consistent with `STRUCTURAL_KEYS`. The probe confirms that controlled-vocabulary fields (`severity`, `category`, `status`, `confidence`) and `date` are removed although they are not free text.

### 6.3 Field-by-field classification

**A. Safe to remain in redacted reports (no change needed)**
- Identifiers: `id`, `ids`, `legacyId`, `sectionId`, `findingId`, `allegationFindingId`, `supportingEntryIds`, `contraryEntryIds`, `disputedByFindingIds`.
- Enum and structural labels: `kind`, `type`, `concern`, `classification`, `citationStatus`, `recordKind`, `scoring`, `verdict`, `eventType`, `verifiedBy`, `schemaVersion`.
- Legal references that match `^(CYFSA\s+)?s\.\s*\d+(\(\d+\)|\([a-z]\))*$` (for example `CYFSA s. 74(2)`).
- Numbers and booleans: `pageNumber`, counts, scores, timestamps of processing (not event dates).
- Verification status objects (`forensicVerification.status`).
- Empty strings (already kept deliberately).

**B. Requires selective redaction (currently removed; a restoration candidate only with a strict allowlist)**
- `severity`, `category`, `status`, `confidence` when the value is in a fixed set (for example `low | medium | high | critical`). Allow only exact enum members; any other string stays removed.
- `date` (event dates): keep year and month only (`2026-01`), or keep the full date only when the report is not a private-party export. The owner decides the rule; the default is year-month.
- Source references: `document` renamed `Source document N` (already). Keep `page` and `id`.
- Section headings and labels that come from a fixed list in the code (`FINAL_ASSESSMENT_SECTIONS`).

**C. Must be removed entirely (never restored)**
- Every free-text string: `title`, `quote`, `summary`, `fileSummary`, parents' own words, `details`, finding narrative, excerpts (`EXCERPT_WITHHELD`), document text.
- Names, file numbers, addresses, email addresses, phone numbers, court or hearing details, and `documentTitle` / file names (`metadata` is dropped whole).
- Any string placed under a structural key that is not a validated enum (see gap G-2).

### 6.4 Privacy gaps that must be fixed alongside any restoration
- **G-1:** `STRUCTURAL_KEYS` accept any string. A quotation placed under `kind`, `concern` or `verdict` would pass through. Fix: validate each structural key against its enum or pattern, and redact on mismatch (default deny).
- **G-2:** the `CITATION_PATTERN` allows `CYFSA s. 74` only. Confirm that no citation key carries prose; add a test with `legalReference: "parent's statement, s. 74"` that must be redacted.
- **G-3:** the export notice says the copy "is not guaranteed to be anonymous". Keep this notice on every redacted output.

### 6.5 Regression acceptance criteria (for the repair owner)
1. Canary test: a synthetic fixture with canary strings in every free-text key returns no canary in the redacted output (existing tests cover part of this; extend to every key in section 6.3-C).
2. Enum preservation: `severity: "high"`, `category: "disclosure"` survive; `severity: "Jordan Syntheticparent"` is redacted.
3. Finding count and order are preserved, and each finding retains `id`, `kind`, `classification`, `legalReference` (when valid) and `supportingEntryIds`.
4. FCA: `FINDING_WITHHELD` and `EXCERPT_WITHHELD` replace text; counts per section are unchanged.
5. Default deny: a new string key not in any list is redacted (existing behaviour; keep it).
6. Structural key validation (G-1) with a test that prose under a structural key is redacted.

## 7. Requests to Devin (for PR #164 and follow-up)
1. Repair F-1 (restore column error) and add a test for a non-42703 column error returning 503.
2. Add the five missing refusal-code cases to `analyze-refusal-job-state.test.ts`, and check the result of the `saveJobState` write in `refuseAfterClaim`.
3. Confirm which database the free-scan RPCs run against, and run `free_scan_reservation_functions.test.sql` on staging with the migration applied. Record the result in the TEST_REGISTER.
4. Confirm the SonarCloud automatic-analysis setting before merge.
5. NAV-004: implement acceptance criteria A–D in section 5.6.
6. NAV-005: implement the classification in section 6.3 and the regression criteria in section 6.5. Do not weaken redaction to meet a usefulness target.

## 8. Not tested in this audit
- Live Cloudflare queue timing and the Worker wall-clock limit (no dashboard access; no live run).
- Real database behaviour of the SQL reservation functions.
- Browser flows, PDF export on a real browser, and any paid inference (none spent).
