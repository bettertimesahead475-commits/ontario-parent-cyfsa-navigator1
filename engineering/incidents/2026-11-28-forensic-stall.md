# Incident: owner's Forensic run appeared stuck (2026-11-28) — T-28

Status: **blocked on logs**. Read-only investigation. No code change, deployment, migration, credit change or paid scan.

## Identity

- Job: `req_1795884084495_dopi1vsbsan`, mode `full`, owner-bypass (no reservation, no credit consumed).
- Production Pages reads `STAGING_SUPABASE_URL`, i.e. Supabase project `nxfhvebzzobegubefcda` (named "staging").
  Job rows and reports for production requests are there. The live project `qboidsfpjuxeqtfotryj` has no `analyzer_*` tables.

## Timeline (UTC, 2026-11-28)

Server-side from `analyzer_jobs` (status, attempts, timestamps) and Supabase edge and storage logs:

| Time | Event |
|---|---|
| 16:41:26–27 | `analyzer_get_job` then `analyzer_create_job` (200) |
| 16:41:28 | Input object `inputs/<id>.json` written (14,745 bytes) |
| 16:41:29 | `analyzer_claim_job`; worker reads input |
| 16:41:30 | Job state object written |
| 16:41:31–16:42:12 | Browser status polls about once per second (`analyzer_get_job`); progress updates at 16:42:12 |
| 16:42:24 – 16:43:13 | Polls continue, gaps widen to 2–10 s |
| 16:43:13 → 16:43:33 | **20 s with no status call reaching the database** |
| 16:43:33 – 16:43:42 | Polls resume (last poll logged 16:43:42) |
| 16:43:50 | Progress update |
| 16:43:42 → 17:10 | **No further status call from the browser** |
| 16:44:17 | Progress updates; report object written (about 125 KB) |
| 16:44:18 | `analyzer_update_job` → job `completed`, `attempt_count = 1`, `completed_at` set |

Server run duration: about 2 min 51 s, one attempt, no redelivery.

## What is established

1. The backend completed. The report was saved and the job was marked completed.
2. The owner's browser stopped polling at 16:43:42, about 36 s before completion. It never resumed, so it could not
   show the report.
3. Cancellation in the client only stops polling. Nothing on the server stops or refunds the job. The job ran to
   completion after the owner stopped watching (see T-29).
4. No credit was consumed (owner-bypass). Provider usage for one full run was incurred; amount not measurable here.
5. Status reads reach the database about once a second while running. Gaps of 20 s or more with no database call are
   unexplained.

## What is not established

- Where the 20–36 s silent intervals were spent. Candidates: Pages-function latency before the database call; browser
  throttling of a background tab (`setTimeout` throttling); client `AbortSignal.timeout(20_000)` on a read that hung.
- Whether the owner cancelled, or the client gave up. The client's only terminal paths are `CANCELLED`, `RECOVERY_TIMEOUT`
  (30 min), and repeated network failures (10 consecutive). None fired within 36 s, so a manual cancel is the likely cause.
- Provider timings and the stage breakdown of the 167 s model-phase work. These are not in the database.

## Code checked (no defect proven)

- `functions/api/_auth-check.ts`: Google key fetch bounded at 5 s (`KEY_FETCH_TIMEOUT_MS`), so server-side auth cannot
  account for a 20 s silent gap alone.
- `src/utils/api.ts` `pollAnalysisJob`: a 20 s per-read abort, then exponential backoff. Recorded as T-30, not fixed.

## Needed to close (T-28)

- Cloudflare Worker logs for the consumer and the job-status function, 16:40–16:46 UTC on 2026-11-28, for job
  `req_1795884084495_dopi1vsbsan`.
- Cloudflare Pages Functions logs for `GET /api/analyze/job/...` in the same window.
- The owner's account of the action taken at about 16:43–16:44 (cancel, close, or navigation).

## Recovery for the owner (not yet verified)

The completed report is stored. Signed in as the owner, `GET /api/analyze/job/req_1795884084495_dopi1vsbsan`
should return it. Not called here.
