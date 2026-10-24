/**
 * Labels and the standard eight questions shared by the on-screen report and its export, so the two
 * always show the same wording and the same findings.
 */
import type { ConcernStatus, QuoteStatus, AuthorityStatus, ReportFinding, SectionStatus } from "./reportContract";

export const SECTION_STATUS_LABEL: Record<SectionStatus, string> = {
  POPULATED: "Findings included",
  EMPTY: "No relevant finding identified",
  NOT_APPLICABLE: "Not applicable to this document",
  NOT_GENERATED: "Not produced by this analysis",
};

export const CONCERN_LABEL: Record<ConcernStatus, string> = {
  POSSIBLE_CONCERN: "Possible concern to check",
  MISSING_INFORMATION: "Missing information",
  NOT_INDEPENDENTLY_VERIFIED: "Not yet checked against other records",
  NOT_APPLICABLE: "Information only",
};

export const QUOTE_LABEL: Record<QuoteStatus, string> = {
  CONFIRMED_FROM_SOURCE: "Quotation confirmed in the uploaded text",
  NOT_FOUND_IN_SOURCE: "Quotation not found in the uploaded text",
  NOT_CHECKED: "Quotation not checked",
};

export const AUTHORITY_LABEL: Record<AuthorityStatus, string> = {
  CONFIRMED_SECTION_NUMBER: "Section number is on the app's list of confirmed section numbers. The section text was not compared. Confirm with counsel.",
  CITATION_UNVERIFIED: "Citation unverified: confirm with counsel",
  NOT_CHECKED: "Citation not checked",
};

export const EIGHT_QUESTIONS = [
  "What happened?",
  "What evidence supports it?",
  "What evidence challenges it?",
  "Why does it matter?",
  "What law may apply?",
  "What have courts said?",
  "What is still unknown?",
  "What preparation steps may help?",
] as const;

export type AnswerState = "PROVIDED" | "NOT_IDENTIFIED" | "NOT_RESEARCHED" | "NOT_STATED";

export interface QuestionAnswer {
  question: string;
  answer: string;
  state: AnswerState;
}

const NOT_IDENTIFIED = "Not identified in this analysis. Check the quoted passage and the sources listed below.";
const NOT_RESEARCHED = "Not researched. No verified court decision is connected to this analysis yet.";

/** The standard eight answers for one finding. Each is marked provided, not identified, not researched, or not stated. */
export function findingAnswers(f: ReportFinding): QuestionAnswer[] {
  const provided = (text: string, fallback: string): [string, AnswerState] =>
    text.trim() ? [text.trim(), "PROVIDED"] : [fallback, "NOT_STATED"];
  const law = f.whatLawSays.trim()
    ? f.whatLawSays.trim()
    : f.authorities.length
      ? f.authorities.map((a) => a.citation).join("; ")
      : "";
  const [lawText, lawState] = law ? [law, "PROVIDED" as AnswerState] : ["No statute is cited for this point.", "NOT_STATED" as AnswerState];
  const unknown = f.whatIsUnknown.trim() || f.uncertainty.trim();
  const rows: [string, AnswerState][] = [
    provided(f.whatHappened, "The analysis does not state what happened."),
    f.supportingFindingIds.length ? [`${f.supportingFindingIds.length} linked finding(s).`, "PROVIDED"] : [NOT_IDENTIFIED, "NOT_IDENTIFIED"],
    f.contraryFindingIds.length ? [`${f.contraryFindingIds.length} linked finding(s).`, "PROVIDED"] : [NOT_IDENTIFIED, "NOT_IDENTIFIED"],
    provided(f.whyItMatters, "The analysis does not explain why this matters."),
    [lawText, lawState],
    [NOT_RESEARCHED, "NOT_RESEARCHED"],
    unknown ? [unknown, "PROVIDED"] : ["The analysis does not list what is still unknown.", "NOT_STATED"],
    provided(f.whatYouCanDo, "The analysis suggests no preparation step for this point."),
  ];
  return EIGHT_QUESTIONS.map((question, i) => ({ question, answer: rows[i][0], state: rows[i][1] }));
}

/** Human-readable location for a source reference, shown to parents and professionals alike. */
export function sourceLabel(locator: string): string {
  return locator.trim() || "Location not given";
}

/** Plain-language meanings for legal words that appear in the report. Shown on screen and in exports. */
export const GLOSSARY: { term: string; meaning: string }[] = [
  { term: "Affidavit", meaning: "A written statement that a person signs and swears or affirms is true." },
  { term: "Hearsay", meaning: "Something a person says they were told by someone else. Judges can admit it in these cases, but how much weight it gets is for the judge." },
  { term: "Adjournment", meaning: "A postponement of a hearing to a later date." },
  { term: "Interim order", meaning: "A temporary order that stays in place until a final decision is made." },
  { term: "Endorsement", meaning: "A judge's short written decision or note on a court file, often with reasons." },
  { term: "Place of safety", meaning: "Under the CYFSA, a foster home, a hospital, a person's home that meets the Act's conditions, or a place designated by a Director. It does not include temporary detention, open custody or secure custody. A child may be taken there under a warrant or without one." },
  { term: "Disclosure", meaning: "Sharing records and information with the other side before a hearing." },
  { term: "Party", meaning: "A person with formal standing in the case, who can take a full part in it." },
  { term: "Statute", meaning: "A law passed by a legislature, such as the Child, Youth and Family Services Act (CYFSA)." },
  { term: "Verified", meaning: "Checked against a source in this system or against the uploaded text. It is not a legal opinion." },
];

/** Shown on every report. Legal information only, not advice about a particular case. */
export const LEGAL_INFORMATION_NOTICE =
  "This report is legal information to help you prepare. It is not legal advice about your case. Confirm important points with a lawyer or duty counsel.";
