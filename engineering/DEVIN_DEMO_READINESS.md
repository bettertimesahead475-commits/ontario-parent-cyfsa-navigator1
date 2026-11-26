# Business demonstration readiness (Devin, 2026-11-26)

## 1. The owner's interrupted Forensic Deep Scan (MEASURED, Cloudflare Workers telemetry, read-only)

Production executor `cyfsa-analyzer-queue-consumer`, version `d030585d` (production build; it predates
DEVIN-PERF-01 and PR #142). Four attempts in 18 minutes, 2026-11-26 UTC:

| Attempt | Start | Result | Wall | CPU |
|---|---|---|---|---|
| `9bbc5a39` | 14:51:46 | failed: chronology hit `max_tokens` (5,000), retry ran out of the 180 s budget | 176.6 s | 947 ms |
| `45a80277` | 14:55:03 | failed: same cause | 176.4 s | 922 ms |
| `6a0ca698` | 14:58:39 | **killed: `exceededCpu`**, 4.5 s after `thresholds` finished; `redFlags` and `guidance` still streaming | 43.1 s | 280 ms (as reported) |
| `2840a310` | 15:06:34 | completed; chronology again hit 5,000 tokens and needed its retry | 177.2 s | 1,016 ms |

In the last 30 days there is **no `exceededMemory` outcome on any Worker**; the one non-ok outcome is the
`exceededCpu` above. Successful Forensic runs in the last 7 days used up to 1,313 ms CPU.

Conclusions:

- **Memory did not cause this interruption.** The memory fix (PR #142) protects 50–200-page documents; it is not
  the fix for this incident.
- **The dominant failure is chronology length, not CPU:** in all three runs on this document the chronology section
  stopped at its 5,000-token cap (`analyzerSections.ts`, `chronology.maxTokens.full`). It is dispatched sixth, so it
  starts at about 83 s; a truncated answer at about 135 s leaves less than the 25 s retry minimum before the 180 s
  budget. Two of four attempts failed this way, and the one success finished at 177 s of 180 s.
- **The CPU kill is not explained yet.** Queues need Workers Paid, whose default CPU limit is 30 s, yet the reported
  CPU was 280 ms. Either the reported figure is incomplete for killed invocations or another limit applies. The
  production build lacks PERF-01 (73–84% less guard CPU on large documents) and PERF-04. The staging test
  (budget item 1) records this directly.

Proposed for Claude (not changed by Devin; it alters analyzer output length and cost):
1. Raise `chronology.maxTokens.full` from 5,000 to 8,000 (other Forensic sections already allow 7,000–8,192). At
   the observed ~95 tokens/s this ends at about 168 s instead of truncating; cost about +$0.08 per Forensic run.
2. Dispatch `chronology` before `overview` so a truncation retry still has budget.
3. Promote PERF-01 to production (integrated at `b435ad4`, not deployed).

## 2. First $4.80 of paid testing (prepared; NOT spent)

Owner authorisation required. Synthetic documents only (`engineering/demo/`). Staging only; production untouched.

| # | Run | Est. | Pass criteria |
|---|---|---|---|
| 1 | Deploy PR #142 build to the staging executor; Forensic on the 200-page synthetic document, concurrency 3 | $3.00 | `ok` outcome; Worker CPU and wall from telemetry; no `exceededMemory`/`exceededCpu`; all six sections plus verification complete |
| 2a | Quick Document Review on `demo-quick-letter.txt` through the browser | $0.15 | completes; Expected list in `engineering/demo/README.md` |
| 2b | Forensic Deep Scan on `demo-forensic-case-notes.txt` through the browser | $1.25 | completes under the 180 s budget; Expected list |
| 2c | Final Case Assessment on both demo files | $0.40 | completes; Expected list |
| | **Total** | **$4.80** | |

Measurement: Devin reads outcome, CPU and wall time from Workers telemetry (read-only, no cost) and times the browser
from upload to final report. If run 1 hits the chronology cap again, that confirms the proposal above before any
further spend. The remaining $15.20 follows the order in `DEVIN_PERFORMANCE_ENGINEERING.md` §7.4 and starts only after
these pass.
