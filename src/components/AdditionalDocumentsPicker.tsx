import React from "react";
import { MAX_ADDITIONAL_DOCUMENTS, eligibleAdditionalFiles, type CaseFileLike } from "../utils/caseDocumentsSelection";

/**
 * Lets the parent add other documents from the same case to a Forensic In-Depth analysis, so the investigation can
 * compare them. Shown only when the server's Forensic Engine is on (it is the only path that reads them).
 */
export function AdditionalDocumentsPicker({
  files,
  primaryId,
  selectedIds,
  onChange,
}: {
  files: CaseFileLike[];
  primaryId: string | null;
  selectedIds: string[];
  onChange: (ids: string[]) => void;
}) {
  const eligible = eligibleAdditionalFiles(files, primaryId);
  const chosen = selectedIds.filter((id) => eligible.some((f) => f.id === id));
  const toggle = (id: string) => {
    if (chosen.includes(id)) onChange(chosen.filter((x) => x !== id));
    else if (chosen.length < MAX_ADDITIONAL_DOCUMENTS) onChange([...chosen, id]);
  };
  return (
    <details className="bg-slate-100 rounded-xl p-1.5 border border-slate-200 text-[10px] font-sans" aria-label="Other documents from this case">
      <summary className="cursor-pointer font-bold uppercase tracking-wider text-slate-600 px-1">
        Compare with other case documents ({chosen.length}/{MAX_ADDITIONAL_DOCUMENTS})
      </summary>
      {eligible.length === 0 ? (
        <p className="mt-1 px-1 text-slate-600">Other files appear here once their text has been read (run a Quick Review on them first).</p>
      ) : (
        <ul className="mt-1 max-h-48 overflow-auto px-1">
          {eligible.map((f) => (
            <li key={f.id}>
              <label className="flex items-center gap-1.5 py-0.5">
                <input
                  type="checkbox"
                  checked={chosen.includes(f.id)}
                  disabled={!chosen.includes(f.id) && chosen.length >= MAX_ADDITIONAL_DOCUMENTS}
                  onChange={() => toggle(f.id)}
                />
                <span className="text-slate-800">{f.name}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
    </details>
  );
}

export default AdditionalDocumentsPicker;
