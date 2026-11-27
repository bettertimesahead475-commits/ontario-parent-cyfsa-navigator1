# Customer acquisition plan (draft)

## 1. Funnel
| Stage | Page or event | Target to set after 4 weeks of data |
|---|---|---|
| Discover | Guide page view (search, social, clinic link) | — |
| Engage | A second guide page or a checklist download | — |
| Activate | Free account plus a first Quick Document Review | — |
| Convert | Review pack ($19.99 or $49.99 CAD, one-time) or Case Access ($149 CAD/month) | — |
| Retain | A second document reviewed; brief exported | — |
| Refer | Clinic or lawyer pilot link | — |

No targets are invented here. Set them from the first 4 weeks of real data.

## 2. Activation improvements (product backlog; each needs its own PR)
1. Settle decision D1 (1 or 3 free reviews) and make the copy and server match.
2. Show `/analysis-example` (synthetic) before sign-up, so parents see the output first.
3. After the first review, suggest a next step: "Download the Lawyer Case Brief" (it costs no credit).
4. Show "Find legal help now" (Legal Aid Ontario) on every results page.

## 3. Channels, by expected cost
1. **Search and organic** (`SEO_PLAN.md`): free, slow to build, longest-lasting.
2. **Clinics and lawyers** (`LAWYER_OUTREACH.md`): free; the most trusted source of parents.
3. **Community** (`SPONSORSHIP.md`): sponsor-funded free seats handed out by partner clinics.
4. **Organic social** (`MARKETING_CAMPAIGNS.md` Campaign 1).
5. **Paid search test:** only after decision D2 and a passed live acceptance test.

## 4. Measurement (privacy first)
- Recommended: Cloudflare Web Analytics. It is free, uses no cookies and runs on the existing Cloudflare account, and the owner enables it in the dashboard (decision D5).
- Count events only: sign-up, first review started, review completed, PDF exported, purchase. Never record document text, file names, allegations or form fields.
  Route events through `src/utils/telemetrySanitizer.ts`.
- Weekly dashboard: visits by `utm_campaign` → sign-ups → first review → purchases. Refund and complaint counts also go on it.

## 5. Claims register (what marketing may say)
| Claim | Allowed? | Evidence |
|---|---|---|
| "Legal information, not legal advice" | Required | Product notices |
| "Quotations tagged to page numbers in your documents" | Yes | Source tags in reports and PDFs |
| "Download a Lawyer Case Brief PDF; downloads don't use credits" | Yes, after the live test confirms it | Live acceptance checks |
| "Redacted export option" | Yes | `shared/exportRedaction.ts` |
| "Dual-pass forensic review" | Not until the live test confirms it | Live acceptance run 2 |
| "Free plan includes N reviews" | After decision D1 | Pricing API and server limit |
| "Find a lawyer in our directory" | **No**, the directory is paused | `shared/lawyerDirectoryPolicy.ts` |
| User counts, success rates, testimonials | **No**, no data exists | — |

## 6. Launch checklist and gates
- [ ] [PR #164](https://github.com/bettertimesahead475-commits/ontario-parent-cyfsa-navigator1/pull/164) qualified by Claude and promoted to production by the lead engineer
- [ ] Live acceptance test passed (after owner spending approval)
- [ ] Decisions D1 to D5 recorded
- [ ] SEO technical fixes (§1 of `SEO_PLAN.md`) shipped and qualified
- [ ] Ontario lawyer opinion on the product's information-only framing, plus a privacy policy review
- [ ] Search Console verified; analytics enabled (if D5)
- [ ] Campaign 1 posts approved in the admin marketing drafts
- [ ] Outreach consent records ready (CASL)
- [ ] Owner approves the go-live date
