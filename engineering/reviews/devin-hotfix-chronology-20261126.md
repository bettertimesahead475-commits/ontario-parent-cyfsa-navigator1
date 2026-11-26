# Independent review: Forensic chronology hotfix `9c75884` (Devin, 2026-11-26)

Branch `hotfix/forensic-chronology-20261126` = production `be46ad7` + `d344037` (PR #141 locator, production matching
rules) + `9c75884` (Forensic chronology `maxTokens.full` 5,000 → 8,000; chronology dispatched early) + `8156f96`
(dispatch order `redFlags, thresholds, chronology, guidance, timeline, overview`; browser polling limit 6 → 30 min). All evidence is local, with mocked inference.
No money was spent and nothing was deployed.

## Verdict

| Area | Result |
|---|---|
| Chronology token exhaustion | **VERIFIED fixed (mocked).** The replay of the owner's run fails on `be46ad7` and completes on `9c75884` |
| Execution deadline | **VERIFIED (mocked).** Completes in 124–138 s of the 178 s AI budget (it was 175 s and failed) |
| Retry behaviour | **VERIFIED.** A cut-off answer is never accepted, and the retry asks for a shorter answer. At 8,000 tokens (about 87 s at the observed rate) the response stays inside `SECTION_TIMEOUT_MS.full` (110 s) |
| Quotation accuracy | **FAILED (production behaviour, carried forward).** DEVIN-P2-01 is not included; see below |
| Cloudflare CPU | **IMPROVED (local measurement).** Report-guard CPU falls about 91% through PR #141. The production `exceededCpu` at 280 ms is still unexplained |
| Memory, 200-page documents | **NOT FIXED.** Peak memory is unchanged; the compact locator (PR #142) is not included |
| Full suite / types | 4,305 passed, 478 skipped on `9c75884`; `tsc` clean |

## Evidence

**Replay** (`api/forensic-budget-replay.test.ts`). Section durations come from the owner's run (Cloudflare telemetry
`2840a310`): redFlags 92.5 s, guidance 57.8 s, thresholds 37.7 s, timeline 45.3 s, overview 36.7 s. Chronology output
runs at ~94 tokens/s; that run was cut off at 5,000 tokens after 53 s. Verification takes 30 s; the 2026-11-25 run puts
it at ≤ 32 s.

| Chronology length | `be46ad7` (production) | `9c75884` (hotfix) |
|---|---|---|
| 4,500 tokens | completes, 132 s | completes, 124 s |
| 5,500 / 6,500 / 7,500 | **fails at 175 s**: cut off at 137.7 s, retry hits the deadline | completes, 129 s, 1 attempt |
| 9,000 | fails at 175 s | completes, 138 s (cut off at 86.6 s, shorter retry) |

The production failure in the replay (175 s) matches the two failed production attempts (174.4 s and 174.7 s). The new
test fails 4/4 on `be46ad7` and passes 4/4 on the hotfix. Claude's own new tests are structural (token value and
dispatch order). Three of them fail on `be46ad7`. The tests that check a cut-off answer is rejected pass on both,
because that behaviour is not new.

**Dispatch order.** `9c75884` put chronology ahead of thresholds, a verification input, which delayed verification
by about 3 s on the owner's run (up to about 20 s when redFlags finishes early). `8156f96` adopted
`redFlags, thresholds, chronology, …`. On that revision the replay starts verification at 92.5 s, the same as the
owner's production run, and the completion times in the table are unchanged.

**Browser polling (`8156f96`).** `pollAnalysisJob` now waits 30 min by default instead of 6 min, still polling every
3 s. The server's `RECOVERY_TIMEOUT` still ends a job that never finishes. This affects how long the browser keeps
following a job, not how long the analysis runs or what it costs.

**CPU** (25 findings; one report-guard pass; Forensic runs two passes):

| Pages | `be46ad7` | `9c75884` | PR #142 compact locator |
|---|---|---|---|
| 50 | 1,752 ms | 157 ms | 55 ms |
| 200 | 8,248 ms | 629 ms | 152 ms |

Production Forensic invocations used 922–1,313 ms CPU, which is consistent with the guard pass dominating. The
`exceededCpu` kill came 4.5 s after thresholds finished, before any guard pass runs. This change does not explain
that kill, and the hotfix is not shown to prevent it.

**Memory.** Peak RSS for a 200-page pass is 498 MB on production and 495 MB on the hotfix, against 166 MB with the
compact locator. These figures include Node/tsx overhead and are not Worker figures. The 30-day telemetry shows no
`exceededMemory`, so this is a large-document risk, not the cause of today's failure.

## DEVIN-P2-01: should accompany the release (recommended)

On both `be46ad7` and `9c75884`, each of these is reported as found word-for-word (`EXACT`), and CRITICAL severity is
allowed:

| Document | Quote the model returned |
|---|---|
| "It is untrue that the father struck the child." | "true that the father struck the child" |
| "I can't attend the meeting on Tuesday." | "I can" |
| "The parent was uncooperative at the visit." | "The parent was uncooperat" |
| "She said 😀 rest of the visit was calm." | (half of the emoji) " rest of the visit was calm" |

The change only rejects matches that cut a word, contraction or character. It has been on `engineering/integration`
since PR #138. It does not change CPU (161 / 647 ms at 50 / 200 pages). A separate PR into the hotfix branch carries
it, so it can be taken or left on its own merits.

## Live acceptance (owner authorisation required; coordinate with Claude)

1. Deploy the hotfix build to the **staging** executor only. Run Forensic on `engineering/demo/demo-forensic-case-notes.txt`
   (PR #142) and on one longer synthetic document like the owner's. Pass: `ok` outcome; chronology `attempts: 1`; total
   time under 150 s; read CPU and wall time from Workers telemetry.
2. Quick Document Review and Final Case Assessment once each on the demo documents, timed in the browser.
3. Promote to production only after 1–2 pass, with the rollback deployment recorded.
