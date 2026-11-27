import { useEffect } from "react";
import { useLocation } from "wouter";

export const SITE_URL = "https://cyfsanavigator.com";
export const SOCIAL_IMAGE = { url: `${SITE_URL}/og-image.png`, width: 1200, height: 630, alt: "CYFSA Navigator: Ontario CAS process guide for parents" };

export type PageMeta = { title: string; description: string };

/** One route per line: `path :: title :: description`. */
function parseRouteTable(table: string): Record<string, PageMeta> {
  const routes: Record<string, PageMeta> = {};
  for (const line of table.split("\n").filter((l) => l.trim())) {
    const [path, title, description] = line.split(" :: ").map((part) => part.trim());
    routes[path] = { title, description };
  }
  return routes;
}

/**
 * Indexable public routes. Every entry must also be in public/sitemap.xml, and every claim must match what the page
 * and the shipped product already say (launch/README.md rules: legal information, not legal advice; no outcome,
 * user-count or lawyer-matching claims while the directory is paused).
 */
export const PUBLIC_ROUTE_META = parseRouteTable(`
/ :: CYFSA Navigator: Ontario CAS Process Guide for Parents :: Learn about Ontario's CYFSA process, organize case information, and prepare questions and documents for your next steps. An educational tool, not legal advice.
/rights :: Parents' Rights in an Ontario CAS Case (CYFSA) :: Plain-language overview of a parent's rights, responsibilities and family impact in an Ontario CAS case under the CYFSA. Legal information, not legal advice.
/cas-powers-rights :: What a CAS Can and Cannot Do in Ontario :: The legal limits on children's aid society powers under the CYFSA, and the rights parents keep. An issue-spotting guide, not a legal opinion.
/charter-rights :: Charter Rights in Ontario Child Protection Cases :: How Charter rights relate to CAS interactions and child protection proceedings in Ontario, explained in plain language for parents.
/cyfsa-procedure :: CYFSA Court Process Explained, Step by Step :: The procedure a CAS must follow in an Ontario child protection case, from protection concerns to court, and what to record at each step.
/investigation :: CAS Investigation in Ontario: What Parents Should Know :: How a children's aid society investigation typically proceeds in Ontario, and how parents can prepare for meetings and interviews.
/five-day-rule :: The First Five Days After a Child Is Taken by CAS :: What happens in the first five days after a child is brought to a place of safety in Ontario, and which documents to have ready for the first hearing.
/45-day-roadmap :: First 45 Days of an Ontario CAS Case: A Roadmap :: A phased plan for the first 45 days of an Ontario CAS case: preserve records, audit documents and prepare a brief for your lawyer to review.
/defense-strategies :: Preparing Your Response to CAS Allegations (Ontario) :: How parents can organize facts, evidence and questions for counsel when responding to CAS allegations in Ontario. Not legal advice.
/cyfsa-guide :: Complete Guide to Ontario's CYFSA for Parents :: A plain-language guide to the Child, Youth and Family Services Act, 2017, for parents involved with a children's aid society.
/family-court :: Ontario Child Protection Court: Stages and Hearings :: The stages, hearings and orders in an Ontario child protection court case, explained in plain language for parents.
/child-development :: Child Development and Ontario Child Protection Cases :: Child development research relevant to Ontario child protection matters, explained for parents documenting their child's needs and routines.
/analysis-example :: Example Document Analysis Report | CYFSA Navigator :: An example analyzer report on a CAS document, with names and file numbers replaced: evidence strength, hearsay flags and CYFSA thresholds.
/lawyers :: Legal Help for Ontario CAS Cases | CYFSA Navigator :: Our lawyer directory is paused while listings are verified. For a referral now, contact Legal Aid Ontario at 1-800-668-8258.
/pricing :: CYFSA Navigator Pricing: Free and Paid Plans :: Free legal information and document review tools; one-time review packs and monthly case access, in CAD.
/privacy :: Privacy Policy | CYFSA Navigator :: How CYFSA Navigator collects, uses, shares and retains account, case and professional-access information, and how to contact us.
/data-deletion :: Data Deletion Requests | CYFSA Navigator :: How to request deletion of your CYFSA Navigator information, and the current status of Facebook-related features.
`);

