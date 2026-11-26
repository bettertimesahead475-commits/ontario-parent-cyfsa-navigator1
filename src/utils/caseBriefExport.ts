/**
 * Lawyer Case Brief export (print-to-PDF HTML and formatted plain text), built only from a saved analysis.
 * Nothing here calls the analyzer, so downloading a brief never spends a credit.
 */

import { escapeHtml } from "./reportSectionsHtml";
import {
  CASE_BRIEF_PART_LABELS,
  CASE_BRIEF_PART_ORDER,
  parseCaseBriefPoint,
  parseLabelledPipeItem,
} from "../../shared/caseBriefStructure";

export interface CaseBriefExportOptions {
  fileName?: string;
  analyzerLabel?: string;
  generatedAt?: Date;
}

type Loose = Record<string, any>;

const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.trim() !== "") : [];

const NOT_RECORDED = "Not recorded";

export const CASE_BRIEF_NOTICE =
  "Educational legal information prepared by CYFSA Navigator from an automated analysis of the uploaded document. " +
  "It is not legal advice, not a court filing, and not certified. Brief points are analyzer-generated summaries: " +
  "check every quotation, page reference and legal citation against the original document and the current law before relying on it.";

function identification(report: Loose, options: CaseBriefExportOptions) {
  const generated = (options.generatedAt ?? new Date()).toLocaleDateString("en-CA", { year: "numeric", month: "long", day: "numeric" });
  return {
    title: report.documentTitle || options.fileName || "Untitled document",
    fileName: options.fileName || "",
    documentType: report.documentType || NOT_RECORDED,
    analysisDate: report.analysisDate || NOT_RECORDED,
    analyzer: options.analyzerLabel || "",
    generated,
    fileNumber: report.metadata?.fileNumber || "",
  };
}

function renderList(title: string, items: string[]): string {
  if (!items.length) return "";
  return `
    <section class="block">
      <h2>${escapeHtml(title)}</h2>
      <ol class="items">
        ${items
          .map((item) => {
            const rows = parseLabelledPipeItem(item);
            if (!rows) return `<li>${escapeHtml(item.replace(/\*\*/g, ""))}</li>`;
            return `<li><dl class="rows">${rows
              .map((r) => (r.label ? `<dt>${escapeHtml(r.label)}</dt><dd>${escapeHtml(r.value)}</dd>` : `<dd>${escapeHtml(r.value)}</dd>`))
              .join("")}</dl></li>`;
          })
          .join("")}
      </ol>
    </section>`;
}

