/**
 * @vitest-environment jsdom
 */
// Stage 10 slice 8: OWNER Professional Access panel.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import React from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import ProfessionalAccessPanel, { invitationLink, statusLabel } from './ProfessionalAccessPanel';

const mockApiFetch = vi.fn();
vi.mock('../utils/api', () => ({ apiFetch: (...a: any[]) => mockApiFetch(...a) }));

const MATTER = '28000000-0000-4000-8000-00000000000a';
const TOKEN = 'Zq9_' + 'x'.repeat(35) + '-Y1z';
const DIGEST = 'd'.repeat(64);
const G = (id: string, over: Record<string, unknown>) => ({
  grantId: `38000000-0000-4000-8000-00000000000${id}`, capability: 'REVIEWER', grantorAccountId: '18000000-0000-4000-8000-000000000001',
  recordedStatus: 'PENDING', effectiveStatus: 'PENDING', expiryDerived: false, createdAt: '2026-09-20T12:00:00Z', expiresAt: '2026-09-27T12:00:00Z',
  acceptedAt: null, acceptedByAccountId: null, revokedAt: null, revokedByAccountId: null, recipientEmail: `p${id}@example.test`, ...over,
});
const REPORT = {
  matterId: MATTER,
  grants: [
    G('1', {}),
    G('2', { recordedStatus: 'ACCEPTED', effectiveStatus: 'ACCEPTED', acceptedAt: '2026-09-21T12:00:00Z', acceptedByAccountId: '18000000-0000-4000-8000-000000000009' }),
    G('3', { recordedStatus: 'REVOKED', effectiveStatus: 'REVOKED', revokedAt: '2026-09-22T12:00:00Z' }),
    G('4', { recordedStatus: 'PENDING', effectiveStatus: 'EXPIRED', expiryDerived: true }),
    // Fields the panel must never render even if a server ever sent them:
    G('5', { recipientEmail: null, token_digest: DIGEST, tokenDigest: DIGEST }),
  ],
  currentAccess: [
    { accountId: '18000000-0000-4000-8000-000000000001', role: 'OWNER', basis: 'MATTER_OWNER', backingGrantIds: [], isRequester: true },
    { accountId: '18000000-0000-4000-8000-000000000009', role: 'REVIEWER', basis: 'ACCEPTED_GRANT', backingGrantIds: ['38000000-0000-4000-8000-000000000002'], isRequester: false },
  ],
  integrityFindings: [], events: [], limitations: [],
};
const res = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const writeText = vi.fn(async () => {});

beforeEach(() => {
  mockApiFetch.mockReset(); writeText.mockReset().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  localStorage.clear(); sessionStorage.clear();
});
afterEach(() => cleanup());

function route(handlers: Record<string, (init?: any) => any>) {
  mockApiFetch.mockImplementation(async (url: string, init?: any) => {
    const key = `${init?.method ?? 'GET'} ${url}`;
    const h = Object.entries(handlers).find(([k]) => key.startsWith(k));
    if (!h) throw new Error('unexpected ' + key);
    return h[1](init);
  });
}
const AUDIT = `GET /api/matters/${MATTER}/access-audit`;

