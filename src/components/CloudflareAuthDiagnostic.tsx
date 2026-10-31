import { useState } from 'react';
import { auth, signInMinimal } from '../utils/firebase';

/**
 * Temporary staging-only diagnostic. Never displays or stores Firebase ID tokens.
 * This component is only routed in the Cloudflare migration branch.
 */
export default function CloudflareAuthDiagnostic() {
  const [result, setResult] = useState('Not tested');
  const [busy, setBusy] = useState(false);

  const check = async () => {
    setBusy(true);
    try {
      let user = auth.currentUser;
      if (!user) user = await signInMinimal();
      if (!user) {
        setResult('Sign-in cancelled; no token sent');
        return;
      }
      const token = await user.getIdToken(true);
      const response = await fetch('/api/_auth-check', {
        headers: { Authorization: 'Bearer ' + token },
        cache: 'no-store',
      });
      const body = await response.json() as { authenticated?: boolean; code?: string };
      setResult(response.status + ' — ' + (body.authenticated ? 'Firebase signature verified successfully' : (body.code || 'Authentication rejected')));
    } catch (error: unknown) {
      const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : 'unknown-error';
      const safeCode = /^auth\/[a-z-]+$/.test(code) ? code : 'unknown-error';
      setResult(safeCode === 'auth/unauthorized-domain'
        ? 'Firebase rejected this hostname (auth/unauthorized-domain). Add cyfsa-navigator-git-staging.pages.dev to Firebase Authentication → Settings → Authorized domains.'
        : safeCode === 'auth/popup-blocked'
          ? 'Google popup blocked (auth/popup-blocked). Allow popups for this staging hostname and retry.'
          : safeCode === 'auth/popup-closed-by-user'
            ? 'Google sign-in popup was closed before completion.'
            : 'Authentication failed: ' + safeCode + '. No token was displayed or stored.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mx-auto max-w-xl rounded-xl border p-6 space-y-4">
      <h1 className="text-2xl font-bold">Cloudflare staging — Firebase authentication test</h1>
      <p>This checks a signed-in Firebase ID token against the native Cloudflare verifier. It does not run the analyzer, charge credits, or display your token.</p>
      <button type="button" disabled={busy} onClick={check} className="rounded bg-slate-900 px-5 py-3 text-white disabled:opacity-50">
        {busy ? 'Verifying…' : 'Sign in and verify Firebase'}
      </button>
      <p role="status" aria-live="polite">{result}</p>
      <p className="text-sm text-slate-600">For staging testing only. Do not use on the live production domain.</p>
    </section>
  );
}
