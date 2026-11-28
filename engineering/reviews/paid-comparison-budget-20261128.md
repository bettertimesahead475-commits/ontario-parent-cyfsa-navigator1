# Paid comparison budget: existing Forensic analyzer vs consolidated analyzer (revised 2026-11-28)

**Status: NOT AUTHORISED. Nothing in this document has been run against a paid provider.** The earlier 36-call, USD 35
plan is withdrawn as directed. This revision replaces it with a smaller staged comparison and a hard ceiling that counts
retries and queue redeliveries.

## 1. What is compared (Stage 1 only)

| Arm | Pipeline | Calls per run (normal) | Source |
|---|---|---|---|
| A. Existing | Sectioned Forensic: six section calls plus one verification call | 7 | `api/services/analyzerSections.ts` (`runSectionedAnalysis`) |
| B. Consolidated | One comprehensive call, at most one targeted repair, one verification call | 2 | `api/services/consolidatedForensic.ts` (`runConsolidatedForensic`) |

Both arms use `claude-opus-5` for analysis and verification. Stage 1 uses one synthetic 50-page document (145,640 characters),
one run per arm. No customer data, no production credential, no production traffic.

Arm B has **no fallback** to Arm A. If the consolidated output is incomplete after its one repair, the run stops with an
incomplete-output error and is not saved as complete. Arm A is never started by Arm B's failure.

## 2. Mocked measurement (no spend; `api/services/consolidatedMeasurement.test.ts`)

| Arm | Provider calls | Transmitted characters (mock) |
|---|---|---|
| A. Existing sectioned | 7 | 1,093,404 |
| B. Consolidated | 2 | 323,681 |
| B with four sections reused | 2 | 315,577 |

Calls −71% and transmitted characters −70% for B against A. Reusing four sections saves under 1% of characters, because
the comprehensive call still carries the full document. The mock does not show output quality, latency or repair frequency.

## 3. Token estimates

Estimate: 4 characters per token, with a 20% margin on input. Real tokenisation can differ by 10 to 20%.

| Quantity | Arm A, normal run | Arm B, normal run |
|---|---|---|
| Input tokens (estimate) | 273,351 | 80,920 |
| Input with 20% margin | 328,021 | 97,104 |
| Output at per-call ceilings | 44,692 (40,692 sections + 4,000 verification) | 44,692 (40,692 comprehensive + 4,000 verification) |

Output ceiling derivation: the six Forensic section limits are 8,000 (overview), 8,192 (redFlags), 8,000 (chronology),
7,000 (guidance), 4,500 (thresholds), 5,000 (timeline); they sum to 40,692. The verification limit is 4,000.

## 4. Worst case including retries and redeliveries

Retry rules, from the code:

- Arm A: each section gets at most 2 attempts (`SECTION_ATTEMPTS = 2`); verification gets at most 2 attempts
  (`VERIFICATION_ATTEMPTS = 2`). Worst case 14 calls.
- Arm B: the guarded pipeline allows at most 4 generation calls (comprehensive, one repair, two verification attempts)
  and 100,000 output tokens (`CONSOLIDATED_BUDGET.full`). Refused calls cost nothing.
- Queue redelivery (production only): `max_retries: 5` on the analyzer queue gives up to 6 deliveries per job, and each
  delivery starts a new pipeline run. **A retryable failure therefore multiplies every figure below by up to 6.** No
  cumulative usage is recorded per job yet, so the queue path cannot be capped today.

| Component (per run, worst case) | Arm A | Arm B |
|---|---|---|
| Calls | 14 | 4 |
| Input tokens, upper bound with 20% margin | 656,040 (14 × 39,050 average per call, × 1.2) | 194,208 (2 document-sized calls × 80,920, × 1.2) |
| Output tokens | 89,384 (2 × 40,692 + 2 × 4,000) | 89,384 (40,692 + 40,692 + 8,000; within the 100,000 guard) |

## 5. Stage 1 cost and proposed hard ceiling

Pricing status: the public pricing page was searched on 2026-11-28, but the Opus 5 standard rate could not be confirmed
from the search results. The rate used here is the highest Opus 5 rate seen there: USD 10 per million input tokens and USD 50
per million output tokens (fast-mode premium). Source: https://platform.claude.com/docs/en/about-claude/pricing. **Verify
the standard Opus 5 rate before approval.** Batch discounts, cache reads and US-only inference multipliers are not assumed.

| Scenario | Arm A (USD) | Arm B (USD) | Total (USD) |
|---|---|---|---|
| Normal run | 3.28 input + 2.23 output = 5.51 | 0.97 input + 2.23 output = 3.20 | **8.71** |
| Worst case, one delivery, in-run retries | 6.56 input + 4.47 output = 11.03 | 1.94 input + 4.47 output = 6.41 | **17.44** |

**Proposed Stage 1 hard ceiling: USD 18.00**, covering both arms, all retries and the worst-case verification path, for one
document and one run per arm. The ceiling is only enforceable if the comparison runs through the harness with one delivery
per run. Through the production queue it could reach 6 × 17.44 = USD 104.64.

No Stage 1 run may start until the owner has (a) verified the Opus 5 standard rate, (b) approved the USD 18.00 ceiling,
and (c) confirmed the controls in section 6 are built and tested.

## 6. Controls required before any run

1. **Spend guard in the harness.** Record provider-reported usage after each call, refuse to start any call whose
   worst-case cost would take the total past the cap, and stop the run at the cap.
2. **One delivery per run.** The harness calls the pipeline directly. It must not use the queue, where redelivery would
   multiply the spend.
3. **No automatic cross-arm fallback.** Already true for Arm B. The harness must record any incomplete output and stop.
4. **Per-call usage logging.** Compare provider usage with the estimates above. The estimate is not a bill.
5. **Raw outputs stay private.** Do not copy document text or outputs into this repository.
6. **Stop on the first failed call of a run** rather than retrying beyond the per-arm limits above.

## 7. Risks Stage 1 must test

- **Latency.** Arm B's single call can emit up to 40,692 output tokens. Its deadline is the 170-second cap inside a
  180-second Forensic budget. Whether a single call finishes in time is unmeasured.
- **Quality.** Fewer calls may lose findings or weaken quotation fidelity. The independent review decides this, not the
  call count. Scoring rules must be written before the runs.
- **Repair frequency.** How often the comprehensive output fails validation decides whether the saving holds. Each repair
  adds a full-document call.
- **Queue amplification.** Retryable failures redeliver the whole job (section 4). Fixing this needs a per-job cumulative
  usage ledger; it is not implemented.

## 8. Not included

Stage 2 (more documents and repeat runs), Final Case Assessment, extraction, OCR, customer traffic, the single-call Basic
configuration (not yet built), and prompt caching (not yet built). Stage 2 will be drafted only after Stage 1 results and
owner review.
