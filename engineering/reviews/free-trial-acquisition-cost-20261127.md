# Free-trial policy: implementation and maximum acquisition cost (2026-11-27)

Branch `devin/1795810799-free-trial-policy`. Nothing applied, deployed or spent. The qualification document named in the
handoff (`engineering/reviews/free-trial-policy-qualification-20261127.md`, commit `e6da09d`) is not in the repository or
on GitHub, so G-1..G-7 are mapped below from the owner's decisions.

## Policy as enforced on the server

| Decision | Where | Enforcement |
|---|---|---|
| 1 lifetime free Quick Review, 1 lifetime free Forensic Deep Scan, separate counters | `functions/api/_free-trial.ts` | `free_usage` rows `fq:<h>` / `ff:<h>`, h = SHA-256 of the normalized verified email (Gmail dots/`+tag`/googlemail folded). Reserved through the existing advisory-locked `free_reserve_scan`. No monthly reset. |
| Earlier allowance honoured | same | An account whose Firebase-UID counter is already > 0 keeps its 3 Quick Reviews on that row; it also gets the 1 Forensic. |
| Purchased credits preserved | same | Free code never reads or writes `paid_session_*` rows (pg test). |
| Verified email + CAPTCHA | same, `analyze.ts` | Unverified email: `EMAIL_VERIFICATION_REQUIRED`. Turnstile checked server-side when `TURNSTILE_SECRET_KEY` is set or `FREE_TRIAL_REQUIRE_CAPTCHA=true` (`X-Turnstile-Token`). |
| Persistent account-creation abuse | same | Entitlement keyed on the email, not the account, so deleting and re-creating an account gets nothing; per-IP caps 6/day and 15/month (`fip:`/`fim:`, IP hashed). No phone check, no domain blocklist. |
| Free document limit | `extract-text.ts`, `_document-extraction.ts`, `analyze.ts` | 10 MB, 30 pages, 30 OCR pages; text ceiling 75,000 (Quick) / 105,000 (Forensic) chars. Paid limits unchanged (20 MB, 200 pages). |
| OCR only for authorized processing | `authorizeFreeOcr` | No paid session: OCR only while a free analysis is left, at most 2 OCR documents per verified email, platform cap 30/day. |
| Audio transcription and Final Case Assessment paid-only | `transcribe.ts`; FCA already required a paid session | 402 `PAID_FEATURE_REQUIRED` without a verified paid session; 503 if the plan cannot be checked; no provider call. |
| Failure restores the entitlement | `analyze.ts`, queue consumer | Existing release paths, now keyed by the reservation's own counter (`freeCounterKey`). |
| Bounded retries of failures | `FREE_TRIAL_MAX_ATTEMPTS = 3` (`fat:` counter), queue consumer | Each entitlement can start at most 3 provider runs in its lifetime; new requests and queue redeliveries both spend from it, a retry of the same request does not. When spent, the job fails and the entitlement is returned. If the ledger is unreachable on a redelivery, the queue's `max_retries` (5) is the bound. |
| Per-account and platform limits before provider calls | `reserveFreeTrial`, `analyze.ts` | Free Quick 25/day, free Forensic 10/day, free OCR 30/day, paid 300/day; all env-configurable (`0` blocks, `off` disables). |
| Paid work first | same | Free trials pause (`FREE_TRIAL_PAUSED`, entitlement kept) once paid analyses today reach 200. An unreadable paid counter never blocks a paying customer; only a reached cap does. |
| Completed reports cost nothing | unchanged | View/export read the saved report; no reservation or provider call (existing PDF/export tests). |
| Display | `analyzer-usage.ts`, `src/utils/creditBalance.ts`, `DocumentAnalyzerTab.tsx` | Quick and Forensic free balances returned and shown separately from paid credits. |
| Copy | `PricingTab.tsx`, `CYFSAGuideTab.tsx`, `access-pricing.ts` | "1 Free Quick Document Review + 1 Free Forensic Deep Scan", one-time, 30 pages / 10 MB, audio and FCA paid. All "3 Free Quick" wording removed; tests assert it. |

