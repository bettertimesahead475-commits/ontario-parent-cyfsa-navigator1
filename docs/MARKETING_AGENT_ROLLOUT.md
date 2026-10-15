# Marketing Agent — Production Rollout Plan

Status as of 2026-10-14. **Nothing in this document has been executed against production.**
Every step marked OWNER APPROVAL needs explicit owner sign-off first.

## 1. Current production state (verified read-only, 2026-10-14)

| Item | Production (`qboidsfpjuxeqtfotryj`) | Staging (`nxfhvebzzobegubefcda`) |
|---|---|---|
| `marketing_*` tables | **None** | 5 tables, RLS on, no policies |
| `navigator_official_form*` tables | None | 5 tables |
| Migration ledger | 10 entries, last `20260910001952` | `marketing_agent`, `marketing_updated_at_search_path_hardening`, `create_navigator_official_form_registry`, plus `marketing_agent_readiness` applied in this release |
| Rows in marketing tables | n/a | `marketing_channels` = 5 (seeded), all else 0 |

Production's ledger does not contain the marketing migration, so the marketing schema must be created before the marketing code can work there.

**Known production issue to resolve during rollout:** `vercel.json` on `main` schedules `/api/admin/marketing/run-scheduler` every 5 minutes. The current production build already includes that route, but production has no marketing tables, so each run is expected to fail with a database error. The runtime logs do not show response status codes, so this is **unverified**. Applying Step 3 removes the cause.

## 1a. Preview and environment blockers (verified 2026-10-14/15)

- **Preview protection:** preview deployment `dpl_EXW88KgomEWQARazQ8MPKhJnRh2G` is READY but returns Vercel Authentication (deployment protection) to anonymous requests. The project API reports password and SSO protection as disabled, so the enforcing setting is at the team or deployment level and was not readable. Owner action: check Project Settings → Deployment Protection (and the team default for preview deployments). To run the smoke test, either create a protection-bypass secret for this preview and pass it as `VERCEL_BYPASS_TOKEN`, or disable protection for this preview.
- **Admin secret:** `ADMIN_SECRET` exists for Preview and Production. It is a sensitive variable, so its value cannot be read through the API. Use the existing variable: the owner supplies its value out-of-band as `ADMIN_SECRET` when running `scripts/marketing-smoke.sh`. Do not paste it into chat or commit it.
- **`CRON_SECRET` is not in the Preview or Production variable names returned by the API.** Without it, the marketing scheduler returns 401 to Vercel Cron, and the existing `check-payments` and `monitoring/run` crons also reject their calls (both check the same secret). Owner action: confirm whether `CRON_SECRET` is set in Production; if not, add it (approval required) before merging.
- **Preview database binding:** Preview has its own `SUPABASE_URL` (sensitive, value unreadable), which overrides the shared one. Owner action: confirm that it points to staging `nxfhvebzzobegubefcda`, and that Production's `SUPABASE_URL` points to `qboidsfpjuxeqtfotryj`.

Smoke test (read-only, prints status codes only):

```bash
PREVIEW_URL=https://<preview-host> ADMIN_SECRET=<from Vercel> CRON_SECRET=<from Vercel> \
VERCEL_BYPASS_TOKEN=<only if protected> scripts/marketing-smoke.sh
```

Local verification without credentials (built server, throwaway secrets, no database): all auth gates return 401; validation returns 400 before any AI or database call; missing dependencies return controlled 503 errors; the scheduler returns 503 with a clear message when Supabase is absent. Overview and analytics need a database to return 200.

## 2. Pre-flight checks (read-only)

1. Re-run `list_migrations` on `qboidsfpjuxeqtfotryj`. If `20261005` or `20261014` appear, stop and reconcile before continuing.
2. Confirm production's `public.marketing_*` tables do not exist.
3. Confirm the production runtime Supabase URL and credential identity. This is the same open item as the official-form migration: it is UNVERIFIED and must be closed first.
4. Confirm `ADMIN_SECRET` and `CRON_SECRET` are set in Production, with the names only. Do not print values.

