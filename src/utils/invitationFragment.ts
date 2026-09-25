// Stage 10 slice 8: capture-and-scrub for professional invitation links.
//
// Invitation links have the form  <origin>/accept-invitation#t=<token>  (STAGE_10_COMPLETION_DECISIONS.md §7).
// A URL fragment is never sent to a server, but anything running in the page can read
// window.location -- including the globally mounted Vercel Web Analytics and Speed Insights
// collectors. This module is therefore imported FIRST by src/main.tsx: ES modules evaluate in import
// order, so the capture below runs before App.tsx (and the telemetry packages it imports) is
// evaluated and long before React mounts and those components inject their collector scripts.
//
// The raw token lives ONLY in the module-scoped variable below: never in localStorage,
// sessionStorage, cookies, IndexedDB, router state, a query string, a path, a log line or telemetry.
// Sign-in is a Firebase popup (src/utils/firebase.ts) that never navigates the page, so this memory
// survives authentication. A full reload loses it on purpose; the link must then be opened again.

export const INVITATION_PATH = '/accept-invitation';

// The service issues 32 random bytes as base64url: exactly 43 characters (same rule as the server).
const TOKEN_SHAPE = /^[A-Za-z0-9_-]{43}$/;
// Any fragment that carries a `t=` parameter is scrubbed wherever it lands, even off the invitation
// path (a mis-pasted link must not sit in the address bar for telemetry to read).
const TOKEN_PARAM_IN_FRAGMENT = /(^|[#&;])t=/;

export type InvitationCapture =
  | { status: 'none' }
  | { status: 'malformed' }
  | { status: 'present'; token: string };

let held: InvitationCapture = { status: 'none' };

interface LocationLike { pathname: string; search: string; hash: string }
interface HistoryLike { state: unknown; replaceState(data: unknown, unused: string, url?: string | null): void }

/**
 * Reads an invitation token from the fragment, keeps it in memory, and removes the fragment from the
 * visible URL and the current history entry with history.replaceState (no navigation, no reload, no
 * new history entry). Returns what was captured. Exported for tests; runs once at module load.
 */
export function captureInvitationFragment(loc: LocationLike, hist: HistoryLike): InvitationCapture {
  const hash = typeof loc.hash === 'string' ? loc.hash : '';
  if (!hash || !TOKEN_PARAM_IN_FRAGMENT.test(hash)) return held;

  // Scrub FIRST, before anything else can observe the URL.
  try {
    hist.replaceState(hist.state, '', `${loc.pathname}${loc.search}`);
  } catch {
    // replaceState can only fail in exotic sandboxes; the token is still never persisted anywhere.
  }

  if (loc.pathname !== INVITATION_PATH) return held;
  let value: string | null = null;
  try {
    // Exactly one t= value; an ambiguous fragment (t=A&t=B) is refused, not resolved by position.
    const values = new URLSearchParams(hash.slice(1)).getAll('t');
    value = values.length === 1 ? values[0] : null;
  } catch {
    value = null;
  }
  held = value !== null && TOKEN_SHAPE.test(value) ? { status: 'present', token: value } : { status: 'malformed' };
  return held;
}

/** What the acceptance page should do. The token itself is only handed to the accept request. */
export function invitationCaptureStatus(): InvitationCapture['status'] {
  return held.status;
}

/** The in-memory token, for the authenticated acceptance request body only. */
export function heldInvitationToken(): string | null {
  return held.status === 'present' ? held.token : null;
}

/** Destroys the in-memory token (after successful acceptance, or when the page is left). */
export function discardInvitationToken(): void {
  held = { status: 'none' };
}

/** True when `text` contains the held token. Used by the telemetry backstop. */
export function containsHeldInvitationToken(text: string): boolean {
  return held.status === 'present' && typeof text === 'string' && text.includes(held.token);
}

if (typeof window !== 'undefined' && window.location && window.history) {
  captureInvitationFragment(window.location, window.history);
  // A link pasted into the address bar of an already-open app changes only the fragment: no reload,
  // just popstate then hashchange. These listeners are registered at module load, before any
  // telemetry script exists, so they run before any listener such a script adds later.
  const recapture = () => captureInvitationFragment(window.location, window.history);
  window.addEventListener('popstate', recapture);
  window.addEventListener('hashchange', recapture);
}
