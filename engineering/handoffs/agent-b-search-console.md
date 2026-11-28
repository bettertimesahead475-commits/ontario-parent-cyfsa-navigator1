# Google Search Console: verification and sitemap submission (instructions only)

Prepared by Agent B. **Nothing here has been done.** Each step needs the owner's go-ahead; it costs nothing (Search
Console is free) and changes no application code. Do it only after the pre-rendering PR is in production, so Google's
first crawl sees the pre-rendered pages and real 404s.

## 1. Add a Domain property (covers every URL and subdomain)

1. Sign in at https://search.google.com/search-console with the Google account that should own the property (ideally a
   shared business account, not a personal one).
2. **Add property → Domain**, enter `cyfsanavigator.com` (no `https://`, no `www`).
3. Google shows a TXT record value like `google-site-verification=…`. Copy it. Leave the dialog open.

## 2. Add the TXT record in Cloudflare DNS

1. Cloudflare dashboard → the `cyfsanavigator.com` zone → **DNS → Records → Add record**.
2. Type `TXT`, Name `@`, Content: the full `google-site-verification=…` value, TTL Auto. Save.
3. Do not edit or delete any existing record (Pages, email/MX, SPF, DMARC). A new TXT record is additive and safe.
4. Check it is live: `dig +short TXT cyfsanavigator.com` should list the value (usually within minutes).
5. Back in Search Console, click **Verify**. If it fails, wait 10–15 minutes and retry.
6. Keep the TXT record permanently; removing it un-verifies the property.

## 3. Submit the sitemap

1. Search Console → the property → **Sitemaps** → enter `https://cyfsanavigator.com/sitemap.xml` → **Submit**.
2. Expected: status "Success", 17 discovered URLs (the indexable routes). `robots.txt` already points to the sitemap,
   so other search engines find it without submission.
3. Do not submit app or admin URLs; they are `noindex` by design.

## 4. First checks (week 1)

- **URL Inspection** on `/`, `/rights`, `/five-day-rule`, `/pricing`: "URL is available to Google"; in "View crawled
  page", the HTML contains the page text; "User-declared canonical" equals the URL.
- **Pages report:** app routes appear under "Excluded by 'noindex' tag" (expected). Unknown URLs appear as "Not found
  (404)" (expected, not an error).
- **Enhancements:** "Breadcrumbs" should list the 16 non-home public pages with no errors.
- Optionally request indexing for the five or six most important pages from URL Inspection (rate-limited by Google).

## 5. Optional, also free

- **Bing Webmaster Tools** (https://www.bing.com/webmasters): "Import from Google Search Console" reuses the
  verification and sitemap.
- Add the Search Console property owner as a second verified owner so access does not depend on one person.

## Not included

No analytics tags, tracking scripts, paid SEO tools, or sitemap pings. Those would need a separate owner decision (and a
CSP change for any new script origin).
