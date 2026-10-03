import { useEffect } from "react";
import { useLocation } from "wouter";

const SITE_URL = "https://cyfsanavigator.com";
const DEFAULT_IMAGE = `${SITE_URL}/logo.png`;

type PageMeta = {
  title: string;
  description: string;
  index?: boolean;
};

const META: Record<string, PageMeta> = {
  "/": {
    title: "Ontario CAS Parent Rights & CYFSA Help | CYFSA Navigator",
    description: "Plain-language Ontario CYFSA guidance, CAS timelines, parent rights, court preparation tools, and secure document analysis.",
  },
  "/rights": {
    title: "CAS Ontario Parent Rights | CYFSA Navigator",
    description: "Learn your rights when dealing with an Ontario Children's Aid Society, including consent, records, counsel, access, and court protections.",
  },
  "/charter-rights": {
    title: "Charter Rights in Ontario CAS Cases | CYFSA Navigator",
    description: "Understand how Canadian Charter rights may apply during Ontario child-protection investigations and court proceedings.",
  },
  "/cyfsa-procedure": {
    title: "Ontario CYFSA & CAS Procedure Guide | CYFSA Navigator",
    description: "Follow Ontario child-protection procedure from a CAS investigation through court orders, plans of care, access, and case review.",
  },
  "/investigation": {
    title: "CAS Investigation Ontario: What Parents Can Expect",
    description: "A plain-language guide to Ontario CAS investigations, home visits, worker assessments, timelines, records, and practical preparation.",
  },
  "/five-day-rule": {
    title: "Ontario CAS First Five Days & Court Timeline",
    description: "Understand the early court timeline after a child is brought to a place of safety under Ontario's CYFSA.",
  },
  "/45-day-roadmap": {
    title: "Ontario CAS 45-Day Parent Roadmap | CYFSA Navigator",
    description: "A step-by-step roadmap for organizing records, court dates, plans of care, access, and legal preparation during the first 45 days.",
  },
  "/defense-strategies": {
    title: "Ontario CAS Case Preparation Strategies | CYFSA Navigator",
    description: "Organize evidence, identify disputed facts, prepare questions, and discuss defensible case strategy with an Ontario family lawyer.",
  },
  "/cyfsa-guide": {
    title: "Ontario CYFSA Guide for Parents | CYFSA Navigator",
    description: "Explore Ontario's Child, Youth and Family Services Act in plain language with practical parent-focused explanations.",
  },
  "/family-court": {
    title: "Ontario Family Court & CAS Proceedings Guide",
    description: "Learn the stages, documents, orders, and preparation steps commonly involved in Ontario child-protection court proceedings.",
  },
  "/child-development": {
    title: "Child Development Information for Ontario CAS Cases",
    description: "Parent-focused child-development information for documenting routines, needs, supports, and plans of care.",
  },
  "/lawyers": {
    title: "Find Ontario Child Protection Lawyers | CYFSA Navigator",
    description: "Find legal-help resources and Ontario lawyers who handle child-protection and Children's Aid Society matters.",
  },
  "/pricing": {
    title: "CYFSA Navigator Membership & Pricing",
    description: "Compare CYFSA Navigator access options for Ontario parent-rights guidance and document-analysis tools.",
  },
  "/document-analyzer": {
    title: "Secure CYFSA Document Analyzer | CYFSA Navigator",
    description: "Analyze and organize Ontario CAS and CYFSA case documents in a secure account.",
    index: false,
  },
  "/templates": {
    title: "Private CYFSA Forms & Case Brief Workspace",
    description: "Private workspace for Ontario CYFSA case forms, timelines, notes, and case-brief preparation.",
    index: false,
  },
  "/signup": {
    title: "CYFSA Navigator Account",
    description: "Create or manage a CYFSA Navigator account.",
    index: false,
  },
};

function setMeta(selector: string, attribute: "name" | "property", key: string, content: string) {
  let element = document.head.querySelector<HTMLMetaElement>(selector);
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
    const page = META[location] ?? META["/"];
    const canonicalPath = META[location] ? location : "/";
    const canonicalUrl = new URL(canonicalPath, SITE_URL).toString();

    document.title = page.title;
    setMeta('meta[name="description"]', "name", "description", page.description);
    setMeta('meta[name="robots"]', "name", "robots", page.index === false ? "noindex, nofollow" : "index, follow");
    setMeta('meta[property="og:title"]', "property", "og:title", page.title);
    setMeta('meta[property="og:description"]', "property", "og:description", page.description);
    setMeta('meta[property="og:type"]', "property", "og:type", "website");
    setMeta('meta[property="og:url"]', "property", "og:url", canonicalUrl);
    setMeta('meta[property="og:image"]', "property", "og:image", DEFAULT_IMAGE);
    setMeta('meta[name="twitter:card"]', "name", "twitter:card", "summary");
    setMeta('meta[name="twitter:title"]', "name", "twitter:title", page.title);
    setMeta('meta[name="twitter:description"]', "name", "twitter:description", page.description);

    let canonical = document.head.querySelector<HTMLLinkElement>('link[rel="canonical"]');
    if (!canonical) {
      canonical = document.createElement("link");
      canonical.rel = "canonical";
      document.head.appendChild(canonical);
    }
    canonical.href = canonicalUrl;
  }, [location]);

  return null;
}
