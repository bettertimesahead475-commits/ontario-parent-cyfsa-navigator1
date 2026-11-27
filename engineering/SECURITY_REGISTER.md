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
| S-07 | Med | Prompt injection via document text | Mitigated | tag neutralization + untrusted-data instruction; tested in T-14, see S-33 |
| S-08 | Low | Postgres error messages/details logged | Fixed | credit RPC logs codes only |
| S-09 | Info | `/api/status` and `/api/analyze/job/:id` and `admin/gemini-models` still accept server-side `ADMIN_SECRET` header for operator tooling | Open (decide) | not browser-stored; remove once operators use the console |
| S-10 | — | Independent review of admin API (fc8b31c): no authz bypass, no PostgREST filter injection, no XSS; 10 findings (4 medium, 6 low); re-review of fixes: 7 more (concurrency edge cases, low/medium-low) | All fixed (c82e971, fb4f4e5); each re-review test verified failing on prior code | reviewer subagent 2026-11-25; regression tests `api/cloudflare-admin-api.test.ts` › "independent review findings" |
| S-11 | Med | Payment references were 5 random characters with no unique index (collision ≈1.7% at 1,000 payments) | Fixed for new references (8 chars); admin refuses duplicates | unique index needs a migration (owner approval) |
| S-12 | Med | Tests sent requests to the real production Supabase project (fake key) | Fixed | `tests/setup/no-external-network.ts` |
| S-14 | Info | Live CSP check: "unsafe-eval" console message comes from a browser extension content script, not the site; page records 0 violations | Verified | `csp-eval-trace.mjs` 2026-11-25 |
| S-15 | Med | Prompt-injection: a document tag with a line break inside (`<
/document
>`) survived neutralization and could close the document block | Fixed a7c6b47; deployed (Pages d5f2a3c9, executor 4cd2181f) | found by `eval/analyzer-guards` |
| S-16 | High | Concurrency review: queued job older than the 15-min reservation TTL stuck forever; lost finalize reply overwrote a saved report; failed queued job could never be retried; noop release looped; re-review: paid Retry under <id>-rN never shown | Fixed ed48eac, e5875a5; deployed 7c144cf7 + executor d030585d | two independent reviews; regression tests fail on prior code |
| S-17 | Med | Reconcile releases the reservation of a still-queued job (root cause of S-16 #1); review findings 5 and 6 (own stale marker; scope none re-claim) | Prepared migration `reconcile_skip_live_analyzer_jobs.sql` (+down, index), owner approval needed | until applied, such a job is delivered uncharged |
| S-18 | Low-Med | DEVIN-SEC-01: analysis-id ownership check failed open on Storage/ledger errors (integrity of another user's legal report; needs a leaked id + outage) | Fixed: PR #137 (Devin) + 3b44db5 (Claude: ledger outage, malformed body, owner-less record still passed) | api/analysis-id-ownership.test.ts (8 fail on PR version), tests/devin; independent review |
| S-19 | Low | Direct-path race: two accounts submitting the same never-seen id concurrently both pass the ownership check before the first upsert (review of 3b44db5, finding 7) | Fixed 8606a0b + 88ac7be (create-once claim on direct and queued paths); re-reviewed: race closed, no regressions | race tests: one claimed, one refused; queued-vs-direct conflict refused and released |
| S-20 | Med | DEVIN-FIN-01: audit-trail read failure/truncation silently removed refunds from revenue; settlements shown as pending | Fixed 00b6b43 + 5993153 (raw-page completeness, breakdowns, shared references, fail-closed refund guard) | 11 API + 2 UI tests; independent review |
| S-33 | Info | T-14 adversarial tests: authz bypass (real RS256 verification), IDOR on jobs/reports/assessments/case files/sessions, upload abuse, prompt injection | No vulnerability found; 220 tests in `tests/security/` | `engineering/security/T-14-adversarial-tests.md` (Agent A) |
| S-34 | Med (integrity) | PR #171 e-Transfer: two `/api/claim-purchase` calls straddling a minute boundary (per-minute `acquireOnce`) both redeem a fresh code; the second stacks +30 days on one payment. Not in production | Open: fix needed before #171 ships (DB uniqueness per reference, or permanent claim lock) | `engineering/security/S-34-etransfer-claim-race.md`, `tests/security/etransfer-claim-race.test.ts` (Agent A) |
| S-21 | Low-Med | DEVIN-OBS-01: paid code with no bound email redeemable by any signed-in account | Fixed 846e90a + b8ca20a (ownership read before RPC; reference + verified email for legacy codes; consistent answers) | 13 tests; production holds 0 codes, no migration |
| S-22 | Med (availability) | DEVIN-OBS-02: Google JWKS fetched per request; network failure surfaced as 401; review: a stuck shared fetch could block an isolate; forged kids could exhaust the refresh budget | Fixed 0b5bcfc + b8ca20a | 11 tests with real RS256 tokens; 100 verifications → 1 fetch |
| S-23 | Med | DEVIN-P2-01/02/03: quotes matched inside words; fused citation pinpoints verified; CRITICAL chosen before quote verification | Fixed PR #138 (Devin), reviewed + timing-checked by Claude | tests/devin/*, eval/analyzer-guards |
| S-24 | Low | DEVIN-P2-04: page-evidence verifyQuote matched inside words | Fixed b5e0d13 (pending SQL mirror `navigator_quote_hits` to review with B-10) | pageSources.test.ts |
| S-25 | Info | Client analysis ids used Math.random | Fixed 847c4e0 (crypto.getRandomValues) | analyzerRetryPolicy.test.ts |
| S-26 | High | DEVIN-SEC-02 (owner P0): redacted Final Case Assessment PDF rendered the original report (title, file names, findings, source text). Introduced af87473 on the exports bundle; never deployed (production b9617a8 does not contain af87473). Also: court file numbers such as `FC-19-1234`/`C1234/19` survived the PII helper | Fixed 57523fc (toggle honoured) + ca2a905 (shared `redactForExport` before rendering; fail closed, no window opened) + 84f03c4 (fail-closed check compares with a neutralized render) + 0ad086d/4735278 (file-number masking) | finalAssessmentExport.test.ts, FinalCaseAssessment.failclosed/export tests, redaction.test.ts; saved report not mutated. Audit: Quick/Forensic PDF+TXT use `redactForExport`; Lawyer Case Brief blocked while redaction on; Professional Workspace print/JSON offers no redaction option (no promise made, owner content) |
| S-27 | Low (usefulness) | Owner finding 5: redacted FCA replaced every finding with a generic placeholder and gave no preview | Fixed 3f121fb: findings and excerpts are labelled as withheld (names cannot be reliably detected, so wording is withheld rather than partly masked); section counts and source/page references kept; on-screen contents preview before download | finalAssessmentExport.test.ts, FinalCaseAssessment.export.test.tsx; real PDF: 0 synthetic identifiers in text, PDF title redacted |
| S-13 | Info | Frontend bundle contains no Supabase URL or key; all database access is server-side with the service key | Verified | production bundle scan 2026-11-25 |
| S-28 | Med (integrity) | Owner finding 4: a Forensic second review that checked only some findings (or none) was saved and exported as completed. Present in production b9617a8 | Fixed PR #156 (`isSecondReviewComplete`; partial status in UI and PDF); Devin Review + lead review | api/forensic-verification-coverage.test.ts, api/forensic-lifecycle-replay.test.ts |
| S-29 | Med (privacy) | Owner findings 1-2: guest Statute Desk edits could be silently merged into whichever account signed in next; legacy shared chat/bookmarks deleted at sign-out or claimable by any account | Fixed PR #155 (guest data in memory only, explicit move/discard; first-account claim recorded before copy, other accounts never offered); Devin Review (4 fixed, 1 rejected as owner design) + lead review | useAccountStorage.test.tsx, legacySharedData.test.ts |
| S-30 | Low-Med | Known-name redaction built regexes from raw names (punctuation as syntax) and ASCII `\b` missed accented names (Zoë, Chloé) | Fixed PR #157 (escaped literal, Unicode boundaries); hook + patterns at 100% coverage PR #158 | src/utils/redaction.test.ts, redaction.hook.test.tsx |
| S-31 | Low (availability) | SonarCloud S8786: case-brief parser regexes could backtrack super-linearly on long separator runs | Fixed PR #157 (linear scanners; 5,000-input differential vs old parser; 50,000-char inputs) | shared/caseBriefStructure.test.ts |
| S-32 | Med (integrity) | Admin suspend/restore reported success when the fallback suspension-marker write or delete failed. Present in production b9617a8 | Fixed PR #160 (dad4814: both fail with 503 stating the real state); lead review | api/services/creditAccounting.branches.test.ts |

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
