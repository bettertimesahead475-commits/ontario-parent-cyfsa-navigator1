# Review record: PR #141, DEVIN-PERF-01 (commit 75d9ae4, docs 0a27ea6)

Branch: `origin/engineering/devin-performance`, base `eaca5cf`. Integrated into `engineering/claude-review` by merge
`d09a5ed`. Not yet in `engineering/integration`.

## Independent reproduction (Claude, same model family as the author; not a different-vendor review)

- Differential test: 32,000 seeded synthetic cases (Unicode punctuation, soft hyphens, zero-width marks, astral emoji,
  NBSP and ideographic spaces, page markers that a quotation may cross, case and punctuation variants). The pre-PR
  implementation is the oracle (`tests/devin/fixtures/quoteVerificationBaseline.ts`, verbatim from `eaca5cf`).
  **Result: 0 mismatches**, comparing status, page and offsets, for both `createQuoteLocator` and `locateQuote`.
- 200-page document: 40 quotations match the baseline. A reused locator gives the same answer as a fresh call.
- Benchmark (this machine, Node 26, best of 5 warm runs, 25 findings, synthetic 40-line pages):

  | Pages | Pre-PR | Prepared once | Devin's reported figures (Node 22, single run) |
  |---|---|---|---|
  | 5 | 12.4 ms | 0.5 ms | 135 → 13 ms |
  | 50 | 224 ms | 24 ms | 1,707 → 128 ms |
  | 200 | 1,005 ms | 142 ms | 7,893 → 606 ms |

  The direction and rough size of the gain (about 7–9× here, about 10–13× reported) reproduce. The absolute figures do
  not, which is expected across machines and run methods. The reported numbers are not used as acceptance evidence.
- Memory: one prepared locator for a 479,451-character (200-page) document retained about 17 MB of heap. This is an
  upper bound, because `gc` was not exposed to the measurement. It is released after the report guard call.

## Independent reviewer (fresh subagent, read-only)

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | Important | The committed test compared the new code with itself, so equivalence with the pre-PR implementation was not pinned | **Fixed**: baseline fixture and differential test committed |
| 2 | Important | Cost test was named "independent of document size", used a timing ratio, and did not test that claim | **Fixed**: replaced by a functional test; no timing assertion |
| 3 | Important | Per-finding `indexOf` still scans the whole prepared text, so guard cost is still O(findings × document) | **Documented**: the header now says only the constant factor changes. Not changed in code |
| 4 | Nit | Prepared arrays for one document stay alive for the duration of one guard call | Accepted: bounded by one document, released after the call |
| 5 | Nit | `withoutPageMarkers` recognises markers within a 20-code-point window; `pageMarkerEnds` uses unbounded `\d+`. A marker with 14 or more digits would disagree | **Open**: unrealistic input; to align both definitions in a follow-up |
| 6 | Nit | Redundant quote canonicalization in `locateQuote` | Accepted |

Reviewer checks with no defect: the ASCII fast path (the punctuation map and dropped set have no ASCII keys); astral and
surrogate offsets; `pageAt` equivalence with the old `pageAtOffset`, including quotations that straddle a marker; module
state and `/g` regexes; freshness of returned objects; concurrency (`applyReportGuards` is synchronous, so concurrent
requests share nothing).

## Not verified

- Stale state, cross-account contamination and concurrency are covered by reading and by the tests above. Concurrency
  was not load-tested.
- CI results for this merge could not be read (no `gh`; the GitHub connector is unauthenticated).
