/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * AUTHORITATIVE ONTARIO COURT FORM REGISTRY
 *
 * Single source of truth for official Ontario Family Law Rules (O. Reg. 114/99)
 * prescribed forms. Each form entry includes:
 * - Official form number and title (verified against Ontario Court Forms: ontariocourtforms.on.ca)
 * - Statutory purpose and filing party
 * - Lifecycle stage(s) in Ontario child protection proceedings
 * - Authoritative source authority, URL, version/revision date, and verification timestamps
 * - Traceability metadata (formNumber, formTitle, officialSource, officialSourceUrl, lastVerified)
 * - Related forms and procedural guidance
 *
 * CRITICAL SEPARATION OF CONCERNS:
 * Educational preparation builders (Affidavit, Timeline, Evidence Log, Plan of Care Workbook, etc.)
 * in TemplatesTab.tsx are self-authored drafting tools clearly marked:
 * "⚠️ EDUCATIONAL PREPARATION DRAFT — NOT AN OFFICIAL FORM".
 * The official prescribed forms below are the only legal court forms recognized by the Ontario Court of Justice.
 */

export interface OfficialForm {
  /** Official form number per Ontario Family Law Rules (e.g., "8B", "14A", "33B.1") */
  formNumber: string;

  /** Official form title from Ontario Courts library */
  officialTitle: string;

  /** Standard form title (alias for source traceability) */
  formTitle: string;

  /** Statutory purpose and who files it */
  purpose: string;

  /** Who files this form (CAS, respondent, intervenor, lawyer, witness, etc.) */
  filedBy: string;

  /** Stage(s) in the child protection lifecycle where this form appears */
  stages: ("Apprehension" | "First Hearing" | "Case Conference" | "Motions" | "Trial" | "Final Order")[];

  /** Official URL to download from Ontario Courts */
  officialUrl: string;

  /** Authoritative source URL (alias for source traceability) */
  officialSourceUrl: string;

  /** Authoritative source authority identifier */
  officialSource: string;

  /** Ontario Family Law Rules citation (e.g., "O. Reg. 114/99, Rule 33, Form 33B.1") */
  rulesCitation: string;

  /** Official revision / version date when available from official index */
  versionDate?: string;

  /** Official effective date when available */
  effectiveDate?: string;

  /** Date this entry was last verified against authoritative Ontario sources */
  lastVerified: string;

  /** Date this entry was verified (alias for backwards compatibility) */
  verifiedDate: string;

  /** Related forms for comparison (e.g., 33B vs 33B.1) */
  relatedForms?: string[];

  /** Whether this form has an associated guided builder / field mapping in Navigator */
  hasBuilder: boolean;

  /** Notes on how this form relates to child protection proceedings */
  notes: string;
}

/**
 * OFFICIAL ONTARIO FAMILY LAW RULES PRESCRIBED FORMS
 * Canonical source: Ontario Courts official forms library (https://ontariocourtforms.on.ca/en/family-law-rules-forms/)
 * Last verified: 2026-10-08
 */
