/** Browser-local migration notice helpers. These do not require Firebase Auth. */
const LEGACY_KEYS_TO_CHECK = [
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

export function shouldShowMigrationNotice(): boolean {
  try {
    if (localStorage.getItem(MIGRATION_SEEN_FLAG)) return false;
    return LEGACY_KEYS_TO_CHECK.some((key) => localStorage.getItem(key) !== null);
  } catch {
    return false;
  }
}

export function markMigrationNoticeSeen(): void {
  try {
    localStorage.setItem(MIGRATION_SEEN_FLAG, "true");
  } catch {
    // Best effort; if storage is unavailable, there is nothing meaningful to mark.
  }
}
