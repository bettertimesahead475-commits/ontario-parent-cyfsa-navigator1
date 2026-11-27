# Agent A handoff: analyzer accuracy, performance, reliability and queue recovery

Date: 2026-11-26/27 · Base: `devin/1795744800-exports-integration` (`8dc7a93`, PR #147) · No merge, deploy, migration,
Supabase binding, customer-record or balance change · Synthetic documents and mocked inference only (no paid AI calls).

## PRs

| PR | Branch | Code commit | Scope |
|---|---|---|---|
| #148 | `devin/1795744371-analyzer-compact-locator` | `11755a4bd3243f12419f9faeb298ec42224f47bd` | PR #142 compact quote locator ported onto the release-candidate quote rules; report cache carried over unwired |
| (this PR) | `devin/1795744614-analyzer-queue-heartbeat` | `eda49ed15aadf441fc8a202d7a461f0534b13d4f` | Queue Worker progress heartbeat no longer abandons a healthy run; claim and retry diagnostics |

### #148: compact quote locator (DEVIN-PERF-04)

- Replaces #142's conflicting `shared/quoteVerification.ts` with a port onto the base's quote rules (compound words,
  hyphen vs. dash, negating word, contractions, soft hyphen/zero-width, combining marks, surrogate pairs).
- Exactness gate: `tests/devin/quote-locator-rc-differential.test.ts` requires output identical to a frozen copy of the
  base locator (`tests/devin/fixtures/quoteVerificationRc147.ts`) over 48,000 seeded cases, the 12 release-candidate defect
  cases and a 200-page document. Deleting the dash/hyphen source-character check makes it fail.
- Measured locally (Node 22, 591k-character synthetic document): 56.8 MB → 12.4 MB retained per locator; 705 → 151 ms for
  3 locators × 25 variant quotes. Worker isolate memory is not measured.
- `functions/api/_report-cache.ts` is **not wired**; `supabase/migrations_pending_approval/*navigator_report_cache.sql` is
  **not applied** (PostgreSQL test skipped without `CREDIT_PG_URL`).
- #142's `src/utils/api.ts` change was not taken: the base already has its polling work and a 30-minute poll window.

### This PR: queue progress heartbeat

Defect (`workers/analyzer-queue-consumer.ts`): the Worker's `onProgress` callback awaited `persistJobUpdate`, which throws
on any ledger failure. `executeAnalysis` awaits `onProgress` at each section completion, so one transient Supabase RPC
failure (5xx, or the 8-second transport timeout) during a 3-minute Forensic run rejected the analysis: the run was
abandoned, the inference spent so far was wasted, and the job was redelivered from the start.

Fix:
- Transient write failure (RPC throws): logged as `[ANALYZER_PROGRESS_WRITE_FAILED]` (stage, error class, delivery
  attempt) and the analysis continues. This is safe: the `completed` write still requires this Worker's token, the report is
  persisted under the job ID before finalization, and finalization is idempotent.
- Write that matched no row (RPC returns `false`: lease expired and another Worker claimed it): throws `JOB_LEASE_LOST`
  (retryable), as before, so a second concurrent run is not continued. No credit is finalized or released.

Diagnostics for the 2026-11-26 incident's open question ("why the 14:51 run needed three redeliveries"):
- `[ANALYZER_JOB_CLAIMED]` `{mode, jobAttempt, deliveryAttempt, paid}` on every claim.
- `[ANALYZER_JOB_RETRY_SCHEDULED]` `{code, httpStatus, mode, jobAttempt, deliveryAttempt, delaySeconds}`. A retryable
  analyzer response (for example a section still truncated after its retry, `AI_RESPONSE_INVALID`) was previously retried
  with **no log line**; only consumer exceptions were logged.
- A claim line with no retry, failure or completion after it identifies a Worker stopped by Cloudflare (CPU, memory or
  wall time). No job ID, uid, document text or key is logged.

Tests: `tests/devin/queue-progress-heartbeat.test.ts` (4 tests; all 4 fail on the base, pass with the fix).

## Verification (this PR, `eda49ed`)

- `npx tsc --noEmit -p .`: clean.
- `NODE_OPTIONS=--no-experimental-webstorage npx vitest run`: **311 files passed, 14 skipped (325); 4,683 tests passed,
  506 skipped (5,189)**.
