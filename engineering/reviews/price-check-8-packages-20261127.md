# Price check: all eight packages (2026-11-27, Agent A)

Base: PR #171 head (`devin/1795800106-etransfer-payments`). Read-only review plus copy-only fixes. No price was changed.

## Prices: no mismatch

| Package | Server `functions/api/access-pricing.ts:13-21` | `api/services/tierTypes.ts:10-18` | Pricing page fallback `src/components/PricingTab.tsx:42-51` | e-Transfer instructions | Claim amount |
|---|---:|---:|---:|---|---|
| Basic / AnalyzerBasic | 19.99 | 19.99 | 19.99 | $19.99 CAD | recorded order amount |
| Premium / AnalyzerPremium | 49.99 | 49.99 | 49.99 | $49.99 CAD | recorded order amount |
| Pro | 149 | 149 | 149 | $149 CAD | recorded order amount |
| Community5 | 2000 | 2000 | 2000 | $2,000 CAD | recorded order amount |
| Community10 | 3500 | 3500 | 3500 | $3,500 CAD | recorded order amount |
| Community25 | 7500 | 7500 | 7500 | $7,500 CAD | recorded order amount |

- `functions/api/request-access.ts:122` takes the order amount only from `TIER_PRICES`; `getInstructions` (`:51`) prints it.
- `functions/api/my-payments.ts:49` withholds instructions for an open order whose stored amount no longer matches `TIER_PRICES`.
- `functions/api/claim-purchase.ts:90` copies the approved order's stored amount onto the code; it never picks a price.
- The administrator confirms the received amount by hand before approving; there is no automatic amount comparison at approval.

## Copy mismatches fixed in this PR

| Where | Was | Enforcement | Now |
|---|---|---|---|
| `src/components/PricingTab.tsx:416,427,833`, `functions/api/access-pricing.ts:140` | 1 free Quick Review | `FREE_SCAN_LIMIT = 3` (`functions/api/_free-credit-reservation.ts:5`); owner directive keeps 3 | 3 Free Quick Document Reviews |
| `functions/api/access-pricing.ts:59-61`, `src/components/PricingTab.tsx:614,835` | 5 Forensic analyses, plus "Standard Quick Document Reviews included" | Premium is 5 analyses in total, quick and forensic together (`functions/api/_paid-credit-reservation.ts:16-17`, scope `total`) | 5 analyses in total, Forensic or Quick |
| `src/components/PricingTab.tsx:1210,1308` (checkout) | `$2000 CAD` | server instructions print `$2,000 CAD` | same format as the server |

## Listed, not changed (owner or another owner's files)

1. `src/components/CYFSAGuideTab.tsx:431,435`: "1 Free Document Review & 1 Free Evidence Extraction". The review count should be 3; the evidence-extraction allowance was not verified against server enforcement, so the sentence is left for the SEO / public-wording workstream.
2. `api/services/usage.ts:20` `FREE_ANALYSES_LIMIT = 1` and `:34-35` Premium `{ quickReviews: 5, forensicAnalyses: 5 }` (separate counters) disagree with the enforced 3 free and 5-in-total Premium. `:5` says Premium is "Exactly 3 Forensic". This is the legacy Express path, not Cloudflare; owner decision whether to align or delete.
3. `src/components/PricingTab.tsx:289`: a paid Basic customer's plan is labelled "Free Default / Basic Plan", because the client also uses `Basic` for the free default. Needs a product decision on the label.
4. `api/services/analyzerErrors.ts:315`: "Upgrade to Individual Case Access for unlimited document analysis". Pro gives unlimited Quick Reviews but 5 Forensic analyses per month.
