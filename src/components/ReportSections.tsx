import React, { useMemo } from "react";
import { buildSectionedReport } from "../../shared/reportSections";
import { presentForParent, type ReportContract, type ReportFinding, type ReportSection } from "../../shared/reportContract";
import { titleSuggestsCourtOrder } from "../../shared/documentTitle";
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

export type ReportAudience = "parent" | "professional";

interface Props {
  report: unknown;
  audience?: ReportAudience;
}

const answerClass = (state: string) =>
  state === "PROVIDED" ? "text-slate-800" : "text-slate-500 italic";

function FindingBlock({ finding, audience }: { finding: ReportFinding; audience: ReportAudience }) {
  const answers = findingAnswers(finding);
  return (
    <details className="rounded-lg border border-slate-200 bg-white p-3 mt-3">
      <summary className="cursor-pointer font-semibold text-slate-900 focus-visible:outline focus-visible:outline-2">
        {finding.title}
        <span className="ml-2 inline-block rounded bg-slate-100 px-2 py-0.5 text-xs font-normal text-slate-700">
          {CONCERN_LABEL[finding.concern]}
        </span>
      </summary>
      <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-700">
        {finding.quote !== "NOT_CHECKED" && <span className="rounded border px-2 py-0.5">{QUOTE_LABEL[finding.quote]}</span>}
        {finding.authorities.map((a) => (
          <span key={a.citation} className="rounded border px-2 py-0.5">
            {a.citation}: {AUTHORITY_LABEL[a.status]}
          </span>
        ))}
      </div>
      <dl className="mt-3 space-y-2">
        {answers.map((qa) => (
          <div key={qa.question}>
            <dt className="text-sm font-semibold text-slate-900">{qa.question}</dt>
            <dd className={`text-sm ${answerClass(qa.state)}`}>{qa.answer}</dd>
          </div>
        ))}
      </dl>
      {finding.sources.length > 0 && (
        <div className="mt-3 text-sm">
          <p className="font-semibold text-slate-900">Where this appears</p>
          <ul className="list-disc pl-5">
            {finding.sources.map((s, i) => (
              <li key={i} className="break-words">
                {sourceLabel(s.locator)}
                {s.quote && <blockquote className="mt-1 border-l-2 border-slate-300 pl-2 text-slate-700">{s.quote}</blockquote>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {audience === "professional" && (
        <dl className="mt-3 space-y-1 text-xs text-slate-600">
          <div><dt className="inline font-semibold">Type: </dt><dd className="inline">{finding.kind.replace(/_/g, " ").toLowerCase()}</dd></div>
          {finding.evidenceClassification && (
            <div><dt className="inline font-semibold">Evidence classification: </dt><dd className="inline">{finding.evidenceClassification}</dd></div>
          )}
          {finding.severity && <div><dt className="inline font-semibold">Analyzer severity: </dt><dd className="inline">{finding.severity}</dd></div>}
          {finding.legalTestResult && (
            <div><dt className="inline font-semibold">Statutory test result (analyzer): </dt><dd className="inline">{finding.legalTestResult}</dd></div>
          )}
          <div>
            <dt className="inline font-semibold">Supporting findings: </dt>
            <dd className="inline">{finding.supportingFindingIds.length ? finding.supportingFindingIds.join(", ") : "None identified in this analysis"}</dd>
          </div>
          <div>
            <dt className="inline font-semibold">Contrary findings: </dt>
            <dd className="inline">{finding.contraryFindingIds.length ? finding.contraryFindingIds.join(", ") : "None identified in this analysis"}</dd>
          </div>
          {finding.uncertainty && <div><dt className="inline font-semibold">Limits: </dt><dd className="inline">{finding.uncertainty}</dd></div>}
          <div><dt className="inline font-semibold">Finding ID: </dt><dd className="inline break-all">{finding.id}</dd></div>
        </dl>
      )}
    </details>
  );
}

function SectionBlock({ section, contract, audience }: { section: ReportSection; contract: ReportContract; audience: ReportAudience }) {
  const findings = section.findingIds
    .map((id) => contract.findings.find((f) => f.id === id))
    .filter((f): f is ReportFinding => Boolean(f));
  return (
    <details id={`report-${section.id}`} className="scroll-mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4" open={section.number === 1}>
      <summary className="cursor-pointer focus-visible:outline focus-visible:outline-2">
        <h3 className="inline text-lg font-bold text-slate-900">
          {section.number}. {section.title}
        </h3>
        <span className="ml-2 inline-block rounded bg-white px-2 py-0.5 text-xs text-slate-700 border">
          {SECTION_STATUS_LABEL[section.status]}
        </span>
        <span className="ml-2 text-xs text-slate-600">
          {findings.length} {findings.length === 1 ? "item" : "items"}
        </span>
      </summary>
      <p className="mt-3 text-sm text-slate-700">{section.note}</p>
      {findings.length === 0 ? (
        <p className="mt-3 text-sm italic text-slate-500">No items to show for this section.</p>
      ) : (
        findings.map((f) => (
          <React.Fragment key={f.id}>
            <FindingBlock finding={f} audience={audience} />
          </React.Fragment>
        ))
      )}
    </details>
  );
}

export function ReportSections({ report, audience = "parent" }: Props) {
  const contract = useMemo(() => buildSectionedReport(report), [report]);
  // presentForParent is used for the section order and titles, so the two views cannot diverge.
  const order = useMemo(() => presentForParent(contract).map((s) => s.id), [contract]);
  const sections = order.map((id) => contract.sections.find((s) => s.id === id)!);
  const courtRecord = contract.findings.some((f) => f.kind === "COURT_ORDER" || f.kind === "JUDICIAL_ENDORSEMENT");
  // A title alone never shows legal effect, so a title that names an order gets the same caveat.
  const documentType = String((report as { documentType?: unknown } | null)?.documentType ?? "");
  const shownTitle = String((report as { documentTitle?: unknown } | null)?.documentTitle ?? "");
  const titleCaveat = !courtRecord && (titleSuggestsCourtOrder(documentType) || titleSuggestsCourtOrder(shownTitle));
  const possibleConcerns = contract.findings.filter((f) => f.concern === "POSSIBLE_CONCERN").length;
  const missingItems = contract.findings.filter((f) => f.concern === "MISSING_INFORMATION").length;
  const rightsCount = contract.findings.filter((f) => f.id.startsWith("R-")).length;

  return (
    <section aria-labelledby="report-sections-heading" data-testid="report-sections" className="mt-6 space-y-4">
      <h2 id="report-sections-heading" className="text-xl font-bold text-slate-900">
        Full report in 16 sections
      </h2>

      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-800">
        <p className="font-semibold">At a glance</p>
        <ul className="mt-2 list-disc pl-5">
          <li>{contract.findings.length} findings from this analysis.</li>
          <li>{possibleConcerns} possible concerns to check.</li>
          <li>{missingItems} items of missing information.</li>
          <li>{rightsCount} statutory provisions that may apply.</li>
        </ul>
        {(courtRecord || titleCaveat) && (
          <p role="note" className="mt-2 rounded bg-amber-50 p-2 text-amber-900">
            {courtRecord
              ? "This is a court document. It is not scored for credibility or completeness."
              : "The title names an order or decision. A title does not show that a document is final, signed, entered, served, or in effect."}{" "}
            This report does not show whether it is final, signed, entered, served, or in effect. Confirm that with counsel and the court file.
          </p>
        )}
      </div>

      <nav aria-label="Jump to a section" className="rounded-xl border border-slate-200 bg-white p-4">
        <ol className="grid gap-1 text-sm sm:grid-cols-2">
          {sections.map((s) => (
            <li key={s.id}>
              <a className="break-words text-blue-800 underline focus-visible:outline focus-visible:outline-2" href={`#report-${s.id}`}>
                {s.number}. {s.title}
              </a>
            </li>
          ))}
        </ol>
      </nav>

      <details className="rounded-xl border border-slate-200 bg-white p-4">
        <summary className="cursor-pointer font-semibold">Words used in this report</summary>
        <dl className="mt-3 space-y-2 text-sm">
          {GLOSSARY.map((g) => (
            <div key={g.term}>
              <dt className="font-semibold">{g.term}</dt>
              <dd className="text-slate-700">{g.meaning}</dd>
            </div>
          ))}
        </dl>
      </details>

      {sections.map((section) => (
        <React.Fragment key={section.id}>
          <SectionBlock section={section} contract={contract} audience={audience} />
        </React.Fragment>
      ))}

      <p className="text-xs text-slate-600">{LEGAL_INFORMATION_NOTICE}</p>
    </section>
  );
}
