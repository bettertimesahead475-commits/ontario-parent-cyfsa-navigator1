# CYFSA Navigator: release progress and backlog

Living log for PR #109 (`fix/paid-job-recovery`, draft). Update it as work lands so a resumed session can continue.

## Status (latest first)

- **Streamed free reports are withheld safely.** A finished free report is saved as completed, its scan is recorded
  as delivered, and only then is the report sent. If recording fails, the stream sends a retryable
  `FREE_SCAN_NOT_RECORDED` event without marking the job failed (`emitWithheld`). Covered by route tests, including
  a negative check that fails when the old emitter is used.
- **Reconcile is exact per account.** A marker belongs to an account only when its key is the account prefix plus
  exactly 32 hex characters. Covered by SQL check 8, which fails on the old predicate.
- **Verification:** `tsc --noEmit` clean; full Vitest 173 files passed, 11 skipped, 3413 tests passed, 0 failed;
  `npm run build` succeeds.
- **PR #109:** mergeable and clean against `main` (six commits ahead, none behind). Still a draft.

## Blocked on approval (do not do without explicit go-ahead)

1. Merge PR #109 to `main`. Vercel production deploys from `main`, and the free-scan functions do not exist in
   production until the migration is applied. Merging first would turn free analyses into 503 errors.
2. Apply `supabase/migrations_pending_approval/free_scan_reservation_functions.sql` to staging, then production.
   Verify on staging first with the `.test.sql` file and the concurrency run.
3. Confirm the production function duration. The production deployment's configuration is not retrievable through
   the available tools (file tree returns 404). Unverified; repo value is 300 s.

## Open engineering backlog

- **PR triage.** 50 open PRs and about 110 remote branches, many stacked and several unrelated to the analyzer
  (Stage 10 access slices, Stage 11, marketing agent, design work). Not triaged in this session. Plan: group by
  dependency chain; for each, decide integrate, supersede (document why), or keep as a draft with a note.
- **422 `AI_RESPONSE_INVALID` root cause.** Not yet investigated in this pass.
- **Legal-quality integration.** Verified improvements on `fix/analyzer-audit-findings` (if still present) are not
  yet reviewed for merge.
- **Browser and mobile walkthrough.** Not performed in this pass. Requires a running app and a headless browser.
- **Marketing agent.** Not inspected in this pass.
- **Reconcile cleanup.** Strategy recorded in the migration approval package. Not implemented, by design.

## Decisions

- Keep PR #109 as a draft. Merging and deploying need the owner's explicit approval (see "Blocked on approval").
- A withheld free report keeps its scan. Releasing it would let a delivered-looking report come back for free.
