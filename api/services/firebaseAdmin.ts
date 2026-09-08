// ---------------------------------------------------------------------------
// Verifies the Firebase ID token a signed-in parent's browser sends with each
// request, so the server can identify *who* is asking without trusting a
// uid the client could just type in. This is what makes the free-tier limit
// in usage.ts actually enforceable — without it, "1 free analysis per
// account" would just be a client-side number anyone could edit or clear.
// ---------------------------------------------------------------------------

import { initializeApp, cert, getApps, type App } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";

let app: App | null = null;

function getFirebaseAdminApp(): App {
  if (app) return app;
  if (getApps().length > 0) {
    app = getApps()[0];
    return app;
  }

  const raw = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (!raw) {
    throw Object.assign(
      new Error(
        "FIREBASE_SERVICE_ACCOUNT_JSON is not configured. Generate a service account key in Firebase Console → Project Settings → Service Accounts → Generate New Private Key, then paste the entire JSON file as one line into this Vercel env var."
      ),
      { statusCode: 503 }
    );
  }

  let serviceAccount: any;
  try {
    serviceAccount = JSON.parse(raw);
  } catch {
    throw Object.assign(
      new Error("FIREBASE_SERVICE_ACCOUNT_JSON is not valid JSON. Paste the full downloaded service-account file contents, unmodified, as one line."),
      { statusCode: 503 }
    );
  }

  app = initializeApp({ credential: cert(serviceAccount) });
  return app;
}

/**
 * Verifies a Firebase ID token (sent as `Authorization: Bearer <token>`).
 * Returns the verified uid/email, or null if the header is missing, malformed,
 * or the token doesn't check out — callers decide what "no verified identity"
 * means for their route (usually: treat as an unauthenticated free-tier check
 * that has zero free uses left, not as an error).
 */
export async function verifyFirebaseToken(authHeader: string | undefined): Promise<{ uid: string; email: string | null } | null> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const idToken = authHeader.slice("Bearer ".length).trim();
  if (!idToken) return null;

  try {
    const decoded = await getAuth(getFirebaseAdminApp()).verifyIdToken(idToken);
    return { uid: decoded.uid, email: decoded.email || null };
  } catch (e) {
    console.error("Firebase ID token verification failed:", e);
    return null;
  }
}
