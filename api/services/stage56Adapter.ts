// Stage 5 -> Stage 6 integration adapter.
// Deterministic, provider-independent, no database access, no AI calls, no new persistence.
// Bridges Stage 5's reviewed-evidence model (shared/evidenceReview.ts, api/services/evidenceReview.ts)
// to Stage 6's legal-mapping input contract (api/services/legalAuthority.ts) without moving
// ownership of either side's concepts:
//   Stage 5 still owns: classification, evidence review state, quote/page/document provenance.
//   Stage 6 still owns: legal source/provision selection, temporal resolution, legal review state.
// This file structurally cannot select a legal authority — it never receives or returns a
// LegalSource/LegalProvision — so it cannot short-circuit Stage 6's own resolution/review rules.
import { LifecycleError, requireUuid } from "./lifecycleErrors.js";
import { EVIDENCE_CLASSIFICATIONS, EVIDENCE_REVIEW_STATES, type EvidenceRow } from "../../shared/evidenceReview.js";
import { assertSafeLegalLanguage, type CaseDate, type LegalMappingInput } from "./legalAuthority.js";

const invalid = (message: string) => new LifecycleError(400, "INVALID_STAGE56_ADAPTER_INPUT", message);

// ---------------------------------------------------------------------------
// Evidence reference translation — pass-through only, never fabricates provenance.
// ---------------------------------------------------------------------------

export interface Stage5EvidenceReference {
  matterId: string;
  evidenceItemId: string;
  classification: EvidenceRow["classification"];
  evidenceReviewState: EvidenceRow["review_state"];
  documentId: string;
  documentVersionId: string;
  pageId: string;
  pageNumber: number;
  extractionRunId: string;
  exactQuote: string;
  quoteVerification: EvidenceRow["quote_verification"];
  quoteStartOffset: number | null;
  quoteEndOffset: number | null;
}

/**
 * Translates a real Stage 5 evidence row into a stable reference shape. Every field is a
 * direct pass-through of an already-persisted Stage 4/5 value — classification and review
 * state are validated against the exact Stage 5 enums and returned unchanged; quote
 * verification (including ABSENT/AMBIGUOUS) is preserved exactly, never upgraded. Nothing
 * here is invented: a malformed or incomplete row is rejected, not patched.
 */
export function toStage5EvidenceReference(row: EvidenceRow): Stage5EvidenceReference {
  if (!row || typeof row !== "object") throw invalid("Evidence row is required.");
  if (!EVIDENCE_CLASSIFICATIONS.includes(row.classification as never)) throw invalid("Unknown evidence classification.");
  if (!EVIDENCE_REVIEW_STATES.includes(row.review_state as never)) throw invalid("Unknown evidence review state.");
  if (!["EXACT", "NORMALIZED_WHITESPACE", "AMBIGUOUS", "ABSENT"].includes(row.quote_verification as never))
    throw invalid("Unknown quote verification state.");
  if (typeof row.exact_quote !== "string") throw invalid("exact_quote is required.");
  if (typeof row.page_number !== "number" || row.page_number < 1) throw invalid("page_number is required.");
  return {
    matterId: requireUuid(row.matter_id, "matter_id"),
    evidenceItemId: requireUuid(row.id, "id"),
    classification: row.classification,
    evidenceReviewState: row.review_state,
    documentId: requireUuid(row.document_id, "document_id"),
    documentVersionId: requireUuid(row.document_version_id, "document_version_id"),
    pageId: requireUuid(row.page_id, "page_id"),
    pageNumber: row.page_number,
    extractionRunId: requireUuid(row.extraction_run_id, "extraction_run_id"),
    exactQuote: row.exact_quote,
    quoteVerification: row.quote_verification,
    quoteStartOffset: row.quote_start_offset,
    quoteEndOffset: row.quote_end_offset,
  };
}

// ---------------------------------------------------------------------------
// Date translation — never invents a date; absent/unrecognized input is UNKNOWN.
// ---------------------------------------------------------------------------

