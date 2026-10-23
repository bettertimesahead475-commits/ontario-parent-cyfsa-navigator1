import React, { useMemo } from "react";
import { buildParentReportView, type ParentFindingView } from "../utils/parentReportView";

interface Props {
  report: unknown;
}

function FindingBlock({ finding }: { finding: ParentFindingView }) {
  return (
    <details className="mt-3 rounded-lg border border-slate-200 bg-white p-3">
      <summary className="cursor-pointer font-semibold text-slate-900 focus-visible:outline focus-visible:outline-2">
        {finding.heading}
        {finding.evidenceLabel ? <span className="ml-2 text-xs font-normal text-slate-600">({finding.evidenceLabel})</span> : null}
      </summary>
      <div className="mt-2 space-y-2 text-sm text-slate-800">
        {finding.severityLabel && <p className="text-xs text-slate-600">{finding.severityLabel}</p>}
        <p>{finding.whatHappened}</p>
        {finding.whyItMatters && <p>{finding.whyItMatters}</p>}
        <p>
          <strong>The law:</strong> {finding.whatTheLawSays}
        </p>
        <p className="text-slate-600">{finding.whatCourtsHaveSaid}</p>
        {finding.secondReview && <p className="rounded bg-amber-50 p-2 text-amber-900">{finding.secondReview}</p>}
        {finding.whatIsUnknown && (
          <p>
            <strong>Still unknown:</strong> {finding.whatIsUnknown}
          </p>
        )}
        {finding.whatYouCanDo && (
          <p>
            <strong>What you can do:</strong> {finding.whatYouCanDo}
          </p>
        )}
        <div className="rounded bg-slate-50 p-2 text-xs text-slate-700">
          <p>Quote: {finding.evidenceDetail.quote || "No quote was given."}</p>
          <p>Location: {finding.evidenceDetail.location}</p>
          <p>Citation: {finding.evidenceDetail.citationStatus}</p>
        </div>
      </div>
    </details>
  );
}

/** Parent-facing view of the analyzer's own findings. Shown only when the parent report flag is on. */
/** Renders nothing unless the parent report flag is on. The caller passes the flag so the gate can be tested directly. */
export function ParentReportSection({ report, enabled }: Props & { enabled: boolean }) {
  if (!enabled) return null;
  return <ParentReportPanel report={report} />;
}

export function ParentReportPanel({ report }: Props) {
  const view = useMemo(() => buildParentReportView(report as Record<string, unknown>), [report]);
  return (
    <section aria-labelledby="parent-report-heading" className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-4">
      <h2 id="parent-report-heading" className="text-lg font-bold text-slate-900">
        Parent report
      </h2>
      <p className="mt-1 text-sm text-slate-700">
        This is organised from the analyzer&apos;s own findings. It adds no new legal conclusions. Check each point with a lawyer before relying on it.
      </p>
      {view.secondReviewNotice && (
        <p role="note" className="mt-3 rounded bg-amber-50 p-2 text-sm text-amber-900">
          {view.secondReviewNotice}
        </p>
      )}
      {view.summary.map((part) => (
        <section key={part.heading} className="mt-4">
          <h3 className="font-semibold text-slate-900">{part.heading}</h3>
          <p className="mt-1 text-sm text-slate-800">{part.body}</p>
        </section>
      ))}
      <section className="mt-6">
        <h3 className="font-bold text-slate-900">Points raised in this document</h3>
        {view.findings.length === 0 ? (
          <p className="mt-1 text-sm text-slate-700">The analyzer raised no points for this document.</p>
        ) : (
          view.findings.map((finding) => (
            <React.Fragment key={finding.id}>
              <FindingBlock finding={finding} />
            </React.Fragment>
          ))
        )}
      </section>
      {view.questionsForCourt.length > 0 && (
        <section className="mt-6">
          <h3 className="font-bold text-slate-900">Questions for your lawyer</h3>
          <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-slate-800">
            {view.questionsForCourt.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
