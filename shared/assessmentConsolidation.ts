/**
 * Builds the input for Final Case Assessment from verified analyses where they exist, and from the original source
 * text where they do not or where a verified analysis needs checking. Pure: no model call, no storage.
 *
 * Rules
 *  - A source with a current, complete analysis contributes a digest: its findings and chronology entries, each with its
 *    source id. Only findings whose quotation was verified are included as quotations.
 *  - A source with no analysis, an outdated analysis (different analyzer version or source version), or any finding
 *    whose quotation did not verify contributes its original text. The original is consulted when necessary.
 *  - Nothing is dropped silently. If the assembled input exceeds the budget, `overBudget` is true and the caller must
 *    refuse rather than truncate.
 */

export interface AssessmentSourceRef {
  id: string;
  document: string;
  version: string;
  page: number;
  text: string;
}

export interface VerifiedFindingDigest {
  id: string;
  claim: string;
  quote: string;
  quoteVerified: boolean;
  verdict: string;
}

export interface VerifiedAnalysisDigest {
  sourceId: string;
  sourceVersion: string;
  analyzerVersion: string;
  findings: VerifiedFindingDigest[];
  chronology: Array<{ date: string; event: string }>;
}

export interface AssemblyResult {
  text: string;
  chars: number;
  digestSourceIds: string[];
  rawSourceIds: string[];
  /** Source ids whose original text was included because a finding needs checking against it. */
  consultedOriginalIds: string[];
  overBudget: boolean;
}

export const CURRENT_ANALYZER_FOR_ASSESSMENT = 'sectioned-v1';

function usableDigest(source: AssessmentSourceRef, digest: VerifiedAnalysisDigest | undefined): digest is VerifiedAnalysisDigest {
  return Boolean(digest)
    && digest!.sourceId === source.id
    && digest!.sourceVersion === source.version
    && digest!.analyzerVersion === CURRENT_ANALYZER_FOR_ASSESSMENT;
}

function needsOriginal(digest: VerifiedAnalysisDigest): boolean {
  return digest.findings.some((f) => !f.quoteVerified || f.verdict === 'MISQUOTED' || f.verdict === 'UNSUPPORTED');
}

export function assembleAssessmentInput(
  sources: AssessmentSourceRef[],
  digests: Map<string, VerifiedAnalysisDigest>,
  maxChars: number
): AssemblyResult {
  const parts: string[] = [];
  const digestSourceIds: string[] = [];
  const rawSourceIds: string[] = [];
  const consultedOriginalIds: string[] = [];

  for (const source of sources) {
    const digest = digests.get(source.id);
    if (usableDigest(source, digest)) {
      digestSourceIds.push(source.id);
      const lines = [`[${source.id}] VERIFIED ANALYSIS of ${source.document}`];
      for (const f of digest.findings) {
        const quote = f.quoteVerified ? ` Quote (verified): "${f.quote}"` : ' Quote not verified; consult the original.';
        lines.push(`- ${f.claim} [verdict: ${f.verdict}]${quote}`);
      }
      for (const c of digest.chronology) lines.push(`- Date ${c.date}: ${c.event}`);
      parts.push(lines.join('\n'));
      if (needsOriginal(digest)) {
        consultedOriginalIds.push(source.id);
        parts.push(`[${source.id}] ORIGINAL TEXT (consulted for unverified findings) ${source.document} page ${source.page}\n${source.text}`);
      }
    } else {
      rawSourceIds.push(source.id);
      parts.push(`[${source.id}] ORIGINAL TEXT ${source.document} page ${source.page}\n${source.text}`);
    }
  }

  const text = parts.join('\n\n');
  return {
    text,
    chars: text.length,
    digestSourceIds,
    rawSourceIds,
    consultedOriginalIds,
    overBudget: text.length > maxChars,
  };
}
