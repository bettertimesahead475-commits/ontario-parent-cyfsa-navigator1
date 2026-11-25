# Security Register

Baseline: OWASP ASVS 4.0 Level 2; Level 3 controls for administrator operations and legal records.
No regulatory compliance is claimed without independent verification.

## Findings and controls

| ID | Sev | Finding / control | Status | Evidence / owner |
|---|---|---|---|---|
| S-01 | High | `unsafe-eval` required by in-browser HEIC converter | Fixed | HEIC OCR moved server-side; strict CSP enforced (b141293) |
| S-02 | High | Admin pages stored the shared `ADMIN_SECRET` in sessionStorage; Express-only admin endpoints | Fixed (awaiting live verification) | fc8b31c: Firebase administrator authorization, secret UI removed |
| S-03 | High | Access code redeemable by any signed-in account that learns it | Fixed | purchase email/reference binding in activate-code |
| S-04 | Med | Job id reuse across accounts (report overwrite / read) | Fixed | `jobOwnerConflict`, owner-checked `loadPersistedReport` |
| S-05 | Med | Rate limiting is per isolate only | Open, blocked (B-3) | options below |
| S-06 | Med | DOCX decompression bomb | Fixed | 50 MB per-part limit in extraction |
| S-07 | Med | Prompt injection via document text | Mitigated | tag neutralization + untrusted-data instruction; Codex to test (T-14) |
| S-08 | Low | Postgres error messages/details logged | Fixed | credit RPC logs codes only |
| S-09 | Info | `/api/status` and `/api/analyze/job/:id` and `admin/gemini-models` still accept server-side `ADMIN_SECRET` header for operator tooling | Open (decide) | not browser-stored; remove once operators use the console |
| S-10 | — | Independent review of admin API | In progress | reviewer subagent; Codex T-14 |

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
