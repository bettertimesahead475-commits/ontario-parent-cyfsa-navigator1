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
import { auth, signInMinimal } from "../utils/firebase";
import { Shield, Loader2 } from "lucide-react";

export default function RequireAuth({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null | undefined>(undefined); // undefined = still checking
  const [signingIn, setSigningIn] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Safety timeout: Never stay stuck on undefined if IndexedDB or network hangs
    const timer = setTimeout(() => {
      setUser((current) => (current === undefined ? null : current));
    }, 2000);

    const unsubscribe = onAuthStateChanged(
      auth,
      (u) => {
        clearTimeout(timer);
        setUser(u);
      },
      (err) => {
        console.warn("[RequireAuth] Auth state subscription warning:", err);
        clearTimeout(timer);
        setUser(null);
      }
    );

    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, []);

  const handleSignIn = async () => {
    setSigningIn(true);
    setError(null);
    try {
      await signInMinimal();
      // onAuthStateChanged above will pick up the new user automatically.
    } catch (e: any) {
      const code = e?.code || "";
      if (code === "auth/popup-blocked") {
        setError("Google popup was blocked by your browser. Please allow popups and try again.");
      } else if (code === "auth/unauthorized-domain") {
        setError("This domain is not yet authorized in Firebase Console (auth/unauthorized-domain).");
      } else if (code === "auth/popup-closed-by-user") {
        setError("Google sign-in popup was closed before completion.");
      } else {
        setError("Sign-in did not complete. Please try again.");
      }
    } finally {
      setSigningIn(false);
    }
  };

  if (user === undefined) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] gap-3">
        <Loader2 className="w-6 h-6 animate-spin text-brand-500" />
        <span className="text-xs text-slate-400 font-sans">Connecting secure session...</span>
      </div>
    );
  }

  if (user === null) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] px-6 text-center font-sans">
        <div className="w-14 h-14 rounded-2xl bg-brand-50 flex items-center justify-center mb-4 border border-brand-100 shadow-xs">
          <Shield className="w-7 h-7 text-brand-600" />
        </div>
        <h2 className="font-display font-bold text-xl text-slate-900 mb-2">
          Sign in to continue
        </h2>
        <p className="text-sm text-slate-500 max-w-sm mb-6 leading-relaxed">
          Your documents, analysis, and notes are kept private to your own account - this
          keeps two different people using the same computer from ever seeing each other's
          case information.
        </p>

        <div className="flex flex-col sm:flex-row items-center gap-3">
          <button
            onClick={handleSignIn}
            disabled={signingIn}
            className="w-full sm:w-auto px-6 py-3 bg-slate-900 hover:bg-slate-800 text-white rounded-xl text-sm font-semibold disabled:bg-slate-300 transition-all cursor-pointer shadow-xs"
          >
            {signingIn ? "Connecting Google..." : "Sign in with Google"}
          </button>
        </div>

        {error && <p className="text-xs text-red-600 mt-4 max-w-sm bg-red-50 p-2.5 rounded-lg border border-red-200">{error}</p>}
        
        <p className="text-[11px] text-slate-400 mt-5 max-w-xs leading-normal">
          This only asks for your name and email to keep your account separate from others -
          it does not request access to your Gmail, Drive, or Photos.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}
