import React from "react";
import { buildEngineRecordView } from "../utils/forensicEngineView";

/** Screen view of the Forensic Engine record (report.forensicEngine). Renders nothing for other reports. */
export function ForensicEngineRecord({ record }: { record: unknown }) {
  const v = buildEngineRecordView(record);
  if (!v) return null;
  return (
    <section aria-label="Forensic Engine record" className="mt-6 rounded-xl border border-slate-200 bg-white p-4 text-sm">
      <h3 className="font-bold text-slate-900">Forensic Engine record</h3>
      <p className="mt-1 text-slate-600">
        Status: <strong>{v.status === "PARTIAL" ? "Partial analysis" : "Complete"}</strong>. Every finding below was checked by an
        independent adversarial review and each quotation was located in the source by code.
      </p>

      {v.incompleteness.length > 0 && (
        <div role="status" className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-amber-900">
          <strong>What this analysis did not do</strong>
          <ul className="mt-1 list-disc pl-5">{v.incompleteness.map((i, k) => <li key={k}>{i}</li>)}</ul>
        </div>
      )}

      {v.injectionWarnings.length > 0 && (
        <div className="mt-3 rounded-lg border border-rose-200 bg-rose-50 p-3 text-rose-900">
          <strong>Text in the documents that read like instructions to an AI (not followed)</strong>
          <ul className="mt-1 list-disc pl-5">{v.injectionWarnings.map((w, k) => <li key={k}>{w.where}: “{w.excerpt}”</li>)}</ul>
        </div>
      )}

      <ol className="mt-4 space-y-4">
        {v.findings.map((f) => (
          <li key={f.id} className="rounded-lg border border-slate-200 p-3">
            <p className="font-semibold text-slate-900">{f.title}</p>
            <p className="text-xs text-slate-500">{f.classLabel} · {f.review} · uncertainty {f.uncertainty}{f.visual ? ` · ${f.visual}` : ""}</p>
            <p className="mt-2 text-slate-800">{f.statement}</p>
            <ul className="mt-2 space-y-1">
              {f.sources.map((s, k) => (
                <li key={k} className="border-l-2 border-slate-300 pl-2 text-slate-700">
                  <span className="text-xs text-slate-500">{s.where}{s.verified ? "" : " · not found word-for-word"}</span>
                  <br />“{s.quote}”
                </li>
              ))}
            </ul>
            {f.counter.length > 0 && (
              <div className="mt-2"><strong className="text-xs">Contrary or explaining text</strong>
                <ul className="list-disc pl-5">{f.counter.map((c, k) => <li key={k}>{c.where}: “{c.quote}”</li>)}</ul></div>
            )}
            {f.alternatives.length > 0 && (
              <div className="mt-2"><strong className="text-xs">Other explanations</strong>
                <ul className="list-disc pl-5">{f.alternatives.map((a, k) => <li key={k}>{a}</li>)}</ul></div>
            )}
            {f.missing.length > 0 && (
              <div className="mt-2"><strong className="text-xs">Missing information</strong>
                <ul className="list-disc pl-5">{f.missing.map((m, k) => <li key={k}>{m}</li>)}</ul></div>
            )}
            {f.citations.map((c, k) => (
              <details key={k} className="mt-2">
                <summary className="cursor-pointer text-xs">{c.citation} — {c.status}</summary>
                {c.corpusNote && <p className="mt-1 text-xs text-slate-600">{c.corpusNote}</p>}
                {c.statuteText && <pre className="mt-1 whitespace-pre-wrap text-xs text-slate-600">{c.statuteText}</pre>}
              </details>
            ))}
            {f.notes.length > 0 && <ul className="mt-2 list-disc pl-5 text-xs text-amber-800">{f.notes.map((n, k) => <li key={k}>{n}</li>)}</ul>}
          </li>
        ))}
      </ol>
      {v.findings.length === 0 && <p className="mt-3 text-slate-700">No finding survived adversarial review and source checks.</p>}

      {v.setAside.length > 0 && (
        <details className="mt-4">
          <summary className="cursor-pointer font-semibold">Proposed findings set aside ({v.setAside.length})</summary>
          <ul className="mt-1 list-disc pl-5">{v.setAside.map((a, k) => <li key={k}>{a.title} — {a.reason}</li>)}</ul>
        </details>
      )}
      {v.hypotheses.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer font-semibold">Questions investigated ({v.hypotheses.length})</summary>
          <ul className="mt-1 list-disc pl-5">{v.hypotheses.map((h, k) => <li key={k}>{h.question} ({h.outcome})</li>)}</ul>
        </details>
      )}
    </section>
  );
}

export default ForensicEngineRecord;
