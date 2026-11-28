# Agent B handoff: free Quick Review wording (owner decision 2026-11-27)

> **SUPERSEDED (2026-11-27, owner final policy).** The "three free Quick Reviews" direction below is no longer in force.
> The adopted policy is one lifetime free Quick Review and one lifetime free Forensic Deep Scan per verified account,
> with OCR only in support of an authorised analysis. The wording must match `FREE_TRIAL_LIMITS` in
> `functions/api/_free-trial.ts`. Do not implement from the table below.

Owner direction: "Retain three free Quick Reviews per eligible account and reconcile all public wording with actual server enforcement."

Server enforcement (unchanged): `FREE_SCAN_LIMIT = 3` in `functions/api/_free-credit-reservation.ts`, reserved per signed-in account by `functions/api/analyze.ts`. Forensic is paid-only. Cloudflare Pages has no `/api/extract-evidence` function, so there is no free evidence extraction.

| Where | Before | After |
|---|---|---|
| Pricing, Free plan box and feature list | "1 Free Quick Document Review" | "3 Free Quick Document Reviews" |
| Pricing, comparison table "Included Analyses", Free column | "1 Quick Review" | "3 Quick Reviews" |
| CYFSA Guide banner heading | "1 Free Document Review & 1 Free Evidence Extraction, then upgrade" | "3 Free Quick Document Reviews, then upgrade" |
| CYFSA Guide banner text | "You get 1 free document review and 1 free evidence extraction" | "Each signed-in account gets 3 free Quick Document Reviews" |
| `GET /api/access-pricing` Free restrictions (Claude-owned) | `'1 Free Quick Document Review'` | `` `${FREE_SCAN_LIMIT} Free Quick Document Reviews` `` |
| `POST /api/analyze` 402 `FREE_LIMIT_REACHED` message (Claude-owned) | "You've used your free analysis." | "You've used your 3 free Quick Reviews." (from `FREE_SCAN_LIMIT`) |

No entitlement logic, response shape or status code changed; only string values. Layout, classes and styling are unchanged.

Not changed: the retired Express server (`api/services/usage.ts` `FREE_ANALYSES_LIMIT = 1`, `api/_server.ts` messages) is not deployed on Cloudflare; Claude owns `api/**`.

Tests: `src/components/freeQuickReviewCopy.test.tsx` (Guide text, `/api/access-pricing` text, limit = 3) and `src/components/PricingTab.test.tsx` (plan box and table, no "1 Free").
