import React, { useState, useEffect } from 'react';
import { apiFetch } from '../utils/api';

interface ProfessionalOutputsViewerProps {
  matterId: string;
}

export default function ProfessionalOutputsViewer({ matterId }: ProfessionalOutputsViewerProps) {
  const [selectedFormat, setSelectedFormat] = useState<'CASE_BRIEF' | 'CHRONOLOGY' | 'EVIDENCE_PACKAGE'>('CASE_BRIEF');
  const [outputData, setOutputData] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    if (matterId) {
      loadOutput(selectedFormat);
    }
  }, [matterId, selectedFormat]);

  async function loadOutput(format: string) {
    setLoading(true);
    setError('');
    setOutputData(null);
    let endpoint = '';
    if (format === 'CASE_BRIEF') endpoint = `/api/professional-workspace/matters/${matterId}/outputs/case-brief`;
    else if (format === 'CHRONOLOGY') endpoint = `/api/professional-workspace/matters/${matterId}/outputs/chronology`;
    else if (format === 'EVIDENCE_PACKAGE') endpoint = `/api/professional-workspace/matters/${matterId}/outputs/evidence-package`;

    try {
      const res = await apiFetch(endpoint);
      if (!res.ok) throw new Error(`Failed to load ${format} output package`);
      setOutputData(await res.json());
    } catch (e: any) {
      setError(e.message || 'Error loading output package');
    } finally {
      setLoading(false);
    }
  }

  const handlePrint = () => {
    window.print();
  };

  const handleDownloadJson = () => {
    if (!outputData) return;
    const blob = new Blob([JSON.stringify(outputData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${selectedFormat.toLowerCase()}_${matterId.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-white text-slate-900 space-y-6">
      {/* Selector & Export Controls - Hidden in Print */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b pb-4 print:hidden">
        <div>
          <h2 className="text-xl font-bold text-slate-900">Review-Ready Professional Outputs</h2>
          <p className="text-xs text-slate-600">Source-grounded, review-stamped work product outputs with exactQuote safeguards.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleDownloadJson}
            disabled={!outputData || loading}
            className="px-3 py-1.5 text-xs font-semibold rounded border border-slate-300 text-slate-700 hover:bg-slate-100 disabled:opacity-50"
          >
            Export JSON Data
          </button>
          <button
            onClick={handlePrint}
            disabled={!outputData || loading}
            className="px-3 py-1.5 text-xs font-semibold rounded bg-indigo-600 text-white hover:bg-indigo-700 disabled:opacity-50"
          >
            Print / Save to PDF
          </button>
        </div>
      </div>

      {/* Format Selector Pills - Hidden in Print */}
      <div className="flex gap-2 print:hidden">
        {[
          { id: 'CASE_BRIEF', label: 'Full Case Brief' },
          { id: 'CHRONOLOGY', label: 'Chronology Package' },
          { id: 'EVIDENCE_PACKAGE', label: 'Evidence & Issues Package' }
        ].map(fmt => (
          <button
            key={fmt.id}
            onClick={() => setSelectedFormat(fmt.id as any)}
            className={`px-4 py-2 text-xs font-bold rounded-lg border transition-colors ${selectedFormat === fmt.id ? 'bg-indigo-50 border-indigo-500 text-indigo-800' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'}`}
          >
            {fmt.label}
          </button>
        ))}
      </div>

      {error && <div role="alert" className="p-4 bg-red-50 text-red-900 rounded-lg border border-red-200 text-sm">{error}</div>}
      {loading && <div role="status" className="p-8 text-center text-slate-500 font-medium">Generating formatted professional output...</div>}

      {/* OUTPUT CONTENT DISPLAY */}
      {!loading && outputData && (
        <div className="space-y-6">
          {/* Statutory / Legal Positioning Disclaimer */}
          <div className="bg-amber-50 border-l-4 border-amber-500 p-4 rounded-r-lg text-xs text-amber-950 font-medium leading-relaxed">
            <strong className="block font-bold mb-1 uppercase tracking-wider text-amber-900">Legal Positioning & Decision Support Notice:</strong>
            {outputData.disclaimer}
          </div>

          {/* CHRONOLOGY PACKAGE FORMAT */}
          {selectedFormat === 'CHRONOLOGY' && (
            <div className="space-y-4">
              <h3 className="text-lg font-bold border-b pb-2">Master Chronology Package ({outputData.events?.length || 0} Events)</h3>
              <div className="space-y-3">
                {outputData.events?.map((evt: any) => (
                  <div key={evt.id} className="p-4 border rounded-xl bg-slate-50 space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                      <span className="font-mono font-bold text-slate-900 bg-white px-2 py-1 border rounded">
                        {evt.dateText} ({evt.datePrecision})
                      </span>
                      <span className="px-2 py-0.5 bg-slate-200 text-slate-800 font-mono rounded text-[10px]">
                        {evt.aiClassification}
                      </span>
                    </div>
                    <p className="text-slate-900 font-medium text-sm">{evt.description}</p>
                    
                    <div className="flex flex-wrap items-center gap-4 text-xs text-slate-500 pt-2 border-t border-slate-200">
                      <span>Source Provenance: {evt.provenance.hasSourceProvenance ? `Doc ${evt.provenance.sourceDocumentId || 'N/A'}, Pg ${evt.provenance.pageNumber || 'N/A'}` : 'Unlinked Machine Text'}</span>
                      {evt.professionalReview ? (
                        <span className="font-semibold text-indigo-700 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                          Lawyer Review: {evt.professionalReview.reviewState} ({evt.professionalReview.reviewNote || 'No note'})
                        </span>
                      ) : (
                        <span className="italic text-slate-400">Unreviewed by Lawyer</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* EVIDENCE & ISSUES PACKAGE FORMAT */}
          {selectedFormat === 'EVIDENCE_PACKAGE' && (
            <div className="space-y-6">
              {/* Evidence Section */}
              <div className="space-y-3">
                <h3 className="text-lg font-bold border-b pb-2">Extracted Evidence ({outputData.evidenceItems?.length || 0})</h3>
                {outputData.evidenceItems?.map((ev: any) => (
                  <div key={ev.id} className="p-4 border rounded-xl bg-white space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-bold uppercase px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded">
                        {ev.classification}
                      </span>
                      <span className={`text-[10px] font-mono px-2 py-0.5 rounded font-bold ${ev.exactQuote ? 'bg-green-100 text-green-900' : 'bg-amber-100 text-amber-900'}`}>
                        Quote Status: {ev.quoteVerificationStatus}
                      </span>
                    </div>
                    <p className="text-slate-900 font-medium text-sm">{ev.normalizedStatement}</p>
                    
                    {ev.exactQuote ? (
                      <blockquote className="border-l-3 border-indigo-400 pl-3 py-1 text-xs italic bg-slate-50 text-slate-800 rounded">
                        "{ev.exactQuote}"
                      </blockquote>
                    ) : (
                      <div className="text-xs text-amber-800 bg-amber-50/50 p-2 rounded italic">
                        [Exact quote unverified — flagged for manual source record review]
                      </div>
                    )}

                    {ev.professionalReview && (
                      <div className="text-xs text-indigo-900 font-semibold bg-indigo-50/80 p-2 rounded">
                        Lawyer Review: {ev.professionalReview.reviewState} {ev.professionalReview.reviewNote ? `— "${ev.professionalReview.reviewNote}"` : ''}
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* Material Claims Section */}
              <div className="space-y-3">
                <h3 className="text-lg font-bold border-b pb-2">Material Claims & Allegations ({outputData.materialClaims?.length || 0})</h3>
                {outputData.materialClaims?.map((c: any) => (
                  <div key={c.id} className="p-3 border rounded-lg bg-slate-50 flex items-center justify-between text-sm">
                    <span>{c.claimText}</span>
                    <span className="text-xs text-slate-500 font-mono">({c.classification})</span>
                  </div>
                ))}
              </div>

              {/* Evidence Gaps Section */}
              <div className="space-y-3">
                <h3 className="text-lg font-bold border-b pb-2">Identified Evidence Gaps ({outputData.evidenceGaps?.length || 0})</h3>
                {outputData.evidenceGaps?.map((g: any) => (
                  <div key={g.id} className="p-3 border rounded-lg bg-amber-50/40 border-amber-200 text-sm">
                    <strong className="text-xs text-amber-900 block font-mono font-bold uppercase">{g.gapType}</strong>
                    <span className="text-slate-800">{g.description}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* CASE BRIEF OUTPUT FORMAT */}
          {selectedFormat === 'CASE_BRIEF' && (
            <div className="space-y-4">
              <h3 className="text-lg font-bold border-b pb-2">Full Case Brief Output</h3>
              <pre className="whitespace-pre-wrap text-xs font-mono bg-slate-50 p-4 rounded-xl border max-h-[500px] overflow-y-auto">
                {JSON.stringify(outputData, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
