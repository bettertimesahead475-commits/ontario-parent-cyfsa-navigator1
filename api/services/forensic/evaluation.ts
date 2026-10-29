/**
 * Benchmark scoring for the Forensic Engine and the existing analyzer, on identical documents and criteria.
 *
 * Honesty rules built into the scorer:
 * - A predicted finding matches an expected issue only through its evidence quotations (machine-checkable), never
 *   through wording similarity of its conclusion.
 * - A predicted finding that matches nothing is "unmatched", not a false positive: the gold annotations may be
 *   incomplete, so these need human adjudication. Only a match against a case's FORBIDDEN patterns (a known wrong
 *   conclusion) counts as a confirmed false positive.
 * - Gold annotations in eval/forensic/cases were written by the engineering author, not by an independent legal
 *   reviewer. Results on them are engineering evidence, not a professional evaluation.
 */

import type { CaseDocument, EvidenceClass, Finding } from "./caseModel.js";
import { resolveEvidenceRef } from "./caseModel.js";

export interface BenchmarkCase {
  id: string;
  description: string;
  category: "AFFIDAVIT" | "ENDORSEMENT" | "PROTECTION_APPLICATION" | "CAS_RECORD" | "CORRESPONDENCE" | "EXHIBIT" | "MULTI_DOCUMENT";
  annotation: { annotatedBy: string; independentlyReviewed: boolean; notes?: string };
  documents: CaseDocument[];
  expected: Array<{
    id: string;
    description: string;
    /** Substrings of the source. A finding whose evidence quotations contain one of these addresses the issue. */
    anchors: string[];
    acceptableClasses: EvidenceClass[];
    /** Issues a competent reviewer must find. Optional ones count toward recall only when found. */
    required: boolean;
  }>;
  /** Known wrong conclusions. A material finding whose title or statement matches is a confirmed false positive. */
  forbidden: Array<{ id: string; description: string; pattern: string }>;
  /** True for a record with no material problems. */
  expectNoMaterialFindings?: boolean;
  /** True if the case contains instruction-like text the system must flag. */
  expectInjectionWarning?: boolean;
}

/** The scorer's view of a prediction. Both systems are reduced to this shape. */
export interface ScoredFinding {
  id: string;
  title: string;
  statement: string;
  evidenceClass: EvidenceClass | null;
  quotes: Array<{ documentId: string; quote: string; verified: boolean }>;
  citations: Array<{ citation: string; status: string }>;
}

export interface CaseScore {
  caseId: string;
  requiredExpected: number;
  requiredFound: number;
  optionalFound: number;
  predicted: number;
  matchedPredicted: number;
  unmatchedPredicted: number;
  forbiddenHits: string[];
  classCorrect: number;
  classChecked: number;
  quotesTotal: number;
  quotesVerified: number;
  citationsTotal: number;
  citationsUnverified: number;
  injectionFlagged: boolean | null;
  missed: string[];
}

const norm = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

export function fromEngineFindings(findings: Finding[]): ScoredFinding[] {
  return findings.map((f) => ({
    id: f.id,
    title: f.title,
    statement: f.statement,
    evidenceClass: f.evidenceClass,
    quotes: [...f.supporting, ...f.contradicting].map((r) => ({ documentId: r.documentId, quote: r.quote, verified: r.verified })),
    citations: f.legalIssues.filter((l) => l.citation).map((l) => ({ citation: l.citation, status: l.citationStatus })),
  }));
}

/**
 * Adapts the existing sectioned analyzer's report (redFlags, thresholdAnalysis, proceduralTimelineViolations) to the
 * scorer's shape. The existing analyzer reads one concatenated text, so its quotations are located against the
 * concatenation and attributed to the document that contains them.
 */
