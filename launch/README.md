# Commercial launch preparation (draft workstream)

Status: **draft materials only.** Nothing here has been published, sent, scheduled or paid for. Each external action
listed below needs the owner's written approval first, recorded in this file's approval log.

| File | Covers |
|---|---|
| `SEO_PLAN.md` | Technical SEO gaps found in the code, page metadata drafts, content plan |
| `LAWYER_OUTREACH.md` | Lawyer and clinic partnership strategy, compliance limits, draft messages |
| `SPONSORSHIP.md` | Sponsor and grant categories to research, independence policy, sponsor pack outline |
| `MARKETING_CAMPAIGNS.md` | Campaign briefs, channel plans, draft copy, UTM scheme, budget scenarios (no spend) |
| `CUSTOMER_ACQUISITION.md` | Funnel, activation, metrics, launch checklist and gates |

## Rules for every item (from `docs/MARKETING_AGENT.md` and `CLAUDE.md`)
- Legal information and preparation tools only. No legal advice, guaranteed outcomes, invented testimonials, metrics or case results, and no fear-based copy.
- Never use real case material, real parent data or confidential documents. All examples use synthetic documents.
- Every claim about the product must match shipped behaviour. The claims register is in `CUSTOMER_ACQUISITION.md`.
- Publishing goes through the admin marketing drafts with human approval. Social accounts are not connected.
- Measurement must not record case content (`src/utils/telemetrySanitizer.ts` rules apply).

## Must fix before any campaign (found while preparing this pack)
1. **Free tier copy contradicts the server.** The pricing page says the free plan includes "1 Free Quick Document Review".
   The server allows 3 (`FREE_SCAN_LIMIT = 3` in `functions/api/_free-credit-reservation.ts`, and `/api/analyzer-usage` reports 3).
   The owner must choose the number; then the code and copy must match.
2. **No per-page titles or descriptions.** Every route uses `<title>CYFSA Navigator</title>`, and there are no Open Graph tags, canonical
   link or structured data. Pages are rendered in the browser only. See `SEO_PLAN.md` §1.
3. **No web analytics.** Nothing in `src/` or `functions/` loads an analytics script, so campaign results cannot be measured. `CUSTOMER_ACQUISITION.md` §4 proposes a cookieless option.
4. **The lawyer directory is paused** (`shared/lawyerDirectoryPolicy.ts`) but `/lawyers` is in the sitemap. Do not advertise lawyer matching until listings are verified.
5. **"Dual-Pass" wording.** The pricing page sells "5 Forensic Dual-Pass analyses". Do not repeat that claim in ads until the live acceptance test
   (`engineering/reviews/live-acceptance-plan-5usd.md`) shows the second pass completing on production.
6. **Production readiness.** Do not drive paid traffic until PR #164 is qualified, deployed and accepted live.

## Owner decisions needed
| # | Decision | Options |
|---|---|---|
| D1 | Free allowance | 1 or 3 Quick Reviews |
| D2 | Launch budget | $0 organic only / a small paid test (see campaigns) |
| D3 | Lawyer programme model | Free listing / flat-fee listing / no-fee pilot; per-referral fees are excluded (see outreach) |
| D4 | Sponsorship stance | Grants only / grants and non-legal sponsors / none |
| D5 | Analytics | Cloudflare Web Analytics (free, cookieless) / none |

## Approval log
| Date | Item | Approved by | Scope |
|---|---|---|---|
| — | — | — | — |
