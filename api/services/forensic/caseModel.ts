/**
 * Case-level evidence representation for the Forensic Engine.
 *
 * Every fact the engine relies on is an EvidenceRef: a document id, a verbatim quotation, and the page and
 * code-point span where that quotation was located in the document text. The span is recomputed from the
 * source by deterministic code (locateQuote), never taken from model output, so a reviewer can check every
 * reference mechanically.
 *
 * Uploaded documents are evidence, not instructions. Nothing in this module interprets document text.
 */

import { locateQuote, isVerbatimQuoteStatus, type QuoteMatchStatus } from "../../../shared/quoteVerification.js";
import type { ChronologyAnomaly, ChronologyEntry, ConflictLead, DocumentDate } from "./caseAnalysis.js";

export type DocumentKind =
  | "AFFIDAVIT"
  | "ENDORSEMENT"
  | "PROTECTION_APPLICATION"
  | "CAS_RECORD"
  | "CORRESPONDENCE"
  | "EXHIBIT"
  | "ORDER"
  | "OTHER";

/** How the text of a document was obtained. Carried into every reference drawn from it. */
export type ExtractionMethod = "TEXT_LAYER" | "OCR" | "MANUAL_TRANSCRIPTION" | "UNKNOWN";

export interface CaseDocument {
  id: string;
  title: string;
  kind: DocumentKind;
  /** Full text. Pages are marked "[Page N]" as produced by the existing PDF extraction. */
  text: string;
  extractionMethod: ExtractionMethod;
  /** Optional page images (base64 PNG/JPEG) for multimodal verification, keyed by 1-based page number. */
  pageImages?: Record<number, { mediaType: "image/png" | "image/jpeg"; data: string }>;
  /** Per-page OCR confidence 0..1 where the extractor reports one. */
  ocrConfidence?: Record<number, number>;
  /** Per-page extraction method (a PDF can mix text-layer pages and OCR pages). Overrides extractionMethod per page. */
  pageExtraction?: Record<number, ExtractionMethod>;
  /**
   * The original upload (PDF or image), base64. Sent to the visual stage as a document or image block, so the model
   * examines the actual pages rather than the extracted text. Never placed in the report.
   */
  sourceFile?: { mediaType: "application/pdf" | "image/png" | "image/jpeg"; data: string };
}

export interface EvidenceRef {
  documentId: string;
  quote: string;
  /** Deterministic location results. Null when the quote could not be located uniquely. */
  page: number | null;
  startOffset: number | null;
  endOffset: number | null;
  matchStatus: QuoteMatchStatus | "UNKNOWN_DOCUMENT";
  /** True only when the quoted words are in the document word-for-word (exact, or whitespace-only differences). */
  verified: boolean;
  extractionMethod: ExtractionMethod;
  /** OCR confidence of the page the quote sits on, when known. */
  ocrConfidence: number | null;
}

/** Resolves a model-proposed (documentId, quote) pair against the source. The model's own page or offset is ignored. */
export function resolveEvidenceRef(docs: CaseDocument[], documentId: string, quote: string): EvidenceRef {
  const doc = docs.find((d) => d.id === documentId);
  const q = typeof quote === "string" ? quote.trim() : "";
  if (!doc) {
    return {
      documentId,
      quote: q,
      page: null,
      startOffset: null,
      endOffset: null,
      matchStatus: "UNKNOWN_DOCUMENT",
      verified: false,
      extractionMethod: "UNKNOWN",
      ocrConfidence: null,
    };
  }
  const loc = locateQuote(doc.text, q);
  const conf = loc.page !== null ? doc.ocrConfidence?.[loc.page] ?? null : null;
  return {
    documentId,
    quote: q,
    page: loc.page,
    startOffset: loc.startOffset,
    endOffset: loc.endOffset,
    matchStatus: loc.status,
    verified: isVerbatimQuoteStatus(loc.status),
    extractionMethod: (loc.page !== null ? doc.pageExtraction?.[loc.page] : undefined) ?? doc.extractionMethod,
    ocrConfidence: conf,
  };
}

// ---------------------------------------------------------------------------
// Case graph
// ---------------------------------------------------------------------------

export interface CasePerson {
  id: string;
  name: string;
  roles: string[];
  mentions: EvidenceRef[];
}

export interface CaseEvent {
  id: string;
  description: string;
  /** ISO date when the source states one unambiguously; otherwise null with the raw text kept. */
  date: string | null;
  dateText: string;
  /** "COURT_RECORD" for a date written in the document as a court or event date; "FILENAME" or "METADATA" otherwise. */
  dateSource: "COURT_RECORD" | "DOCUMENT_BODY" | "FILENAME" | "METADATA" | "UNKNOWN";
  participants: string[];
  sources: EvidenceRef[];
}

export interface CaseClaim {
  id: string;
  /** Who asserts it, as named in the source. */
  assertedBy: string;
  statement: string;
  /** Firsthand observation, information from a named source, unnamed source, or opinion. */
  basis: "FIRSTHAND" | "NAMED_SOURCE" | "UNNAMED_SOURCE" | "OPINION" | "UNCLEAR";
  sources: EvidenceRef[];
}

