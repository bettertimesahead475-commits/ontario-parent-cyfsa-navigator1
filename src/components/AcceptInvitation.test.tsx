/**
 * @vitest-environment jsdom
 */
// Stage 10 slice 8: /accept-invitation page.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Router } from 'wouter';
import { memoryLocation } from 'wouter/memory-location';

const TOKEN = 'Zq9_' + 'x'.repeat(35) + '-Y1z';
const RECIPIENT = 'hidden.recipient@lawfirm.test';
const MATTER = '27000000-0000-4000-8000-00000000000a';

const mockApiFetch = vi.fn();
const mockSignOut = vi.fn(async (..._a: any[]) => {});
vi.mock('../utils/api', () => ({ apiFetch: (...a: any[]) => mockApiFetch(...a) }));
vi.mock('../utils/firebase', () => ({ auth: { currentUser: { email: 'signed.in@example.test' } } }));
vi.mock('firebase/auth', () => ({ signOut: (...a: any[]) => mockSignOut(...a) }));

const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const logs: string[] = [];

async function setup(hash: string | null) {
  vi.resetModules();
  window.history.replaceState(null, '', '/accept-invitation' + (hash ?? ''));
  const frag = await import('../utils/invitationFragment');
  const { default: AcceptInvitation, ACCEPT_MESSAGES, MISSING_LINK_MESSAGE } = await import('./AcceptInvitation');
  const mem = memoryLocation({ path: '/accept-invitation', record: true });
  render(<Router hook={mem.hook}><AcceptInvitation /></Router>);
  return { frag, mem, ACCEPT_MESSAGES, MISSING_LINK_MESSAGE };
}
function noTokenAnywhere() {
  expect(document.body.innerHTML).not.toContain(TOKEN);
  expect(window.location.href).not.toContain(TOKEN);
  const stored: string[] = [];
  for (const st of [localStorage, sessionStorage]) for (let i = 0; i < st.length; i++) stored.push(st.key(i)!, String(st.getItem(st.key(i)!)));
  expect(stored.join('|')).not.toContain(TOKEN);
  expect(document.cookie).not.toContain(TOKEN);
  expect(logs.join('\n')).not.toContain(TOKEN);
}

