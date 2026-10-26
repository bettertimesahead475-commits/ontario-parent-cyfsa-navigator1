/**
 * One Deep Scan is one analysis id. A retry of a scan that is held for billing must send the same id, so the server
 * recovers the held report instead of starting (and paying for) a second model run. These helpers keep that id stable
 * per file until the scan completes or fails terminally.
 */

/** The pending analysis id per file, keyed by file id. */
export type DeepScanPendingIds = Record<string, string>;

/** Matches the server's analysis id format: req_<10-16 digits>_<4-24 alphanumerics>. */
const ANALYSIS_ID_PATTERN = /^req_\d{10,16}_[a-z0-9]{4,24}$/i;

export function newDeepScanAnalysisId(now: number = Date.now(), random: () => number = Math.random): string {
  const suffix = random().toString(36).slice(2).padEnd(8, "0").slice(0, 8);
  return `req_${now}_${suffix}`;
}

export function isDeepScanAnalysisId(value: unknown): value is string {
  return typeof value === "string" && ANALYSIS_ID_PATTERN.test(value);
}

/** The analysis id to send for this file: the one already in flight, or a new one. Never reuses an id that is malformed. */
export function deepScanIdFor(pending: Record<string, string>, fileId: string): { id: string; pending: Record<string, string> } {
  const existing = pending[fileId];
  if (isDeepScanAnalysisId(existing)) return { id: existing, pending };
  const id = newDeepScanAnalysisId();
  return { id, pending: { ...pending, [fileId]: id } };
}

/** Forgets a file's id once its scan has completed or failed terminally. */
export function clearDeepScanId(pending: Record<string, string>, fileId: string): Record<string, string> {
  if (!(fileId in pending)) return pending;
  const next = { ...pending };
  delete next[fileId];
  return next;
}
