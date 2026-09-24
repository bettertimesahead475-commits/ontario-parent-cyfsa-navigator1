/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/react';
import AccessHistoryPanel from './AccessHistoryPanel';

const mockApiFetch = vi.fn();
vi.mock('../utils/api', () => ({ apiFetch: (...args: any[]) => mockApiFetch(...args) }));

const MATTER_A = '21000000-0000-4000-8000-00000000000a';
const MATTER_B = '21000000-0000-4000-8000-00000000000b';
const OWNER = '11000000-0000-4000-8000-000000000001';
const REV = '11000000-0000-4000-8000-000000000003';

const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const entry = (n: number, over: Record<string, unknown> = {}) => ({
  id: `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`, sequence: n, occurredAt: '2026-09-24T12:00:00.000Z',
  eventType: 'GRANT_CREATED', outcome: 'SUCCEEDED', reasonCode: null, summary: 'Access invitation created',
  actor: { kind: 'ACCOUNT', accountId: OWNER, roleAtEvent: 'OWNER', isRequester: false }, subject: null, grantId: null, ...over,
});
const page = (entries: unknown[], nextCursor: string | null = null, matterId = MATTER_A) => ({
  matterId, basis: 'HISTORICAL_EVENTS', scope: 'MATTER', pageSize: 25, nextCursor, entries,
  notice: 'This is a record of past access events. It does not show who can open this matter now; the current access report answers that.',
});

beforeEach(() => mockApiFetch.mockReset());
afterEach(() => cleanup());

