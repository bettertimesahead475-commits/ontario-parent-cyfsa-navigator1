/**
 * @vitest-environment jsdom
 */
import React from "react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import SeoMetadata, { NOINDEX_ROUTE_META, PUBLIC_ROUTE_META, SITE_URL, resolveRouteMeta } from "./SeoMetadata";

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
