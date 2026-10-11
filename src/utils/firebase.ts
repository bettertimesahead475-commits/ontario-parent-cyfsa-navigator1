import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, User, signOut } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

/**
 * Minimal-scope sign-in for the mandatory account gate (analyzer/templates/signup routes).
 *
 * History worth knowing if this ever needs revisiting: this was briefly switched to
 * signInWithRedirect() to work around a "click sign-in, popup flashes and closes" symptom on
 * mobile. That switch turned out to trade one bug for a different one - Chrome's "bounce
 * tracking mitigation" clears storage for gen-lang-client-....firebaseapp.com (the
 * intermediate domain Firebase's redirect flow bounces through) before the app ever gets to
 * read the sign-in result back, so getRedirectResult() came back empty every time (confirmed
 * via Chrome DevTools' Issues tab: "Chrome may soon delete state for intermediate websites in
 * a recent navigation chain"). Reverted to signInWithPopup() - it never navigates the
 * top-level page away, so it isn't affected by that Chrome feature. The original popup
 * failure was very likely actually caused by the domain not yet being on Firebase's
 * Authorized Domains list at the time (a separate, since-fixed issue) - not a fundamental
 * mobile-popup problem, so popup should now work correctly with that fixed.
 */
export const signInMinimal = async (): Promise<User | null> => {
  try {
    const minimalProvider = new GoogleAuthProvider();
    const result = await signInWithPopup(auth, minimalProvider);
    return result.user;
  } catch (error: any) {
    console.error('Minimal sign-in error:', error);
    throw error;
  }
};

/** localStorage pointer to the analysis job a reload should recover (see DocumentAnalyzerTab). */
export const ACTIVE_ANALYZER_JOB_KEY = 'OPA_ACTIVE_ANALYZER_JOB_ID';

/**
 * Ends the Firebase (Google) session so a different account can sign in. Per-user data in
 * localStorage is namespaced by uid (utils/storage.ts), so it stays locked to its owner; only the
 * active-job pointer is cleared so the next account never tries to recover the previous one's job.
 */
export async function signOutOfAccount(): Promise<void> {
  try {
    localStorage.removeItem(ACTIVE_ANALYZER_JOB_KEY);
  } catch {
    /* storage unavailable (private mode) - nothing to clear */
  }
  await signOut(auth);
  window.dispatchEvent(new CustomEvent('opa-user-profile-updated'));
}
