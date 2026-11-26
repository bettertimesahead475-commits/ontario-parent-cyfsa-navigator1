# Devin Regression Register

| ID | Test | Before fix | After fix |
|---|---|---|---|
| DEVIN-SEC-01 | `tests/devin/job-owner-conflict-fail-closed.test.ts` (5) + `tests/devin/analyze-ownership-unavailable.test.ts` (1) | 4 failed, 1 passed on baseline `functions/` (body-read-failure case added after review: fails on first fix, passes now) | 6 passed |

Run: `NODE_OPTIONS=--no-experimental-webstorage npx vitest run tests/devin/` (Node 22). `vitest.config.ts` include gained `tests/devin/**/*.test.ts` so the suite runs in CI with the rest.

Related suites re-run after the fix (8 files, 66/66): security-hardening, analysis-jobs, analyzer-integration, queue-producer, recovery, deep-scan, stalled-analysis, tests/devin.

## Phase two
| ID | Test | Before fix | After fix |
|---|---|---|---|
| DEVIN-P2-01/02 | `tests/devin/analyzer-verification-integrity.test.ts` | 11 of 29 failed (original set) | all pass (review cases added) |
| DEVIN-P2-03 | `tests/devin/red-flag-critical-after-verification.test.ts` | 1 of 2 failed | 2 pass |
| Mutation gaps M11/M14/M16/M18 | `tests/devin/{legacy-job-owner,activate-code-purchase-binding,final-case-assessment-entitlement,dlq-live-lease}.test.ts` | mutations survived the existing suite | each mutation now killed |
