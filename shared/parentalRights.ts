/**
 * Source-grounded parental-rights education. Not yet imported by any screen.
 *
 * Every `quote` is copied verbatim from the official CYFSA consolidation kept in
 * legal-reference/CYFSA_full_text_2026-06-24_consolidation.txt. A test checks each quote against
 * that file, so a statute can't be cited here unless the text is really there.
 *
 * `plainEnglish` is a simplified explanation. It must not add a right the quoted text doesn't give.
 * `appliesWhen` says when the provision matters. Nothing here decides that a right was breached.
 */

export interface ParentalRightEntry {
  id: string;
  title: string;
  /** Section reference in the CYFSA, as it appears in the consolidation. */
  section: string;
  /** Exact wording from the consolidation (whitespace may be normalised). */
  quote: string;
  plainEnglish: string;
  appliesWhen: string;
  /** What a parent should check in their own documents. Never a conclusion about a violation. */
  verifyInDocuments: string;
  /** What this entry does not cover. */
  limitations: string;
}

export const PARENTAL_RIGHTS: ParentalRightEntry[] = [
  {
    id: "parent-is-a-party",
    title: "You are a party to the case",
    section: "CYFSA s. 79(1)",
    quote: "The following are parties to a proceeding under this Part:",
    plainEnglish:
      "The law lists who the parties are in a child protection case. A child's parent is one of them, so you have a formal place in the case.",
    appliesWhen: "In any child protection proceeding under Part V of the CYFSA where the person is the child's parent. Being named in the papers is a document check, not a condition.",
    verifyInDocuments: "Check that you are named as a party in the application and the court papers. If you are a parent and are not named, raise it with counsel.",
    limitations: "Whether a specific person counts as the child's parent can depend on facts this section does not decide.",
  },
  {
    id: "five-day-hearing",
    title: "Within five days after a place-of-safety removal, one of the listed steps must happen",
    section: "CYFSA s. 88",
    quote:
      "As soon as practicable, but in any event within five days after a child is brought to a place of safety under section 81",
    plainEnglish:
      "If a child is taken to a place of safety under the listed sections, as soon as practicable and within five days one of these must happen. The matter is brought before a court for a hearing. Or the child is returned to the person who last had charge of them, or to the person entitled to custody under an enforceable order. Or the child is returned to the child welfare authority, or other person, named in an extra-provincial order. Or a temporary care agreement is made. Or, for a 16 or 17 year old, an agreement is made under section 77.",
    appliesWhen: "Only where a child was brought to a place of safety under section 81, subclause 83(1)(a)(ii), or subsection 136(5).",
    verifyInDocuments: "Note the date the child was taken and the date of the first court appearance. Check whether any of the other listed outcomes happened within the five days. Ask counsel to confirm the calculation.",
    limitations: "The provision covers the listed removals only. Whether a breach occurred is for counsel to assess. It does not apply to every change in where a child lives.",
  },
  {
    id: "adjournment-limit",
    title: "Adjournments over 30 days need consent from all parties present and the caregiver, and are barred if the court is aware that an absent party objects",
    section: "CYFSA s. 94(1)",
    quote: "The court shall not adjourn a hearing for more than 30 days,",
    plainEnglish:
      "The court cannot postpone a hearing for more than 30 days unless all the parties present and the person caring for the child during the adjournment consent. It also cannot allow a longer delay if it knows a party who is absent objects.",
    appliesWhen: "Whenever a hearing under Part V is put off to a later date.",
    verifyInDocuments: "List each adjournment date and the stated reason. Check whether the record says who agreed to a longer delay.",
    limitations: "Consent must come from all the parties present and the person caring for the child during the adjournment. Whether an absent party objected must be checked on the actual record.",
  },
  {
    id: "plan-for-child",
    title: "Before certain orders, the court must obtain and consider a written plan from the society",
    section: "CYFSA s. 100",
    quote:
      "The court shall, before making an order under section 101, 102, 114 or 116, obtain and consider a plan for the child’s care prepared in writing by the society",
    plainEnglish:
      "Before some orders about a child's care, the judge must get a written plan from the society. The judge must also consider the plan.",
    appliesWhen: "Before the court makes an order under the sections the quote names.",
    verifyInDocuments: "Look for a written plan for the child's care. If none is in your records, ask for it and write down the date you asked.",
    limitations: "The text lists what the plan must include. Check the full section for those details.",
  },
  {
    id: "parent-rights-in-care",
    title: "Parents keep some rights while a child is in care",
    section: "CYFSA s. 14",
    quote: "the parent of a child in care retains any right that the parent may have,",
    plainEnglish:
      "When a child is in care, a parent keeps any right they already had, with some exceptions. A parent may keep directing the child's education and upbringing, in line with the child's creed, community identity and cultural identity. A parent who is the child's substitute decision-maker may also consent to treatment for an incapable child (Health Care Consent Act, 1996, s. 20). This does not give a parent a right they did not already have.",
    appliesWhen: "While the child is in care, and subject to the exceptions named at the start of the section.",
    verifyInDocuments: "Note any decisions about the child's education, upbringing, or treatment, and who made them, and whether the parent was the substitute decision-maker.",
    limitations: "The exceptions are custody during an adjournment (s. 94(7)), and interim and extended society care (ss. 110 and 111). Check those before relying on this. The treatment-consent right depends on the Health Care Consent Act, 1996, s. 20, which is cross-referenced in s. 14(b) but is not in this app's copy of the CYFSA.",
  },
  {
    id: "evidence-admissibility",
    title: "Any oral or written statement or report the court considers relevant can be admitted",
    section: "CYFSA s. 93(1)(b)",
    quote:
      "any oral or written statement or report that the court considers relevant to the proceeding, including a transcript, exhibit or finding or the reasons for a decision in an earlier civil or criminal proceeding, is admissible into evidence.",
    plainEnglish:
      "A judge can admit many statements and reports in these cases. This can happen even when the usual rules would be stricter. Second-hand information is not automatically excluded. The provision does not say how much weight a statement gets. That is a separate question for the judge.",
    appliesWhen: "In any proceeding under Part V, for statements the court considers relevant.",
    verifyInDocuments: "For each second-hand statement, note who said it and whether that person's own account is in the record. The weight a judge gives it is a separate question.",
    limitations: "Admissible does not mean reliable. Weight, reliability, and the parent's answer to the statement are for the judge to decide.",
  },
  {
    id: "need-for-protection-grounds",
    title: "A child is in need of protection only where one of the listed situations is shown",
    section: "CYFSA s. 74(2)",
    quote: "A child is in need of protection where,",
    plainEnglish:
      "A child is in need of protection only if one listed situation is shown. One example: the child has been physically harmed by the person caring for them, or because that person failed to adequately care for or protect the child, or a pattern of neglect. Another: the child is likely to be harmed in these ways.",
    appliesWhen: "In any application asking the court to find a child in need of protection.",
    verifyInDocuments: "For each allegation, identify which listed situation the society says applies, and what record supports it.",
    limitations: "The list has several parts. Each must be checked against the facts and the record.",
  },
  {
    id: "appeal-by-parent",
    title: "A parent can appeal some orders",
    section: "CYFSA s. 121(1)(b)",
    quote: "any parent of the child;",
    plainEnglish:
      "A parent is one of the people who can appeal an order made under this Part. This section does not set the appeal deadline. Confirm the deadline with counsel and the court rules right away.",
    appliesWhen: "For orders made under Part V, subject to the rules in section 121 and the court rules. Does not apply to an assessment order under s. 98: s. 121(2) excludes it from this authorization.",
    verifyInDocuments: "Note the date of each order. Ask counsel about the appeal deadline right away.",
    limitations: "This entry does not give the appeal deadline, and it does not cover s. 98 assessment orders (s. 121(2)). No extension of the time for appeal is granted where the child has been placed for adoption (s. 121(5)).",
  },
];

