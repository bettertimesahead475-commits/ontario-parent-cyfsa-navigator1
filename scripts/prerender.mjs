// Build step after `vite build`: writes crawler-readable HTML for the public routes into dist/.
//   dist/index.html, dist/<route>.html  public routes, rendered signed out (no user, case or API data)
//   dist/<app-route>.html, app-shell    empty noindex shells for signed-in, admin and dynamic routes
//   dist/404.html                       any other path; Cloudflare Pages answers it with HTTP 404
//   dist/sitemap.xml                    adds <lastmod> from git when the checkout has full history
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");

/** Files whose content a public route renders; their latest commit date is the route's <lastmod>. */
export const ROUTE_SOURCES = {
  "/": ["src/components/ParentJourney.tsx"],
  "/rights": ["src/components/ParentJourney.tsx"],
  "/cyfsa-procedure": ["src/components/ParentJourney.tsx"],
  "/five-day-rule": ["src/components/ParentJourney.tsx"],
  "/45-day-roadmap": ["src/components/ParentJourney.tsx"],
  "/cas-powers-rights": ["src/components/CASRightsLimitsTab.tsx"],
  "/charter-rights": ["src/components/CharterRightsTab.tsx"],
  "/investigation": ["src/components/InvestigationTab.tsx"],
  "/defense-strategies": ["src/components/DefenseStrategiesTab.tsx"],
  "/cyfsa-guide": ["src/components/CYFSAGuideTab.tsx"],
  "/family-court": ["src/components/FamilyCourtTab.tsx"],
  "/child-development": ["src/components/ChildDevelopmentTab.tsx"],
  "/analysis-example": ["src/components/AnalysisExample.tsx"],
  "/lawyers": ["src/components/LawyerDirectoryTab.tsx", "shared/lawyerDirectoryPolicy.ts"],
  "/pricing": ["src/components/PricingTab.tsx"],
  "/privacy": ["src/components/PrivacyNoticeTab.tsx"],
  "/data-deletion": ["src/components/DataDeletionPage.tsx"],
};

/** A route's HTML file: "/" -> index.html, "/rights" -> rights.html (Pages serves it at /rights). */
export const htmlFileFor = (route) => (route === "/" ? "index.html" : `${route.slice(1)}.html`);

// Absolute path, not a PATH lookup; without git the sitemap simply has no <lastmod>.
const GIT = ["/usr/bin/git", "/usr/local/bin/git", "/opt/homebrew/bin/git"].find((bin) => existsSync(bin));

function git(args) {
  if (!GIT) return "";
  try {
    return execFileSync(GIT, args, { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

/** YYYY-MM-DD per route, or {} when git history is missing or shallow (dates would be wrong). */
export function lastModifiedDates() {
  if (git(["rev-parse", "--is-shallow-repository"]) !== "false") return {};
  const dates = {};
  for (const [route, files] of Object.entries(ROUTE_SOURCES)) {
    const date = git(["log", "-1", "--format=%cs", "--", ...files]);
    if (/^\d{4}-\d{2}-\d{2}$/.test(date)) dates[route] = date;
  }
  return dates;
}

export function addLastmod(sitemap, siteUrl, dates) {
  return sitemap.replace(/<loc>([^<]+)<\/loc>/g, (match, loc) => {
    const date = dates[loc.slice(siteUrl.length) || "/"];
    return date ? `${match}<lastmod>${date}</lastmod>` : match;
  });
}

async function main() {
  const ssrOut = path.join(dist, ".prerender-ssr");
  const { build } = await import("vite");
  const { default: react } = await import("@vitejs/plugin-react");
  const { default: tailwindcss } = await import("@tailwindcss/vite");
  await build({
    configFile: false,
    root,
    logLevel: "warn",
    plugins: [react(), tailwindcss()],
    resolve: { alias: { "@": root } },
    build: { ssr: "src/entry-prerender.tsx", outDir: ssrOut, emptyOutDir: true, copyPublicDir: false },
  });

  try {
    const { renderRoute, renderDocument, resolveRouteMeta, PUBLIC_ROUTE_META, NOINDEX_ROUTE_META, NOT_FOUND_META } =
      await import(pathToFileURL(path.join(ssrOut, "entry-prerender.js")).href);
    const template = readFileSync(path.join(dist, "index.html"), "utf8");
    const write = (file, html) => writeFileSync(path.join(dist, file), html);

    for (const route of Object.keys(PUBLIC_ROUTE_META)) {
      if (!ROUTE_SOURCES[route]) throw new Error(`No ROUTE_SOURCES entry for ${route}`);
      write(htmlFileFor(route), renderDocument(template, resolveRouteMeta(route), await renderRoute(route), route));
    }
    for (const route of Object.keys(NOINDEX_ROUTE_META).filter((r) => !r.endsWith("/"))) {
      // No canonical: the shell also answers sub-paths (_redirects), and SeoMetadata sets the real one at runtime.
      write(htmlFileFor(route), renderDocument(template, { ...resolveRouteMeta(route), canonicalUrl: "" }));
    }
    write("app-shell.html", renderDocument(template, { ...resolveRouteMeta("/lawyers/profile"), canonicalUrl: "" }));
    write("404.html", renderDocument(template, NOT_FOUND_META));

    const sitemapFile = path.join(dist, "sitemap.xml");
    const dates = lastModifiedDates();
    writeFileSync(sitemapFile, addLastmod(readFileSync(sitemapFile, "utf8"), "https://cyfsanavigator.com", dates));
    console.log(`prerender: ${Object.keys(PUBLIC_ROUTE_META).length} public pages, lastmod on ${Object.keys(dates).length}`);
  } finally {
    rmSync(ssrOut, { recursive: true, force: true });
  }
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