- #148 at `11755a4`: 312 files passed, 15 skipped (327); 4,690 tests passed, 512 skipped (5,202).
- CI: SonarCloud and the three Vercel checks also fail on PR #147 (base); Vercel is the known obsolete-integration noise
  in `engineering/BLOCKERS.md`.

## Reviewed, no defect found (no change made)

- Credit lifecycle in the queue: retryable failures keep the reservation (`release()` is skipped for `trustedJob`);
  permanent failures release only after the `failed` state is written; a release that cannot be confirmed leaves the job
  `failed` and the redelivery releases it (`!job` → `failed` → release → ack). Persisted-report recovery finalizes before
  `completed`; a reservation that expired (15-minute TTL) is delivered uncharged rather than retried forever.
- Claim/lease: `analyzer_claim_job` only claims `queued` or lease-expired `running` jobs; `analyzer_update_job` only
  writes with the matching token. A delivery that finds a live lease waits (30–240 s) without starting a second run.
- DLQ: live lease → wait; persisted report → finalize + complete; `attempt_count < 6` → requeue; otherwise fail + release.
- Ownership: `jobOwnerConflict` fails closed (anything other than `clear` is a conflict).
- Client polling (`src/utils/api.ts`): 30-minute window, in-flight read sharing, 404/pending never treated as failure,
  non-transient errors stop immediately.

## Open (needs access this session does not have)

- Cause of the 14:51 redeliveries: needs Workers logs (BLOCKERS). After this PR deploys, the new claim/retry lines answer
  it for the next occurrence.
- Staging validation of the locator's isolate memory and of a real Forensic run (needs approved inference budget).

## Follow-up 2026-11-26: Forensic overview-last budget and preview readiness

### 1. Can overview, dispatched last, exceed the Forensic budget? (evidence only, no code change)

Test: `api/forensic-budget-overview-last.test.ts` (mocked inference, fake timers; same model as
`api/forensic-budget-replay.test.ts`: incident section durations, chronology 1.5 s TTFT + 94 tok/s, 30 s verification,
178 s AI deadline; real dispatch order redFlags, thresholds, chronology, guidance, timeline, overview; concurrency 3).

| Scenario | Result |
| --- | --- |
| Production timings | Overview starts at 92.5 s (in the slot redFlags frees) with an 82.5 s timeout (178 − 92.5 − 3); needs 36.7 s. Run finishes ~45 s inside the budget. |
| Overview alone slower | Overview fails only at ≥ 2.25× its production duration (> 82.5 s). |
| Every section uniformly slower | First loss is **redFlags** at 1.20×: attempt 1 hits the 110 s `SECTION_TIMEOUT_MS.full`, its retry gets ~64 s. Overview still completes. |

Conclusion: at the recorded production timings overview-last cannot exceed the budget, and under a uniform slowdown it
is not the section that fails first. A last-section floor or duration-based dispatch would not change either result, so
no scheduling fix is made. The section most exposed is redFlags (92.5 s of a fixed 110 s timeout, 84 %); any change
there is a timeout-policy decision for the lead engineer, not part of this evidence PR.

### 2. Preview `/api/status` reports `analyzerReady:false`, `forensicQueueReady:false` (read-only; nothing changed)

`analyzerReady` = `ANALYZER_ENABLED === "true"` and `FIREBASE_PROJECT_ID`, `STAGING_SUPABASE_URL` set and
`STAGING_SUPABASE_SERVICE_ROLE_KEY`, `ANTHROPIC_API_KEY` in their public key formats (`providerKeyStatus` in
`functions/api/_status.ts`). `forensicQueueReady` = `analyzerReady` and the `ANALYZER_JOBS_QUEUE` producer binding.

Read-only Cloudflare API check of Pages project `cyfsa-navigator-git-staging`, preview environment (names and types
only; secret values are not readable):
- Present: `ANALYZER_ENABLED` (`"true"`), `FIREBASE_PROJECT_ID`, `STAGING_SUPABASE_URL` (both non-empty),
  secrets `ANTHROPIC_API_KEY`, `STAGING_SUPABASE_SERVICE_ROLE_KEY`, `GEMINI_API_KEY`, `SESSION_SECRET`, queue producer
  `ANALYZER_JOBS_QUEUE`. The latest preview deployment (`a548d5f2`, commit `732c735`) was built with all of them.
- Not present in preview (present in production): `ADMIN_SECRET`, `GEMINI_OCR_MODEL`. Neither affects readiness.