describe('Stage 10 AccessHistoryPanel', () => {
  it('renders nothing without a matter', () => {
    const { container } = render(<AccessHistoryPanel matterId="" />);
    expect(container.innerHTML).toBe('');
    expect(mockApiFetch).not.toHaveBeenCalled();
  });

  it('announces loading, then shows the history-vs-current notice and entries in a labelled ordered list', async () => {
    let resolve!: (v: unknown) => void;
    mockApiFetch.mockReturnValue(new Promise(r => { resolve = r; }));
    render(<AccessHistoryPanel matterId={MATTER_A} />);
    expect(screen.getByRole('status').textContent).toMatch(/Loading access history/);
    resolve(res(200, page([
      entry(1),
      entry(2, { eventType: 'GRANT_ACCEPTED', summary: 'Access invitation accepted', actor: { kind: 'ACCOUNT', accountId: REV, roleAtEvent: 'REVIEWER', isRequester: true }, subject: { accountId: REV, isRequester: true } }),
      entry(3, { eventType: 'GRANT_EXPIRED', summary: 'Access invitation expired before it was accepted', actor: { kind: 'SYSTEM', accountId: null, roleAtEvent: 'SYSTEM', isRequester: false } }),
    ])));
    const list = await screen.findByRole('list', { name: 'Access history, oldest first' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map(i => within(i).getByRole('article').getAttribute('aria-label'))).toEqual([
      'Access invitation created', 'Access invitation accepted', 'Access invitation expired before it was accepted',
    ]);
    expect(screen.getByText(/does not show who can open this matter now/)).toBeTruthy();
    expect(items[0].textContent).toContain('Matter owner (account 11000000)');
    expect(items[1].textContent).toContain('By: You');
    expect(items[1].textContent).toContain('Concerning: you');
    expect(items[2].textContent).toContain('By: System');
    const time = items[0].querySelector('time')!;
    expect(time.getAttribute('dateTime')).toBe('2026-09-24T12:00:00.000Z');
    expect(time.textContent).toMatch(/2026/);
    expect(mockApiFetch).toHaveBeenCalledWith(`/api/matters/${MATTER_A}/access-history?pageSize=25`);
  });

  it('never phrases an entry as current access', async () => {
    mockApiFetch.mockResolvedValue(res(200, page([entry(1, { eventType: 'REVIEWER_ACCESS_ADDED', summary: 'Reviewer access added' })])));
    render(<AccessHistoryPanel matterId={MATTER_A} />);
    const list = await screen.findByRole('list');
    expect(list.textContent).not.toMatch(/\b(has access|currently|can open)\b/i);
  });

  it('shows refused outcomes in words, not colour alone, with the reason code', async () => {
    mockApiFetch.mockResolvedValue(res(200, page([entry(1, { eventType: 'GRANT_REVOKED', outcome: 'REFUSED', reasonCode: 'NOT_OWNER', summary: 'Attempt to revoke an access invitation was refused' })])));
    render(<AccessHistoryPanel matterId={MATTER_A} />);
    const item = await screen.findByTestId('access-history-entry');
    expect(item.textContent).toContain('Outcome: refused');
    expect(item.textContent).toContain('Reason code: NOT_OWNER');
  });

  it('shows the empty state', async () => {
    mockApiFetch.mockResolvedValue(res(200, page([])));
    render(<AccessHistoryPanel matterId={MATTER_A} />);
    const empty = await screen.findByText(/No access events have been recorded/);
    expect(empty.getAttribute('role')).toBe('status');
    expect(screen.queryByRole('list')).toBeNull();
  });

  it('renders an unrecognized event type neutrally instead of trusting its text', async () => {
    mockApiFetch.mockResolvedValue(res(200, page([entry(1, { eventType: 'SOMETHING_NEW', summary: 'Reviewer now has full access' })])));
    render(<AccessHistoryPanel matterId={MATTER_A} />);
    const item = await screen.findByTestId('access-history-entry');
    expect(item.textContent).toContain('Unrecognized access event');
    expect(item.textContent).not.toContain('full access');
    // The accessible name (what a screen reader announces) must not carry the untrusted text either.
    expect(within(item).getByRole('article').getAttribute('aria-label')).toBe('Unrecognized access event');
    expect(item.innerHTML).not.toContain('full access');
  });

  it.each([
    [403, /do not have access to this matter's access history/],
    [500, /unavailable right now/],
    [503, /unavailable right now/],
  ])('HTTP %i shows a fixed alert and never raw server text', async (status, text) => {
    mockApiFetch.mockResolvedValue(res(status, { error: 'relation "secret_table" does not exist' }));
    render(<AccessHistoryPanel matterId={MATTER_A} />);
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(text);
    expect(document.body.textContent).not.toContain('secret_table');
  });

  it('treats a network failure or malformed body as a generic failure', async () => {
    mockApiFetch.mockRejectedValueOnce(new Error('network down'));
    render(<AccessHistoryPanel matterId={MATTER_A} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/unavailable/);
    cleanup();
    mockApiFetch.mockResolvedValueOnce(res(200, { entries: 'nope' }));
    render(<AccessHistoryPanel matterId={MATTER_A} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/unavailable/);
  });

  it('rejects a response for a different matter', async () => {
    mockApiFetch.mockResolvedValue(res(200, page([entry(1)], null, MATTER_B)));
    render(<AccessHistoryPanel matterId={MATTER_A} />);
    expect((await screen.findByRole('alert')).textContent).toMatch(/unavailable/);
    expect(screen.queryByTestId('access-history-entry')).toBeNull();
  });

  it('pages with the opaque cursor via a keyboard-reachable button and appends in order', async () => {
    mockApiFetch
      .mockResolvedValueOnce(res(200, page([entry(1), entry(2)], 'h1.next')))
      .mockResolvedValueOnce(res(200, page([entry(3)], null)));
    render(<AccessHistoryPanel matterId={MATTER_A} />);
    const button = await screen.findByRole('button', { name: 'Load more history' });
    expect(button.tagName).toBe('BUTTON');
    fireEvent.click(button);
    await waitFor(() => expect(screen.getAllByTestId('access-history-entry')).toHaveLength(3));
    expect(mockApiFetch).toHaveBeenLastCalledWith(`/api/matters/${MATTER_A}/access-history?pageSize=25&cursor=h1.next`);
    expect(screen.queryByRole('button', { name: 'Load more history' })).toBeNull();
  });

  it('access revoked between pages: shows the refusal and removes the already-loaded history', async () => {
    mockApiFetch
      .mockResolvedValueOnce(res(200, page([entry(1)], 'h1.next')))
      .mockResolvedValueOnce(res(403, { code: 'FORBIDDEN' }));
    render(<AccessHistoryPanel matterId={MATTER_A} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Load more history' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/do not have access/);
    expect(screen.queryByTestId('access-history-entry')).toBeNull();
  });

  it('a failed next page keeps loaded entries and announces the error', async () => {
    mockApiFetch
      .mockResolvedValueOnce(res(200, page([entry(1)], 'h1.next')))
      .mockResolvedValueOnce(res(503, {}));
    render(<AccessHistoryPanel matterId={MATTER_A} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Load more history' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Could not load more history/);
    expect(screen.getAllByTestId('access-history-entry')).toHaveLength(1);
  });

  it('ignores a stale response after switching matters (A -> B)', async () => {
    let resolveA!: (v: unknown) => void;
    mockApiFetch
      .mockImplementationOnce(() => new Promise(r => { resolveA = r; }))
      .mockResolvedValueOnce(res(200, page([entry(9, { summary: 'Access report viewed', eventType: 'ACCESS_AUDIT_VIEWED' })], null, MATTER_B)));
    const { rerender } = render(<AccessHistoryPanel matterId={MATTER_A} />);
    rerender(<AccessHistoryPanel matterId={MATTER_B} />);
    await screen.findByText('Access report viewed');
    resolveA(res(200, page([entry(1, { summary: 'Access invitation created' })])));
    await new Promise(r => setTimeout(r, 20));
    expect(screen.queryByText('Access invitation created')).toBeNull();
    expect(screen.getAllByTestId('access-history-entry')).toHaveLength(1);
  });
});
