# Test Register and Spending Register

## Commands

```
# PowerShell or Git Bash with Node 26 ("C:\Program Files\nodejs" on PATH)
NODE_OPTIONS=--no-experimental-webstorage npx vitest run     # full suite
npx tsc --noEmit -p .                                         # type check
```
`NODE_OPTIONS=--no-experimental-webstorage` is required: Node 26's built-in localStorage breaks jsdom tests.

## Results

| Date | Commit | Result | Notes |
|---|---|---|---|
| 2026-11-25 | b141293 (production) | 4,230 passed / 478 skipped | tsc clean |
| 2026-11-25 | a7c6b47 (eval, injection fix) | 4,281 passed / 0 failed / 478 skipped | vitest now also runs src/**/*.test.ts and eval/** |
| 2026-11-25 | c82e971 (review fixes, network guard) | 4,265 passed / 0 failed / 478 skipped | tsc clean; no test reaches an external host |
| 2026-11-25 | fc8b31c (admin) | 4,252 passed / 2 failed / 478 skipped; both failures pass in isolation with and without the change | flaky under full-suite load (T-15) |
| 2026-11-27 | 82dfe65 (release round 2: PRs #147-#160) | 4,870 passed / 0 failed / 512 skipped | tsc clean; `npm run build` OK; CI whole-app coverage 74.4% lines; critical analyzer/credit files ≥96% (PR #160) |

## Known flaky tests (T-15)

- `api/cloudflare-analysis-jobs.test.ts` › "never writes provider text into the stored record"
- `api/cloudflare-analyzer-integration.test.ts` › "rejects paid request when database session is invalid or revoked"

Symptom: elapsed times of ~9,000 s and `ECONNRESET` in logs under full-suite load. Cause: unmocked requests to the real
Supabase host. Fixed by 105a47b (no ownership lookup for server ids) and the external-network guard (c82e971).

## Live acceptance harness (outside the repo)

`C:\Users\pelki\cyfsa-acceptance`: Edge profile with remote debugging on 127.0.0.1:9333 (owner account signed in),
Playwright scripts `drive.mjs`, `extract-only.mjs`, `mobile-audit.mjs`, `export-check.mjs`, `pdf-export-check.mjs`,
synthetic documents only. Results in `results/`.

## Spending register (inference; held centrally by Claude)

| Date | Item | Cost (USD, approx.) | Running total of $5.00 |
|---|---|---|---|
| 2026-11 | Staging and production Quick/Forensic acceptance runs and diagnostics (multiple) | ≈ 4.60 | ≈ 4.60 |
| 2026-11-25 | OCR timing run (1 scanned page, Gemini) | ≈ 0.001 | ≈ 4.60 |
| | **Remaining** | | **≈ 0.40** |

Other agents have a $0 inference budget. Paid tests waiting for budget: Final Case Assessment live run;
additional Forensic latency samples; live AI evaluation set.
