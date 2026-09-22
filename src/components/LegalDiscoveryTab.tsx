import React, { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../utils/api';
import { isSafeWebsiteUrl } from '../utils/urlValidator';

// Stage 9D-3: professional-facing legal research workspace UI, built on the frozen, independently
// audited Stage 9D-2 discovery API (api/matterLegalDiscoveryRoutes.ts, unmodified). This component
// never re-ranks, re-sorts or re-derives any trust-sensitive value: authority verification state,
// content-integrity status and ranking order all come verbatim from the server. Language is kept
// non-conclusory throughout -- results are "potentially relevant" and "machine-discovered", never
// "applicable law" or a "legal violation". All matter/candidate/ranking text is rendered as plain
// React text (never dangerouslySetInnerHTML), so untrusted content (including prompt-injection-
// style text) can never execute -- it is always inert.

const REVIEW_STATES = [
  { value: 'UNREVIEWED', label: 'Unreviewed' },
  { value: 'CONFIRMED_RELEVANT', label: 'Confirmed Relevant' },
  { value: 'POSSIBLY_RELEVANT', label: 'Possibly Relevant' },
  { value: 'NOT_RELEVANT', label: 'Not Relevant' },
  { value: 'REQUIRES_RESEARCH', label: 'Requires Research' },
  { value: 'SUPERSEDED', label: 'Superseded' }
];

const FINDING_TYPE = 'LEGAL_RESEARCH_RESULT';

function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    PENDING: 'bg-slate-100 text-slate-700 border-slate-300',
    RUNNING: 'bg-blue-100 text-blue-800 border-blue-300',
    COMPLETED: 'bg-emerald-100 text-emerald-800 border-emerald-300',
    FAILED: 'bg-red-100 text-red-800 border-red-400'
  };
  const labels: Record<string, string> = {
    PENDING: 'Pending',
    RUNNING: 'Running',
    COMPLETED: 'Completed',
    FAILED: 'Failed'
  };
  return (
    <span
      role="status"
      className={`inline-block px-2 py-0.5 rounded border text-xs font-semibold ${styles[status] || 'bg-slate-100 text-slate-700 border-slate-300'}`}
    >
      {labels[status] || status}
    </span>
  );
}