function renderContradictions(report: Loose): string {
  const list: Loose[] = Array.isArray(report.contradictions) ? report.contradictions.filter((c: Loose) => c && c.description) : [];
  if (!list.length) return "";
  return `
    <section class="block">
      <h2>Contradictions and Discrepancies</h2>
      <table>
        <thead><tr><th style="width:5%">#</th><th style="width:45%">Discrepancy</th><th style="width:25%">Where in the document</th><th>Significance</th></tr></thead>
        <tbody>
          ${list
            .map(
              (c, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(String(c.description))}</td><td>${escapeHtml(
                Array.isArray(c.locations) ? c.locations.join("; ") : String(c.locations || NOT_RECORDED)
              )}</td><td>${escapeHtml(String(c.significance || NOT_RECORDED))}</td></tr>`
            )
            .join("")}
        </tbody>
      </table>
    </section>`;
}

const STYLES = `
@page { size: Letter; margin: 0.85in 0.8in 0.9in 0.8in;
  @bottom-left { content: "CYFSA Navigator — Lawyer Case Brief"; font: 8pt Georgia, serif; color: #64748b; }
  @bottom-right { content: "Page " counter(page) " of " counter(pages); font: 8pt Georgia, serif; color: #64748b; } }
@page :first { @bottom-left { content: none; } @bottom-right { content: none; } }
* { box-sizing: border-box; }
body { font-family: Georgia, "Times New Roman", serif; color: #0f172a; font-size: 10.5pt; line-height: 1.5; margin: 0; }
.screen-bar { padding: 12px 0; } .screen-bar button { background: #1e3a8a; color: #fff; border: 0; padding: 8px 16px; border-radius: 6px; font: 600 13px system-ui, sans-serif; cursor: pointer; }
@media screen { body { max-width: 8.5in; margin: 0 auto; padding: 0 0.6in 0.6in; } }
@media print { .screen-bar { display: none; } }
.cover { min-height: 8.6in; display: flex; flex-direction: column; break-after: page; padding-top: 0.6in; }
.brand { font: 800 9pt system-ui, sans-serif; letter-spacing: 0.14em; text-transform: uppercase; color: #1e3a8a; border-bottom: 3px double #1e3a8a; padding-bottom: 8px; }
.cover h1 { font-size: 28pt; margin: 1.2in 0 6px; color: #0f172a; }
.cover .subtitle { font-size: 14pt; color: #334155; margin: 0 0 0.5in; }
.ident { border-collapse: collapse; width: 100%; font-size: 10pt; }
.ident th { text-align: left; width: 32%; color: #475569; font-weight: 600; padding: 6px 8px 6px 0; vertical-align: top; border-bottom: 1px solid #e2e8f0; }
.ident td { padding: 6px 0; border-bottom: 1px solid #e2e8f0; }
.notice { margin-top: auto; border: 1px solid #cbd5e1; background: #f8fafc; padding: 10px 12px; font-size: 8.5pt; color: #334155; }
h2 { font-size: 13pt; color: #1e3a8a; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; margin: 22px 0 10px; break-after: avoid; }
.toc ol { padding-left: 18px; margin: 0; } .toc li { margin: 2px 0; }
.point { border: 1px solid #e2e8f0; border-left: 4px solid #1e3a8a; padding: 10px 14px; margin: 0 0 12px; break-inside: avoid; }
.point h3 { font-size: 11.5pt; margin: 0 0 8px; }
.part { margin: 0 0 8px; } .part:last-child { margin-bottom: 0; }
.part-label { display: block; font: 700 7.5pt system-ui, sans-serif; letter-spacing: 0.08em; text-transform: uppercase; color: #475569; }
.part-value { display: block; margin-top: 1px; }
.part-evidence .part-value { border-left: 2px solid #cbd5e1; padding-left: 8px; color: #1e293b; }
.items { padding-left: 20px; } .items li { margin: 0 0 8px; break-inside: avoid; }
.rows { margin: 0; } .rows dt { font: 700 8pt system-ui, sans-serif; color: #475569; margin-top: 3px; } .rows dd { margin: 0; }
table { border-collapse: collapse; width: 100%; font-size: 9.5pt; } th, td { border: 1px solid #e2e8f0; padding: 5px 7px; text-align: left; vertical-align: top; }
thead th { background: #f1f5f9; } tr { break-inside: avoid; }
.muted { color: #64748b; font-style: italic; }
`;

export function renderLawyerCaseBriefHtml(report: Loose, options: CaseBriefExportOptions = {}): string {
  const id = identification(report, options);
  const points = strings(report.lawyerCaseBrief).map(parseCaseBriefPoint);
  const questions = strings(report.whatToAskALawyer);
  const verify = strings(report.whatToVerify);
  const missing = strings(report.whatIsMissing);
  const hasContradictions = Array.isArray(report.contradictions) && report.contradictions.some((c: Loose) => c && c.description);

  const sections: string[] = [];
  if (report.fileSummary) sections.push("Executive Summary");
  sections.push("Case Brief Points");
  if (hasContradictions) sections.push("Contradictions and Discrepancies");
  if (questions.length) sections.push("Questions for Counsel");
  if (verify.length) sections.push("Items to Verify");
  if (missing.length) sections.push("Missing Information and Evidentiary Limitations");

  const identRows: [string, string][] = [
    ["Document", id.title],
    ...(id.fileName && id.fileName !== id.title ? ([["File", id.fileName]] as [string, string][]) : []),
    ["Document type", id.documentType],
    ...(id.fileNumber ? ([["Court file number (as stated)", id.fileNumber]] as [string, string][]) : []),
    ...(id.analyzer ? ([["Analysis", id.analyzer]] as [string, string][]) : []),
    ["Analysis date", id.analysisDate],
    ["Brief generated", id.generated],
  ];

  const pointHtml = points.length
    ? points
        .map((p, i) => {
          const heading = p.structured && p.parts.issue ? p.parts.issue : "";
          const body = p.structured
            ? CASE_BRIEF_PART_ORDER.filter((k) => k !== "issue" && p.parts[k])
                .map(
                  (k) => `<div class="part part-${k === "documentEvidence" ? "evidence" : k}"><span class="part-label">${escapeHtml(
                    CASE_BRIEF_PART_LABELS[k]
                  )}</span><span class="part-value">${escapeHtml(p.parts[k] as string)}</span></div>`
                )
                .join("")
            : `<div class="part"><span class="part-value">${escapeHtml(p.text)}</span></div>`;
          return `<article class="point"><h3>${i + 1}. ${escapeHtml(heading ? `Issue: ${heading}` : "Brief point")}</h3>${body}</article>`;
        })
        .join("")
    : `<p class="muted">This analysis did not produce Lawyer Case Brief points.</p>`;

  return `<!doctype html>
<html lang="en-CA">
<head>
<meta charset="utf-8" />
<title>Lawyer Case Brief — ${escapeHtml(id.title)} — CYFSA Navigator</title>
<style>${STYLES}</style>
</head>
<body>
<div class="screen-bar"><button type="button" data-print-button>Print / Save as PDF</button></div>
<section class="cover">
  <div class="brand">CYFSA Navigator</div>
  <h1>Lawyer Case Brief</h1>
  <p class="subtitle">${escapeHtml(id.title)}</p>
  <table class="ident"><tbody>
    ${identRows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join("")}
  </tbody></table>
  <div class="notice">${escapeHtml(CASE_BRIEF_NOTICE)}</div>
</section>
<section class="block toc"><h2>Contents</h2><ol>${sections.map((s) => `<li>${escapeHtml(s)}</li>`).join("")}</ol></section>
${report.fileSummary ? `<section class="block"><h2>Executive Summary</h2><p>${escapeHtml(String(report.fileSummary))}</p></section>` : ""}
<section class="block"><h2>Case Brief Points</h2>${pointHtml}</section>
${renderContradictions(report)}
${renderList("Questions for Counsel", questions)}
${renderList("Items to Verify", verify)}
${renderList("Missing Information and Evidentiary Limitations", missing)}
</body>
</html>`;
}

export function formatLawyerCaseBriefText(report: Loose, options: CaseBriefExportOptions = {}): string {
  const id = identification(report, options);
  const rule = "=".repeat(72);
  const out: string[] = [
    "CYFSA NAVIGATOR — LAWYER CASE BRIEF",
    rule,
    `Document:        ${id.title}`,
    `Document type:   ${id.documentType}`,
    ...(id.fileNumber ? [`Court file no.:  ${id.fileNumber} (as stated in the document)`] : []),
    ...(id.analyzer ? [`Analysis:        ${id.analyzer}`] : []),
    `Analysis date:   ${id.analysisDate}`,
    `Brief generated: ${id.generated}`,
    "",
    CASE_BRIEF_NOTICE,
    "",
  ];
  if (report.fileSummary) out.push("EXECUTIVE SUMMARY", "-".repeat(17), String(report.fileSummary), "");
  out.push("CASE BRIEF POINTS", "-".repeat(17));
  const points = strings(report.lawyerCaseBrief).map(parseCaseBriefPoint);
  if (!points.length) out.push("This analysis did not produce Lawyer Case Brief points.");
  points.forEach((p, i) => {
    out.push("", `${i + 1}.`);
    if (!p.structured) {
      out.push(`   ${p.text}`);
      return;
    }
    for (const k of CASE_BRIEF_PART_ORDER) {
      if (p.parts[k]) out.push(`   ${CASE_BRIEF_PART_LABELS[k].toUpperCase()}`, `     ${p.parts[k]}`);
    }
  });
  const list = (title: string, items: string[]) => {
    if (!items.length) return;
    out.push("", title.toUpperCase(), "-".repeat(title.length));
    items.forEach((item, i) => {
      const rows = parseLabelledPipeItem(item);
      if (!rows) {
        out.push(`${i + 1}. ${item.replace(/\*\*/g, "")}`);
        return;
      }
      out.push(`${i + 1}.`);
      rows.forEach((r) => out.push(r.label ? `   ${r.label}: ${r.value}` : `   ${r.value}`));
    });
  };
  list("Questions for Counsel", strings(report.whatToAskALawyer));
  list("Items to Verify", strings(report.whatToVerify));
  list("Missing Information and Evidentiary Limitations", strings(report.whatIsMissing));
  return out.join("\n") + "\n";
}
