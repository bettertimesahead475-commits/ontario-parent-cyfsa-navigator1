# Production hotfix candidate: Forensic chronology, quotation performance, browser job polling (2026-11-26)

Status: **candidate prepared and reviewed once by an independent subagent; NOT yet reviewed by Devin; NOT deployed.**
Deployment needs Devin's independent review, controlled acceptance, and the owner's approval.

## Base and branch

- Production (verified from Cloudflare Pages): `be46ad7`, deployment `7c144cf7`.
- Rollback (preserved): `d5f2a3c9`, commit `cf67d8c`.
- Hotfix branch: `hotfix/forensic-chronology-20261126` (pushed), head `8156f96`, based on `be46ad7`.
- Excluded: integration work, report caching (`e940ef4`, `fa136fe`), migrations, PR #142's compact locator (`508946c`),
  and the DEVIN-P2-01 word-boundary rule (`77cc009`, `cfacd3a`).

## Changes

| Change | Where | Behaviour |
|---|---|---|
| Forensic chronology output ceiling 5,000 → 8,000 | `api/services/analyzerSections.ts` | Quick unchanged (3,500). |
| Dispatch: `redFlags, thresholds, chronology, guidance, timeline, overview` | `api/services/analyzerSections.ts` | Chronology starts in wave 1 instead of last. Verification inputs stay first. |
| Browser job polling waits 30 minutes (was 6) | `src/utils/api.ts` (`pollAnalysisJob`) | A job still running after 6 minutes keeps being followed, instead of "couldn't confirm". A job that never completes still ends with `RECOVERY_TIMEOUT` after 30 minutes. |
| PR #141 quotation locator, adapted to production matching | `shared/quoteVerification.ts` (`d344037`) | None intended. Equivalent to production on 32,000 synthetic cases. |
| Regression tests | `api/hotfix-chronology.test.ts`, `api/services/quoteLocatorProductionDifferential.test.ts`, `src/utils/analysisJobLongRun.test.tsx`, `api/forensic-section-dispatch.test.ts` (expectation updated) | — |

The frontend change touches only the polling constant. No JSX, styling, copy or layout changed, so the site's appearance is unchanged.

## Verified (mocked network and inference only; no paid run)

- `tsc --noEmit -p .`: passes.
- Full `vitest run` on the hotfix branch: 280 test files passed, 13 skipped, 4,307 tests passed.
- The new polling test fails when the old 6-minute limit is passed explicitly, and passes with the 30-minute default. So it
  reproduces the browser stop.
- The cut-off protection is unchanged (read at `runOneSection`; no truncated section is merged).

## Independent review (subagent, same model family; not Devin)

| # | Severity | Finding | Disposition |
|---|---|---|---|
| 1 | Blocker | `tests/devin/quote-locator-performance.test.ts` does not run on the production base, and two of its assertions encode the word-boundary rule that the hotfix excludes | **Fixed**: file removed from the hotfix |
| 2 | Important | Moving thresholds out of wave 1 could delay verification and make the 30-second verification minimum more likely to skip it | **Fixed**: thresholds kept in wave 1, chronology second |
| 3 | Important (cost) | Worst case per chronology is 2 attempts × 8,000 = 16,000 output tokens, up from 10,000 (+60%). If the Forensic model name is one of the models in `MODELS_REJECTING_DISABLED_THINKING`, the adapter raises the ceiling to 16,000 per attempt | **Approved by the owner (2026-11-26, "Approve cost").** Approval covers this cost increase only, not deployment or any live spend. Output is billed per generated token, so cost only rises when the extra tokens are used |
| 4 | Nit | A test name described the old order | Fixed |
| 5 | Nit | A regex assertion could never fail | Fixed (asserts chronology length) |
| 6 | Nit | A fixture comment named the wrong file | Fixed |

Reviewer's checks with no defect: production matching equivalence (the ASCII fast paths and page attribution), the Quick
path, dispatch completeness (no section dropped), the cut-off path (never merged), and the adapter's truncation handling.

Reviewer on PR #142: **exclude**. It changes matching semantics (word-boundary and surrogate rules) and is stacked on
unrelated commits. Its differential test compares against the pre-PR code, not production. It should be a separate change
after the owner decides the word-boundary rule.

## Not verified

- **Devin's root cause** (chronology exceeded its output limit and retries exhausted the 180-second budget) comes from
  Cloudflare telemetry this session cannot see. The code path is confirmed on `be46ad7`. The cut-off model was not identified.
- **The 280 ms CPU termination:** not reproduced.
- **Efficiency without loss of content:** not implemented. Any prompt change needs live validation first.
- **Completed-section preservation on job retry:** not implemented. Production restarts all sections on a job retry.
  This needs job-storage changes and belongs in the next release.

## Rollback

1. Production stays on `7c144cf7` until approval.
2. If deployed and acceptance fails, roll back to `d5f2a3c9` with the Pages rollback used on 2026-11-25. Record the
   deployment id in `SESSION_HANDOFF.md`.

## Remaining before deployment

1. Devin's independent review and adversarial test of `hotfix/forensic-chronology-20261126` (request in
   `engineering/handoffs/devin-hotfix-review-request-2026-11-26.md`).
2. ~~Owner decision on the chronology worst-case cost (finding 3).~~ Approved by the owner on 2026-11-26.
3. Controlled live acceptance on synthetic documents, with owner-approved spend. Devin's $4.80 plan must be reconciled with
   the per-run estimates on record (Quick $0.05–0.10, Forensic $0.25–0.45).
4. Owner approval to deploy.
