# Agent B handoff: SEO phase 2 (pre-rendering, structured data, social image, lastmod, HTTP 404)

Based on `engineering/integration` `679b7f6` (includes #173). Do not merge or deploy from this branch. No external
submissions, publication, paid tools or deployments were made.

## Coordination needed (Claude-owned files)

| File | Change | Why |
|---|---|---|
| `package.json` | `build`: `vite build && node scripts/prerender.mjs && esbuild …` | runs the pre-render step after the client build |
| `public/_redirects` (new) | `/upgrade → /pricing 301`, `/admin/* → /admin 200`, `/lawyers/* → /app-shell 200` | dynamic app paths still get the app; everything else unknown gets the 404 page |

The lead's session could not be messaged (HTTP 403), so please review these two files in the PR.

## What the build now writes to `dist/`

- `index.html` and `<route>.html` for the 17 public routes: the page body rendered **signed out** from the same React
  components, plus that route's title, description, robots, canonical, Open Graph/Twitter and JSON-LD.
  `src/entry-prerender.tsx` renders twice (first pass only loads lazy chunks) so the HTML has no Suspense placeholders
  and no inline scripts (the CSP forbids inline scripts; JSON-LD is a data block, not a script).
- Empty, `noindex,nofollow` shells with no canonical for the app routes (`document-analyzer`, `templates`, `signup`,
  `review`, `professional-workspace`, `case-workspace`, `accept-invitation`, `admin`, `voice-assistant`,
  `cloudflare-auth-diagnostic`) and `app-shell.html` (lawyer profiles). No user, case, document or API data is in any
  generated file: nothing is signed in at build time and `/api` is never called.
- `404.html`: noindex "Page Not Found" shell. Cloudflare Pages serves it with HTTP 404 for any path without a file or
  rule (a `404.html` also turns off Pages' SPA fallback). The app then shows its existing fallback (redirect to `/`).
- `sitemap.xml` gains `<lastmod>` = last commit date of the route's source files (`ROUTE_SOURCES` in
  `scripts/prerender.mjs`). Omitted entirely when the checkout is shallow (CI's default checkout, possibly Pages Git
  builds), because every file would show the same date.
- `src/main.tsx` hydrates only when `#root[data-prerendered]` equals the current path; otherwise it clears the root and
  renders as before (e.g. the service worker's offline `/index.html` fallback on another path).

## Structured data

Home: `Organization` (name, url, logo) and `WebSite` (name, url, `en-CA`, publisher). Other public pages: two-level
`BreadcrumbList` (Home → page). Noindex pages and 404: none. No ratings, reviews, credentials, legal qualifications,
contact details or `sameAs`; a test fails if any other property or type appears.

## Social image

`public/og-image.png`, 1200×630, 279 KB: existing logo on a brand-900 → brand-700 gradient, Inter/Plus Jakarta Sans,
"Plain-language guide to the CAS process for Ontario parents", "Legal information, not legal advice",
"cyfsanavigator.com". `og:image` width/height/alt set; Twitter card is now `summary_large_image`.

## Verified (local `wrangler pages dev dist`, Chromium, outside requests blocked, `/api` mocked 404)

- **Status codes:** 17 public routes 200; app routes 200 (shells); `/admin/payments`, `/lawyers/abc123` 200 via
  rewrites; `/upgrade` 301 → `/pricing`; `/rights/` 308 → `/rights`; `/nope`, `/rights/extra` **404**.
- **JavaScript disabled:** every public route has its body text (163 to 24,600 characters in `<main>`), its own
  canonical, `index,follow` and its JSON-LD; app shells and 404 have an empty `#root` and `noindex,nofollow`.
- **With JavaScript:** no hydration errors, no CSP violations, no page errors on the 17 routes (desktop and mobile).
- **Visual:** full-page screenshots vs integration, 17 routes × desktop 1280 and mobile 390: 32 of 34 identical; two
  differ by 41 and 53 pixels inside the 42×42 header logo (image resampling), nothing else.
- **Lighthouse 12, mobile, single local run** (noisy; production CDN numbers will differ):

| Page | Perf before → after | LCP before → after | CLS before → after | SEO |
|---|---|---|---|---|
| `/` | 71 → 85 | 5.9 s → 3.4 s | 0.026 → 0.026 | 100 → 100 |
| `/rights` | 94 → 84 | 2.6 s → 3.5 s | 0 → 0 | 92 → 92 |
| `/pricing` | 61 → 76 | 4.5 s → 4.8 s | 0.464 → 0 | 100 → 100 |

  `/rights` SEO 92 is the existing "link-text" audit (generic link text), unchanged.

## Known behaviour changes

- Mixed-case URLs (`/Rights`) now return 404 at the edge; Pages file lookup is case-sensitive. Before, the SPA served
  them. No internal link uses mixed case.
- `/upgrade` is a server 301 instead of a client redirect.

## Not done here

- Pricing and CYFSA Guide copy still say one free review; the server gives 3 per signed-in account. Needs owner sign-off.
- Search Console instructions and article drafts are in a separate PR.
