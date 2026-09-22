import React, { useState, useEffect, useRef } from 'react';
import { apiFetch } from '../utils/api';
import CaseBriefViewer from './CaseBriefViewer';
import LegalDiscoveryTab from './LegalDiscoveryTab';

export default function ProfessionalWorkspace() {
  const [matters, setMatters] = useState<{id: string; title: string}[]>([]);
  const [selectedMatter, setSelectedMatter] = useState<string>('');
  const [overview, setOverview] = useState<any>(null);
  const [activeTab, setActiveTab] = useState<string>('OVERVIEW');
  const [intelligence, setIntelligence] = useState<any>(null);
  const [caseBrief, setCaseBrief] = useState<any>(null);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>('');

  const [versions, setVersions] = useState<any[]>([]);
  const [selectedVersionData, setSelectedVersionData] = useState<any>(null);

  useEffect(() => {
    loadMatters();
  }, []);

  useEffect(() => {
    if (selectedMatter) {
      loadOverview();
      setActiveTab('OVERVIEW');
    }
  }, [selectedMatter]);

  useEffect(() => {
    if (selectedMatter && activeTab !== 'OVERVIEW') {
      loadIntelligence(activeTab);
    }
  }, [selectedMatter, activeTab]);

  async function loadMatters() {
    try {
      const res = await apiFetch('/api/professional-workspace/matters');
      if (!res.ok) throw new Error("Failed to load professional matters");
      const data = await res.json();
      setMatters(data);
    } catch (e: any) {
      setError(e.message);
    }
  }

  async function loadOverview() {
    setLoading(true);
    try {
      const res = await apiFetch(`/api/professional-workspace/matters/${selectedMatter}/overview`);
      if (!res.ok) throw new Error("Failed to load overview");
      setOverview(await res.json());
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function loadIntelligence(tab: string) {
    setLoading(true);
    setIntelligence(null);
    let category = tab;
    if (tab === 'DOCUMENTS') category = 'DOCUMENTS'; // Though documents is just overview for now
    
    try {
      if (['EVIDENCE', 'CHRONOLOGY', 'CLAIMS', 'RELATIONSHIPS', 'GAPS', 'LEGAL'].includes(tab)) {
        const res = await apiFetch(`/api/professional-workspace/matters/${selectedMatter}/intelligence/${tab}`);
        if (!res.ok) throw new Error("Failed to load intelligence");
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
      setError(e.message);
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
      setError(e.message);
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
      // Go to VERSIONS tab to show the new version
      setActiveTab('VERSIONS');
    } catch (e: any) {
      setError(e.message);
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
      if (!res.ok) throw new Error("Failed to save review");
      loadIntelligence(activeTab);
    } catch(e: any) {
      setError(e.message);
    }
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-8">
      <h1 className="text-3xl font-bold">Professional Workspace</h1>
      <p className="text-slate-600 mt-2 mb-6">Review matter intelligence and record professional dispositions.</p>
      
      {error && <div className="p-3 bg-red-50 text-red-900 rounded mb-4">{error}</div>}

      <div className="mb-6">
        <label className="font-semibold block mb-2">Select Matter</label>
        <select 
          className="border rounded p-2 w-full max-w-md"
          value={selectedMatter}
          onChange={e => setSelectedMatter(e.target.value)}
        >
          <option value="">-- Choose a Matter --</option>
          {matters.map(m => (
            <option key={m.id} value={m.id}>{m.title || 'Untitled Matter'}</option>
          ))}
        </select>
      </div>

      {selectedMatter && (
        <div className="border rounded-lg bg-white overflow-hidden">
          <div className="flex border-b bg-slate-50 overflow-x-auto">
            {['OVERVIEW', 'EVIDENCE', 'CHRONOLOGY', 'CLAIMS', 'RELATIONSHIPS', 'GAPS', 'LEGAL', 'LEGAL_DISCOVERY', 'CASE_BRIEF', 'VERSIONS'].map(tab => (
              <button
                key={tab}
                className={`px-4 py-3 text-sm font-semibold whitespace-nowrap ${activeTab === tab ? 'border-b-2 border-indigo-600 text-indigo-700' : 'text-slate-600 hover:bg-slate-100'}`}
                onClick={() => setActiveTab(tab)}
              >
                {tab.replace('_', ' ')}
              </button>
            ))}
          </div>

          <div className="p-6 min-h-[400px]">
            {loading && <p>Loading...</p>}
            
            {!loading && activeTab === 'OVERVIEW' && overview && (
              <div>
                <h2 className="text-xl font-bold mb-4">Matter Overview</h2>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  <div className="bg-slate-50 p-4 rounded border"><div className="text-2xl font-bold">{overview.documents}</div><div className="text-sm">Documents</div></div>
                  <div className="bg-slate-50 p-4 rounded border"><div className="text-2xl font-bold">{overview.chronologyEvents}</div><div className="text-sm">Chronology Events</div></div>
                  <div className="bg-slate-50 p-4 rounded border"><div className="text-2xl font-bold">{overview.claims}</div><div className="text-sm">Claims</div></div>
                  <div className="bg-slate-50 p-4 rounded border"><div className="text-2xl font-bold">{overview.relationships}</div><div className="text-sm">Relationships</div></div>
                  <div className="bg-slate-50 p-4 rounded border"><div className="text-2xl font-bold">{overview.evidenceGaps}</div><div className="text-sm">Evidence Gaps</div></div>
                  <div className="bg-slate-50 p-4 rounded border"><div className="text-2xl font-bold">{overview.legalIssues}</div><div className="text-sm">Legal Issues</div></div>
                  <div className="bg-slate-50 p-4 rounded border"><div className="text-2xl font-bold text-indigo-600">{overview.reviewedItems}</div><div className="text-sm">Items Reviewed by You</div></div>
                </div>
              </div>
            )}

            {!loading && activeTab !== 'OVERVIEW' && activeTab !== 'CASE_BRIEF' && activeTab !== 'VERSIONS' && intelligence && (
              <div>
                <h2 className="text-xl font-bold mb-4">{activeTab} Intelligence</h2>
                <p className="text-sm text-amber-700 bg-amber-50 p-2 rounded mb-4">
                  <strong>Machine Finding vs Professional Review:</strong> The items below are machine-generated extractions. Professional review sets a separate status and does not alter the underlying extraction.
                </p>
                {intelligence.items.length === 0 ? (
                  <p className="text-slate-500 italic">No records found for this category.</p>
                ) : (
                  <ul className="space-y-4">
                    {intelligence.items.map((item: any) => {
                      const review = intelligence.reviews.find((r: any) => r.finding_id === item.id);
                      return (
                        <li key={item.id} className="border p-4 rounded">
                          <pre className="text-sm whitespace-pre-wrap font-sans mb-3">{JSON.stringify(item, null, 2)}</pre>
                          
                          <div className="bg-slate-50 p-3 rounded border">
                            <h4 className="font-semibold text-sm mb-2">Professional Disposition</h4>
                            <div className="flex gap-2">
                              <select 
                                className="border p-1 text-sm rounded"
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
                              <span className="text-xs text-slate-500 self-center">
                                {review ? `Reviewed on ${new Date(review.updated_at).toLocaleString()}` : 'No review record'}
                              </span>
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            )}
            {activeTab === 'LEGAL_DISCOVERY' && (
              <LegalDiscoveryTab matterId={selectedMatter} />
            )}
            {!loading && activeTab === 'CASE_BRIEF' && caseBrief && (
              <CaseBriefViewer 
                caseBrief={caseBrief} 
                onRefresh={() => loadIntelligence('CASE_BRIEF')}
                onFinalize={handleFinalize}
              />
            )}
            {!loading && activeTab === 'VERSIONS' && (
              <div>
                {selectedVersionData ? (
                  <div>
                    <button onClick={() => setSelectedVersionData(null)} className="mb-4 text-indigo-600 hover:underline">← Back to Versions</button>
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
                    <h2 className="text-xl font-bold mb-4">Finalized Versions</h2>
                    {versions.length === 0 ? (
                      <p className="text-slate-500 italic">No finalized versions found.</p>
                    ) : (
                      <ul className="space-y-3">
                        {versions.map(v => (
                          <li key={v.id} className="p-4 border rounded bg-slate-50 flex justify-between items-center">
                            <div>
                              <p className="font-semibold text-lg">Version {v.version_number}</p>
                              <p className="text-sm text-slate-500">Finalized at: {new Date(v.finalized_at).toLocaleString()}</p>
                            </div>
                            <button 
                              className="bg-indigo-100 text-indigo-700 px-3 py-1.5 rounded font-medium hover:bg-indigo-200"
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
    </div>
  );
}