export interface CaseRelation {
  kind: "CONTRADICTS" | "CORROBORATES";
  claimIds: [string, string];
  explanation: string;
}

export interface CaseModel {
  documents: Array<Pick<CaseDocument, "id" | "title" | "kind" | "extractionMethod">>;
  people: CasePerson[];
  events: CaseEvent[];
  claims: CaseClaim[];
  relations: CaseRelation[];
  /** Dates each document states for itself (sworn, issued, endorsed, written). */
  documentDates: DocumentDate[];
  chronology: ChronologyEntry[];
  /** Leads for the investigator, produced by deterministic code. Not findings. */
  chronologyAnomalies: ChronologyAnomaly[];
  conflictLeads: ConflictLead[];
  openQuestions: string[];
  /** Extraction items dropped because their quotation was not found in the source. */
  droppedUngrounded: number;
}

// ---------------------------------------------------------------------------
// Findings
// ---------------------------------------------------------------------------

/**
 * A: confirmed fact in the source. B: information not recorded in the source. C: inference requiring verification.
 * D: potential legal issue. E: confirmed legal noncompliance (only where the source itself establishes it).
 */
export type EvidenceClass = "A" | "B" | "C" | "D" | "E";
export const EVIDENCE_CLASS_LABEL: Record<EvidenceClass, string> = {
  A: "Confirmed fact in source document",
  B: "Information not recorded in source",
  C: "Inference requiring verification",
  D: "Potential legal issue",
  E: "Confirmed legal noncompliance",
};

export type ReviewVerdict = "UPHELD" | "QUALIFIED" | "REJECTED" | "NOT_REVIEWED";

export interface LegalIssue {
  citation: string;
  /** Rule, argument, or a question for counsel. Never a holding. */
  nature: "LEGAL_RULE" | "LEGAL_ARGUMENT" | "QUESTION_FOR_COUNSEL";
  explanation: string;
  /** From shared/citationVerification: INTERNAL_REFERENCE_MATCH, UNVERIFIED or NONE. */
  citationStatus: string;
  citationReason: string;
  /** Verbatim bundled statute text for a verified provision, attached by code. Null when none is held. */
  statuteText: string | null;
  /** Stage 6 corpus lookup for the case date (legalCorpusAdapter.ts). Absent when the citation was not looked up. */
  corpus?: {
    outcome: string;
    requiresResearch: boolean;
    source: string;
    effectiveFrom: string | null;
    verificationStatus: string | null;
    note: string;
    caseDate: string | null;
  } | null;
}

export interface Finding {
  id: string;
  hypothesisId: string | null;
  title: string;
  statement: string;
  evidenceClass: EvidenceClass;
  significance: "HIGH" | "MEDIUM" | "LOW";
  supporting: EvidenceRef[];
  contradicting: EvidenceRef[];
  alternativeExplanations: string[];
  missingInformation: string[];
  legalIssues: LegalIssue[];
  /** Set when the finding depends on something only a page image can settle (a check box, handwriting, a stamp). */
  dependsOnVisual: boolean;
  visualVerification: "CONFIRMED" | "CONTRADICTED" | "INCONCLUSIVE" | "NOT_AVAILABLE" | "NOT_REQUIRED";
  visualNote: string;
  uncertainty: "LOW" | "MEDIUM" | "HIGH";
  review: {
    verdict: ReviewVerdict;
    reasons: string[];
    revisedStatement: string | null;
    /** Titles of documents the review did not read in full (the record exceeded its budget). Absent: whole record. */
    partialRecord?: string[];
  };
  /** Deterministic grounding outcome. MATERIAL findings are reported; the rest go to the appendix with reasons. */
  grounding: { status: "MATERIAL" | "UNSUPPORTED" | "REJECTED_BY_REVIEW" | "DUPLICATE"; notes: string[] };
}

export interface Hypothesis {
  id: string;
  question: string;
  rationale: string;
  outcome: "SUPPORTED" | "UNDERMINED" | "MIXED" | "UNRESOLVED";
  findingIds: string[];
}

export interface StageRecord {
  stage: "EXTRACTION" | "INVESTIGATION" | "SYNTHESIS" | "ADVERSARIAL_REVIEW" | "VISUAL_VERIFICATION" | "GROUNDING";
  status: "COMPLETED" | "FAILED" | "SKIPPED";
  model: string | null;
  calls: number;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  error: string | null;
}

export interface ForensicReport {
  schema: "forensic-engine-v1";
  status: "COMPLETE" | "PARTIAL";
  /** Plain statements of what the analysis did not do. Always shown. */
  incompleteness: string[];
  caseModel: CaseModel;
  hypotheses: Hypothesis[];
  findings: Finding[];
  appendix: Finding[];
  injectionWarnings: InjectionWarning[];
  stages: StageRecord[];
  totals: { calls: number; inputTokens: number; outputTokens: number; durationMs: number };
}

export interface InjectionWarning {
  documentId: string;
  page: number | null;
  excerpt: string;
  pattern: string;
}
