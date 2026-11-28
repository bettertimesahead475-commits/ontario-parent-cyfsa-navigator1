# Implementation progress and branch register, 2026-11-27 (Claude, owner directive)

Development is local only. Nothing is pushed, deployed, migrated or sent. Each branch is cut from the Devin head it corrects and must be reviewed before merging.

## Branches and commits

| Item | Branch | Commit | Base | Status |
|---|---|---|---|---|
| PR #191 settlement sentinel | `audit/pr191-settlement-sentinel` | `8755557` | `dd9993b` | Implemented. Explicit `'unreadable'` sentinel replaces overloaded `null`. Approve and reissue fail closed. 62/62 admin tests pass (incl. 6 new settlement-state tests). Mutation test: ignoring the sentinel fails both unreadable tests. tsc clean. |
| PR #194 corrections | `audit/pr194-corrections` | `7a43ccf` | `71f5b68` | Implemented. Free OCR budget = one read per free analysis (`FREE_OCR_LIFETIME_LIMIT` = quick + forensic), no standalone allowance. Stale "3 free" handoff and RC wording marked superseded. New policy test. tsc clean. 7 related test files: 35/35 pass. |
| Register and PR #194 static review | `audit/release-register-20261127` | `93a267c`, `4715144` | n/a | Documentation only. |

## PR #194 requirements status (against owner directive)

- Grandfathered unused Quick allowances kept; consumed ones not reset: implemented in PR #194 (`LEGACY_FREE_QUICK_LIMIT` = 3 on the legacy counter, min with use). Static PASS.
- One lifetime Quick and one lifetime Forensic for new eligible accounts: PASS (static).
- OCR only in support of an authorised analysis, no standalone allowance: **fixed on `audit/pr194-corrections`**.
- 30 pages and 10 MB, provisional: in place.
- Stale three-free documentation and copy: handoff and RC marked superseded. Customer-facing copy in PR #194 already uses `FREE_TRIAL_LIMITS`.
- Verified email, Turnstile, persistent rate limiting, proportionate abuse detection: present in PR #194 (`_free-trial.ts`). Turnstile is off unless `TURNSTILE_SECRET_KEY` is configured. **Owner/ops action: confirm the secret.**
- No blanket household restriction; no paid identity verification: PR #194 keys on verified email hash and IP caps (6/day, 15/month). IP caps are per address, so they affect shared households at the margin. Owner to confirm the thresholds.

## Database qualification (item 5)

- No PostgreSQL 16, Docker or PostgREST on this machine.
- **Existing CI already provides one**: `.github/workflows/ci.yml` (origin/engineering/integration) runs a `postgres:16` service with `CREDIT_PG_URL` and `NAVIGATOR_PG_TEST_ADMIN_URL` on a local disposable database. The `*.pg.test.ts` suites (about 359 tests) run there.
- Qualification therefore runs by pushing the audit branches to the repository, which is outward-facing and needs your approval. No Supabase project is used.
- Not run yet: the PR #191 race tests and PR #194 `free-trial-entitlements.pg.test.ts` on these branches.

## Not started or blocked

- **Spending controls (item 3)**: the caps in PR #194 (`takePaidUsageUnit`, platform lanes) exist, but the directive's $5/$10 daily and $75/$150 monthly warning and hard limits are not implemented. No ledger migration written. Not started in this pass.
- **Legacy Express (item 4)**: `api/services/usage.ts` is imported only by `api/_server.ts`, which is imported only by `api/index.ts` (the Vercel entry point). Nothing on the Cloudflare path reaches it. Its constants (FREE_ANALYSES_LIMIT = 1, Premium 5 + 5) conflict with the policy. Removal is gated: `_server.test.ts` and three analyzer end-to-end tests mock it. Removal requires the Vercel disconnect decision in `CLAUDE.md`, and it has not been performed.
- **Diagnostic deployment a5b0ac88 (item 7)**: BLOCKED. No Cloudflare API access in this session; cannot verify aliases or traffic. Removal procedure to be prepared from the preview worktree. Not deleted.
- **PR #173 SEO audit and Search Console (item 6)**: not performed in this pass. Needs the PR #173 head located and staging read access.
- **PR #181/#184 refunds, PR #182/#183/#187/#193/#211, QA backend, Antigravity, analyzer latency**: not started in this pass.
- **Gemini configuration and migration A/B**: no new evidence this pass; still open.

## Owner decisions

1. Approve pushing `audit/pr191-settlement-sentinel` and `audit/pr194-corrections` so CI runs the PostgreSQL qualification.
2. Confirm `TURNSTILE_SECRET_KEY` is configured on the Pages environment.
3. Set the spending ceilings (proposed $5/$10 daily, $75/$150 monthly, unapproved).
4. Decide whether to remove the legacy Express path (after the Vercel disconnect).
5. Authorize deletion of `a5b0ac88` only after the dependency check is written up.
