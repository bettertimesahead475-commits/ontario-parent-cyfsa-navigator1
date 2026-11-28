import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { build } from "esbuild";
import ts from "typescript";

const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright-core");
const [base, candidate, destination] = process.argv.slice(2);
assert(base && candidate && destination, "Usage: node scripts/bench/pdf-export-latency.mjs BASE_CHECKOUT CANDIDATE_CHECKOUT OUTPUT_DIR");
const count = Number(process.env.BENCH_RUNS || 20);
const workers = Number(process.env.BENCH_WORKERS || 2);
const profiles = (process.env.BENCH_PROFILES || "online,blocked,slow").split(",");
const reports = (process.env.BENCH_REPORTS || "quick,forensic,brief,assessment").split(",");
const sizes = Object.entries({ small: 3, medium: 12, large: 30 });
assert(Number.isInteger(count) && count > 0 && Number.isInteger(workers) && workers > 0);
assert(profiles.every((profile) => ["online", "blocked", "slow"].includes(profile)));
assert(reports.every((report) => ["quick", "forensic", "brief", "assessment"].includes(report)));
mkdirSync(destination, { recursive: true });

async function bundle(root) {
  root = resolve(root);
  const path = "src/components/DocumentAnalyzerTab.tsx";
  const source = ts.createSourceFile(path, readFileSync(resolve(root, path), "utf8"), ts.ScriptTarget.Latest, true);
  const definitions = new Map();
  function collect(node) {
    if ((ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) && node.name) {
      const name = node.name.getText(source);
      if (["escapeHtml", "printAnalyzer"].includes(name)) {
        definitions.set(name, node.getText(source));
      }
    }
    ts.forEachChild(node, collect);
  }
  collect(source);
  assert.equal(definitions.size, 2);
  const cspPrefix = "Content-Security-Policy:";
  const header = readFileSync(resolve(root, "public/_headers"), "utf8").split("\n")
    .map((line) => line.trim())
    .find((line) => line.startsWith(cspPrefix))?.slice(cspPrefix.length).trim();
  assert(header);
  const { outputFiles } = await build({
    bundle: true,
    write: false,
    stdin: {
      resolveDir: root,
      loader: "ts",
      contents: `
        import { finishPrintWindow } from "./src/utils/printWindow";
        import { isScored, renderForensicReportHtml } from "./src/utils/forensicPdfRenderer";
        import { renderLawyerCaseBriefHtml } from "./src/utils/caseBriefExport";
        import { renderFinalAssessmentHtml } from "./src/utils/finalAssessmentExport";
        import { REDACTED_COPY_NOTICE, redactForExport } from "./shared/exportRedaction";
        import { effectiveQuoteStatus, QUOTE_DISPLAY } from "./shared/quoteVerification";
        import { isSecondReviewComplete } from "./shared/reportContract";
        import { evidenceLabel } from "./src/utils/parentReportView";
        ${definitions.get("escapeHtml")}
        const generatedAt = new Date("2026-11-26T12:00:00Z");
        function fixtures(n) {
          const rows = Array.from({length: n}, (_, i) => ({
            id: "visit-" + (i+1), document: "synthetic-notes.txt", version: "v1", page: i+1,
            text: "The worker recorded a home visit in the synthetic notes, entry " + (i+1) + ".",
          }));
          const report = {
            documentTitle: "Synthetic visit record", documentType: "Worker notes",
            analysisDate: "2026-11-20", fileSummary: "Synthetic analysis for export testing only.",
            redFlags: rows.map(s => ({
              category: "Source check", severity: "NOTICE", phraseDetected: s.text,
              explanation: "The visit is recorded but the time is not stated in this synthetic record.",
              legalReference: "CYFSA s. 74(2)", verifyRequirement: "Check the original notes.",
              quoteLocation: { page: s.page },
            })),
            chronology: rows.map(s => ({date: "2026-11-20", event: s.text, locationInDocument: "p. " + s.page})),
            contradictions: [{description: "The synthetic notes provide two possible dates.", locations: ["p. 1", "p. 2"]}],
            whatToVerify: ["Ask for the original notes."], whatToAskALawyer: ["Which date is supported?"],
            lawyerCaseBrief: rows.map(s => 'ISSUE — Visit record — DOCUMENT EVIDENCE — "' + s.text +
              '" (p. ' + s.page + ') — SIGNIFICANCE — date — LIMITATION/COUNTERPOINT — time unstated — VERIFY/NEXT QUESTION — check notes'),
          };
          const assessment = {
            reportId: "synthetic", matterId: "synthetic", title: "Synthetic visit record", createdAt: "2026-11-20T15:00:00Z",
            allowance: "", sources: rows,
            sections: {
              overview: [{text: "Synthetic notes of reported visits.", sources: [rows[0].id]}],
              chronology: rows.map(s => ({text: s.text, sources: [s.id]})),
              conflicts: [{text: "The visit date is disputed.", sources: rows.slice(0, 2).map(s => s.id)}],
              gaps: [], questions: [{text: "Which date is supported?", sources: []}],
            },
          };
          return { report, assessment };
        }
        function run(kind, {report, assessment}) {
          const activeTab = "organizer", redactionEnabled = false;
          const activeSelectedFile = {id: "synthetic", analysisReport: report};
          const selectedReport = report, selectedFileId = "synthetic", organizedFiles = [],
            quickReviewSnapshots = {}, deepScanReports = {synthetic: report};
          const ${definitions.get("printAnalyzer")}
          if (kind === "quick" || kind === "forensic") {
            printAnalyzer(kind === "quick" ? "quick" : "deep");
          } else {
            const html = kind === "brief"
              ? renderLawyerCaseBriefHtml(report, {generatedAt, analyzerLabel: "Forensic Deep Scan"})
              : renderFinalAssessmentHtml(assessment, {generatedAt});
            const popup = window.open("", "_blank");
            popup.document.write(html);
            popup.document.close();
            finishPrintWindow(popup);
          }
        }
        const kind = new URLSearchParams(location.search).get("report");
        const saved = fixtures(Number(new URLSearchParams(location.search).get("size")));
        document.querySelector("button").addEventListener("click", () => {
          window.measurement = {};
          const nativeOpen = window.open;
          const started = performance.now();
          window.open = (...args) => {
            const popup = nativeOpen.apply(window, args);
            const nativePrint = popup.print;
            const snapshot = () => ({
              ms: performance.now() - started,
              readyState: popup.document.readyState,
              fontStatus: popup.document.fonts.status,
              loadedFonts: Array.from(popup.document.fonts)
                .filter(f => f.status === "loaded").map(f => f.family.replaceAll('"', '')),
            });
            popup.print = () => {
              window.measurement.call = snapshot();
              popup.addEventListener("beforeprint", () => {
                window.measurement.beforeprint = snapshot();
              }, {once: true});
              nativePrint.call(popup);
            };
            return popup;
          };
          try { run(kind, saved); } finally { window.open = nativeOpen; }
        });
      `,
    },
  });
  return { js: outputFiles[0].text, header };
}

