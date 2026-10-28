/**
 * Server integration for the Forensic Engine. Everything the /api/analyze route needs is here, so the route change
 * is one guarded branch and the existing analyzer, credits, job persistence and settlement code stay unchanged.
 *
 * - Feature flag: FORENSIC_ENGINE_ENABLED=true (server environment). Off by default. Only the Forensic In-Depth
 *   mode, after the existing entitlement and credit checks, uses the engine.
 * - Output: the existing report shape (redFlags, chronology, whatIsMissing, ...) so the current report screen and
 *   PDF export render it, plus `forensicEngine` with the full record (case model, hypotheses, findings with
 *   provenance, appendix, stages). Token counts and model ids are not copied into the customer report.
 * - Failure: if the investigation, synthesis or adversarial review did not complete, the run throws a retryable
 *   error. The existing failure path then releases the reserved credit; nobody pays for an unreviewed report.
 */

import { AnalyzerError } from "../analyzerErrors.js";
import { CANONICAL_DISCLAIMER, type GenerateFn, type GenerateResult } from "../analyzerSections.js";
import { normalizeCourtFileNumber } from "../../../shared/courtFileNumber.js";
import { EVIDENCE_CLASS_LABEL, type CaseDocument, type DocumentKind, type ExtractionMethod, type Finding, type ForensicReport } from "./caseModel.js";
import { runForensicInvestigation, type ForensicLimits, type ForensicProgress } from "./pipeline.js";
import { decodeSource, extractPages } from "../pageSources.js";

export const FORENSIC_ENGINE_FLAG = "FORENSIC_ENGINE_ENABLED";

export function isForensicEngineEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return env[FORENSIC_ENGINE_FLAG] === "true";
}

/**
 * Output caps for the live route. The route runs inside a 300 s serverless function (vercel.json maxDuration), so the
 * engine's offline defaults (pipeline.ts DEFAULT_LIMITS) are too large there. A deadline still bounds every call.
 */
export const ROUTE_LIMITS: Partial<ForensicLimits> = {
  maxCalls: 10,
  extractionMaxTokens: 4_000,
  investigationMaxTokens: 12_000,
  synthesisMaxTokens: 8_000,
  reviewMaxTokens: 6_000,
  visualMaxTokens: 2_000,
  stageTimeoutMs: 150_000,
};

// The Anthropic PDF and image inputs have size limits; a larger original is not sent, and visual checks are skipped.
const MAX_SOURCE_FILE_BASE64 = 20 * 1024 * 1024;

export function guessDocumentKind(title: string, text: string): DocumentKind {
  const t = `${title}\n${text.slice(0, 3000)}`.toLowerCase();
  if (/\baffidavit\b|make oath and say|sworn before me/.test(t)) return "AFFIDAVIT";
  if (/\bendorsement\b/.test(t)) return "ENDORSEMENT";
  if (/protection application|application \(child protection\)|form 8b|child in need of protection/.test(t)) return "PROTECTION_APPLICATION";
  if (/\bcase note\b|contact note|home visit|running record/.test(t)) return "CAS_RECORD";
  if (/\border\b.*\bjustice\b|\bit is ordered\b|temporary order/.test(t)) return "ORDER";
  if (/\bexhibit\b/.test(t)) return "EXHIBIT";
  if (/^dear\b|\byours (truly|sincerely)\b/m.test(t)) return "CORRESPONDENCE";
  return "OTHER";
}

export interface UploadInput {
  /** Text extracted from the uploaded file by the existing extraction step. */
  extractedText: string;
  /** Text the user pasted, if any. Treated as its own document. */
  pastedText: string;
  fileData?: { base64?: string; mimeType?: string; name?: string; fileName?: string } | null;
  /** Further documents of the same case, already validated by parseAdditionalDocuments. */
  additional?: CaseDocument[];
  /** Per-page extraction methods for the upload, from pageExtractionMethods. */
  pageExtraction?: Record<number, ExtractionMethod> | null;
}

const METHOD_FOR: Record<string, ExtractionMethod> = {
  "native-pdf-text": "TEXT_LAYER",
  "utf8-single-source": "TEXT_LAYER",
  "gemini-page-ocr": "OCR",
  "gemini-image-ocr": "OCR",
};

