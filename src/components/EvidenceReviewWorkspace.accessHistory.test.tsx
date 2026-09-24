/**
 * @vitest-environment jsdom
 */
// Stage 10 slice 5: AccessHistoryPanel as integrated into its parent, EvidenceReviewWorkspace
// (the owner's per-matter screen). The panel is presentation only; every authorization outcome
// here is a server response.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import EvidenceReviewWorkspace from './EvidenceReviewWorkspace';

const mockApiFetch = vi.fn();
vi.mock('../utils/api', () => ({ apiFetch: (...args: any[]) => mockApiFetch(...args) }));

const MATTER_A = '23000000-0000-4000-8000-00000000000a';
const MATTER_B = '23000000-0000-4000-8000-00000000000b';
const OWNER = '13000000-0000-4000-8000-000000000001';
const REV = '13000000-0000-4000-8000-000000000003';

const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const SUMMARIES: Record<string, string> = {
  GRANT_CREATED: 'Access invitation created',
  GRANT_ACCEPTED: 'Access invitation accepted',
  REVIEWER_ACCESS_ADDED: 'Reviewer access added',
  GRANT_EXPIRED: 'Access invitation expired before it was accepted',
  GRANT_REVOKED: 'Access invitation revoked',
  REVIEWER_ACCESS_REMOVED: 'Reviewer access removed',
};
const entry = (n: number, eventType: string, over: Record<string, unknown> = {}) => ({
  id: `43000000-0000-4000-8000-${String(n).padStart(12, '0')}`, sequence: n, occurredAt: '2026-09-24T12:00:00.000Z',
  eventType, outcome: 'SUCCEEDED', reasonCode: null, summary: SUMMARIES[eventType] ?? `<img src=x onerror=alert(1)> ${eventType}`,
  actor: { kind: 'ACCOUNT', accountId: OWNER, roleAtEvent: 'OWNER', isRequester: true }, subject: null, grantId: null, ...over,
});
const page = (matterId: string, entries: unknown[], nextCursor: string | null = null, scope = 'MATTER') => ({
  matterId, basis: 'HISTORICAL_EVENTS', scope, pageSize: 25, nextCursor, entries,
  notice: 'This is a record of past access events. It does not show who can open this matter now; the current access report answers that.',
});

let historyHandler: (url: string) => Promise<unknown>;
const historyCalls = () => mockApiFetch.mock.calls.filter(c => String(c[0]).includes('/access-history'));

beforeEach(() => {
  mockApiFetch.mockReset();
  historyHandler = async url => res(200, page(url.includes(MATTER_B) ? MATTER_B : MATTER_A, []));
  mockApiFetch.mockImplementation(async (url: string) => {
    if (url.startsWith('/api/review-matters')) {
      return res(200, { items: [{ id: MATTER_A, title: 'Matter A' }, { id: MATTER_B, title: 'Matter B' }], next: null });
    }
    if (url.includes('/access-history')) return historyHandler(url);
    if (/\/api\/matters\/[^/]+\/evidence\?/.test(url)) {
      const id = url.includes(MATTER_B) ? MATTER_B : MATTER_A;
      return res(200, { items: [], matter: { id, title: id === MATTER_A ? 'Matter A' : 'Matter B' }, nextCursor: null });
    }
    throw new Error(`unexpected request ${url}`);
  });
});
afterEach(() => cleanup());

async function openMatter(id: string) {
  await screen.findByRole('option', { name: 'Matter A' });
  fireEvent.change(screen.getByLabelText(/Open matter/), { target: { value: id } });
  return screen.findByRole('button', { name: /access history/ });
}
async function openHistory(id = MATTER_A) {
  const toggle = await openMatter(id);
  fireEvent.click(toggle);
  return toggle;
}