const exportsByVersion = Object.fromEntries(await Promise.all(
  Object.entries({ before: base, after: candidate }).map(async ([key, root]) => [key, await bundle(root)]),
));
const server = createServer((req, res) => {
  const path = new URL(req.url, "http://localhost").pathname;
  const [, version, mode] = path.split("/");
  const bundle = exportsByVersion[version];
  if (!bundle) return res.writeHead(404).end();
  if (mode === "export.js") return res.writeHead(200, {"content-type": "text/javascript"}).end(bundle.js);
  res.writeHead(200, {"content-type": "text/html", "content-security-policy": bundle.header});
  res.end('<!doctype html><meta charset="utf-8"><button>Export report</button><script src="./export.js" defer></script>');
});
await new Promise((done) => server.listen(0, "127.0.0.1", done));
const origin = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch({ executablePath: process.env.CHROME_BIN || "/usr/bin/google-chrome" });
const proxies = new Map();
for (const profile of profiles.filter((profile) => profile !== "online")) {
  const proxy = createServer((req, res) => res.writeHead(403).end());
  const stats = { css: 0, font: 0 };
  proxy.on("connect", (req, client) => {
    if (req.url === "fonts.googleapis.com:443") stats.css++;
    else if (req.url === "fonts.gstatic.com:443") stats.font++;
    else return client.end("HTTP/1.1 403 Forbidden\r\n\r\n");
    client.on("error", () => client.destroy());
    const reject = () => client.end("HTTP/1.1 502 Bad Gateway\r\n\r\n");
    const timer = setTimeout(reject, profile === "slow" ? 2500 : 0);
    client.on("close", () => clearTimeout(timer));
  });
  await new Promise((done) => proxy.listen(0, "127.0.0.1", done));
  proxies.set(profile, { proxy, stats, address: `http://127.0.0.1:${proxy.address().port}` });
}

async function createBench(profile) {
  const proxy = proxies.get(profile);
  const context = await browser.newContext(proxy && { proxy: { server: proxy.address, bypass: "127.0.0.1" } });
  const errors = [];
  context.on("weberror", (e) => errors.push(e.error().message));
  const apiRequests = [];
  context.on("request", (request) => {
    if (new URL(request.url()).pathname.startsWith("/api/")) apiRequests.push(request.url());
  });
  const opener = await context.newPage();
  return { context, opener, errors, apiRequests };
}