/**
 * Per-page extraction methods for an uploaded PDF or image, read from the extraction step's cache. The OCR function
 * passed here refuses to run, so this can never trigger a second (paid) OCR pass: on a cache miss for an OCR page it
 * returns null and every page is treated as OCR, the conservative label.
 */
export async function pageExtractionMethods(
  fileData: UploadInput["fileData"],
  extract: typeof extractPages = extractPages
): Promise<Record<number, ExtractionMethod> | null> {
  const mime = fileData?.mimeType || "";
  if (!fileData?.base64 || !(mime === "application/pdf" || mime.startsWith("image/"))) return null;
  try {
    const source = decodeSource(fileData.base64, mime);
    const pages = await extract(source.bytes, source.mime, async () => {
      throw new Error("OCR is not repeated for provenance.");
    });
    return Object.fromEntries(pages.map((p) => [p.pageNumber, METHOD_FOR[p.extractionMethod] ?? "UNKNOWN"]));
  } catch {
    return null;
  }
}

export const MAX_ADDITIONAL_DOCUMENTS = 9;
const MAX_ADDITIONAL_CHARS = 300_000;

/**
 * Validates the optional `additionalDocuments` request field: up to 9 further text documents of the same case, each
 * `{ title, text }`. Anything else is rejected rather than repaired. Only the Forensic Engine path reads it.
 */
export function parseAdditionalDocuments(raw: unknown): CaseDocument[] {
  if (raw === undefined || raw === null) return [];
  const invalid = () =>
    new AnalyzerError("UPLOAD_FAILED", 400, `Additional documents must be a list of up to ${MAX_ADDITIONAL_DOCUMENTS} items with a title and text. Nothing was charged.`, false);
  if (!Array.isArray(raw) || raw.length > MAX_ADDITIONAL_DOCUMENTS) throw invalid();
  return raw.map((d: any, i: number): CaseDocument => {
    if (!d || typeof d !== "object" || typeof d.text !== "string" || !d.text.trim() || d.text.length > MAX_ADDITIONAL_CHARS) throw invalid();
    const title = typeof d.title === "string" && d.title.trim() ? d.title.trim().slice(0, 200) : `Additional document ${i + 1}`;
    return { id: `doc${i + 2}`, title, kind: guessDocumentKind(title, d.text), text: d.text, extractionMethod: "MANUAL_TRANSCRIPTION" };
  });
}

/** Builds the engine's documents from the existing upload. The original PDF or image is kept for visual checks. */
export function buildCaseDocuments(input: UploadInput): CaseDocument[] {
  const docs: CaseDocument[] = [];
  const mime = input.fileData?.mimeType || "";
  const name = input.fileData?.name || input.fileData?.fileName || "Uploaded document";
  const extracted = (input.extractedText || "").trim();
  if (extracted) {
    const pageMethods = input.pageExtraction ? Object.values(input.pageExtraction) : [];
    // A PDF whose pages all came from the text layer is TEXT_LAYER; anything else from a PDF or image is OCR.
    const method: ExtractionMethod =
      pageMethods.length > 0 && pageMethods.every((m) => m === "TEXT_LAYER")
        ? "TEXT_LAYER"
        : mime === "application/pdf" || mime.startsWith("image/") ? "OCR" : "TEXT_LAYER";
    const raw = String(input.fileData?.base64 || "");
    const data = raw.includes(",") ? raw.split(",")[1] : raw;
    const mediaType = mime === "application/pdf" ? "application/pdf" : mime === "image/png" ? "image/png" : mime === "image/jpeg" ? "image/jpeg" : null;
    docs.push({
      id: "upload",
      title: name,
      kind: guessDocumentKind(name, extracted),
      text: extracted,
      extractionMethod: method,
      ...(input.pageExtraction ? { pageExtraction: input.pageExtraction } : {}),
      ...(mediaType && data && data.length <= MAX_SOURCE_FILE_BASE64 ? { sourceFile: { mediaType, data } } : {}),
    });
  }
  const pasted = (input.pastedText || "").trim();
  if (pasted) {
    docs.push({ id: docs.length ? "pasted" : "document", title: "Pasted text", kind: guessDocumentKind("", pasted), text: pasted, extractionMethod: "MANUAL_TRANSCRIPTION" });
  }
  docs.push(...(input.additional ?? []));
  return docs;
}

