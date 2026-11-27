# Marketing and SEO readiness register, 2026-11-27

Separate from the engineering release register. Preparation only. No campaign, outreach email, advertisement, paid subscription or external publication is authorized. Launch gate: analyzer, payment systems, privacy controls and financial safeguards must be qualified first (see `release-register-20261127.md`).

| Item | Status | Owner | Next action |
|---|---|---|---|
| Recover PR #173 SEO implementation | NOT TESTED. Not yet located in this pass | Devin / Claude | Locate PR #173 head; read sitemap, robots, canonicals, structured data |
| Search Console integration | BLOCKED. Needs owner login | Owner | Owner confirms property ownership; no credentials handled by Claude |
| Sitemap, robots.txt, canonicals, noindex on dashboards, documents, admin and reports | NOT TESTED | Claude | Verify on staging after PR #173 is located. Confirm private routes return `noindex` |
| Structured data and social metadata | NOT TESTED | Claude | Validate with schema checks after PR #173 review |
| Prerendering of public pages | NOT TESTED | Devin | Decide between SSR and prerender; no new paid service |
| Core Web Vitals | NOT TESTED | Claude | Measure with Playwright Lighthouse on staging, no paid tools |
| Educational content (CAS parental rights, Ontario CYFSA, affidavits, court preparation, self-represented parents) | NOT STARTED | Owner for legal review | Drafts must cite primary sources (CYFSA, Ontario Rules of Civil Procedure, Ontario Court of Justice). No guaranteed outcomes. Requires qualified legal review before publication |
| Customer acquisition materials (parents, lawyers, legal clinics, community and sponsors) | NOT STARTED | Owner | Consolidate existing materials first; no outreach without authorization |
| Offer copy (one free Quick + one free Forensic, lifetime, per verified email) | Consistent in code (PR #194 static review). Stale copy remains in `engineering/handoffs/agent-b-free-quick-review-copy.md` and `RELEASE_CANDIDATE_20261127.md` | Devin | Supersede stale documents before any copy goes live |
| Marketing scheduler and email (Cloudflare compatibility, CASL) | NOT TESTED | Devin / Claude | Confirm the transactional outbox (migration F) handles marketing consent separately; CASL consent records required |
| Privacy-conscious analytics | NOT STARTED | Claude | Design only: no uploaded document, case detail or confidential text to any analytics tool. Aggregate events only |
| 30/60/90-day plan with costs | NOT STARTED | Claude | Draft after SEO audit. Prioritise free organic channels; paid advertising recommended only after owner approval |

## Hard constraints

- No public acquisition campaign until the analyzer, payment, privacy and financial gates are qualified.
- No paid advertising, subscription or new service without explicit owner authorization.
- No legal-outcome claims, fabricated testimonials or confidential case data in any marketing channel.
- Preserve the existing visual identity.

## Owner decisions needed

1. Authorize the SEO audit of PR #173 on staging (read-only).
2. Confirm Search Console ownership, and that the owner (not Claude) completes its login.
3. Name a qualified reviewer for legal educational content.
