# Release Checklist (production promotion; Claude only)

1. Source is `engineering/integration`; every merged workstream has a handoff with review and test evidence.
2. `npx tsc --noEmit -p .` clean; full vitest suite passes (known flakes re-run in isolation and recorded).
3. Security-relevant changes have an independent review recorded in `SECURITY_REGISTER.md`.
4. No new paid resources, no pricing change, no secret changes; `public/_headers` CSP unchanged or reviewed.
5. Record the current production deployment id as the rollback target.
6. Merge into the production branch `migration/cloudflare-staging-20261029`; push.
7. Create the deployment manually (automatic production deployments are disabled):
   `POST /accounts/{acct}/pages/projects/cyfsa-navigator-git-staging/deployments` with `branch=migration/cloudflare-staging-20261029`.
8. Wait for `latest_stage = deploy: success`. Confirm `canonical_deployment` id and commit hash.
9. Smoke checks: `/api/health` 200; home page renders; `/api/status` analyzerReady true; response headers contain the CSP;
   Google sign-in popup opens; signed-in extraction of a synthetic file; admin `/api/admin/session` 401 without a token.
10. If any check fails: roll back to the recorded deployment, record it in `SESSION_HANDOFF.md`.
11. Update `ACCEPTANCE_CRITERIA.md`, `TEST_REGISTER.md`, `SESSION_HANDOFF.md`.
