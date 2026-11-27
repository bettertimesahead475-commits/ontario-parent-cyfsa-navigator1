import { useEffect } from "react";
import { useLocation } from "wouter";

export const SITE_URL = "https://cyfsanavigator.com";
const DEFAULT_IMAGE = `${SITE_URL}/logo.png`;

export type PageMeta = { title: string; description: string };

/**
 * Indexable public routes. Every entry must also be in public/sitemap.xml, and every claim must match what the page
 * and the shipped product already say (launch/README.md rules: legal information, not legal advice; no outcome,
 * user-count or lawyer-matching claims while the directory is paused).
 */
export const PUBLIC_ROUTE_META: Record<string, PageMeta> = {
  "/": {
    title: "CYFSA Navigator: Ontario CAS Process Guide for Parents",
    description: "Learn about Ontario's CYFSA process, organize case information, and prepare questions and documents for your next steps. An educational tool, not legal advice.",
  },
  "/rights": {
    title: "Parents' Rights in an Ontario CAS Case (CYFSA)",
    description: "Plain-language overview of a parent's rights, responsibilities and family impact in an Ontario CAS case under the CYFSA. Legal information, not legal advice.",
  },
  "/cas-powers-rights": {
    title: "What a CAS Can and Cannot Do in Ontario",
    description: "The legal limits on children's aid society powers under the CYFSA, and the rights parents keep. An issue-spotting guide, not a legal opinion.",
  },
  "/charter-rights": {
    title: "Charter Rights in Ontario Child Protection Cases",
    description: "How Charter rights relate to CAS interactions and child protection proceedings in Ontario, explained in plain language for parents.",
  },
  "/cyfsa-procedure": {
    title: "CYFSA Court Process Explained, Step by Step",
    description: "The procedure a CAS must follow in an Ontario child protection case, from protection concerns to court, and what to record at each step.",
  },
  "/investigation": {
    title: "CAS Investigation in Ontario: What Parents Should Know",
    description: "How a children's aid society investigation typically proceeds in Ontario, and how parents can prepare for meetings and interviews.",
  },
  "/five-day-rule": {
    title: "The First Five Days After a Child Is Taken by CAS",
    description: "What happens in the first five days after a child is brought to a place of safety in Ontario, and which documents to have ready for the first hearing.",
  },
  "/45-day-roadmap": {
    title: "First 45 Days of an Ontario CAS Case: A Roadmap",
    description: "A phased plan for the first 45 days of an Ontario CAS case: preserve records, audit documents and prepare a brief for your lawyer to review.",
  },
  "/defense-strategies": {
    title: "Preparing Your Response to CAS Allegations (Ontario)",
    description: "How parents can organize facts, evidence and questions for counsel when responding to CAS allegations in Ontario. Not legal advice.",
  },
  "/cyfsa-guide": {
    title: "Complete Guide to Ontario's CYFSA for Parents",
    description: "A plain-language guide to the Child, Youth and Family Services Act, 2017, for parents involved with a children's aid society.",
  },
  "/family-court": {
    title: "Ontario Child Protection Court: Stages and Hearings",
    description: "The stages, hearings and orders in an Ontario child protection court case, explained in plain language for parents.",
  },
  "/child-development": {
    title: "Child Development and Ontario Child Protection Cases",
    description: "Child development research relevant to Ontario child protection matters, explained for parents documenting their child's needs and routines.",
  },
  "/analysis-example": {
    title: "Example Document Analysis Report | CYFSA Navigator",
    description: "An example analyzer report on a CAS document, with names and file numbers replaced: evidence strength, hearsay flags and CYFSA thresholds.",
  },
  "/lawyers": {
    title: "Legal Help for Ontario CAS Cases | CYFSA Navigator",
    description: "Our lawyer directory is paused while listings are verified. For a referral now, contact Legal Aid Ontario at 1-800-668-8258.",
  },
  "/pricing": {
    title: "CYFSA Navigator Pricing: Free and Paid Plans",
    description: "Free legal information and document review tools; one-time review packs and monthly case access, in CAD.",
  },
  "/privacy": {
    title: "Privacy Policy | CYFSA Navigator",
    description: "How CYFSA Navigator collects, uses, shares and retains account, case and professional-access information, and how to contact us.",
  },
  "/data-deletion": {
    title: "Data Deletion Requests | CYFSA Navigator",
    description: "How to request deletion of your CYFSA Navigator information, and the current status of Facebook-related features.",
  },
};

/** Signed-in, administrative, diagnostic and per-profile routes: never indexed, never in the sitemap. */
export const NOINDEX_ROUTE_META: Record<string, PageMeta> = {
  "/document-analyzer": { title: "Document Analyzer | CYFSA Navigator", description: "Analyze and organize Ontario CAS case documents in your account." },
  "/templates": { title: "Forms and Case Brief Workspace | CYFSA Navigator", description: "Prepare case notes, timelines and a lawyer case brief in your account." },
  "/signup": { title: "Your Account | CYFSA Navigator", description: "Create or manage your CYFSA Navigator account." },
  "/review": { title: "Evidence Review | CYFSA Navigator", description: "Review saved case evidence in your account." },
  "/professional-workspace": { title: "Professional Workspace | CYFSA Navigator", description: "Workspace for invited professionals." },
  "/case-workspace": { title: "Case Workspace | CYFSA Navigator", description: "Organize case actions in your account." },
  "/accept-invitation": { title: "Accept Invitation | CYFSA Navigator", description: "Accept a professional access invitation." },
  "/admin": { title: "Administration | CYFSA Navigator", description: "Administrator console." },
  "/voice-assistant": { title: "Voice Assistant | CYFSA Navigator", description: "Read-aloud summaries and voice dictation." },
  "/lawyers/": { title: "Lawyer Profile | CYFSA Navigator", description: "Lawyer directory profile." },
  "/cloudflare-auth-diagnostic": { title: "Diagnostic | CYFSA Navigator", description: "Sign-in diagnostic." },
};

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
