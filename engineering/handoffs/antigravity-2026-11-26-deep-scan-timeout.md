# Antigravity handoff: browser timeouts must not abandon an active Forensic analysis (2026-11-26)

Owner: Antigravity (frontend, `src/**`). Claude has NOT edited any `src/**` file for this incident. This note asks for a
change to frontend behaviour; the hotfix itself is server-side only.

## Evidence (read-only)

- `src/utils/api.ts` aborts `/api/deep-scan` and `/api/analyze` requests after 360 seconds (`AbortSignal.timeout(360_000)`).
- Production Forensic analyses can run longer than that. The 2026-11-26 run `req_1795704701637_uqn41oybbso` completed
  server-side after 18 minutes with four attempts (see `engineering/incidents/2026-11-26-forensic-deep-scan.md`).
- The browser cannot tell an aborted request from a failed analysis, so a finished analysis can be presented as failed.

## Requested change (frontend, for your review and browser acceptance)

1. When the request times out or aborts, do NOT show "analysis failed". Instead, poll the existing job-status endpoint
   with the analysis id the browser already holds, until the job reports `completed` or `failed`.
2. Keep the analysis id in component state across the abort so a refresh or a timeout can resume the poll.
3. Show "still running" with the server's progress value. Show "failed" only when the server says so.
4. Do not start a second analysis for the same document while a job with that id is running. The server rejects duplicates
   by id; the UI should reuse the id.

## Acceptance (browser, synthetic documents only; no paid inference needed to test the UI with a mock)

- Simulate a 360-second abort with a mocked network: the UI keeps polling and shows the completed report when the mocked
  job completes.
- Simulate a refresh during a running job: the progress resumes.
- No change to visual design, branding or layout (Antigravity's visual-preservation rule).

## Coordination

- Claude's hotfix (`hotfix/forensic-chronology-20261126`, commit `9c75884`) does not touch `src/**`.
- A frontend change is NOT required for the server fix to be safe. It is required so a slow-but-successful analysis is
  not presented as a failure. Ship it in the next frontend release unless the owner decides otherwise.
