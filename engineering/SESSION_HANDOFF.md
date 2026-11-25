# Session Handoff (read first after any restart)

Last updated: 2026-11-25 by Claude.

## State

- Production: deployment `7d57b59b` / commit `b141293` (tag `baseline/prod-20261125-b141293`). Unchanged today.
- `engineering/claude-backend` = baseline + fc8b31c (Firebase-authorized admin API and console). Not deployed yet.
  An independent security review of fc8b31c is running; fix confirmed findings, then T-04 (deploy + live checks).
- `engineering/integration` = baseline + these control documents.
- Inference budget remaining ≈ $0.40 (no paid runs today).

## Antigravity: start here

1. Worktree: `C:\Users\pelki\Projects\cyfsa-worktrees\antigravity-frontend` (branch `engineering/antigravity-frontend`,
   based on the production baseline + control documents). Do not work in other worktrees.
2. Read `MASTER_PLAN.md`, `FILE_OWNERSHIP.md`, `API_CONTRACTS.md`, then your tasks in `TASK_REGISTER.md` (T-10..T-13).
3. Visual baselines: capture against https://cyfsanavigator.com (production `7d57b59b`). Your branch's Cloudflare preview
   (`https://engineering-antigravity-frontend.cyfsa-navigator-git-staging.pages.dev`) renders the UI, but its APIs are inert
   (placeholder secrets), so use it for visual checks only.
4. Do not deploy to production, change pricing, colours, typography, layout or navigation, or spend inference budget.
5. Hand off in `engineering/handoffs/antigravity-<date>.md` on your branch.

## Codex: start here

Worktree `C:\Users\pelki\Projects\cyfsa-worktrees\codex-security` (branch `engineering/codex-security`). Task T-14.
Write tests under `tests/security/` and findings under `engineering/security/`. Do not edit production code, do not
call production with real customer data, do not use AI budget.

## Push (if the agent shell cannot authenticate, run these yourself)

```
git -C C:\Users\pelki\Projects\ontario-parent-cyfsa-navigator1 push origin engineering/integration engineering/claude-backend engineering/antigravity-frontend engineering/codex-security baseline/prod-20261125-b141293
```
