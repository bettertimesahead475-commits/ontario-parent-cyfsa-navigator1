/**
 * Decides whether a Deep Scan may reuse sections from a previously completed analysis of the same document, for
 * the same account. Pure: no provider call, no storage access. Callers supply the candidate from the report cache
 * index (functions/api/_report-cache.ts), which already enforces owner, key, expiry and deletion.
 *
 * A section is reusable only when every input that shaped it is identical: the document, the account, the analyzer
 * and prompt versions, the model, and the legal reference version. Any difference means the section is re-run.
 */
import { evaluateCacheEntry, type ReportCacheEntry, type ReportCacheVersions } from './_report-cache';

export interface ReuseCandidate {
  entry: ReportCacheEntry;
  versions: ReportCacheVersions;
  documentFingerprint: string;
  /** Section ids the candidate report completed. */
  completedSections: string[];
}

export interface ReuseRequest {
  ownerUid: string;
  cacheKey: string;
  documentFingerprint: string;
  versions: ReportCacheVersions;
  /** Section ids the Deep Scan needs in its final report. */
  requiredSections: string[];
  now: number;
}

export interface ReuseDecision {
  reuse: boolean;
  /** Why reuse was refused. Empty when reuse is allowed. */
  reasons: string[];
  reusedFrom: string | null;
  sectionsReused: string[];
  sectionsToRun: string[];
}

const VERSION_FIELDS: Array<keyof ReportCacheVersions> = [
  'analyzerVersion',
  'promptVersion',
  'primaryModel',
  'verificationModel',
  'legalReferenceVersion',
  'legalEffectiveDate',
];

export function planAnalysisReuse(candidate: ReuseCandidate | null, request: ReuseRequest): ReuseDecision {
  const allSections = [...new Set(request.requiredSections)];
  if (!candidate) {
    return { reuse: false, reasons: ['NO_CANDIDATE'], reusedFrom: null, sectionsReused: [], sectionsToRun: allSections };
  }

  const reasons: string[] = [];
  const usable = evaluateCacheEntry(candidate.entry, { ownerUid: request.ownerUid, cacheKey: request.cacheKey, now: request.now });
  if (usable.usable === false) reasons.push(usable.reason);
  if (candidate.documentFingerprint !== request.documentFingerprint) reasons.push('DOCUMENT_CHANGED');
  for (const field of VERSION_FIELDS) {
    if ((candidate.versions[field] ?? null) !== (request.versions[field] ?? null)) reasons.push(`VERSION_${String(field).toUpperCase()}`);
  }
  // Mode is deliberately not compared: Basic-to-Deep Scan reuse is the point. Compatibility rests on promptVersion,
  // which must change whenever a section prompt changes for either mode. Callers must version prompts that way.

  if (reasons.length > 0) {
    return { reuse: false, reasons, reusedFrom: null, sectionsReused: [], sectionsToRun: allSections };
  }

  const available = new Set(candidate.completedSections);
  const sectionsReused = allSections.filter((s) => available.has(s));
  const sectionsToRun = allSections.filter((s) => !available.has(s));
  return { reuse: true, reasons: [], reusedFrom: candidate.entry.jobId, sectionsReused, sectionsToRun };
}
