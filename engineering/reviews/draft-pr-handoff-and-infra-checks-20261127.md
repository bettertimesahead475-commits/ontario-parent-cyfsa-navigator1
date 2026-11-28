# Draft PRs and infrastructure handoff, 2026-11-27

## 1. Draft PRs to open (not yet created)

Blocked: `gh` is installed but not logged in (`gh auth status` reports no hosts), and no GitHub token is available to this session. CI runs on `pull_request` (ci.yml, cloudflare-staging-api.yml, cloudflare-migration-check.yml), so **no CI executes on these branches until the PRs exist**. Push-triggered workflows do not match `audit/*`, and the deploy workflow is `workflow_dispatch` only.

| Head branch | Head commit | Base branch (parent) | Title |
|---|---|---|---|
| `audit/pr191-settlement-sentinel` | `8755557` | `devin/1795810535-approve-vs-refund` (PR #191, `dd9993b`) | fix(admin): explicit settlement sentinel (PR #191) |
| `audit/pr194-corrections` | `2fa9b4e` | `devin/1795810799-free-trial-policy` (PR #194, `71f5b68`) | fix(free-trial): OCR per distinct document; supersede 3-free docs |
| `audit/release-register-20261127` | `ce90c75` | `main` | docs(audit): register, reviews and handoffs (not for merge) |

Commands for the owner, after `gh auth login` in a terminal:

```powershell
gh pr create --draft --base devin/1795810535-approve-vs-refund --head audit/pr191-settlement-sentinel --title "fix(admin): explicit settlement sentinel (PR #191)" --body "Draft: explicit 'unreadable' sentinel for the post-insert refund guard. Regression tests for every settlement state. Development branch; not for production."
gh pr create --draft --base devin/1795810799-free-trial-policy --head audit/pr194-corrections --title "fix(free-trial): OCR per distinct document; supersede 3-free docs" --body "Draft: OCR budget counts distinct documents, retries are idempotent; standalone free OCR allowance removed; stale wording superseded. Development branch; not for production."
gh pr create --draft --base main --head audit/release-register-20261127 --title "docs(audit): register and reviews" --body "Draft: documentation only. Not for merge."
```

Note: `--base` for the two fixes is the Devin branch they correct, so each diff shows only the audit change.

## 2. Read-only infrastructure checks for the owner or ChatGPT

No Cloudflare or Supabase access exists in this session. Exact identifiers and required evidence:

**A. Diagnostic deployment `a5b0ac88` and alias `diag-status-067446a` (Cloudflare Pages project `cyfsa-navigator-git-staging`)**
- Check: the production alias `cyfsanavigator.com` points at deployment `0cc59589-2be1-43d9-b41f-ff0c0c048792` (commit 82dfe65), not `a5b0ac88`.
- Check: `diag-status-067446a` resolves only to `a5b0ac88`; no custom domain references either.
- Check: rollback candidate `4c902955` (commit b9617a8) still exists and is not aliased to `a5b0ac88`.
- Evidence required: the alias list and each deployment's environment (production or preview) with its created date. No deletion before final owner authorization.

**B. Cloudflare Pages production branch setting**
- Check: the production branch of `cyfsa-navigator-git-staging` is `main` or `engineering/integration`, not any `audit/*` or `devin/*` branch. This confirms pushing the audit branches cannot promote to production.
- Evidence required: the Pages build settings screen, production branch field.

**C. Preview environment secrets**
- Check: preview environment contains no production Supabase or Anthropic secret values (compare by fingerprint or length, never values).
- Evidence required: the list of variable names per environment, with a yes/no for each secret being production-scoped.

**D. Supabase project identity (read-only)**
- Staging project `nxfhvebzzobegubefcda` (served by the staging Pages app): confirm `payments`, `access_codes`, `navigator_paid_sessions`, `free_usage` row counts only.
- Live project `qboidsfpjuxeqtfotryj`: confirm no Pages environment references its URL.
- Evidence required: row counts and project URL per environment. No migrations, no writes.

**E. Migration A/B backup and PITR**
- Check: Supabase dashboard, project `nxfhvebzzobegubefcda` and `qboidsfpjuxeqtfotryj`, backups and point-in-time recovery status.
- Evidence required: screenshot or export of the backup and PITR settings with timestamps.

**F. Gemini configuration**
- Check: the production `GEMINI_API_KEY` secret's shape, reported as the key's status string only (`configured` or `unusable`) from the existing `/api/_status` admin response. No values.
- Check: Worker tail logs for `[CONFIG_SECRET_UNUSABLE]` over the last 7 days, count only.

**G. Google Search Console (Section 17)**
- Check: the owner confirms the property for `cyfsanavigator.com` is verified, the sitemap is submitted, and the coverage report lists no private route as indexed.
- Evidence required: the verified property name and sitemap status. No credentials handled by Claude.

## 3. What remains unverified in this session

Items A to G above. CI results for every audit branch (PostgreSQL 16 concurrency, PostgREST, Vitest, TypeScript, SonarCloud, CodeRabbit, security, Cloudflare build), because no PR exists yet to trigger them.
