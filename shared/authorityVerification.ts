/**
 * Provider-independent verification of legal authorities (case law).
 *
 * This module contains no case law. It defines what a verified authority must contain, rejects
 * records that lack it, and keeps unverified leads out of customer-facing conclusions. A licensed or
 * otherwise authorized source can be added later as an `AuthorityProvider`. Until one is connected,
 * `UNAVAILABLE_PROVIDER` is used and research is reported as unavailable.
 */

export type AuthorityStatus = "VERIFIED" | "UNVERIFIED_LEAD";
export type SubsequentTreatment = "CHECKED" | "NOT_CHECKED";
export type AuthorityStance = "SUPPORTING" | "CONTRARY" | "DISTINGUISHABLE" | "UNDETERMINED";

export interface AuthorityRecord {
  id: string;
  status: AuthorityStatus;
  caseName: string | null;
  court: string | null;
  decisionDate: string | null;
  neutralCitation: string | null;
  sourceReference: { sourceName: string; url: string | null; retrievedOn: string | null } | null;
  /** Paragraph numbers checked against the source text. Required for VERIFIED. */
  paragraphs: string[];
  legalPrinciple: string | null;
  applicationToIssue: string | null;
  similarities: string[];
  differences: string[];
  stance: AuthorityStance | null;
  subsequentTreatment: SubsequentTreatment;
  issueId: string | null;
}

export interface AuthorityProvider {
  readonly name: string;
  /** Returns records for a query. A provider must not return records it has not checked against a source. */
  find(query: string): Promise<AuthorityRecord[]>;
}

/** Used when no authorized source is connected. It returns nothing and never invents a result. */
export const UNAVAILABLE_PROVIDER: AuthorityProvider = {
  name: "none",
  async find() {
    return [];
  },
};

/** Returns the problems that stop a record from being labelled VERIFIED. An empty list means it passes. */
export function verificationProblems(r: AuthorityRecord): string[] {
  if (r.status !== "VERIFIED") return [];
  const problems: string[] = [];
  if (!r.caseName) problems.push("case name missing");
  if (!r.court) problems.push("court missing");
  if (!r.decisionDate) problems.push("decision date missing");
  if (!r.sourceReference) problems.push("source reference missing");
  if (r.paragraphs.length === 0) problems.push("paragraph references missing");
  if (!r.legalPrinciple) problems.push("legal principle missing");
  return problems;
}

/**
 * Authorities that may appear in a customer-facing conclusion: VERIFIED records that pass validation.
 * Subsequent treatment is always stated with the result. A record is never described as good law unless
 * its subsequent treatment has been CHECKED.
 */
export function customerAuthorities(records: AuthorityRecord[]): { record: AuthorityRecord; treatmentNote: string }[] {
  return records
    .filter((r) => r.status === "VERIFIED" && verificationProblems(r).length === 0)
    .map((r) => ({
      record: r,
      treatmentNote:
        r.subsequentTreatment === "CHECKED"
          ? "Subsequent treatment checked."
          : "Subsequent treatment not checked. This does not show the decision is still followed.",
    }));
}

/** Research status for Section 10, with the reason stated for the reader. */
export type ResearchStatus = "VERIFIED_AUTHORITIES_LISTED" | "SOURCE_UNAVAILABLE" | "NO_VERIFIED_AUTHORITY_FOUND" | "RESEARCH_NOT_PERFORMED";

export function researchStatus(provider: AuthorityProvider, performed: boolean, records: AuthorityRecord[]): ResearchStatus {
  if (!performed) return "RESEARCH_NOT_PERFORMED";
  if (provider.name === UNAVAILABLE_PROVIDER.name) return "SOURCE_UNAVAILABLE";
  if (customerAuthorities(records).length > 0) return "VERIFIED_AUTHORITIES_LISTED";
  return "NO_VERIFIED_AUTHORITY_FOUND";
}

export const RESEARCH_STATUS_NOTE: Record<ResearchStatus, string> = {
  VERIFIED_AUTHORITIES_LISTED: "Verified decisions are listed below, with their subsequent-treatment status.",
  SOURCE_UNAVAILABLE: "Case-law research is unavailable. No authorized judgment source is connected, so no decisions are listed.",
  NO_VERIFIED_AUTHORITY_FOUND: "Research was run, but no verified decision was found for this issue.",
  RESEARCH_NOT_PERFORMED: "Case-law research has not been performed for this report.",
};
