# Worst-case analyzer paths and the 40,692-token output ceiling (2026-11-28)

Scope: the Forensic path (`mode: 'full'`) and the Basic path (`mode: 'fast'`) in `functions/api/analyze.ts`, with the
consolidated pipeline enabled (`ANALYZER_FORENSIC_PIPELINE=consolidated`, `ANALYZER_BASIC_PIPELINE=consolidated`) and
disabled (default). Numbers marked *measured* come from mocked tests. No paid calls were made.

## 1. Where the 40,692 ceiling comes from

It is the sum of the six Forensic section limits in `api/services/analyzerSections.ts` (`FORENSIC_SECTIONS`):

| Section | max_tokens |
|---|---|
| overview | 8,000 |
| redFlags | 8,192 |
| chronology | 8,000 |
| guidance | 7,000 |
| thresholds | 4,500 |
| timeline | 5,000 |
| **Sum** | **40,692** |

Verification has its own 4,000 limit. The consolidated comprehensive call reuses the same sum as its ceiling, so the two
pipelines request the same maximum output. The 40,692 figure is a limit, not an expected length: the sections need not fill it.

## 2. Why output is the main cost and latency driver

A single request that emits up to 40,692 tokens has to finish inside the Forensic deadline. The consolidated comprehensive
call is capped at `COMPREHENSIVE_TIMEOUT_CAP_MS = 170,000` ms inside the 180-second Forensic budget, with a 3,000 ms reserve
and a 5,000 ms minimum per call. Whether the call finishes in that window is **unmeasured**: it needs a paid or
latency-recorded run, which is not authorised.

## 3. Compact output: proposal, not implemented

Compacting the schema (for example, dropping duplicated fields such as repeated quotations, and letting local code format
the report) would cut output. It is not implemented, because output quality is unmeasured and a schema change would alter
what findings the model can express. Proposed steps, in order:

1. Measure the actual output length per section on the Stage 1 comparison (see the paid plan), recording `output_tokens`.
2. Identify fields that carry no finding (for example, repeated quotation text and free prose the report formatter can
   derive from structured fields).
3. Introduce compact fields behind a flag, keep the substantiated-finding fields unchanged, and run the same independent
   review on both schemas before any default change.
4. Keep incomplete-output detection: `stopReason === 'max_tokens'` already routes to a retry or an incomplete error in both
   pipelines (`analyzerSections.ts` around lines 984 and 1276; `consolidatedForensic.ts` around line 169). Compact schemas
   must keep that check.

## 4. Worst-case paths (current code)

Every path below is bounded per request. The queue path is the exception, because a job can be redelivered.

| Path | Generation calls, worst | Output tokens, worst | Notes |
|---|---|---|---|
| Forensic, sectioned (default) | 14 (6 sections × 2 attempts + verification × 2) | 89,384 | Section attempts: `SECTION_ATTEMPTS = 2`; verification: `VERIFICATION_ATTEMPTS = 2` |
| Forensic, consolidated | 4 (comprehensive, one repair, verification × 2) | 89,384 (guard: 100,000) | `CONSOLIDATED_BUDGET.full`; refused calls cost nothing |
| Basic, sectioned (default) | 4 sections (`QUICK_SECTIONS`), no verification, plus the section loop's own retries | 15,500 (fast limits: 3,500 + 5,000 + 3,500 + 3,500) before retries | Unchanged; retries not multiplied here |
| Basic, consolidated | 2 (comprehensive, one repair) | 40,000 guard | `CONSOLIDATED_BUDGET.fast`; no verification in Basic |
| Consolidated, incomplete after repair | stops; no fallback | — | Throws `AI_RESPONSE_INVALID` (422, retryable); nothing saved as complete |
| Queue redelivery (any path above) | up to 6 deliveries (`max_retries: 5`) | × up to 6 | **Not capped.** No per-job cumulative usage ledger exists yet |

Fallback amplification: the consolidated path no longer falls back to the sectioned path, so a single consolidated failure
cannot start an unrestricted seven-call run inside one delivery. The remaining amplification is queue redelivery, which
re-runs the whole pipeline on any retryable error.

## 5. Open risks, ranked

1. **Queue redelivery multiplies spend.** Fix: persist cumulative provider usage on the job record and refuse a delivery
   once the job's ceiling is reached. Not implemented. Until then, paid comparisons must bypass the queue (see the paid plan).
2. **Single-call latency.** Unmeasured (section 2).
3. **Retryable incomplete output re-runs the whole job.** Retrying only the failing part, rather than the whole job, would
   cut the cost of a failed repair. Not implemented.
4. **Compact schema.** Not implemented; quality unmeasured.

## 6. Evidence

- Mocked measurement (*measured*, `api/services/consolidatedMeasurement.test.ts`): sectioned 7 calls / 1,093,404 characters;
  consolidated 2 calls / 323,681; consolidated with four sections reused 2 / 315,577.
- Budget guard and refusals: `api/services/consolidatedForensic.test.ts` (14 tests; pass).
- Reservation: one credit reservation per request, chosen only by `isForensic` (`tests/devin/deep-single-reservation.test.ts`).
- Queue retry behaviour and `max_retries`: `wrangler.production-analyzer-queue-consumer.jsonc` lines 31 and 40; the consumer
  in `workers/analyzer-queue-consumer.ts` redelivers on retryable responses.