/** Provisions that are NOT yet verified in this repository. Not yet shown to parents; if used, present them as gaps, not as rules. */
export const NOT_YET_VERIFIED = [
  "Family Law Rules (disclosure, affidavit form, and response timelines) — no verified copy available to this app.",
  "Charter of Rights and Freedoms provisions cited in analysis — no verified copy available to this app.",
  "Appeal deadlines and appeal court rules for CYFSA s. 121 — s. 121 does not set the deadline, and the court rules are not available to this app.",
  "Case law on any of the above — no verified case-law source is connected yet.",
];

/**
 * Legal conditions and exceptions for each entry, taken from the quoted text of the provision.
 * A keyword match in a report only makes a right a candidate. A right is established only when each
 * condition is shown by the records, and no exception applies.
 */
export interface RightConditions {
  /** Conditions the provision sets, in the words of the provision as far as possible. */
  conditions: string[];
  /** Exceptions or other provisions the text expressly names. */
  exceptions: string[];
}

export const RIGHT_CONDITIONS: Record<string, RightConditions> = {
  "parent-is-a-party": {
    conditions: ["A proceeding under Part V of the CYFSA exists.", "The person is the child's parent."],
    exceptions: ["Whether a person is the child's parent can depend on facts this section does not decide."],
  },
  "five-day-hearing": {
    conditions: [
      "The child was brought to a place of safety under s. 81, s. 83(1)(a)(ii), or s. 136(5).",
      "One of the outcomes in s. 88(a) to (e) happens within five days of the placement.",
    ],
    exceptions: ["The provision covers the listed removals only."],
  },
  "adjournment-limit": {
    conditions: [
      "A hearing under Part V is adjourned.",
      "The adjournment is for more than 30 days.",
      "Check that the court is not aware that a party who is not present objects. If it is aware, a longer adjournment is not allowed (s. 94(1)(b)).",
    ],
    exceptions: [
      "All parties present and the person caring for the child during the adjournment consent (s. 94(1)(a)).",
    ],
  },
  "plan-for-child": {
    conditions: ["The court is about to make an order under s. 101, 102, 114, or 116."],
    exceptions: ["The provision applies only before the listed orders."],
  },
  "parent-rights-in-care": {
    conditions: [
      "The child is in care.",
      "The parent has a right in question (for example, to direct education and upbringing).",
      "For consent to treatment, the parent is the child's substitute decision-maker under s. 20 of the Health Care Consent Act, 1996 (s. 14(b)).",
    ],
    exceptions: ["Subject to s. 94(7) and ss. 110 and 111 (custody during adjournment, interim and extended society care)."],
  },
  "evidence-admissibility": {
    conditions: [
      "A proceeding under Part V.",
      "The statement or report is relevant to the proceeding, as the court considers.",
    ],
    exceptions: ["Admissible does not mean reliable. Weight is for the judge."],
  },
  "need-for-protection-grounds": {
    conditions: ["An application asks the court to find a child in need of protection.", "One listed situation in s. 74(2) is shown on the evidence."],
    exceptions: ["Naming a family in an application is not a finding."],
  },
  "appeal-by-parent": {
    conditions: ["An order was made under Part V.", "The appellant is a parent of the child."],
    exceptions: [
      "Does not apply to an assessment order under s. 98 (s. 121(2)).",
      "No extension of the appeal time is granted where the child has been placed for adoption (s. 121(5)).",
      "Section 121 does not set the appeal deadline. Confirm it with counsel and the court rules.",
    ],
  },
};