/** Signed-in, administrative, diagnostic and per-profile routes: never indexed, never in the sitemap. */
export const NOINDEX_ROUTE_META = parseRouteTable(`
/document-analyzer :: Document Analyzer | CYFSA Navigator :: Analyze and organize Ontario CAS case documents in your account.
/templates :: Forms and Case Brief Workspace | CYFSA Navigator :: Prepare case notes, timelines and a lawyer case brief in your account.
/signup :: Your Account | CYFSA Navigator :: Create or manage your CYFSA Navigator account.
/review :: Evidence Review | CYFSA Navigator :: Review saved case evidence in your account.
/professional-workspace :: Professional Workspace | CYFSA Navigator :: Workspace for invited professionals.
/case-workspace :: Case Workspace | CYFSA Navigator :: Organize case actions in your account.
/accept-invitation :: Accept Invitation | CYFSA Navigator :: Accept a professional access invitation.
/admin :: Administration | CYFSA Navigator :: Administrator console.
/voice-assistant :: Voice Assistant | CYFSA Navigator :: Read-aloud summaries and voice dictation.
/lawyers/ :: Lawyer Profile | CYFSA Navigator :: Lawyer directory profile.
/cloudflare-auth-diagnostic :: Diagnostic | CYFSA Navigator :: Sign-in diagnostic.
`);

export type ResolvedMeta = PageMeta & { canonicalUrl: string; index: boolean };

export function resolveRouteMeta(location: string): ResolvedMeta {
  const path = location === "/" ? "/" : (location || "/").replace(/\/+$/, "") || "/";
  // Wouter matches routes case-insensitively, so /Rights renders /rights: canonicalize to the lower-case route.
  const routeKey = path.toLowerCase();
  const publicMeta = PUBLIC_ROUTE_META[routeKey];
  if (publicMeta) return { ...publicMeta, canonicalUrl: `${SITE_URL}${routeKey}`, index: true };
  const canonicalUrl = `${SITE_URL}${path}`;
  const privateKey = Object.keys(NOINDEX_ROUTE_META).find(
    (key) => (key.endsWith("/") ? routeKey.startsWith(key) : routeKey === key || routeKey.startsWith(`${key}/`)),
  );
  if (privateKey) return { ...NOINDEX_ROUTE_META[privateKey], canonicalUrl, index: false };
  // Unknown paths redirect to "/" in App; until then, point search engines at the home page.
  return { ...PUBLIC_ROUTE_META["/"], canonicalUrl: `${SITE_URL}/`, index: false };
}

/** Served as /404.html by Cloudflare Pages for paths with no page (HTTP 404). */
export const NOT_FOUND_META: ResolvedMeta = {
  title: "Page Not Found | CYFSA Navigator",
  description: "This page does not exist. Start from the CYFSA Navigator home page.",
  canonicalUrl: "",
  index: false,
};

/** [attribute, key, content] for every route-dependent meta tag. */
export function metaTags(meta: ResolvedMeta): Array<["name" | "property", string, string]> {
  const tags: Array<["name" | "property", string, string]> = [
    ["name", "description", meta.description],
    ["name", "robots", meta.index ? "index,follow" : "noindex,nofollow"],
    ["property", "og:title", meta.title],
    ["property", "og:description", meta.description],
    ["property", "og:type", "website"],
    ["property", "og:image", SOCIAL_IMAGE.url],
    ["property", "og:image:width", String(SOCIAL_IMAGE.width)],
    ["property", "og:image:height", String(SOCIAL_IMAGE.height)],
    ["property", "og:image:alt", SOCIAL_IMAGE.alt],
    ["name", "twitter:card", "summary_large_image"],
    ["name", "twitter:title", meta.title],
    ["name", "twitter:description", meta.description],
  ];
  if (meta.canonicalUrl) tags.push(["property", "og:url", meta.canonicalUrl]);
  return tags;
}

const ORGANIZATION_ID = `${SITE_URL}/#organization`;

/**
 * schema.org data for indexable routes: Organization and WebSite on the home page, BreadcrumbList elsewhere.
 * Only facts the site itself states; no ratings, reviews, credentials or legal qualifications.
 */
