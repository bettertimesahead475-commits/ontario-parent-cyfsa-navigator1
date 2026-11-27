# Free trial entitlements: qualification of the current release candidate, 2026-11-27

Policy under test: each eligible verified account gets one free Quick Document Review and one free Forensic Deep Scan, as
separate one-time lifetime entitlements. No monthly reset. After consumption, purchased, sponsored or administrator-issued
entitlements are required. Final Case Assessment and audio transcription remain paid.

Basis: `engineering/integration` at 679b7f6 and `release/rc-20261127`. Read-only qualification; no code, migration or
deployment changed.

## 1. Current behaviour versus policy

| Requirement | Current | Result |
|---|---|---|
| One free Quick Review | Free quota is 3 lifetime Quick Reviews (`FREE_SCAN_LIMIT = 3`, `functions/api/_free-credit-reservation.ts` line 5) | FAIL: 3, not 1 |
| One free Forensic Deep Scan | Forensic free path returns `UPGRADE_REQUIRED` (`functions/api/analyze.ts` lines 317–319) | FAIL: none granted |
| Separate one-time lifetime entitlements | Single counter `analyses_used` on `free_usage` | FAIL: needs a per-kind counter (schema change) |
| Atomic enforcement | `free_reserve_scan` under advisory lock (DB) | PASS (migration pending on the operational DB, see register) |
| Duplicate claims and concurrent submissions | Same-request marker `free_res_<uid>_<hash>`, joined/consumed states | PASS for the Quick path; not yet defined for a second kind |
| Repeated account creation | Not prevented. Protection is per Firebase uid only | FAIL: owner decision required (section 4) |
| Document size and OCR page limits for free scans | Quick Review limit 75,000 characters; 20 MB upload; 30 OCR pages per request (not free-specific) | PARTIAL: no free-specific page cap |
| Restoration after genuine processing failure | `free_release_scan` on failed analysis; `free_reconcile` for abandoned reservations | PASS in design; verify per failure code |
| No charge for viewing or downloading completed reports | Not verified in this pass | OPEN |
| No repeated AI processing through exports | Not verified in this pass | OPEN |
| Remaining-entitlement indicator | `analyzer-usage.ts` returns Quick remaining only; no Forensic field | FAIL: Forensic indicator missing |
| Preservation of existing purchased credits | Paid credit RPCs are separate from the free counter | PASS by separation (not exercised) |
| Pricing, marketing, onboarding, SEO copy | `access-pricing.ts` and the RC still say "3 Free Quick Document Reviews" | FAIL: copy contradicts policy |
| Transcription and Final Case Assessment paid-only | Transcription has no gate (see financial audit F-1); Assessment is Pro-gated | FAIL for transcription; PASS for Assessment |

## 2. Maximum acquisition cost per free customer (indicative prices)

Provider prices must be confirmed on official pages (sources disagreed). Conservative assumptions used below.

| Item | Assumption | Cost |
|---|---|---|
| Free Quick Review (Sonnet-class, $2/$10 per M) | 60k input, 8k output | ≈ $0.20 |
| Free Forensic Deep Scan (Opus-class, $5/$25 per M, conservative) | 60k input, 16k output, dual pass (×2) | ≈ $1.40 |
| Free OCR (30 pages, ~$0.003/page conservative) | per-request cap, one request | ≈ $0.09 |
| Transcription | paid only | $0 |
| **Maximum per free customer** | | **≈ $1.69** |

If repeated account creation is not controlled, the cost per attacker is this figure times the number of accounts created, with
no ceiling. The per-customer figure is therefore only a bound for a genuine single customer.

## 3. Implementation gaps (to be implemented, not in this pass)

- **G-1** Per-kind lifetime counters: separate `quick` and `forensic` counters with independent limits (1 and 1). Requires a
  schema change, which needs owner authorization before any execution.
- **G-2** Forensic free path in `analyze.ts`: replace the `UPGRADE_REQUIRED` branch with a reservation against the forensic
  counter, while keeping the paid path unchanged.
- **G-3** Free page and size caps for both kinds (proposal: 10 pages, 5 MB), enforced before any provider call.
- **G-4** `analyzer-usage.ts`: add `forensicRemaining` and `quickRemaining`, both lifetime.
- **G-5** Copy updates: `access-pricing.ts`, `PricingTab`, onboarding, SEO pages and the RC. Find all occurrences of
  "3 Free" before editing.
- **G-6** Automated tests: one free Quick and one free Forensic per account; concurrent submissions; failure restoration;
  report viewing and export make no provider call; the 2nd free Forensic is refused with the paid-required code.
- **G-7** Financial projections: use section 2 per-customer bound and the number of expected free accounts (owner input).

## 4. Owner decisions required before implementation

1. **Repeated account creation.** A Firebase account with a new email is free to create. Options: require a verified phone
   number, limit free entitlements per email domain, or accept the residual risk with a per-day platform ceiling. The
   financial projection depends on this choice.
2. **Existing accounts.** Accounts that already used Quick Reviews under the old 3-review rule: keep their remaining reviews as
   a grandfather allowance, or switch to one Quick Review lifetime (already consumed for many). Purchased credits are unaffected either way.
3. **Document limits** for free scans (proposal 10 pages, 5 MB).

## 5. Coordination

G-1 and G-2 touch `functions/api/analyze.ts`, `_free-credit-reservation.ts` and `supabase/migrations_pending_approval/`, which
are active Devin files. Per the coordination rule, implementation should be assigned to Devin, not made in this audit
worktree. This document is the acceptance specification.

## 6. Qualification result

**Policy implementation: FAIL on the current release candidate** (quota is 3, no free Forensic, no Forensic indicator, copy
contradicts policy, no account-creation control). **Blocked** until the owner decides section 4 and Devin implements G-1 to G-7.
