# Financial exposure audit and repair specification, 2026-11-27

Read-only audit of `engineering/integration` at 679b7f6 (PR #168, #174 at their heads noted). No live write, no paid inference,
no secret change. Provider prices below are indicative: the search results disagreed and must be confirmed on the official pages
before any allowance is set.

## 1. Every path that can spend provider money

| Path | Route | Provider | Gate today | Units | Enforcement today | Exposure |
|---|---|---|---|---|---|---|
| Quick Document Review | `/api/analyze` (quick) | Anthropic claude-sonnet-5 | Firebase identity + reservation RPC (`free_reserve_scan` / `paid_reserve_credit`) | analyses | DB reservation, fail-closed | Controlled |
| Forensic Deep Scan | `/api/analyze` (forensic) | Anthropic claude-opus-5 (dual pass) | reservation RPC | analyses | DB reservation | Controlled; retry inside one reservation not verified |
| Final Case Assessment | `/api/final-case-assessment` | Anthropic (model per route) | Pro paid session + `forensic` credit reservation | assessments | DB reservation | Controlled (F-3 resolved) |
| OCR | `/api/extract-text` → `_document-extraction.ts` | Gemini `gemini-2.5-flash` | Firebase identity + per-isolate limit `extractText` 20/min | pages | **none** (`extract-text` states it never reserves a credit) | **Unbounded**: 20 requests/min × 30 pages × 20 MB per request, per isolate |
| Audio transcription | `/api/transcribe`, `/api/transcribe-audio` | Gemini `gemini-3.6-flash` | Firebase identity + per-isolate limit `transcribe` 10/min | audio minutes | **none** | **Unbounded**: no duration cap, no quota |
| Provider retries | `_gemini.ts`, `_analyzer-model-adapter.ts` | both | per call; no per-request retry budget verified | calls | none across requests | Multiplies any of the above |
| Duplicate submissions | all of the above | both | idempotency only for analysis job ids | calls | none for OCR/transcription | Multiplies |
| Queue reprocessing | `workers/analyzer-queue-consumer.ts` | Anthropic (analyses) | retries 5, delay 20 s, reservation reconcile | analyses | reservation TTL 15 min | Bounded per job; a job re-run after lease loss may call the provider again (needs check) |
| Access-code redemption, renewals | `redeem_access_code_atomic` | none | DB | n/a | n/a | No provider cost |

Per-isolate limits are not a financial control: Cloudflare runs many isolates, so a single account's effective rate is the
per-isolate value times the number of isolates that serve it.

## 2. Indicative unit costs (confirm before use)

| Unit | Basis | Indicative cost |
|---|---|---|
| OCR page (scanned, ~1,500 input tokens + ~800 output) | Gemini 2.5 Flash, input $0.15–0.30/M (sources disagree), output not verified | ~$0.001–0.003 per page |
| Audio minute (~32 tokens/s input = 1,920 tokens/min; ~150 output tokens/min) | Gemini 3.6 Flash audio; audio input quoted $0.50–1.00/M | ~$0.002–0.004 per minute |
| Quick Review (~30k input, 4k output) | Sonnet 5 $2/$10 per M (official docs per search) | ~$0.10 |
| Forensic (~60k input, 15k output, dual pass ×2) | Opus 5.5 $4/$20 per M (third-party; confirm Opus 5 rate) | ~$1.1 |
| Final Case Assessment (~40k input, 10k output) | Opus-class rate | ~$0.36 |

Pricing reference against packages (advertised): Basic $19.99 (3 Quick Reviews ≈ $0.30 cost); Premium $49.99 (5 Forensic
≈ $5.5 cost + Quick); Pro $149/month (5 Forensic/month ≈ $5.5 + Quick + assessments). Forensic and assessment costs are the
dominant share; OCR and transcription are small per unit but have **no ceiling**.

## 3. Findings (confirmed by reading code at the cited heads)

- **F-1 (P0) Transcription has no entitlement or quota.** `functions/api/transcribe.ts` lines 41–50: Firebase verification,
  then only `rateLimitRetryAfter('transcribe', …)`. No reservation, no duration, no entitlement. Any verified account can run
  Gemini audio calls at 10/min per isolate, indefinitely.
- **F-2 (P0) OCR has no quota.** `functions/api/extract-text.ts` line 5–6 states it never reserves a credit by design; the only
  gate is identity and the per-isolate limit (20/min). Up to 30 pages per request (`MAX_OCR_PAGES`), 20 MB per file.
- **F-3 resolved (PASS).** `functions/api/final-case-assessment.ts` lines 70–72 require a verified paid session with tier Pro
  (`INDIVIDUAL_CASE_ACCESS_REQUIRED` otherwise), and line 162 reserves one `forensic` credit via `reserveVerifiedPaidCredit`
  (refusals 402/409). Controlled by the DB reservation. Remaining check: the assessment's provider retries stay inside that one reservation.
- **F-4 (P1) Per-isolate rate limits fail open for expensive buckets.** PR #174 `RATE_LIMIT_STORE_FAILURE_MODE`: `transcribe`,
  `analyze`, `extractText`, `adminWrite` = `open`. The persistent limiter is not wired into any route, so today all limits are
  per isolate.
- **F-5 (P1) No aggregate platform spending ceiling anywhere** (no daily or monthly provider budget counter).
- **F-6 (P2) Retry and duplicate handling** for OCR/transcription has no idempotency key. A client retry after a timeout pays
  again.

## 4. Proposed allowances (for owner approval; none applied)

Free accounts (no purchase), per calendar month:
- Quick Document Review: 3 (existing, `FREE_SCAN_LIMIT`). Max cost ≈ $0.30.
- OCR: 30 pages (≈ $0.03–0.09 max). Transcription: 10 audio minutes (≈ $0.02–0.04 max).

Purchased entitlements are not reduced. Each paid entitlement receives a separate OCR and transcription budget, sized so that
the usual package use is never throttled:
- Basic / AnalyzerBasic: 300 OCR pages and 120 audio minutes per entitlement period (≈ $0.30–0.90 and $0.25–0.50 max).
- Premium / AnalyzerPremium and the monthly tiers: 1,000 OCR pages and 300 audio minutes per period.
- Cap per single request: 30 pages (existing `MAX_OCR_PAGES`), 60 minutes of audio.

Platform protection:
- Aggregate daily provider ceiling per provider (for example, a configurable USD equivalent) enforced in the same database
  transaction as the reservation. When reached, new paid processing is refused with a clear code and nothing is charged.
  The ceiling value is an owner decision.

## 5. Repair specification (for Devin to implement; do not duplicate)

Ledger (new migration, pending owner approval):
1. `usage_ledger(id, owner_uid, kind in ('ocr_page','audio_second','quick','forensic','assessment'), request_key, units, status
   in ('reserved','settled','released'), reserved_at, settled_at, cost_estimate, cost_actual, entitlement_ref)`,
   unique on `(owner_uid, kind, request_key)` for idempotency.
2. `usage_platform_day(day, provider, reserved_cost, settled_cost)` for the platform ceiling.
3. SECURITY DEFINER functions, service_role only, each taking `pg_advisory_xact_lock(hashtextextended(owner_uid,0))`:
   - `usage_reserve(owner_uid, kind, request_key, units, cost_estimate, allowance, platform_ceiling, ttl)`: returns
     `reserved | replayed | denied_allowance | denied_platform | denied_unavailable`. A repeated request_key returns the same
     reservation (no second charge).
   - `usage_settle(owner_uid, kind, request_key, units_actual, cost_actual)`: idempotent; settles to actual units (may be less
     than reserved; the difference is returned).
   - `usage_release(owner_uid, kind, request_key)`: idempotent; used on provider failure with no output delivered.
   - `usage_reconcile(owner_uid, now)`: releases reservations older than TTL (abandoned), same pattern as `free_reconcile`.
4. Route contract: reserve → call provider once per page or chunk, with the provider retry budget capped per reservation →
   settle with actual pages or seconds → on any unrecovered failure, release. Paid processing fails closed when the ledger is
   unreachable (503, nothing charged).
5. Units measured from the payload: pages from the PDF page count, seconds from the audio duration, not from the client.

Acceptance criteria:
- Concurrent reservations for one account never exceed the allowance (PostgreSQL 16, two connections, same key and different keys).
- A retried request with the same key produces one reservation and one settlement.
- A reservation left unsettled is released after TTL and its units are returned.
- Platform ceiling reached → new reservations refused; in-flight settlements still succeed.
- Fail-closed: with the database unreachable, OCR and transcription return 503 and make no provider call.
- Purchased entitlements: a test for each package shows the advertised use fits inside its allowance.

## 6. Open items before release

- Confirm that Final Case Assessment provider retries stay inside its single reservation.
- Confirm the Forensic retry budget and queue re-run behaviour (section 1).
- Confirm official provider prices; the figures in section 2 are indicative only.
- Owner decision: platform daily ceiling value, and the allowance numbers in section 4.

## 7. Gate result

**Financial protection: BLOCKED.** F-1 and F-2 are P0 unbounded-cost paths that exist on the release candidate.