async function run(bench, { version, profile, report, size, rows }, pdf) {
  const { opener, errors } = bench;
  const url = `${origin}/${version}/?report=${report}&size=${rows}`;
  await opener.goto(url);
  try {
    const [popup] = await Promise.all([
      opener.waitForEvent("popup"),
      opener.getByRole("button", { name: "Export report" }).click(),
    ]);
    try {
      await opener.waitForFunction(() => window.measurement?.beforeprint, null, { timeout: 5000 });
      const measurement = await opener.evaluate(() => window.measurement);
      assert.deepEqual(bench.apiRequests, []);
      if (pdf) await popup.pdf({path: pdf, printBackground: true, preferCSSPageSize: true});
      return measurement;
    } finally {
      await popup.close();
    }
  } catch (error) {
    throw new Error(`${version}/${profile}/${report}/${size}: ${errors.join("; ")}`, { cause: error });
  }
}

function comparePdfs(prefix) {
  const env = { PATH: "/usr/bin:/bin", LC_ALL: "C" };
  const files = ["before", "after"].map((version) => {
    const stem = `${prefix}-${version}`;
    const pdf = stem + ".pdf";
    const pages = Number(execFileSync("/usr/bin/pdfinfo", [pdf], {env, encoding: "utf8"}).match(/^Pages:\s+(\d+)/m)[1]);
    const text = execFileSync("/usr/bin/pdftotext", ["-layout", pdf, "-"], {env, encoding: "utf8"});
    execFileSync("/usr/bin/pdftoppm", ["-r", "80", "-png", pdf, stem], {env});
    const pngs = readdirSync(destination).filter((file) => resolve(destination, file).startsWith(resolve(stem) + "-") && file.endsWith(".png"));
    assert.equal(pngs.length, pages);
    const hashes = pngs.map((file) => createHash("sha256").update(readFileSync(resolve(destination, file))).digest("hex"));
    const pdfFonts = execFileSync("/usr/bin/pdffonts", [pdf], {env, encoding: "utf8"}).split("\n").slice(2).filter(Boolean);
    return { pages, text, hashes, pdfFonts };
  });
  const [before, after] = files;
  return {
    pages: [before.pages, after.pages],
    textIdentical: before.text === after.text,
    rasterIdentical: JSON.stringify(before.hashes) === JSON.stringify(after.hashes),
    pdfFonts: [before.pdfFonts, after.pdfFonts],
  };
}

const percentiles = (values) => {
  const sorted = [...values].sort((a, b) => a - b);
  return [0.5, 0.95, 0.99].map((q) => Number(sorted[Math.ceil(sorted.length * q) - 1].toFixed(1)));
};
const queue = profiles.flatMap((profile) => reports
  .filter((report) => profile !== "slow" || report === "quick" || report === "forensic")
  .flatMap((report) => sizes.map(([size, rows]) => ({profile, report, size, rows}))));
const results = [];
process.stderr.write(`Chrome ${browser.version()}; ${queue.length} scenarios, ${count} repeats/side, concurrency ${workers}\n`);
try {
  await Promise.all(Array.from({ length: workers }, async () => {
    while (queue.length) {
      const scenario = queue.shift();
      const { profile, report, size } = scenario;
      const prefix = resolve(destination, `${profile}-${report}-${size}`);
      const data = { before: [], after: [] };
      const benches = { before: await createBench(profile), after: await createBench(profile) };
      try {
        const cold = {};
        // Warm each independent browser context once, also recording the print-to-PDF sample.
        for (const version of ["before", "after"]) {
          cold[version] = await run(benches[version], { ...scenario, version }, `${prefix}-${version}.pdf`);
        }
        const fidelity = comparePdfs(prefix);
        for (let i = 0; i < count; i++) {
          for (const version of i % 2 ? ["after", "before"] : ["before", "after"]) {
            data[version].push(await run(benches[version], { ...scenario, version }));
          }
        }
        const summary = Object.fromEntries(Object.entries(data).map(([key, runs]) => [key, {
          callMs: percentiles(runs.map((m) => m.call.ms)),
          beforeprintMs: percentiles(runs.map((m) => m.beforeprint.ms)),
          callWhileLoading: runs.filter((m) => m.call.readyState !== "complete").length,
          beforeprintWhileLoading: runs.filter((m) => m.beforeprint.readyState !== "complete").length,
          withLoadedWebFonts: runs.filter((m) => m.beforeprint.loadedFonts.length > 0).length,
        }]));
        results.push({ ...scenario, summary, fidelity, cold, data });
        console.log(JSON.stringify({ profile, report, size, summary, coldMs: [cold.before.beforeprint.ms, cold.after.beforeprint.ms], fidelity: { ...fidelity, pdfFonts: undefined } }));
      } finally {
        await Promise.all(Object.values(benches).map((bench) => bench.context.close()));
      }
    }
  }));
  const proxyStats = Object.fromEntries(Array.from(proxies, ([profile, entry]) => [profile, entry.stats]));
  console.log("Proxy TLS connections:", JSON.stringify(proxyStats));
  writeFileSync(resolve(destination, "measurements.json"), JSON.stringify({ chrome: browser.version(), count, proxyStats, results }, null, 2));
} finally {
  await browser.close();
  server.close();
  for (const { proxy } of proxies.values()) proxy.close();
}
