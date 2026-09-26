import React, { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../utils/api';
import CaseBriefViewer from './CaseBriefViewer';
import LegalDiscoveryTab from './LegalDiscoveryTab';
import ProfessionalOutputsViewer from './ProfessionalOutputsViewer';

interface MatterItem {
  id: string;
  title: string;
  role?: string;
  createdAt?: string;
  updatedAt?: string;
}

interface SourcePageData {
  evidenceId: string;
  documentId: string;
  versionId: string;
  page: {
    id: string;
    page_number: number;
    text: string;
  };
}

export default function ProfessionalWorkspace() {
  const [matters, setMatters] = useState<MatterItem[]>([]);
  const [selectedMatter, setSelectedMatter] = useState<string>('');
  const [overview, setOverview] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<string>('OVERVIEW');
  const [intelligence, setIntelligence] = useState<any>(null);
  const [caseBrief, setCaseBrief] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [mattersLoading, setMattersLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>('');
  const [accessDenied, setAccessDenied] = useState<boolean>(false);

  const [versions, setVersions] = useState<any[]>([]);
  const [selectedVersionData, setSelectedVersionData] = useState<any>(null);

  // Source Jump-Back Modal state
  const [activeSource, setActiveSource] = useState<SourcePageData | null>(null);
  const [sourceLoading, setSourceLoading] = useState<boolean>(false);
  const [sourceError, setSourceError] = useState<string>('');
  const [highlightQuote, setHighlightQuote] = useState<string>('');

  useEffect(() => {
    loadMatters();
  }, []);

  useEffect(() => {
    if (selectedMatter) {
      setAccessDenied(false);
      setError('');
      loadOverview();
      setActiveTab('OVERVIEW');
    } else {
      setOverview(null);
      setIntelligence(null);
    }
  }, [selectedMatter]);

  useEffect(() => {
    if (selectedMatter && activeTab !== 'OVERVIEW') {
      loadIntelligence(activeTab);
    }
  }, [selectedMatter, activeTab]);

  async function loadMatters() {
    setMattersLoading(true);
    setError('');
    try {
      const res = await apiFetch('/api/professional-workspace/matters');
      if (res.status === 401 || res.status === 403) {
        setAccessDenied(true);
        setMatters([]);
        return;
      }
      if (!res.ok) throw new Error("Failed to load professional matters");
      const data = await res.json();
      setMatters(Array.isArray(data) ? data : []);
      if (Array.isArray(data) && data.length > 0 && !selectedMatter) {
        setSelectedMatter(data[0].id);
      }
    } catch (e: any) {
      setError(e.message || "Failed to load matters");
    } finally {
      setMattersLoading(false);
    }
  }

  async function loadOverview() {
    setLoading(true);
    setError('');
    try {
      const res = await apiFetch(`/api/professional-workspace/matters/${selectedMatter}/overview`);
      if (res.status === 401 || res.status === 403) {
        setAccessDenied(true);
        setOverview(null);
        return;
      }
      if (!res.ok) throw new Error("Failed to load matter overview");
      setOverview(await res.json());
    } catch (e: any) {
      setError(e.message || "Failed to load overview");
    } finally {
      setLoading(false);
    }
  }

  async function loadIntelligence(tab: string) {
    setLoading(true);
    setIntelligence(null);
    setError('');
    
    try {
      if (['DOCUMENTS', 'EVIDENCE', 'CHRONOLOGY', 'CLAIMS', 'RELATIONSHIPS', 'GAPS', 'LEGAL'].includes(tab)) {
        const res = await apiFetch(`/api/professional-workspace/matters/${selectedMatter}/intelligence/${tab}`);
        if (res.status === 401 || res.status === 403) {
          setAccessDenied(true);
          return;
        }
        if (!res.ok) throw new Error(`Failed to load ${tab.toLowerCase()} details`);
        setIntelligence(await res.json());
      } else if (tab === 'CASE_BRIEF') {
        const res = await apiFetch(`/api/professional-workspace/matters/${selectedMatter}/work-product/case-brief`);
        if (!res.ok) throw new Error("Failed to generate case brief");
        setCaseBrief(await res.json());
      } else if (tab === 'VERSIONS') {
        setSelectedVersionData(null);
        const res = await apiFetch(`/api/professional-workspace/matters/${selectedMatter}/work-product/case-brief/versions`);
        if (!res.ok) throw new Error("Failed to fetch versions");
        setVersions(await res.json());
      }
    } catch (e: any) {
      setError(e.message || "Failed to load intelligence");
    } finally {
      setLoading(false);
    }
  }

  async function loadVersion(versionId: string) {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/professional-workspace/matters/${selectedMatter}/work-product/case-brief/versions/${versionId}`);
      if (!res.ok) throw new Error("Failed to fetch version data");
      setSelectedVersionData(await res.json());
    } catch (e: any) {
      setError(e.message || "Failed to load version");
    } finally {
      setLoading(false);
    }
  }

  async function handleFinalize() {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/professional-workspace/matters/${selectedMatter}/work-product/case-brief/finalize`, {
        method: 'POST'
      });
      if (!res.ok) throw new Error("Failed to finalize case brief");
      setActiveTab('VERSIONS');
    } catch (e: any) {
      setError(e.message || "Failed to finalize case brief");
    } finally {
      setLoading(false);
    }
  }

  async function saveReview(findingType: string, findingId: string, state: string, note: string) {
    try {
      const res = await apiFetch(`/api/professional-workspace/matters/${selectedMatter}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ findingType, findingId, reviewState: state, reviewNote: note })
      });
      if (res.status === 401 || res.status === 403) {
        setAccessDenied(true);
        return;
      }
      if (!res.ok) throw new Error("Failed to save review");
      loadIntelligence(activeTab);
    } catch(e: any) {
      setError(e.message || "Failed to save review");
    }
  }

  async function viewSourceJumpBack(evidenceId: string, quote?: string) {
    setSourceLoading(true);
    setSourceError('');
    setActiveSource(null);
    setHighlightQuote(quote || '');
    try {
      const res = await apiFetch(`/api/professional-workspace/matters/${selectedMatter}/evidence/${evidenceId}/source`);
      if (!res.ok) throw new Error("Source text not available for this item");
      const data = await res.json();
      setActiveSource(data);
    } catch (e: any) {
      setSourceError(e.message || "Could not retrieve source page");
    } finally {
      setSourceLoading(false);
    }
  }

  const selectedMatterObj = matters.find(m => m.id === selectedMatter);

  return (
    <main className="max-w-7xl mx-auto px-4 py-8" aria-labelledby="workspace-title">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between border-b pb-6 mb-6">
        <div>
          <h1 id="workspace-title" className="text-3xl font-bold text-slate-900">Professional Matter Workspace</h1>
          <p className="text-slate-600 mt-1">Review matter intelligence, inspect document inventory, and record professional dispositions.</p>
        </div>
        {selectedMatterObj && (
          <div className="mt-4 md:mt-0 bg-indigo-50 border border-indigo-200 px-4 py-2 rounded-lg text-sm text-indigo-900">
            <span className="font-semibold">Access Status:</span> Active ({selectedMatterObj.role || 'Authorized Reviewer'})
          </div>
        )}
      </div>
      
      {error && <div role="alert" className="p-4 bg-red-50 text-red-900 rounded-lg mb-6 border border-red-200">{error}</div>}
      {accessDenied && (
        <div role="alert" className="p-6 bg-red-50 border border-red-200 rounded-xl mb-6 text-red-950">
          <h2 className="text-lg font-bold">Access Denied or Revoked</h2>
          <p className="mt-1 text-sm">Your reviewer access to this matter is not authorized or has been revoked by the matter owner.</p>
        </div>
      )}

      {/* Matter Selector */}
      <section aria-label="Matter selection" className="mb-6 bg-white p-4 border rounded-xl shadow-xs">
        <label htmlFor="matter-select" className="font-semibold block mb-2 text-slate-900">Authorized Matter</label>
        {mattersLoading ? (
          <p role="status" className="text-sm text-slate-500">Loading authorized matters...</p>
        ) : matters.length === 0 ? (
          <p className="text-slate-600 text-sm italic p-2 bg-slate-50 rounded border">No authorized matters available. If a parent sent you an invitation, please ensure you have accepted it with your verified email address.</p>
        ) : (
          <select 
            id="matter-select"
            className="border rounded-lg p-2.5 w-full max-w-lg bg-white text-slate-900 font-medium focus:ring-2 focus:ring-indigo-500 focus:outline-hidden"
            value={selectedMatter}
            onChange={e => setSelectedMatter(e.target.value)}
          >
            {matters.map(m => (
              <option key={m.id} value={m.id}>
                {m.title || 'Untitled Matter'} ({m.role === 'OWNER' ? 'Owner' : 'Reviewer'})
              </option>
            ))}
          </select>
        )}
      </section>

      {/* Workspace Tabs & Body */}
      {selectedMatter && !accessDenied && (
        <div className="border rounded-xl bg-white overflow-hidden shadow-xs">
          <div role="tablist" aria-label="Matter Workspace Sections" className="flex border-b bg-slate-50 overflow-x-auto">
            {[
              { id: 'OVERVIEW', label: 'Overview' },
              { id: 'DOCUMENTS', label: 'Documents' },
              { id: 'EVIDENCE', label: 'Evidence Review' },
              { id: 'CHRONOLOGY', label: 'Chronology' },
              { id: 'CLAIMS', label: 'Claims' },
              { id: 'RELATIONSHIPS', label: 'Relationships' },
              { id: 'GAPS', label: 'Evidence Gaps' },
              { id: 'LEGAL', label: 'Case Snapshots' },
              { id: 'LEGAL_DISCOVERY', label: 'Legal Research' },
              { id: 'CASE_BRIEF', label: 'Case Brief' },
              { id: 'OUTPUTS', label: 'Review-Ready Exports' },
              { id: 'VERSIONS', label: 'Versions' }
            ].map(tab => (
              <button
                key={tab.id}
                role="tab"
                id={`tab-${tab.id}`}
                aria-selected={activeTab === tab.id}
                aria-controls={`panel-${tab.id}`}
                className={`px-4 py-3 text-sm font-semibold whitespace-nowrap transition-colors ${activeTab === tab.id ? 'border-b-2 border-indigo-600 text-indigo-700 bg-white' : 'text-slate-600 hover:bg-slate-100'}`}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div id={`panel-${activeTab}`} role="tabpanel" aria-labelledby={`tab-${activeTab}`} className="p-6 min-h-[420px]">
            {loading && <div role="status" className="p-8 text-center text-slate-500 font-medium">Loading section data...</div>}
            
            {/* OVERVIEW TAB */}
            {!loading && activeTab === 'OVERVIEW' && overview && (
              <div>
                <h2 className="text-xl font-bold text-slate-900 mb-2">Matter Overview & Context</h2>
                <p className="text-slate-600 text-sm mb-6">Matter identity: <code className="bg-slate-100 px-2 py-0.5 rounded text-slate-800">{selectedMatter}</code></p>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200"><div className="text-2xl font-bold text-slate-900">{overview.documents}</div><div className="text-sm font-medium text-slate-600">Documents</div></div>
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200"><div className="text-2xl font-bold text-slate-900">{overview.chronologyEvents}</div><div className="text-sm font-medium text-slate-600">Chronology Events</div></div>
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200"><div className="text-2xl font-bold text-slate-900">{overview.claims}</div><div className="text-sm font-medium text-slate-600">Claims</div></div>
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200"><div className="text-2xl font-bold text-slate-900">{overview.relationships}</div><div className="text-sm font-medium text-slate-600">Relationships</div></div>
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200"><div className="text-2xl font-bold text-slate-900">{overview.evidenceGaps}</div><div className="text-sm font-medium text-slate-600">Evidence Gaps</div></div>
                  <div className="bg-slate-50 p-4 rounded-xl border border-slate-200"><div className="text-2xl font-bold text-slate-900">{overview.legalIssues}</div><div className="text-sm font-medium text-slate-600">Legal Snapshots</div></div>
                  <div className="bg-indigo-50 p-4 rounded-xl border border-indigo-200"><div className="text-2xl font-bold text-indigo-700">{overview.reviewedItems}</div><div className="text-sm font-medium text-indigo-900">Items Reviewed by You</div></div>
                </div>
              </div>
            )}

            {/* DOCUMENTS INVENTORY TAB */}
            {!loading && activeTab === 'DOCUMENTS' && intelligence && (
              <div>
                <h2 className="text-xl font-bold text-slate-900 mb-2">Document Inventory</h2>
                <p className="text-sm text-slate-600 mb-6">Documents uploaded to this matter by the matter owner. Protected retrieval is matter-scoped.</p>
                {intelligence.items.length === 0 ? (
                  <p className="text-slate-500 italic p-6 border rounded-xl bg-slate-50">No uploaded documents found for this matter.</p>
                ) : (
                  <div className="space-y-3">
                    {intelligence.items.map((doc: any) => (
                      <div key={doc.id} className="border p-4 rounded-xl bg-white flex flex-col md:flex-row md:items-center justify-between gap-4">
                        <div>
                          <h3 className="font-semibold text-slate-900 text-base">{doc.display_name || doc.title || 'Uploaded Document'}</h3>
                          <p className="text-xs text-slate-500 mt-1 font-mono">ID: {doc.id} · Added {doc.created_at ? new Date(doc.created_at).toLocaleDateString() : 'N/A'}</p>
                        </div>
                        <button 
                          onClick={() => setActiveTab('EVIDENCE')}
                          className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 self-start md:self-center"
                        >
                          View Extracted Evidence →
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* INTELLIGENCE CATEGORIES TABS */}
            {!loading && ['EVIDENCE', 'CHRONOLOGY', 'CLAIMS', 'RELATIONSHIPS', 'GAPS', 'LEGAL'].includes(activeTab) && intelligence && (
              <div>
                <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between mb-4">
                  <h2 className="text-xl font-bold text-slate-900">{activeTab} Intelligence</h2>
                  <span className="text-xs font-semibold px-2.5 py-1 bg-amber-100 text-amber-900 rounded-full w-fit mt-2 sm:mt-0">
                    AI Analysis vs Professional Disposition
                  </span>
                </div>
                <p className="text-xs text-slate-600 bg-slate-50 p-3 rounded-lg border mb-6">
                  <strong>Boundary Rule:</strong> Extractions displayed below are automated AI findings. Professional review sets a separate disposition state and note without altering machine data or creating autonomous legal conclusions.
                </p>

                {intelligence.items.length === 0 ? (
                  <p className="text-slate-500 italic p-6 border rounded-xl bg-slate-50">No items found in this category for the selected matter.</p>
                ) : (
                  <ul className="space-y-5">
                    {intelligence.items.map((item: any) => {
                      const review = intelligence.reviews.find((r: any) => r.finding_id === item.id);
                      const hasSourceProvenance = Boolean(item.document_id || item.page_id || item.exact_quote);

                      return (
                        <li key={item.id} className="border rounded-xl p-5 bg-white shadow-2xs space-y-4">
                          {/* Machine Content Header */}
                          <div className="flex items-start justify-between gap-2 border-b pb-3">
                            <div>
                              <div className="flex items-center gap-2">
                                <span className="text-xs font-mono font-bold uppercase tracking-wider px-2 py-0.5 bg-slate-100 text-slate-700 rounded">
                                  AI Extraction
                                </span>
                                {item.classification && (
                                  <span className="text-xs font-semibold px-2 py-0.5 bg-indigo-50 text-indigo-700 rounded">
                                    {item.classification}
                                  </span>
                                )}
                              </div>
                              <p className="mt-2 text-slate-900 font-medium text-base">
                                {item.normalized_statement || item.title || item.event_title || item.description || item.claim_description || JSON.stringify(item)}
                              </p>
                            </div>
                          </div>

                          {/* Source Provenance details */}
                          {hasSourceProvenance && (
                            <div className="bg-slate-50 p-3 rounded-lg border border-slate-200 text-xs text-slate-700 space-y-1.5">
                              <div className="font-semibold text-slate-900">Source Provenance:</div>
                              {item.document_name && <div>Document: <span className="font-medium">{item.document_name}</span></div>}
                              {item.page_number && <div>Page: <span className="font-medium">{item.page_number}</span></div>}
                              {item.exact_quote && (
                                <blockquote className="border-l-3 border-indigo-400 pl-2 text-slate-800 italic mt-1 bg-white p-2 rounded">
                                  "{item.exact_quote}"
                                </blockquote>
                              )}
                              {item.quote_verification && <div>Quote Verification: <code className="text-indigo-800 font-mono">{item.quote_verification}</code></div>}

                              <button
                                onClick={() => viewSourceJumpBack(item.id, item.exact_quote)}
                                className="mt-2 px-3 py-1 bg-white border border-indigo-300 text-indigo-700 font-semibold rounded text-xs hover:bg-indigo-50 transition-colors"
                              >
                                Jump to Source Text →
                              </button>
                            </div>
                          )}

                          {/* Professional Review Disposition controls */}
                          <div className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-3">
                            <h4 className="font-bold text-xs uppercase tracking-wider text-slate-700">Professional Review & Disposition</h4>
                            <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-center">
                              <label htmlFor={`review-select-${item.id}`} className="sr-only">Review State</label>
                              <select 
                                id={`review-select-${item.id}`}
                                className="border rounded-lg p-2 text-sm bg-white font-medium text-slate-800 focus:ring-2 focus:ring-indigo-500"
                                value={review?.review_state || 'UNREVIEWED'}
                                onChange={(e) => saveReview(activeTab, item.id, e.target.value, review?.review_note || '')}
                              >
                                <option value="UNREVIEWED">Unreviewed</option>
                                <option value="CONFIRMED_RELEVANT">Confirmed Relevant</option>
                                <option value="POSSIBLY_RELEVANT">Possibly Relevant</option>
                                <option value="NOT_RELEVANT">Not Relevant</option>
                                <option value="REQUIRES_RESEARCH">Requires Research</option>
                                <option value="SUPERSEDED">Superseded</option>
                              </select>
                              <span className="text-xs text-slate-500">
                                {review ? `Last saved ${new Date(review.updated_at).toLocaleString()}` : 'No review recorded yet'}
                              </span>
                            </div>
                            <div>
                              <label htmlFor={`review-note-${item.id}`} className="block text-xs font-semibold text-slate-700 mb-1">Professional Notes</label>
                              <input 
                                id={`review-note-${item.id}`}
                                type="text"
                                placeholder="Add optional lawyer work-product note..."
                                className="w-full border rounded-lg p-2 text-sm bg-white text-slate-900"
                                defaultValue={review?.review_note || ''}
                                onBlur={(e) => {
                                  if (e.target.value !== (review?.review_note || '')) {
                                    saveReview(activeTab, item.id, review?.review_state || 'UNREVIEWED', e.target.value);
                                  }
                                }}
                              />
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}

            {/* LEGAL DISCOVERY TAB */}
            {activeTab === 'LEGAL_DISCOVERY' && (
              <LegalDiscoveryTab matterId={selectedMatter} />
            )}

            {/* CASE BRIEF TAB */}
            {!loading && activeTab === 'CASE_BRIEF' && caseBrief && (
              <CaseBriefViewer 
                caseBrief={caseBrief} 
                onRefresh={() => loadIntelligence('CASE_BRIEF')}
                onFinalize={handleFinalize}
              />
            )}

            {/* REVIEW-READY OUTPUTS TAB */}
            {activeTab === 'OUTPUTS' && (
              <ProfessionalOutputsViewer matterId={selectedMatter} />
            )}

            {/* VERSIONS TAB */}
            {!loading && activeTab === 'VERSIONS' && (
              <div>
                {selectedVersionData ? (
                  <div>
                    <button onClick={() => setSelectedVersionData(null)} className="mb-4 text-indigo-600 font-semibold text-sm hover:underline">← Back to Versions List</button>
                    <CaseBriefViewer 
                      caseBrief={selectedVersionData.snapshot} 
                      onRefresh={() => {}}
                      isFinalized={true}
                      versionNumber={selectedVersionData.version_number}
                      finalizedAt={selectedVersionData.finalized_at}
                    />
                  </div>
                ) : (
                  <div>
                    <h2 className="text-xl font-bold text-slate-900 mb-4">Finalized Case Brief Snapshots</h2>
                    {versions.length === 0 ? (
                      <p className="text-slate-500 italic p-6 border rounded-xl bg-slate-50">No finalized versions found for this matter.</p>
                    ) : (
                      <ul className="space-y-3">
                        {versions.map(v => (
                          <li key={v.id} className="p-4 border rounded-xl bg-slate-50 flex justify-between items-center">
                            <div>
                              <p className="font-semibold text-slate-900 text-lg">Version {v.version_number}</p>
                              <p className="text-xs text-slate-500">Finalized at: {new Date(v.finalized_at).toLocaleString()}</p>
                            </div>
                            <button 
                              className="bg-indigo-100 text-indigo-700 px-4 py-2 rounded-lg text-sm font-semibold hover:bg-indigo-200 transition-colors"
                              onClick={() => loadVersion(v.id)}
                            >
                              View Snapshot
                            </button>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Source Jump-Back Overlay Drawer / Modal */}
      {(sourceLoading || activeSource || sourceError) && (
        <div className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-2xl max-w-3xl w-full p-6 max-h-[85vh] overflow-y-auto shadow-2xl border border-slate-200">
            <div className="flex justify-between items-center border-b pb-4 mb-4">
              <h3 className="text-lg font-bold text-slate-900">Source Document Page Text</h3>
              <button 
                onClick={() => { setActiveSource(null); setSourceError(''); setSourceLoading(false); }}
                className="text-slate-400 hover:text-slate-700 font-bold p-1 rounded text-xl"
                aria-label="Close source view"
              >
                ×
              </button>
            </div>

            {sourceLoading && <p className="text-slate-500 p-4 italic">Fetching source page text...</p>}
            {sourceError && <p className="text-red-700 bg-red-50 p-4 rounded-lg text-sm">{sourceError}</p>}
            
            {activeSource && activeSource.page && (
              <div className="space-y-4">
                <div className="text-xs text-slate-600 flex justify-between bg-slate-50 p-3 rounded-lg border">
                  <span>Page Number: <strong>{activeSource.page.page_number}</strong></span>
                  <span className="font-mono">Page ID: {activeSource.page.id}</span>
                </div>

                <div className="border rounded-xl p-4 bg-slate-50 max-h-96 overflow-y-auto">
                  <h4 className="text-xs font-bold text-slate-700 uppercase mb-2">Original Extracted Page Text:</h4>
                  <pre className="whitespace-pre-wrap text-sm leading-relaxed font-sans text-slate-900 bg-white p-4 rounded-lg border border-slate-200">
                    {activeSource.page.text}
                  </pre>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </main>
  );
}