No schema change is needed: every new counter is a row in the existing `free_usage` table, handled by the pending
`free_scan_reservation_functions.sql` (A, live since 16:32 UTC). This branch includes #164's `free_reconcile` collation
fix, without which expired reservations are never returned.

## Provider prices (official pages, read 2026-11-27)

| Model (code default) | Used for | Input / output per 1M tokens | Source |
|---|---|---|---|
| `claude-sonnet-5` | Quick Review | $2 / $10 (standard; the planned rise to $3/$15 was cancelled) | platform.claude.com/docs/en/about-claude/pricing |
| `claude-opus-5` | Forensic sections + verification | $5 / $25 (fast mode not used) | same |
| `gemini-2.5-flash` | OCR | $0.30 / $2.50; from 2026-12-01 routed to and billed as `gemini-3.5-flash-lite`, also $0.30 / $2.50 | ai.google.dev/gemini-api/docs/pricing |
| `gemini-3.6-flash` | Audio (paid only) | $0.75 / $3.75 to 2026-12-31, then $1.50 / $7.50 | same |

## Maximum cost of one free customer (hard ceiling)

Assumptions: every call returns its full `max_tokens`, every allowed retry happens and is billed, input = text ceiling +
the whole prompt module (19.7k chars) at 3 characters per token (conservative; English averages ~4).

| Item | Calls | Input tokens | Output tokens | Cost |
|---|---|---|---|---|
| Quick run: 4 sections x 2 section attempts x 2 HTTP tries | 16 | 16 x 31,600 = 505,600 | 4 x (3,500+5,000+3,500+3,500) = 62,000 | $1.01 + $0.62 = **$1.63** |
| Forensic run: 6 sections x 2 attempts + verification x 2 | 14 | 12 x 41,600 + 2 x 19,300 = 537,800 | 2 x 40,692 + 2 x 4,000 = 89,384 | $2.69 + $2.23 = **$4.92** |
| OCR: 2 documents x 30 pages x 2 attempts | 120 | 120 x 1,500 = 180,000 | 120 x 8,192 = 983,040 | $0.05 + $2.46 = **$2.51** |
| **Per verified email: 3 Quick runs + 3 Forensic runs + OCR** | | | | 3 x 1.63 + 3 x 4.92 + 2.51 = **$22.16** |

A customer whose two free scans both succeed first time with a 30-page scanned document: at most $1.63 + $4.92 + 2 x
30 x $0.042 = **$9.07**. Typical (20k-token document, ~2k output tokens per section, no retries, no OCR): about
**$0.30 Quick + $1.80 Forensic = $2.10**. Typical figures are estimates; the ceilings are what the code permits.

Platform ceiling per day at the default caps (every unit at its maximum): 25 x $1.63 + 10 x $4.92 + 30 x 30 x 2 x
$0.021 = **$127.65/day** of free processing. Lower `FREE_*_PLATFORM_DAILY_LIMIT` to reduce it; `0` stops free work.

## Tests

- `tests/devin/free-trial-entitlements.pg.test.ts` (real PostgreSQL 16, scratch database): 25 concurrent submissions ->
  1 entitlement; same email / Gmail aliases on other accounts get nothing; Quick and Forensic independent; release
  restores and finalize consumes; legacy 3-Quick honoured; paid rows untouched; platform cap 3 of 8 concurrent with 5
  paused and intact; paid-priority pause; 3-run lifetime attempt cap; per-IP cap. 10/10.
- Unit tests updated for the new policy: usage counters, analyzer usage, extraction/OCR, transcription (402/503, no
  provider call), pricing and guide copy, analyzer integration and queue paths.

## Owner-dependent / not done

- Turnstile site key + widget on the analyzer page: server check is ready but inactive until `TURNSTILE_SECRET_KEY`
  and a site key are configured (free Cloudflare service; configuration change needs owner approval).
- Independent Claude qualification of this branch (G-1..G-7).
