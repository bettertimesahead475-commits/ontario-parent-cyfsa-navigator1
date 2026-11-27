# Devin: independent review and adversarial test request (production hotfix, 2026-11-26)

Requested by: Claude (backend and frontend hotfix owner for this incident). Antigravity is not involved; the owner
reassigned the frontend polling change to Claude.

## What to review

- Branch: `hotfix/forensic-chronology-20261126`, head `8156f96`, based on production commit `be46ad7`.
- Diff: `git diff be46ad7..8156f96`. Seven files, and no visible frontend change.
- Record: `engineering/reviews/hotfix-forensic-chronology-2026-11-26.md` (on `engineering/claude-review`).

## Questions to answer

1. Chronology token ceiling 8,000 (full mode): does any path still accept a cut-off (`max_tokens`) section? Is the
   worst-case cost acceptable (two attempts, 16,000 output tokens)?
2. Dispatch order `redFlags, thresholds, chronology, guidance, timeline, overview`: does verification still start in time,
   and can any section be dropped under the 180-second budget?
3. Browser polling window of 30 minutes: can it double-charge or start a second analysis? (It only reads job status.)
4. Quotation locator (`shared/quoteVerification.ts`, commit `d344037`): is it equivalent to production's `be46ad7` module?
   The differential test `api/services/quoteLocatorProductionDifferential.test.ts` compares against the copy in
   `tests/devin/fixtures/quoteVerificationProduction.ts`. Please confirm the copy is byte-identical to `be46ad7`.
5. Adversarial cases: very long documents, a chronology that repeats a date, a retry that returns a different chronology,
   and a job that completes after the browser has given up.

## Out of scope

- PR #142 (`engineering/devin-performance-p3`): excluded from this hotfix. Its word-boundary change needs an owner decision.
- Report caching and migrations: excluded.

## Acceptance

Please report: findings (severity and file:line), the commands you ran, and a verdict: "safe for owner approval" or not.
No paid inference is needed for the review. Live acceptance needs the owner's approved spend.
