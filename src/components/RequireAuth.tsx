/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Wraps /document-analyzer, /templates, and /signup - the three routes that touch real,
 * per-user case data. Everything else in the app (the CYFSA guide, child development info,
 * lawyer directory, the free "OPA Coach" chat, etc.) stays reachable with zero sign-in, per
 * the explicit rule that informational content is always free and never gated.
 */
import { useEffect, useState, ReactNode } from "react";
import { onAuthStateChanged, User } from "firebase/auth";
import { auth, signInMinimal, getRedirectSignInResult } from "../utils/firebase";
import { Shield, Loader2 } from "lucide-react";

export default function RequireAuth({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined); // undefined = still checking
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Pick up the result of a signInWithRedirect() that just completed (the page will have
    // navigated away to Google and back by the time this runs). Must run before/alongside
    // onAuthStateChanged below, since on some browsers the redirect result needs to be
    // consumed once before the auth state listener reliably reflects the new user.
    getRedirectSignInResult().catch((e: any) => {
      setError("Sign-in didn't go through. Please try again.");
    });

    const unsubscribe = onAuthStateChanged(auth, (u) => setUser(u));
    return () => unsubscribe();
  }, []);

  const handleSignIn = async () => {
    setSigningIn(true);
    setError(null);
    try {
      await signInMinimal();
      // signInWithRedirect navigates the whole page away - nothing more happens here until
      // the page reloads after Google's flow completes.
    } catch (e: any) {
      setError("Sign-in didn't go through. Please try again.");
      setSigningIn(false);
    }
  };

  if (user === undefined) {
    // Still checking whether a session already exists - avoid a flash of the sign-in prompt
    // for someone who's actually already signed in.
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <Loader2 className="w-6 h-6 animate-spin text-brand-500" />
      </div>
    );
  }

  if (user === null) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center">
        <div className="w-14 h-14 rounded-2xl bg-brand-50 flex items-center justify-center mb-4">
          <Shield className="w-7 h-7 text-brand-600" />
        </div>
        <h2 className="font-display font-bold text-lg text-slate-900 mb-2">
          Sign in to continue
        </h2>
        <p className="text-sm text-slate-500 max-w-sm mb-6">
          Your documents, analysis, and notes are kept private to your own account - this
          keeps two different people using the same computer from ever seeing each other's
          case information.
        </p>
        <button
          onClick={handleSignIn}
          disabled={signingIn}
          className="px-5 py-2.5 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-semibold disabled:bg-slate-300"
        >
          {signingIn ? "Signing in..." : "Sign in with Google"}
        </button>
        {error && <p className="text-xs text-red-600 mt-3">{error}</p>}
        <p className="text-[11px] text-slate-400 mt-4 max-w-xs">
          This only asks for your name and email to keep your account separate from others -
          it does not request access to your Gmail, Drive, or Photos.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