export type Stage5DateInput = CaseDate | null | undefined;

/**
 * Structured date translation only. This never derives a case date from unrelated metadata
 * such as an upload/created timestamp, and never substitutes the current date. Missing or
 * unrecognized input becomes Stage 6's own `{ kind: "UNKNOWN" }`, which resolveApplicableVersion
 * already resolves safely to UNKNOWN_DATE — never a silent current-law fallback. Stage 5 M1 has
 * no structured event-date model yet, so today this only ever receives an explicit caller-
 * supplied date or nothing; it does not attempt to parse free text.
 */
export function translateCaseDate(input: Stage5DateInput): CaseDate {
  if (!input || typeof input !== "object") return { kind: "UNKNOWN" };
  if (input.kind === "UNKNOWN") return { kind: "UNKNOWN" };
  if ((input.kind === "EXACT" || input.kind === "APPROXIMATE") && typeof input.date === "string") return input;
  return { kind: "UNKNOWN" };
}

// ---------------------------------------------------------------------------
// Legal-mapping input assembly — everything except legal authority selection.
// ---------------------------------------------------------------------------

/** Every LegalMappingInput field this adapter is allowed to produce. legalSource/provision are
 * deliberately excluded: Stage 6's own generation layer must supply those after resolving which
 * authority actually applies. This type omission is what makes authority selection unreachable
 * from this file, not just an unenforced convention. */
export type LegalMappingInputBase = Omit<LegalMappingInput, "legalSource" | "provision">;

export interface Stage56AdapterRequest {
  evidence: EvidenceRow;
  /** Structured date only; omit when no usable event date exists. Never a raw/free-text date. */
  caseDate?: Stage5DateInput;
  /** Caller-supplied (human or Stage 6 generation layer), never invented here. */
  potentialIssue: string;
  /** Must already satisfy Stage 6's neutral-relevance framing; this function does not soften or rewrite it. */
  reasonForRelevance: string;
  /** Only ever a real, already-existing Stage 5 M2 event/person id. Omit/null when none exists — never synthesized. */
  associatedEventOrPersonId?: string | null;
}

/**
 * Assembles everything a Stage 6 legal mapping needs except the legal source/provision
 * selection. The caller (Stage 6's generation layer) must merge the returned object with an
 * already-selected LegalSource/LegalProvision before calling legalAuthority.ts's own
 * `buildLegalMapping`. This function never asserts legal relevance itself — it only validates
 * and passes through already-produced, already-safe inputs, exactly like buildLegalMapping does
 * on the Stage 6 side.
 */
export function buildLegalMappingInputBase(request: Stage56AdapterRequest): LegalMappingInputBase {
  if (!request || typeof request !== "object") throw invalid("Adapter request is required.");
  const evidenceRef = toStage5EvidenceReference(request.evidence);
  if (typeof request.potentialIssue !== "string" || !request.potentialIssue.trim())
    throw invalid("potentialIssue is required.");
  assertSafeLegalLanguage(request.reasonForRelevance);
  const associatedEventOrPersonId =
    request.associatedEventOrPersonId == null ? null : requireUuid(request.associatedEventOrPersonId, "associatedEventOrPersonId");

  return {
    matterId: evidenceRef.matterId,
    evidenceItemId: evidenceRef.evidenceItemId,
    // Classification and evidence review state are passed through unchanged from Stage 5 —
    // this adapter has no code path that writes ClassificationType or EvidenceReviewState,
    // and no code path here ever reads evidenceReviewState to set a Stage 6 legal review state.
    evidenceClassification: evidenceRef.classification,
    evidenceReviewState: evidenceRef.evidenceReviewState,
    caseDate: translateCaseDate(request.caseDate),
    potentialIssue: request.potentialIssue.trim(),
    reasonForRelevance: request.reasonForRelevance.trim(),
    associatedEventOrPersonId,
  };
}
