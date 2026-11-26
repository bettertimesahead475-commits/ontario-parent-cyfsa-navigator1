/**
 * Account-isolated completed-report cache: pure key and policy functions (DEVIN-PERF-03). Not wired into
 * /api/analyze yet; wiring and the pending migration create_navigator_report_cache.sql need Claude's review and
 * owner approval.
 *
 * Rules:
 * - The document fingerprint is an HMAC keyed by a server secret and bound to the owner, so the same document in two
 *   accounts has unrelated fingerprints and a fingerprint reveals nothing about the text.
 * - The cache key covers every input that changes a report: mode, analyzer pipeline, prompts, models, legal reference
 *   consolidation and its effective date. Any change is a miss, never a stale hit.
 * - A hit is returned as a previously completed report with its original completion time, never as a new analysis,
 *   and it consumes no credit.
 */

export const REPORT_CACHE_KEY_VERSION = 'v1';

export interface ReportCacheVersions {
  mode: 'fast' | 'full' | 'final_case_assessment';
  analyzerVersion: string;
  promptVersion: string;
  primaryModel: string;
  verificationModel: string | null;
  legalReferenceVersion: string;
  legalEffectiveDate: string;
}

export interface ReportCacheEntry {
  ownerUid: string;
  cacheKey: string;
  jobId: string;
  status: 'completed' | 'failed' | 'running';
  completedAt: string;
  expiresAt: string;
  deletedAt: string | null;
  keyVersion: string;
}

export type CacheDecision =
  | { usable: true }
  | { usable: false; reason: 'OWNER_MISMATCH' | 'KEY_MISMATCH' | 'DELETED' | 'EXPIRED' | 'NOT_COMPLETED' | 'KEY_VERSION' };

const encoder = new TextEncoder();

function hex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer), (b) => b.toString(16).padStart(2, '0')).join('');
}

async function hmacSha256(secret: string, message: string): Promise<string> {
  if (!secret || secret.length < 32) throw new Error('REPORT_CACHE_SECRET must be at least 32 characters.');
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(message)));
}

/** Only line endings and Unicode composition are normalized; any change to the words is a different document. */
export function normalizeForFingerprint(text: string): string {
  return text.replace(/\r\n?/g, '\n').normalize('NFC');
}

export async function documentFingerprint(secret: string, ownerUid: string, documentText: string): Promise<string> {
  if (!ownerUid) throw new Error('An owner is required for a document fingerprint.');
  return hmacSha256(secret, `doc\u0000${ownerUid}\u0000${normalizeForFingerprint(documentText)}`);
}

export async function reportCacheKey(secret: string, ownerUid: string, fingerprint: string, versions: ReportCacheVersions): Promise<string> {
  const fields: Array<keyof ReportCacheVersions> = ['mode', 'analyzerVersion', 'promptVersion', 'primaryModel', 'verificationModel', 'legalReferenceVersion', 'legalEffectiveDate'];
  for (const f of fields) {
    if (f !== 'verificationModel' && !versions[f]) throw new Error(`Report cache key needs ${f}.`);
  }
  const canonical = JSON.stringify([REPORT_CACHE_KEY_VERSION, ownerUid, fingerprint, ...fields.map((f) => versions[f] ?? null)]);
  return hmacSha256(secret, `key\u0000${canonical}`);
}

export function evaluateCacheEntry(entry: ReportCacheEntry, ctx: { ownerUid: string; cacheKey: string; now: number }): CacheDecision {
  if (!ctx.ownerUid || entry.ownerUid !== ctx.ownerUid) return { usable: false, reason: 'OWNER_MISMATCH' };
  if (entry.keyVersion !== REPORT_CACHE_KEY_VERSION) return { usable: false, reason: 'KEY_VERSION' };
  if (entry.cacheKey !== ctx.cacheKey) return { usable: false, reason: 'KEY_MISMATCH' };
  if (entry.deletedAt) return { usable: false, reason: 'DELETED' };
  if (!(Date.parse(entry.expiresAt) > ctx.now)) return { usable: false, reason: 'EXPIRED' };
  if (entry.status !== 'completed' || !entry.completedAt) return { usable: false, reason: 'NOT_COMPLETED' };
  return { usable: true };
}

/** Marks a cache hit as a previously completed report. Never presents it as new and never charges. */
export function presentCachedReport<T extends Record<string, unknown>>(report: T, entry: ReportCacheEntry, now: number) {
  return {
    ...report,
    delivery: {
      source: 'previously_completed' as const,
      originalJobId: entry.jobId,
      originalCompletedAt: entry.completedAt,
      retrievedAt: new Date(now).toISOString(),
      creditsCharged: 0,
    },
  };
}
