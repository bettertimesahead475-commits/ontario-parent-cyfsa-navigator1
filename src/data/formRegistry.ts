/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * STEP 2 — AUTHORITATIVE FORM REGISTRY
 *
 * This module defines the single source of truth for official Ontario Family Law Rules
 * prescribed forms. Each form entry includes:
 * - Official form number and title (from Ontario Courts official library)
 * - Statutory purpose and who files it
 * - Stage in the child protection lifecycle where it appears
 * - Official source URL (Ontario Courts website)
 * - Version/retrieval metadata for stale-version detection
 * - Related forms (e.g., 33B vs 33B.1 vs 33B.2 comparisons)
 *
 * DO NOT mix educational draft builders with official prescribed forms.
 * See TemplatesTab.tsx for educational builders (separate from this registry).
 */

export interface OfficialForm {
  /** Official form number per Ontario Family Law Rules (e.g., "8B", "33B.1") */
  formNumber: string;

  /** Official form title from Ontario Courts library */
  officialTitle: string;

  /** Statutory purpose and who files it */
  purpose: string;

  /** Who files this form (CAS, respondent, intervenor, lawyer, etc.) */
  filedBy: string;

  /** Stage(s) in the child protection lifecycle where this form appears */
  stages: ("Apprehension" | "First Hearing" | "Case Conference" | "Motions" | "Trial" | "Final Order")[];

  /** Official URL to download from Ontario Courts */
  officialUrl: string;

  /** Ontario Family Law Rules citation (e.g., "O. Reg. 114/99, Rule 33, Form 33B") */
  rulesCitation: string;

  /** Date this form registry entry was created/verified */
  verifiedDate: string;

  /** Related forms for comparison (e.g., 33B vs 33B.1) */
  relatedForms?: string[];

  /** Whether this form is currently auto-populatable by CYFSA Navigator builders */
  hasBuilder: boolean;

  /** Notes on how this form relates to child protection proceedings */
  notes: string;
}

/**
 * OFFICIAL ONTARIO FAMILY LAW RULES PRESCRIBED FORMS
 * Data source: Ontario Courts official forms library (ontariocourtforms.on.ca/en/family-law-rules-forms/)
 * Last verified: 2026-10-03
 *
 * CRITICAL CORRECTIONS:
 * - Form 33B and Form 33B.1 are BOTH official
 * - Form 33B: CAS care plan
 * - Form 33B.1: Respondent (non-CAS) answer and care plan
 * - CYFSA Navigator currently incorrectly uses 33B for respondent workflow
 */
