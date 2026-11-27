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
  REDACTED_COPY_NOTICE +
  " Names cannot be reliably detected in free text, so finding wording and source excerpts are withheld rather than partly masked." +
  " The matter title and source file names are replaced with neutral labels. Section structure, source numbers and page references are kept, so each withheld finding can be checked against the original page.";

export const REDACTED_MATTER_TITLE = "Redacted matter";
export const FINDING_WITHHELD = "[Finding withheld in this redacted copy. Check the cited source page in the original.]";
export const EXCERPT_WITHHELD = "[Source excerpt withheld in this redacted copy.]";

/** What a redacted FCA export includes and withholds, shown to the user before download. */
export function describeRedactedFinalAssessment(report: AssessmentReport): { included: string[]; withheld: string[] } {
  const sources = Array.isArray(report.sources) ? report.sources : [];
  const counts = FINAL_ASSESSMENT_SECTIONS.map(([key, label]) => [label, Array.isArray(report.sections?.[key]) ? report.sections[key].length : 0] as const);
  const findings = counts.reduce((n, [, c]) => n + c, 0);
  const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
  return {
    included: [
      `Section headings with the number of findings in each (${counts.map(([l, c]) => `${l}: ${c}`).join(", ")})`,
      `Source and page references for every finding (${plural(sources.length, "source page")}, labelled "Source document N")`,
      "The saved date and the educational-use notice",
    ],
    withheld: [
      "The matter title",
      plural(sources.length, "source file name"),
      `The wording of ${plural(findings, "finding")}`,
      plural(sources.filter((s) => typeof s.text === "string" && s.text !== "").length, "source excerpt"),
    ],
  };
}

export interface FinalAssessmentExportOptions {
  generatedAt?: Date;
  /** Mirrors the user's export redaction setting (useRedaction). */
  redact?: boolean;
}

/**
 * Redacted copy built with the shared export redaction (every free-text string removed), so the FCA follows the same
 * rule as the Quick Review and Forensic exports; findings and excerpts are then labelled as withheld. Only source ids, page numbers
 * and the save time survive. The input is not modified.
 */
export function redactFinalAssessment(report: AssessmentReport): AssessmentReport {
  const sources = Array.isArray(report.sources) ? report.sources : [];
  const sections = {} as AssessmentReport["sections"];
  for (const [key] of FINAL_ASSESSMENT_SECTIONS) {
    const points = Array.isArray(report.sections?.[key]) ? report.sections[key] : [];
    sections[key] = points.map((p) => ({ ...redactForExport(p), text: p.text ? FINDING_WITHHELD : p.text, sources: Array.isArray(p.sources) ? [...p.sources] : [] }));
  }
  return {
    ...redactForExport(report),
    title: REDACTED_MATTER_TITLE,
    createdAt: report.createdAt,
    sources: sources.map((s, i) => ({ ...redactForExport(s), id: s.id, page: s.page, document: `Source document ${i + 1}`, text: s.text ? EXCERPT_WITHHELD : s.text })),
    sections,
  };
}

/** The same report with every title, file name, finding and source text replaced by one placeholder (empty values stay empty). */
function neutralized(report: AssessmentReport): AssessmentReport {
  const x = (v: unknown) => (typeof v === "string" && v === "" ? v : "x");
  const sections = {} as AssessmentReport["sections"];
  for (const [key] of FINAL_ASSESSMENT_SECTIONS) {
    const points = Array.isArray(report.sections?.[key]) ? report.sections[key] : [];
    sections[key] = points.map((p) => ({ ...p, text: x(p.text) }));
  }
  const sources = Array.isArray(report.sources) ? report.sources : [];
  return { ...report, title: x(report.title), sources: sources.map((s) => ({ ...s, document: x(s.document), text: x(s.text) })), sections };
}

/**
 * Fails closed: the redacted HTML must be identical to the redacted HTML of the same report with all of its text replaced,
 * so no title, file name, finding or source text can reach the PDF. Fixed headings are compared like for like.
 */
export function assertFinalAssessmentRedacted(html: string, original: AssessmentReport, options: FinalAssessmentExportOptions & { generatedAt: Date }): void {
  if (html !== renderHtml(redactFinalAssessment(neutralized(original)), options)) throw new Error("REDACTION_INCOMPLETE");
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
  const fixed = { ...options, generatedAt: options.generatedAt ?? new Date() };
  const html = renderHtml(redactFinalAssessment(input), fixed);
  assertFinalAssessmentRedacted(html, input, fixed);
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
