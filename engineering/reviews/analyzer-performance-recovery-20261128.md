# Analyzer performance recovery, 2026-11-28 (branch `engineering/perf-recovery-20261128-int`)

Base: `origin/engineering/integration` @ 679b7f6. Not a merge of `engineering/devin-performance` (it predates
integration; see section 4). No paid provider calls, no production or staging requests, no database writes.

## 1. Confirmed defect: lease expiry allows duplicate analysis

- Claim lease 240 s (`analyzer_claim_job`). Only running writes extend it (`analyzer_update_job`, 4 minutes).
- Progress was written only at stage boundaries. A section longer than the window, or a retried section, left the
  lease expired. A redelivered message then claimed the job and a second analysis ran concurrently.
- Fix: a 60 s timer renews the lease with the last stage and progress (`workers/analyzer-queue-consumer.ts`).
- Evidence on the 26 Nov run (18 min 47 s, four attempts) is consistent with this but not proven: Worker logs
  (`[ANALYZER_JOB_CLAIMED]` with `jobAttempt`/`deliveryAttempt`) are needed.

## 2. Confirmed defect: a stale Worker could replace the saved report

- The completed report is written with `x-upsert: true` (`functions/api/_analysis-jobs.ts`). Nothing checked the lease
  first.
- Fix: before the completed write, the trusted-job path re-reads the row and requires this Worker's token and a
  running state (`functions/api/analyze.ts`, `assertLeaseHeld`). Fails closed.
- Residual: the check and the upsert are two steps. A conditional write (create-once for completed trusted saves) is
  the complete fix and is recorded as a follow-up; it needs a storage-behaviour test on staging.

## 3. Concurrency review (heartbeat and ownership)

| Hazard | Status |
|---|---|
| Overlapping renewals | Guarded by an in-flight flag; one renewal at a time. |
| Stale Worker keeps running after lease loss | Runs until its next progress write (throws `JOB_LEASE_LOST`) or its persist check (refused). Provider calls already in flight are not cancelled. Residual cost, not a correctness issue. |
| Progress regression | Heartbeat repeats the last value written; analyzer progress is non-decreasing (`Math.max(88, …)` after verification starts, existing test). |
| Duplicate persistence | Fixed for the completed report (section 2). Residual window noted. |
| Duplicate credit settlement | Finalization is idempotent per request id (`free_finalize_scan`, paid finalizer). It runs only after a persisted report. |
| Failed lease read | Treated as not owned; the save is refused and the message retried. |

## 4. Selective review of `engineering/devin-performance` (commit by commit, not merged)

| Commit | Content | Decision |
|---|---|---|
| `c8055fb` lazy quote locator | Already present on integration in equivalent form (integration prepares lazily; the cherry-pick conflicted and was aborted). | Not ported. |
| `6629be4` DEVIN-PERF-02, 1 s polling | Frontend (`src/utils/api.ts`), Antigravity-owned. | Not ported; coordinate (section 6). |
| `c619534` Sonar S6544 | Frontend lint fix. | Not ported here. |
| `5ac05d1` report cache library | Unwired; migration in `migrations_pending_approval`; needs retention decision and secret. | Not ported. |
| Docs commits | Analysis only. | Not ported. |

## 5. Forensic profile (mocked provider, `api/forensic-profile.test.ts`)

Synthetic documents and the report fixture from `api/analyzerTestFixtures.ts`. Per run: 6 section calls + 1
verification call.

| Pages | Document chars | Transmitted to the provider (chars) | Transmitted ÷ document | Non-provider CPU per run | One guard pass |
|---|---|---|---|---|---|
| 5 | 16,654 | 137,715 | 8.3× | 45 ms | 1.3 ms |
| 50 | 166,590 | 1,187,582 | 7.1× | 46 ms | 0.7 ms |
| 200 | 666,491 | 4,687,939 | 7.0× | 148 ms | 1.0 ms |

Reading:
- Non-provider work is small (under 0.2 s at 200 pages with mocked responses). Model time dominates wall time.
- The document is sent with every section and with verification (about 7× the document). This is the largest
  non-model cost and it drives provider input tokens and time to first token. Reducing it needs provider prompt
  caching (adapter change, `_analyzer-model-adapter.ts`, which joins content blocks), and that changes the request
  shape for Forensic. It cannot be validated without paid runs, so it is not shipped.
- One extra guard pass runs in the final assembly (`analyze.ts`) over already-guarded red flags. Removing it could
  change output if guards are not idempotent for every input. Not removed without equivalence evidence.

## 6. Antigravity coordination (frontend timeout and polling)

- The 360 s client abort in `src/utils/api.ts` is not a performance fix. Extending it only hides the failure.
- Requested of Antigravity (unchanged from `engineering/handoffs/antigravity-2026-11-26-deep-scan-timeout.md`): on
  abort or timeout, poll the job-status endpoint with the existing analysis id; never show "failed" unless the server
  says so; keep the id across refresh.
- Polling interval: 1 s near completion (from `6629be4`) can be ported by Antigravity; server load is about 100 reads
  per Forensic run and needs a staging load check.

## 7. Basic Quick Review

- No prompt, model, token budget or stage sequence changed.
- The lease timer and the ownership check run only on the queued path. Quick (about 36 s) finishes before the first
  60 s tick, so it writes no extra renewals. A longer Quick run gets at most one extra renewal per minute.
- Quick accuracy: not re-run (needs paid calls). Mocked analyzer tests pass (see test results in the PR).

## 8. Tests and verification

- New: `tests/devin/queue-lease-safety.test.ts`, `tests/devin/queue-lease-heartbeat.test.ts`, two analyzer-level cases in
  `api/cloudflare-forensic-queue-progress.test.ts`, profile harness `api/forensic-profile.test.ts`.
- Mutation checks: timer removed → 3 heartbeat tests fail; guard call removed → the refusal test fails.
- Full Vitest and `tsc` results: recorded in the PR body.