export function structuredData(meta: ResolvedMeta): object[] {
  if (!meta.index) return [];
  if (meta.canonicalUrl === `${SITE_URL}/`) {
    return [
      { "@context": "https://schema.org", "@type": "Organization", "@id": ORGANIZATION_ID, name: "CYFSA Navigator", url: `${SITE_URL}/`, logo: `${SITE_URL}/logo.png` },
      { "@context": "https://schema.org", "@type": "WebSite", "@id": `${SITE_URL}/#website`, name: "CYFSA Navigator", url: `${SITE_URL}/`, inLanguage: "en-CA", publisher: { "@id": ORGANIZATION_ID } },
    ];
  }
  return [{
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: meta.title.replace(/ \| CYFSA Navigator$/, ""), item: meta.canonicalUrl },
    ],
  }];
}

/** JSON for a <script type="application/ld+json"> body; "<" is escaped so the text cannot close the element. */
export function structuredDataJson(meta: ResolvedMeta): string {
  return JSON.stringify(structuredData(meta)).replace(/</g, "\\u003c");
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** The same head tags SeoMetadata writes at runtime, as HTML for build-time pre-rendering. */
export function headHtml(meta: ResolvedMeta): string {
  const lines = [`<title>${escapeHtml(meta.title)}</title>`];
  for (const [attribute, key, content] of metaTags(meta)) lines.push(`<meta ${attribute}="${key}" content="${escapeHtml(content)}" />`);
  if (meta.canonicalUrl) lines.push(`<link rel="canonical" href="${escapeHtml(meta.canonicalUrl)}" />`);
  if (structuredData(meta).length) lines.push(`<script type="application/ld+json" id="${STRUCTURED_DATA_ID}">${structuredDataJson(meta)}</script>`);
  return lines.join("\n    ");
}

const STRUCTURED_DATA_ID = "seo-structured-data";

/** Tags in the built index.html that each route replaces (one tag per line, as written in index.html). */
const ROUTE_HEAD_TAG_PREFIXES = [
  "<title>",
  '<meta name="description"',
  '<meta name="robots"',
  '<meta name="twitter:',
  '<meta property="og:',
  '<link rel="canonical"',
  '<script type="application/ld+json"',
];
const isRouteHeadTag = (line: string) => {
  const tag = line.trim();
  return !tag.startsWith('<meta property="og:site_name"') && ROUTE_HEAD_TAG_PREFIXES.some((prefix) => tag.startsWith(prefix));
};

/**
 * The built index.html with this route's head tags and, for public routes, its pre-rendered body.
 * `data-prerendered` tells main.tsx which path the markup belongs to, so it hydrates only a matching page.
 */
export function renderDocument(template: string, meta: ResolvedMeta, body = "", prerenderedPath = ""): string {
  let html = template.split("\n").filter((line) => !isRouteHeadTag(line)).join("\n");
  html = html.replace("</head>", `    ${headHtml(meta)}\n  </head>`);
  const root = prerenderedPath ? `<div id="root" data-prerendered="${prerenderedPath}">${body}</div>` : `<div id="root"></div>`;
  return html.replace('<div id="root"></div>', root);
}

function setMeta(attribute: "name" | "property", key: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[${attribute}="${key}"]`);
  if (!element) {
    element = document.createElement("meta");
    element.setAttribute(attribute, key);
    document.head.appendChild(element);
  }
  element.content = content;
}

export default function SeoMetadata() {
  const [location] = useLocation();

  useEffect(() => {
    const meta = resolveRouteMeta(location);
    document.title = meta.title;
    for (const [attribute, key, content] of metaTags(meta)) setMeta(attribute, key, content);

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = meta.canonicalUrl;

    // A data block, not an executable script, so the CSP does not apply to it.
    let jsonLd = document.getElementById(STRUCTURED_DATA_ID);
    if (structuredData(meta).length) {
      if (!jsonLd) {
        jsonLd = document.createElement("script");
        jsonLd.id = STRUCTURED_DATA_ID;
        jsonLd.setAttribute("type", "application/ld+json");
        document.head.appendChild(jsonLd);
      }
      jsonLd.textContent = structuredDataJson(meta);
    } else {
      jsonLd?.remove();
    }
  }, [location]);

  return null;
}
