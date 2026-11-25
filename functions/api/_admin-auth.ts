/**
 * Administrator authorization for /api/admin/*.
 *
 * Replaces the former shared ADMIN_SECRET that the admin pages kept in browser sessionStorage. An administrator is
 * a Firebase user whose ID token verifies against this project, whose email is verified, and whose email is on the
 * server-side allowlist (ADMIN_EMAILS, comma separated; defaults to the site owner). ADMIN_UIDS, when set, further
 * pins the allowed Firebase account ids. Nothing secret is ever sent to or stored by the browser.
 */
import { verifyFirebaseRequest } from './_auth-check';

export type AdminAuthEnv = { FIREBASE_PROJECT_ID?: string; ADMIN_EMAILS?: string; ADMIN_UIDS?: string };
export type AdminIdentity = { uid: string; email: string };
type Verify = typeof verifyFirebaseRequest;

export const DEFAULT_ADMIN_EMAILS: readonly string[] = ['mr.pelkie@gmail.com'];
export const ADMIN_HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } as const;

function list(raw: string | undefined): string[] {
  return (raw || '').split(',').map((v) => v.trim().toLowerCase()).filter(Boolean);
}

export function adminEmails(env: AdminAuthEnv): string[] {
  const configured = list(env.ADMIN_EMAILS);
  return configured.length ? configured : [...DEFAULT_ADMIN_EMAILS];
}

export function adminError(code: string, status: number, error: string): Response {
  return Response.json({ error, code, retryable: status >= 500 }, { status, headers: ADMIN_HEADERS });
}

export async function requireAdmin(
  request: Request,
  env: AdminAuthEnv,
  verify: Verify = verifyFirebaseRequest,
): Promise<{ admin: AdminIdentity } | { response: Response }> {
  const identity = await verify(request, env);
  if (identity.status === 'unavailable') return { response: adminError('AUTH_UNAVAILABLE', 503, 'Sign-in verification is temporarily unavailable.') };
  if (identity.status !== 'verified') return { response: adminError('AUTH_REQUIRED', 401, 'Sign in with an administrator account.') };
  const email = identity.email?.trim().toLowerCase() || '';
  const uids = list(env.ADMIN_UIDS);
  const allowed = identity.emailVerified && email !== '' && adminEmails(env).includes(email)
    && (uids.length === 0 || uids.includes(identity.uid.toLowerCase()));
  if (!allowed) {
    // No email or uid in logs: only that a signed-in non-administrator was refused.
    console.warn('[ADMIN_ACCESS_DENIED]', JSON.stringify({ path: new URL(request.url).pathname, emailVerified: identity.emailVerified }));
    return { response: adminError('ADMIN_REQUIRED', 403, 'This account is not an administrator.') };
  }
  return { admin: { uid: identity.uid, email } };
}
