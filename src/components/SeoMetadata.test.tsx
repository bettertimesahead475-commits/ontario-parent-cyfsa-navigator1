/**
 * @vitest-environment jsdom
 */
import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import SeoMetadata, {
  NOINDEX_ROUTE_META,
  NOT_FOUND_META,
  PUBLIC_ROUTE_META,
  SITE_URL,
  SOCIAL_IMAGE,
  headHtml,
  renderDocument,
  resolveRouteMeta,
  structuredData,
  structuredDataJson,
} from "./SeoMetadata";

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");
const sitemapPaths = [...read("public/sitemap.xml").matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].replace(SITE_URL, ""));
const robots = read("public/robots.txt");
const appRoutes = [...read("src/App.tsx").matchAll(/<Route path="([^"]+)"/g)].map((m) => m[1]);
const head = (selector: string, attr = "content") => document.head.querySelector(selector)?.getAttribute(attr);

afterEach(() => {
  cleanup();
  window.history.pushState({}, "", "/");
});

describe("route metadata", () => {
  const publicPaths = Object.keys(PUBLIC_ROUTE_META);

  it("gives every public route a unique title and description of search-result length", () => {
    const titles = publicPaths.map((p) => PUBLIC_ROUTE_META[p].title);
    const descriptions = publicPaths.map((p) => PUBLIC_ROUTE_META[p].description);
    expect(new Set(titles).size).toBe(titles.length);
    expect(new Set(descriptions).size).toBe(descriptions.length);
    for (const t of titles) expect(t.length, t).toBeLessThanOrEqual(60);
    for (const d of descriptions) expect(d.length, d).toBeLessThanOrEqual(160);
  });

  it("makes no claim beyond shipped behaviour (launch/README.md rules)", () => {
    const copy = Object.values({ ...PUBLIC_ROUTE_META, ...NOINDEX_ROUTE_META }).map((m) => `${m.title} ${m.description}`).join("\n");
    expect(copy).not.toMatch(/guarantee|win your case|dual[- ]pass|\d+\s+free|testimonial|trusted by|certified|secure|find (an?|ontario) .*lawyers? in our directory/i);
    expect(PUBLIC_ROUTE_META["/lawyers"].description).toMatch(/paused/);
  });

  it("keeps the sitemap equal to the indexable routes, and robots.txt off them", () => {
    expect([...sitemapPaths].sort()).toEqual([...publicPaths].sort());
    const disallowed = [...robots.matchAll(/^Disallow:\s*(\S+)/gm)].map((m) => m[1].replace(/\/$/, "") || "/");
    for (const p of publicPaths) expect(disallowed, p).not.toContain(p);
    for (const p of disallowed.filter((d) => d !== "/api")) expect(resolveRouteMeta(p).index, p).toBe(false);
    expect(robots).toContain(`Sitemap: ${SITE_URL}/sitemap.xml`);
  });

  it("classifies every route in App.tsx as indexable or noindex", () => {
    for (const route of appRoutes.filter((r) => r !== "/upgrade")) {
      const path = route.replace(":id", "example-id");
      const known = path in PUBLIC_ROUTE_META || Object.keys(NOINDEX_ROUTE_META).some((k) => path === k || path.startsWith(k.endsWith("/") ? k : `${k}/`));
      expect(known, route).toBe(true);
    }
    for (const p of ["/document-analyzer", "/templates", "/signup", "/review", "/case-workspace", "/admin/payments", "/lawyers/abc", "/accept-invitation"]) {
      expect(resolveRouteMeta(p).index, p).toBe(false);
    }
  });

  it("canonicalizes mixed-case public URLs to the lower-case route, as wouter renders them", () => {
    expect(resolveRouteMeta("/Rights/")).toEqual({ ...PUBLIC_ROUTE_META["/rights"], canonicalUrl: `${SITE_URL}/rights`, index: true });
    expect(resolveRouteMeta("/Admin/Payments").index).toBe(false);
    expect(resolveRouteMeta("/lawyers/AbC").canonicalUrl).toBe(`${SITE_URL}/lawyers/AbC`);
  });

  it("writes title, description, robots, canonical and Open Graph tags for the current route", () => {
    window.history.pushState({}, "", "/five-day-rule/");
    render(<SeoMetadata />);
    expect(document.title).toBe(PUBLIC_ROUTE_META["/five-day-rule"].title);
    expect(head('meta[name="description"]')).toBe(PUBLIC_ROUTE_META["/five-day-rule"].description);
    expect(head('meta[name="robots"]')).toBe("index,follow");
    expect(head('link[rel="canonical"]', "href")).toBe(`${SITE_URL}/five-day-rule`);
    expect(head('meta[property="og:url"]')).toBe(`${SITE_URL}/five-day-rule`);
    expect(head('meta[property="og:title"]')).toBe(PUBLIC_ROUTE_META["/five-day-rule"].title);
    cleanup();

    window.history.pushState({}, "", "/document-analyzer");
    render(<SeoMetadata />);
    expect(head('meta[name="robots"]')).toBe("noindex,nofollow");
    expect(document.head.querySelectorAll('meta[name="robots"]').length).toBe(1);
    expect(document.head.querySelectorAll('link[rel="canonical"]').length).toBe(1);
  });
});