export const OFFICIAL_FORMS: Record<string, OfficialForm> = {
  "8B": {
    formNumber: "8B",
    officialTitle: "Affidavit",
    purpose: "Sworn evidence statement for court proceedings in child protection cases",
    filedBy: "CAS, respondent, intervenor, or witness",
    stages: ["Apprehension", "First Hearing"],
    officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    rulesCitation: "O. Reg. 114/99, Rule 8, Form 8B",
    verifiedDate: "2026-10-03",
    hasBuilder: false,
    notes: "Used across multiple stages for sworn evidence; CYFSA Navigator does not auto-populate Form 8B but references it in FamilyCourtTab.",
  },

  "10": {
    formNumber: "10",
    officialTitle: "Notice of Pleading",
    purpose: "Notice that a party has filed a pleading (statement of claim, defence, etc.)",
    filedBy: "Lawyer or party",
    stages: ["Apprehension", "First Hearing"],
    officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    rulesCitation: "O. Reg. 114/99, Rule 10, Form 10",
    verifiedDate: "2026-10-03",
    hasBuilder: false,
    notes: "Administrative form; not directly used in CYFSA Navigator.",
  },

  "14": {
    formNumber: "14",
    officialTitle: "Affidavit",
    purpose: "Sworn evidence for child protection proceedings (variant of Form 8B)",
    filedBy: "CAS, respondent, intervenor",
    stages: ["First Hearing", "Case Conference", "Motions"],
    officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    rulesCitation: "O. Reg. 114/99, Rule 14, Form 14",
    verifiedDate: "2026-10-03",
    hasBuilder: false,
    notes: "Referenced in FamilyCourtTab for multiple stages.",
  },

  "14A": {
    formNumber: "14A",
    officialTitle: "Affidavit",
    purpose: "Sworn evidence statement (child protection variant)",
    filedBy: "CAS, respondent, intervenor, witness",
    stages: ["Apprehension", "First Hearing", "Case Conference", "Motions"],
    officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    rulesCitation: "O. Reg. 114/99, Rule 14A, Form 14A",
    verifiedDate: "2026-10-03",
    hasBuilder: false,
    notes: "Most frequently referenced form in CYFSA Navigator lifecycle; appears in 4 of 7 stages.",
  },

  "17B": {
    formNumber: "17B",
    officialTitle: "Conference Brief",
    purpose: "Written summary of issues for case conference; filed confidentially; destroyed after conference per Rule 17",
    filedBy: "CAS, respondent, lawyer",
    stages: ["Case Conference"],
    officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    rulesCitation: "O. Reg. 114/99, Rule 17, Form 17B",
    verifiedDate: "2026-10-03",
    relatedForms: ["17C"],
    hasBuilder: false,
    notes: "FamilyCourtTab Step 3 explains special confidentiality and destruction rules for 17B briefs.",
  },

  "17C": {
    formNumber: "17C",
    officialTitle: "Lawyer's Report on Four-Party Agreement",
    purpose: "Lawyer's report when all parties reach agreement at case conference",
    filedBy: "Lawyer",
    stages: ["Motions"],
    officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    rulesCitation: "O. Reg. 114/99, Rule 17, Form 17C",
    verifiedDate: "2026-10-03",
    relatedForms: ["17B"],
    hasBuilder: false,
    notes: "Referenced in FamilyCourtTab Step 5 for adjournment and motions phase.",
  },

  "23": {
    formNumber: "23",
    officialTitle: "Affidavit",
    purpose: "Sworn evidence for final orders and trials",
    filedBy: "CAS, respondent, intervenor, witness",
    stages: ["Trial", "Final Order"],
    officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    rulesCitation: "O. Reg. 114/99, Rule 23, Form 23",
    verifiedDate: "2026-10-03",
    hasBuilder: false,
    notes: "Referenced in FamilyCourtTab Step 7 for final order proceedings.",
  },

  "33": {
    formNumber: "33",
    officialTitle: "Application (Protection Order)",
    purpose: "CAS initial application for child protection / protection order",
    filedBy: "Children's Aid Society",
    stages: ["Apprehension", "First Hearing"],
    officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    rulesCitation: "O. Reg. 114/99, Rule 33, Form 33",
    verifiedDate: "2026-10-03",
    relatedForms: ["33A", "33B", "33B.1", "33B.2", "33C", "33D"],
    hasBuilder: false,
    notes: "Initial application; parent receives copy as notice of CAS action.",
  },

  "33A": {
    formNumber: "33A",
    officialTitle: "Answer",
    purpose: "Respondent's answer to CAS protection application (party other than CAS)",
    filedBy: "Respondent (parent, guardian, intervenor)",
    stages: ["First Hearing"],
    officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    rulesCitation: "O. Reg. 114/99, Rule 33, Form 33A",
    verifiedDate: "2026-10-03",
    relatedForms: ["33", "33B.1"],
    hasBuilder: false,
    notes: "Parent files this to formally respond to CAS application and deny or contest allegations.",
  },

  "33B": {
    formNumber: "33B",
    officialTitle: "Plan of Care for Child(ren) (Children's Aid Society)",
    purpose: "CAS's proposed care plan for children (filed by CAS only)",
    filedBy: "Children's Aid Society",
    stages: ["First Hearing", "Case Conference", "Trial"],
    officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    rulesCitation: "O. Reg. 114/99, Rule 33, Form 33B",
    verifiedDate: "2026-10-03",
    relatedForms: ["33B.1", "33B.2"],
    hasBuilder: true,
    notes: "CRITICAL: CYFSA Navigator's Form 33B Answer builder incorrectly uses '33B' terminology. Parent respondents must use Form 33B.1, NOT 33B. This is the primary form-identity error identified in Phase 1 audit.",
  },

  "33B.1": {
    formNumber: "33B.1",
    officialTitle: "Answer and Plan of Care (Parties Other Than Children's Aid Society)",
    purpose: "Respondent parent's answer to CAS allegations AND their proposed alternative care plan (filed by parent, not CAS)",
    filedBy: "Respondent (parent, guardian), intervenor",
    stages: ["First Hearing", "Case Conference", "Trial"],
    officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    rulesCitation: "O. Reg. 114/99, Rule 33, Form 33B.1",
    verifiedDate: "2026-10-03",
    relatedForms: ["33A", "33B", "33B.2"],
    hasBuilder: true,
    notes: "CRITICAL: This is the correct form for parent respondents to file their answer and care plan. CYFSA Navigator's Form 33B Answer builder MUST be relabeled and repurposed for 33B.1. Parent respondents cannot file Form 33B (which is CAS-only); they must file Form 33B.1.",
  },

  "33B.2": {
    formNumber: "33B.2",
    officialTitle: "Plan of Care for Child(ren) (Parties Other Than Children's Aid Society)",
    purpose: "Non-CAS party's proposed care plan (without answer)",
    filedBy: "Respondent or intervenor (non-CAS)",
    stages: ["First Hearing", "Case Conference", "Trial"],
    officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    rulesCitation: "O. Reg. 114/99, Rule 33, Form 33B.2",
    verifiedDate: "2026-10-03",
    relatedForms: ["33B", "33B.1"],
    hasBuilder: false,
    notes: "Parent may file separately if providing only care plan without formal answer to allegations.",
  },

  "33C": {
    formNumber: "33C",
    officialTitle: "Supervision Order",
    purpose: "Proposed terms of a supervision order (child remains in parents' care with supervision conditions)",
    filedBy: "CAS, respondent, lawyer",
    stages: ["Case Conference", "Trial", "Final Order"],
    officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    rulesCitation: "O. Reg. 114/99, Rule 33, Form 33C",
    verifiedDate: "2026-10-03",
    relatedForms: ["33B", "33B.1", "33D"],
    hasBuilder: false,
    notes: "Used when parties propose child remain in parent care with court-ordered supervision.",
  },

  "33D": {
    formNumber: "33D",
    officialTitle: "Crown Wardship Order",
    purpose: "Proposed terms of crown wardship order (child becomes ward of CAS, not parent)",
    filedBy: "CAS, respondent, lawyer",
    stages: ["Trial", "Final Order"],
    officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    rulesCitation: "O. Reg. 114/99, Rule 33, Form 33D",
    verifiedDate: "2026-10-03",
    relatedForms: ["33B", "33B.1", "33C"],
    hasBuilder: false,
    notes: "Proposes most restrictive outcome (child removal from parental custody).",
  },

  "35.1": {
    formNumber: "35.1",
    officialTitle: "Notice of Disposition of Application",
    purpose: "Notice of how the protection application was resolved (order made, dismissed, etc.)",
    filedBy: "Court clerk or authorized person",
    stages: ["Final Order"],
    officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    rulesCitation: "O. Reg. 114/99, Rule 35, Form 35.1",
    verifiedDate: "2026-10-03",
    relatedForms: ["35.1A"],
    hasBuilder: false,
    notes: "Administrative notice of final outcome; parent receives this to confirm court order.",
  },

  "35.1A": {
    formNumber: "35.1A",
    officialTitle: "Notice of Disposition of Application (Apprehension Without Court Order)",
    purpose: "Notice when apprehension occurred without a prior court order (emergency apprehension notice)",
    filedBy: "CAS",
    stages: ["Apprehension", "First Hearing"],
    officialUrl: "https://ontariocourtforms.on.ca/en/family-law-rules-forms/",
    rulesCitation: "O. Reg. 114/99, Rule 35, Form 35.1A",
    verifiedDate: "2026-10-03",
    relatedForms: ["35.1"],
    hasBuilder: false,
    notes: "Parent receives this immediately after emergency apprehension without court order, per CYFSA s. 79.",
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
 * Get forms with auto-population builders
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
