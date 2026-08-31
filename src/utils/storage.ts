/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Per-user localStorage namespacing.
 *
 * Every key listed in STATIC_MIGRATION_KEYS used to be a single, global localStorage key
 * shared by every visitor to the app - meaning two different parents on the same shared
 * computer (a library, a shelter, a borrowed phone) could see each other's case documents,
 * profile name, and dictated notes. getUserKey() namespaces every one of those keys by the
 * signed-in user's own Firebase uid, so two different accounts on the same device never
 * collide. See the one-time migration notice below for what happens to data that was written
 * before this existed.
 */
import { auth } from "./firebase";

/**
 * Returns the namespaced version of a legacy global key for the CURRENTLY signed-in user.
 * Returns null if nobody is signed in - callers behind the sign-in gate should never hit that
 * case in practice, but the null return (rather than silently falling back to the old global
 * key) is deliberate: it's a loud signal that something is being read/written outside the gate,
 * not a silent reintroduction of the exact bug this exists to fix.
 */
export function getUserKey(baseKey: string): string | null {
  const uid = auth.currentUser?.uid;
  if (!uid) return null;
  return `${baseKey}_${uid}`;
}

/** Every legacy global key that held real user data before namespacing existed. */
export const LEGACY_KEYS_TO_CHECK = [
  "OPA_USER_PROFILE",
  "OPA_DOC_ANALYZER_PROGRESS",
  "OPA_DEEPSCAN_REPORTS",
  "OPA_TEMPLATES_PROGRESS",
  "OPA_HANDOVER_ALERT",
  "OPA_PASSPORT_NOTES",
  "ps_session_token",
  "ps_session_tier",
  "ps_session_email",
  "OPA_MEMBERSHIP_TIER",
];

const MIGRATION_SEEN_FLAG = "OPA_MIGRATION_NOTICE_SEEN";

/**
 * Checks whether this browser profile has old, un-namespaced data sitting around from before
 * accounts existed. Per the agreed design: this is NEVER silently copied into a specific
 * account, since there's no way to know whose data it actually was - especially important on
 * a shared computer where it could belong to a different person entirely than whoever signs
 * in first. Returns true exactly once per browser profile (not once per account, so a second
 * person signing in on the same shared machine still gets the chance to see/export it).
 */
export function shouldShowMigrationNotice(): boolean {
  try {
    if (localStorage.getItem(MIGRATION_SEEN_FLAG)) return false;
    return LEGACY_KEYS_TO_CHECK.some((key) => localStorage.getItem(key) !== null);
  } catch {
    return false;
  }
}

/** Marks the migration notice as seen for this browser profile (not per-account - see above). */
export function markMigrationNoticeSeen(): void {
  try {
    localStorage.setItem(MIGRATION_SEEN_FLAG, "true");
  } catch {
    /* best-effort; if storage is unavailable there's nothing meaningful to do here */
  }
}
