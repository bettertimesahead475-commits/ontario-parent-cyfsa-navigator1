# Free trial implementation: handoff to Devin (G-1 to G-7), 2026-11-27

Owner: Devin implements. Claude qualifies independently. Source of requirements: `engineering/reviews/free-trial-policy-qualification-20261127.md`
at commit `e6da09d`. Management decisions adopted: see section 1. No migration is applied, no deployment, no paid inference, and no
secret is changed by this handoff.

## 1. Decisions adopted (from the owner's brief)

- One lifetime free Quick Document Review and one lifetime free Forensic Deep Scan per verified account, as separate atomic counters.
- No monthly replenishment. Previously granted free allowances are honoured. Purchased credits are preserved.
- Verified email and CAPTCHA at sign-up or first free analysis. Persistent account-creation abuse detection. No mandatory phone verification
  initially. No blanket email-domain restrictions.
- Free document limit: 30 pages and 10 MB per scan.
- Audio transcription and Final Case Assessment are paid-only. OCR is allowed only in support of an authorised free or paid analysis.

## 2. File ownership and coordination

Devin owns every file below. Claude does not edit them.

| Area | Files | Gap |
|---|---|---|
| Free counters and reservation | `functions/api/_free-credit-reservation.ts`, `api/services/freeScanReservation.ts`, `api/services/freeUsageStore.ts`, `supabase/migrations_pending_approval/` (new) | G-1, G-2 |
| Analysis gate | `functions/api/analyze.ts` (Forensic free branch lines ~317–323) | G-2 |
| Usage endpoint | `functions/api/analyzer-usage.ts` | G-4 |
| Transcription gate | `functions/api/transcribe.ts`, `functions/api/transcribe-audio.ts` | paid-only (financial F-1) |
| OCR gate | `functions/api/extract-text.ts`, `functions/api/_document-extraction.ts` | page and size caps (G-3), support-only rule |
| Pricing copy | `functions/api/access-pricing.ts`, `src/components/PricingTab.tsx` and every "3 Free" occurrence (`git grep -n "3 Free"`) | G-5 |
| Tests | `api/**`, `tests/**`, `functions/api/**` test files | G-6 |

Devin must rebase on `engineering/integration` before starting, because the financial audit and release candidate touch the same files.

## 3. Acceptance criteria

**Counters (G-1).** Two lifetime counters per verified uid, `quick` and `forensic`, each with limit 1 for new accounts. A
pre-existing account keeps its `analyses_used` as the quick counter; its forensic counter starts at 0. The migration is
additive (new columns or table), never changes or deletes an existing row, and is re-runnable.

**Gate (G-2).** A forensic request from an account whose forensic counter is at its limit and that has no paid forensic credit returns
the paid-required code (not `UPGRADE_REQUIRED` reached by accident). A paid forensic request is unchanged.

**Limits (G-3).** For a free scan: at most 30 pages and 10 MB, checked before any provider call. Over-limit returns a
clear code with nothing reserved or charged.

**Usage (G-4).** `analyzer-usage` returns `quickRemaining` and `forensicRemaining` (lifetime), plus the paid balances, unchanged.

**Copy (G-5).** Every pricing page, marketing page, onboarding text and SEO description states the server-side policy. No "3 Free".

**Tests (G-6).**
- One free Quick and one free Forensic per account; a second attempt of each is refused.
- Two concurrent submissions of the same kind under one account: exactly one reservation.
- A failed analysis releases its reservation and restores the entitlement; a successful one settles it.
- Viewing or exporting a completed report makes no provider call (assert zero calls to the provider mock).
- Previously granted free allowances are honoured; purchased credits are not touched.
- Budget refusal: with the platform ceiling reached, new free and paid analyses are refused before any provider call;
  in-flight settlements still succeed; paid customers are admitted ahead of free ones when the budget is short.
- Fail-closed: with the database unreachable, new free analyses return 503 and make no provider call.

**Migration (G-1).** Forward and rollback files, each tested on a disposable PostgreSQL 16 with two connections for the
concurrency cases. No execution against the operational database.

## 4. Financial controls (required before provider calls)

Per-account: the reservation for an analysis reserves its full worst-case cost (section 5) against the account budget. Settlement
returns the unused part.

Platform: a daily ceiling per provider counted in the same transaction as the reservation. The ceiling value is an owner decision.
Priority rule: when the platform budget is constrained, paid reservations are admitted before free ones.

## 5. Maximum acquisition cost per free customer (recalculated)

Source of structure: analyzer code at `engineering/integration`. Prices are **not yet verified against the official pages**
(the search results disagreed; WebFetch is no longer available to this audit). The figures below use the conservative prices
stated and must be re-run after verification.

Structure taken from the code:
- Quick Review: 4 evidence sections; per-section max output 3,500–5,000 tokens (`analyzerSections.ts`, `fast`); sections run
  concurrently.
- Forensic: 6 sections with `full` max output 4,500–8,192 tokens, plus one Opus verification pass.
- Retry policy: `SECTION_ATTEMPTS = 2`, `VERIFICATION_ATTEMPTS = 2`, `MAX_TOTAL_ATTEMPTS = 6` (`shared/analyzerRetryPolicy.ts`), so at
  most 6 provider calls per analysis.
- Thinking headroom: +8,000 max tokens on models that cannot disable thinking (`ALWAYS_ON_THINKING_HEADROOM_TOKENS`). Billed on
  generated tokens.

Worst-case per free customer (both scans, all calls capped):

| Item | Calls | Input tokens (cap) | Output tokens (cap) | Price assumed (per M, conservative) | Cost |
|---|---|---|---|---|---|
| Quick Review (Sonnet-class) | ≤ 6 | 6 × 20k = 120k | 6 × 5k = 30k | $2 input / $10 output | ≈ $0.24 + $0.30 = **$0.54** |
| Forensic Deep Scan (Opus-class) | ≤ 6 | 6 × 40k = 240k | 6 × 16.2k = 97k (8k headroom + largest section) | $5 input / $25 output | ≈ $1.20 + $2.43 = **$3.63** |
| OCR, 30 pages, one scan (Gemini Flash) | 30 + retries (≤ 2 per page) | 30 × 2 × 1.5k = 90k | 30 × 2 × 2k = 120k | $0.30 input / $2.50 output | ≈ $0.03 + $0.30 = **$0.33** (output price not verified) |
| Transcription | — | — | — | — | $0 (paid-only) |
| **Maximum per free customer** | | | | | **≈ $4.50** |

Earlier estimate in `free-trial-policy-qualification-20261127.md` ($1.69) is **superseded**: it omitted the sections, the retry
budget and the thinking headroom. Price verification is still outstanding. If the Opus or Sonnet rate is higher than assumed,
the maximum scales linearly.

## 6. Qualification plan (Claude, after Devin's branch exists)

1. Re-run section 5 with verified official prices.
2. Read the diff against sections 3 and 4; confirm each acceptance criterion with a test that Devin wrote and one that Claude wrote
   independently (not reused).
3. Run the new migration on a disposable PostgreSQL 16 (two connections): forward, rollback, re-run, concurrent reservation.
4. Verify that copy changes match the server policy (grep for every free-allowance statement).
5. Report PASS/FAIL per criterion in the register.

## 7. Owner decisions still open

- Platform daily ceiling per provider (USD).
- CAPTCHA provider and whether it costs money (any paid service needs authorization).
- Grandfather treatment of accounts that already used more than one Quick Review (the adopted decision honours previously granted
  allowances; confirm that this means the existing counter is kept as is).
