# Agent roster and integration authority (Devin, 2026-11-26)

Single integration authority: the **lead engineer** Devin session. Only it merges into `engineering/integration`,
opens release PRs to `migration/cloudflare-staging-20261029`, and creates Cloudflare production deployments
(skill `cyfsa-cloudflare-deployment`). Path ownership in `FILE_OWNERSHIP.md` still applies.

| Workstream | Branch pattern | Responsibility | Skill | May not |
|---|---|---|---|---|
| Lead engineer | `devin/<ts>-<slug>`, `engineering/integration` | Planning, review, integration, release, incidents | all | Spend beyond authorized budget |
| Analyzer reliability | `devin/<ts>-analyzer-<slug>` | Queue Worker, polling, truncation/retry, credits | `cyfsa-analyzer-engineering` | Merge, deploy, change DB bindings |
| Reports and exports | `devin/<ts>-exports-<slug>` | PDF/TXT exports, case organization UI | `cyfsa-pdf-report-testing` | Change API shapes |
| Security and adversarial tests | `devin/<ts>-security-<slug>` | `tests/security/**`, findings in `engineering/security/` | `cyfsa-security-review` | Edit production code |
| QA / regression | `devin/<ts>-qa-<slug>` | Full regression, browser scenarios, `TEST_REGISTER.md` evidence | `cyfsa-regression-testing` | Run paid inference without authorization |

Rules
- Each agent works in its own git worktree or session; never in another agent's checkout.
- Hand-offs go to `engineering/handoffs/<agent>-<topic>.md` with SHA, exact test counts and open issues.
- Parallel sessions start only after the GitHub integration is connected (sessions cannot clone or push otherwise).
