# Release validation — 7 November 2026

Release decision: **NO-GO** pending authenticated staging tests. This document does not certify a production release.

The user explicitly authorized pushing commit `15bd6125d89b49398a19f26465913c048396e980` and subsequent corrections to the feature branch, opening a draft PR, and deploying only isolated staging. The approved commit was pushed. Draft PR: https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/119.

Fresh Node 24 TypeScript and production build checks passed. The first full local run returned 3,911 passed, one failed, and 420 pending tests. The failure was the newly added DOM regression's file-URL lookup under jsdom, not application behavior; it now reads the stylesheet from the repository root and its targeted revalidation passed. CI on the initial commit executed 4,413 passing tests with the same single DOM failure and 108 skipped; final corrected CI results are recorded in the PR. Eight offline PowerShell runner regressions passed. Local skips include suites needing database/service credentials; CI supplies disposable PostgreSQL for its integration tests.

Eight real unauthenticated HTTP checks passed on staging: homepage HTTP 200; missing, malformed, and invalid Firebase token checks HTTP 401; extraction, both analysis modes, and report polling HTTP 401. The runner preflight was corrected to use the application's actual `/api/_auth-check` route. These checks made no provider calls or credit reservations. `scripts/test-staging-public.mjs` repeats them against either the staging alias or its immutable deployment URL.

## Executed staging database checks

`scripts/verify-staging-credit-job-lifecycle.sql` executed against project `nxfhvebzzobegubefcda` and returned `PASS: 26 staging database assertions; synthetic writes rolled back`.

Coverage: free and paid reservation, duplicate joining, one charged unit, failure release, repeated finalization, late release preserving a consumed charge; durable job creation, claim exclusivity, active lease protection, retry state, dead-letter requeue, retry attempt count, terminal dead-letter state, and fixture rollback. These are real database-function tests using privileged SQL, not Firebase/HTTP/Cloudflare delivery or provider tests. They do not prove concurrency across network clients or report persistence.

Migration `20261104230000_durable_analyzer_queue` is present. `analyzer_jobs` has RLS enabled and neither `anon` nor `authenticated` can SELECT it. The free/paid reserve, finalize, and release functions are not executable by those roles. Before synthetic testing the table contained zero jobs. Test fixtures were rolled back.

The security advisor reports existing mutable search_path warnings for 14 credit helper functions, and informational RLS-with-no-policy notices for 45 server-only tables. No database schema was changed. Review the existing warnings before production approval: https://supabase.com/docs/guides/database/database-linter?lint=0011_function_search_path_mutable

## Environment isolation

Cloudflare account `6dea4d69ac820b3b1736b302971190df`:

- Pages project `cyfsa-navigator-staging` has only `cyfsa-navigator-staging.pages.dev` configured as its domain.
- Its producer is `cyfsa-staging-analyzer-jobs`.
- Both staging queues have the relay `cyfsa-staging-analyzer-queue-consumer` registered.
- Relay binding `ANALYZER_EXECUTOR` targets `StagingAnalyzerJobs` on `cyfsa-analyzer-queue-consumer`.
- The executor uses the staging Supabase origin and staging requeue binding. Its configured models are `claude-sonnet-5-5` and `claude-opus-5-5`, with 100s and 180s budgets. Model availability has not been tested in this run.
- Encrypted credential binding names were inspected; their values were not retrieved or printed.

Deployment present at inspection: https://5a68bc90.cyfsa-navigator-staging.pages.dev, successful, artifact source `fcaf6878cc83e8a35151e385f7a6951d15c79349`. This is an existing deployment, not a deployment of the fixes in this validation.

## Repairs and regressions

- Replaced malformed escaped small-text CSS selectors with valid class-token selectors; the original production build emitted a selector warning.
- Added a DOM selector regression for all four intended small-text classes.
- The live runner now rejects non-HTTPS/non-origin staging targets, checks Firebase authentication first, requires HTTP 202 with the submitted job ID, checks the requested Sonnet/Opus family, compares the reopened report, and optionally writes timing evidence without tokens or document text.
- Added eight offline PowerShell harness regressions and a CI step. Mocked harness tests are not live provider evidence.

## Exact live blockers

No `FIREBASE_ID_TOKEN` is available in the terminal environment. The inspected repository workflows do not provide a Firebase sign-in facility. The legacy preview admin-secret script is not an authorized substitute for Firebase and was not used. Browser inventory timed out twice, so a user-controlled signed-in browser session could not be accessed.

Initial probes encountered a Node timeout, curl TLS handshake failure, and inaccessible web retrieval. Subsequent Node 24 HTTP testing succeeded for all eight public checks. Network transport is no longer a blocker for the terminal-based live runner.

The connected TinyFish browser inventory has no saved signed-in sites. Its API-fetch attempt failed with a connector transport error. The initial automatic approval-review push rejection was resolved by the user's explicit approval; no production authorization was given.

No authenticated PDF extraction, Gemini OCR, Sonnet/Opus analysis, citation accuracy, provider timing, report refresh, Firebase user isolation, application credit flow, cancellation, or actual Cloudflare retry/dead-letter delivery was verified. Quick Review and Deep Scan live times: **not measured**. The 15s/60s targets are unverified.

## Rollback procedure for staging approval

1. Record the new deployment ID, source commit, and Worker versions before changing staging.
2. If a Pages regression occurs, restore the known successful staging Pages deployment `5a68bc90-b0b5-43da-af33-c9c18e45e4c2` through the Cloudflare Pages rollback facility. Verify the target project is exactly `cyfsa-navigator-staging`.
3. No Worker or database change is needed for the CSS/runner repairs. Do not redeploy the credential holder or alter its secrets as part of this rollback.
4. For a future Worker release, preserve and separately roll back its recorded version, then verify the staging service/queue bindings. A code rollback does not roll back queued messages, database rows, reports, or credit state.
5. Poll existing job IDs and reconcile reservations; do not resubmit chargeable jobs as a rollback shortcut.
6. Public project `cyfsa-navigator-git-staging` serves `cyfsanavigator.com`; it and production Supabase `qboidsfpjuxeqtfotryj` are outside this authorization.

Production merge/deployment requires explicit authorization after authenticated staging results are available.
