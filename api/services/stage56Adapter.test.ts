import { describe, it, expect } from "vitest";
import { toStage5EvidenceReference, translateCaseDate, buildLegalMappingInputBase } from "./stage56Adapter.js";
import { EVIDENCE_CLASSIFICATIONS, type EvidenceRow } from "../../shared/evidenceReview.js";

const MATTER = "11111111-1111-1111-1111-111111111111";
const EVIDENCE = "22222222-2222-2222-2222-222222222222";
const DOCUMENT = "33333333-3333-3333-3333-333333333333";
const VERSION = "44444444-4444-4444-4444-444444444444";
const PAGE = "55555555-5555-5555-5555-555555555555";
const RUN = "66666666-6666-6666-6666-666666666666";
const EVENT = "77777777-7777-7777-7777-777777777777";

const row = (over: Partial<EvidenceRow> = {}): EvidenceRow => ({
  id: EVIDENCE,
  matter_id: MATTER,
  document_id: DOCUMENT,
  document_version_id: VERSION,
  page_id: PAGE,
  page_number: 1,
  extraction_run_id: RUN,
  classification: "ALLEGATION",
  review_state: "UNREVIEWED",
  normalized_statement: "A worker alleged neglect.",
  exact_quote: "The worker alleged neglect.",
  quote_verification: "EXACT",
  quote_start_offset: 0,
  quote_end_offset: 27,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
  document_name: "Intake Report",
  version_number: 1,
  last_review: null,
  ...over,
});

describe("Stage 5 evidence reference translation — classification pass-through", () => {
  it.each(EVIDENCE_CLASSIFICATIONS)("preserves classification %s unchanged", (classification) => {
    const ref = toStage5EvidenceReference(row({ classification }));
    expect(ref.classification).toBe(classification);
  });

  it("never turns ALLEGATION into FACT", () => {
    expect(toStage5EvidenceReference(row({ classification: "ALLEGATION" })).classification).toBe("ALLEGATION");
  });

  it("preserves evidence review state separately from classification", () => {
    const ref = toStage5EvidenceReference(row({ classification: "OPINION", review_state: "CONFIRMED" }));
    expect(ref.classification).toBe("OPINION");
    expect(ref.evidenceReviewState).toBe("CONFIRMED");
  });

  it("rejects an unknown classification rather than passing it through", () => {
    expect(() => toStage5EvidenceReference(row({ classification: "MADE_UP" as any }))).toThrow();
  });

  it("rejects an unknown evidence review state", () => {
    expect(() => toStage5EvidenceReference(row({ review_state: "MADE_UP" as any }))).toThrow();
  });
});

describe("Stage 5 evidence reference translation — quote safety", () => {
  it("preserves EXACT quote verification", () => {
    expect(toStage5EvidenceReference(row({ quote_verification: "EXACT" })).quoteVerification).toBe("EXACT");
  });
  it("preserves NORMALIZED_WHITESPACE quote verification", () => {
    expect(toStage5EvidenceReference(row({ quote_verification: "NORMALIZED_WHITESPACE" })).quoteVerification).toBe(
      "NORMALIZED_WHITESPACE",
    );
  });
  it("preserves AMBIGUOUS quote verification without upgrading it", () => {
    const ref = toStage5EvidenceReference(
      row({ quote_verification: "AMBIGUOUS", review_state: "REQUIRES_SOURCE", quote_start_offset: null, quote_end_offset: null }),
    );
    expect(ref.quoteVerification).toBe("AMBIGUOUS");
    expect(ref.quoteStartOffset).toBeNull();
    expect(ref.quoteEndOffset).toBeNull();
  });
  it("preserves ABSENT quote verification without upgrading it", () => {
    const ref = toStage5EvidenceReference(
      row({ quote_verification: "ABSENT", review_state: "REQUIRES_SOURCE", quote_start_offset: null, quote_end_offset: null }),
    );
    expect(ref.quoteVerification).toBe("ABSENT");
    expect(ref.quoteStartOffset).toBeNull();
    expect(ref.quoteEndOffset).toBeNull();
  });
  it("rejects an unknown quote verification value", () => {
    expect(() => toStage5EvidenceReference(row({ quote_verification: "MADE_UP" as any }))).toThrow();
  });
});

describe("Stage 5 evidence reference translation — provenance and identity", () => {
  it("preserves matterId and evidenceItemId exactly", () => {
    const ref = toStage5EvidenceReference(row({}));
    expect(ref.matterId).toBe(MATTER);
    expect(ref.evidenceItemId).toBe(EVIDENCE);
  });
  it("preserves document/version/page/run provenance exactly", () => {
    const ref = toStage5EvidenceReference(row({}));
    expect(ref.documentId).toBe(DOCUMENT);
    expect(ref.documentVersionId).toBe(VERSION);
    expect(ref.pageId).toBe(PAGE);
    expect(ref.extractionRunId).toBe(RUN);
    expect(ref.pageNumber).toBe(1);
  });
  it("rejects a non-UUID matterId rather than accepting a client-shaped claim silently", () => {
    expect(() => toStage5EvidenceReference(row({ matter_id: "not-a-uuid" }))).toThrow();
  });
  it("rejects a missing exact_quote", () => {
    expect(() => toStage5EvidenceReference(row({ exact_quote: undefined as any }))).toThrow();
  });
  it("rejects a malformed row", () => {
    expect(() => toStage5EvidenceReference(null as any)).toThrow();
    expect(() => toStage5EvidenceReference(undefined as any)).toThrow();
    expect(() => toStage5EvidenceReference("not an object" as any)).toThrow();
  });
});