No variable or binding is missing. Every non-secret condition passes, so `analyzerReady:false` means
`STAGING_SUPABASE_SERVICE_ROLE_KEY` and/or `ANTHROPIC_API_KEY` holds a value that is not a valid key, matching
BLOCKERS B-4 ("Preview environment secrets are placeholders"). `forensicQueueReady:false` follows from it; the queue
binding itself is present. This is expected for preview, not a code defect. Which of the two secrets it is appears in
the `[CONFIG_SECRET_UNUSABLE]` log line `/api/status` writes (Pages Functions logs), or in the admin diagnostics,
which need `ADMIN_SECRET` (not set in preview). Fix = B-4: set real test-scoped values for those secrets (owner approval).

### Verification (this follow-up)

- Test commit `c3021d4` on `devin/1795745198-analyzer-forensic-budget-evidence` (base `772eacf`, with #148 and #149
  merged): `npx tsc --noEmit -p .` clean; full Vitest **314 files passed, 15 skipped (329); 4,699 tests passed,
  512 skipped (5,211)**; the new file passes 3/3.
- No Cloudflare, Supabase, secret, binding or deployment change; Cloudflare access was GET-only.

## Follow-up 2026-11-26: redFlags section limit raised to 145 s (total Forensic budget unchanged)

Change (`api/services/analyzerSections.ts`): `FORENSIC_SECTION_TIMEOUT_MS = { redFlags: 145_000 }`; every other
section keeps `SECTION_TIMEOUT_MS` (fast 75 s, full 110 s). Each attempt is still clamped to `remaining − 3 s`, the
178 s AI deadline, dispatch order and concurrency 3 are unchanged. 145 s is the most that still leaves verification its
30 s minimum start budget when redFlags starts at t = 0 (178 − 145 = 33 s). Giving the retry the remaining budget
instead would not help: after a 110 s timeout only ~64 s remain, less than redFlags' 92.5 s production duration.

Replay (`api/forensic-budget-overview-last.test.ts`, production timings, mocked inference):

| Slowdown | Before (110 s) | After (145 s) |
| --- | --- | --- |
| redFlags alone | completes to 1.15x; fails from 1.20x | completes, verified, to 1.55x; fails at 1.60x |
| Uniform (every call) | completes to 1.15x; redFlags fails first | completes, verified, to 1.35x |
| Each other section alone, 1.0–1.5x | unchanged | unchanged: thresholds, guidance, timeline, overview, verification complete; chronology completes to 1.35x |

