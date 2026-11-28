# Paid-comparison budget (prepared 2026-11-28). No spend authorised.

Branch `engineering/perf-recovery-20261128-int`. Nothing in this document has been run against a paid provider.
Every figure below is either a mocked count from `api/redundancy-baseline.test.ts` or an arithmetic bound from it.
Real token counts will differ. Dollar amounts are deliberately absent: the owner must apply the current price sheet
for the models named here, and this document does not guess prices.

## 1. Basis

- Synthetic document: 50 pages, 145,640 characters (the same one used by the mocked baseline).
- Characters to tokens: the baseline counts transmitted characters of the messages payload. A conservative estimate is
  4 characters per token for English text. Real tokenisation may differ by 10-20%, so every token figure is an estimate.
- Forensic and Deep Scan use `claude-opus-5`; Basic uses `claude-sonnet-5`.

## 2. Requested comparisons (all need separate authorisation)

Each run is one analysis of the same synthetic document, so differences come from the configuration alone.

| ID | Comparison | Arms | Repeats | Runs | Provider calls per run | Purpose |
|---|---|---|---|---|---|---|
| P1 | Forensic reasoning | `ANALYZER_FORENSIC_REASONING` off vs adaptive | 2 | 4 | 7 (6 sections + 1 verification) | Does adaptive reasoning change finding quality, and what does it cost? |
| P2 | Deep Scan after Basic | Fresh Deep Scan vs Deep Scan with Basic reuse | 2 | 4 | 7 fresh; reuse arm not yet measured | Measures the reuse saving on real output |
| P3 | Basic configuration | Current multi-call Basic vs experimental single-call Basic | 2 | 4 | 4 vs 1 | Not built yet. Listed so the budget covers it when it is |

Total for P1 and P2: 8 runs. P1 is 28 provider calls. P2 is not costed in calls until reuse is wired and the reuse arm is measured: the 4 in the table is a placeholder, not a measurement. P3 is not costed until it exists.

## 3. Token and call ceilings for P1 (the only arm runnable on current code)

| Quantity | Per run | Four runs (P1) | Basis |
|---|---|---|---|
| Transmitted characters | 1,041,282 | 4,165,128 | Baseline row 2 (fresh Deep Scan). |
| Input tokens (estimate) | about 260,300 | about 1,041,300 | Characters / 4. |
| Calls | 7 | 28 | Baseline: 6 sections and 1 verification. |
| Output token ceiling per call | 22,000 | not applicable | 14,000 (Forensic pass 2) plus 8,000 thinking headroom in the adaptive arm. A ceiling, not an expectation. |
| Output token ceiling per run | 154,000 | 616,000 | 7 calls times 22,000. Worst case only. |

The output ceiling is a hard limit the provider enforces through `max_tokens`. It is the basis for the maximum spend.

## 4. Maximum expenditure formula

Maximum for P1 = (input ceiling × input price per token) + (output ceiling × output price per token), where:

- input ceiling = 1,041,300 tokens if the estimate holds. Use 1.2 × that figure (about 1,249,600) as the planning ceiling
  to allow for tokenisation error;
- output ceiling = 616,000 tokens (worst case, every call at its limit).

Before any run, the owner should price these two numbers with the current Opus 5 price sheet and approve a cap in
dollars. The run harness should refuse to start a run once the cap is reached (not yet implemented).

## 5. Stop conditions to be enforced before any run

1. Refuse to start if the cumulative estimated cost exceeds the approved cap.
2. Stop after the first failed call of a run rather than retrying indefinitely.
3. Record provider-reported usage for each call and compare it with this estimate; the estimate is not a bill.

## 6. Not included

- Final Case Assessment, extraction, OCR, and customer traffic.
- The P3 single-call Basic configuration, which does not exist yet.
- Any production traffic or any production credential.
