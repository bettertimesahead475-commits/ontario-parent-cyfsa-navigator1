/**
 * Explicit, auditable user review of proposed official-form field values.
 * This module deliberately does not populate a DOCX or certify a filing.
 */
export type FieldSuggestion = {
  fieldKey: string;
  value: string;
  provenance: "USER_ENTERED" | "MATTER_DERIVED" | "MACHINE_SUGGESTED";
  sourceReference?: string;
};
export type ReviewedField = FieldSuggestion & { review: "PENDING" | "ACCEPTED" | "REJECTED"; reviewedByUser: boolean };
export type ReviewedFormDraft = {
  formNumber: string;
  templateSha256Hex: string;
  fields: ReviewedField[];
};
const SHA = /^[a-f0-9]{64}$/;
export function createReviewedFormDraft(formNumber: string, templateSha256Hex: string, suggestions: FieldSuggestion[]): ReviewedFormDraft {
  if (!formNumber.trim() || !SHA.test(templateSha256Hex)) throw new Error("A verified template identity is required");
  const keys = new Set<string>();
  return { formNumber, templateSha256Hex, fields: suggestions.map(s => {
    if (!s.fieldKey.trim() || keys.has(s.fieldKey)) throw new Error("Missing or duplicate field identity");
    keys.add(s.fieldKey);
    if (s.provenance !== "USER_ENTERED" && !s.sourceReference?.trim()) throw new Error("Derived suggestions require a source reference");
    return { ...s, review: "PENDING", reviewedByUser: false };
  }) };
}
export function reviewFormField(draft: ReviewedFormDraft, fieldKey: string, decision: "ACCEPTED" | "REJECTED", correctedValue?: string): ReviewedFormDraft {
  if (!draft.fields.some(f => f.fieldKey === fieldKey)) throw new Error("Unknown form field");
  return { ...draft, fields: draft.fields.map(field => field.fieldKey === fieldKey ? {
    ...field, value: correctedValue === undefined ? field.value : correctedValue,
    provenance: correctedValue === undefined ? field.provenance : "USER_ENTERED",
    review: decision, reviewedByUser: true
  } : field) };
}
export function getReviewedValuesForPopulation(draft: ReviewedFormDraft): Record<string, string> {
  if (!draft.fields.length || draft.fields.some(f => f.review !== "ACCEPTED" || !f.reviewedByUser)) {
    throw new Error("Every field must be explicitly accepted by the user before population");
  }
  return Object.fromEntries(draft.fields.map(f => [f.fieldKey, f.value]));
}
