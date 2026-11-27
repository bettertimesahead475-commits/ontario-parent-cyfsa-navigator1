# Staging preview: why analyzerReady and forensicQueueReady are false, and what the owner must set

Preview: `a0ef44c4` (candidate branch `release/candidate-20261126`, code `171f049`), project `cyfsa-navigator-git-staging`.
Production (`7c144cf7`) is not changed by anything in this file.

## Verified (names and presence only; no values read)

| Variable or binding | Production (Production env) | Preview (Preview env) | Needed for |
|---|---|---|---|
| Secret `ANTHROPIC_API_KEY` | present | present | analyzerReady, forensicQueueReady |
| Secret `STAGING_SUPABASE_SERVICE_ROLE_KEY` | present | present | analyzerReady, forensicQueueReady |
| Secret `SESSION_SECRET` | present | present | sign-in |
| Secret `GEMINI_API_KEY` | present | present | OCR |
| Secret `ADMIN_SECRET` | present | **missing** | admin console only (not analyzer readiness) |
| Plain variable `ANALYZER_ENABLED` | set (value true, per status) | **not set** | analyzerReady |
| Plain variable `FIREBASE_PROJECT_ID` | set | **not set** | analyzerReady |
| Plain variable `STAGING_SUPABASE_URL` | set | **not set** | analyzerReady |
| Queue producer binding `ANALYZER_JOBS_QUEUE` | present (forensicQueueReady true) | **unverified** | forensicQueueReady |

Source of the requirement: `functions/api/_status.ts` (`isLiveReady` = ANALYZER_ENABLED === 'true' AND FIREBASE_PROJECT_ID
AND STAGING_SUPABASE_URL AND STAGING_SUPABASE_SERVICE_ROLE_KEY AND ANTHROPIC_API_KEY; forensicQueueReady also needs the
queue producer). Preview has both secrets, so the three plain variables are the missing piece. The plain variables live
in the dashboard, not in the repository, so their values could not be read here.

## Owner steps (dashboard; no secret values needed)

1. Open Cloudflare dashboard → Workers & Pages → `cyfsa-navigator-git-staging` → Settings → Variables and Secrets.
2. Open the **Production** tab, and copy the NAME and TYPE of `FIREBASE_PROJECT_ID`, `STAGING_SUPABASE_URL` and
   `ANALYZER_ENABLED`. Copy only plain (non-secret) values. Do not copy secrets.
3. Switch to the **Preview** tab. Add `ANALYZER_ENABLED` = `true`, `FIREBASE_PROJECT_ID` = the same value as production,
   and `STAGING_SUPABASE_URL` = the same value as production (see the caution below).
4. Settings → Functions → Queue producer bindings (Preview): confirm `ANALYZER_JOBS_QUEUE` → `cyfsa-staging-analyzer-jobs`.
   Add it if missing.
5. Trigger a new preview deployment (push a commit to `release/candidate-20261126`, or retry the preview deployment).
6. Check: `curl https://a0ef44c4.cyfsa-navigator-git-staging.pages.dev/api/status` must show `analyzerReady: true` and
   `forensicQueueReady: true`. Use the preview's deployment URL for the new deployment if it differs.

## Caution before step 3: which database

Production's analyzer currently writes jobs and credits to the staging Supabase project (`nxfhvebzzobegubefcda`). A preview
with the same `STAGING_SUPABASE_URL` would write test jobs into that same database. That database holds the owner's
production-account job records. This conflicts with the instruction not to connect test activity to production records.
Options for the owner (choose one before step 3):
- A. Accept that the preview shares the staging project for this emergency release, and accept the test jobs in it.
- B. Create a separate, empty Supabase project for the preview only, apply the existing migrations to it (requires separate
  approval), and point the preview's `STAGING_SUPABASE_URL` and service key at it. Recommended if test data must stay apart.

Claude has not chosen. No production binding, secret or database is changed by these steps.

## What Claude can do without owner credentials

Coordinate with Devin, who reports having Cloudflare configuration access, to perform steps 1–6 for the preview only, and
to report the `/api/status` result. Devin must not change Production.