describe("pre-rendered head and structured data", () => {
  const ld = (path: string) => structuredData(resolveRouteMeta(path)) as Array<Record<string, unknown>>;

  it("puts Organization and WebSite on the home page only, and a two-level BreadcrumbList on other public pages", () => {
    expect(ld("/").map((item) => item["@type"])).toEqual(["Organization", "WebSite"]);
    expect(ld("/rights")).toEqual([{
      "@context": "https://schema.org",
      "@type": "BreadcrumbList",
      itemListElement: [
        { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
        { "@type": "ListItem", position: 2, name: PUBLIC_ROUTE_META["/rights"].title, item: `${SITE_URL}/rights` },
      ],
    }]);
    expect(ld("/pricing")[0]).toMatchObject({ itemListElement: [{}, { name: "CYFSA Navigator Pricing: Free and Paid Plans" }] });
    for (const path of ["/document-analyzer", "/admin/payments", "/lawyers/abc", "/no-such-page"]) expect(ld(path), path).toEqual([]);
    expect(structuredData(NOT_FOUND_META)).toEqual([]);
  });

  it("states no ratings, reviews, credentials or legal qualifications", () => {
    const keys = new Set<string>();
    const types = new Set<string>();
    const walk = (value: unknown) => {
      if (!value || typeof value !== "object") return;
      if (Array.isArray(value)) return value.forEach(walk);
      for (const [key, child] of Object.entries(value)) {
        keys.add(key);
        if (key === "@type") types.add(String(child));
        walk(child);
      }
    };
    walk(Object.keys(PUBLIC_ROUTE_META).flatMap(ld));
    expect([...types].sort()).toEqual(["BreadcrumbList", "ListItem", "Organization", "WebSite"]);
    expect([...keys].sort()).toEqual(["@context", "@id", "@type", "inLanguage", "item", "itemListElement", "logo", "name", "position", "publisher", "url"]);
  });

  it("writes route head tags into the built template, replacing the defaults, and the body only for public pages", () => {
    const template = read("index.html");
    const page = renderDocument(template, resolveRouteMeta("/rights"), "<main>Rights</main>", "/rights");
    expect(page.match(/<title>/g)).toHaveLength(1);
    expect(page.match(/<meta name="description"/g)).toHaveLength(1);
    expect(page.match(/<meta property="og:image"/g)).toHaveLength(1);
    expect(page.match(/<meta name="twitter:card" content="summary_large_image"/g)).toHaveLength(1);
    expect(page).toContain(`<link rel="canonical" href="${SITE_URL}/rights" />`);
    expect(page).toContain('<meta name="robots" content="index,follow" />');
    expect(page).toContain('<meta property="og:site_name" content="CYFSA Navigator" />');
    expect(page).toContain('<div id="root" data-prerendered="/rights"><main>Rights</main></div>');
    expect(page).toContain('"@type":"BreadcrumbList"');

    const shell = renderDocument(template, resolveRouteMeta("/document-analyzer"));
    expect(shell).toContain('<div id="root"></div>');
    expect(shell).toContain('<meta name="robots" content="noindex,nofollow" />');
    expect(shell).not.toContain("application/ld+json");

    const notFound = renderDocument(template, NOT_FOUND_META);
    expect(notFound).toContain("<title>Page Not Found | CYFSA Navigator</title>");
    expect(notFound).not.toContain('rel="canonical"');
    expect(notFound).not.toContain('property="og:url"');
  });

  it("escapes head values and keeps JSON-LD from closing its script element", () => {
    const meta = { title: 'A "quoted" <b> & title', description: "</script><script>x()</script>", canonicalUrl: `${SITE_URL}/rights`, index: true };
    const html = headHtml(meta);
    expect(html).toContain("<title>A &quot;quoted&quot; &lt;b&gt; &amp; title</title>");
    expect(html).not.toContain("</script><script>");
    expect(structuredDataJson(meta)).not.toContain("<");
  });

  it("updates the JSON-LD block on client navigation and removes it on noindex routes", () => {
    window.history.pushState({}, "", "/rights");
    render(<SeoMetadata />);
    expect(JSON.parse(document.getElementById("seo-structured-data")!.textContent!)[0]["@type"]).toBe("BreadcrumbList");
    expect(head('meta[property="og:image"]')).toBe(SOCIAL_IMAGE.url);
    cleanup();
    window.history.pushState({}, "", "/review");
    render(<SeoMetadata />);
    expect(document.getElementById("seo-structured-data")).toBeNull();
  });

  it("ships a 1200 x 630 PNG social image", () => {
    const png = readFileSync(resolve(process.cwd(), "public/og-image.png"));
    expect(png.subarray(1, 4).toString()).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([SOCIAL_IMAGE.width, SOCIAL_IMAGE.height]);
  });
});

describe("build-time pre-rendering (scripts/prerender.mjs)", () => {
  const load = async () => {
    const script = resolve(process.cwd(), "scripts/prerender.mjs");
    return import(/* @vite-ignore */ script);
  };

  it("has a source-file list for every public route, and every listed file exists", async () => {
    const { ROUTE_SOURCES } = await load();
    expect(Object.keys(ROUTE_SOURCES).sort()).toEqual(Object.keys(PUBLIC_ROUTE_META).sort());
    for (const files of Object.values(ROUTE_SOURCES) as string[][]) for (const file of files) expect(() => read(file), file).not.toThrow();
  });

  it("adds <lastmod> only for routes with a known date", async () => {
    const { addLastmod } = await load();
    const xml = `<url><loc>${SITE_URL}/</loc></url><url><loc>${SITE_URL}/rights</loc></url>`;
    expect(addLastmod(xml, SITE_URL, { "/": "2026-11-20" })).toBe(
      `<url><loc>${SITE_URL}/</loc><lastmod>2026-11-20</lastmod></url><url><loc>${SITE_URL}/rights</loc></url>`,
    );
  });

  it("serves every App route from an HTML file or a _redirects rule, so the 404 page never hides a valid route", async () => {
    const { htmlFileFor } = await load();
    const rules = read("public/_redirects").split("\n").filter((l) => l.trim() && !l.startsWith("#")).map((l) => l.trim().split(/\s+/));
    const builtFiles = new Set([...Object.keys(PUBLIC_ROUTE_META), ...Object.keys(NOINDEX_ROUTE_META).filter((r) => !r.endsWith("/"))].map(htmlFileFor));
    builtFiles.add("app-shell.html");
    for (const route of appRoutes) {
      const rule = rules.find(([from]) => from === route);
      if (rule) {
        expect(rule[2] === "301" || builtFiles.has(htmlFileFor(rule[1])), route).toBe(true);
      } else {
        expect(builtFiles.has(htmlFileFor(route)), route).toBe(true);
      }
    }
    expect(rules.every(([from]) => !from.includes("*")), "no wildcard rewrites: unknown sub-paths must 404").toBe(true);
  });
});