beforeEach(() => {
  mockApiFetch.mockReset(); mockSignOut.mockClear(); logs.length = 0;
  localStorage.clear(); sessionStorage.clear();
  for (const k of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    vi.spyOn(console, k).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')); });
  }
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('Stage 10 slice 8: AcceptInvitation', () => {
  it.each([[null], ['#t='], ['#t=short'], ['#other=1']])('a missing or malformed link (%s) shows one safe message and makes no request', async hash => {
    const { MISSING_LINK_MESSAGE } = await setup(hash);
    expect(screen.getByRole('alert').textContent).toBe(MISSING_LINK_MESSAGE);
    expect(screen.queryByRole('button', { name: 'Accept invitation' })).toBeNull();
    expect(mockApiFetch).not.toHaveBeenCalled();
    expect(window.location.hash).not.toMatch(/(^|[#&;])t=/); // token-bearing fragments are always scrubbed
  });

  it('makes no network request until the user chooses to accept; the token is never rendered', async () => {
    await setup('#t=' + TOKEN);
    expect(screen.getByRole('heading', { name: 'Professional invitation' })).toBeTruthy();
    expect(screen.getByText(/signed in as/).textContent).toContain('signed.in@example.test');
    expect(mockApiFetch).not.toHaveBeenCalled();
    noTokenAnywhere();
  });

  it('accepts with the token ONLY in the authenticated POST body, then discards it and hands off to the Professional Workspace', async () => {
    const { frag, mem } = await setup('#t=' + TOKEN);
    mockApiFetch.mockResolvedValue(res(200, { matterId: MATTER, role: 'REVIEWER' }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
    await waitFor(() => expect(mem.history).toContain('/professional-workspace'));
    expect(mockApiFetch).toHaveBeenCalledTimes(1);
    const [url, init] = mockApiFetch.mock.calls[0];
    expect(url).toBe('/api/access-invitations/accept');
    expect(url).not.toContain(TOKEN);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ token: TOKEN });
    expect(frag.heldInvitationToken()).toBeNull();
    expect(frag.invitationCaptureStatus()).toBe('none');
    expect(mem.history.join(' ')).not.toContain(TOKEN);
    noTokenAnywhere();
  });

  it.each([
    [410, { code: 'INVITATION_UNAVAILABLE', error: 'x', recipientEmail: RECIPIENT, matterId: MATTER, status: 'REVOKED', expiresAt: '2026-10-01' }],
    [409, { code: 'OWNER_CANNOT_ACCEPT', error: 'A matter owner cannot accept' }],
    [403, { code: 'FORBIDDEN', error: 'Your account cannot accept invitations right now.' }],
  ])('refusal %i shows ONE neutral message and never shows invitation metadata, even if a body carried it', async (status, body) => {
    const { ACCEPT_MESSAGES, frag } = await setup('#t=' + TOKEN);
    mockApiFetch.mockResolvedValue(res(status, body));
    fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(ACCEPT_MESSAGES.refused);
    for (const s of [RECIPIENT, MATTER, 'REVOKED', 'expire', 'owner cannot']) expect(document.body.textContent).not.toContain(s);
    await waitFor(() => expect(document.activeElement).toBe(alert));
    // The token stays in memory so the user can switch to the invited account (a popup, no reload).
    expect(frag.heldInvitationToken()).toBe(TOKEN);
    noTokenAnywhere();
  });

  it('the three refusal classes are indistinguishable on screen', async () => {
    const texts: string[] = [];
    for (const [status, code] of [[410, 'INVITATION_UNAVAILABLE'], [409, 'OWNER_CANNOT_ACCEPT'], [403, 'FORBIDDEN']] as const) {
      await setup('#t=' + TOKEN);
      mockApiFetch.mockResolvedValue(res(status, { code }));
      fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
      texts.push((await screen.findByRole('alert')).textContent!);
      cleanup();
    }
    expect(new Set(texts).size).toBe(1);
  });

  it('an unverified sign-in email is told so, without anything about the invitation', async () => {
    const { ACCEPT_MESSAGES } = await setup('#t=' + TOKEN);
    mockApiFetch.mockResolvedValue(res(403, { code: 'EMAIL_NOT_VERIFIED', error: 'x' }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect((await screen.findByRole('alert')).textContent).toBe(ACCEPT_MESSAGES.unverified);
  });

  it.each([[429, 'limited'], [401, 'signin'], [503, 'unavailable'], [500, 'unavailable']] as const)('%i shows the %s message', async (status, key) => {
    const { ACCEPT_MESSAGES } = await setup('#t=' + TOKEN);
    mockApiFetch.mockResolvedValue(res(status, { code: 'X', error: 'server text must not show' }));
    fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect((await screen.findByRole('alert')).textContent).toBe(ACCEPT_MESSAGES[key]);
    expect(document.body.textContent).not.toContain('server text must not show');
  });

  it('a network failure is a safe unavailable message', async () => {
    const { ACCEPT_MESSAGES } = await setup('#t=' + TOKEN);
    mockApiFetch.mockRejectedValue(new Error('network ' + TOKEN));
    fireEvent.click(screen.getByRole('button', { name: 'Accept invitation' }));
    expect((await screen.findByRole('alert')).textContent).toBe(ACCEPT_MESSAGES.unavailable);
    noTokenAnywhere();
  });

  it('"Sign in with a different account" signs out in place and keeps the token in memory only', async () => {
    const { frag } = await setup('#t=' + TOKEN);
    fireEvent.click(screen.getByRole('button', { name: 'Sign in with a different account' }));
    await waitFor(() => expect(mockSignOut).toHaveBeenCalledTimes(1));
    expect(frag.heldInvitationToken()).toBe(TOKEN);
    noTokenAnywhere();
  });

  it('is keyboard operable with native, named buttons; the busy state is announced', async () => {
    await setup('#t=' + TOKEN);
    let resolve!: (v: unknown) => void;
    mockApiFetch.mockReturnValue(new Promise(r => { resolve = r; }));
    const btn = screen.getByRole('button', { name: 'Accept invitation' });
    expect(btn.tagName).toBe('BUTTON');
    expect(btn.getAttribute('type')).toBe('button');
    btn.focus();
    expect(document.activeElement).toBe(btn);
    fireEvent.click(btn);
    expect(screen.getByRole('status').textContent).toMatch(/Accepting invitation/);
    expect((btn as HTMLButtonElement).disabled).toBe(true);
    resolve(res(410, { code: 'INVITATION_UNAVAILABLE' }));
    await screen.findByRole('alert');
  });
});