const CLASSIFICATION_FOR: Record<Finding["evidenceClass"], string> = {
  A: "DOCUMENTARY",
  B: "UNCLEAR",
  C: "INFERENCE",
  D: "INFERENCE",
  E: "DOCUMENTARY",
};

const where = (f: Finding, titles: Map<string, string>) =>
  f.supporting
    .filter((r) => r.verified)
    .map((r) => `${titles.get(r.documentId) ?? r.documentId}${r.page !== null ? `, page ${r.page}` : ""}`)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join("; ");

/** Maps an engine report onto the existing report shape so the current screen and PDF export render it. */
export function toLegacyReport(r: ForensicReport, docs: CaseDocument[]): Record<string, any> {
  const titles = new Map(docs.map((d) => [d.id, d.title]));
  const redFlags = r.findings.map((f) => {
    const quote = f.supporting.find((s) => s.verified) ?? f.supporting[0];
    const citation = f.legalIssues.find((l) => l.citation);
    return {
      id: f.id,
      // Never CRITICAL: the engine does not grade findings into the legacy single-CRITICAL tier.
      severity: f.significance === "HIGH" ? "Worth Raising With Counsel" : "Affects Evidentiary Weight",
      category: `${EVIDENCE_CLASS_LABEL[f.evidenceClass]} (${f.evidenceClass})`,
      evidenceClassification: CLASSIFICATION_FOR[f.evidenceClass],
      phraseDetected: quote?.quote ?? "",
      quoteVerification: quote?.matchStatus === "UNKNOWN_DOCUMENT" ? "ABSENT" : quote?.matchStatus ?? "ABSENT",
      quoteVerified: quote?.verified ?? false,
      explanation: [f.title, f.statement, f.alternativeExplanations.length ? `Other explanations to consider: ${f.alternativeExplanations.join(" ")}` : ""].filter(Boolean).join(" — "),
      verifyRequirement: f.missingInformation.join(" ") || "Check the cited pages of the original document.",
      legalReference: citation?.citation ?? "",
      citationStatus: citation?.citationStatus ?? "NONE",
      citationReason: citation?.citationReason ?? "",
      locationInDocument: where(f, titles),
      parentActionStep: "Ask your lawyer to review this finding against the cited pages.",
      verificationNote: [f.uncertainty !== "LOW" ? `Uncertainty: ${f.uncertainty.toLowerCase()}.` : "", ...f.grounding.notes, f.visualNote ? `Page check: ${f.visualNote}` : ""].filter(Boolean).join(" "),
      forensicVerification: { verdict: f.review.verdict, note: f.review.reasons.join(" "), verifiedBy: "Independent adversarial review (Claude Opus)" },
    };
  });
  const firstDoc = docs[0];
  const fileNumber = normalizeCourtFileNumber(docs.map((d) => d.text).join("\n")) ?? "";
  const material = r.findings.length;
  return {
    documentTitle: firstDoc?.title ?? "Uploaded Document",
    documentType: firstDoc?.kind ?? "OTHER",
    analysisDate: new Date().toISOString(),
    metadata: { fileNumber, applicantName: "", respondentName: "", childNames: "", hearingDate: "" },
    disclaimer: CANONICAL_DISCLAIMER,
    // The engine does not compute a completeness or evidence-strength score; the screen hides a missing score.
    completenessScore: null,
    fileSummary:
      `Forensic Engine examined ${docs.length} document(s) and reports ${material} finding(s) that survived adversarial review and source checks` +
      (r.appendix.length ? `; ${r.appendix.length} proposed finding(s) were set aside and are listed in the full record with reasons` : "") +
      `. ${r.status === "PARTIAL" ? "This analysis is partial: " + r.incompleteness.join(" ") : ""}`.trim(),
    redFlags,
    chronology: r.caseModel.chronology.map((c) => ({
      date: c.dateText || c.date || "Undated",
      event: c.description,
      locationInDocument: `${titles.get(c.documentId) ?? c.documentId}${c.page !== null ? `, page ${c.page}` : ""}`,
      evidenceClassification: "DOCUMENTARY",
    })),
    contradictions: r.findings
      .filter((f) => f.contradicting.length > 0 || new Set(f.supporting.map((s) => s.documentId)).size > 1)
      .map((f) => ({ description: f.statement, locations: where(f, titles).split("; ").filter(Boolean), significance: f.title })),
    whatIsMissing: r.findings.filter((f) => f.evidenceClass === "B").map((f) => `${f.statement} ${f.missingInformation.join(" ")}`.trim()),
    whatToVerify: [...new Set(r.findings.flatMap((f) => f.missingInformation))],
    whatToAskALawyer: r.caseModel.openQuestions,
    lawyerCaseBrief: r.findings
      .filter((f) => f.significance === "HIGH")
      .map((f) => `${f.title} — ${f.statement} — Evidence class ${f.evidenceClass} — ${where(f, titles) || "see record"}`),
    thresholdAnalysis: [],
    proceduralTimelineViolations: [],
    charterAndHumanRightsIssues: [],
    forensicVerification: {
      status: r.stages.find((s) => s.stage === "ADVERSARIAL_REVIEW")?.status === "COMPLETED" ? "completed" : "incomplete",
      checkedFindings: r.findings.length + r.appendix.filter((f) => f.grounding.status === "REJECTED_BY_REVIEW").length,
      overallAssessment: "Every finding was reviewed by a separate adversarial pass and re-checked against the source text by code.",
    },
    forensicEngine: stripInternal(r),
  };
}