export const OFFICIAL_FORMS: Record<string, OfficialForm> = {
  "6B": {
    formNumber: "6B",
    officialTitle: "Affidavit of Service",
    formTitle: "Affidavit of Service",
    purpose: "Sworn proof that court documents were properly served on all required parties, CAS, or OCL under Rule 6",
    filedBy: "Party who served documents (parent, process server, lawyer)",
    stages: ["Apprehension", "First Hearing", "Case Conference", "Motions", "Trial", "Final Order"],
    officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    officialSourceUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    officialSource: "Ontario Courts Family Law Rules Forms Directory",
    rulesCitation: "O. Reg. 114/99, Rule 6, Form 6B",
    lastVerified: "2026-10-08",
    verifiedDate: "2026-10-08",
    hasBuilder: false,
    notes: "Mandatory in every step where documents are served; without Form 6B, court cannot proceed with hearings based on served materials.",
  },

  "8B": {
    formNumber: "8B",
    officialTitle: "Application (child protection and status review)",
    formTitle: "Application (child protection and status review)",
    purpose: "Originating application under CYFSA Part V to bring a child protection or status review proceeding before the court",
    filedBy: "Children's Aid Society (or party seeking status review under s. 102/115 CYFSA)",
    stages: ["Apprehension", "First Hearing"],
    officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    officialSourceUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    officialSource: "Ontario Courts Family Law Rules Forms Directory",
    rulesCitation: "O. Reg. 114/99, Rule 8 & Rule 33, Form 8B",
    versionDate: "Feb. 1, 2022",
    effectiveDate: "May 1, 2022",
    lastVerified: "2026-10-08",
    verifiedDate: "2026-10-08",
    relatedForms: ["14A", "33B.1", "35.1A"],
    hasBuilder: false,
    notes: "Canonical originating document in Ontario child protection cases. Not an affidavit. Outlines allegations and statutory protection orders sought by CAS.",
  },

  "10": {
    formNumber: "10",
    officialTitle: "Answer",
    formTitle: "Answer",
    purpose: "General family law answer; note that in child protection proceedings, respondent parents file Form 33B.1 instead of Form 10 per Rule 33(4)",
    filedBy: "Respondent (in non-protection family cases)",
    stages: ["First Hearing"],
    officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    officialSourceUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    officialSource: "Ontario Courts Family Law Rules Forms Directory",
    rulesCitation: "O. Reg. 114/99, Rule 10, Form 10",
    lastVerified: "2026-10-08",
    verifiedDate: "2026-10-08",
    relatedForms: ["33B.1"],
    hasBuilder: false,
    notes: "General family law form; child protection respondents file Form 33B.1 (Answer and plan of care) instead.",
  },

  "14": {
    formNumber: "14",
    officialTitle: "Notice of Motion",
    formTitle: "Notice of Motion",
    purpose: "Formal notice requesting an interim order, procedural directive, or temporary relief under Rule 14",
    filedBy: "Moving party (CAS, respondent parent, or intervenor)",
    stages: ["First Hearing", "Case Conference", "Motions"],
    officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    officialSourceUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    officialSource: "Ontario Courts Family Law Rules Forms Directory",
    rulesCitation: "O. Reg. 114/99, Rule 14, Form 14",
    lastVerified: "2026-10-08",
    verifiedDate: "2026-10-08",
    relatedForms: ["14A", "14B"],
    hasBuilder: false,
    notes: "Used to request temporary access, disclosure orders, or procedural relief. Supported by Form 14A affidavit.",
  },

  "14A": {
    formNumber: "14A",
    officialTitle: "Affidavit (General)",
    formTitle: "Affidavit (General)",
    purpose: "Sworn evidentiary statement supporting or responding to a motion, application, or contested issue under oath",
    filedBy: "CAS worker, respondent parent, kinship caregiver, or witness",
    stages: ["Apprehension", "First Hearing", "Case Conference", "Motions", "Trial"],
    officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    officialSourceUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    officialSource: "Ontario Courts Family Law Rules Forms Directory",
    rulesCitation: "O. Reg. 114/99, Rule 14, Form 14A",
    versionDate: "Sept. 1, 2005",
    effectiveDate: "May 1, 2006",
    lastVerified: "2026-10-08",
    verifiedDate: "2026-10-08",
    relatedForms: ["14", "14B"],
    hasBuilder: false,
    notes: "Most frequently filed sworn evidentiary document in Ontario family and child protection proceedings.",
  },

  "14B": {
    formNumber: "14B",
    officialTitle: "Motion Form",
    formTitle: "Motion Form",
    purpose: "Procedural or on-consent motion form determined without a full oral hearing under Rule 14(10)",
    filedBy: "Moving party (CAS, respondent parent, or lawyer)",
    stages: ["Motions"],
    officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    officialSourceUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    officialSource: "Ontario Courts Family Law Rules Forms Directory",
    rulesCitation: "O. Reg. 114/99, Rule 14, Form 14B",
    lastVerified: "2026-10-08",
    verifiedDate: "2026-10-08",
    relatedForms: ["14", "14A"],
    hasBuilder: false,
    notes: "Efficient form for procedural orders such as adjournments, extending deadlines, or orders agreed on consent.",
  },

  "17A": {
    formNumber: "17A",
    officialTitle: "Notice of Case Conference",
    formTitle: "Notice of Case Conference",
    purpose: "Formal notice scheduling a mandatory case conference under Rule 17",
    filedBy: "Court clerk or party requesting a case conference",
    stages: ["Case Conference"],
    officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    officialSourceUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    officialSource: "Ontario Courts Family Law Rules Forms Directory",
    rulesCitation: "O. Reg. 114/99, Rule 17, Form 17A",
    lastVerified: "2026-10-08",
    verifiedDate: "2026-10-08",
    relatedForms: ["17B"],
    hasBuilder: false,
    notes: "Official notice establishing the conference date, time, and statutory filing deadlines.",
  },

  "17B": {
    formNumber: "17B",
    officialTitle: "Conference Brief (child protection)",
    formTitle: "Conference Brief (child protection)",
    purpose: "Mandatory confidential brief summarizing issues, facts, and settlement positions for a child protection case conference under Rule 17",
    filedBy: "CAS, respondent parent, lawyer, or Office of the Children's Lawyer",
    stages: ["Case Conference"],
    officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    officialSourceUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    officialSource: "Ontario Courts Family Law Rules Forms Directory",
    rulesCitation: "O. Reg. 114/99, Rule 17, Form 17B",
    lastVerified: "2026-10-08",
    verifiedDate: "2026-10-08",
    relatedForms: ["17A", "17C"],
    hasBuilder: false,
    notes: "Rule 17 briefs are confidential and destroyed after the conference to encourage candid settlement discussions.",
  },

  "17C": {
    formNumber: "17C",
    officialTitle: "Settlement Conference Brief (general)",
    formTitle: "Settlement Conference Brief (general)",
    purpose: "Written summary of settlement positions and proposal for settlement conference under Rule 17",
    filedBy: "CAS, respondent parent, or counsel",
    stages: ["Motions", "Trial"],
    officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    officialSourceUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    officialSource: "Ontario Courts Family Law Rules Forms Directory",
    rulesCitation: "O. Reg. 114/99, Rule 17, Form 17C",
    lastVerified: "2026-10-08",
    verifiedDate: "2026-10-08",
    relatedForms: ["17B"],
    hasBuilder: false,
    notes: "Filed prior to a settlement conference to outline resolved issues and proposed settlement terms.",
  },

  "23": {
    formNumber: "23",
    officialTitle: "Summons to Witness",
    formTitle: "Summons to Witness",
    purpose: "Formal court summons compelling a witness to attend and give evidence under Rule 23",
    filedBy: "Party calling the witness (CAS, parent, or counsel)",
    stages: ["Trial"],
    officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    officialSourceUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    officialSource: "Ontario Courts Family Law Rules Forms Directory",
    rulesCitation: "O. Reg. 114/99, Rule 23, Form 23",
    lastVerified: "2026-10-08",
    verifiedDate: "2026-10-08",
    hasBuilder: false,
    notes: "Must be served personally on the witness along with prescribed witness attendance fees.",
  },

  "33": {
    formNumber: "33",
    officialTitle: "Child Protection Forms Series (Rule 33)",
    formTitle: "Child Protection Forms Series (Rule 33)",
    purpose: "Series designation under Rule 33 of the Family Law Rules governing child protection care plans, answers, and orders (Forms 33B, 33B.1, 33B.2, 33C, 33D)",
    filedBy: "Various parties (CAS, respondent parents, court)",
    stages: ["First Hearing", "Case Conference", "Trial", "Final Order"],
    officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    officialSourceUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    officialSource: "Ontario Courts Family Law Rules Forms Directory",
    rulesCitation: "O. Reg. 114/99, Rule 33",
    lastVerified: "2026-10-08",
    verifiedDate: "2026-10-08",
    relatedForms: ["33B", "33B.1", "33B.2", "33C", "33D"],
    hasBuilder: false,
    notes: "Rule 33 sets out specific child protection procedures; parents file Form 33B.1 while CAS files Form 33B.",
  },

  "33B": {
    formNumber: "33B",
    officialTitle: "Plan of care for child(ren) (Children's Aid Society)",
    formTitle: "Plan of care for child(ren) (Children's Aid Society)",
    purpose: "CAS's statutory care plan setting out proposed placement, medical, educational, and cultural services under Rule 33",
    filedBy: "Children's Aid Society ONLY",
    stages: ["First Hearing", "Case Conference", "Trial"],
    officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    officialSourceUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    officialSource: "Ontario Courts Family Law Rules Forms Directory",
    rulesCitation: "O. Reg. 114/99, Rule 33, Form 33B",
    lastVerified: "2026-10-08",
    verifiedDate: "2026-10-08",
    relatedForms: ["33B.1", "33B.2"],
    hasBuilder: false,
    notes: "Filed exclusively by CAS. Respondent parents must NOT file Form 33B; parents file Form 33B.1.",
  },

  "33B.1": {
    formNumber: "33B.1",
    officialTitle: "Answer and plan of care (parties other than Children's Aid Society)",
    formTitle: "Answer and plan of care (parties other than Children's Aid Society)",
    purpose: "Respondent parent's formal answer contesting CAS protection claims and setting out their alternative family/kinship care plan under Rule 33",
    filedBy: "Respondent (parent, caregiver), non-CAS party, or band representative",
    stages: ["First Hearing", "Case Conference", "Trial"],
    officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    officialSourceUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    officialSource: "Ontario Courts Family Law Rules Forms Directory",
    rulesCitation: "O. Reg. 114/99, Rule 33, Form 33B.1",
    versionDate: "Dec. 1, 2020",
    effectiveDate: "March 1, 2021",
    lastVerified: "2026-10-08",
    verifiedDate: "2026-10-08",
    relatedForms: ["33B", "33B.2", "33C"],
    hasBuilder: true,
    notes: "Mandatory prescribed form for respondents answering a child protection application. CYFSA Navigator provides educational preparation mapping to Form 33B.1.",
  },

  "33B.2": {
    formNumber: "33B.2",
    officialTitle: "Plan of care for child(ren) (parties other than Children's Aid Society)",
    formTitle: "Plan of care for child(ren) (parties other than Children's Aid Society)",
    purpose: "Alternative care plan by a non-CAS party (e.g. kinship caregiver or First Nation representative) who provides a plan without answering all application paragraphs",
    filedBy: "Kinship caregiver, non-CAS respondent, or Indigenous representative",
    stages: ["First Hearing", "Case Conference", "Trial"],
    officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    officialSourceUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    officialSource: "Ontario Courts Family Law Rules Forms Directory",
    rulesCitation: "O. Reg. 114/99, Rule 33, Form 33B.2",
    lastVerified: "2026-10-08",
    verifiedDate: "2026-10-08",
    relatedForms: ["33B", "33B.1"],
    hasBuilder: false,
    notes: "Provides care plan only without formal legal answer to each allegation.",
  },

  "33C": {
    formNumber: "33C",
    officialTitle: "Statement of agreed facts (child protection)",
    formTitle: "Statement of agreed facts (child protection)",
    purpose: "Joint statement of agreed facts signed by parties to narrow issues or resolve findings without full trial evidence under Rule 33",
    filedBy: "Jointly by CAS, respondent parent, and counsel",
    stages: ["Case Conference", "Trial", "Final Order"],
    officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    officialSourceUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    officialSource: "Ontario Courts Family Law Rules Forms Directory",
    rulesCitation: "O. Reg. 114/99, Rule 33, Form 33C",
    versionDate: "March 1, 2018",
    effectiveDate: "April 30, 2018",
    lastVerified: "2026-10-08",
    verifiedDate: "2026-10-08",
    relatedForms: ["33B", "33B.1", "33D"],
    hasBuilder: false,
    notes: "Joint statement of agreed facts. Not a supervision order.",
  },

  "33D": {
    formNumber: "33D",
    officialTitle: "Order (child protection)",
    formTitle: "Order (child protection)",
    purpose: "Formal court order issued following a protection hearing (supervision order, society care, or extended society care under CYFSA s. 101)",
    filedBy: "Court clerk or CAS counsel for judicial signature",
    stages: ["Trial", "Final Order"],
    officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    officialSourceUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    officialSource: "Ontario Courts Family Law Rules Forms Directory",
    rulesCitation: "O. Reg. 114/99, Rule 33, Form 33D",
    lastVerified: "2026-10-08",
    verifiedDate: "2026-10-08",
    relatedForms: ["33B", "33B.1", "33C"],
    hasBuilder: false,
    notes: "Prescribed disposition order in child protection proceedings.",
  },

  "35.1": {
    formNumber: "35.1",
    officialTitle: "Affidavit (decision-making responsibility, parenting time, contact)",
    formTitle: "Affidavit (decision-making responsibility, parenting time, contact)",
    purpose: "Affidavit regarding parenting arrangements in general family law claims (CLRA/Divorce Act); in child protection, Form 35.1A is used",
    filedBy: "Party claiming decision-making or parenting time in non-protection proceedings",
    stages: ["Final Order"],
    officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    officialSourceUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    officialSource: "Ontario Courts Family Law Rules Forms Directory",
    rulesCitation: "O. Reg. 114/99, Rule 35.1, Form 35.1",
    lastVerified: "2026-10-08",
    verifiedDate: "2026-10-08",
    relatedForms: ["35.1A"],
    hasBuilder: false,
    notes: "General family law custody/access form. Child protection proceedings require Form 35.1A.",
  },

  "35.1A": {
    formNumber: "35.1A",
    officialTitle: "Affidavit (child protection information)",
    formTitle: "Affidavit (child protection information)",
    purpose: "Sworn affidavit providing child protection background, prior proceedings, and family history under Rule 35.1",
    filedBy: "CAS worker or party providing child protection background information",
    stages: ["Apprehension", "First Hearing"],
    officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    officialSourceUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    officialSource: "Ontario Courts Family Law Rules Forms Directory",
    rulesCitation: "O. Reg. 114/99, Rule 35.1, Form 35.1A",
    versionDate: "Dec. 1, 2020",
    effectiveDate: "March 1, 2021",
    lastVerified: "2026-10-08",
    verifiedDate: "2026-10-08",
    relatedForms: ["8B", "14A"],
    hasBuilder: false,
    notes: "Sworn affidavit of child protection information under Rule 35.1. Not an administrative disposition notice.",
  },
};

