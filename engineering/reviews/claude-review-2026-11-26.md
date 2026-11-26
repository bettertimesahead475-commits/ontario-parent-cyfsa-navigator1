# Independent review record: engineering/claude-review (eaca5cf..5940df4)

- Reviewer: a fresh general-purpose subagent started for this review (read-only, no edits, no commands that change
  state). It is the same model family as the author. Treat it as an independent reading, not a different-vendor review.
  Devin and Codex were not used; Devin's independent audit is still to be scheduled for the release gate.
- Method: reading code only. The reviewer did not run tests.
- Review status: **Independently reviewed (partial)**. Findings below were addressed and retested. A second independent
  pass on the corrections, by Devin or Codex, is still required before merge.

| # | Severity | Finding | Disposition | Retest |
|---|---|---|---|---|
| 1 | Important | Whitespace-only or empty provided proposition returned VERIFIED with SUPPORTED | Fixed: provided-but-unevaluated proposition → UNVERIFIED | Tests "whitespace-only ... UNVERIFIED", "empty ... UNVERIFIED" |
| 2 | Important | Overlap of 400 chars did not cover matches longer than 400 chars straddling a cut | Fixed: overlap 3,000, step 1,000, max 200 windows. Matches up to 3,000 chars are guaranteed; longer are not (recorded residual) | Test "long matches straddling a window boundary" (2,500-char match, 27 offsets). Not shown to fail on the old code |
| 3 | Important (conditional) | SQL `[[:alnum:]]` may disagree with JS `\p{L}\p{N}` under a non-UTF-8 collation | Not fixed in code. Parity cases with accented words and a UTF-8 encoding check added. Runs in CI only | Pending CI run. Migration must not be approved until it passes |
| 4 | — | SQL hit logic matches `verifyQuote` line by line | No defect | — |
| 5 | Nit | Empty proposition gave VERIFIED | Covered by finding 1 fix | As 1 |
| 6 | Important | `cryptoRandom` throw inside `DocumentAnalyzerTab.tsx` at line ~1897 (async IIFE before try) could leak the concurrency slot and wedge a file in "analyzing" | Not fixed here: `src/**` belongs to Antigravity. Handed off (see below). Reachable only without Web Crypto, which every supported browser has | Pending Antigravity |
| 7 | Important | Server `generateAnalysisJobId` used `Math.random` | Fixed: uses `newAnalysisJobId` | Tests "server-generated analysis ids ..." |
| 8a | Nit | Timing test named as if the document was checked | Renamed: refused in bounded time | — |
| 8b | Nit | "statements needing context across windows" did not cross a boundary | Renamed "a short flag straddling a window boundary" | — |
| 8c | Nit | "never padded" test did not test padding | Renamed to describe the format | — |

## Handed off to Antigravity (frontend ownership)

`src/components/DocumentAnalyzerTab.tsx`: wrap the `newAnalysisJobId()` call near line 1897 inside the try, or reset
the concurrency slot in a `finally`, so a thrown id generation cannot leave a file stuck in "analyzing". Also line
~2051 (`analysisIdForRetry(file.analysisId, newAnalysisJobId)`) runs after the file is set to "analyzing" and before its
try. Route both through the same error path. Same fix shape as T-13 visual constraints: no visible change.

## Retest

- Targeted suites (analyzer retry policy, long-document, legal pipeline): 109 of 109 pass.
- `tsc --noEmit -p .`: passes.
- Full `npx vitest run` (Node 26, `--no-experimental-webstorage`): 292 files passed, 14 skipped, 4531 tests passed.
- Not run: the PostgreSQL parity test (CI only).
