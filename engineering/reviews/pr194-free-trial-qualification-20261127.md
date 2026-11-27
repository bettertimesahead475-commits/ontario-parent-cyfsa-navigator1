# PR #194 free-trial entitlements: independent qualification, 2026-11-27

Branch `devin/1795810799-free-trial-policy`, head `71f5b68`, base `release/rc-20261127`. Static review by Claude (read-only, no edits to Devin's branch, no paid calls, no migration run). Acceptance criteria: `engineering/reviews/free-trial-handoff-for-devin-20261127.md` (G-1 to G-7).

## Verdict

**Static review: PASS on the policy logic. Release verdict: BLOCKED.** The database-backed tests (`tests/devin/free-trial-entitlements.pg.test.ts`) are skipped without `CREDIT_PG_URL`, so the concurrency and exactly-once claims are NOT TESTED here. Skipped tests are not passing tests.

## Criterion results

| Criterion | Evidence (commit 71f5b68) | Result |
|---|---|---|
| G-1 separate lifetime counters, quick 1 / forensic 1 | `functions/api/_free-trial.ts` `FREE_TRIAL_LIMITS = { quick: 1, forensic: 1 }`; keys `fq:<h>` / `ff:<h>` where h = sha256 of normalised verified email | PASS (static). Keying on email hash, not uid, is what blocks re-creating an account. |
| G-1 existing allowances honoured | `LEGACY_FREE_QUICK_LIMIT = 3` applied to the legacy uid counter; `quickUsed` takes the min | PASS (static). Owner decision open: confirm grandfather treatment (3 legacy Quick Reviews kept). |
| G-1 migration additive and re-runnable | No new table. Only change to a pending file: `supabase/migrations_pending_approval/free_scan_reservation_functions.sql` (fixes `free_reconcile` prefix range, which matched no markers under en_US collation) | NOT TESTED. Must run on disposable PG16. Change is a bug fix to a pending migration, so its dependency on the original file must be re-checked. |
| G-2 forensic free path reserves instead of `UPGRADE_REQUIRED` | `analyze.ts` free branch: `kind = isForensic ? 'forensic' : 'quick'`, `reserveFreeTrial`; limit returns 402 `FREE_LIMIT_REACHED` with `kind` | PASS (static). Paid path untouched. |
| G-3 30 pages / 10 MB before provider call | `FREE_TRIAL_MAX_BYTES = 10 MB`, `FREE_TRIAL_MAX_PAGES = 30`; `FREE_TRIAL_MAX_CHARS` quick 75,000 / forensic 105,000; 413 `FREE_TRIAL_DOCUMENT_TOO_LARGE` returned before reservation | PASS (static). Page check is applied to the OCR path via `_document-extraction.ts`; page count taken from the payload, not verified here. |
| G-4 usage returns quickRemaining and forensicRemaining | `analyzer-usage.ts` branch and `readFreeTrialBalance` | PASS (static) |
| G-5 copy has no "3 Free" | `access-pricing.ts` and `PricingTab.tsx` use `FREE_TRIAL_LIMITS` and state 1 + 1 once per verified email. Tests assert no "3 Free". **Stale documents still say 3 Free:** `engineering/handoffs/agent-b-free-quick-review-copy.md` (directs the copy to "3 free"), `engineering/RELEASE_CANDIDATE_20261127.md` lines 20 and 33 | FAIL (minor, documentation). The handoff file must be marked superseded so no one implements from it. |
| G-6 tests | Unit tests present (`freeQuickReviewCopy.test.tsx`, `PricingTab.test.tsx`, `cloudflare-paid-usage-caps.test.ts`). Database tests require `CREDIT_PG_URL` | Unit: PASS when run by Devin (not re-run here). Concurrency and exactly-once: NOT TESTED. |
| Concurrent submissions, exactly one reservation | `reserveFreeTrial` joins or consumes an existing `free_res_` marker | NOT TESTED (needs PG16 with two connections) |
| Failure restores entitlement | Release path on failed run (not re-traced end to end) | NOT TESTED |
| Report view and export make no provider call | Not checked in this pass | OPEN |
| Attempt cap | `FREE_TRIAL_MAX_ATTEMPTS = 3` per entitlement, including queue redeliveries | PASS (static). |
| Account recreation | Keyed on verified email hash; uid-only protection removed | PASS (static) for same email. Different emails are still free: owner decision open (phone verification, domain rules, or residual risk). |
| Verified email required | `emailVerified` checked; unverified returns `email_unverified` | PASS (static) |
| CAPTCHA (Cloudflare Turnstile) | `captchaRequired` is true only if `TURNSTILE_SECRET_KEY` is set or `FREE_TRIAL_REQUIRE_CAPTCHA='true'`. Default is off | CONDITIONAL. Must be confirmed enabled in the Pages environment before launch. Turnstile is free; no purchase needed. |
| Per-IP and platform caps | `FREE_TRIAL_IP_DAILY_LIMIT` 6, monthly 15; platform free lanes 25 quick / 10 forensic / 30 OCR per day; paid platform 300 per day; free lanes pause at 200 paid per day | PASS (static) as design. The defaults are proposals and need owner approval. |
| Paid OCR / transcription caps | `takePaidUsageUnit`: per account and platform per day, lanes `tr` and `pocr` | PASS (static) as design. Closes financial findings F-1 and F-2 in part. Retry and idempotency handling still to verify. |
| Free OCR | `FREE_OCR_LIFETIME_LIMIT = 2` per account without a paid session | Not in the adopted decision (free OCR is "only in support of an authorised analysis"). Owner to confirm the 2-document lifetime OCR allowance. |

## Remaining defects and risks

1. **Database tests not executed.** No PostgreSQL 16 or PostgREST on this machine (verified: no psql, pg_ctl, docker or PostgreSQL install). Blocked until Devin's environment or a local install is available.
2. **Stale copy documents** (see G-5). Supersede the handoff and release-candidate text.
3. **CAPTCHA off by default.** Without `TURNSTILE_SECRET_KEY`, repeated account creation has only the email-hash rule. Verify the Pages secret exists before launch.
4. **Unverified migration edit.** The `free_reconcile` change in the pending migration has not been run on PG16.
5. **Legacy Express path.** `api/services/usage.ts` still has `FREE_ANALYSES_LIMIT = 1` and Premium 5 + 5 (see `engineering/reviews/price-check-8-packages-20261127.md`). Owner decision whether to align or remove.
6. **Prices.** Acquisition-cost report (`free-trial-acquisition-cost-20261127.md`) uses unverified provider prices.

## Gate

Do not merge or release PR #194 until: PG16 tests pass with two connections (NOT TESTED); stale copy documents are superseded; CAPTCHA is confirmed enabled; owner decides the grandfather treatment, the free OCR allowance and the account-recreation policy.

No files on Devin's branch were modified. Reviewed commits: `98204b9` to `71f5b68`.
