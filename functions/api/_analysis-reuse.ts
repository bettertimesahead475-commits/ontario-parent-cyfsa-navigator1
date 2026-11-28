/**
 * Decides whether a Deep Scan may reuse sections from a previously completed analysis of the same document, for
 * the same account. Pure: no provider call, no storage access. Callers supply the candidate from the report cache
 * index (functions/api/_report-cache.ts), which already enforces owner, key, expiry and deletion.
 *
 * A section is reusable only when every input that shaped it is identical: the document, the account, the analyzer
 * and prompt versions, the model, and the legal reference version. Any difference means the section is re-run.
 */
import { ALL_PARENT_ASSISTANCE_RULES } from '../../shared/parentAssistanceLibrary';
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

/**
 * Version labels that decide reuse. A section is reusable only when its prompt version matches exactly. The mode is
 * part of the prompt version because Basic and Deep Scan send different limits for the same section, so a Basic section
 * is never offered to a Deep Scan (or the reverse) by accident. Bump a label whenever the prompt, schema, validator or
 * pipeline that produced the section changes.
 */
export const SECTIONED_ANALYZER_VERSION = 'sectioned-v1';
export const CONSOLIDATED_ANALYZER_VERSION = 'consolidated-v1';
/**
 * Non-cryptographic content label (two independent 32-bit hashes). It identifies the rule content for versioning only;
 * it is not a security control. Synchronous on purpose: an awaited crypto call is real I/O and must not sit on the
 * analysis path, where it can disturb deadline timing.
 */
function contentLabel(text: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x9747b28c;
  for (let i = 0; i < text.length; i += 1) {
    const c = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = (Math.imul(h2 ^ c, 0x85ebca6b) ^ (h2 >>> 13)) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

/**
 * Legal reference metadata, derived from the parent-assistance rule tables the deterministic compliance checks use.
 * The version is a label of the canonical rule content, so it changes whenever any rule changes. The effective date
 * is the latest effectiveDate in those tables. Nothing here is typed by hand, so the values cannot drift from the data.
 */
export function legalReferenceMetadata(): { legalReferenceVersion: string; legalEffectiveDate: string } {
  const rules = ALL_PARENT_ASSISTANCE_RULES;
  const dates = rules.map((r) => r.effectiveDate).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
  if (dates.length !== rules.length) throw new Error('Legal reference rules have a missing or malformed effectiveDate.');
  return {
    legalReferenceVersion: `parent-assistance-${contentLabel(JSON.stringify(rules))}`,
    legalEffectiveDate: dates[dates.length - 1],
  };
}

export function analysisVersionsFor(
  mode: 'fast' | 'full',
  pipeline: 'sectioned' | 'consolidated',
  models: { primaryModel: string; verificationModel: string | null }
): import('./_report-cache').ReportCacheVersions {
  const analyzer = pipeline === 'consolidated' ? CONSOLIDATED_ANALYZER_VERSION : SECTIONED_ANALYZER_VERSION;
  const legal = legalReferenceMetadata();
  return {
    mode,
    analyzerVersion: analyzer,
    promptVersion: `${analyzer}-${mode}`,
    primaryModel: models.primaryModel,
    verificationModel: models.verificationModel,
    legalReferenceVersion: legal.legalReferenceVersion,
    legalEffectiveDate: legal.legalEffectiveDate,
  };
}
