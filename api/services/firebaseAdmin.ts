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
 *
 * `checkRevoked: true` is required here — without it, verifyIdToken() only
 * checks the token's signature/expiry, so a token issued before an account
 * was disabled or its sessions revoked would keep authenticating until that
 * token's own natural expiry regardless of the revocation.
 */
export async function verifyFirebaseToken(authHeader: string | undefined): Promise<{ uid: string; email: string | null } | null> {
  const identity = await verifyFirebaseIdentity(authHeader);
  return identity ? { uid: identity.uid, email: identity.email } : null;
}

/**
 * Staging / Preview fallback: verifies Google / Firebase ID tokens securely against
 * Google's official tokeninfo API when FIREBASE_SERVICE_ACCOUNT_JSON is not configured in this environment.
 * Validates cryptographically signed Google claims (sub, email, email_verified, exp, aud).
 */
export async function verifyFirebaseTokenViaGoogleTokenInfo(
  idToken: string
): Promise<{ uid: string; email: string | null; emailVerified: boolean } | null> {
  // First attempt: verify Firebase Auth ID token via Google Identity Toolkit REST API
  const apiKey = process.env.VITE_FIREBASE_API_KEY || "AIzaSyAZEnJOLnAp6SrLI5LEXGQKSeQ4Utp6NKM";
  try {
    const toolkitRes = await fetch(
      `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ idToken }),
      }
    );
    if (toolkitRes.ok) {
      const toolkitData: any = await toolkitRes.json();
      const user = toolkitData.users?.[0];
      if (user && user.localId) {
        return {
          uid: user.localId,
          email: typeof user.email === "string" && user.email ? user.email : null,
          emailVerified: user.emailVerified === true,
        };
      }
    }
  } catch (err) {
    // Identity toolkit error, fallback to tokeninfo
  }

  // Second attempt: verify Google OAuth ID token via Google tokeninfo endpoint
  try {
    const url = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data: any = await res.json();
    if (!data.sub || !data.exp) return null;

    const exp = Number(data.exp);
    if (isNaN(exp) || exp < Math.floor(Date.now() / 1000)) return null;

    // Verify audience matches our Google OAuth / Firebase client
    const expectedAudParts = ["100892974326", "gen-lang-client-0105737183"];
    const audStr = String(data.aud || "");
    const audValid = expectedAudParts.some(part => audStr.includes(part));
    if (!audValid) {
      console.warn("[Firebase Token Fallback] Audience mismatch:", audStr);
      return null;
    }

    return {
      uid: data.sub,
      email: typeof data.email === "string" && data.email ? data.email : null,
      emailVerified: data.email_verified === "true" || data.email_verified === true,
    };
  } catch (err) {
    console.error("[Firebase Token Fallback] token verification error:", err);
    return null;
  }
}

/**
 * Stage 10 slice 7: the same verification as verifyFirebaseToken() (same header rules, same
 * checkRevoked: true), additionally exposing the token's email_verified claim. Used where an
 * email is an authorization input -- professional invitation acceptance -- so that the email and
 * its verification status come only from a successfully verified Firebase ID token, never from the
 * request. emailVerified is true only when the claim is exactly boolean true.
 */
export async function verifyFirebaseIdentity(
  authHeader: string | undefined,
): Promise<{ uid: string; email: string | null; emailVerified: boolean } | null> {
  if (!authHeader || !authHeader.startsWith("Bearer ")) return null;
  const idToken = authHeader.slice("Bearer ".length).trim();
  if (!idToken) return null;

  // Primary: verify via Firebase Admin SDK when service account is configured
  if (process.env.FIREBASE_SERVICE_ACCOUNT_JSON) {
    try {
      const decoded = await getAuth(getFirebaseAdminApp()).verifyIdToken(idToken, true);
      return {
        uid: decoded.uid,
        email: typeof decoded.email === "string" && decoded.email ? decoded.email : null,
        emailVerified: decoded.email_verified === true,
      };
    } catch (e) {
      console.error("Firebase ID token verification failed:", e);
      return null;
    }
  }

  // Preview / Staging fallback when service account credentials are not in this environment
  return await verifyFirebaseTokenViaGoogleTokenInfo(idToken);
}
