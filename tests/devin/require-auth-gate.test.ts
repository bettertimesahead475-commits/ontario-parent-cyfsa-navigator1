// @vitest-environment jsdom
/** Account gate on /document-analyzer, /templates and /signup: sign-in states, Google popup errors, staging-only email form. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';

const mocks = vi.hoisted(() => ({
  projectId: 'gen-lang-client-0105737183',
  listener: null as null | ((u: unknown) => void),
  errorListener: null as null | ((e: unknown) => void),
  signInMinimal: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
}));

vi.mock('../../src/utils/firebase', () => ({
  auth: { app: { options: { get projectId() { return mocks.projectId; } } } },
  signInMinimal: mocks.signInMinimal,
}));
vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, next: (u: unknown) => void, error?: (e: unknown) => void) => {
    mocks.listener = next; mocks.errorListener = error ?? null; return () => { mocks.listener = null; };
  },
  signInWithEmailAndPassword: mocks.signInWithEmailAndPassword,
}));

import RequireAuth from '../../src/components/RequireAuth';

const renderGate = () => render(createElement(RequireAuth, null, createElement('div', null, 'Private case data')));
const emit = (user: unknown) => act(() => { mocks.listener?.(user); });
const googleButton = () => screen.getByRole('button', { name: 'Sign in with Google' });
const failSignIn = (code: string) => mocks.signInMinimal.mockRejectedValueOnce(Object.assign(new Error(`Firebase: Error (${code}).`), { code }));

beforeEach(() => {
  mocks.projectId = 'gen-lang-client-0105737183';
  mocks.signInMinimal.mockReset();
  mocks.signInWithEmailAndPassword.mockReset();
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('RequireAuth account gate', () => {
  it('hides case content while the session is being checked', () => {
    renderGate();
    expect(screen.getByText('Connecting secure session...')).toBeTruthy();
    expect(screen.queryByText('Private case data')).toBeNull();
  });

  it('shows only Google sign-in to a signed-out visitor on the production project', () => {
    renderGate();
    emit(null);
    expect(screen.getByRole('heading', { name: 'Sign in to continue' })).toBeTruthy();
    expect(googleButton()).toBeTruthy();
    expect(screen.queryByText('Private case data')).toBeNull();
    expect(document.querySelector('input[type="email"], input[type="password"]')).toBeNull();
  });

  it('renders the protected route for a signed-in user', () => {
    renderGate();
    emit({ uid: 'synthetic-uid', email: 'qa.synthetic.parent@example.com' });
    expect(screen.getByText('Private case data')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Sign in to continue' })).toBeNull();
  });

  it('falls back to the sign-in prompt instead of loading forever when auth never answers', () => {
    vi.useFakeTimers();
    renderGate();
    act(() => { vi.advanceTimersByTime(2000); });
    expect(screen.getByRole('heading', { name: 'Sign in to continue' })).toBeTruthy();
  });

  it('a late auth answer after the fallback still unlocks the route', () => {
    vi.useFakeTimers();
    renderGate();
    act(() => { vi.advanceTimersByTime(2000); });
    emit({ uid: 'synthetic-uid' });
    expect(screen.getByText('Private case data')).toBeTruthy();
  });

  it('shows the sign-in prompt when the auth subscription errors', () => {
    renderGate();
    act(() => { mocks.errorListener?.(new Error('indexedDB unavailable')); });
    expect(screen.getByRole('heading', { name: 'Sign in to continue' })).toBeTruthy();
  });

  it.each([
    ['auth/popup-closed-by-user', 'Google sign-in popup was closed before completion.'],
    ['auth/popup-blocked', 'Google popup was blocked by your browser. Please allow popups and try again.'],
    ['auth/unauthorized-domain', 'This domain is not yet authorized in Firebase Console (auth/unauthorized-domain).'],
    ['auth/network-request-failed', 'Sign-in did not complete. Please try again.'],
  ])('explains %s and lets the user retry', async (code, message) => {
    failSignIn(code);
    renderGate();
    emit(null);
    await act(async () => { fireEvent.click(googleButton()); });
    expect(screen.getByText(message)).toBeTruthy();
    expect((googleButton() as HTMLButtonElement).disabled).toBe(false);
    expect(mocks.signInMinimal).toHaveBeenCalledTimes(1);
  });

  it('clears the previous error when the user retries', async () => {
    failSignIn('auth/popup-closed-by-user');
    mocks.signInMinimal.mockResolvedValueOnce({ uid: 'synthetic-uid' });
    renderGate();
    emit(null);
    await act(async () => { fireEvent.click(googleButton()); });
    await act(async () => { fireEvent.click(googleButton()); });
    expect(screen.queryByText('Google sign-in popup was closed before completion.')).toBeNull();
    expect(mocks.signInMinimal).toHaveBeenCalledTimes(2);
  });

  it('disables the button while a sign-in is in flight (no duplicate popups)', async () => {
    let finish!: () => void;
    mocks.signInMinimal.mockReturnValueOnce(new Promise<void>(resolve => { finish = resolve; }));
    renderGate();
    emit(null);
    await act(async () => { fireEvent.click(googleButton()); });
    const busy = screen.getByRole('button', { name: 'Signing in...' }) as HTMLButtonElement;
    expect(busy.disabled).toBe(true);
    fireEvent.click(busy);
    expect(mocks.signInMinimal).toHaveBeenCalledTimes(1);
    await act(async () => { finish(); });
  });

  it('offers the email/password form only on the isolated staging test project', async () => {
    mocks.projectId = 'cyfsa-navigator-e2e-20261108';
    mocks.signInWithEmailAndPassword.mockResolvedValueOnce({ user: { uid: 'staging-uid' } });
    renderGate();
    emit(null);
    const email = screen.getByLabelText('Email') as HTMLInputElement;
    const password = screen.getByLabelText('Password') as HTMLInputElement;
    fireEvent.change(email, { target: { value: 'qa.synthetic.parent@example.com' } });
    fireEvent.change(password, { target: { value: 'synthetic-only' } });
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: 'Sign in to staging' })); });
    expect(mocks.signInWithEmailAndPassword).toHaveBeenCalledWith(expect.anything(), 'qa.synthetic.parent@example.com', 'synthetic-only');
    expect(mocks.signInMinimal).not.toHaveBeenCalled();
    expect(password.value).toBe('');
  });
});
