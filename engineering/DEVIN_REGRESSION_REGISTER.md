# Devin Regression Register

| ID | Test | Before fix | After fix |
|---|---|---|---|
| DEVIN-SEC-01 | `tests/devin/job-owner-conflict-fail-closed.test.ts` (5) + `tests/devin/analyze-ownership-unavailable.test.ts` (1) | 4 failed, 1 passed on baseline `functions/` (body-read-failure case added after review: fails on first fix, passes now) | 6 passed |

Run: `NODE_OPTIONS=--no-experimental-webstorage npx vitest run tests/devin/` (Node 22). `vitest.config.ts` include gained `tests/devin/**/*.test.ts` so the suite runs in CI with the rest.

Related suites re-run after the fix (8 files, 66/66): security-hardening, analysis-jobs, analyzer-integration, queue-producer, recovery, deep-scan, stalled-analysis, tests/devin.
