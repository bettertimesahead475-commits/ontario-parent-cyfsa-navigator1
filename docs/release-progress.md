# CYFSA Navigator: release progress and backlog

Living log for PR #109 (`fix/paid-job-recovery`, draft). Update it as work lands so a resumed session can continue.

## Current state (latest)

- **PR #109** `fix/paid-job-recovery`: draft, head `37d5a69c`. Checks: `test` and Vercel preview passed; CodeRabbit skipped.
- **Release candidate** `release/candidate-audit-integration` at `67aa70da`: PR #109 plus `origin/fix/analyzer-audit-findings`
  (citation and quote verification, unified retry policy, unlisted-model refusal). Tests: 180 files passed, 3540 tests
  passed, 0 failed, 433 skipped. Typecheck and production build pass. Not merged to `main`; not deployed.
- **Integration conflict resolved.** The one conflict in `DocumentAnalyzerTab.tsx` was the analysis id source. The branch
  always generated a fresh id, which would bring back the duplicate-charge defect. Retry keeps the saved id (`analysisIdForRetry`),
  and fresh ids come from the shared generator.
- **Truncated analysis output** now returns `retryable: true`, matching its own "try again" message. Test asserts it.
- **Branch inventory:** `docs/branch-inventory.md`. 34 branches fully merged into main; 28 unmerged with an open PR;
  38 unmerged with no open PR, each needing a keep / merge / close decision.

## Known gap: 422 AI_RESPONSE_INVALID

No live API key is available in this environment, so the model-side cause cannot be reproduced here. Confirmed from code:
truncated output and refusals both reach this error, and the sectioned Forensic path already retries each section once.
Needed to close: a captured truncated response (stop reason and length) from staging logs, to confirm the token budget
is the cause and not a parser fault.

## Status (earlier)

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

## Session update: release candidate `release/candidate-audit-integration` at 6f89b953

Verified in this session (commands run on the release candidate):
- Typecheck clean. Full Vitest: 181 files passed, 11 skipped; 3558 tests passed, 0 failed, 433 skipped.
- Production build succeeds. Production server run locally and loaded in headless Chromium at 1280px and 390px.
- Desktop and mobile: `/`, `/rights`, `/pricing`, `/templates`, `/document-analyzer` render with no horizontal overflow.
  `/document-analyzer` and `/templates` show the sign-in gate to signed-out visitors, as designed.

Fixed in this session:
- **Analyzer 422 (JSON).** Model output with a raw newline or tab in a string, or a trailing comma, failed strict
  parsing on every retry and was reported as AI_RESPONSE_INVALID. Repair now runs only after strict parsing fails.
  Reproduced with realistic outputs before the fix; 9 parser tests.
- **Legal accuracy.** Five CYFSA section keys checked against the official e-Laws text: 74(2), 81(7), 81(13), 88, 94(1),
  94(2), 1(2), 3, 70, 74(3), 101(1) and 101(3) match. One error corrected: the peace-officer warrantless power is
  s. 136(5), not s. 81(12) (which is Crown liability). Corrected in content, test and audit note.
- **Quotations across page breaks.** A verbatim quote spanning a `[Page N]` marker was reported ABSENT. Matching now
  ignores markers and maps back to the source; 4 regression tests.
- **CORS.** An origin not on the allowlist made Express answer 500, which broke pages on unlisted origins. Unlisted
  origins now get a 403 from the API only; static assets are unaffected.
- **Lawyer directory errors.** Raw database and configuration text reached parents. Now a generic, retryable 503, with
  the detail logged. Expected lifecycle errors keep their messages.
- **Marketing secrets.** Admin and cron secret checks are constant-time; same-length wrong-secret regression test.

Limitations and open items:
- **Vercel function duration.** Repo config: 300 s (`functions["api/index.ts"].maxDuration`). The project record
  (`prj_wbNOX…`) has no function settings, and the deployment file tree is unavailable. Production value unverified.
- **Feeney.** `R. v. Feeney, 1997 CanLII 158 (SCC)` in `src/data.ts`: neither CanLII nor the SCC site could be
  reached to confirm it. Verify before release or remove.
- **Lawyer directory.** `LAWYERS` on main lists 33 named individuals with addresses and phone numbers, unsourced and
  undated. Replacing it (branch `claude/fix-fabricated-lawyer-directory`) needs a provenance check and a product decision.
- **Preview and staging origins.** Browser requests to the API from any origin other than cyfsanavigator.com are now 403
  unless listed in `ALLOWED_ORIGINS`. Preview and staging deployments must set it.
- **Model IDs.** The release routes Quick to `claude-sonnet-5` and Forensic to `claude-opus-5`. The documented current
  models are the 5.5 IDs. Changing them changes cost and was not done without approval. Unverified against the live API.
- **Floating buttons.** On a 390px screen the chat and audio buttons cover the disclaimer text. Cosmetic; not changed.
- **Not released by this work:** `fix/gmail-no-auto-activation` (access codes), `claude/session-token-gated-routes`
  (free-tier quota and Save-to-Cloud removal), and `fix/audit-model-ids-and-payment-guard` (email trust grant). Each changes
  entitlements or payments, so each needs your approval.

Branch inventory (`docs/branch-inventory.md`) is the first-page count; the complete list is 180 branches: 84 merged into
main, 35 unmerged with an open PR, 61 unmerged without one. Of the 61, 11 are already in main by patch content and 13
are covered by the release candidate. The remaining 37 are stacked duplicates of the report-feature chain, unrelated
feature streams (Stage 9D to 11, forms, design), or the release-relevant items listed above.

