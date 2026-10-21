/**
 * Form information shown in the court-preparation workspace. A static copy of the verified entries in
 * api/services/officialFormSourceManifest.ts (client code cannot import that module, which uses Node
 * APIs). A server-side test fails if this copy and the manifest disagree.
 *
 * currentness is "UNKNOWN" for every form: the repository has not checked any of them against the
 * official index as the current version. Nothing here says a form is current or accepted by a court.
 */
export const COURT_FORM_INDEX_URL = "https://ontariocourtforms.on.ca/en/family-law-rules-forms/";
export const COURT_FORM_INDEX_OBSERVED = "2026-09-22";

export interface CourtFormInfo {
  formNumber: string;
  title: string;
  versionDate: string;
  effectiveDate: string;
  currentness: "UNKNOWN";
  /** What the form is for, in plain language. Whether it applies to a given case is for counsel to confirm. */
  purpose: string;
}

export const COURT_FORMS: CourtFormInfo[] = [
  { formNumber: "8B", title: "Application (child protection and status review)", versionDate: "Feb. 1, 2022", effectiveDate: "May 1, 2022", currentness: "UNKNOWN", purpose: "The society's application to the court in a child protection case." },
  { formNumber: "33B.1", title: "Answer and plan of care (parties other than Children's Aid Society)", versionDate: "Dec. 1, 2020", effectiveDate: "March 1, 2021", currentness: "UNKNOWN", purpose: "A party's answer and proposed plan of care." },
  { formNumber: "33C", title: "Statement of agreed facts (child protection)", versionDate: "March 1, 2018", effectiveDate: "April 30, 2018", currentness: "UNKNOWN", purpose: "Facts the parties agree on, to shorten the hearing." },
  { formNumber: "35.1A", title: "Affidavit (child protection information)", versionDate: "Dec. 1, 2020", effectiveDate: "March 1, 2021", currentness: "UNKNOWN", purpose: "A sworn statement with child protection information. Must be sworn before a commissioner." },
  { formNumber: "14A", title: "Affidavit (General)", versionDate: "Sept. 1, 2005", effectiveDate: "May 1, 2006", currentness: "UNKNOWN", purpose: "A general sworn statement used in Family Law Rules motions." },
];

export const FORM_SAFEGUARDS = [
  "This workspace does not fill, sign, file, or serve any form.",
  "Confirm the current version on the official index before use. Currentness has not been checked.",
  "Whether a form applies to your case depends on the stage and type of proceeding. Ask counsel or duty counsel.",
  "Affidavits must be sworn or affirmed before a commissioner. This tool cannot do that.",
];
