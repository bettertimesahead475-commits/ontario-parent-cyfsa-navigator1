# SEO plan (draft)

## 1. Technical findings in the current code
| Finding | Evidence | Fix (needs a PR, then qualification) |
|---|---|---|
| The same title on every URL | `index.html` has one `<title>CYFSA Navigator</title>`; no route sets `document.title` | Set the title and meta description per route, using the table in §2 |
| Browser-only rendering | Vite SPA; `ParentJourney` content exists only after JavaScript runs | Pre-render the 14 public routes to static HTML at build time (Pages serves them directly). Google renders JavaScript, but slowly and incompletely; Bing and social previews often don't. |
| No Open Graph or Twitter tags | `grep og: index.html` finds nothing | Add `og:title`, `og:description`, `og:url`, `og:image` (a 1200×630 card built from the logo) and `twitter:card` |
| No canonical link | none in `index.html` | Add a per-route `<link rel="canonical">` on `https://cyfsanavigator.com` |
| No structured data | no `ld+json` | `Organization` and `WebSite` on the home page; `BreadcrumbList` on guides. Don't use `LegalService` (it implies legal services are provided), and don't add review or rating markup. |
| A paused page is in the sitemap | `/lawyers` is listed, but the directory is paused | Keep it in the sitemap only if the page explains the pause and gives Legal Aid Ontario contacts (it does); add `noindex` if it becomes thin |
| Public pages missing from the sitemap | `/privacy`, `/analysis-example`, `/templates`, `/document-analyzer` are not listed | Add `/privacy` and `/analysis-example` (synthetic example). Leave out signed-in pages. |
| `lastmod` | check that it changes with each release | Generate the sitemap at build time |
| Search Console | not verified | Owner verifies the domain in Google Search Console and Bing Webmaster Tools through a Cloudflare DNS TXT record (free) |

## 2. Page metadata drafts
Titles should be 60 characters or fewer and descriptions about 155 or fewer. Facts are limited to what the pages already say.

| URL | Title | Description |
|---|---|---|
| `/` | CYFSA Navigator: Ontario CAS Process Guide for Parents | Understand Ontario's child protection process, organize your documents and prepare questions for your lawyer. Legal information, not legal advice. |
| `/rights` | Parents' Rights in an Ontario CAS Case (CYFSA) | Plain-language overview of parents' rights under Ontario's Child, Youth and Family Services Act, with links to the statute. |
| `/charter-rights` | Charter Rights in Ontario Child Protection Cases | How Charter rights relate to child protection proceedings in Ontario, explained in plain language for parents. |
| `/cyfsa-procedure` | CYFSA Court Process Explained, Step by Step | The stages of an Ontario child protection case, from first contact to court, with what each step usually involves. |
| `/investigation` | CAS Investigation in Ontario: What Parents Should Know | What usually happens during a children's aid society investigation and how to prepare for meetings and interviews. |
| `/five-day-rule` | The 5-Day Rule After a Child Is Taken to a Place of Safety | What Ontario's CYFSA says about bringing a case to court within five days, and what parents can prepare. |
| `/45-day-roadmap` | First 45 Days of an Ontario CAS Case: A Roadmap | A week-by-week checklist for the first weeks of a child protection case: documents, deadlines and questions. |
| `/defense-strategies` | Preparing Your Response to CAS Allegations (Ontario) | How parents can organize facts, evidence and questions for counsel when responding to allegations. Not legal advice. |
| `/cyfsa-guide` | Complete Guide to Ontario's CYFSA for Parents | A plain-language guide to the Child, Youth and Family Services Act, 2017, for parents involved with a CAS. |
| `/family-court` | Ontario Family Court for Child Protection: What to Expect | Courtrooms, hearings, forms and terms parents meet in Ontario child protection court. |
| `/child-development` | Child Development and Child Protection Assessments | How child development is considered in Ontario child protection matters, explained for parents. |
| `/cas-powers-rights` | What a CAS Can and Cannot Do in Ontario | The legal limits on children's aid society powers under the CYFSA, and the rights parents keep. |
| `/pricing` | CYFSA Navigator Pricing: Free and Paid Plans | Free legal information and document review tools; one-time review packs and monthly case access, in CAD. |
| `/lawyers` | Find a Child Protection Lawyer in Ontario | Our directory is paused while listings are verified. For a referral now, contact Legal Aid Ontario at 1-800-668-8258. |

Before publishing, check every page's body text says what its title promises (for example, the five-day rule section reference).

## 3. Keyword themes (to validate in free Google Search Console data after launch; no paid tools)
- **Process:** "CAS Ontario process", "children's aid society investigation", "child protection court Ontario", "CYFSA".
- **Urgent questions:** "CAS took my child Ontario what now", "place of safety 5 days", "temporary care hearing".
- **Documents:** "CAS affidavit", "plan of care", "disclosure in child protection case".
- **Rights:** "parents rights CAS Ontario", "do I have to talk to CAS".
- **Help:** "Legal Aid Ontario child protection", "duty counsel family court".

## 4. Content plan (12 weeks, educational, each reviewed against the statute before publishing)
| Week | Article | Links to |
|---|---|---|
| 1 | What to do in the first 48 hours after CAS contact | `/investigation`, `/rights` |
| 2 | Reading a CAS affidavit: parts, terms and what to check | `/document-analyzer`, `/analysis-example` |
| 3 | Temporary care hearings explained | `/family-court` |
| 4 | Getting legal help: Legal Aid Ontario, duty counsel, clinics | `/lawyers` |
| 5 | Glossary: 50 terms in Ontario child protection | all guides |
| 6 | How to organize your documents before meeting a lawyer | `/case-workspace` |
| 7 | Plans of care and service agreements | `/cyfsa-procedure` |
| 8 | Access and visits during a protection case | `/family-court` |
| 9 | First Nations, Inuit and Métis children under the CYFSA (written with community review) | `/cyfsa-guide` |
| 10 | Disclosure: what you can ask for | `/defense-strategies` |
| 11 | Status review hearings | `/45-day-roadmap` |
| 12 | Questions to bring to your first lawyer meeting (printable) | `/templates` |

Rules: cite the e-Laws section for each legal statement; date each article; show a "last reviewed" line; no outcome claims.
