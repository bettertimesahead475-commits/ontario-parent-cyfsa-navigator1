# Why Cloudflare Preview deployments report `analyzerReady: false` (2026-11-27)

Read-only diagnosis. No setting, secret or deployment was changed. The only write was a temporary log tail on
preview deployment `3a1ef4c8`, which was deleted afterwards.

## Root cause

Cloudflare Pages project `cyfsa-navigator-git-staging` (account `6dea4d69…`) has separate **Preview** and **Production**
variable scopes. In the Preview scope, three secrets **exist** but their values fail the documented key-format check in
`functions/api/_status.ts` (`providerKeyStatus`):

- `STAGING_SUPABASE_SERVICE_ROLE_KEY`;
- `ANTHROPIC_API_KEY`;
- `GEMINI_API_KEY`.

Evidence: a tail on RC preview `3a1ef4c8` (`release/rc-20261127` @ `4c73750`), requesting `/api/_status`, logged:

```
warn ["[CONFIG_SECRET_UNUSABLE]", "{\"secrets\":[\"STAGING_SUPABASE_SERVICE_ROLE_KEY\",\"ANTHROPIC_API_KEY\",\"GEMINI_API_KEY\"]}"]
```

The log contains names only. `isLiveReady` requires the Supabase and Anthropic keys to be `configured`, so readiness is false.

## What it is not

| Hypothesis | Result |
|---|---|
| RC code change | No. `_status.ts` and `_entitlement-readiness.ts` are identical between production `82dfe65` and the RC. The preview built from **`82dfe65` itself** (`afd4754b`) also reports `false`. |
| Missing variable names | No. Preview has every name the check needs: `ANALYZER_ENABLED`, `FIREBASE_PROJECT_ID`, `STAGING_SUPABASE_URL`, `STAGING_SUPABASE_SERVICE_ROLE_KEY` and `ANTHROPIC_API_KEY`. |
| Plain-text values | No. They are identical in both scopes: `ANALYZER_ENABLED="true"`, the same `FIREBASE_PROJECT_ID`, and `STAGING_SUPABASE_URL=https://nxfhvebzzobegubefcda.supabase.co/`. |
| Bindings and settings | No. Both scopes have `ANALYZER_JOBS_QUEUE`, compatibility date `2026-10-29`, no flags and the standard usage model. |
| Recent regression | No. Every preview checked returns `false`, back to the oldest retained preview (`5698a413`, 2026-11-25). Production (`cyfsanavigator.com`) returns `true`. |

Production-only names: `ADMIN_SECRET` and `GEMINI_OCR_MODEL`. Their absence from Preview does not affect `analyzerReady`.

## Why engineering access cannot fix it

The Cloudflare API never returns secret values, so the production values cannot be copied into Preview.
Fixing it means entering three secret values, and only the key holder can do that.

## Risk to decide before fixing

Preview builds every branch (`preview_deployment_setting: all`, 200+ previews in 2 days), and Preview's `STAGING_SUPABASE_URL` is the
live ledger. Valid Preview keys would give every agent branch the production service-role key and paid AI keys.
The current placeholder values look like a deliberate safeguard. Safer options, in order:

1. Restrict Preview builds to `release/rc-*` before adding valid keys.
2. Point Preview at a separate Supabase project.
3. Qualify the RC without live inference (the current plan). Leave Preview not-ready.
