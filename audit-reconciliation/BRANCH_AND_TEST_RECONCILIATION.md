# Branch and Test Reconciliation

Comparison SHAs: `origin/main` = `0130a96f`; `fix/audit-model-ids-and-payment-guard` = `0d8156cd`; `fix/analyzer-audit-findings` (worktree `/tmp/claude-0/fix-analyzer`); `18fe4843` (deletes SavedDocumentsTab).

## Test baselines

| Source | Passed | Failed | Commit | Status |
|---|---|---|---|---|
| Antigravity audit | 2,727 | 444 | not stated | Cannot reproduce: no SHA given |
| Prior phase, fix branch | 3,447 | 433 | `0d8156cd` | Reported from earlier run; not re-run in this pass |
| Prior phase, main | 3,368 | 433 | `0130a96f` | Reported from earlier run; not re-run in this pass |

Interpretation:
- The 444-failure figure is the audit's most serious test claim. It has no commit, no command, and no environment. The count is not reproducible from the information given, so treat it as **UNVERIFIED**.
- The prior-phase numbers are from earlier runs. They are useful for direction (main and fix branch both show about 433 failures) but must be re-run with the exact SHA and recorded command before anyone relies on them.
- The 433 failures appearing on both branches suggests a shared environment or fixture problem, not a branch regression. Not yet diagnosed.

Required before any merge decision: run `npm test` and `npx tsc --noEmit` and `npm run build` on `0130a96f` and `0d8156cd`, record counts and failing test names, and save the logs to the scratchpad.

## Earlier fixes that matter

- Retry budget semantics (`shared/analyzerRetryPolicy.ts`): `RETRY_LIMITS` counts retries, not total attempts; `MAX_TOTAL_ATTEMPTS = 6`. Matches the comment in the file.
- Order-dependent UI test failure: caused by a leftover retry timer; fixed by the budget correction.
- Deep Scan job test: fixed by `mockImplementation` after `beforeEach` reset.
- Citation and quote tests (`api/services/citationVerification.test.ts`, `api/services/quoteVerification.test.ts`) read `shared/*.ts` directly and pass the rules listed in the summary.

## ESI score arithmetic

- The ESI score is the sum of eight components, maximum 100. The arithmetic is correct.
- Evidentiary validity is a separate question. The components are scored by a model, so the number is a model output, not a measured validity. Arithmetic correctness does not establish that the score is valid. Present it as an estimate.

## npm audit

- Audit reported 25 vulnerabilities. **Not re-run in this pass.**
- Required: `npm audit --omit=dev` and a reachability review. Dev-only findings (build tooling) do not reach production traffic; runtime findings in `api/` and `src/` do. Only runtime findings should block a release.

## Files named in the audit that do not exist on main

- `src/components/SavedDocumentsTab.tsx`: deleted by `18fe4843`.
