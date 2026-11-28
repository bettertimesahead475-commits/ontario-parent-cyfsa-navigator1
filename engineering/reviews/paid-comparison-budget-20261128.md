# Paid comparison budget: existing Forensic analyzer vs consolidated analyzer (prepared 2026-11-28)

No spend has been authorised and nothing in this document has been run against a paid provider. The earlier P1 plan
(Forensic reasoning off vs adaptive on the existing architecture) is withdrawn, as directed: the comparison is now
existing vs optimized, on identical documents.

## 1. What is compared

| Arm | Pipeline | Provider calls per analysis | Source |
|---|---|---|---|
| A. Existing | Sectioned Forensic (six section calls plus one verification call) | 7 | `api/services/analyzerSections.ts` (`runSectionedAnalysis`) |
| B. Optimized | Consolidated Forensic (one comprehensive call, targeted repair only if a section fails, one verification call) | 2 | `api/services/consolidatedForensic.ts` (`runConsolidatedForensic`) |

Both arms use `claude-opus-5` for analysis and verification. Both use the same synthetic 50-page document (145,640 characters).

Independent evaluation is required before any conclusion: two reviewers, blind to arm, score each finding for accuracy,
quotation fidelity, completeness against the required sections, and unsupported assertions. Scoring rules must be written
before the runs.

## 2. Mocked measurement (no spend; from `api/services/consolidatedMeasurement.test.ts`)

| Arm | Provider calls | Transmitted characters (mock) |
|---|---|---|
| A. Existing sectioned | 7 | 1,093,404 |
| B. Consolidated | 2 | 323,681 |
| B with four sections reused | 2 | 315,577 |

Reduction for B against A: calls −71%, transmitted characters −70%. Reuse of four sections removes only 8,104 characters
(under 1%), because the comprehensive call still carries the full document and must still produce the two remaining sections.
Measurement is of the mocked payload only; it does not show output quality or latency.

## 3. Token estimate

Estimate: 4 characters per token. This is an approximation; real tokenisation can differ by 10-20%, so a 20% planning margin
is included below.

| Quantity | Arm A (per run) | Arm B (per run) |
|---|---|---|
| Input tokens (estimate) | 273,351 | 80,920 |
| Output token ceiling per call | 8,000 to 8,192 per section; 4,000 for verification | 40,692 (sum of section limits, under the 48,000 cap); 4,000 for verification |
| Output token ceiling per run (all calls at their limit, excluding retries) | 44,692 | 44,692 |

Retries are not counted. Arm A retries each failed section; arm B retries only the failed sections, through the same
per-section path. Both are bounded by the analysis deadline.

## 4. Planned runs

- Two repeats per arm, one synthetic document: 4 runs of A (28 calls) and 4 runs of B (8 calls). Total: 36 calls.
- Only synthetic documents. No customer data, no production credential, no production traffic.

## 5. Expenditure

Totals for the 8 runs:

- Input: 4 × 273,351 + 4 × 80,920 = 1,417,084 tokens. With the 20% margin: about 1,700,500 tokens.
- Output ceiling: 8 × 44,692 = 357,536 tokens (worst case; every call at its limit).

Pricing status: the public pricing page was searched on 2026-11-28, but the Opus 5 standard rate could not be confirmed
from the search results. The highest Opus 5 rate shown there is the fast-mode premium of $10 per million input tokens and
$50 per million output tokens. Source: https://platform.claude.com/docs/en/about-claude/pricing (verify before approval).

At that rate, the ceiling for the 8 runs is:

| Component | Tokens | Rate (USD per million) | Cost (USD) |
|---|---|---|---|
| Input, with 20% margin | 1,700,500 | 10.00 | 17.01 |
| Output, all calls at limit | 357,536 | 50.00 | 17.88 |
| **Hard ceiling** | | | **34.89** |

The ceiling uses the highest rate found, so it is conservative. If the owner confirms a lower standard Opus 5 rate, the
ceiling falls proportionally. Batch discounts, caching and US-only inference multipliers are not assumed.

**Proposed hard ceiling: USD 35.00 for the entire comparison.** No run may start until the owner confirms the rate and
approves this cap.

## 6. Controls to build before any run

1. A spend guard in the harness: it records provider-reported usage after each call, stops when cumulative cost reaches the
   approved cap, and refuses to start a call that would exceed it.
2. Stop after the first failed call of a run rather than retrying indefinitely.
3. Record the provider's usage per call and compare it with this estimate. The estimate is not a bill.
4. Keep raw outputs in a private location; do not copy customer text into this repository.

## 7. Risks the paid run must test

- Latency: arm B's single call (up to 40,692 output tokens) may not finish inside the 180-second Forensic budget. A timeout
  falls back to the sectioned path, which would then add time and cost. This is the main risk to the design.
- Quality: fewer calls may reduce findings or weaken quotation fidelity. The independent review decides this, not the call count.
- Repair frequency: how often a section fails validation in the single call decides whether the saving holds.

## 8. Not included

- Final Case Assessment, extraction, OCR, customer traffic, the single-call Basic configuration (not built), and prompt caching.