describe('Stage 10 slice 8: ProfessionalAccessPanel', () => {
  it('lists every invitation by recipient email with a text status; no internal ids, digests or tokens', async () => {
    route({ [AUDIT]: () => res(200, REPORT) });
    render(<ProfessionalAccessPanel matterId={MATTER} />);
    const list = await screen.findByRole('list', { name: 'Professional invitations' });
    const items = within(list).getAllByRole('listitem');
    expect(items.map(i => i.querySelector('p')!.textContent)).toEqual([
      'p1@example.test', 'p2@example.test', 'p3@example.test', 'p4@example.test', 'Invitation created before recipient binding',
    ]);
    expect(items[0].textContent).toMatch(/Status: Pending — not yet accepted \(expires/);
    expect(items[1].textContent).toContain('Status: Accepted — has access');
    expect(items[2].textContent).toMatch(/Status: Revoked on/);
    expect(items[3].textContent).toContain('Status: Expired — never accepted');
    const text = document.body.innerHTML;
    for (const s of [DIGEST, '18000000-0000-4000-8000-000000000009', '38000000-0000-4000-8000-000000000001', 'token_digest']) expect(text).not.toContain(s);
  });

  it('only pending and accepted invitations offer revocation, with meaningful names', async () => {
    route({ [AUDIT]: () => res(200, REPORT) });
    render(<ProfessionalAccessPanel matterId={MATTER} />);
    await screen.findByRole('list', { name: 'Professional invitations' });
    expect(screen.getByRole('button', { name: 'Revoke invitation for p1@example.test' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Revoke access for p2@example.test' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: /p3@example.test|p4@example.test/ })).toBeNull();
  });

  it('a non-owner (refused by the server) sees a refusal and no data', async () => {
    for (const status of [403, 404]) {
      route({ [AUDIT]: () => res(status, { code: 'FORBIDDEN', error: 'x', recipientEmail: 'leak@example.test' }) });
      render(<ProfessionalAccessPanel matterId={MATTER} />);
      expect((await screen.findByRole('alert')).textContent).toBe('Only the matter owner can manage professional access.');
      expect(screen.queryByRole('textbox')).toBeNull();
      expect(document.body.textContent).not.toContain('leak@example.test');
      cleanup();
    }
  });

  it('creates an invitation: labelled input with guidance; link built in the browser from window.location.origin with #t= (never ?t=)', async () => {
    let created = false;
    route({
      [AUDIT]: () => res(200, created ? { ...REPORT, grants: [G('9', { recipientEmail: 'new.pro@example.test' }), ...REPORT.grants] } : REPORT),
      [`POST /api/matters/${MATTER}/access-grants`]: init => {
        expect(JSON.parse(init.body)).toEqual({ recipientEmail: 'New.Pro@Example.test' });
        created = true;
        return res(201, { matterId: MATTER, grant: { id: 'g', status: 'PENDING', expiresAt: 'x', createdAt: 'y', recipientEmail: 'new.pro@example.test' }, invitationToken: TOKEN });
      },
    });
    render(<ProfessionalAccessPanel matterId={MATTER} />);
    const input = await screen.findByLabelText("Professional's email address");
    expect(input.getAttribute('type')).toBe('email');
    const help = document.getElementById(input.getAttribute('aria-describedby')!)!;
    expect(help.textContent).toMatch(/exact email address the professional signs in with/);
    fireEvent.change(input, { target: { value: ' New.Pro@Example.test ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));
    const link = await screen.findByLabelText('Invitation link') as HTMLInputElement;
    expect(link.value).toBe(`${window.location.origin}/accept-invitation#t=${TOKEN}`);
    expect(link.value).not.toContain('?t=');
    expect(new URL(link.value).search).toBe('');
    expect(new URL(link.value).pathname).toBe('/accept-invitation');
    expect(link.readOnly).toBe(true);
    await waitFor(() => expect(document.activeElement).toBe(link));
    expect(screen.getByText(/Invitation created for new.pro@example.test/)).toBeTruthy();
    expect(screen.getByText(/shown only once/)).toBeTruthy();
    // Copy is an accessible native button with a live confirmation.
    fireEvent.click(screen.getByRole('button', { name: 'Copy invitation link' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/accept-invitation#t=${TOKEN}`));
    expect((await screen.findByText('Invitation link copied.')).getAttribute('role')).toBe('status');
    // The list refreshed from the server.
    expect(await screen.findByText('new.pro@example.test')).toBeTruthy();
    // Done removes the token from the page; nothing was stored.
    fireEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(document.body.innerHTML).not.toContain(TOKEN);
    expect(JSON.stringify({ ...localStorage, ...sessionStorage }) + document.cookie).not.toContain(TOKEN);
    expect(document.activeElement).toBe(input);
  });

  it('invitationLink always uses the fragment form', () => {
    expect(invitationLink('https://preview-x.vercel.app', TOKEN)).toBe(`https://preview-x.vercel.app/accept-invitation#t=${TOKEN}`);
  });

  it('a blocked clipboard selects the link and says how to copy it', async () => {
    writeText.mockRejectedValue(new Error('denied'));
    route({
      [AUDIT]: () => res(200, REPORT),
      [`POST /api/matters/${MATTER}/access-grants`]: () => res(201, { matterId: MATTER, grant: { recipientEmail: 'a@b.test' }, invitationToken: TOKEN }),
    });
    render(<ProfessionalAccessPanel matterId={MATTER} />);
    fireEvent.change(await screen.findByLabelText("Professional's email address"), { target: { value: 'a@b.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Copy invitation link' }));
    expect(await screen.findByText(/Copying was blocked/)).toBeTruthy();
  });

  it('errors are associated with the input and announced; server text is never shown', async () => {
    route({
      [AUDIT]: () => res(200, REPORT),
      [`POST /api/matters/${MATTER}/access-grants`]: () => res(400, { code: 'INVALID_REQUEST', error: 'SERVER TEXT' }),
    });
    render(<ProfessionalAccessPanel matterId={MATTER} />);
    const input = await screen.findByLabelText("Professional's email address");
    fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));
    let alert = await screen.findByRole('alert');
    expect(alert.textContent).toMatch(/email address the professional signs in with/);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(input.getAttribute('aria-describedby')).toContain(alert.id);
    expect(mockApiFetch.mock.calls.filter(c => c[1]?.method === 'POST')).toHaveLength(0); // empty input never sent
    fireEvent.change(input, { target: { value: 'pro@example.test' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create invitation' }));
    await waitFor(() => expect(screen.getByRole('alert').textContent).toMatch(/Enter a valid email address/));
    expect(document.body.textContent).not.toContain('SERVER TEXT');
  });

  it('revoking a pending invitation: accessible confirmation, audited backend call, list refresh, announcement', async () => {
    let revoked = false;
    route({
      [AUDIT]: () => res(200, revoked ? { ...REPORT, grants: [G('1', { recordedStatus: 'REVOKED', effectiveStatus: 'REVOKED' }), ...REPORT.grants.slice(1)] } : REPORT),
      ['POST /api/access-grants/38000000-0000-4000-8000-000000000001/revoke']: () => { revoked = true; return res(200, { status: 'REVOKED', accessRemovedByThisRequest: false }); },
    });
    render(<ProfessionalAccessPanel matterId={MATTER} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke invitation for p1@example.test' }));
    const group = screen.getByRole('group', { name: 'Confirm: revoke invitation for p1@example.test' });
    const confirm = within(group).getByRole('button', { name: 'Confirm: revoke invitation' });
    await waitFor(() => expect(document.activeElement).toBe(confirm));
    expect(mockApiFetch.mock.calls.some(c => c[1]?.method === 'POST')).toBe(false); // nothing until confirmed
    fireEvent.click(confirm);
    expect((await screen.findByText(/Invitation for p1@example.test revoked/)).getAttribute('role')).toBe('status');
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Revoke invitation for p1@example.test' })).toBeNull());
  });

  it('cancel leaves everything as it was', async () => {
    route({ [AUDIT]: () => res(200, REPORT) });
    render(<ProfessionalAccessPanel matterId={MATTER} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke access for p2@example.test' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByRole('button', { name: 'Revoke access for p2@example.test' })).toBeTruthy();
    expect(mockApiFetch.mock.calls.some(c => c[1]?.method === 'POST')).toBe(false);
  });

  it('revoking accepted access reports honestly whether this request removed it (multiple-grant preservation is the server\'s)', async () => {
    for (const [removed, text] of [[true, 'Access for p2@example.test revoked.'], [false, 'still has access through another accepted invitation']] as const) {
      route({
        [AUDIT]: () => res(200, REPORT),
        ['POST /api/access-grants/38000000-0000-4000-8000-000000000002/revoke']: () => res(200, { status: 'REVOKED', accessRemovedByThisRequest: removed }),
      });
      render(<ProfessionalAccessPanel matterId={MATTER} />);
      fireEvent.click(await screen.findByRole('button', { name: 'Revoke access for p2@example.test' }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirm: revoke access' }));
      expect(await screen.findByText(new RegExp(text.replace(/[.]/g, '\\.')))).toBeTruthy();
      cleanup();
    }
  });

  it('an unconfirmed revocation says access may not have been removed', async () => {
    route({
      [AUDIT]: () => res(200, REPORT),
      ['POST /api/access-grants/38000000-0000-4000-8000-000000000002/revoke']: () => res(503, { code: 'ACCESS_REVOCATION_UNCONFIRMED' }),
    });
    render(<ProfessionalAccessPanel matterId={MATTER} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Revoke access for p2@example.test' }));
    fireEvent.click(screen.getByRole('button', { name: 'Confirm: revoke access' }));
    expect((await screen.findByRole('alert')).textContent).toMatch(/Access may not have been removed/);
  });

  it('status labels come from the server effectiveStatus, as text (not colour)', () => {
    expect(statusLabel(G('1', { recordedStatus: 'PENDING', effectiveStatus: 'EXPIRED' }) as any, false)).toBe('Expired — never accepted');
    expect(statusLabel(G('1', { effectiveStatus: 'ACCEPTED' }) as any, false)).toBe('Accepted — no current access');
    expect(statusLabel(G('1', { effectiveStatus: 'WHATEVER' }) as any, false)).toBe('Unknown status');
  });
});
