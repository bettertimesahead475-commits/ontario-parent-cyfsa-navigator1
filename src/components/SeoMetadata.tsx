import { useEffect } from "react";
import { useLocation } from "wouter";

export const SITE_URL = "https://cyfsanavigator.com";
const DEFAULT_IMAGE = `${SITE_URL}/logo.png`;

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
  const canonicalUrl = `${SITE_URL}${path}`;
  const publicMeta = PUBLIC_ROUTE_META[path];
  if (publicMeta) return { ...publicMeta, canonicalUrl, index: true };
  const privateKey = Object.keys(NOINDEX_ROUTE_META).find(
    (key) => (key.endsWith("/") ? path.startsWith(key) : path === key || path.startsWith(`${key}/`)),
  );
  if (privateKey) return { ...NOINDEX_ROUTE_META[privateKey], canonicalUrl, index: false };
  // Unknown paths redirect to "/" in App; until then, point search engines at the home page.
  return { ...PUBLIC_ROUTE_META["/"], canonicalUrl: `${SITE_URL}/`, index: false };
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
    setMeta("name", "description", meta.description);
    setMeta("name", "robots", meta.index ? "index,follow" : "noindex,nofollow");
    setMeta("property", "og:title", meta.title);
    setMeta("property", "og:description", meta.description);
    setMeta("property", "og:url", meta.canonicalUrl);
    setMeta("property", "og:type", "website");
    setMeta("property", "og:image", DEFAULT_IMAGE);
    setMeta("name", "twitter:card", "summary");
    setMeta("name", "twitter:title", meta.title);
    setMeta("name", "twitter:description", meta.description);

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = meta.canonicalUrl;
  }, [location]);

  return null;
}
