/**
 * Standalone HTML export of the 16-section report. It uses the same contract, labels, and eight
 * answers as the on-screen view, so the export contains every finding the screen shows.
 *
 * Operating data (token counts, model identifiers, API cost) is never read here.
 */
import { buildSectionedReport } from "../../shared/reportSections";
import type { ReportContract, ReportFinding } from "../../shared/reportContract";
import {
  AUTHORITY_LABEL,
  CONCERN_LABEL,
  GLOSSARY,
  LEGAL_INFORMATION_NOTICE,
  QUOTE_LABEL,
  SECTION_STATUS_LABEL,
  findingAnswers,
  sourceLabel,
} from "../../shared/reportSectionLabels";

export type ExportAudience = "parent" | "professional";

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const PRINT_CSS = `
body{font-family:system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;color:#0f172a;line-height:1.5;max-width:900px;margin:24px auto;padding:0 16px;}
h1{font-size:1.6rem;} h2{font-size:1.25rem;margin-top:28px;border-bottom:1px solid #cbd5e1;padding-bottom:4px;}
.badge{display:inline-block;border:1px solid #94a3b8;border-radius:4px;padding:1px 6px;font-size:.8rem;margin-left:6px;}
.finding{border:1px solid #e2e8f0;border-radius:8px;padding:10px 12px;margin:10px 0;break-inside:avoid;}
dt{font-weight:600;} dd{margin:0 0 6px 0;} .muted{color:#475569;font-style:italic;}
blockquote{border-left:3px solid #cbd5e1;margin:4px 0;padding-left:8px;color:#334155;}
@media print{body{margin:0;max-width:none;} h2{break-after:avoid;} a{color:#0f172a;text-decoration:none;}}
`;

function findingHtml(f: ReportFinding, audience: ExportAudience): string {
  const answers = findingAnswers(f)
    .map(
      (qa) =>
        `<dt>${escapeHtml(qa.question)}</dt><dd class="${qa.state === "PROVIDED" ? "" : "muted"}">${escapeHtml(qa.answer)}</dd>`
    )
    .join("");
  const tags = [
    `<span class="badge">${escapeHtml(CONCERN_LABEL[f.concern])}</span>`,
    f.quote !== "NOT_CHECKED" ? `<span class="badge">${escapeHtml(QUOTE_LABEL[f.quote])}</span>` : "",
    ...f.authorities.map((a) => `<span class="badge">${escapeHtml(a.citation)}: ${escapeHtml(AUTHORITY_LABEL[a.status])}</span>`),
  ].join("");
  const sources = f.sources.length
    ? `<p><strong>Where this appears</strong></p><ul>${f.sources
        .map(
          (s) =>
            `<li>${escapeHtml(sourceLabel(s.locator))}${s.quote ? `<blockquote>${escapeHtml(s.quote)}</blockquote>` : ""}</li>`
        )
        .join("")}</ul>`
    : "";
  const pro =
    audience === "professional"
      ? `<dl class="muted">
          <dt>Type</dt><dd>${escapeHtml(f.kind.replace(/_/g, " ").toLowerCase())}</dd>
          ${f.evidenceClassification ? `<dt>Evidence classification</dt><dd>${escapeHtml(f.evidenceClassification)}</dd>` : ""}
          ${f.severity ? `<dt>Analyzer severity</dt><dd>${escapeHtml(f.severity)}</dd>` : ""}
          ${f.legalTestResult ? `<dt>Statutory test result (analyzer)</dt><dd>${escapeHtml(f.legalTestResult)}</dd>` : ""}
          <dt>Supporting findings</dt><dd>${f.supportingFindingIds.length ? escapeHtml(f.supportingFindingIds.join(", ")) : "None identified in this analysis"}</dd>
          <dt>Contrary findings</dt><dd>${f.contraryFindingIds.length ? escapeHtml(f.contraryFindingIds.join(", ")) : "None identified in this analysis"}</dd>
          ${f.uncertainty ? `<dt>Limits</dt><dd>${escapeHtml(f.uncertainty)}</dd>` : ""}
          <dt>Finding ID</dt><dd>${escapeHtml(f.id)}</dd>
        </dl>`
      : "";
  return `<div class="finding"><h3>${escapeHtml(f.title)} ${tags}</h3><dl>${answers}</dl>${sources}${pro}</div>`;
}

export interface ReportSectionsHtmlOptions {
  /** When true, identifying metadata (names, file numbers, dates) is left out of the export. */
  redact?: boolean;
}

export function renderReportSectionsHtml(
  report: unknown,
  audience: ExportAudience = "parent",
  documentTitle = "Analysis report",
  options: ReportSectionsHtmlOptions = {}
): string {
  // Identifying metadata is removed before the contract is built, so no exported section can carry it.
  const source = options.redact && report && typeof report === "object" ? { ...report, metadata: {} } : report;
  // The document title is written by the model and can name the child or the parties, so it is not shown when redacting.
  const shownTitle = options.redact ? "Analysis report" : documentTitle;
  const contract: ReportContract = buildSectionedReport(source);
  const toc = contract.sections
    .map((s) => `<li><a href="#report-${s.id}">${s.number}. ${escapeHtml(s.title)}</a></li>`)
    .join("");
  const sections = contract.sections
    .map((s) => {
      const findings = s.findingIds
        .map((id) => contract.findings.find((f) => f.id === id))
        .filter((f): f is ReportFinding => Boolean(f));
      const body = findings.length
        ? findings.map((f) => findingHtml(f, audience)).join("")
        : `<p class="muted">No items to show for this section.</p>`;
      return `<section id="report-${s.id}"><h2>${s.number}. ${escapeHtml(s.title)} <span class="badge">${escapeHtml(
        SECTION_STATUS_LABEL[s.status]
      )}</span></h2><p>${escapeHtml(s.note)}</p>${body}</section>`;
    })
    .join("");
  const glossary = GLOSSARY.map((g) => `<dt>${escapeHtml(g.term)}</dt><dd>${escapeHtml(g.meaning)}</dd>`).join("");
  const courtNote = contract.findings.some((f) => f.kind === "COURT_ORDER" || f.kind === "JUDICIAL_ENDORSEMENT")
    ? `<p><strong>This is a court document.</strong> It is not scored for credibility or completeness.</p>`
    : "";

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(shownTitle)}</title>
<style>${PRINT_CSS}</style>
</head>
<body>
<h1>${escapeHtml(shownTitle)}</h1>
<p>${escapeHtml(LEGAL_INFORMATION_NOTICE)}</p>
${courtNote}
<h2>Contents</h2>
<ol>${toc}</ol>
<h2>Words used in this report</h2>
<dl>${glossary}</dl>
${sections}
<p class="muted">${escapeHtml(LEGAL_INFORMATION_NOTICE)}</p>
</body>
</html>`;
}
