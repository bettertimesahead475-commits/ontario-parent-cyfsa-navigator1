# Devin Security Findings

Independent audit by Devin (Cognition AI), branch `engineering/devin-independent-audit`, baseline `engineering/integration` @ `3ad1c8c` (contains production `be46ad7`). Synthetic fixtures and mocked fetch only; no production, database or paid-inference access.

| ID | Severity | Status | Area | Summary |
|---|---|---|---|---|
| DEVIN-SEC-01 | Low | Fixed (PR, pending Claude review) | Analyzer report ownership (IDOR) | `jobOwnerConflict` failed open on Storage errors |
| DEVIN-FIN-01 | Low | Open (recommendation) | Admin revenue reporting | Audit-log read failure silently drops refunds from revenue totals |
| DEVIN-OBS-01 | Info | Open | Access codes | Codes with no bound email are redeemable by any signed-in account |
| DEVIN-OBS-02 | Info | Open | Auth availability | Google JWKS fetched on every request, no cache |
| DEVIN-OBS-03 | Info | Known (S-05) | Rate limiting | Per-isolate in-memory limiter |

## DEVIN-SEC-01 — ownership check failed open (Low)

**Where:** `functions/api/_durable-analysis-jobs.ts` `jobOwnerConflict`, called by `functions/api/analyze.ts` for every client-supplied `X-Analysis-Id` / retry attempt id.

**Root cause:** Client-supplied analysis ids are Storage keys (`analysis_jobs/<id>.json`); the direct path writes them with `x-upsert: true`. The only guard against writing over another user's report is `jobOwnerConflict`. When the ledger read failed *and* the Storage read returned a non-404 error, timed out, or returned an unreadable body, it returned `false` ("no conflict"). The code comment justified this with "ids are random and the later write would fail in the same outage" — but ids are client-chosen (not secret once seen in a URL/log/screenshot), and a single transient 5xx/timeout can clear before the write.

**Impact:** During a partial Storage/ledger outage, an authenticated user who knows another user's analysis id could overwrite that user's stored report with their own analysis. Requires an outage window and knowledge of the victim id → Low.

**Reproduction:** `tests/devin/job-owner-conflict-fail-closed.test.ts` and `tests/devin/analyze-ownership-unavailable.test.ts` — 4 of 5 fail on baseline (unit: `expected false to be true`; endpoint: the request proceeds instead of returning `OWNERSHIP_CHECK_UNAVAILABLE`).

**Fix:** New `jobOwnership()` returns `clear | conflict | unavailable`; `jobOwnerConflict()` is now `!== 'clear'` (fails closed). Storage error or timeout → `unavailable`. In `analyze.ts`, `conflict` keeps the existing `409 ANALYSIS_ID_CONFLICT`; `unavailable` returns `503 OWNERSHIP_CHECK_UNAVAILABLE` (`retryable: true`) before any credit is reserved or anything is written. Fresh ids (Storage 404) and the caller's own ids still pass; a readable record without a `uid` keeps the prior behaviour (not a conflict).

**Test fixtures updated (Claude-owned, please review):** three existing suites relied on the fail-open path because their mocks answered the owner-check read with an error/throw: `api/cloudflare-analyzer-queue-producer.test.ts` (mock now answers the authenticated read with Supabase's real "not found" shape, 400 + inner 404), `api/cloudflare-analyzer-integration.test.ts` (one test injects a fresh-id fetcher), `api/cloudflare-deep-scan.test.ts` (mocks `jobOwnership` → `clear`). No assertions were changed.

## DEVIN-FIN-01 — revenue totals silently ignore refunds when the audit log is unreadable (Low)

**Where:** `functions/api/admin/[[path]].ts` `revenueSummary` (and `paymentsOverview`, customer lookup) call `listAuditNames(...).catch(() => [])`. Refund/settlement state lives only in the audit log, so on an audit-read failure every refunded payment is reported as un-refunded and `netAmount` is overstated, with no flag in the response. Same effect once refunds fall outside the newest 5,000 (revenue) / 2,000 (overview) audit names. `refundPayment` uses the same 5,000-name horizon for its duplicate guard (impact limited: repeated steps are idempotent and the renewal shortening is gated by `acquireOnce`).

**Recommendation (Claude-owned file, not changed):** return `settlementAvailable: false` / `auditTruncated: true` instead of swallowing, or move refund/settlement state onto the `payments` row.

## Observations
- **DEVIN-OBS-01:** `redeem_access_code_atomic` only enforces email when `access_codes.email` is set; `activate-code.ts` skips the purchase-reference check when the typed email equals the signed-in email. An unbound code (legacy / manually issued) is a bearer token. Confirm all issuance paths bind an email.
- **DEVIN-OBS-02:** `_auth-check.ts` fetches Google JWKS per request; a Google blip returns 503 for every authenticated call. Cache keys per `Cache-Control`.
- **DEVIN-OBS-03:** already tracked as S-05 / T-xx (persistent rate limiting).
