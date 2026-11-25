# Security Register

Baseline: OWASP ASVS 4.0 Level 2; Level 3 controls for administrator operations and legal records.
No regulatory compliance is claimed without independent verification.

## Findings and controls

| ID | Sev | Finding / control | Status | Evidence / owner |
|---|---|---|---|---|
| S-01 | High | `unsafe-eval` required by in-browser HEIC converter | Fixed | HEIC OCR moved server-side; strict CSP enforced (b141293) |
| S-02 | High | Admin pages stored the shared `ADMIN_SECRET` in sessionStorage; Express-only admin endpoints | Fixed and verified live (a67747aa) | fc8b31c: Firebase administrator authorization, secret UI removed |
| S-03 | High | Access code redeemable by any signed-in account that learns it | Fixed | purchase email/reference binding in activate-code |
| S-04 | Med | Job id reuse across accounts (report overwrite / read) | Fixed | `jobOwnerConflict`, owner-checked `loadPersistedReport` |
| S-05 | Med | Rate limiting is per isolate only | Open, blocked (B-3) | options below |
| S-06 | Med | DOCX decompression bomb | Fixed | 50 MB per-part limit in extraction |
| S-07 | Med | Prompt injection via document text | Mitigated | tag neutralization + untrusted-data instruction; Codex to test (T-14) |
| S-08 | Low | Postgres error messages/details logged | Fixed | credit RPC logs codes only |
| S-09 | Info | `/api/status` and `/api/analyze/job/:id` and `admin/gemini-models` still accept server-side `ADMIN_SECRET` header for operator tooling | Open (decide) | not browser-stored; remove once operators use the console |
| S-10 | — | Independent review of admin API (fc8b31c): no authz bypass, no PostgREST filter injection, no XSS; 10 findings (4 medium, 6 low); re-review of fixes: 7 more (concurrency edge cases, low/medium-low) | All fixed (c82e971, fb4f4e5); each re-review test verified failing on prior code | reviewer subagent 2026-11-25; regression tests `api/cloudflare-admin-api.test.ts` › "independent review findings" |
| S-11 | Med | Payment references were 5 random characters with no unique index (collision ≈1.7% at 1,000 payments) | Fixed for new references (8 chars); admin refuses duplicates | unique index needs a migration (owner approval) |
| S-12 | Med | Tests sent requests to the real production Supabase project (fake key) | Fixed | `tests/setup/no-external-network.ts` |
| S-14 | Info | Live CSP check: "unsafe-eval" console message comes from a browser extension content script, not the site; page records 0 violations | Verified | `csp-eval-trace.mjs` 2026-11-25 |
| S-15 | Med | Prompt-injection: a document tag with a line break inside (`<
/document
>`) survived neutralization and could close the document block | Fixed a7c6b47; deployed (Pages d5f2a3c9, executor 4cd2181f) | found by `eval/analyzer-guards` |
| S-13 | Info | Frontend bundle contains no Supabase URL or key; all database access is server-side with the service key | Verified | production bundle scan 2026-11-25 |

## S-RL: persistent rate-limiting options (no provisioning without owner approval)

Prices from Cloudflare/Supabase public pricing as known on 2026-11-25; confirm on the billing page before choosing.

| Option | How | Recurring cost | Trade-offs |
|---|---|---|---|
| 1. Cloudflare WAF rate-limiting rule | Zone rule on `/api/analyze*`, `/api/extract-text`, `/api/activate-code` keyed by IP | Free plan includes 1 rule (10 s window); more rules / longer windows need Pro ($20–25/mo per zone) | No code; IP-based only (not per account); coarse |
| 2. Supabase table + atomic RPC | `rate_limit_hits(key, window_start, count)` with `insert … on conflict … do update … returning` | $0 (existing database) | One extra DB round trip (~30–80 ms) per limited request; reversible migration needed (B-6 style approval) |
| 3. Workers KV | counter per key/window | Free: 1,000 writes/day (insufficient at volume); Workers Paid $5/mo includes 1M writes | Eventually consistent: allows bursts across locations |
| 4. Durable Object limiter | one object per subject, strongly consistent | Free plan (SQLite-backed DOs) has a daily request allowance; Workers Paid $5/mo for higher volume | Most accurate; new Worker binding to deploy |

Recommendation: Option 2 (no cost, uses existing database, exact per-account limits) for analyze /
activate-code / request-access, plus Option 1's free rule as IP-level backstop for extract-text.

## S-AL: alerting options for failed/stuck analyses and outages (no provisioning without owner approval)

Detection already exists: `/api/admin/monitoring/status` (stuck jobs, recent failures, database reachability) and
`/api/admin/jobs?status=failed`. What is missing is delivery to a person.

| Option | How | Recurring cost | Owner action needed |
|---|---|---|---|
| 1. Cloudflare Health Check / Notifications | Notification on Pages deployment failure; uptime check on `/api/health` | Pages deployment notifications: free. Health Checks: Pro plan or higher | Enable in dashboard; choose email recipient |
| 2. Cron-triggered check in the existing executor Worker + Cloudflare Email Routing `send_email` | Every 15 min: query failed/stuck jobs, email a summary to a verified address | $0 (cron triggers and Email Routing are free) | Enable Email Routing on cyfsanavigator.com (adds MX/TXT records; conflicts with any existing mail provider on that domain) and verify the destination address |
| 3. External uptime monitor (e.g. a free-tier HTTP monitor) on `/api/health` | Third-party pings | $0 on free tiers | Create the account; it only sees public health status |

Recommendation: Option 1 for deployments (free, no code) plus Option 3 for uptime; Option 2 if the domain has
no other mail service.