/** Removes usage and model details from the customer copy; they are logged server-side instead. */
function stripInternal(r: ForensicReport) {
  return {
    ...r,
    stages: r.stages.map(({ stage, status, error }) => ({ stage, status, error: error ? "Stage did not complete." : null })),
    totals: undefined,
  };
}

export interface EngineRun {
  report: Record<string, any>;
  usageByModel: Record<string, { input_tokens: number; output_tokens: number }>;
  sectionTimingsMs: Record<string, number>;
  attempts: Record<string, number>;
  engine: ForensicReport;
}

export type ThinkingGenerateFn = (
  params: Parameters<GenerateFn>[0] & { enableThinking?: boolean },
  model: string
) => Promise<GenerateResult>;

/**
 * Runs the engine for one request and returns the same shape as runSectionedAnalysis, so the route's existing cost,
 * credit, persistence and settlement code runs unchanged.
 */
export async function runForensicEngineForRoute(params: {
  documents: CaseDocument[];
  generate: ThinkingGenerateFn;
  investigatorModel: string;
  extractorModel: string;
  deadlineAt: number;
  requestId: string;
  limits?: Partial<ForensicLimits>;
  onProgress?: (p: ForensicProgress) => void | Promise<void>;
}): Promise<EngineRun> {
  // Opus stages get adaptive thinking; extraction does not need it.
  const generate: GenerateFn = (p, model) =>
    params.generate({ ...p, enableThinking: model === params.investigatorModel && p.stage !== "forensic_extraction" }, model);
  const engine = await runForensicInvestigation({
    documents: params.documents,
    generate,
    models: { extractor: params.extractorModel, investigator: params.investigatorModel, reviewer: params.investigatorModel },
    limits: { ...ROUTE_LIMITS, ...params.limits },
    deadlineAt: params.deadlineAt,
    requestId: params.requestId,
    onProgress: params.onProgress,
  });
  const failed = engine.stages.filter((s) => s.status === "FAILED").map((s) => s.stage);
  if (failed.some((s) => s === "INVESTIGATION" || s === "SYNTHESIS" || s === "ADVERSARIAL_REVIEW")) {
    throw new AnalyzerError(
      "AI_PROVIDER_TEMPORARILY_UNAVAILABLE",
      503,
      "The forensic investigation could not be completed and verified in time. Nothing was charged. Please try again.",
      true
    );
  }
  const usageByModel: EngineRun["usageByModel"] = {};
  for (const s of engine.stages) {
    if (!s.model || s.calls === 0) continue;
    const u = (usageByModel[s.model] ??= { input_tokens: 0, output_tokens: 0 });
    u.input_tokens += s.inputTokens;
    u.output_tokens += s.outputTokens;
  }
  return {
    report: toLegacyReport(engine, params.documents),
    usageByModel,
    sectionTimingsMs: Object.fromEntries(engine.stages.map((s) => [s.stage.toLowerCase(), s.durationMs])),
    attempts: Object.fromEntries(engine.stages.map((s) => [s.stage.toLowerCase(), s.calls])),
    engine,
  };
}