## 3. Migration sequence (OWNER APPROVAL REQUIRED)

Apply in this exact order, each as its own migration:

1. `supabase/migrations/20261005_marketing_agent.sql` (repaired in this release — the `main` copy has an unterminated dollar-quoted function body and fails to parse; verified with the PostgreSQL parser).
2. `supabase/migrations/20261014_marketing_agent_readiness.sql` (additive: review fields, publishing index, and a unique index that blocks duplicate publication of one external post).

Both files are idempotent (`if not exists`, `on conflict do nothing`, `drop trigger if exists`).

### Post-migration verification (read-only)

```sql
select count(*) from marketing_channels;                      -- expect 5
select relname, relrowsecurity from pg_class
 where relname like 'marketing_%' and relkind = 'r';          -- expect all true
select policyname from pg_policies where tablename like 'marketing_%';  -- expect no rows
select indexname from pg_indexes where indexname = 'marketing_posts_external_unique_idx';  -- expect 1 row
```

## 4. Environment changes (OWNER APPROVAL REQUIRED)

| Name | Required | Purpose |
|---|---|---|
| `ADMIN_SECRET` | yes (already used by other admin routes) | Marketing admin access |
| `CRON_SECRET` | yes | Vercel Cron authentication for the scheduler |
| `ANTHROPIC_API_KEY` | for AI drafts | Content generation |
| `FACEBOOK_PAGE_ID`, `FACEBOOK_PAGE_ACCESS_TOKEN` | optional | Stays `waiting_for_credentials` until set and approved by Meta |
| `INSTAGRAM_*`, `LINKEDIN_*`, `X_*`, `TIKTOK_*` | optional | Same: each channel stays waiting until its credentials and platform approval exist |

No social credential is needed for the agent to run safely. With no credentials, every publish is recorded as `waiting`, never as published.

## 5. Code release (OWNER APPROVAL REQUIRED)

1. Review and merge the release branch PR into `main`. Do not merge without approval.
2. Deploy to production only after Step 3 has succeeded. Deploying before the migration is safe but leaves the cron and admin tab returning database errors until the migration runs.
3. Post-deploy smoke tests on production (no publishing):
   - `GET /api/admin/marketing/overview` without a secret returns 401.
   - `GET /api/admin/marketing/overview` with the admin secret returns 200 with `unavailable` listed.
   - `GET /api/admin/marketing/channels` shows all five channels as `waiting_for_credentials`.
   - Open the Marketing Agent tab; confirm the Overview renders and System Health still links.

## 6. Rollback

- **Code:** redeploy the previous production deployment (`dpl_6SsKXSQyPoQU7QaYnTR7uyTCXH8s` is the current rollback target). The schema is additive, so the old code still runs against the new schema.
- **Database (only if no real posts exist):** drop the unique index and the added columns. Dropping tables is destructive and needs separate owner approval:

```sql
drop index if exists marketing_posts_external_unique_idx;
drop index if exists marketing_posts_publishing_idx;
alter table marketing_posts drop column if exists verification_notes, drop column if exists content_category,
  drop column if exists call_to_action, drop column if exists objective,
  drop column if exists intended_audience, drop column if exists title;
-- DESTRUCTIVE, separate approval: drop table marketing_agent_log, marketing_analytics, marketing_posts, marketing_campaigns, marketing_channels;
```

- **Cron:** if the scheduler misbehaves, disable the cron in `vercel.json` in a separate release, or pause scheduling by moving posts out of `scheduled`.

## 7. Required owner approvals before production

1. Applying migration 20261005 to production.
2. Applying migration 20261014 to production.
3. Setting or changing `CRON_SECRET`, `ANTHROPIC_API_KEY` or any social credential in Production.
4. Merging the release PR into `main` and promoting the deployment.
5. Closing the production runtime-identity check (Step 2.3) — a precondition for the migration.

The agent never publishes to social platforms. Enabling any platform requires its own credentials and explicit owner authorization.
