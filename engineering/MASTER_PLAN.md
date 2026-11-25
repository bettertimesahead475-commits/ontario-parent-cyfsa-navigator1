# CYFSA Navigator — Engineering Master Plan

Control directory for concurrent engineering agents. Recover state from these files after any restart or
context compaction: start with `SESSION_HANDOFF.md`, then `TASK_REGISTER.md` and `BLOCKERS.md`.

## Authority and workstreams

| Agent | Role | Branch | Worktree (owner machine) |
|---|---|---|---|
| Claude Code | Lead engineering and integration authority; backend, admin, infrastructure, database, AI analyzer | `engineering/claude-backend` | `C:\Users\pelki\Projects\ontario-parent-cyfsa-navigator1` |
| Antigravity | Frontend engineering, browser verification, accessibility, visual preservation, PDF export verification | `engineering/antigravity-frontend` | `C:\Users\pelki\Projects\cyfsa-worktrees\antigravity-frontend` |
| Codex | Independent security engineering, adversarial testing, QA | `engineering/codex-security` | `C:\Users\pelki\Projects\cyfsa-worktrees\codex-security` |
| Integration | Only verified, reviewed changes; source of production promotion | `engineering/integration` | `C:\Users\pelki\Projects\cyfsa-worktrees\integration` |

CodeRabbit and SonarQube are not configured yet (see `BLOCKERS.md`). They must never receive credentials,
customer records or confidential documents.

## Verified production baseline (2026-11-25)

- Site: https://cyfsanavigator.com (Cloudflare Pages project `cyfsa-navigator-git-staging`, account `6dea4d69…`).
- Production deployment `7d57b59b-aec9-4f5f-9ada-46105dfc7f30`, commit `b141293`, production branch
  `migration/cloudflare-staging-20261029`. Git tag: `baseline/prod-20261125-b141293`.
- Automatic production deployments are **disabled** (`production_deployments_enabled=false`). Every branch gets a
  preview deployment only. Preview environments have placeholder secrets, so preview APIs cannot reach the
  database or AI providers: previews are for visual and frontend verification only.
- Rollback targets (Pages deployments → commit): `7d57b59b`→`b141293` (current), `74f3fe5d`→`0e0808e`,
  `d1805da1`→`99eeaf3`, `88c60f30`→`b9a1232`, `d8da2cd1`→`69750af`, `e62bcbbd`→`a84ece8`.
  Rollback: Cloudflare dashboard → Pages → Deployments → "Rollback to this deployment", or
  `POST /accounts/{acct}/pages/projects/cyfsa-navigator-git-staging/deployments/{id}/rollback`.
- Queue: Pages binding `ANALYZER_JOBS_QUEUE` → `cyfsa-staging-analyzer-jobs` → relay Worker
  `cyfsa-staging-analyzer-queue-consumer` → service binding → Worker `cyfsa-analyzer-queue-consumer`.
- Database: Supabase project `nxfhvebzzobegubefcda` (shared by staging and production; contains real customers).

## Integration flow

1. Each agent works only in its own branch/worktree and only on files it owns (`FILE_OWNERSHIP.md`).
2. Agents merge `engineering/integration` into their branch regularly; never the reverse.
3. Handoff (append to `engineering/handoffs/<agent>-<date>.md` in the agent's branch): implementation summary,
   changed files, architectural decisions, self-review results, independent review results, test evidence,
   known limitations, integration instructions.
4. Claude reviews each handoff independently, merges into `engineering/integration`, and runs the full suite
   (`RELEASE_CHECKLIST.md`).
5. Production promotion only from `engineering/integration`, by Claude, through the release checklist: merge to the
   production branch, then a manual Pages deployment (automatic promotion stays disabled).

## Phases

1. Workspace, baseline, ownership, contracts (done 2026-11-25).
2. Administrative backend on Pages Functions with Firebase administrator authorization (implemented; see tasks).
3. Security completion: concurrency protections, persistent rate-limiting options, independent review.
4. Database audit (read-only against production; reversible migrations prepared, not executed without approval).
5. AI analyzer verification with synthetic evaluation sets (mocked providers; paid runs only within budget).
6. Infrastructure: monitoring, health checks, alerting on existing infrastructure, release gates.
7. Performance measurement and confirmed-bottleneck optimization.
8. Final acceptance dossier.

## Non-negotiable constraints

- No website redesign. Branding, colours, typography, layout, navigation, pricing and report presentation are preserved.
- No paid resources, new recurring costs, payment providers or pricing changes without owner authorization.
- Inference budget is held centrally by Claude (`TEST_REGISTER.md` → spending register). Other agents: $0.
- No real financial transactions; never modify real customer balances; synthetic documents and fixtures only.
- Never expose credentials, customer records or confidential documents in logs, commits, chat or external services.
- Do not delete, rotate or overwrite working secrets. No destructive migrations.
