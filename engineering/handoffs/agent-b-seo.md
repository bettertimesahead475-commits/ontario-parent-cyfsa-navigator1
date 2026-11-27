# Agent B handoff: SEO indexability (reconciles `origin/seo-indexability-foundation`)

Branch `devin/1795800705-seo-indexability`, based on `engineering/integration` `1c1ac21` (includes #169, #170). Do not merge or deploy from this branch. No external submissions were made (no Search Console, sitemap pings, analytics or paid tools).

## Reconciliation

| Source commit | What it did | Outcome |
|---|---|---|
| `995f72a` route-specific metadata | `SeoMetadata.tsx`: per-route title, description, robots, canonical, OG/Twitter | **Kept the component, rewrote the copy.** Integration's later App.tsx canonical + noindex effect was folded into it so there is one source. Copy rewritten against launch/README.md rules (dropped "secure document analysis", "Find … lawyers who handle …" while the directory is paused). Added `/cas-powers-rights`, `/analysis-example`, `/privacy`, `/data-deletion`, and noindex for `/review`, `/professional-workspace`, `/case-workspace`, `/accept-invitation`, `/admin/*`, `/voice-assistant`, `/lawyers/:id`, `/cloudflare-auth-diagnostic`. |
| `9a1340d` apply per route | mounts `<SeoMetadata />` in App | **Kept**, mounted inside the existing root `div` (no fragment wrapper, no DOM/visual change). |
| `a971ca0` crawlable defaults | static title, description, robots, canonical, OG in index.html | **Kept** title, OG title/description/image, `og:site_name`, `twitter:card`; kept integration's existing description. **Dropped** the static `canonical=/`, `og:url=/` and `robots` tags: on a client-rendered SPA every route is served this same HTML, so a non-JS crawler would read every page as canonical to `/`. |
| `6c424e5`, `5105643` robots/sitemap (also on the branch) | first robots.txt / sitemap.xml | **Dropped**: integration already has fuller versions (more Disallows, `/cas-powers-rights`). Sitemap extended with `/analysis-example`, `/privacy`, `/data-deletion`. |

## Verified in a built preview

`npm run build` then `npx vite preview` (dist, SPA fallback), headless Chromium, non-localhost requests aborted, `/api` mocked (only `GET /api/access-pricing`, `POST /api/directory/search`, `GET /api/directory/profiles/abc`; no analyzer or paid calls).

- 17 indexable routes: 17 unique titles, 17 unique descriptions, 17 unique canonicals; canonical and `og:url` equal the route; exactly one robots and one canonical element per page.
- Noindex (`noindex,nofollow`): `/document-analyzer`, `/templates`, `/signup`, `/review`, `/professional-workspace`, `/case-workspace`, `/accept-invitation`, `/admin`, `/admin/payments`, `/voice-assistant`, `/lawyers/abc`, `/cloudflare-auth-diagnostic`.
- `/upgrade` → `/pricing`, unknown path → `/`, `/rights/` → canonical `/rights`.
- `/robots.txt` 200 `text/plain`, `/sitemap.xml` 200 `text/xml`; sitemap URLs = the 17 indexable routes; no indexable route is disallowed.
- Visual: full-page screenshots of `/`, `/rights`, `/pricing`, `/five-day-rule`, `/lawyers`, `/document-analyzer` from integration vs this branch differ by 0 pixels (`compare -metric AE`).
- Test: `src/components/SeoMetadata.test.tsx` (5) checks uniqueness and length (title ≤ 60, description ≤ 160), banned claims, sitemap = indexable routes, robots.txt vs noindex, every `<Route>` in App.tsx classified, and the DOM tags written.

## Remaining (not in scope; needs owner decision)

- Pages are still client-rendered; non-JS crawlers and social previews see the home defaults. Pre-rendering the 17 routes is the fix (SEO_PLAN §1).
- No structured data, no 1200×630 social card (uses `logo.png`), no `lastmod` in the sitemap.
- Unknown paths return HTTP 200 (SPA fallback) and redirect client-side to `/` (soft 404).
- Pricing body copy still says "1 Free Quick Document Review" vs server limit 3 (launch/README.md D1); metadata avoids any number.
