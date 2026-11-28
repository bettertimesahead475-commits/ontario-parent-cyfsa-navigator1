# Antigravity handoff: analysis polling and the browser timeout (2026-11-28)

Follows `antigravity-2026-11-26-deep-scan-timeout.md`. Claude has not edited any `src/**` file.

## Server state (branch `engineering/perf-recovery-20261128-int`)

- A running analysis renews its lease every 60 s (`workers/analyzer-queue-consumer.ts`). A job that takes longer than
  four minutes between progress writes is no longer redelivered into a second analysis.
- A completed report is saved only by the Worker that still holds the lease. A Worker that lost it gets a retryable
  `JOB_LEASE_LOST` response and saves nothing.
- The job-status endpoint is unchanged. Its response is what the browser should trust.

## Requested frontend work

1. Polling: when a job is running, poll its status about every second near completion, with the existing backoff for
   pending or error responses. Concurrent pollers for one job share one request.
2. Timeout: on the 360 s abort of `/api/analyze` or `/api/deep-scan`, do not show "failed". Keep the analysis id,
   poll until the server reports `completed` or `failed`, and show "still running" with the server's progress value.
3. Do not start a second analysis for a document while a job with its id is running. Reuse the id.
4. No change to visual design or layout.

Acceptance (mocked network, synthetic documents, no paid calls): a simulated abort keeps polling until a mocked
completion; a refresh mid-run resumes the progress; a mocked `failed` is shown as failed and nothing else is.

Extending the timeout alone is not accepted as a fix.

## Server-side load

About 100 status reads per 100-second Forensic run at one per second. Needs a per-account rate limit and a staging load check
before release.
