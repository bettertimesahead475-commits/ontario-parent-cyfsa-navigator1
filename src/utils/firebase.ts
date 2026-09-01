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
 * BUG FOUND IN AUDIT: the only sign-in flow that existed (googleSignIn above) requests
 * Drive/Gmail/Photos read access as part of ONE popup consent screen - meaning making sign-in
 * mandatory as-is would force every new user to grant broad Google data access just to open
 * the analyzer, whether or not they ever use "Connect Google Services". This is a separate,
 * minimal-scope popup (email/profile only, no addScope calls) for that mandatory gate. The
 * existing googleSignIn/provider above remains untouched and still only fires when someone
 * explicitly clicks "Connect Google Services".
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