export function fromLegacyReport(report: Record<string, any>, docs: CaseDocument[]): ScoredFinding[] {
  const locate = (quote: string) => {
    for (const d of docs) {
      const r = resolveEvidenceRef(docs, d.id, quote);
      if (r.verified) return { documentId: d.id, quote, verified: true };
    }
    return { documentId: docs[0]?.id ?? "", quote, verified: false };
  };
  const out: ScoredFinding[] = [];
  for (const [i, f] of (Array.isArray(report.redFlags) ? report.redFlags : []).entries()) {
    const quote = String(f?.phraseDetected ?? "");
    out.push({
      id: `legacy-rf${i + 1}`,
      title: String(f?.category ?? ""),
      statement: String(f?.explanation ?? f?.legalConcern ?? ""),
      evidenceClass: null,
      quotes: quote ? [locate(quote)] : [],
      citations: f?.legalReference ? [{ citation: String(f.legalReference), status: String(f.citationStatus ?? "UNVERIFIED") }] : [],
    });
  }
  for (const [i, t] of (Array.isArray(report.thresholdAnalysis) ? report.thresholdAnalysis : []).entries()) {
    const quote = String(t?.documentEvidence ?? t?.evidence ?? "");
    out.push({
      id: `legacy-th${i + 1}`,
      title: String(t?.threshold ?? t?.legalTest ?? ""),
      statement: String(t?.analysis ?? t?.assessment ?? ""),
      evidenceClass: null,
      quotes: quote ? [locate(quote)] : [],
      citations: t?.primarySourceLaw ? [{ citation: String(t.primarySourceLaw), status: String(t.citationStatus ?? "UNVERIFIED") }] : [],
    });
  }
  for (const [i, p] of (Array.isArray(report.proceduralTimelineViolations) ? report.proceduralTimelineViolations : []).entries()) {
    const quote = String(p?.documentAssertion ?? "");
    out.push({
      id: `legacy-tl${i + 1}`,
      title: String(p?.timelineRule ?? ""),
      statement: String(p?.evaluation ?? ""),
      evidenceClass: null,
      quotes: quote ? [locate(quote)] : [],
      citations: p?.citation ? [{ citation: String(p.citation), status: String(p.citationStatus ?? "UNVERIFIED") }] : [],
    });
  }
  return out;
}

export function scoreCase(c: BenchmarkCase, predicted: ScoredFinding[], injectionWarnings: number | null): CaseScore {
  const addresses = (p: ScoredFinding, anchors: string[]) =>
    p.quotes.some((q) => q.verified && anchors.some((a) => norm(q.quote).includes(norm(a)) || (norm(q.quote).length >= 12 && norm(a).includes(norm(q.quote)))));
  const matchedPred = new Set<string>();
  let requiredFound = 0;
  let optionalFound = 0;
  let classCorrect = 0;
  let classChecked = 0;
  const missed: string[] = [];
  for (const e of c.expected) {
    const hits = predicted.filter((p) => addresses(p, e.anchors));
    hits.forEach((h) => matchedPred.add(h.id));
    if (hits.length > 0) {
      if (e.required) requiredFound++;
      else optionalFound++;
      const classed = hits.filter((h) => h.evidenceClass !== null);
      if (classed.length > 0) {
        classChecked++;
        if (classed.some((h) => e.acceptableClasses.includes(h.evidenceClass!))) classCorrect++;
      }
    } else if (e.required) {
      missed.push(e.id);
    }
  }
  const forbiddenHits: string[] = [];
  for (const fb of c.forbidden) {
    const re = new RegExp(fb.pattern, "i");
    for (const p of predicted) if (re.test(`${p.title} ${p.statement}`)) forbiddenHits.push(`${fb.id}:${p.id}`);
  }
  const quotes = predicted.flatMap((p) => p.quotes);
  const citations = predicted.flatMap((p) => p.citations);
  return {
    caseId: c.id,
    requiredExpected: c.expected.filter((e) => e.required).length,
    requiredFound,
    optionalFound,
    predicted: predicted.length,
    matchedPredicted: matchedPred.size,
    unmatchedPredicted: predicted.length - matchedPred.size,
    forbiddenHits,
    classCorrect,
    classChecked,
    quotesTotal: quotes.length,
    quotesVerified: quotes.filter((q) => q.verified).length,
    citationsTotal: citations.length,
    citationsUnverified: citations.filter((x) => x.status !== "INTERNAL_REFERENCE_MATCH").length,
    injectionFlagged: c.expectInjectionWarning ? (injectionWarnings ?? 0) > 0 : null,
    missed,
  };
}