export default function LegalDiscoveryTab({ matterId }: { matterId: string }) {
  const [runs, setRuns] = useState<any[]>([]);
  const [selectedRunId, setSelectedRunId] = useState<string>('');
  const [selectedRun, setSelectedRun] = useState<any>(null);
  const [results, setResults] = useState<any[]>([]);
  const [candidatesById, setCandidatesById] = useState<Record<string, any>>({});
  const [reviewsByFindingId, setReviewsByFindingId] = useState<Record<string, any>>({});
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [loadingResults, setLoadingResults] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState('');

  const loadRuns = useCallback(async () => {
    setLoadingRuns(true);
    try {
      const res = await apiFetch(`/api/matters/${matterId}/legal-discovery/runs`);
      if (res.status === 401 || res.status === 403) {
        setError('You are not authorized to view legal research for this matter.');
        setRuns([]);
        return;
      }
      if (!res.ok) throw new Error('Failed to load discovery run history.');
      const data = await res.json();
      setRuns(data.runs || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load discovery run history.');
    } finally {
      setLoadingRuns(false);
    }
  }, [matterId]);

  const loadCandidates = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/matters/${matterId}/legal-research/candidates`);
      if (!res.ok) return;
      const data = await res.json();
      const map: Record<string, any> = {};
      for (const c of data.candidates || []) map[c.id] = c;
      setCandidatesById(map);
    } catch {
      // Non-fatal: results still render with candidate-derived fields absent.
    }
  }, [matterId]);

  const loadReviews = useCallback(async () => {
    try {
      const res = await apiFetch(`/api/professional-workspace/matters/${matterId}/reviews/${FINDING_TYPE}`);
      if (!res.ok) return;
      const data = await res.json();
      const map: Record<string, any> = {};
      for (const r of data || []) map[r.finding_id] = r;
      setReviewsByFindingId(map);
    } catch {
      // Non-fatal: review UI falls back to "no review record".
    }
  }, [matterId]);

  const loadResults = useCallback(async (runId: string) => {
    if (!runId) {
      setResults([]);
      setSelectedRun(null);
      return;
    }
    setLoadingResults(true);
    try {
      const res = await apiFetch(`/api/matters/${matterId}/legal-discovery/runs/${runId}/results`);
      if (res.status === 401 || res.status === 403) {
        setError('You are not authorized to view legal research for this matter.');
        return;
      }
      if (res.status === 404) {
        setError('That discovery run could not be found.');
        return;
      }
      if (!res.ok) throw new Error('Failed to load discovery results.');
      const data = await res.json();
      setSelectedRun(data.run);
      // Server-provided order is preserved verbatim -- never re-sorted client-side.
      setResults(data.results || []);
    } catch (e: any) {
      setError(e.message || 'Failed to load discovery results.');
    } finally {
      setLoadingResults(false);
    }
  }, [matterId]);

  useEffect(() => {
    setRuns([]);
    setSelectedRunId('');
    setSelectedRun(null);
    setResults([]);
    setCandidatesById({});
    setReviewsByFindingId({});
    setError('');
    if (matterId) {
      loadRuns();
      loadCandidates();
      loadReviews();
    }
  }, [matterId, loadRuns, loadCandidates, loadReviews]);

  useEffect(() => {
    if (runs.length > 0 && !selectedRunId) {
      // Most-recently-created run first, by createdAt.
      const mostRecent = [...runs].sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))[0];
      setSelectedRunId(mostRecent.id);
    }
  }, [runs, selectedRunId]);

  useEffect(() => {
    if (selectedRunId) loadResults(selectedRunId);
  }, [selectedRunId, loadResults]);

  async function startDiscovery() {
    if (starting) return; // duplicate-submission prevention
    setStarting(true);
    setError('');
    try {
      const res = await apiFetch(`/api/matters/${matterId}/legal-discovery/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ triggerType: 'MANUAL' })
      });
      if (!res.ok) {
        // The frozen 9D-2b route can fail generically even though a run was created and
        // persisted as FAILED. We must not assume failure means no run exists -- always
        // refetch run history regardless of outcome.
        setError('Starting legal research failed. Checking run history for what was recorded...');
        await loadRuns();
        return;
      }
      const data = await res.json();
      await loadRuns();
      if (data.run?.id) {
        setSelectedRunId(data.run.id);
        await loadResults(data.run.id);
      }
      await loadCandidates();
    } catch (e: any) {
      setError('Starting legal research failed. Checking run history for what was recorded...');
      await loadRuns();
    } finally {
      setStarting(false);
    }
  }

  async function saveReview(findingId: string, reviewState: string) {
    try {
      const res = await apiFetch(`/api/professional-workspace/matters/${matterId}/review`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ findingType: FINDING_TYPE, findingId, reviewState, reviewNote: null })
      });
      if (!res.ok) throw new Error('Failed to save professional review.');
      await loadReviews();
    } catch (e: any) {
      setError(e.message || 'Failed to save professional review.');
    }
  }

  if (!matterId) return null;

  return (
    <div data-testid="legal-discovery-tab">
      <h2 className="text-xl font-bold mb-2">Legal Research Discovery</h2>
      <p className="text-sm text-slate-600 mb-4">
        Machine-discovered, potentially relevant authorities for this matter. Discovery never
        produces a legal conclusion; every result requires independent professional judgment.
      </p>

      <div className="mb-4">
        <button
          type="button"
          className="bg-indigo-600 text-white px-4 py-2 rounded font-semibold disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={startDiscovery}
          disabled={starting}
        >
          {starting ? 'Starting discovery...' : 'Start Legal Discovery'}
        </button>
      </div>

      {error && (
        <div role="alert" className="p-3 bg-red-50 text-red-900 rounded mb-4 text-sm">
          {error}
        </div>
      )}

      <div>
        <h3 className="font-semibold text-sm mb-2">Run History</h3>
        {loadingRuns && <p className="text-sm text-slate-500">Loading run history...</p>}
        {!loadingRuns && runs.length === 0 && (
          <p className="text-slate-500 italic text-sm">No discovery runs yet for this matter.</p>
        )}
        {!loadingRuns && runs.length > 0 && (
          <ul className="space-y-2 mb-6">
            {[...runs]
              .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
              .map((run) => (
                <li key={run.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedRunId(run.id)}
                    aria-pressed={selectedRunId === run.id}
                    className={`w-full text-left border rounded p-2 flex items-center justify-between gap-3 ${selectedRunId === run.id ? 'border-indigo-500 bg-indigo-50' : 'border-slate-200 bg-white'}`}
                  >
                    <span className="text-sm">
                      Run {run.id.slice(0, 8)} &middot; {run.triggerType}
                      {run.completedAt ? ` · completed ${new Date(run.completedAt).toLocaleString()}` : ''}
                    </span>
                    <StatusBadge status={run.status} />
                  </button>
                </li>
              ))}
          </ul>
        )}
      </div>

      {selectedRunId && (
        <div>
          <div className="flex items-center gap-3 mb-3">
            <h3 className="font-semibold text-sm">Discovered Authorities</h3>
            {selectedRun && <StatusBadge status={selectedRun.status} />}
          </div>

          {selectedRun?.status === 'FAILED' && (
            <p className="text-sm text-red-800 bg-red-50 border border-red-300 rounded p-2 mb-3">
              This discovery run failed. Any results below were persisted before the failure and
              are <strong>not</strong> a complete result set for this run.
            </p>
          )}

          {loadingResults && <p className="text-sm text-slate-500">Loading results...</p>}

          {!loadingResults && selectedRun?.status === 'COMPLETED' && results.length === 0 && (
            <p className="text-slate-500 italic text-sm">
              This run completed and discovered no potentially relevant authorities.
            </p>
          )}

          {!loadingResults && results.length > 0 && (
            <ul className="space-y-4" data-testid="discovery-results-list">
              {results.map((result) => {
                const candidate = candidatesById[result.candidateId];
                const review = reviewsByFindingId[result.id];
                const factors = result.rankingFactors || {};
                const matchedTerms: string[] = factors.matchedTerms || [];
                const contextMatches: any[] = factors.contextMatches || [];
                const limitations: string[] = factors.limitations || [];

                return (
                  <li key={result.id} className="border rounded-lg overflow-hidden">
                    <div className="p-4 bg-white">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="inline-block px-2 py-0.5 rounded border text-xs font-semibold bg-slate-100 text-slate-700 border-slate-300">
                          Machine-discovered
                        </span>
                        <span className="inline-block px-2 py-0.5 rounded border text-xs font-semibold bg-slate-50 text-slate-600 border-slate-200">
                          {result.discoveryStatus}
                        </span>
                        {candidate?.evidenceClassification && (
                          <span className="inline-block px-2 py-0.5 rounded border text-xs font-semibold bg-amber-50 text-amber-800 border-amber-300">
                            Matter context: {candidate.evidenceClassification}
                          </span>
                        )}
                      </div>

                      <h4 className="font-semibold text-sm mb-1">Potentially relevant authority</h4>
                      <p className="text-sm text-slate-800 mb-2">
                        {candidate?.authorityIdentifier || 'Authority identifier not yet available.'}
                      </p>

                      <div className="text-xs text-slate-600 space-y-1 mb-3">
                        <div>
                          Verified source text integrity:{' '}
                          <strong>{candidate?.contentIntegrityStatus || 'UNKNOWN'}</strong>
                        </div>
                        {candidate?.sourceProvenance && isSafeWebsiteUrl(candidate.sourceProvenance) && (
                          <div>
                            Source:{' '}
                            <a
                              href={candidate.sourceProvenance}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-indigo-600 underline"
                            >
                              {candidate.sourceProvenance}
                            </a>
                          </div>
                        )}
                        {typeof result.rankingScore === 'number' && (
                          <div>Match score: {result.rankingScore.toFixed(2)}</div>
                        )}
                      </div>

                      <details className="text-xs bg-slate-50 border border-slate-200 rounded p-2">
                        <summary className="cursor-pointer font-semibold text-slate-700">
                          Why this surfaced
                        </summary>
                        <div className="mt-2 space-y-1 text-slate-700">
                          {matchedTerms.length > 0 && (
                            <p>Matched terms: {matchedTerms.join(', ')}</p>
                          )}
                          {contextMatches.length > 0 && (
                            <p>
                              Matched against {contextMatches.length} matter-context item
                              {contextMatches.length === 1 ? '' : 's'} ({contextMatches
                                .map((cm) => cm.sourceType)
                                .join(', ')}).
                            </p>
                          )}
                          {limitations.length > 0 && (
                            <p className="text-amber-700">Limitations: {limitations.join(' ')}</p>
                          )}
                          {factors.algorithmVersion && (
                            <p className="text-slate-500">Method: {factors.algorithmVersion}</p>
                          )}
                        </div>
                      </details>
                    </div>

                    <div className="p-3 bg-indigo-50 border-t border-indigo-200" data-testid="professional-review-box">
                      <h5 className="font-semibold text-xs mb-2 text-indigo-900">
                        Professional Review (human, separate from machine discovery)
                      </h5>
                      <div className="flex items-center gap-2 flex-wrap">
                        <label className="sr-only" htmlFor={`review-${result.id}`}>
                          Professional review status
                        </label>
                        <select
                          id={`review-${result.id}`}
                          className="border p-1 text-sm rounded"
                          value={review?.review_state || 'UNREVIEWED'}
                          onChange={(e) => saveReview(result.id, e.target.value)}
                        >
                          {REVIEW_STATES.map((s) => (
                            <option key={s.value} value={s.value}>{s.label}</option>
                          ))}
                        </select>
                        <span className="text-xs text-slate-600">
                          {review ? `Reviewed ${new Date(review.updated_at).toLocaleString()}` : 'No review record'}
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
    </div>
  );
}
