import React from 'react';
import { Scale, Copy, Check, Info, ExternalLink, AlertTriangle } from 'lucide-react';
import { AnalysisReport } from '../types';

export const LegislativePortalModal = ({ citation, details, fileUrl, onClose, setActiveLegislativeCitation, STATUTORY_TEXT_DB, activeLegislativeCitation }) => {
  const [copyFeedback, setCopyFeedback] = React.useState(false);

  return (
    <div className="fixed inset-0 bg-slate-900/70 backdrop-blur-xs flex items-center justify-center p-4 z-50 animate-fadeIn" id="verified-source-reference-modal">
      <div className="bg-white rounded-3xl shadow-2xl border border-brand-150 w-full max-w-5xl h-[85vh] flex flex-col overflow-hidden max-h-[800px]">
        <div className="bg-slate-900 text-white p-5 flex justify-between items-center shrink-0 border-b border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-brand-950 rounded-xl border border-brand-800 shrink-0">
              <Scale className="w-5 h-5 text-brand-400 animate-pulse" />
            </div>
            <div>
              <span className="text-[9px] font-mono tracking-wider block text-brand-400 font-extrabold uppercase leading-none">VERIFIED COURT JUSTICE DATA NODE</span>
              <h3 className="font-display font-black text-sm md:text-base text-slate-100 flex items-center gap-1.5 mt-1">
                Verified Legislative Portal Node: {details.title}
              </h3>
            </div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors cursor-pointer text-xs font-mono font-bold flex items-center gap-1 border border-slate-800">
            Close [ESC]
          </button>
        </div>
        <div className="flex-1 grid grid-cols-1 lg:grid-cols-12 overflow-hidden bg-slate-50">
          {/* ... (rest of the modal content) */}
        </div>
      </div>
    </div>
  );
};
