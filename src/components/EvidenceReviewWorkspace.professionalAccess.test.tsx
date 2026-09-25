/**
 * @vitest-environment jsdom
 */
// Stage 10 slice 8: the Professional Access panel as integrated into EvidenceReviewWorkspace (the
// owner's per-matter screen). Loaded only on request; switching matters closes it.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import EvidenceReviewWorkspace from './EvidenceReviewWorkspace';

const mockApiFetch = vi.fn();
vi.mock('../utils/api', () => ({ apiFetch: (...args: any[]) => mockApiFetch(...args) }));

const MATTER_A = '29000000-0000-4000-8000-00000000000a';
const MATTER_B = '29000000-0000-4000-8000-00000000000b';
const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const auditCalls = () => mockApiFetch.mock.calls.filter(c => String(c[0]).includes('/access-audit'));

beforeEach(() => {
  mockApiFetch.mockReset().mockImplementation(async (url: string) => {
    if (url.startsWith('/api/review-matters')) return res(200, { items: [{ id: MATTER_A, title: 'Matter A' }, { id: MATTER_B, title: 'Matter B' }], next: null });
    if (url.includes('/access-audit')) {
      return url.includes(MATTER_B) ? res(403, { code: 'FORBIDDEN', error: 'x' })
        : res(200, { matterId: MATTER_A, grants: [], currentAccess: [], integrityFindings: [], events: [], limitations: [] });
    }
    if (/\/evidence\?/.test(url)) return res(200, { items: [], matter: { id: MATTER_A, title: 'Matter A' }, nextCursor: null });
    throw new Error(`unexpected request ${url}`);
  });
});
afterEach(() => cleanup());

async function openMatter(id: string) {
  await screen.findByRole('option', { name: 'Matter A' });
  fireEvent.change(screen.getByLabelText('Open matter'), { target: { value: id } });
}

describe('Stage 10 slice 8: Professional access in the owner workspace', () => {
  it('is a disclosure button (aria-expanded/aria-controls); nothing is loaded until it is opened', async () => {
    render(<EvidenceReviewWorkspace />);
    await openMatter(MATTER_A);
    const btn = await screen.findByRole('button', { name: 'Manage professional access' });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(btn.getAttribute('aria-controls')).toBe('matter-professional-access');
    expect(auditCalls()).toHaveLength(0);
    fireEvent.click(btn);
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(await screen.findByLabelText("Professional's email address")).toBeTruthy();
    expect(auditCalls()).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Hide professional access' }));
    expect(screen.queryByLabelText("Professional's email address")).toBeNull();
  });

  it('switching matters closes the panel; a matter the user does not own shows the server refusal only', async () => {
    render(<EvidenceReviewWorkspace />);
    await openMatter(MATTER_A);
    fireEvent.click(await screen.findByRole('button', { name: 'Manage professional access' }));
    await screen.findByLabelText("Professional's email address");
    fireEvent.change(screen.getByLabelText('Open matter'), { target: { value: MATTER_B } });
    const btn = await screen.findByRole('button', { name: 'Manage professional access' });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(btn);
    expect((await screen.findByText('Only the matter owner can manage professional access.')).getAttribute('role')).toBe('alert');
    expect(screen.queryByLabelText("Professional's email address")).toBeNull();
  });
});
