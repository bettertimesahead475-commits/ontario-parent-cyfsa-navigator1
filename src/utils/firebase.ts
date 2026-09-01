import { initializeApp } from 'firebase/app';
import { getAuth, signInWithPopup, signInWithRedirect, getRedirectResult, GoogleAuthProvider, onAuthStateChanged, User } from 'firebase/auth';
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
 * BUG FOUND: this originally used signInWithPopup(), which is well-known to fail silently on
 * mobile browsers - the popup opens, flashes briefly, then closes on its own due to
 * third-party storage/cookie restrictions common on mobile Chrome, with no usable error ever
 * surfacing (exactly the "click it, it flashes, disappears, asks to click again" symptom).
 * Switched to signInWithRedirect(), the standard, mobile-reliable alternative: it navigates
 * the whole page to Google's sign-in flow and back, rather than relying on a popup window
 * that mobile browsers often can't complete. See getRedirectSignInResult() below, which
 * RequireAuth.tsx calls on mount to pick up the result after the redirect completes.
 */
export const signInMinimal = async (): Promise<void> => {
  const minimalProvider = new GoogleAuthProvider();
  await signInWithRedirect(auth, minimalProvider);
  // The browser navigates away here - there is nothing further to do in this function.
  // The actual signed-in user is picked up after redirect via getRedirectSignInResult().
};

/**
 * Call this once, on app/component mount, to complete a signInWithRedirect() flow that was
 * started by signInMinimal() above. Returns the signed-in user if a redirect just completed,
 * or null if there was no pending redirect (the normal case on every load that isn't
 * immediately after a sign-in attempt).
 */
export const getRedirectSignInResult = async (): Promise<User | null> => {
  try {
    const result = await getRedirectResult(auth);
    return result?.user || null;
  } catch (error: any) {
    console.error('Redirect sign-in error:', error);
    throw error;
  }
};

export const logout = async () => {
  await auth.signOut();
  cachedAccessToken = null;
};