export interface BenchmarkSummary {
  cases: number;
  recallRequired: number | null;
  falsePositiveCases: number;
  forbiddenHits: number;
  unmatchedPredicted: number;
  noProblemCasesWithFindings: number;
  classAccuracy: number | null;
  quoteVerificationRate: number | null;
  citationsUnverified: number;
  injectionDetection: string;
}

export function summarize(cases: BenchmarkCase[], scores: CaseScore[]): BenchmarkSummary {
  const req = scores.reduce((s, x) => s + x.requiredExpected, 0);
  const found = scores.reduce((s, x) => s + x.requiredFound, 0);
  const classChecked = scores.reduce((s, x) => s + x.classChecked, 0);
  const quotes = scores.reduce((s, x) => s + x.quotesTotal, 0);
  const inj = scores.filter((s) => s.injectionFlagged !== null);
  return {
    cases: scores.length,
    recallRequired: req ? found / req : null,
    falsePositiveCases: scores.filter((s) => s.forbiddenHits.length > 0).length,
    forbiddenHits: scores.reduce((s, x) => s + x.forbiddenHits.length, 0),
    unmatchedPredicted: scores.reduce((s, x) => s + x.unmatchedPredicted, 0),
    noProblemCasesWithFindings: scores.filter((s) => cases.find((c) => c.id === s.caseId)?.expectNoMaterialFindings && s.predicted > 0).length,
    classAccuracy: classChecked ? scores.reduce((s, x) => s + x.classCorrect, 0) / classChecked : null,
    quoteVerificationRate: quotes ? scores.reduce((s, x) => s + x.quotesVerified, 0) / quotes : null,
    citationsUnverified: scores.reduce((s, x) => s + x.citationsUnverified, 0),
    injectionDetection: inj.length ? `${inj.filter((s) => s.injectionFlagged).length}/${inj.length}` : "n/a",
  };
}

/**
 * 10-dimension evaluation framework for real-world document intelligence evaluation.
 * Evaluates forensic investigation and baseline systems across:
 * 1. Material findings discovered
 * 2. Material findings missed
 * 3. Unsupported allegations
 * 4. Source attribution accuracy
 * 5. Legal citation accuracy
 * 6. Chronology accuracy
 * 7. Visual evidence interpretation
 * 8. Duplicate findings
 * 9. Adversarial review effectiveness
 * 10. Cost and latency
 */
export interface ForensicDimensionEvaluation {
  materialFindingsDiscovered: {
    requiredFound: number;
    requiredTotal: number;
    optionalFound: number;
    recall: number | null;
  };
  materialFindingsMissed: {
    count: number;
    missedIssueIds: string[];
  };
  unsupportedAllegations: {
    count: number;
    findingIds: string[];
  };
  sourceAttributionAccuracy: {
    quotesTotal: number;
    quotesVerified: number;
    verificationRate: number | null;
  };
  legalCitationAccuracy: {
    citationsTotal: number;
    verifiedOrInternal: number;
    unverifiedOrNeedsResearch: number;
    accuracyRate: number | null;
  };
  chronologyAccuracy: {
    anomaliesReported: number;
    chronologyEventsCount: number;
  };
  visualEvidenceInterpretation: {
    visualStagesCount: number;
    findingsWithVisualCheck: number;
    notes: string[];
  };
  duplicateFindings: {
    duplicatePairsCount: number;
    duplicateFindingIds: string[];
  };
  adversarialReviewEffectiveness: {
    upheldCount: number;
    rejectedCount: number;
    totalReviewed: number;
    rejectionRate: number | null;
  };
  costAndLatency: {
    totalCostUsd: number;
    totalLatencyMs: number;
    inputTokens: number;
    outputTokens: number;
  };
}

