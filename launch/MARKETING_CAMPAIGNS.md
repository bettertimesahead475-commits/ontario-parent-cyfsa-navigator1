# Marketing campaigns (briefs and drafts, nothing published, $0 committed)

Publishing route: admin marketing drafts → owner approval → platform adapter (social accounts are not connected yet: `WAITING_FOR_CREDENTIALS`).

## UTM scheme
`utm_source` = platform · `utm_medium` = social | email | cpc | referral · `utm_campaign` = `launch-2027q1`, `guides-evergreen` or `clinic-pilot` · `utm_content` = creative id.
The existing tagging in `api/services/marketing/utm.ts` covers social posts; use the same values elsewhere.

## Campaign 1: "Know the process" (organic, evergreen)
- **Goal:** visits to guides that lead to a free account.
- **Channels:** Facebook and Instagram pages, LinkedIn page, search.
- **Cadence:** 3 posts a week. Each is a single fact from a guide, linked to the guide, plus the notice "Legal information, not legal advice."

Draft posts:
1. "If a children's aid society contacts you, you can ask for the worker's name, their office and the reason for contact. Write it down. Our free guide to CAS investigations: [link]"
2. "Ontario's CYFSA sets time limits for bringing a case to court after a child is taken to a place of safety. Here is what the law says, in plain language: [link]"
3. "Before your first meeting with a lawyer, put your documents in date order and list your questions. Free printable checklist: [link]"
4. "Need a lawyer now? Legal Aid Ontario: 1-800-668-8258. Our guide explains duty counsel and legal aid certificates: [link]"

## Campaign 2: "Read your documents with confidence" (product, after the live acceptance test passes)
- **Goal:** first Quick Document Review → purchase of a review pack.
- **Core message:** "Upload a document and see the allegations, timeline and quotations, each tagged to its page. Bring the brief to your lawyer."
- **Proof:** a demo video using a **synthetic** affidavit only (`/analysis-example`).
- **Claims allowed:** only those in the claims register (`CUSTOMER_ACQUISITION.md` §5).

## Campaign 3: Clinic pilot (B2B, see `LAWYER_OUTREACH.md`)

## Paid search test (optional, needs decision D2; not set up)
| Scenario | Budget | Use |
|---|---|---|
| A | $0 | Organic only; collect Search Console data for 8 weeks |
| B | $300 CAD over 30 days | Search ads on 10 to 20 process keywords → guide pages; stop if cost per free sign-up exceeds the agreed limit |
| C | $1,000 CAD over 60 days | B plus Meta reach to Ontario parents, with educational creative only |

- Ads link to educational pages, not straight to checkout.
- No targeting on sensitive traits.
- Check each platform's policies on legal-services ads before creating an account.

## Copy rules checklist (every asset)
- [ ] No promise of outcome, speed or "winning".
- [ ] No suggestion that CAS workers or courts are acting in bad faith.
- [ ] The not-legal-advice line is visible.
- [ ] Prices match `/api/access-pricing`.
- [ ] The free allowance matches decision D1.
- [ ] Images contain no real documents or children.
- [ ] Owner approval is recorded.