## Final release state: `release/candidate-audit-integration` at 914376d8

Verification on this commit:
- Typecheck clean. Full Vitest: 183 files passed, 11 skipped; 3566 tests passed, 0 failed, 433 skipped.
- Production build succeeds. Headless Chromium on the production build: 12 page checks (6 pages x desktop and phone) pass,
  no failed requests, no horizontal overflow. Phone footer and disclaimer clear the floating controls.
- Migration re-verified on local PostgreSQL 16 against the final SQL: checks pass; 40-way race gives one reservation;
  rollback leaves no `free_*` functions. Not run on Supabase staging: no approved staging project was available.

Decisions applied (from release owner):
1. Lawyer directory paused publicly: routes return no listings (404 for a profile) and the page shows a notice with the
   Legal Aid Ontario line. Data and code preserved. Switch: `shared/lawyerDirectoryPolicy.ts`.
2. R. v. Feeney citation removed from customer-facing text (could not be verified from CanLII or the SCC site).
3. No pricing, payment, or entitlement change.
4. No branch or PR deletion.
5. Model IDs verified against the Claude API reference in this environment (cached 2026-10-06): `claude-sonnet-5` and
   `claude-opus-5` are valid IDs in that table. `claude-opus-5-5` is the current Opus ($4 in / $20 out per MTok, against $5 / $25)
   and `claude-sonnet-5-5` is the current Sonnet (same price as Sonnet 5). No ID was changed. Recommended optional change:
   set `ANTHROPIC_FORENSIC_MODEL=claude-opus-5-5` after review; the code already keeps 5.5 requests valid (no disabled
   thinking, no forced tool choice, effort set). Requires your approval.

Fixed in this stretch:
- Current models sent `budget_tokens` on the enabled-thinking path (a 400 per the model reference). No caller enables
  thinking today; the path now sends adaptive thinking. One existing test encoded the wrong behavior and was corrected
  against the reference; the reason is in the test.
- Stale routing comment named a retired model.
- Mobile footer and disclaimer hidden behind floating controls.
- A repairable model reply now has an end-to-end test (four Quick Review sections, one call each, no retry).

Limitations and unverified items:
- **Production function duration:** `api/index.ts` = 300 s in `vercel.json`. The project and deployment records (`dpl_65asc…`,
  main `0130a96`, PR #103) carry no function duration field. Confirm in Vercel → Settings → Functions.
- **Production 422 rate:** runtime logs for the last 3 days have no `AI_RESPONSE_INVALID` entries. Two error entries fall in the
  3–7 day range; the 7-day query timed out and could not be listed. Attribution of earlier 422s is not established.
- **ALLOWED_ORIGINS:** set for the preview target only; its value is secret and was not read. Production uses the built-in
  `cyfsanavigator.com` allowlist. Confirm the preview value covers the preview domains you test from.
- **Forensic Deep Scan integration:** covered by the existing section, validation and persistence tests in `_server.test.ts`
  and `analyzerStreamingIntegration.test.ts`; no new Forensic-specific test added in this stretch.
- **Blocked on your approval** (not done): merging the release candidate to `main` (auto-deploys), applying the migration to
  staging and production, the optional model change, and making the release candidate the PR #109 head.

## Consolidated production release checklist (not executed)

Pre-merge
1. Apply `supabase/migrations_pending_approval/free_scan_reservation_functions.sql` to a Supabase staging project. Run
   `free_scan_reservation_functions.test.sql` (must print the pass line) and the 40-way race. sha256 of the SQL:
   `3b98bab6029d80dbdab0abc7bc21f5661ea5657447c931c38f2ce934bc7f8bc1`.
2. Confirm `ALLOWED_ORIGINS` (preview) includes the preview domains used for testing.
3. Confirm the Vercel function duration for `api/index.ts` (Settings → Functions = 300 s).
4. Decide the optional `ANTHROPIC_FORENSIC_MODEL=claude-opus-5-5` change.

Production order
1. Apply the migration to production (separate approval). Re-run the `.test.sql` checks read-only where possible.
2. Merge `release/candidate-audit-integration` to `main`. Vercel builds production from `main`.
3. Confirm the new deployment is READY and aliased to cyfsanavigator.com.

Smoke tests (production)
- `GET /api/health` returns 200. Same request with `Origin: https://evil.example` returns 403 `ORIGIN_NOT_ALLOWED`.
- `/`, `/rights`, `/pricing`, `/templates` load; `/document-analyzer` shows the sign-in gate when signed out; `/lawyers` shows the pause notice.
- Signed-in test account, one free Quick Review: 200; `free_usage` shows one consumed reservation; a second request returns 402.
- Failed analysis (induced in staging, not production) returns the scan.
- Runtime logs for 48 hours: watch `AI_RESPONSE_INVALID`, `FREE_SCAN_NOT_RECORDED`, `DIRECTORY_UNAVAILABLE`.

Rollback
1. Promote the previous production deployment (`dpl_65ascLewK5AowJVifiZxAtpgo4vF`, main `0130a96`) in Vercel. Do this first.
2. Only after step 1, run `free_scan_reservation_functions.down.sql` if the migration must be removed. Reservation marker rows stay in `free_usage`; they are harmless.
3. Revert the release branch on `main` with a revert commit, not a force push.
