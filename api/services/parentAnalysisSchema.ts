/**
 * Parent-specific analysis: the feature flag and the extraction schema requested inside the existing
 * overview model call. No separate model call is made. When the flag is OFF, nothing here changes the
 * prompt or the response contract.
 */

/** Server-side flag. Defaults to OFF: only the exact value "true" turns it on. */
export function isParentAnalysisEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env.PARENT_ANALYSIS_ENABLED === "true";
}

/** Keys added to the overview section when the flag is ON. Mirrored by parentExtraction.ts. */
export const PARENT_ATTRIBUTION_FIELD = "parentAttribution";

export const PARENT_ATTRIBUTION_SCHEMA = `  "parentAttribution": {
    "parties": [{"id": "short stable id such as P-1", "displayName": "name exactly as written in the document", "aliases": ["other names exactly as written"], "role": "APPLICANT | RESPONDENT | CHILD | PROPOSED_CAREGIVER | EXTENDED_FAMILY | OTHER_PARTY | UNKNOWN"}],
    "proceedings": [{"id": "short stable id such as PROC-1", "fileNumber": "court file number exactly as written, or empty string", "applicationDate": "YYYY-MM-DD or empty string", "childNames": ["child names exactly as written"]}],
    "roles": [{"proceedingId": "", "partyId": "", "role": "same list as party roles"}],
    "allegations": [{"id": "short stable id such as ALG-1", "proceedingId": "", "kind": "ALLEGATION or FINDING (FINDING only for a finding the court has made, as stated in the document)", "text": "the allegation in plain words", "madeBy": "who makes the statement, or empty string", "subjectPartyIds": ["party IDs this allegation is ABOUT, only when the document states it; otherwise empty"], "status": "ADMITTED | DISPUTED | CORROBORATED | UNSUPPORTED | UNRESOLVED", "classification": "DIRECT | DOCUMENTARY | CORROBORATED | HEARSAY | INFERENCE | OPINION | UNSUPPORTED | UNCLEAR", "quote": "verbatim quotation from the document that supports this record", "page": "page number as an integer, or null", "paragraph": "paragraph label as written, or empty string"}],
    "orders": [{"id": "short stable id such as ORD-1", "proceedingId": "", "description": "the order or outcome requested or proposed", "affectsPartyIds": ["party IDs the order affects"], "proposedCaregiverPartyId": "party ID proposed as caregiver, or empty string", "quote": "verbatim quotation from the document", "page": "page number as an integer, or null", "paragraph": "paragraph label as written, or empty string"}]
  }`;

export const PARENT_ATTRIBUTION_RULES = [
  "PARENT ATTRIBUTION RULES: Being named in a document does NOT make a person the subject of an allegation.",
  "Set subjectPartyIds only when the document states whom an allegation is about. Otherwise leave it empty.",
  "Never assign an allegation to a person because their name appears near it, or because they made or quoted the statement.",
  "Use kind FINDING only for an outcome the court has actually made. A worker's or parent's claim is an ALLEGATION.",
  "Every quote must be copied exactly from the document. If you cannot quote a record, leave it out.",
].join(" ");

/**
 * The section value a client may see while the analysis runs. The parent block is removed here because it is
 * unverified until attachParentAttribution checks it against the document, and it must not reach the stream or
 * the job's section record in its raw form.
 */
export function sectionForClient(value: Record<string, unknown>): Record<string, unknown> {
  const copy = { ...value };
  delete copy[PARENT_ATTRIBUTION_FIELD];
  return copy;
}
