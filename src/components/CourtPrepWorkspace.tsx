import React, { useMemo, useState } from "react";
import { buildCourtPrep, checkResponse, EVENT_TYPE_LABEL, type FactualResponse } from "../../shared/courtPrep";
import { COURT_FORMS, COURT_FORM_INDEX_URL, FORM_SAFEGUARDS } from "../../shared/courtPrepForms";
import { buildPrepNotes } from "../../shared/courtPrepNotes";
import { COURT_PREP_LIMITS } from "../../shared/courtPrep";

const emptyResponse = (allegationFindingId: string): FactualResponse => ({
  allegationFindingId,
  parentAccount: "",
  supportingEntryIds: [],
  contraryEntryIds: [],
  unverifiedPoints: [],
  questionsForCounsel: [],
});

const lines = (text: string) => text.split("\n").map((s) => s.trim()).filter(Boolean);

const STATUS_TEXT: Record<string, string> = {
  NOT_YET_WRITTEN: "Not written yet",
  WRITTEN_WITH_RECORDS: "Written, with records selected",
  WRITTEN_WITHOUT_RECORDS: "Written, no records selected yet",
};

export function CourtPrepWorkspace({
  report,
  documentTitle = "Analysis report",
  redact = false,
}: {
  report: unknown;
  documentTitle?: string;
  /** When true, the downloaded notes are a redacted copy. The on-screen workspace is not changed. */
  redact?: boolean;
}) {
  const prep = useMemo(() => buildCourtPrep(report), [report]);
  // Parent entries live in component state only: not saved to a server and not written to browser storage.
  const [responses, setResponses] = useState<Record<string, FactualResponse>>({});
  const response = (id: string) => responses[id] ?? emptyResponse(id);
  const update = (id: string, patch: Partial<FactualResponse>) =>
    setResponses((prev) => ({ ...prev, [id]: { ...response(id), ...patch } }));
  const toggle = (id: string, key: "supportingEntryIds" | "contraryEntryIds", entry: string) => {
    const current = response(id)[key];
    update(id, { [key]: current.includes(entry) ? current.filter((x) => x !== entry) : [...current, entry] });
  };

  const download = () => {
    const text = buildPrepNotes(prep, responses, documentTitle, { redact });
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "cyfsa-court-prep-notes.txt";
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section aria-labelledby="court-prep-heading" data-testid="court-prep" className="mt-6 space-y-4">
      <h2 id="court-prep-heading" className="text-xl font-bold text-slate-900">Court preparation</h2>
      <div className="rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-800">
        {COURT_PREP_LIMITS.map((l) => (
          <p key={l} className="mt-1">{l}</p>
        ))}
        <p className="mt-2 text-xs text-slate-600">Your entries stay in this page only. They are not saved to our servers. Download your notes before you leave the page.</p>
      </div>

      <details open className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <summary className="cursor-pointer font-semibold">1. Timeline from the analyzer</summary>
        {prep.chronology.length === 0 ? (
          <p className="mt-3 text-sm italic text-slate-600">No dated items were found in this report.</p>
        ) : (
          <ol className="mt-3 space-y-3">
            {prep.chronology.map((row) => (
              <li key={row.id} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
                <p className="font-semibold">{row.dateAsWritten}</p>
                <p className="mt-1">{row.event}</p>
                <p className="mt-1 text-xs text-slate-700">Type: {EVENT_TYPE_LABEL[row.eventType]}</p>
                <p className="text-xs text-slate-700">Source: {row.source.map((s) => s.locator).join("; ") || "not given"}</p>
                {row.disputedByFindingIds.length > 0 && (
                  <p className="mt-1 rounded bg-amber-50 p-1 text-xs text-amber-900">Another passage gives a different date or description.</p>
                )}
              </li>
            ))}
          </ol>
        )}
      </details>

      <details className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <summary className="cursor-pointer font-semibold">2. Dates to confirm</summary>
        <p className="mt-2 text-sm text-slate-700">No deadline is calculated here. Confirm each date on the court file.</p>
        <ul className="mt-2 space-y-2 text-sm">
          {prep.dateChecks.map((c, i) => (
            <li key={`${c.dateAsWritten}-${i}`}>
              <span className="font-semibold">{c.dateAsWritten}:</span> {c.note}
            </li>
          ))}
        </ul>
      </details>

      <details className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <summary className="cursor-pointer font-semibold">3. Evidence index (analyzer findings, not your statements)</summary>
        {prep.evidenceIndex.length === 0 ? (
          <p className="mt-3 text-sm italic text-slate-600">No quoted passages were found.</p>
        ) : (
          <ul className="mt-3 space-y-2 text-sm">
            {prep.evidenceIndex.map((e) => (
              <li key={e.id} className="rounded-lg border border-slate-200 bg-white p-3">
                <p className="text-xs text-slate-700">Source: {e.locator}</p>
                {e.quote && <blockquote className="mt-1 border-l-2 border-slate-300 pl-2">{e.quote}</blockquote>}
                <p className="mt-1 text-xs text-slate-600">Linked to {e.findingIds.length} analyzer {e.findingIds.length === 1 ? "finding" : "findings"}.</p>
              </li>
            ))}
          </ul>
        )}
      </details>

      <section aria-labelledby="responses-heading" className="space-y-3">
        <h3 id="responses-heading" className="text-lg font-bold text-slate-900">4. Your responses to each point</h3>
        <p className="text-sm text-slate-700">Write in your own words. Select the records that support or contradict each point. Nothing here is a statement under oath.</p>
        {prep.allegations.length === 0 && <p className="text-sm italic text-slate-600">No quoted points were found to respond to.</p>}
        {prep.allegations.map((a) => {
          const r = response(a.id);
          const status = checkResponse(r, prep.evidenceIndex);
          const textId = `resp-${a.id}`;
          return (
            <details key={a.id} className="rounded-xl border border-slate-200 bg-white p-4">
              <summary className="cursor-pointer font-semibold">{a.title}</summary>
              <p className="mt-2 text-sm"><span className="font-semibold">Quoted in the record:</span> {a.sources.map((s) => (s.quote ? `"${s.quote}"` : s.locator)).join("; ")}</p>
              <p className="mt-1 text-xs text-slate-700">{STATUS_TEXT[status.status]}</p>
              <label htmlFor={textId} className="mt-3 block text-sm font-semibold">Your account in your own words</label>
              <textarea id={textId} rows={4} className="mt-1 w-full rounded border border-slate-300 p-2 text-sm" value={r.parentAccount} onChange={(e) => update(a.id, { parentAccount: e.target.value })} />
              <fieldset className="mt-3">
                <legend className="text-sm font-semibold">Records that support your account</legend>
                {prep.evidenceIndex.map((e) => (
                  <label key={e.id} className="mt-1 flex items-start gap-2 text-sm">
                    <input type="checkbox" checked={r.supportingEntryIds.includes(e.id)} onChange={() => toggle(a.id, "supportingEntryIds", e.id)} />
                    <span className="break-words">{e.locator}{e.quote ? `: "${e.quote}"` : ""}</span>
                  </label>
                ))}
              </fieldset>
              <fieldset className="mt-3">
                <legend className="text-sm font-semibold">Records that contradict the point</legend>
                {prep.evidenceIndex.map((e) => (
                  <label key={e.id} className="mt-1 flex items-start gap-2 text-sm">
                    <input type="checkbox" checked={r.contraryEntryIds.includes(e.id)} onChange={() => toggle(a.id, "contraryEntryIds", e.id)} />
                    <span className="break-words">{e.locator}{e.quote ? `: "${e.quote}"` : ""}</span>
                  </label>
                ))}
              </fieldset>
              <label htmlFor={`${textId}-unverified`} className="mt-3 block text-sm font-semibold">Points no record supports yet (one per line)</label>
              <textarea id={`${textId}-unverified`} rows={2} className="mt-1 w-full rounded border border-slate-300 p-2 text-sm" value={r.unverifiedPoints.join("\n")} onChange={(e) => update(a.id, { unverifiedPoints: lines(e.target.value) })} />
              <label htmlFor={`${textId}-questions`} className="mt-3 block text-sm font-semibold">Questions for counsel (one per line)</label>
              <textarea id={`${textId}-questions`} rows={2} className="mt-1 w-full rounded border border-slate-300 p-2 text-sm" value={r.questionsForCounsel.join("\n")} onChange={(e) => update(a.id, { questionsForCounsel: lines(e.target.value) })} />
              {status.problems.map((p) => (
                <p key={p} role="alert" className="mt-2 text-sm text-red-800">{p}</p>
              ))}
            </details>
          );
        })}
      </section>

      <details className="rounded-xl border border-slate-200 bg-slate-50 p-4">
        <summary className="cursor-pointer font-semibold">5. Court forms (currency not checked)</summary>
        <ul className="mt-3 space-y-2 text-sm">
          {COURT_FORMS.map((f) => (
            <li key={f.formNumber}>
              <span className="font-semibold">Form {f.formNumber}:</span> {f.title}. Version {f.versionDate}, effective {f.effectiveDate}. Currency: unknown. {f.purpose}
            </li>
          ))}
        </ul>
        <p className="mt-2 text-sm">Official index: <a className="underline text-blue-800" href={COURT_FORM_INDEX_URL} rel="noopener noreferrer" target="_blank">ontariocourtforms.on.ca</a></p>
        <ul className="mt-2 list-disc pl-5 text-sm">
          {FORM_SAFEGUARDS.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ul>
      </details>

      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={download} className="rounded-md border border-slate-400 bg-white px-4 py-2 text-sm font-semibold text-slate-900 hover:bg-slate-50 focus-visible:outline focus-visible:outline-2">
          Download my preparation notes (text)
        </button>
      </div>
    </section>
  );
}
