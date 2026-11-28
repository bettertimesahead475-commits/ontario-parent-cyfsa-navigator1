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
| T-07 | P1 | Database audit (RLS, indexes, constraints) read-only; prepare reversible migrations | Claude | todo | | no production DDL without approval. 2026-11-27: Devin's Supabase MCP cannot read project `nxfhvebzzobegubefcda` (permission denied; it only lists the inactive Vercel-org projects) |
| T-08 | P1 | Synthetic analyzer evaluation set and metrics harness (mocked provider) | Claude | done | | eval/analyzer-guards; found S-15 |
| T-09 | P1 | Alerting on failed jobs / health on existing infrastructure | Claude | todo | | no paid services |
| T-10 | P1 | Visual-regression baselines for all public pages (desktop + mobile) | Antigravity | todo | Owner | against production `7d57b59b` |
| T-11 | P1 | PDF export verification: Quick, guide, templates (real PDF bytes, text inspected) | Devin Agent B | doing | Owner | reuse approach of harness `pdf-export-check.mjs` |
| T-12 | P1 | Accessibility audit (axe) of key pages; fix violations without visual change | Devin Agent B | doing | | |
| T-13 | P2 | Admin console usability/accessibility pass | Antigravity | todo | Claude | API contract fixed in API_CONTRACTS.md; edits via request |
| T-14 | P1 | Adversarial tests: authz bypass, IDOR on jobs/reports, upload abuse, prompt injection | Devin Agent A | doing | Owner | findings → engineering/security/ |
| T-18 | P2 | Upload-limit error box in DocumentAnalyzerTab (line ~3412) lacks role="alert": screen readers do not announce "maximum allowed limit of 20 files" | Devin Agent B | doing | Claude | accessibility; no visual change |
| T-19 | P3 | Owner workspace holds 20 synthetic harness files; remove them (owner decision) so uploads can be re-measured | Owner | todo | Claude | 2026-11-27 Devin removed 3 duplicate `synthetic-native.pdf` copies to run the release smoke; cabinet is back at 20 after the 3 test uploads |
| T-16 | P1 | Unique index on payments.reference_number (reversible migration, owner approval) | Claude | todo | review S-11 | |
| T-20 | P2 | Direct-path create-once claim of `<id>.json` before credit reservation (S-19) | Claude | done | review | 8606a0b + 88ac7be (queued producer claims too); two independent re-reviews |
| T-26 | P2 | Per-payment index for the admin audit trail (decisions currently read the whole trail; refused beyond 20,000 records, console warns at 16,000; production 0 today) | Claude | todo | review | before the warning appears |
| T-27 | P3 | A request refused after its id claim (limit/session/reservation) leaves a "running" record that times out; write the refusal as failed state | Claude | todo | review | cosmetic: no charge, no report |
| T-21 | P1 | SonarCloud frontend findings: 68× S6853 form labels, 20× S6848 non-native interactive elements, ~35× S9383 floating promises (src/**, public/sw.js), S2245 PricingTab Math.random, 9× S8786 regexes in src/**, formRegistry sort | Antigravity | todo | Claude | list: engineering/sonar/FINDINGS.md; preserve visuals |
| T-22 | P1 | Frontend unit coverage 35.6 % (src/components) | Antigravity | todo | Claude | backend ≥ 85 % |
| T-23 | P2 | Remove obsolete Vercel commit statuses (3 projects, "Account is blocked") — repository/Vercel settings | Owner | todo | Devin | B-11 |
| T-24 | P2 | Worktree isolation: a concurrent session edited AdminConsole.tsx/.test.tsx in Claude's worktree (2026-11-26); change reviewed and kept (847c4e0) | All agents | done | Claude | agents must use their own worktree |
| T-25 | P2 | Re-run SonarCloud on the integration code: PR #115 head is the production branch (only updated on release); open a PR engineering/integration → main for analysis | Owner/Claude | todo | | gh CLI not available to the agent |
| T-15 | P2 | Flaky tests under full-suite load | Claude | done | | cause: unmocked real-network calls; fixed 105a47b + c82e971 |
| T-28 | P0 | Owner's Forensic run of 2026-11-28 (`req_1795884084495_dopi1vsbsan`): browser stopped polling at 16:43:42 UTC, server completed at 16:44:18 with a saved report; root cause of the stall not established | Claude | blocked | Owner | Evidence: `engineering/incidents/2026-11-28-forensic-stall.md`. Blocked on Cloudflare Worker and Pages logs for 16:40–16:46 UTC. No Cloudflare log tool is available to the agent in this session (only Supabase and Vercel tools), so historical logs are unavailable. Diagnostic timing (`[JOB_STATUS_TIMING]`) added to the status endpoint in the development branch; it needs a deploy and approval to reach production. |
| T-29 | P1 | Cancelling a Forensic job only stops browser polling; the server keeps running and spends provider budget to completion. Needs a design decision (server-side cancel versus keep-and-save). | Claude | todo | Owner | Design decision required before code. Not release-blocking on its own. |
| T-30 | P1 | Browser status poll: 20 s per-read abort plus backoff can leave the owner's view silent for 20–35 s. Fix only after T-28 logs confirm the cause. | Claude | todo | Claude | Gated on T-28. |
| T-31 | P2 | Stop-gate hook (`.claude/settings.json` → `scripts/stop-gate.mjs`): blocks stop only while a P0 row is todo/doing or production-code edits are uncommitted; a blocked P0 does not stop work. `scripts/release-readiness.mjs` fails unless every P0 is done | Claude | done | Owner | Autonomous-loop completion gate, corrected |

Reassigned 2026-11-27 by the lead engineer: T-11, T-12, T-18 and T-14 had no activity on their Antigravity/Codex branches since 2026-11-25 and moved to Devin Agents B and A. FILE_OWNERSHIP rules still apply: T-14 adds tests and findings only; production fixes go through the lead.
