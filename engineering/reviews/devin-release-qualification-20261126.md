# Independent release qualification: `release/candidate-20261126` at `171f049`

Reviewer: Devin. Baseline: production `be46ad7`. Date: 2026-11-26. No paid inference, deployment or database change.

## Recommendation

| Revision | Verdict | Reason |
|---|---|---|
| `171f049` as built | **FAIL** | One meaning-inverting quotation defect remains: `"violent during the visit"` verifies as a word-for-word quotation of `"non-violent during the visit"`. The candidate's own rollback trigger is "any quotation that verifies incorrectly". |
| `171f049` + this branch's quotation fix | **BLOCKED** | All free checks pass. Live acceptance of the three analyzers has not run (needs owner spend authorization), and the production database binding needs an owner decision. |

The 2026-11-26 CPU-limit termination is not a release blocker on the evidence below, but it is not resolved: its cause is outside
the analyzer's measured CPU use and cannot be reproduced from code.

## Contents verified

`git log be46ad7..171f049`: hotfix `9c75884` + `8156f96`, PR #143 (`f86cdbe`, `4f3c453`, `213e257`), PR #144 (`e442951`,
`f13ed8b`, `cf0a581`), the demonstration gate `e464e49` and the release record `171f049`. 14 files changed. No migrations,
Supabase, Worker configuration or Vercel changes.

## Regression tests reproduced independently

| Check | `be46ad7` / hotfix head | `171f049` |
|---|---|---|
| 16-case quotation gate (`quotationDemoDefects.test.ts`) | 8 of 16 fail at `8156f96` (no PR #143) | 16 of 16 pass |
| Forensic budget replay (5,500 / 6,500 / 7,500 / 9,000-token chronology) | 4 of 4 fail at `be46ad7` | 4 of 4 pass |
| Chronology truncation, retry prompt, 8,000-token limit, dispatch order, 30-minute poll window, quote boundaries, 32,000-case differential | n/a | 48 of 48 pass (7 files) |
| PostgreSQL suites (credit reservation, finalize, release, matter access), local PostgreSQL 14 | n/a | 11 files, 370 of 370 pass. The release record lists these as not run; they now have a local result. |
| Full suite and `tsc` | n/a | 283 files, 4,338 tests pass (13 files skipped, as on production); `tsc` clean |

Dispatch order in `171f049`: `redFlags, thresholds, chronology, guidance, timeline, overview`. Chronology `full` limit is
8,000 tokens (`fast` unchanged at 3,500). A response cut off at `max_tokens` is never accepted, the retry asks for a
shorter answer, and when no valid response arrives the run fails with `AI_RESPONSE_INVALID` and no partial report is saved
as complete.

## New quotation defects found in `171f049` (fixed on this branch)

Probe of 17 additional cases on `171f049` through all three match paths (exact, whitespace, case/punctuation):

| Source | Quotation | `171f049` | Fixed |
|---|---|---|---|
| `non-violent during the visit` | `violent during the visit` | EXACT | ABSENT |
| `non‑violent` (U+2011) | `violent during the visit` | EXACT | ABSENT |
| `The report was non-urgent.` | `The report was non` | EXACT | ABSENT |
| `I can＇t attend.` (U+FF07) | `I can` | EXACT | ABSENT |

Still verifying after the fix: whole compounds (`non-violent during the visit`, `A well-known risk.`), hyphens used as
separators (`Visit 2 - the child`, `Visit 2 -the child`), case and whitespace variants, possessives (`The children` from
`The children’s`), page attribution. Trade-off: a quotation that starts or ends inside a hyphenated compound
(`known risk` from `well-known risk`) no longer verifies; it is kept as an unverified allegation, which is the safe direction.

Not changed (no meaning change): one emoji quoted out of a joined emoji sequence (`👩` from `👨‍👩‍👧`) still verifies.

## Cloudflare CPU termination (read-only telemetry, 2026-11-26 UTC)

Observed:

- The deployed executor `cyfsa-analyzer-queue-consumer` (version `d030585d`, pre-PERF-01) has no `limits.cpu_ms`, so the
  default 30 s CPU limit applies (usage model `standard`).
- The killed invocation `6a0ca698` reported 280 ms CPU over 43.1 s wall: 6.5 ms of CPU per second, the same rate as the
  owner's other attempts (922 ms / 176 s; 1,016 ms / 177 s). It was terminated 4.6 s after thresholds completed, while
  three provider streams were open. It could not have used 30 s of CPU in that window.
- Cloudflare documents the dashboard status for this outcome as "Worker exceeded CPU time limit **or other resource
  constraints**". The `exceededCpu` label does not establish that the analyzer used too much CPU.
- It is the only non-`ok` outcome on any analyzer Worker in 30 days; there is no `exceededMemory`.

Conclusion (inference): the termination was not caused by the analyzer's own CPU use. The release cannot be shown to
prevent it, and code changes would not address it. Recommended owner action: open a Cloudflare support case citing
request `6a0ca69881503da9a2838b6383a71921`, 2026-11-26 14:59:21.584 UTC.

Impact is contained by existing recovery. All four runs on 2026-11-26 were deliveries of **one** queue message:

| Delivery (UTC) | Result |
|---|---|
| 14:51:46 | chronology cut off at 5,000 tokens, retry ran out of budget; job requeued |
| 14:55:02 | same |
| 14:58:38 | terminated (`exceededCpu`); relay logged `[STAGING_ANALYZER_RPC_RETRY]`, retried in 30 s |
| 14:59:51, 15:02:32 | the killed run's 240 s claim lease was still held; delivery deferred (no second analysis) |
| 15:06:33 | completed 15:09:30, one report |

No duplicate analysis ran and no second credit reservation was made. The candidate's chronology change removes the first two
failures; the 30-minute browser poll now covers the 18 min 47 s this job took.

Non-blocking improvement for Claude: after a termination, recovery waited 7 min 12 s because the lease-held deferral (up
to 240 s) was scheduled 6 s before the lease expired. Deferring until lease expiry would cut this to about 4 min.

## Browser recovery and duplicate submission (code and unit tests; not browser-tested)

- Retry and Start-again reuse the saved analysis id for the same file (`analysisIdForRetry`); the server returns the
  completed report, reports `ANALYSIS_IN_PROGRESS`, or reruns a released attempt under one reservation.
- `RECOVERY_TIMEOUT` and other unconfirmed outcomes do not show "This attempt did not use a credit".
- Refresh during a running job, navigation away and back, and network loss during polling were not exercised in a real
  browser. These can be tested with mocked jobs at no inference cost.

## Remaining blockers

1. Claude: review and include this branch's quotation fix (or the owner accepts the defect in writing).
2. Owner: authorize live acceptance of Quick, Forensic and Final Case Assessment on staging (Claude's phase A ceiling,
   $1.20, is reasonable; the 200-page stress test can follow separately).
3. Owner: confirm the production database. The deployed executor binds the staging Supabase project
   (`nxfhvebzzobegubefcda`), confirmed from the Worker's settings.
4. Owner: authorize deployment after 1–3.
