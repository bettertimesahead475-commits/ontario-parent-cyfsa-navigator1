import { escapeHtml } from "./reportSectionsHtml";
import { printDocumentStyles } from "./caseBriefExport";
import type { AssessmentReport } from "../../functions/api/final-case-assessment";

export const FINAL_ASSESSMENT_SECTIONS = [
  ["overview", "Case Overview"],
  ["chronology", "Chronology"],
  ["conflicts", "Conflicting Accounts"],
  ["gaps", "Evidence Gaps"],
  ["questions", "Questions for Counsel"],
] as const;

export const FINAL_ASSESSMENT_NOTICE =
  "Educational legal information prepared by CYFSA Navigator from an automated review of the source documents listed in this report. " +
  "It is not legal advice, not a court filing, and not certified. Findings are preliminary: check each one against the cited source page before relying on it.";

const EXTRA_STYLES = `
.src-ref { font: 600 8pt system-ui, sans-serif; color: #1e3a8a; white-space: nowrap; }
.src-ref a { color: inherit; text-decoration: none; }
.source { border: 1px solid #e2e8f0; padding: 8px 12px; margin: 0 0 10px; }
.source h3 { font-size: 10.5pt; margin: 0 0 6px; }
.source pre { white-space: pre-wrap; font: 9pt Georgia, serif; margin: 0; color: #1e293b; }
`;

const dateText = (value: string | Date) => {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? "Not recorded" : d.toLocaleString("en-CA", { dateStyle: "long", timeStyle: "short" });
};

export function renderFinalAssessmentHtml(report: AssessmentReport, options: { generatedAt?: Date } = {}): string {
  const sources = Array.isArray(report.sources) ? report.sources : [];
  const sourceIndex = new Map(sources.map((s, i) => [s.id, i + 1]));
  const sourceLabel = (id: string) => {
    const s = sources.find((x) => x.id === id);
    return s ? `${s.document}, p. ${s.page}` : "";
  };
  const title = report.title || "Untitled matter";
  const contents = [...FINAL_ASSESSMENT_SECTIONS.map(([, label]) => label), "Source Pages Reviewed"];

  const sectionHtml = FINAL_ASSESSMENT_SECTIONS.map(([key, label]) => {
    const points = Array.isArray(report.sections?.[key]) ? report.sections[key] : [];
    const body = points.length
      ? `<ol class="items">${points
          .map((p) => {
            const refs = (p.sources || [])
              .filter((id) => sourceIndex.has(id))
              .map((id) => `<span class="src-ref"><a href="#source-${sourceIndex.get(id)}">[S${sourceIndex.get(id)}: ${escapeHtml(sourceLabel(id))}]</a></span>`)
              .join(" ");
            return `<li>${escapeHtml(p.text)}${refs ? ` ${refs}` : ""}</li>`;
          })
          .join("")}</ol>`
      : `<p class="muted">No items were identified for this section.</p>`;
    return `<section class="block"><h2>${escapeHtml(label)}</h2>${body}</section>`;
  }).join("");

  const sourcesHtml = sources.length
    ? sources
        .map((s, i) => `<article class="source" id="source-${i + 1}"><h3>S${i + 1}. ${escapeHtml(s.document)} — page ${escapeHtml(String(s.page))}</h3><pre>${escapeHtml(s.text)}</pre></article>`)
        .join("")
    : `<p class="muted">No source pages are recorded for this report.</p>`;

  const identRows: [string, string][] = [
    ["Matter", title],
    ["Source pages reviewed", String(sources.length)],
    ["Assessment saved", dateText(report.createdAt)],
    ["PDF generated", dateText(options.generatedAt ?? new Date())],
  ];

  return `<!doctype html>
<html lang="en-CA">
<head>
<meta charset="utf-8" />
<title>Final Case Assessment — ${escapeHtml(title)} — CYFSA Navigator</title>
<style>${printDocumentStyles("CYFSA Navigator — Final Case Assessment")}${EXTRA_STYLES}</style>
</head>
<body>
<div class="screen-bar"><button type="button" data-print-button>Print / Save as PDF</button></div>
<section class="cover">
  <div class="brand">CYFSA Navigator</div>
  <h1>Final Case Assessment</h1>
  <p class="subtitle">${escapeHtml(title)}</p>
  <table class="ident"><tbody>
    ${identRows.map(([k, v]) => `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`).join("")}
  </tbody></table>
  <div class="notice">${escapeHtml(FINAL_ASSESSMENT_NOTICE)}</div>
</section>
<section class="block toc"><h2>Contents</h2><ol>${contents.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ol></section>
${sectionHtml}
<section class="block"><h2>Source Pages Reviewed</h2>${sourcesHtml}</section>
</body>
</html>`;
}
