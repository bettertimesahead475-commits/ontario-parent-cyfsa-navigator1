# Blockers (external; each blocked requirement remains incomplete)

| ID | Blocker | Blocks | Needed from owner | Recorded |
|---|---|---|---|---|
| B-1 | Inference budget ≈ $0.40 USD remaining | Live Final Case Assessment run, repeated Forensic performance sampling, AI evaluation against real providers | Budget increase (a Forensic run costs ≈ $0.25–0.45; Quick ≈ $0.05–0.10) | 2026-11-25 |
| B-2 | No second (non-owner) Google test account in the browser harness | Live end-to-end of request-access → approve → activate-code → paid credit consumption → refund as a real customer | Sign in a dedicated test Google account in the harness Edge profile, or approve a synthetic Firebase account | 2026-11-25 |
| B-3 | Persistent (cross-isolate) rate limiting needs storage | Global limits for analyze/extract/activate-code (current limiter is per isolate) | Choose an option in `SECURITY_REGISTER.md` S-RL (Workers KV / Durable Object / Supabase table / Cloudflare rule); some have recurring cost | 2026-11-25 |
| B-4 | Preview environment secrets are placeholders | Functional (non-visual) testing on preview deployments | Approve separate test secrets for the preview environment (no new project needed) | 2026-11-25 |
| B-5 | CodeRabbit and SonarQube are not configured on the repository | Independent static analysis | Install/authorize the GitHub apps (free tiers exist for public repos; check repo visibility) | 2026-11-25 |
| B-6 | Production database schema lacks `credit_audit_ledger`, settlement and suspension columns (migrations pending approval) | Database-native audit table (worked around with append-only Storage audit objects) | Approve `supabase/migrations_pending_approval/paid_payments_columns_minimal.sql` or a new audit-table migration | 2026-11-25 |
| B-7 | `git push` from the agent shell may need interactive credentials | Publishing engineering branches to GitHub | Run the push commands listed in `SESSION_HANDOFF.md` if the agent push fails | 2026-11-25 |
