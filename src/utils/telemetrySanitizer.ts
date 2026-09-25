// Stage 10 slice 8: telemetry backstop for invitation tokens.
//
// PRIMARY protection is src/utils/invitationFragment.ts, which removes `#t=<token>` from the URL
// before React mounts and therefore before Vercel Web Analytics / Speed Insights inject their
// collector scripts (both inject from a React useEffect). This is the second line: both packages
// hand every outgoing event to `beforeSend({ type, url, ... })`, and this function
//   - removes the fragment from every URL (the app never needs fragments in telemetry),
//   - removes a `t` / `token` query parameter, and all query text on the invitation path,
//   - drops the event entirely (returns null) if the token still appears anywhere in it, or if the
//     URL cannot be parsed.

import { INVITATION_PATH, containsHeldInvitationToken } from './invitationFragment';

const SENSITIVE_PARAMS = ['t', 'token'];
// A 43-character base64url run is the invitation token's shape. Nothing legitimate in this app's
// telemetry URLs has that shape; an event that carries one is dropped rather than guessed at.
const TOKEN_SHAPED = /(^|[^A-Za-z0-9_-])[A-Za-z0-9_-]{43}([^A-Za-z0-9_-]|$)/;

export function sanitizeTelemetryUrl(raw: string): string | null {
  let url: URL;
  try {
    url = new URL(raw, typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
  } catch {
    return null;
  }
  url.hash = '';
  for (const p of SENSITIVE_PARAMS) url.searchParams.delete(p);
  if (url.pathname === INVITATION_PATH || url.pathname.startsWith(`${INVITATION_PATH}/`)) url.search = '';
  const out = url.toString();
  if (containsHeldInvitationToken(out) || containsHeldInvitationToken(decodeSafely(out))) return null;
  if (TOKEN_SHAPED.test(url.pathname) || TOKEN_SHAPED.test(decodeSafely(url.search))) return null;
  return out;
}

function decodeSafely(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

/**
 * beforeSend for @vercel/analytics and @vercel/speed-insights. Returns a copy with a sanitized URL,
 * or null to drop the event.
 */
export function sanitizeTelemetryEvent<E extends { url: string }>(event: E): E | null {
  if (!event || typeof event.url !== 'string') return null;
  const url = sanitizeTelemetryUrl(event.url);
  if (url === null) return null;
  const copy = { ...event, url };
  // Any other field that happens to carry the token (e.g. custom event data) drops the event.
  let serialized = '';
  try { serialized = JSON.stringify(copy); } catch { return null; }
  if (containsHeldInvitationToken(serialized)) return null;
  return copy;
}
