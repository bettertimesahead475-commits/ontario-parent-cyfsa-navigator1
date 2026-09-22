/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import LegalDiscoveryTab from './LegalDiscoveryTab';

const mockApiFetch = vi.fn();
vi.mock('../utils/api', () => ({
  apiFetch: (...args: any[]) => mockApiFetch(...args)
}));

const MATTER_A = '11111111-1111-1111-1111-111111111111';
const MATTER_B = '22222222-2222-2222-2222-222222222222';

function jsonResponse(status: number, body: unknown) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function defaultRoute(url: string) {
  if (url.includes('/legal-discovery/runs') && !url.includes('/results')) {
    return jsonResponse(200, { runs: [] });
  }
  if (url.includes('/legal-research/candidates')) {
    return jsonResponse(200, { candidates: [] });
  }
  if (url.includes('/reviews/')) {
    return jsonResponse(200, []);
  }
  return jsonResponse(200, {});
}

describe('Stage 9D-3 LegalDiscoveryTab', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockApiFetch.mockImplementation(async (url: string) => defaultRoute(url));
  });
  afterEach(() => cleanup());

  it('renders nothing without a matter context', () => {
    const { container } = render(<LegalDiscoveryTab matterId="" />);
    expect(container.querySelector('[data-testid="legal-discovery-tab"]')).toBeNull();
  });

  it('renders the empty (no runs yet) state for a matter', async () => {
    render(<LegalDiscoveryTab matterId={MATTER_A} />);
    await waitFor(() => {
      expect(screen.getByText('No discovery runs yet for this matter.')).toBeTruthy();
    });
  });

  it('start discovery calls the exact frozen POST route', async () => {
    mockApiFetch.mockImplementation(async (url: string, init?: any) => {
      if (init?.method === 'POST' && url === `/api/matters/${MATTER_A}/legal-discovery/runs`) {
        return jsonResponse(201, {
          run: { id: 'run-1', matterId: MATTER_A, triggerType: 'MANUAL', status: 'COMPLETED', createdAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:01:00Z' },
          resultCount: 0,
          results: []
        });
      }
      if (url.includes('/legal-discovery/runs') && !url.includes('/results')) {
        return jsonResponse(200, { runs: [{ id: 'run-1', matterId: MATTER_A, triggerType: 'MANUAL', status: 'COMPLETED', createdAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:01:00Z' }] });
      }
      if (url.includes('/results')) {
        return jsonResponse(200, { run: { id: 'run-1', status: 'COMPLETED' }, results: [] });
      }
      return defaultRoute(url);
    });

    render(<LegalDiscoveryTab matterId={MATTER_A} />);
    await waitFor(() => screen.getByText('Start Legal Discovery'));

    fireEvent.click(screen.getByText('Start Legal Discovery'));

    await waitFor(() => {
      expect(mockApiFetch).toHaveBeenCalledWith(
        `/api/matters/${MATTER_A}/legal-discovery/runs`,
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  it('prevents a duplicate start while a request is already in flight', async () => {
    let resolvePost: (v: any) => void = () => {};
    mockApiFetch.mockImplementation(async (url: string, init?: any) => {
      if (init?.method === 'POST') {
        return new Promise((resolve) => { resolvePost = resolve; });
      }
      return defaultRoute(url);
    });

    render(<LegalDiscoveryTab matterId={MATTER_A} />);
    await waitFor(() => screen.getByText('No discovery runs yet for this matter.'));

    const button = screen.getByText('Start Legal Discovery');
    fireEvent.click(button);
    await waitFor(() => expect(screen.getByText('Starting discovery...')).toBeTruthy());
    fireEvent.click(screen.getByText('Starting discovery...'));

    const postCalls = mockApiFetch.mock.calls.filter((c) => c[1]?.method === 'POST');
    expect(postCalls.length).toBe(1);

    resolvePost(jsonResponse(201, { run: { id: 'run-x', status: 'COMPLETED' }, resultCount: 0, results: [] }));
  });

  it('POST failure asymmetry: shows a safe error AND refetches run history (run may have persisted as FAILED)', async () => {
    let runsCallCount = 0;
    mockApiFetch.mockImplementation(async (url: string, init?: any) => {
      if (init?.method === 'POST') {
        return jsonResponse(500, { code: 'LEGAL_DISCOVERY_START_FAILED', error: 'Failed to start legal discovery.' });
      }
      if (url.includes('/legal-discovery/runs') && !url.includes('/results')) {
        runsCallCount += 1;
        return jsonResponse(200, {
          runs: runsCallCount > 1
            ? [{ id: 'run-persisted', matterId: MATTER_A, triggerType: 'MANUAL', status: 'FAILED', createdAt: '2026-01-01T00:00:00Z', completedAt: '2026-01-01T00:01:00Z' }]
            : []
        });
      }
      return defaultRoute(url);
    });

    render(<LegalDiscoveryTab matterId={MATTER_A} />);
    await waitFor(() => screen.getByText('No discovery runs yet for this matter.'));

    fireEvent.click(screen.getByText('Start Legal Discovery'));

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy();
    });
    // The POST failed, but run history was refetched and shows the persisted FAILED run --
    // never silently assumed that nothing was created.
    await waitFor(() => {
      expect(runsCallCount).toBeGreaterThan(1);
    });
    await waitFor(() => {
      expect(screen.getAllByText('Failed').length).toBeGreaterThan(0);
    });
  });

  it('renders PENDING/RUNNING/COMPLETED/FAILED runs distinctly', async () => {
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url.includes('/legal-discovery/runs') && !url.includes('/results')) {
        return jsonResponse(200, {
          runs: [
            { id: 'r-pending', matterId: MATTER_A, triggerType: 'MANUAL', status: 'PENDING', createdAt: '2026-01-01T00:00:00Z' },
            { id: 'r-running', matterId: MATTER_A, triggerType: 'MANUAL', status: 'RUNNING', createdAt: '2026-01-02T00:00:00Z' },
            { id: 'r-completed', matterId: MATTER_A, triggerType: 'MANUAL', status: 'COMPLETED', createdAt: '2026-01-03T00:00:00Z' },
            { id: 'r-failed', matterId: MATTER_A, triggerType: 'MANUAL', status: 'FAILED', createdAt: '2026-01-04T00:00:00Z' }
          ]
        });
      }
      if (url.includes('/results')) {
        return jsonResponse(200, { run: { id: 'r-failed', status: 'FAILED' }, results: [] });
      }
      return defaultRoute(url);
    });

    render(<LegalDiscoveryTab matterId={MATTER_A} />);
    await waitFor(() => {
      expect(screen.getByText('Pending')).toBeTruthy();
      expect(screen.getByText('Running')).toBeTruthy();
      expect(screen.getByText('Completed')).toBeTruthy();
      expect(screen.getAllByText('Failed').length).toBeGreaterThan(0);
    });
  });

  it('a FAILED run with partial persisted results stays visibly FAILED, not mistaken for complete', async () => {
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url.includes('/legal-discovery/runs') && !url.includes('/results')) {
        return jsonResponse(200, { runs: [{ id: 'r-failed', matterId: MATTER_A, triggerType: 'MANUAL', status: 'FAILED', createdAt: '2026-01-01T00:00:00Z' }] });
      }
      if (url.includes('/results')) {
        return jsonResponse(200, {
          run: { id: 'r-failed', status: 'FAILED' },
          results: [{ id: 'res-1', researchRunId: 'r-failed', matterId: MATTER_A, candidateId: 'cand-1', discoveryStatus: 'RANKED', rankingScore: 0.5, rankingFactors: { matchedTerms: ['a'], contextMatches: [], limitations: [] }, discoveredAt: '2026-01-01T00:00:00Z' }]
        });
      }
      return defaultRoute(url);
    });

    render(<LegalDiscoveryTab matterId={MATTER_A} />);
    await waitFor(() => {
      expect(screen.getByText(/This discovery run failed/)).toBeTruthy();
    });
    expect(screen.queryByText(/completed and discovered no/)).toBeNull();
  });

  it('completed run with zero matches renders an honest empty-results state', async () => {
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url.includes('/legal-discovery/runs') && !url.includes('/results')) {
        return jsonResponse(200, { runs: [{ id: 'r-done', matterId: MATTER_A, triggerType: 'MANUAL', status: 'COMPLETED', createdAt: '2026-01-01T00:00:00Z' }] });
      }
      if (url.includes('/results')) {
        return jsonResponse(200, { run: { id: 'r-done', status: 'COMPLETED' }, results: [] });
      }
      return defaultRoute(url);
    });

    render(<LegalDiscoveryTab matterId={MATTER_A} />);
    await waitFor(() => {
      expect(screen.getByText('This run completed and discovered no potentially relevant authorities.')).toBeTruthy();
    });
  });

  it('preserves server-provided result order and never re-sorts client-side', async () => {
    const orderA = [
      { id: 'res-1', researchRunId: 'r1', matterId: MATTER_A, candidateId: 'cand-1', discoveryStatus: 'RANKED', rankingScore: 0.2, rankingFactors: {}, discoveredAt: '2026-01-01T00:00:00Z' },
      { id: 'res-2', researchRunId: 'r1', matterId: MATTER_A, candidateId: 'cand-2', discoveryStatus: 'RANKED', rankingScore: 0.9, rankingFactors: {}, discoveredAt: '2026-01-01T00:00:00Z' }
    ];
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url.includes('/legal-discovery/runs') && !url.includes('/results')) {
        return jsonResponse(200, { runs: [{ id: 'r1', matterId: MATTER_A, triggerType: 'MANUAL', status: 'COMPLETED', createdAt: '2026-01-01T00:00:00Z' }] });
      }
      if (url.includes('/results')) {
        return jsonResponse(200, { run: { id: 'r1', status: 'COMPLETED' }, results: orderA });
      }
      if (url.includes('/legal-research/candidates')) {
        return jsonResponse(200, { candidates: [
          { id: 'cand-1', authorityIdentifier: 'Authority One' },
          { id: 'cand-2', authorityIdentifier: 'Authority Two' }
        ] });
      }
      return defaultRoute(url);
    });

    render(<LegalDiscoveryTab matterId={MATTER_A} />);
    await waitFor(() => screen.getByText('Authority One'));
    const items = screen.getAllByText(/Authority (One|Two)/);
    expect(items[0].textContent).toBe('Authority One');
    expect(items[1].textContent).toBe('Authority Two');
  });

  it('renders the ranking explanation from real server data, not a raw JSON dump', async () => {
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url.includes('/legal-discovery/runs') && !url.includes('/results')) {
        return jsonResponse(200, { runs: [{ id: 'r1', matterId: MATTER_A, triggerType: 'MANUAL', status: 'COMPLETED', createdAt: '2026-01-01T00:00:00Z' }] });
      }
      if (url.includes('/results')) {
        return jsonResponse(200, {
          run: { id: 'r1', status: 'COMPLETED' },
          results: [{
            id: 'res-1', researchRunId: 'r1', matterId: MATTER_A, candidateId: 'cand-1', discoveryStatus: 'RANKED', rankingScore: 0.5,
            rankingFactors: { algorithmVersion: 'stage9d-discovery-v1', matchedTerms: ['neglect', 'child'], contextMatches: [{ sourceType: 'CLAIM', id: 'c1', matchedTerms: ['neglect'] }], limitations: [] },
            discoveredAt: '2026-01-01T00:00:00Z'
          }]
        });
      }
      return defaultRoute(url);
    });

    render(<LegalDiscoveryTab matterId={MATTER_A} />);
    await waitFor(() => screen.getByText(/Matched terms: neglect, child/));
    expect(screen.queryByText('{"algorithmVersion"')).toBeNull();
  });

  it('preserves ALLEGATION matter-context classification verbatim and never claims legal applicability', async () => {
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url.includes('/legal-discovery/runs') && !url.includes('/results')) {
        return jsonResponse(200, { runs: [{ id: 'r1', matterId: MATTER_A, triggerType: 'MANUAL', status: 'COMPLETED', createdAt: '2026-01-01T00:00:00Z' }] });
      }
      if (url.includes('/results')) {
        return jsonResponse(200, {
          run: { id: 'r1', status: 'COMPLETED' },
          results: [{ id: 'res-1', researchRunId: 'r1', matterId: MATTER_A, candidateId: 'cand-1', discoveryStatus: 'RANKED', rankingScore: 0.5, rankingFactors: {}, discoveredAt: '2026-01-01T00:00:00Z' }]
        });
      }
      if (url.includes('/legal-research/candidates')) {
        return jsonResponse(200, { candidates: [{ id: 'cand-1', authorityIdentifier: 'CYFSA s. 74(2)', evidenceClassification: 'ALLEGATION', contentIntegrityStatus: 'VERIFIED' }] });
      }
      return defaultRoute(url);
    });

    render(<LegalDiscoveryTab matterId={MATTER_A} />);
    await waitFor(() => screen.getByText('Matter context: ALLEGATION'));
    expect(screen.queryByText(/applicable law/i)).toBeNull();
    expect(screen.queryByText(/legal violation/i)).toBeNull();
    expect(screen.queryByText(/definitively relevant/i)).toBeNull();
  });

  it('machine discovery and professional review are visually and structurally distinct', async () => {
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url.includes('/legal-discovery/runs') && !url.includes('/results')) {
        return jsonResponse(200, { runs: [{ id: 'r1', matterId: MATTER_A, triggerType: 'MANUAL', status: 'COMPLETED', createdAt: '2026-01-01T00:00:00Z' }] });
      }
      if (url.includes('/results')) {
        return jsonResponse(200, {
          run: { id: 'r1', status: 'COMPLETED' },
          results: [{ id: 'res-1', researchRunId: 'r1', matterId: MATTER_A, candidateId: 'cand-1', discoveryStatus: 'RANKED', rankingScore: 0.5, rankingFactors: {}, discoveredAt: '2026-01-01T00:00:00Z' }]
        });
      }
      return defaultRoute(url);
    });

    render(<LegalDiscoveryTab matterId={MATTER_A} />);
    await waitFor(() => screen.getByText('Machine-discovered'));
    expect(screen.getByTestId('professional-review-box')).toBeTruthy();
    expect(screen.getByText(/Professional Review \(human, separate from machine discovery\)/)).toBeTruthy();
  });

  it('review action uses the real write contract and persists after refetch', async () => {
    let saved = false;
    mockApiFetch.mockImplementation(async (url: string, init?: any) => {
      if (url.includes('/legal-discovery/runs') && !url.includes('/results')) {
        return jsonResponse(200, { runs: [{ id: 'r1', matterId: MATTER_A, triggerType: 'MANUAL', status: 'COMPLETED', createdAt: '2026-01-01T00:00:00Z' }] });
      }
      if (url.includes('/results')) {
        return jsonResponse(200, {
          run: { id: 'r1', status: 'COMPLETED' },
          results: [{ id: 'res-1', researchRunId: 'r1', matterId: MATTER_A, candidateId: 'cand-1', discoveryStatus: 'RANKED', rankingScore: 0.5, rankingFactors: {}, discoveredAt: '2026-01-01T00:00:00Z' }]
        });
      }
      if (url === `/api/professional-workspace/matters/${MATTER_A}/review` && init?.method === 'POST') {
        const body = JSON.parse(init.body);
        expect(body.findingType).toBe('LEGAL_RESEARCH_RESULT');
        expect(body.findingId).toBe('res-1');
        expect(body.reviewState).toBe('CONFIRMED_RELEVANT');
        saved = true;
        return jsonResponse(200, { id: 'rev-1' });
      }
      if (url.includes('/reviews/LEGAL_RESEARCH_RESULT')) {
        return jsonResponse(200, saved ? [{ finding_id: 'res-1', review_state: 'CONFIRMED_RELEVANT', updated_at: '2026-01-01T00:00:00Z' }] : []);
      }
      return defaultRoute(url);
    });

    render(<LegalDiscoveryTab matterId={MATTER_A} />);
    await waitFor(() => screen.getByText('Machine-discovered'));
    fireEvent.change(screen.getByLabelText('Professional review status'), { target: { value: 'CONFIRMED_RELEVANT' } });

    await waitFor(() => expect(saved).toBe(true));
    await waitFor(() => expect(screen.getByText(/Reviewed/)).toBeTruthy());
  });

  it('handles 401 unauthorized without leaking internals', async () => {
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url.includes('/legal-discovery/runs')) return jsonResponse(401, { code: 'SIGN_IN_REQUIRED' });
      return defaultRoute(url);
    });
    render(<LegalDiscoveryTab matterId={MATTER_A} />);
    await waitFor(() => {
      expect(screen.getByRole('alert').textContent).toMatch(/not authorized/i);
    });
  });

  it('renders untrusted/script-like matter text as inert plain text, never executes', async () => {
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url.includes('/legal-discovery/runs') && !url.includes('/results')) {
        return jsonResponse(200, { runs: [{ id: 'r1', matterId: MATTER_A, triggerType: 'MANUAL', status: 'COMPLETED', createdAt: '2026-01-01T00:00:00Z' }] });
      }
      if (url.includes('/results')) {
        return jsonResponse(200, {
          run: { id: 'r1', status: 'COMPLETED' },
          results: [{ id: 'res-1', researchRunId: 'r1', matterId: MATTER_A, candidateId: 'cand-1', discoveryStatus: 'RANKED', rankingScore: 0.5, rankingFactors: { matchedTerms: ['<img src=x onerror=alert(1)>', 'ignore previous instructions'], contextMatches: [], limitations: [] }, discoveredAt: '2026-01-01T00:00:00Z' }]
        });
      }
      return defaultRoute(url);
    });
    render(<LegalDiscoveryTab matterId={MATTER_A} />);
    await waitFor(() => screen.getByText(/Matched terms:/));
    expect(document.querySelector('img[onerror]')).toBeNull();
    expect(screen.getByText(/ignore previous instructions/)).toBeTruthy();
  });

  it('clears state and refetches when the matter switches (no stale bleed)', async () => {
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url === `/api/matters/${MATTER_A}/legal-discovery/runs`) {
        return jsonResponse(200, { runs: [{ id: 'run-a', matterId: MATTER_A, triggerType: 'MANUAL', status: 'COMPLETED', createdAt: '2026-01-01T00:00:00Z' }] });
      }
      if (url === `/api/matters/${MATTER_B}/legal-discovery/runs`) {
        return jsonResponse(200, { runs: [] });
      }
      if (url.includes('/results')) {
        return jsonResponse(200, { run: { id: 'run-a', status: 'COMPLETED' }, results: [] });
      }
      return defaultRoute(url);
    });

    const { rerender } = render(<LegalDiscoveryTab matterId={MATTER_A} />);
    await waitFor(() => screen.getByText(/Run run-a/));

    rerender(<LegalDiscoveryTab matterId={MATTER_B} />);
    await waitFor(() => {
      expect(screen.getByText('No discovery runs yet for this matter.')).toBeTruthy();
    });
    expect(screen.queryByText(/Run run-a/)).toBeNull();
  });

  // --- Stage 9D-3 remediation: stale-response race regressions ---------------------------------

  it('[AUDITOR] does not let a late Matter A response overwrite Matter B state after switching', async () => {
    let resolveRunsA: (v: any) => void = () => {};
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url === `/api/matters/${MATTER_A}/legal-discovery/runs`) {
        return new Promise((resolve) => { resolveRunsA = () => resolve(jsonResponse(200, { runs: [{ id: 'run-a-stale', matterId: MATTER_A, triggerType: 'MANUAL', status: 'COMPLETED', createdAt: '2026-01-01T00:00:00Z' }] })); });
      }
      if (url === `/api/matters/${MATTER_B}/legal-discovery/runs`) {
        return jsonResponse(200, { runs: [] });
      }
      if (url.includes('/results')) return jsonResponse(200, { run: null, results: [] });
      return defaultRoute(url);
    });

    const { rerender } = render(<LegalDiscoveryTab matterId={MATTER_A} />);
    // Matter A's runs fetch is still in flight (deliberately unresolved).

    rerender(<LegalDiscoveryTab matterId={MATTER_B} />);
    await waitFor(() => {
      expect(screen.getByText('No discovery runs yet for this matter.')).toBeTruthy();
    });

    // Now let Matter A's stale response resolve, after the switch to Matter B.
    resolveRunsA(undefined);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByText(/run-a-stale/)).toBeNull();
    expect(screen.getByText('No discovery runs yet for this matter.')).toBeTruthy();
  });

  it('stale candidate response from Matter A does not leak a Matter A candidate into Matter B view', async () => {
    let resolveCandidatesA: (v: any) => void = () => {};
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url === `/api/matters/${MATTER_A}/legal-research/candidates`) {
        return new Promise((resolve) => { resolveCandidatesA = () => resolve(jsonResponse(200, { candidates: [{ id: 'cand-a-stale', authorityIdentifier: 'Matter A Stale Authority' }] })); });
      }
      return defaultRoute(url);
    });

    const { rerender } = render(<LegalDiscoveryTab matterId={MATTER_A} />);
    rerender(<LegalDiscoveryTab matterId={MATTER_B} />);
    await waitFor(() => screen.getByText('No discovery runs yet for this matter.'));

    resolveCandidatesA(undefined);
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByText(/Matter A Stale Authority/)).toBeNull();
  });

  it('stale reviews response from Matter A does not leak into Matter B review state', async () => {
    let resolveReviewsA: (v: any) => void = () => {};
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url === `/api/professional-workspace/matters/${MATTER_A}/reviews/LEGAL_RESEARCH_RESULT`) {
        return new Promise((resolve) => { resolveReviewsA = () => resolve(jsonResponse(200, [{ finding_id: 'res-1', review_state: 'CONFIRMED_RELEVANT', updated_at: '2026-01-01T00:00:00Z' }])); });
      }
      if (url === `/api/matters/${MATTER_B}/legal-discovery/runs`) {
        return jsonResponse(200, { runs: [{ id: 'run-b', matterId: MATTER_B, triggerType: 'MANUAL', status: 'COMPLETED', createdAt: '2026-01-01T00:00:00Z' }] });
      }
      if (url.includes('/results')) {
        return jsonResponse(200, { run: { id: 'run-b', status: 'COMPLETED' }, results: [{ id: 'res-1', researchRunId: 'run-b', matterId: MATTER_B, candidateId: 'cand-1', discoveryStatus: 'RANKED', rankingScore: 0.5, rankingFactors: {}, discoveredAt: '2026-01-01T00:00:00Z' }] });
      }
      return defaultRoute(url);
    });

    const { rerender } = render(<LegalDiscoveryTab matterId={MATTER_A} />);
    rerender(<LegalDiscoveryTab matterId={MATTER_B} />);
    await waitFor(() => screen.getByText('Machine-discovered'));

    resolveReviewsA(undefined);
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByText(/Reviewed/)).toBeNull();
    expect(screen.getByText('No review record')).toBeTruthy();
  });

  it('stale results response from Matter A does not leak into Matter B results list', async () => {
    let resolveResultsA: (v: any) => void = () => {};
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url === `/api/matters/${MATTER_A}/legal-discovery/runs`) {
        return jsonResponse(200, { runs: [{ id: 'run-a', matterId: MATTER_A, triggerType: 'MANUAL', status: 'COMPLETED', createdAt: '2026-01-01T00:00:00Z' }] });
      }
      if (url === `/api/matters/${MATTER_A}/legal-discovery/runs/run-a/results`) {
        return new Promise((resolve) => { resolveResultsA = () => resolve(jsonResponse(200, { run: { id: 'run-a', status: 'COMPLETED' }, results: [{ id: 'res-a-stale', researchRunId: 'run-a', matterId: MATTER_A, candidateId: 'cand-1', discoveryStatus: 'RANKED', rankingScore: 0.5, rankingFactors: {}, discoveredAt: '2026-01-01T00:00:00Z' }] })); });
      }
      if (url === `/api/matters/${MATTER_B}/legal-discovery/runs`) {
        return jsonResponse(200, { runs: [] });
      }
      return defaultRoute(url);
    });

    const { rerender } = render(<LegalDiscoveryTab matterId={MATTER_A} />);
    await waitFor(() => screen.getByText(/Run run-a/));

    rerender(<LegalDiscoveryTab matterId={MATTER_B} />);
    await waitFor(() => screen.getByText('No discovery runs yet for this matter.'));

    resolveResultsA(undefined);
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByText(/res-a-stale/)).toBeNull();
    expect(screen.getByText('No discovery runs yet for this matter.')).toBeTruthy();
  });

  it('a late-failing Matter A request does not flip Matter B into an error state', async () => {
    let rejectRunsA: (e: any) => void = () => {};
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url === `/api/matters/${MATTER_A}/legal-discovery/runs`) {
        return new Promise((_resolve, reject) => { rejectRunsA = reject; });
      }
      if (url === `/api/matters/${MATTER_B}/legal-discovery/runs`) {
        return jsonResponse(200, { runs: [] });
      }
      return defaultRoute(url);
    });

    const { rerender } = render(<LegalDiscoveryTab matterId={MATTER_A} />);
    rerender(<LegalDiscoveryTab matterId={MATTER_B} />);
    await waitFor(() => screen.getByText('No discovery runs yet for this matter.'));

    rejectRunsA(new Error('Matter A network failure'));
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('a late Matter A response does not re-flip Matter B loading state back to loading', async () => {
    let resolveRunsA: (v: any) => void = () => {};
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url === `/api/matters/${MATTER_A}/legal-discovery/runs`) {
        return new Promise((resolve) => { resolveRunsA = () => resolve(jsonResponse(200, { runs: [] })); });
      }
      if (url === `/api/matters/${MATTER_B}/legal-discovery/runs`) {
        return jsonResponse(200, { runs: [] });
      }
      return defaultRoute(url);
    });

    const { rerender } = render(<LegalDiscoveryTab matterId={MATTER_A} />);
    rerender(<LegalDiscoveryTab matterId={MATTER_B} />);
    await waitFor(() => screen.getByText('No discovery runs yet for this matter.'));

    resolveRunsA(undefined);
    await new Promise((r) => setTimeout(r, 0));

    // Matter B's finished (non-loading) empty state must remain, not be reset to "Loading...".
    expect(screen.queryByText('Loading run history...')).toBeNull();
    expect(screen.getByText('No discovery runs yet for this matter.')).toBeTruthy();
  });

  it('same-matter overlapping runs requests: an older in-flight response does not clobber a newer refresh', async () => {
    // Reachable in practice: startDiscovery() calls loadRuns() itself, then again after the POST
    // resolves -- if the first (pre-POST) loadRuns() call is slow and resolves after the second
    // (post-POST) loadRuns() call, the older response must not overwrite the fresher one.
    let callIndex = 0;
    let resolveFirst: (v: any) => void = () => {};
    mockApiFetch.mockImplementation(async (url: string, init?: any) => {
      if (init?.method === 'POST') {
        return jsonResponse(201, { run: { id: 'run-new', matterId: MATTER_A, triggerType: 'MANUAL', status: 'COMPLETED', createdAt: '2026-01-02T00:00:00Z' }, resultCount: 0, results: [] });
      }
      if (url === `/api/matters/${MATTER_A}/legal-discovery/runs`) {
        callIndex += 1;
        if (callIndex === 1) {
          return new Promise((resolve) => { resolveFirst = () => resolve(jsonResponse(200, { runs: [] })); });
        }
        return jsonResponse(200, { runs: [{ id: 'run-new', matterId: MATTER_A, triggerType: 'MANUAL', status: 'COMPLETED', createdAt: '2026-01-02T00:00:00Z' }] });
      }
      if (url.includes('/results')) return jsonResponse(200, { run: { id: 'run-new', status: 'COMPLETED' }, results: [] });
      return defaultRoute(url);
    });

    render(<LegalDiscoveryTab matterId={MATTER_A} />);
    await waitFor(() => screen.getByText('Start Legal Discovery'));
    // First loadRuns() (from mount) is now in flight and held open.

    fireEvent.click(screen.getByText('Start Legal Discovery'));
    await waitFor(() => screen.getByText(/Run run-new/));

    // Now let the stale, older mount-time loadRuns() resolve with an empty list.
    resolveFirst(undefined);
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.getByText(/Run run-new/)).toBeTruthy();
  });

  it('[AUDITOR] rapid A->B->A: a stale first-visit-to-A response must not overwrite the second visit\'s fresher A data (matterId-only guard would wrongly accept it)', async () => {
    // Visit A (1st time, request #1 held open) -> switch to B (request #2, resolves) -> switch back
    // to A (request #3, resolves) -> request #1 (still in flight, SAME matterId as request #3)
    // finally resolves. A matterId-equality-only guard would accept request #1's payload because
    // its matterId also equals A -- only a monotonic per-resource generation counter distinguishes
    // "old visit to A" from "current visit to A" and correctly rejects it.
    let resolveFirstVisitA: (v: any) => void = () => {};
    let firstVisitACalls = 0;
    mockApiFetch.mockImplementation(async (url: string) => {
      if (url === `/api/matters/${MATTER_A}/legal-discovery/runs`) {
        firstVisitACalls += 1;
        if (firstVisitACalls === 1) {
          // First visit to A: held open indefinitely until we explicitly resolve it late.
          return new Promise((resolve) => {
            resolveFirstVisitA = () => resolve(jsonResponse(200, {
              runs: [{ id: 'run-a-FIRST-VISIT-STALE', matterId: MATTER_A, triggerType: 'MANUAL', status: 'COMPLETED', createdAt: '2026-01-01T00:00:00Z' }]
            }));
          });
        }
        // Second visit to A: resolves promptly with the current/fresh data.
        return jsonResponse(200, {
          runs: [{ id: 'run-a-SECOND-VISIT-FRESH', matterId: MATTER_A, triggerType: 'MANUAL', status: 'COMPLETED', createdAt: '2026-01-05T00:00:00Z' }]
        });
      }
      if (url === `/api/matters/${MATTER_B}/legal-discovery/runs`) {
        return jsonResponse(200, { runs: [] });
      }
      if (url.includes('/results')) return jsonResponse(200, { run: null, results: [] });
      return defaultRoute(url);
    });

    const { rerender } = render(<LegalDiscoveryTab matterId={MATTER_A} />);
    // First visit to A's runs fetch is in flight and deliberately held open.

    rerender(<LegalDiscoveryTab matterId={MATTER_B} />);
    await waitFor(() => screen.getByText('No discovery runs yet for this matter.'));

    rerender(<LegalDiscoveryTab matterId={MATTER_A} />);
    await waitFor(() => screen.getByText(/Run run-a-SE/));

    // Now let the stale first-visit-to-A response resolve late, after we're back on A with fresh
    // data already displayed. Its matterId (A) matches the CURRENT matterId, so a matterId-only
    // guard would incorrectly accept it and clobber the fresh second-visit data.
    resolveFirstVisitA(undefined);
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    expect(screen.queryByText(/Run run-a-FI/)).toBeNull();
    expect(screen.getByText(/Run run-a-SE/)).toBeTruthy();
  });
});