Limits not changed by this fix (lead engineer's call):
- Chronology (81.3 s production) has the same 110 s limit, so on its own it fails from 1.40x, before and after.
- Uniform ≥ 1.40x cannot complete in 178 s with this dispatch: chronology + timeline alone take 126.6 s × 1.4 > 175 s.
  redFlags completes in all those runs.
- When redFlags exceeds 145 s, its retry gets ~28 s and fails (the run fails inside the budget, as it did at 110 s).

Verification: fix commit `06bfe41` on `devin/1795745654-analyzer-redflags-timeout` (base `f7f0e01`, includes #151).
`npx tsc --noEmit -p .` clean; full Vitest **314 files passed, 15 skipped (329); 4,718 tests passed, 512 skipped
(5,230)**. Without the code change, 2 of the 6 tests in `api/forensic-budget-overview-last.test.ts` fail (redFlags alone
at 1.20x; uniform at 1.20x). No Cloudflare, Supabase, binding or deployment change; no paid inference.

## Follow-up 2026-11-26: verification coverage defect and full-lifecycle replay

### Defect: a second review that checked nothing was reported as "completed" (fixed)

`runForensicVerification` returned `status: "completed"` for any parseable verifier reply, whatever it covered. A
reply with verdicts for 0 of N findings (or only some of them, or none of the threshold rows the verifier is sent)
was saved and shown as a completed second review: the in-app summary showed "Independent second review completed
(0 findings checked)", and the Forensic PDF headed the report "with Second Review". The earlier replay test
(`forensic-budget-overview-last.test.ts:85`) passed only because its verifier mock (`{ verdicts: [] }`) hit this.

- Fix (`api/services/analyzerSections.ts`): when `checked < findingCount` the result is `status: "incomplete"` with
  `checkedFindings`, `totalFindings` and a reason. Verdicts that were returned stay on their findings.
- Already-saved reports: `isSecondReviewComplete` (`shared/reportContract.ts`) treats `completed` with
  `checkedFindings < totalFindings` as not complete; used by the in-app summary and export
  (`DocumentAnalyzerTab.tsx`), the Forensic PDF (`forensicPdfRenderer.ts`) and the report contract's run notes. The
  parent view already showed partial coverage.
- Other paths checked, no defect: verification that times out or is cut off is `incomplete`; a failed section run
  throws and saves nothing; the queue saves the report before finalizing and marks `completed` only after.
- Regression: `api/forensic-verification-coverage.test.ts` (5 tests; 3 fail on the old analyzer code; the fifth covers saved reports).
- Production `b9617a8` is affected: it has the same unconditional `status: "completed"` and the same UI check.
- Product risk to watch: the prompt asks for a verdict on every threshold row, including the mandatory CYFSA rows the
  parser adds. If the production model leaves rows out, those reports now say "incomplete" instead of "completed". That
  is the accurate label; it was not measured (no paid inference).
- Five existing test mocks returned partial verifier replies while asserting "completed"; they now use
  `completeVerification` (`api/analyzerTestFixtures.ts`), which fills a verdict for each finding and row sent.

### Full-lifecycle replay (`api/forensic-lifecycle-replay.test.ts`)

Real `processJob` → real `handleAnalyzeRequest` (trusted job) → real section pipeline and verification, with fake
timers. Every ledger RPC, Storage write, credit call and model call is delayed. Covered: Worker startup, claim,
persisted-report check, input load, awaited job-state and progress writes, inference per section (concurrency 3),
retries, verification, report save, reload and finalization. Deadlines checked: 178 s AI deadline, the handler's hard
deadline (budget + 5 s), the 240 s lease renewed by each running write, and the 15-minute Queue wall time.

I/O latency is not measured anywhere in the repository. The only figure is the ~30–80 ms per Supabase round trip
estimated in `engineering/SECURITY_REGISTER.md`. The replay uses conservative values: typical 250 ms per RPC and
600 ms per Storage write; slow 2 s and 4 s; startup 1 s. The startup, claim and input load come before the AI deadline
is set. The job-state write and the first progress write come after it, so they cost AI budget.

Corrected figures (largest slowdown that still completes with a full second review):

| Claim | Section-only replay | Lifecycle, typical I/O | Lifecycle, slow I/O |
| --- | --- | --- | --- |
| redFlags alone | 1.55x | 1.55x | 1.50x |
| Uniform (every call) | 1.35x | **1.30x** | **1.25x** |
| Overview alone | 2.25x | **2.20x** | **2.00x** |
| Chronology alone | 1.35x | 1.35x | 1.35x |

- Overview-last at production timings starts at 95.4 s with an 81.4 s timeout (slow I/O: 107.5 s, 74.5 s); it needs
  36.7 s. Runs complete in 133.9 s (slow: 158.2 s). The longest lease gap is 43.6 s, far below 240 s.
- Variable latency (±15 % on every call, 20 seeds): all complete to 1.15x. At 1.2x one seed of 20 loses chronology
  (its 110 s limit), and nothing is saved.
- A fast provider failure on the first redFlags and first verification attempt is retried and still completes.
- Verification slower than the remaining budget: the report is saved and labelled `incomplete` (0 checked).
- Uniform 1.5x: nothing is saved, no completed state is written, and the message is redelivered.

### Recommendation: checkpointing / resumable verification (not implemented)

The queue path keeps no section checkpoints. A redelivery after a deadline miss restarts all six sections and
verification, which is the likely shape of the 18-minute, four-attempt incident run. `runSectionedAnalysis` already accepts
`initialSections` and starts verification from them. A resumable design would persist each validated section, plus the
verification result, to the job's Storage object (`onSectionComplete`) and pass them back as `initialSections` on
redelivery. Each attempt would then only spend budget on what is missing. This needs a new Storage object layout,
cleanup and ownership checks; it is not a small change, so it is left for the lead engineer.

Verification: commits `df92cce` (fix + coverage tests + fixtures) and `cc78b7a` (lifecycle replay + handoff) on
`devin/1795746866-analyzer-verification-lifecycle`, base `engineering/integration` `0a7c680` (includes #147, #152).
`npx tsc --noEmit -p .` clean; full Vitest **321 files passed, 15 skipped (336); 4,755 tests passed, 512 skipped
(5,267)**. No paid inference, migration, binding, Cloudflare or customer-data change.

Review round: `d7109bf` (the Forensic PDF now reports a partial review as "Partly completed. N of M findings checked",
not "Not completed"; Devin Review finding), `7c22511` (`isSecondReviewComplete` moved above `adaptLegacyReport`'s
JSDoc; new test: with no red flags, a reply covering none of the 4 threshold rows is `incomplete`, 0 of 4). Full Vitest
**321 files passed, 15 skipped (336); 4,756 tests passed, 512 skipped (5,268)**; `tsc` clean.

## Coverage of critical analyzer, security and financial logic (owner directive: ≥95% meaningful)

Branch `devin/1795748104-analyzer-critical-coverage`, base `engineering/integration` `a4d2b42` (includes #156). Measured
with `npx vitest run --coverage --coverage.include=<file>` (v8, full suite). Genuine regression tests only; no file is
excluded and no source was changed to raise coverage.

| File | Lines before | Lines after |
| --- | ---: | ---: |
| `api/services/creditAccounting.ts` | 89.60% | 99.21% |
| `api/services/directAnalyzer.ts` | 89.13% | 98.55% |
| `api/services/analyzerStreaming.ts` | 81.98% | 96.89% |
| `functions/api/analyze/job/[jobId].ts` | 88.70% | 100% |
| `workers/analyzer-queue-consumer.ts` | 91.48% | 100% |
| `functions/api/analyze.ts` | 93.43% | 96.35% |
| `functions/api/_analyzer-model-adapter.ts` | 93.43% | 99.27% |
| `api/services/analyzerErrors.ts` | 92.77% | 100% |
| `functions/api/admin/analyzer-provider-check.ts` | 62.85% | 100% |

**Defect found and fixed (`dad4814`, separate commit; affects production `b9617a8`):** when the `suspended` column update
failed, `suspendPaidSession` fell back to a `free_usage` suspension marker but ignored that write's error, so an admin was
told a session was suspended when nothing had been recorded. `restorePaidSession` likewise ignored a failed marker delete
and reported a still-suspended session as restored. Both now fail with 503 and say what state the session is in.

**Tests added (`e42a292`):** queue consumer (invalid messages, claim failures, owner bypass, permanent/non-retryable
failures, dead-letter recovery only for confirmed terminal states, safe error bodies); job status (owner/admin access,
retry lookup failure, missing saved report, bounded progress, storage outages, no ids or secrets in diagnostics);
provider check (executor delegation, model listing failures, credential-shape diagnostics without key/email/IP/HTML
leaks, error mapping); Anthropic adapter (SSE error/unparseable/oversized events, `[DONE]`, non-streaming replies,
billing rejection, unreadable error body, no retry when backoff exceeds the budget); error classification and redaction;
legacy Express job storage (an existing public `analysis_jobs` bucket is made private before any job is written to it;
storage failures never break the analysis); SSE keep-alive stops on disconnect; direct analysis (eligibility reasons,
redFlags/chronology/guidance validation failures fall back without emitting sections); analyze request validation
(configuration, JSON, mode, plain-text file decoding, duplicate free scan) and `withHardDeadline`.

**Not covered, reported rather than tested around:**
- `_analyzer-model-adapter.ts:63` (`attempt > 1 && remainingTime <= 0`): effectively dead. A retry only happens after line
  270 confirmed the remaining budget exceeds the backoff, so it is reachable only if the backoff sleep overshoots the
  whole remaining budget. Defensive guard; harmless.
- `creditAccounting.ts:403`: `safeGetDb` fallback when `getSupabase()` returns an object without `from`; not reachable
  with the real client factory.
- `analyze.ts` remaining lines (240 rate limit, 303 paid reservation denied/unavailable, 396/406 enqueue-failure release
  and lookup, 591/614/631 compliance-matrix and release retries, 654-673 SSE stream cancel and heartbeat, 695/715/719/747
  hard-deadline paths, 774 Pages `onRequest` wrapper): reachable; existing suites exercise neighbouring paths, and the file
  is above 95%. Candidates for a later SSE/deadline suite.
- `analyzerStreaming.ts:194-196` (in-memory job pruning above 200 jobs) and `442-443` (withheld event write): reachable
  legacy Express paths, low risk.

Verification: `npx tsc --noEmit -p .` clean; full Vitest **328 files passed, 15 skipped (343); 4,815 tests passed, 512
skipped (5,327)**. Mocked inference and synthetic data only; no migration, binding, Cloudflare or customer-data change.
