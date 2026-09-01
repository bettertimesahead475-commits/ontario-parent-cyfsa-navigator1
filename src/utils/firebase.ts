import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
import firebaseConfig from '../../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

const provider = new GoogleAuthProvider();
provider.addScope('https://www.googleapis.com/auth/drive.readonly');
provider.addScope('https://www.googleapis.com/auth/gmail.readonly');
provider.addScope('https://www.googleapis.com/auth/photoslibrary.readonly');

let isSigningIn = false;
let cachedAccessToken: string | null = null;

export const initAuth = (
  onAuthSuccess?: (user: User, token: string) => void,
  onAuthFailure?: () => void
) => {
  return onAuthStateChanged(auth, async (user: User | null) => {
    if (user) {
      if (cachedAccessToken) {
        if (onAuthSuccess) onAuthSuccess(user, cachedAccessToken);
      } else if (!isSigningIn) {
        cachedAccessToken = null;
        if (onAuthFailure) onAuthFailure();
      }
    } else {
      cachedAccessToken = null;
      if (onAuthFailure) onAuthFailure();
    }
  });
};

export const googleSignIn = async (): Promise<{ user: User; accessToken: string } | null> => {
  try {
    isSigningIn = true;
    const result = await signInWithPopup(auth, provider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    if (!credential?.accessToken) {
      throw new Error('Failed to get access token from Firebase Auth');
    }

    cachedAccessToken = credential.accessToken;
    return { user: result.user, accessToken: cachedAccessToken };
  } catch (error: any) {
    console.error('Sign in error:', error);
    throw error;
  } finally {
    isSigningIn = false;
  }
};

export const getAccessToken = async (): Promise<string | null> => {
  return cachedAccessToken;
};

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

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};