/**
 * Get a form by its official form number
 * @param formNumber Official form number (e.g., "33B.1")
 * @returns OfficialForm or undefined if not found
 */
export function getOfficialForm(formNumber: string): OfficialForm | undefined {
  return OFFICIAL_FORMS[formNumber];
}

/**
 * Get all forms filed in a specific stage
 * @param stage Stage name
 * @returns Array of OfficialForm objects
 */
export function getFormsByStage(
  stage: "Apprehension" | "First Hearing" | "Case Conference" | "Motions" | "Trial" | "Final Order"
): OfficialForm[] {
  return Object.values(OFFICIAL_FORMS).filter(form => form.stages.includes(stage));
}

/**
 * Get all forms filed by a specific party
 * @param party Party type (e.g., "CAS", "respondent", "lawyer")
 * @returns Array of OfficialForm objects
 */
export function getFormsByFiledBy(party: string): OfficialForm[] {
  return Object.values(OFFICIAL_FORMS).filter(form => form.filedBy.toLowerCase().includes(party.toLowerCase()));
}

/**
 * Get forms with auto-population builders or educational mappings
 * @returns Array of OfficialForm objects that have hasBuilder: true
 */
export function getFormsWithBuilders(): OfficialForm[] {
  return Object.values(OFFICIAL_FORMS).filter(form => form.hasBuilder);
}

/**
 * List all form numbers in the registry (sorted)
 */
export function getAllFormNumbers(): string[] {
  return Object.keys(OFFICIAL_FORMS).sort();
}