describe("date translation — never invents a date", () => {
  it("translates an exact date unchanged", () => {
    expect(translateCaseDate({ kind: "EXACT", date: "2022-06-01" })).toEqual({ kind: "EXACT", date: "2022-06-01" });
  });
  it("translates an approximate date unchanged", () => {
    expect(translateCaseDate({ kind: "APPROXIMATE", date: "2022-06-01" })).toEqual({ kind: "APPROXIMATE", date: "2022-06-01" });
  });
  it("translates missing input to UNKNOWN, not a fallback date", () => {
    expect(translateCaseDate(undefined)).toEqual({ kind: "UNKNOWN" });
    expect(translateCaseDate(null)).toEqual({ kind: "UNKNOWN" });
  });
  it("translates an explicit UNKNOWN input to UNKNOWN", () => {
    expect(translateCaseDate({ kind: "UNKNOWN" })).toEqual({ kind: "UNKNOWN" });
  });
  it("never substitutes today's date or an upload timestamp for a missing case date", () => {
    // No path in translateCaseDate reads Date.now() or any created_at/updated_at field.
    const result = translateCaseDate(undefined);
    expect(result).toEqual({ kind: "UNKNOWN" });
    expect((result as any).date).toBeUndefined();
  });
  it("treats a malformed/unrecognized structured input as UNKNOWN rather than guessing", () => {
    expect(translateCaseDate({ kind: "EXACT", date: 12345 as any })).toEqual({ kind: "UNKNOWN" });
    expect(translateCaseDate({ kind: "SOMETHING_ELSE" } as any)).toEqual({ kind: "UNKNOWN" });
  });
});

const baseRequest = { evidence: row({}), potentialIssue: "Possible protection-grounds engagement", reasonForRelevance: "This evidence may engage a protection grounds provision." };

describe("legal-mapping input base assembly", () => {
  it("builds a base input with matterId/evidenceItemId/classification/reviewState preserved", () => {
    const base = buildLegalMappingInputBase(baseRequest);
    expect(base.matterId).toBe(MATTER);
    expect(base.evidenceItemId).toBe(EVIDENCE);
    expect(base.evidenceClassification).toBe("ALLEGATION");
    expect(base.evidenceReviewState).toBe("UNREVIEWED");
  });

  it("never includes a legalSource or provision field — authority selection is structurally unreachable", () => {
    const base: any = buildLegalMappingInputBase(baseRequest);
    expect(base.legalSource).toBeUndefined();
    expect(base.provision).toBeUndefined();
  });

  it("defaults caseDate to UNKNOWN when omitted, never a fallback date", () => {
    expect(buildLegalMappingInputBase(baseRequest).caseDate).toEqual({ kind: "UNKNOWN" });
  });

  it("passes through an explicit exact caseDate", () => {
    const base = buildLegalMappingInputBase({ ...baseRequest, caseDate: { kind: "EXACT", date: "2021-05-01" } });
    expect(base.caseDate).toEqual({ kind: "EXACT", date: "2021-05-01" });
  });

  it("leaves associatedEventOrPersonId null when no real reference exists — never synthesized", () => {
    expect(buildLegalMappingInputBase(baseRequest).associatedEventOrPersonId).toBeNull();
  });

  it("passes through a real associatedEventOrPersonId when supplied", () => {
    expect(buildLegalMappingInputBase({ ...baseRequest, associatedEventOrPersonId: EVENT }).associatedEventOrPersonId).toBe(EVENT);
  });

  it("rejects a non-UUID associatedEventOrPersonId rather than passing it through", () => {
    expect(() => buildLegalMappingInputBase({ ...baseRequest, associatedEventOrPersonId: "not-a-uuid" })).toThrow();
  });

  it("rejects conclusion language in reasonForRelevance — no synthetic legal conclusion is ever produced", () => {
    expect(() => buildLegalMappingInputBase({ ...baseRequest, reasonForRelevance: "The worker broke the law." })).toThrow();
    expect(() => buildLegalMappingInputBase({ ...baseRequest, reasonForRelevance: "CAS violated section 74." })).toThrow();
    expect(() => buildLegalMappingInputBase({ ...baseRequest, reasonForRelevance: "This proves misconduct." })).toThrow();
  });

  it("rejects a missing potentialIssue", () => {
    expect(() => buildLegalMappingInputBase({ ...baseRequest, potentialIssue: "  " })).toThrow();
  });

  it("rejects malformed evidence input deterministically", () => {
    expect(() => buildLegalMappingInputBase({ ...baseRequest, evidence: { ...row(), classification: "NOT_REAL" as any } })).toThrow();
    expect(() => buildLegalMappingInputBase({ ...baseRequest, evidence: null as any })).toThrow();
  });

  it("rejects a malformed request object", () => {
    expect(() => buildLegalMappingInputBase(null as any)).toThrow();
    expect(() => buildLegalMappingInputBase(undefined as any)).toThrow();
  });

  it("never infers a Stage 6 legal review state from the Stage 5 evidence review state", () => {
    // The base object carries evidenceReviewState as evidence metadata only; it has no
    // reviewStatus/legal-review field at all — that is set exclusively by Stage 6's own
    // buildLegalMapping once a legalSource/provision is merged in, never by this adapter.
    const base: any = buildLegalMappingInputBase({ ...baseRequest, evidence: row({ review_state: "CONFIRMED" }) });
    expect(base.reviewStatus).toBeUndefined();
    expect(base.legalReviewState).toBeUndefined();
  });
});