export function evaluateTenDimensions(params: {
  benchmarkCase: BenchmarkCase;
  scoredFindings: ScoredFinding[];
  rawReport?: any;
  appendixFindings?: Finding[];
  costUsd?: number;
  latencyMs?: number;
  tokenUsage?: { input_tokens: number; output_tokens: number };
}): ForensicDimensionEvaluation {
  const { benchmarkCase, scoredFindings, rawReport, appendixFindings = [], costUsd = 0, latencyMs = 0, tokenUsage } = params;
  const score = scoreCase(benchmarkCase, scoredFindings, null);

  const reqTotal = benchmarkCase.expected.filter((e) => e.required).length;
  const recall = reqTotal > 0 ? score.requiredFound / reqTotal : null;

  const unsupported = scoredFindings.filter((f) => f.quotes.length === 0 || !f.quotes.some((q) => q.verified));
  const unsupportedIds = unsupported.map((f) => f.id);

  const quotesTotal = score.quotesTotal;
  const quotesVerified = score.quotesVerified;
  const verificationRate = quotesTotal > 0 ? quotesVerified / quotesTotal : null;

  const citationsTotal = score.citationsTotal;
  const unverified = score.citationsUnverified;
  const verifiedCitations = citationsTotal - unverified;
  const citationRate = citationsTotal > 0 ? verifiedCitations / citationsTotal : null;

  const chronologyEvents = rawReport?.caseModel?.chronology?.length ?? rawReport?.chronology?.length ?? 0;
  const anomaliesReported = rawReport?.caseModel?.chronologyAnomalies?.length ?? 0;

  const visualNotes: string[] = [];
  let findingsWithVisual = 0;
  if (Array.isArray(rawReport?.findings)) {
    for (const f of rawReport.findings) {
      if (f.visualNote) {
        visualNotes.push(`${f.id}: ${f.visualNote}`);
        findingsWithVisual++;
      }
    }
  }

  const duplicateIds = new Set<string>();
  let duplicatePairs = 0;
  for (let i = 0; i < scoredFindings.length; i++) {
    for (let j = i + 1; j < scoredFindings.length; j++) {
      const f1 = scoredFindings[i];
      const f2 = scoredFindings[j];
      const sharedQuotes = f1.quotes.some((q1) => f2.quotes.some((q2) => q1.quote && q2.quote && norm(q1.quote) === norm(q2.quote)));
      const sameStatement = norm(f1.statement) === norm(f2.statement);
      if (sharedQuotes || sameStatement) {
        duplicatePairs++;
        duplicateIds.add(f1.id);
        duplicateIds.add(f2.id);
      }
    }
  }

  const rejectedCount = appendixFindings.length;
  const upheldCount = scoredFindings.length;
  const totalReviewed = upheldCount + rejectedCount;
  const rejectionRate = totalReviewed > 0 ? rejectedCount / totalReviewed : null;

  return {
    materialFindingsDiscovered: {
      requiredFound: score.requiredFound,
      requiredTotal: reqTotal,
      optionalFound: score.optionalFound,
      recall,
    },
    materialFindingsMissed: {
      count: score.missed.length,
      missedIssueIds: score.missed,
    },
    unsupportedAllegations: {
      count: unsupportedIds.length,
      findingIds: unsupportedIds,
    },
    sourceAttributionAccuracy: {
      quotesTotal,
      quotesVerified,
      verificationRate,
    },
    legalCitationAccuracy: {
      citationsTotal,
      verifiedOrInternal: verifiedCitations,
      unverifiedOrNeedsResearch: unverified,
      accuracyRate: citationRate,
    },
    chronologyAccuracy: {
      anomaliesReported,
      chronologyEventsCount: chronologyEvents,
    },
    visualEvidenceInterpretation: {
      visualStagesCount: rawReport?.stages?.filter((s: any) => s.stage === "VISUAL")?.length ?? 0,
      findingsWithVisualCheck: findingsWithVisual,
      notes: visualNotes,
    },
    duplicateFindings: {
      duplicatePairsCount: duplicatePairs,
      duplicateFindingIds: Array.from(duplicateIds),
    },
    adversarialReviewEffectiveness: {
      upheldCount,
      rejectedCount,
      totalReviewed,
      rejectionRate,
    },
    costAndLatency: {
      totalCostUsd: costUsd,
      totalLatencyMs: latencyMs,
      inputTokens: tokenUsage?.input_tokens ?? 0,
      outputTokens: tokenUsage?.output_tokens ?? 0,
    },
  };
}