describe('Stage 10 slice 5: AccessHistoryPanel inside EvidenceReviewWorkspace', () => {
  it('is absent until a matter is open, and fetches nothing until the owner asks for it', async () => {
    render(<EvidenceReviewWorkspace />);
    await screen.findByRole('option', { name: 'Matter A' });
    expect(screen.queryByRole('button', { name: /access history/ })).toBeNull();
    const toggle = await openMatter(MATTER_A);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('access-history-panel')).toBeNull();
    expect(historyCalls()).toHaveLength(0);
  });

  it('opens with the selected matter id, as a keyboard-operable disclosure with a labelled heading', async () => {
    render(<EvidenceReviewWorkspace />);
    const toggle = await openMatter(MATTER_A);
    expect(toggle.tagName).toBe('BUTTON');
    expect(toggle.getAttribute('type')).toBe('button');
    toggle.focus();
    fireEvent.click(toggle);
    expect(document.activeElement).toBe(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.textContent).toBe('Hide access history');
    const region = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(region).toBeTruthy();
    const panel = await within(region).findByTestId('access-history-panel');
    expect(within(panel).getByRole('heading', { level: 2, name: 'Access history' })).toBeTruthy();
    expect(historyCalls()).toEqual([[`/api/matters/${MATTER_A}/access-history?pageSize=25`]]);
    // GET only: the panel never sends a method, body or authority-bearing parameter.
    expect(historyCalls()[0]).toHaveLength(1);
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('access-history-panel')).toBeNull();
  });

  it('shows the loading state, then every wired event type; an unknown type renders only a neutral label', async () => {
    let resolve!: (v: unknown) => void;
    historyHandler = () => new Promise(r => { resolve = r; });
    render(<EvidenceReviewWorkspace />);
    await openHistory();
    expect((await screen.findByText(/Loading access history/)).getAttribute('role')).toBe('status');
    const types = Object.keys(SUMMARIES);
    resolve(res(200, page(MATTER_A, [...types.map((t, i) => entry(i + 1, t)), entry(99, 'SOMETHING_NEW')])));
    const list = await screen.findByRole('list', { name: 'Access history, oldest first' });
    const labels = within(list).getAllByRole('article').map(a => a.getAttribute('aria-label'));
    expect(labels).toEqual([...types.map(t => SUMMARIES[t]), 'Unrecognized access event']);
    expect(list.textContent).not.toContain('SOMETHING_NEW');
    expect(list.innerHTML).not.toContain('<img');
    expect(screen.getByText(/does not show who can open this matter now/)).toBeTruthy();
  });

  it('shows the empty state', async () => {
    render(<EvidenceReviewWorkspace />);
    await openHistory();
    expect((await screen.findByText(/No access events have been recorded/)).getAttribute('role')).toBe('status');
  });

  it.each([
    ['an unrelated account', 403],
    ['a revoked reviewer', 403],
    ['a suspended account', 403],
  ])('shows the refusal state for %s (the server decides; nothing is hidden client-side)', async (_who, status) => {
    historyHandler = async () => res(status, { code: 'FORBIDDEN', error: 'raw server text <b>x</b>' });
    render(<EvidenceReviewWorkspace />);
    await openHistory();
    const alert = await screen.findByText(/You do not have access to this matter's access history/);
    expect(alert.getAttribute('role')).toBe('alert');
    expect(document.body.textContent).not.toContain('raw server text');
  });

  it.each([
    ['a network failure', () => Promise.reject(new TypeError('Failed to fetch'))],
    ['a server error', async () => res(503, { code: 'ACCESS_HISTORY_UNAVAILABLE', error: 'x' })],
    ['a response for a different matter', async () => res(200, page(MATTER_B, [entry(1, 'GRANT_CREATED')]))],
  ])('shows the error state on %s', async (_label, handler) => {
    historyHandler = handler as any;
    render(<EvidenceReviewWorkspace />);
    await openHistory();
    expect((await screen.findByText(/Access history is unavailable right now/)).getAttribute('role')).toBe('alert');
    expect(screen.queryByRole('list', { name: /Access history/ })).toBeNull();
  });

  it('renders a reviewer-scoped (SELF) page exactly as returned', async () => {
    historyHandler = async () => res(200, page(MATTER_A, [
      entry(1, 'GRANT_ACCEPTED', { actor: { kind: 'ACCOUNT', accountId: REV, roleAtEvent: 'REVIEWER', isRequester: true }, subject: { accountId: REV, isRequester: true } }),
    ], null, 'SELF'));
    render(<EvidenceReviewWorkspace />);
    await openHistory();
    const items = await screen.findAllByTestId('access-history-entry');
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain('By: You');
  });

  it('paginates through the parent: page 2 carries the server cursor for the same matter and is appended', async () => {
    historyHandler = async url => url.includes('cursor=')
      ? res(200, page(MATTER_A, [entry(3, 'GRANT_REVOKED')]))
      : res(200, page(MATTER_A, [entry(1, 'GRANT_CREATED'), entry(2, 'GRANT_ACCEPTED')], 'h1.next'));
    render(<EvidenceReviewWorkspace />);
    await openHistory();
    const more = await screen.findByRole('button', { name: 'Load more history' });
    fireEvent.click(more);
    await waitFor(() => expect(screen.getAllByTestId('access-history-entry')).toHaveLength(3));
    expect(historyCalls().map(c => c[0])).toEqual([
      `/api/matters/${MATTER_A}/access-history?pageSize=25`,
      `/api/matters/${MATTER_A}/access-history?pageSize=25&cursor=h1.next`,
    ]);
    expect(screen.queryByRole('button', { name: 'Load more history' })).toBeNull();
  });

  it('a refusal on page 2 (access revoked between pages) clears what was shown', async () => {
    historyHandler = async url => url.includes('cursor=')
      ? res(403, { code: 'FORBIDDEN', error: 'x' })
      : res(200, page(MATTER_A, [entry(1, 'GRANT_ACCEPTED')], 'h1.next'));
    render(<EvidenceReviewWorkspace />);
    await openHistory();
    fireEvent.click(await screen.findByRole('button', { name: 'Load more history' }));
    await screen.findByText(/You do not have access/);
    expect(screen.queryAllByTestId('access-history-entry')).toHaveLength(0);
  });

  it('switching matter collapses the panel; reopening loads only the new matter and ignores a late old response', async () => {
    let lateA!: (v: unknown) => void;
    historyHandler = url => url.includes(MATTER_A)
      ? new Promise(r => { lateA = r; })
      : Promise.resolve(res(200, page(MATTER_B, [entry(7, 'GRANT_CREATED')])));
    render(<EvidenceReviewWorkspace />);
    await openHistory(MATTER_A);
    fireEvent.change(screen.getByLabelText(/Open matter/), { target: { value: MATTER_B } });
    const toggle = await screen.findByRole('button', { name: 'Show access history' });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(toggle);
    await screen.findAllByTestId('access-history-entry');
    lateA(res(200, page(MATTER_A, [entry(1, 'REVIEWER_ACCESS_ADDED'), entry(2, 'GRANT_ACCEPTED')])));
    await new Promise(r => setTimeout(r, 0));
    const items = screen.getAllByTestId('access-history-entry');
    expect(items).toHaveLength(1);
    expect(items[0].textContent).toContain('Access invitation created');
  });

  it('history never drives the parent: no access decision, no current-access claim, no extra requests', async () => {
    historyHandler = async () => res(200, page(MATTER_A, [
      entry(1, 'REVIEWER_ACCESS_ADDED', { subject: { accountId: REV, isRequester: false } }),
      entry(2, 'REVIEWER_ACCESS_REMOVED', { subject: { accountId: OWNER, isRequester: true } }),
    ]));
    render(<EvidenceReviewWorkspace />);
    await openHistory();
    await screen.findAllByTestId('access-history-entry');
    // The notice (which says history does NOT show current access) aside, no entry claims current access.
    const list = screen.getByRole('list', { name: 'Access history, oldest first' });
    expect(list.textContent).not.toMatch(/\b(has access|currently|can open this matter now|you have access|no longer have access)\b/i);
    // The evidence workspace keeps operating on the same matter; history did not close or hide it.
    expect(screen.getByRole('heading', { level: 2, name: 'Matter A' })).toBeTruthy();
    expect((screen.getByLabelText(/Open matter/) as HTMLSelectElement).value).toBe(MATTER_A);
    // Every request the page made is a read the server authorizes; nothing grant/revoke/accept-shaped.
    for (const [url, init] of mockApiFetch.mock.calls) {
      expect(String(url)).not.toMatch(/grant|revoke|accept|invit|access-audit/);
      expect(init?.method ?? 'GET').not.toBe('POST');
    }
  });
});
