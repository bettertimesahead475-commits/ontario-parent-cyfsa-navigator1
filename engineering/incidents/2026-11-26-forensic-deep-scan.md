# Incident: owner's Forensic Deep Scan stopped in the browser (2026-11-26)

Status: **diagnosis partial**. The exact failure of the owner's most recent browser attempt is not established. No production
change, deployment, queue change or charge was made. Read-only investigation only.

## Identity and deployment (verified read-only, Cloudflare CLI)

- Production domain `cyfsanavigator.com` is attached to Pages project `cyfsa-navigator-git-staging`.
- Current Production deployment: `7c144cf7-82bf-47b0-928f-c03b2ca34fec`, branch `migration/cloudflare-staging-20261029`, commit
  `be46ad7`, built 16 hours before this check.
- Rollback deployment: `d5f2a3c9-a5c2-4b5a-9964-6f68b44d2ec2`, commit `cf67d8c`. Earlier Production `a67747aa` (`1fa52d1`).
- The production status endpoint returns `environment: "staging"`, `service: cyfsa-navigator-cloudflare-staging`. The
  Pages project's `ANALYZER_JOBS_QUEUE` binding is `cyfsa-staging-analyzer-jobs`. See "Staging-named path" below.

## Analyzer records (read-only SQL, staging Supabase `nxfhvebzzobegubefcda`; no document content read)

Forensic (`mode = 'full'`) jobs in the last 14 days: four, all from one account (uid prefix `ESGuHd`) with
`owner_bypass = true`. Owner-bypass jobs carry no credit reservation.

| Created (UTC) | Status | Attempts | Error code | Duration | Notes |
|---|---|---|---|---|---|
| 2026-11-24 14:58:50 | failed | 1 | `ANALYZER_QUEUE_FAILURE` | ~2 s | before the 15:24 executor redeploy |
| 2026-11-24 15:07:56 | failed | 1 | `AI_PROVIDER_CONFIGURATION_ERROR` | ~3 s | before the 15:24 executor redeploy |
| 2026-11-25 16:08:05 | completed | 1 | — | 1 min 44 s | |
| 2026-11-26 14:51:43 | **completed** | **4** | — | **18 min 47 s** (completed 15:09:30) | three redeliveries before success |

**No job row exists for any browser attempt that stopped without creating a job.** The most recent recorded run is the
2026-11-26 14:51 completion. It finished after the browser's client-side limit. Its 18-minute duration with four attempts
means it was redelivered three times before completing.

## What the records establish

1. **Analysis continues after the browser stops, if the browser has stopped.** The 14:51 run completed at 15:09. If the
   browser was still waiting on the request at 360 s (`src/utils/api.ts` aborts `/api/deep-scan` at that limit), it
   gave up about 12 minutes before completion. Whether the owner's browser was waiting on that request or polling status
   is not recorded server-side, so this is not confirmed.
2. **No charge for the owner's runs.** Owner-bypass jobs have no reservation, so no credit was consumed. This does not
   prove the customer path is correct: no non-owner Forensic job exists in the window, so the customer reservation release
   was **not verified**.
3. **Failures on 24 November were pre-fix.** Queue and provider-configuration errors occurred before the executor was
   redeployed at 15:24 UTC that day. Later runs completed.

## What remains unestablished

- Why the 14:51 run needed three redeliveries. The job row stores only the final state. Worker exception logs and queue
  delivery records are not available from the CLI or the database. They need the Cloudflare dashboard or a logs query by
  an authorized operator.
- Whether the owner's most recent browser attempt created a job. No row exists after 15:09 UTC. Either no run started, or
  it never reached enqueue.
- The owner's browser session outcome for each run. Nothing in the server records what the browser displayed.

## Staging-named path (architecture question, not yet resolved)

- Production Pages and the production queue consumer read `STAGING_SUPABASE_URL` and `STAGING_SUPABASE_SERVICE_ROLE_KEY`
  (`functions/api/_status.ts`), and the production consumer config names the staging database.
- Repository control documents say production Supabase is `qboidsfpjuxeqtfotryj` and that the two must not be
  cross-connected (`CLOUDFLARE_SUPABASE_ENTITLEMENT_CONTRACT.md`). The live project's `analyzer_jobs` could not be read
  (authentication failure from the database tool).
- `docs/staging-credential-reuse-20261106.md` records the staging-named credentials as deliberately reused for the
  analyzer, with the consumer's database origin verified as staging.

**Status:** the owner's production-account Forensic jobs are recorded in the staging database. Whether that is the
intended, previously verified production path is not established by the repository. It must be confirmed by the owner
before any change, because moving production data is a separate decision.

## Blockers to exact diagnosis

- Access to Cloudflare Workers logs for the 2026-11-26 14:51 run (Worker exceptions, CPU, memory, redeliveries).
- Access to the live Supabase project (`qboidsfpjuxeqtfotryj`) to confirm which database production writes to.
- The owner's browser-side observation for the failed run (which screen, at what time).

## Hotfix assessment (not started)

- **Candidate:** Devin's compact quotation locator (`508946c`, DEVIN-PERF-04) reduces memory. It rewrites about 300 lines of
  the verification path. It is **not** a narrow hotfix, and it is not proven to address the redelivery cause.
- **Not recommended for an emergency deploy** until the cause is known and the differential test (`tests/devin/` on the
  review branch, 32,000 cases) passes on the exact candidate.
- No change is proposed until Worker logs establish whether the redeliveries were CPU, memory, or lease expiry.

## Rollback

- Keep Production on `7c144cf7`. Rollback target `d5f2a3c9` (commit `cf67d8c`), per the release checklist. No deployment
  was made.
