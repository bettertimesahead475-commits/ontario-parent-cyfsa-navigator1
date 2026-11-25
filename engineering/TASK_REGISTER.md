# Task Register

Status: todo · doing · review · done · blocked. One owner per task. Pick the highest-priority `todo` you own.

| ID | Pri | Task | Owner | Status | Requested by | Notes |
|---|---|---|---|---|---|---|
| T-01 | P0 | Baseline, branches, worktrees, ownership, contracts | Claude | done | Owner | tag `baseline/prod-20261125-b141293` |
| T-02 | P0 | Admin API on Pages Functions + Firebase administrator auth | Claude | done | Owner | fc8b31c; independent review running |
| T-03 | P0 | Admin console without browser-stored secrets | Claude | done | Owner | `src/components/admin/AdminConsole.tsx` |
| T-04 | P0 | Deploy admin to production; live 401/403/admin checks with the owner account | Claude | done | | a67747aa; harness `admin-live-check.mjs` |
| T-17 | P2 | Remove dead Vercel analytics from Cloudflare site (touches shared src/App.tsx) | Claude | done | | 002ba9a; Antigravity informed via this register; deploy with next release |
| T-05 | P1 | Persistent rate limiting options with exact costs | Claude | todo | Owner | → SECURITY_REGISTER S-RL, B-3 |
| T-06 | P1 | Queue dead-letter verification and stuck-job recovery | Claude | done | | DLQ live with relay consumer; max_retries 5; worker DLQ tests |
| T-07 | P1 | Database audit (RLS, indexes, constraints) read-only; prepare reversible migrations | Claude | todo | | no production DDL without approval |
| T-08 | P1 | Synthetic analyzer evaluation set and metrics harness (mocked provider) | Claude | todo | | |
| T-09 | P1 | Alerting on failed jobs / health on existing infrastructure | Claude | todo | | no paid services |
| T-10 | P1 | Visual-regression baselines for all public pages (desktop + mobile) | Antigravity | todo | Owner | against production `7d57b59b` |
| T-11 | P1 | PDF export verification: Quick, guide, templates (real PDF bytes, text inspected) | Antigravity | todo | Owner | reuse approach of harness `pdf-export-check.mjs` |
| T-12 | P1 | Accessibility audit (axe) of key pages; fix violations without visual change | Antigravity | todo | | |
| T-13 | P2 | Admin console usability/accessibility pass | Antigravity | todo | Claude | API contract fixed in API_CONTRACTS.md; edits via request |
| T-14 | P1 | Adversarial tests: authz bypass, IDOR on jobs/reports, upload abuse, prompt injection | Codex | todo | Owner | findings → engineering/security/ |
| T-16 | P1 | Unique index on payments.reference_number (reversible migration, owner approval) | Claude | todo | review S-11 | |
| T-15 | P2 | Flaky tests under full-suite load | Claude | done | | cause: unmocked real-network calls; fixed 105a47b + c82e971 |
