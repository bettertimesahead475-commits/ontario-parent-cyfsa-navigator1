import React, { useEffect, useRef, useState } from 'react';
import { useLocation } from 'wouter';
import { signOut } from 'firebase/auth';
import { apiFetch } from '../utils/api';
import { auth } from '../utils/firebase';
import { discardInvitationToken, heldInvitationToken, invitationCaptureStatus } from '../utils/invitationFragment';

// Stage 10 slice 8: /accept-invitation. Rendered inside RequireAuth, so the visitor is signed in.
//
// The token was captured from the #t= fragment and scrubbed from the URL by src/main.tsx before
// React started; it is read from memory only at the moment of the accept request and sent only in
// that authenticated POST body. Authorization (verified email = invitation recipient, active
// account, not an owner/grantor) is decided by the server; this page decides nothing.
//
// Non-enumeration: every refusal that concerns the invitation itself -- unknown, used, revoked,
// expired, addressed to someone else, or the caller owns the matter -- shows ONE message. Nothing
// about the invitation (recipient, matter, owner, status, expiry) is ever shown here.

type Phase = 'ready' | 'accepting' | 'refused' | 'unverified' | 'limited' | 'signin' | 'unavailable' | 'accepted';

export const ACCEPT_MESSAGES: Readonly<Record<Exclude<Phase, 'ready' | 'accepting'>, string>> = Object.freeze({
  refused: "This invitation can't be accepted with the current account. Invitations work only for the email address they were created for. If you have another account, sign in with it and try again, or ask the matter owner for a new invitation.",
  unverified: 'The email address on your sign-in account is not verified. Verify it with your sign-in provider, then open the invitation link again.',
  limited: 'Too many attempts. Please wait a few minutes and try again.',
  signin: 'Your sign-in has expired. Sign in again to continue.',
  unavailable: 'Invitations are unavailable right now. Please try again later.',
  accepted: 'Invitation accepted. Opening your Professional Workspace…',
});
export const MISSING_LINK_MESSAGE = 'This invitation link is incomplete or not valid. Open the full link you were sent, or ask the matter owner for a new invitation.';

export default function AcceptInvitation() {
  const [, setLocation] = useLocation();
  // Read once: the page never re-derives anything from the URL.
  const [linkStatus] = useState(invitationCaptureStatus);
  const [phase, setPhase] = useState<Phase>('ready');
  const messageRef = useRef<HTMLParagraphElement>(null);
  const signedInAs = auth.currentUser?.email ?? null;

  useEffect(() => {
    if (phase !== 'ready' && phase !== 'accepting') messageRef.current?.focus();
  }, [phase]);

  async function accept() {
    const token = heldInvitationToken();
    if (!token) return;
    setPhase('accepting');
    let status = 0;
    let body: any = null;
    try {
      const res = await apiFetch('/api/access-invitations/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
      status = res.status;
      try { body = await res.json(); } catch { body = null; }
    } catch {
      setPhase('unavailable');
      return;
    }
    if (status === 200 && body && typeof body.matterId === 'string') {
      discardInvitationToken();
      setPhase('accepted');
      setLocation('/professional-workspace');
      return;
    }
    if (status === 403 && body?.code === 'EMAIL_NOT_VERIFIED') setPhase('unverified');
    else if (status === 429) setPhase('limited');
    else if (status === 401) setPhase('signin');
    else if (status === 410 || status === 409 || status === 403) setPhase('refused');
    else setPhase('unavailable');
  }

  async function switchAccount() {
    // The token stays in memory; RequireAuth shows its sign-in prompt in place (a popup, no reload).
    try { await signOut(auth); } catch { /* the page stays as it is */ }
  }

  if (linkStatus !== 'present') {
    return (
      <section className="max-w-xl mx-auto px-4 py-10" aria-labelledby="accept-invitation-heading">
        <h1 id="accept-invitation-heading" className="font-display font-bold text-xl text-slate-900 mb-3">Professional invitation</h1>
        <p role="alert" className="p-3 rounded bg-amber-50 text-amber-900">{MISSING_LINK_MESSAGE}</p>
      </section>
    );
  }

  const message = phase === 'ready' || phase === 'accepting' ? null : ACCEPT_MESSAGES[phase];
  return (
    <section className="max-w-xl mx-auto px-4 py-10" aria-labelledby="accept-invitation-heading">
      <h1 id="accept-invitation-heading" className="font-display font-bold text-xl text-slate-900 mb-3">Professional invitation</h1>
      <p className="text-sm text-slate-700 mb-2">
        Accepting gives you review access to one matter in your Professional Workspace. The invitation works only for the
        verified email address it was created for.
      </p>
      {signedInAs && <p className="text-sm text-slate-700 mb-4">You are signed in as <strong>{signedInAs}</strong>.</p>}
      {message && (
        <p ref={messageRef} tabIndex={-1} role={phase === 'accepted' ? 'status' : 'alert'}
          className={`p-3 rounded mb-4 ${phase === 'accepted' ? 'bg-emerald-50 text-emerald-900' : 'bg-amber-50 text-amber-900'}`}>
          {message}
        </p>
      )}
      {phase === 'accepting' && <p role="status" className="text-sm mb-4">Accepting invitation…</p>}
      {phase !== 'accepted' && (
        <div className="flex flex-wrap gap-3">
          <button type="button" onClick={() => void accept()} disabled={phase === 'accepting'}
            className="px-4 py-2 rounded bg-indigo-700 text-white font-semibold disabled:opacity-60">
            Accept invitation
          </button>
          <button type="button" onClick={() => void switchAccount()} disabled={phase === 'accepting'} className="px-4 py-2 rounded border">
            Sign in with a different account
          </button>
        </div>
      )}
    </section>
  );
}
