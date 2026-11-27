import { escapeHtml } from "./reportSectionsHtml";
import { printDocumentStyles } from "./caseBriefExport";
import { REDACTED_COPY_NOTICE, redactForExport } from "../../shared/exportRedaction";
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

export const FINAL_ASSESSMENT_REDACTED_NOTICE =
  REDACTED_COPY_NOTICE + " The matter title and source file names are replaced with neutral labels; page numbers are kept.";

export const REDACTED_MATTER_TITLE = "Redacted matter";

export interface FinalAssessmentExportOptions {
  generatedAt?: Date;
  /** Mirrors the user's export redaction setting (useRedaction). */
  redact?: boolean;
}

/**
 * Redacted copy built with the shared export redaction (every free-text string removed), so the FCA follows the same
 * rule as the Quick Review and Forensic exports. Only source ids, page numbers and the save time survive. The input is not modified.
 */
export function redactFinalAssessment(report: AssessmentReport): AssessmentReport {
  const sources = Array.isArray(report.sources) ? report.sources : [];
  const sections = {} as AssessmentReport["sections"];
  for (const [key] of FINAL_ASSESSMENT_SECTIONS) {
    const points = Array.isArray(report.sections?.[key]) ? report.sections[key] : [];
    sections[key] = points.map((p) => ({ ...redactForExport(p), sources: Array.isArray(p.sources) ? [...p.sources] : [] }));
  }
  return {
    ...redactForExport(report),
    title: REDACTED_MATTER_TITLE,
    createdAt: report.createdAt,
    sources: sources.map((s, i) => ({ ...redactForExport(s), id: s.id, page: s.page, document: `Source document ${i + 1}` })),
    sections,
  };
}

/** Fails closed: throws if any title, file name, finding or source text of the original report survives in the redacted HTML. */
export function assertFinalAssessmentRedacted(html: string, original: AssessmentReport): void {
  const sources = Array.isArray(original.sources) ? original.sources : [];
  const points = FINAL_ASSESSMENT_SECTIONS.flatMap(([key]) => (Array.isArray(original.sections?.[key]) ? original.sections[key] : []));
  const sensitive = [original.title, ...sources.flatMap((s) => [s.document, s.text]), ...points.map((p) => p.text)];
  for (const value of sensitive) {
    const text = typeof value === "string" ? value.trim() : "";
    if (text.length >= 6 && (html.includes(text) || html.includes(escapeHtml(text)))) {
      throw new Error("REDACTION_INCOMPLETE");
    }
  }
}

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

export function renderFinalAssessmentHtml(input: AssessmentReport, options: FinalAssessmentExportOptions = {}): string {
  if (!options.redact) return renderHtml(input, options);
  const html = renderHtml(redactFinalAssessment(input), options);
  assertFinalAssessmentRedacted(html, input);
  return html;
}

function renderHtml(report: AssessmentReport, options: FinalAssessmentExportOptions): string {
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
  ${options.redact ? `<div class="notice" role="note"><strong>${escapeHtml(FINAL_ASSESSMENT_REDACTED_NOTICE)}</strong></div>` : ""}
</section>
<section class="block toc"><h2>Contents</h2><ol>${contents.map((c) => `<li>${escapeHtml(c)}</li>`).join("")}</ol></section>
${sectionHtml}
<section class="block"><h2>Source Pages Reviewed</h2>${sourcesHtml}</section>
</body>
</html>`;
}
