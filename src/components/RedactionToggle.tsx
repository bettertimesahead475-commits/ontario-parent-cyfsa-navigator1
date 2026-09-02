/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Visible switch for the redaction toggle (src/utils/redaction.ts). Drop this into any tab
 * that displays or exports names/case numbers/birthdates before sharing.
 */
import { EyeOff, Eye } from "lucide-react";

interface RedactionToggleProps {
  enabled: boolean;
  onToggle: () => void;
}

export default function RedactionToggle({ enabled, onToggle }: RedactionToggleProps) {
  return (
    <div className="flex items-center gap-2 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
      <button
        onClick={onToggle}
        role="switch"
        aria-checked={enabled}
        className={`relative w-10 h-5 rounded-full transition-colors shrink-0 ${
          enabled ? "bg-slate-900" : "bg-slate-300"
        }`}
      >
        <span
          className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
            enabled ? "translate-x-5" : ""
          }`}
        />
      </button>
      <div className="flex items-center gap-1.5">
        {enabled ? <EyeOff className="w-3.5 h-3.5 text-slate-600" /> : <Eye className="w-3.5 h-3.5 text-slate-400" />}
        <span className="text-xs font-medium text-slate-700">
          {enabled ? "Names & case numbers hidden" : "Hide names & case numbers"}
        </span>
      </div>
      <span className="text-[10px] text-slate-400 ml-1">
        (before sharing a screenshot or export - doesn't scrub free-text explanations)
      </span>
    </div>
  );
}
