// Stage 9D-4B-2A-ii-b4A — Form 8B STRUCTURAL + PLEADING-DECISION BOUNDARY MANIFEST.
//
// SCOPE: structural/sensitivity classification only. This is NOT the Form 8B semantic field
// map (that is b4B, a future separate task). No detailed semantic keys, value types, or
// provenance are assigned here beyond what is needed to (a) group every one of the 115 real
// technical controls into a defensible structural section, (b) classify each control's
// pleading-decision sensitivity using the frozen ReviewSensitivityCategory vocabulary from
// semanticFieldMap.ts (9D-4B-2A-ii-a), and (c) gate each control SAFE_TO_MAP or
// REQUIRES_REVIEW for b4B. No control here carries a selected/default pleading answer.
//
// Source: independently reconstructed from the raw word/document.xml of the exact verified
// Form 8B DOCX artifact (sha256 02a5c3fdc32b42ed1f2db20115c1ff8bb9cf0233aa510a48063af9a10c5e7799,
// matching docxFieldInventoryData.ts's frozen Form 8B entry byte-for-byte) — not merely the
// frozen technical inventory's field type/name columns, which carry no label/section text.
import type { ReviewSensitivityCategory } from "./semanticFieldMap.js";

export const FORM_8B_STRUCTURAL_MANIFEST_SOURCE_SHA256 =
  "02a5c3fdc32b42ed1f2db20115c1ff8bb9cf0233aa510a48063af9a10c5e7799";

export const FORM_8B_STRUCTURAL_GROUPS = [
  "COURT_ADMINISTRATION",
  "PARTY_IDENTIFICATION",
  "CHILD_IDENTIFICATION",
  "REPRESENTATIVE_INFORMATION",
  "LEGAL_GROUND_OR_POSITION",
  "REQUESTED_ORDER",
  "APPLICATION_CONTEXT",
  "FACTUAL_NARRATIVE",
  "SIGNATURE_OR_ATTESTATION",
  "OTHER"
] as const;
export type Form8BStructuralGroup = (typeof FORM_8B_STRUCTURAL_GROUPS)[number];

export const STRUCTURAL_EVIDENCE_STRENGTHS = [
  "DIRECT_LABEL",
  "DIRECT_STRUCTURAL_CONTEXT",
  "STRUCTURAL_INFERENCE",
  "UNRESOLVED"
] as const;
export type StructuralEvidenceStrength = (typeof STRUCTURAL_EVIDENCE_STRENGTHS)[number];

export const MAP_READINESS_STATES = ["SAFE_TO_MAP", "REQUIRES_REVIEW"] as const;
export type MapReadinessState = (typeof MAP_READINESS_STATES)[number];

export interface Form8BStructuralManifestEntry {
  /** 0-based order in word/document.xml — matches TechnicalFieldIdentity.ordinal. */
  ordinal: number;
  /** w:name value from the frozen technical inventory, or "" for an unnamed field. */
  observedName: string;
  technicalType: string;
  structuralGroup: Form8BStructuralGroup;
  /** Non-null only for controls independently confirmed to belong to a repeated structure. */
  repeatedGroupId: string | null;
  reviewSensitivity: ReviewSensitivityCategory | "UNRESOLVED";
  evidence: StructuralEvidenceStrength;
  mapReadiness: MapReadinessState;
  rationale: string;
}

export const FORM_8B_STRUCTURAL_MANIFEST: readonly Form8BStructuralManifestEntry[] = [
  {
    ordinal: 0,
    observedName: "",
    technicalType: "dropdown",
    structuralGroup: "COURT_ADMINISTRATION",
    repeatedGroupId: null,
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Court-level dropdown directly preceded by no independent label but bound in the same table cell as the court-name/file-number block; dropdown options (Superior Court of Justice / SCJ Family Court / OCJ) are themselves the direct evidence of purpose."
  },
  {
    ordinal: 1,
    observedName: "CourtFileNo",
    technicalType: "text",
    structuralGroup: "COURT_ADMINISTRATION",
    repeatedGroupId: null,
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Technical name 'CourtFileNo' plus adjacent 'Court File Number' label text."
  },
  {
    ordinal: 2,
    observedName: "",
    technicalType: "text",
    structuralGroup: "COURT_ADMINISTRATION",
    repeatedGroupId: null,
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows '(Name of court) at' label."
  },
  {
    ordinal: 3,
    observedName: "",
    technicalType: "text",
    structuralGroup: "PARTY_IDENTIFICATION",
    repeatedGroupId: null,
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly under 'Applicant(s)' heading and 'Full legal name & address for service' column label."
  },
  {
    ordinal: 4,
    observedName: "",
    technicalType: "text",
    structuralGroup: "REPRESENTATIVE_INFORMATION",
    repeatedGroupId: null,
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly under 'Applicant(s)' heading, 'Lawyer's name & address' column label."
  },
  {
    ordinal: 5,
    observedName: "",
    technicalType: "text",
    structuralGroup: "PARTY_IDENTIFICATION",
    repeatedGroupId: null,
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly under 'Respondent(s)' heading and 'Full legal name & address for service' column label."
  },
  {
    ordinal: 6,
    observedName: "",
    technicalType: "text",
    structuralGroup: "REPRESENTATIVE_INFORMATION",
    repeatedGroupId: null,
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly under 'Respondent(s)' heading, 'Lawyer's name & address' column label."
  },
  {
    ordinal: 7,
    observedName: "",
    technicalType: "text",
    structuralGroup: "REPRESENTATIVE_INFORMATION",
    repeatedGroupId: null,
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly under 'Children's Lawyer' heading / agent-for-service label."
  },
  {
    ordinal: 8,
    observedName: "",
    technicalType: "text",
    structuralGroup: "COURT_ADMINISTRATION",
    repeatedGroupId: null,
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows 'THE FIRST COURT DATE IS (date)'."
  },
  {
    ordinal: 9,
    observedName: "",
    technicalType: "text",
    structuralGroup: "COURT_ADMINISTRATION",
    repeatedGroupId: null,
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows 'AT' (hearing time)."
  },
  {
    ordinal: 10,
    observedName: "",
    technicalType: "checkbox",
    structuralGroup: "COURT_ADMINISTRATION",
    repeatedGroupId: null,
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Checkbox immediately followed by label 'a.m.'."
  },
  {
    ordinal: 11,
    observedName: "",
    technicalType: "checkbox",
    structuralGroup: "COURT_ADMINISTRATION",
    repeatedGroupId: null,
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Checkbox immediately followed by label 'p.m.'."
  },
  {
    ordinal: 12,
    observedName: "",
    technicalType: "text",
    structuralGroup: "COURT_ADMINISTRATION",
    repeatedGroupId: null,
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows '...at: (address)'."
  },
  {
    ordinal: 13,
    observedName: "Check75",
    technicalType: "checkbox",
    structuralGroup: "REQUESTED_ORDER",
    repeatedGroupId: null,
    reviewSensitivity: "REQUESTED_ORDER",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Technical name 'Check75'; directly preceded by 'Check this box if this paragraph applies' and immediately precedes the child-support-claim paragraph \u2014 a pleading choice (whether a child-support claim is included), not an administrative fact. Structural identification only; box carries no selected/default state."
  },
  {
    ordinal: 14,
    observedName: "",
    technicalType: "text",
    structuralGroup: "COURT_ADMINISTRATION",
    repeatedGroupId: null,
    reviewSensitivity: "UNRESOLVED",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Falls in the 'Date of issue' / 'Clerk of the court' area on page 2 but no direct label text is bound to this specific control in the extracted paragraph flow; likely clerk/office-use administrative text, not independently confirmed."
  },
  {
    ordinal: 15,
    observedName: "",
    technicalType: "text",
    structuralGroup: "CHILD_IDENTIFICATION",
    repeatedGroupId: "child_identification_table_cell",
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Falls inside the 'THE CHILD(REN)' table directly under the column headers Child's Full Legal Name / Birthdate / Age / Sex / Full Legal Name(s) of Parent(s) / Is the Child First Nations, Inuk, or M\u00e9tis? / Child's Bands and First Nations, Inuit, or M\u00e9tis Communities. Group membership (child-identification table) is DIRECT_STRUCTURAL_CONTEXT, but the exact row/column assignment of each of the 32 cells could not be independently confirmed from the extracted paragraph flow alone (no per-cell label token survives table serialization at this pass) \u2014 column mapping is left REQUIRES_REVIEW for b4B rather than guessed."
  },
  {
    ordinal: 16,
    observedName: "",
    technicalType: "text",
    structuralGroup: "CHILD_IDENTIFICATION",
    repeatedGroupId: "child_identification_table_cell",
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Falls inside the 'THE CHILD(REN)' table directly under the column headers Child's Full Legal Name / Birthdate / Age / Sex / Full Legal Name(s) of Parent(s) / Is the Child First Nations, Inuk, or M\u00e9tis? / Child's Bands and First Nations, Inuit, or M\u00e9tis Communities. Group membership (child-identification table) is DIRECT_STRUCTURAL_CONTEXT, but the exact row/column assignment of each of the 32 cells could not be independently confirmed from the extracted paragraph flow alone (no per-cell label token survives table serialization at this pass) \u2014 column mapping is left REQUIRES_REVIEW for b4B rather than guessed."
  },
  {
    ordinal: 17,
    observedName: "",
    technicalType: "text",
    structuralGroup: "CHILD_IDENTIFICATION",
    repeatedGroupId: "child_identification_table_cell",
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Falls inside the 'THE CHILD(REN)' table directly under the column headers Child's Full Legal Name / Birthdate / Age / Sex / Full Legal Name(s) of Parent(s) / Is the Child First Nations, Inuk, or M\u00e9tis? / Child's Bands and First Nations, Inuit, or M\u00e9tis Communities. Group membership (child-identification table) is DIRECT_STRUCTURAL_CONTEXT, but the exact row/column assignment of each of the 32 cells could not be independently confirmed from the extracted paragraph flow alone (no per-cell label token survives table serialization at this pass) \u2014 column mapping is left REQUIRES_REVIEW for b4B rather than guessed."
  },
  {
    ordinal: 18,
    observedName: "",
    technicalType: "text",
    structuralGroup: "CHILD_IDENTIFICATION",
    repeatedGroupId: "child_identification_table_cell",
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Falls inside the 'THE CHILD(REN)' table directly under the column headers Child's Full Legal Name / Birthdate / Age / Sex / Full Legal Name(s) of Parent(s) / Is the Child First Nations, Inuk, or M\u00e9tis? / Child's Bands and First Nations, Inuit, or M\u00e9tis Communities. Group membership (child-identification table) is DIRECT_STRUCTURAL_CONTEXT, but the exact row/column assignment of each of the 32 cells could not be independently confirmed from the extracted paragraph flow alone (no per-cell label token survives table serialization at this pass) \u2014 column mapping is left REQUIRES_REVIEW for b4B rather than guessed."
  },
  {
    ordinal: 19,
    observedName: "",
    technicalType: "text",
    structuralGroup: "CHILD_IDENTIFICATION",
    repeatedGroupId: "child_identification_table_cell",
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Falls inside the 'THE CHILD(REN)' table directly under the column headers Child's Full Legal Name / Birthdate / Age / Sex / Full Legal Name(s) of Parent(s) / Is the Child First Nations, Inuk, or M\u00e9tis? / Child's Bands and First Nations, Inuit, or M\u00e9tis Communities. Group membership (child-identification table) is DIRECT_STRUCTURAL_CONTEXT, but the exact row/column assignment of each of the 32 cells could not be independently confirmed from the extracted paragraph flow alone (no per-cell label token survives table serialization at this pass) \u2014 column mapping is left REQUIRES_REVIEW for b4B rather than guessed."
  },
  {
    ordinal: 20,
    observedName: "",
    technicalType: "text",
    structuralGroup: "CHILD_IDENTIFICATION",
    repeatedGroupId: "child_identification_table_cell",
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Falls inside the 'THE CHILD(REN)' table directly under the column headers Child's Full Legal Name / Birthdate / Age / Sex / Full Legal Name(s) of Parent(s) / Is the Child First Nations, Inuk, or M\u00e9tis? / Child's Bands and First Nations, Inuit, or M\u00e9tis Communities. Group membership (child-identification table) is DIRECT_STRUCTURAL_CONTEXT, but the exact row/column assignment of each of the 32 cells could not be independently confirmed from the extracted paragraph flow alone (no per-cell label token survives table serialization at this pass) \u2014 column mapping is left REQUIRES_REVIEW for b4B rather than guessed."
  },
  {
    ordinal: 21,
    observedName: "",
    technicalType: "text",
    structuralGroup: "CHILD_IDENTIFICATION",
    repeatedGroupId: "child_identification_table_cell",
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Falls inside the 'THE CHILD(REN)' table directly under the column headers Child's Full Legal Name / Birthdate / Age / Sex / Full Legal Name(s) of Parent(s) / Is the Child First Nations, Inuk, or M\u00e9tis? / Child's Bands and First Nations, Inuit, or M\u00e9tis Communities. Group membership (child-identification table) is DIRECT_STRUCTURAL_CONTEXT, but the exact row/column assignment of each of the 32 cells could not be independently confirmed from the extracted paragraph flow alone (no per-cell label token survives table serialization at this pass) \u2014 column mapping is left REQUIRES_REVIEW for b4B rather than guessed."
  },
  {
    ordinal: 22,
    observedName: "",
    technicalType: "text",
    structuralGroup: "CHILD_IDENTIFICATION",
    repeatedGroupId: "child_identification_table_cell",
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Falls inside the 'THE CHILD(REN)' table directly under the column headers Child's Full Legal Name / Birthdate / Age / Sex / Full Legal Name(s) of Parent(s) / Is the Child First Nations, Inuk, or M\u00e9tis? / Child's Bands and First Nations, Inuit, or M\u00e9tis Communities. Group membership (child-identification table) is DIRECT_STRUCTURAL_CONTEXT, but the exact row/column assignment of each of the 32 cells could not be independently confirmed from the extracted paragraph flow alone (no per-cell label token survives table serialization at this pass) \u2014 column mapping is left REQUIRES_REVIEW for b4B rather than guessed."
  },
  {
    ordinal: 23,
    observedName: "",
    technicalType: "text",
    structuralGroup: "CHILD_IDENTIFICATION",
    repeatedGroupId: "child_identification_table_cell",
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Falls inside the 'THE CHILD(REN)' table directly under the column headers Child's Full Legal Name / Birthdate / Age / Sex / Full Legal Name(s) of Parent(s) / Is the Child First Nations, Inuk, or M\u00e9tis? / Child's Bands and First Nations, Inuit, or M\u00e9tis Communities. Group membership (child-identification table) is DIRECT_STRUCTURAL_CONTEXT, but the exact row/column assignment of each of the 32 cells could not be independently confirmed from the extracted paragraph flow alone (no per-cell label token survives table serialization at this pass) \u2014 column mapping is left REQUIRES_REVIEW for b4B rather than guessed."
  },
  {
    ordinal: 24,
    observedName: "",
    technicalType: "text",
    structuralGroup: "CHILD_IDENTIFICATION",
    repeatedGroupId: "child_identification_table_cell",
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Falls inside the 'THE CHILD(REN)' table directly under the column headers Child's Full Legal Name / Birthdate / Age / Sex / Full Legal Name(s) of Parent(s) / Is the Child First Nations, Inuk, or M\u00e9tis? / Child's Bands and First Nations, Inuit, or M\u00e9tis Communities. Group membership (child-identification table) is DIRECT_STRUCTURAL_CONTEXT, but the exact row/column assignment of each of the 32 cells could not be independently confirmed from the extracted paragraph flow alone (no per-cell label token survives table serialization at this pass) \u2014 column mapping is left REQUIRES_REVIEW for b4B rather than guessed."
  },
  {
    ordinal: 25,
    observedName: "",
    technicalType: "text",
    structuralGroup: "CHILD_IDENTIFICATION",
    repeatedGroupId: "child_identification_table_cell",
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Falls inside the 'THE CHILD(REN)' table directly under the column headers Child's Full Legal Name / Birthdate / Age / Sex / Full Legal Name(s) of Parent(s) / Is the Child First Nations, Inuk, or M\u00e9tis? / Child's Bands and First Nations, Inuit, or M\u00e9tis Communities. Group membership (child-identification table) is DIRECT_STRUCTURAL_CONTEXT, but the exact row/column assignment of each of the 32 cells could not be independently confirmed from the extracted paragraph flow alone (no per-cell label token survives table serialization at this pass) \u2014 column mapping is left REQUIRES_REVIEW for b4B rather than guessed."
  },
  {
    ordinal: 26,
    observedName: "",
    technicalType: "text",
    structuralGroup: "CHILD_IDENTIFICATION",
    repeatedGroupId: "child_identification_table_cell",
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Falls inside the 'THE CHILD(REN)' table directly under the column headers Child's Full Legal Name / Birthdate / Age / Sex / Full Legal Name(s) of Parent(s) / Is the Child First Nations, Inuk, or M\u00e9tis? / Child's Bands and First Nations, Inuit, or M\u00e9tis Communities. Group membership (child-identification table) is DIRECT_STRUCTURAL_CONTEXT, but the exact row/column assignment of each of the 32 cells could not be independently confirmed from the extracted paragraph flow alone (no per-cell label token survives table serialization at this pass) \u2014 column mapping is left REQUIRES_REVIEW for b4B rather than guessed."
  },
  {
    ordinal: 27,
    observedName: "",
    technicalType: "text",
    structuralGroup: "CHILD_IDENTIFICATION",
    repeatedGroupId: "child_identification_table_cell",
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Falls inside the 'THE CHILD(REN)' table directly under the column headers Child's Full Legal Name / Birthdate / Age / Sex / Full Legal Name(s) of Parent(s) / Is the Child First Nations, Inuk, or M\u00e9tis? / Child's Bands and First Nations, Inuit, or M\u00e9tis Communities. Group membership (child-identification table) is DIRECT_STRUCTURAL_CONTEXT, but the exact row/column assignment of each of the 32 cells could not be independently confirmed from the extracted paragraph flow alone (no per-cell label token survives table serialization at this pass) \u2014 column mapping is left REQUIRES_REVIEW for b4B rather than guessed."
  },
  {
    ordinal: 28,
    observedName: "",
    technicalType: "text",
    structuralGroup: "CHILD_IDENTIFICATION",
    repeatedGroupId: "child_identification_table_cell",
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Falls inside the 'THE CHILD(REN)' table directly under the column headers Child's Full Legal Name / Birthdate / Age / Sex / Full Legal Name(s) of Parent(s) / Is the Child First Nations, Inuk, or M\u00e9tis? / Child's Bands and First Nations, Inuit, or M\u00e9tis Communities. Group membership (child-identification table) is DIRECT_STRUCTURAL_CONTEXT, but the exact row/column assignment of each of the 32 cells could not be independently confirmed from the extracted paragraph flow alone (no per-cell label token survives table serialization at this pass) \u2014 column mapping is left REQUIRES_REVIEW for b4B rather than guessed."
  },
  {
    ordinal: 29,
    observedName: "",
    technicalType: "text",
    structuralGroup: "CHILD_IDENTIFICATION",
    repeatedGroupId: "child_identification_table_cell",
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Falls inside the 'THE CHILD(REN)' table directly under the column headers Child's Full Legal Name / Birthdate / Age / Sex / Full Legal Name(s) of Parent(s) / Is the Child First Nations, Inuk, or M\u00e9tis? / Child's Bands and First Nations, Inuit, or M\u00e9tis Communities. Group membership (child-identification table) is DIRECT_STRUCTURAL_CONTEXT, but the exact row/column assignment of each of the 32 cells could not be independently confirmed from the extracted paragraph flow alone (no per-cell label token survives table serialization at this pass) \u2014 column mapping is left REQUIRES_REVIEW for b4B rather than guessed."
  },
  {
    ordinal: 30,
    observedName: "",
    technicalType: "text",
    structuralGroup: "CHILD_IDENTIFICATION",
    repeatedGroupId: "child_identification_table_cell",
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Falls inside the 'THE CHILD(REN)' table directly under the column headers Child's Full Legal Name / Birthdate / Age / Sex / Full Legal Name(s) of Parent(s) / Is the Child First Nations, Inuk, or M\u00e9tis? / Child's Bands and First Nations, Inuit, or M\u00e9tis Communities. Group membership (child-identification table) is DIRECT_STRUCTURAL_CONTEXT, but the exact row/column assignment of each of the 32 cells could not be independently confirmed from the extracted paragraph flow alone (no per-cell label token survives table serialization at this pass) \u2014 column mapping is left REQUIRES_REVIEW for b4B rather than guessed."
  },
  {
    ordinal: 31,
    observedName: "",
    technicalType: "text",
    structuralGroup: "CHILD_IDENTIFICATION",
    repeatedGroupId: "child_identification_table_cell",
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Falls inside the 'THE CHILD(REN)' table directly under the column headers Child's Full Legal Name / Birthdate / Age / Sex / Full Legal Name(s) of Parent(s) / Is the Child First Nations, Inuk, or M\u00e9tis? / Child's Bands and First Nations, Inuit, or M\u00e9tis Communities. Group membership (child-identification table) is DIRECT_STRUCTURAL_CONTEXT, but the exact row/column assignment of each of the 32 cells could not be independently confirmed from the extracted paragraph flow alone (no per-cell label token survives table serialization at this pass) \u2014 column mapping is left REQUIRES_REVIEW for b4B rather than guessed."
  },
  {
    ordinal: 32,
    observedName: "",
    technicalType: "text",
    structuralGroup: "CHILD_IDENTIFICATION",
    repeatedGroupId: "child_identification_table_cell",
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Falls inside the 'THE CHILD(REN)' table directly under the column headers Child's Full Legal Name / Birthdate / Age / Sex / Full Legal Name(s) of Parent(s) / Is the Child First Nations, Inuk, or M\u00e9tis? / Child's Bands and First Nations, Inuit, or M\u00e9tis Communities. Group membership (child-identification table) is DIRECT_STRUCTURAL_CONTEXT, but the exact row/column assignment of each of the 32 cells could not be independently confirmed from the extracted paragraph flow alone (no per-cell label token survives table serialization at this pass) \u2014 column mapping is left REQUIRES_REVIEW for b4B rather than guessed."
  },
  {
    ordinal: 33,
    observedName: "",
    technicalType: "text",
    structuralGroup: "CHILD_IDENTIFICATION",
    repeatedGroupId: "child_identification_table_cell",
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Falls inside the 'THE CHILD(REN)' table directly under the column headers Child's Full Legal Name / Birthdate / Age / Sex / Full Legal Name(s) of Parent(s) / Is the Child First Nations, Inuk, or M\u00e9tis? / Child's Bands and First Nations, Inuit, or M\u00e9tis Communities. Group membership (child-identification table) is DIRECT_STRUCTURAL_CONTEXT, but the exact row/column assignment of each of the 32 cells could not be independently confirmed from the extracted paragraph flow alone (no per-cell label token survives table serialization at this pass) \u2014 column mapping is left REQUIRES_REVIEW for b4B rather than guessed."
  },
  {
    ordinal: 34,
    observedName: "",
    technicalType: "text",
    structuralGroup: "CHILD_IDENTIFICATION",
    repeatedGroupId: "child_identification_table_cell",
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Falls inside the 'THE CHILD(REN)' table directly under the column headers Child's Full Legal Name / Birthdate / Age / Sex / Full Legal Name(s) of Parent(s) / Is the Child First Nations, Inuk, or M\u00e9tis? / Child's Bands and First Nations, Inuit, or M\u00e9tis Communities. Group membership (child-identification table) is DIRECT_STRUCTURAL_CONTEXT, but the exact row/column assignment of each of the 32 cells could not be independently confirmed from the extracted paragraph flow alone (no per-cell label token survives table serialization at this pass) \u2014 column mapping is left REQUIRES_REVIEW for b4B rather than guessed."
  },
  {
    ordinal: 35,
    observedName: "",
    technicalType: "text",
    structuralGroup: "CHILD_IDENTIFICATION",
    repeatedGroupId: "child_identification_table_cell",
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Falls inside the 'THE CHILD(REN)' table directly under the column headers Child's Full Legal Name / Birthdate / Age / Sex / Full Legal Name(s) of Parent(s) / Is the Child First Nations, Inuk, or M\u00e9tis? / Child's Bands and First Nations, Inuit, or M\u00e9tis Communities. Group membership (child-identification table) is DIRECT_STRUCTURAL_CONTEXT, but the exact row/column assignment of each of the 32 cells could not be independently confirmed from the extracted paragraph flow alone (no per-cell label token survives table serialization at this pass) \u2014 column mapping is left REQUIRES_REVIEW for b4B rather than guessed."
  },
  {
    ordinal: 36,
    observedName: "",
    technicalType: "text",
    structuralGroup: "CHILD_IDENTIFICATION",
    repeatedGroupId: "child_identification_table_cell",
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Falls inside the 'THE CHILD(REN)' table directly under the column headers Child's Full Legal Name / Birthdate / Age / Sex / Full Legal Name(s) of Parent(s) / Is the Child First Nations, Inuk, or M\u00e9tis? / Child's Bands and First Nations, Inuit, or M\u00e9tis Communities. Group membership (child-identification table) is DIRECT_STRUCTURAL_CONTEXT, but the exact row/column assignment of each of the 32 cells could not be independently confirmed from the extracted paragraph flow alone (no per-cell label token survives table serialization at this pass) \u2014 column mapping is left REQUIRES_REVIEW for b4B rather than guessed."
  },
  {
    ordinal: 37,
    observedName: "",
    technicalType: "text",
    structuralGroup: "CHILD_IDENTIFICATION",
    repeatedGroupId: "child_identification_table_cell",
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Falls inside the 'THE CHILD(REN)' table directly under the column headers Child's Full Legal Name / Birthdate / Age / Sex / Full Legal Name(s) of Parent(s) / Is the Child First Nations, Inuk, or M\u00e9tis? / Child's Bands and First Nations, Inuit, or M\u00e9tis Communities. Group membership (child-identification table) is DIRECT_STRUCTURAL_CONTEXT, but the exact row/column assignment of each of the 32 cells could not be independently confirmed from the extracted paragraph flow alone (no per-cell label token survives table serialization at this pass) \u2014 column mapping is left REQUIRES_REVIEW for b4B rather than guessed."
  },
  {
    ordinal: 38,
    observedName: "",
    technicalType: "text",
    structuralGroup: "CHILD_IDENTIFICATION",
    repeatedGroupId: "child_identification_table_cell",
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Falls inside the 'THE CHILD(REN)' table directly under the column headers Child's Full Legal Name / Birthdate / Age / Sex / Full Legal Name(s) of Parent(s) / Is the Child First Nations, Inuk, or M\u00e9tis? / Child's Bands and First Nations, Inuit, or M\u00e9tis Communities. Group membership (child-identification table) is DIRECT_STRUCTURAL_CONTEXT, but the exact row/column assignment of each of the 32 cells could not be independently confirmed from the extracted paragraph flow alone (no per-cell label token survives table serialization at this pass) \u2014 column mapping is left REQUIRES_REVIEW for b4B rather than guessed."
  },
  {
    ordinal: 39,
    observedName: "",
    technicalType: "text",
    structuralGroup: "CHILD_IDENTIFICATION",
    repeatedGroupId: "child_identification_table_cell",
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Falls inside the 'THE CHILD(REN)' table directly under the column headers Child's Full Legal Name / Birthdate / Age / Sex / Full Legal Name(s) of Parent(s) / Is the Child First Nations, Inuk, or M\u00e9tis? / Child's Bands and First Nations, Inuit, or M\u00e9tis Communities. Group membership (child-identification table) is DIRECT_STRUCTURAL_CONTEXT, but the exact row/column assignment of each of the 32 cells could not be independently confirmed from the extracted paragraph flow alone (no per-cell label token survives table serialization at this pass) \u2014 column mapping is left REQUIRES_REVIEW for b4B rather than guessed."
  },
  {
    ordinal: 40,
    observedName: "",
    technicalType: "text",
    structuralGroup: "CHILD_IDENTIFICATION",
    repeatedGroupId: "child_identification_table_cell",
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Falls inside the 'THE CHILD(REN)' table directly under the column headers Child's Full Legal Name / Birthdate / Age / Sex / Full Legal Name(s) of Parent(s) / Is the Child First Nations, Inuk, or M\u00e9tis? / Child's Bands and First Nations, Inuit, or M\u00e9tis Communities. Group membership (child-identification table) is DIRECT_STRUCTURAL_CONTEXT, but the exact row/column assignment of each of the 32 cells could not be independently confirmed from the extracted paragraph flow alone (no per-cell label token survives table serialization at this pass) \u2014 column mapping is left REQUIRES_REVIEW for b4B rather than guessed."
  },
  {
    ordinal: 41,
    observedName: "",
    technicalType: "text",
    structuralGroup: "CHILD_IDENTIFICATION",
    repeatedGroupId: "child_identification_table_cell",
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Falls inside the 'THE CHILD(REN)' table directly under the column headers Child's Full Legal Name / Birthdate / Age / Sex / Full Legal Name(s) of Parent(s) / Is the Child First Nations, Inuk, or M\u00e9tis? / Child's Bands and First Nations, Inuit, or M\u00e9tis Communities. Group membership (child-identification table) is DIRECT_STRUCTURAL_CONTEXT, but the exact row/column assignment of each of the 32 cells could not be independently confirmed from the extracted paragraph flow alone (no per-cell label token survives table serialization at this pass) \u2014 column mapping is left REQUIRES_REVIEW for b4B rather than guessed."
  },
  {
    ordinal: 42,
    observedName: "",
    technicalType: "text",
    structuralGroup: "CHILD_IDENTIFICATION",
    repeatedGroupId: "child_identification_table_cell",
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Falls inside the 'THE CHILD(REN)' table directly under the column headers Child's Full Legal Name / Birthdate / Age / Sex / Full Legal Name(s) of Parent(s) / Is the Child First Nations, Inuk, or M\u00e9tis? / Child's Bands and First Nations, Inuit, or M\u00e9tis Communities. Group membership (child-identification table) is DIRECT_STRUCTURAL_CONTEXT, but the exact row/column assignment of each of the 32 cells could not be independently confirmed from the extracted paragraph flow alone (no per-cell label token survives table serialization at this pass) \u2014 column mapping is left REQUIRES_REVIEW for b4B rather than guessed."
  },
  {
    ordinal: 43,
    observedName: "",
    technicalType: "text",
    structuralGroup: "CHILD_IDENTIFICATION",
    repeatedGroupId: "child_identification_table_cell",
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Falls inside the 'THE CHILD(REN)' table directly under the column headers Child's Full Legal Name / Birthdate / Age / Sex / Full Legal Name(s) of Parent(s) / Is the Child First Nations, Inuk, or M\u00e9tis? / Child's Bands and First Nations, Inuit, or M\u00e9tis Communities. Group membership (child-identification table) is DIRECT_STRUCTURAL_CONTEXT, but the exact row/column assignment of each of the 32 cells could not be independently confirmed from the extracted paragraph flow alone (no per-cell label token survives table serialization at this pass) \u2014 column mapping is left REQUIRES_REVIEW for b4B rather than guessed."
  },
  {
    ordinal: 44,
    observedName: "",
    technicalType: "text",
    structuralGroup: "CHILD_IDENTIFICATION",
    repeatedGroupId: "child_identification_table_cell",
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Falls inside the 'THE CHILD(REN)' table directly under the column headers Child's Full Legal Name / Birthdate / Age / Sex / Full Legal Name(s) of Parent(s) / Is the Child First Nations, Inuk, or M\u00e9tis? / Child's Bands and First Nations, Inuit, or M\u00e9tis Communities. Group membership (child-identification table) is DIRECT_STRUCTURAL_CONTEXT, but the exact row/column assignment of each of the 32 cells could not be independently confirmed from the extracted paragraph flow alone (no per-cell label token survives table serialization at this pass) \u2014 column mapping is left REQUIRES_REVIEW for b4B rather than guessed."
  },
  {
    ordinal: 45,
    observedName: "",
    technicalType: "text",
    structuralGroup: "CHILD_IDENTIFICATION",
    repeatedGroupId: "child_identification_table_cell",
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Falls inside the 'THE CHILD(REN)' table directly under the column headers Child's Full Legal Name / Birthdate / Age / Sex / Full Legal Name(s) of Parent(s) / Is the Child First Nations, Inuk, or M\u00e9tis? / Child's Bands and First Nations, Inuit, or M\u00e9tis Communities. Group membership (child-identification table) is DIRECT_STRUCTURAL_CONTEXT, but the exact row/column assignment of each of the 32 cells could not be independently confirmed from the extracted paragraph flow alone (no per-cell label token survives table serialization at this pass) \u2014 column mapping is left REQUIRES_REVIEW for b4B rather than guessed."
  },
  {
    ordinal: 46,
    observedName: "",
    technicalType: "text",
    structuralGroup: "CHILD_IDENTIFICATION",
    repeatedGroupId: "child_identification_table_cell",
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Falls inside the 'THE CHILD(REN)' table directly under the column headers Child's Full Legal Name / Birthdate / Age / Sex / Full Legal Name(s) of Parent(s) / Is the Child First Nations, Inuk, or M\u00e9tis? / Child's Bands and First Nations, Inuit, or M\u00e9tis Communities. Group membership (child-identification table) is DIRECT_STRUCTURAL_CONTEXT, but the exact row/column assignment of each of the 32 cells could not be independently confirmed from the extracted paragraph flow alone (no per-cell label token survives table serialization at this pass) \u2014 column mapping is left REQUIRES_REVIEW for b4B rather than guessed."
  },
  {
    ordinal: 47,
    observedName: "Check76",
    technicalType: "checkbox",
    structuralGroup: "LEGAL_GROUND_OR_POSITION",
    repeatedGroupId: null,
    reviewSensitivity: "LEGAL_GROUND_OR_POSITION",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows explicit CYFSA 2017 s.74(2) clause citations (e.g. '[subclause 74(2)(a)(i)]', '[clause 74(2)(o)]'); form text explicitly instructs 'Check the applicable box(es)' confirming non-exclusive multi-select, not mutually exclusive radio semantics. Structural identification only \u2014 no ground is selected/defaulted by this manifest."
  },
  {
    ordinal: 48,
    observedName: "Check77",
    technicalType: "checkbox",
    structuralGroup: "LEGAL_GROUND_OR_POSITION",
    repeatedGroupId: null,
    reviewSensitivity: "LEGAL_GROUND_OR_POSITION",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows explicit CYFSA 2017 s.74(2) clause citations (e.g. '[subclause 74(2)(a)(i)]', '[clause 74(2)(o)]'); form text explicitly instructs 'Check the applicable box(es)' confirming non-exclusive multi-select, not mutually exclusive radio semantics. Structural identification only \u2014 no ground is selected/defaulted by this manifest."
  },
  {
    ordinal: 49,
    observedName: "Check78",
    technicalType: "checkbox",
    structuralGroup: "LEGAL_GROUND_OR_POSITION",
    repeatedGroupId: null,
    reviewSensitivity: "LEGAL_GROUND_OR_POSITION",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows explicit CYFSA 2017 s.74(2) clause citations (e.g. '[subclause 74(2)(a)(i)]', '[clause 74(2)(o)]'); form text explicitly instructs 'Check the applicable box(es)' confirming non-exclusive multi-select, not mutually exclusive radio semantics. Structural identification only \u2014 no ground is selected/defaulted by this manifest."
  },
  {
    ordinal: 50,
    observedName: "Check79",
    technicalType: "checkbox",
    structuralGroup: "LEGAL_GROUND_OR_POSITION",
    repeatedGroupId: null,
    reviewSensitivity: "LEGAL_GROUND_OR_POSITION",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows explicit CYFSA 2017 s.74(2) clause citations (e.g. '[subclause 74(2)(a)(i)]', '[clause 74(2)(o)]'); form text explicitly instructs 'Check the applicable box(es)' confirming non-exclusive multi-select, not mutually exclusive radio semantics. Structural identification only \u2014 no ground is selected/defaulted by this manifest."
  },
  {
    ordinal: 51,
    observedName: "Check77",
    technicalType: "checkbox",
    structuralGroup: "LEGAL_GROUND_OR_POSITION",
    repeatedGroupId: null,
    reviewSensitivity: "LEGAL_GROUND_OR_POSITION",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows explicit CYFSA 2017 s.74(2) clause citations (e.g. '[subclause 74(2)(a)(i)]', '[clause 74(2)(o)]'); form text explicitly instructs 'Check the applicable box(es)' confirming non-exclusive multi-select, not mutually exclusive radio semantics. Structural identification only \u2014 no ground is selected/defaulted by this manifest."
  },
  {
    ordinal: 52,
    observedName: "Check78",
    technicalType: "checkbox",
    structuralGroup: "LEGAL_GROUND_OR_POSITION",
    repeatedGroupId: null,
    reviewSensitivity: "LEGAL_GROUND_OR_POSITION",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows explicit CYFSA 2017 s.74(2) clause citations (e.g. '[subclause 74(2)(a)(i)]', '[clause 74(2)(o)]'); form text explicitly instructs 'Check the applicable box(es)' confirming non-exclusive multi-select, not mutually exclusive radio semantics. Structural identification only \u2014 no ground is selected/defaulted by this manifest."
  },
  {
    ordinal: 53,
    observedName: "Check76",
    technicalType: "checkbox",
    structuralGroup: "LEGAL_GROUND_OR_POSITION",
    repeatedGroupId: null,
    reviewSensitivity: "LEGAL_GROUND_OR_POSITION",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows explicit CYFSA 2017 s.74(2) clause citations (e.g. '[subclause 74(2)(a)(i)]', '[clause 74(2)(o)]'); form text explicitly instructs 'Check the applicable box(es)' confirming non-exclusive multi-select, not mutually exclusive radio semantics. Structural identification only \u2014 no ground is selected/defaulted by this manifest."
  },
  {
    ordinal: 54,
    observedName: "Check76",
    technicalType: "checkbox",
    structuralGroup: "LEGAL_GROUND_OR_POSITION",
    repeatedGroupId: null,
    reviewSensitivity: "LEGAL_GROUND_OR_POSITION",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows explicit CYFSA 2017 s.74(2) clause citations (e.g. '[subclause 74(2)(a)(i)]', '[clause 74(2)(o)]'); form text explicitly instructs 'Check the applicable box(es)' confirming non-exclusive multi-select, not mutually exclusive radio semantics. Structural identification only \u2014 no ground is selected/defaulted by this manifest."
  },
  {
    ordinal: 55,
    observedName: "Check76",
    technicalType: "checkbox",
    structuralGroup: "LEGAL_GROUND_OR_POSITION",
    repeatedGroupId: null,
    reviewSensitivity: "LEGAL_GROUND_OR_POSITION",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows explicit CYFSA 2017 s.74(2) clause citations (e.g. '[subclause 74(2)(a)(i)]', '[clause 74(2)(o)]'); form text explicitly instructs 'Check the applicable box(es)' confirming non-exclusive multi-select, not mutually exclusive radio semantics. Structural identification only \u2014 no ground is selected/defaulted by this manifest."
  },
  {
    ordinal: 56,
    observedName: "Check76",
    technicalType: "checkbox",
    structuralGroup: "LEGAL_GROUND_OR_POSITION",
    repeatedGroupId: null,
    reviewSensitivity: "LEGAL_GROUND_OR_POSITION",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows explicit CYFSA 2017 s.74(2) clause citations (e.g. '[subclause 74(2)(a)(i)]', '[clause 74(2)(o)]'); form text explicitly instructs 'Check the applicable box(es)' confirming non-exclusive multi-select, not mutually exclusive radio semantics. Structural identification only \u2014 no ground is selected/defaulted by this manifest."
  },
  {
    ordinal: 57,
    observedName: "Check76",
    technicalType: "checkbox",
    structuralGroup: "LEGAL_GROUND_OR_POSITION",
    repeatedGroupId: null,
    reviewSensitivity: "LEGAL_GROUND_OR_POSITION",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows explicit CYFSA 2017 s.74(2) clause citations (e.g. '[subclause 74(2)(a)(i)]', '[clause 74(2)(o)]'); form text explicitly instructs 'Check the applicable box(es)' confirming non-exclusive multi-select, not mutually exclusive radio semantics. Structural identification only \u2014 no ground is selected/defaulted by this manifest."
  },
  {
    ordinal: 58,
    observedName: "Check76",
    technicalType: "checkbox",
    structuralGroup: "LEGAL_GROUND_OR_POSITION",
    repeatedGroupId: null,
    reviewSensitivity: "LEGAL_GROUND_OR_POSITION",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows explicit CYFSA 2017 s.74(2) clause citations (e.g. '[subclause 74(2)(a)(i)]', '[clause 74(2)(o)]'); form text explicitly instructs 'Check the applicable box(es)' confirming non-exclusive multi-select, not mutually exclusive radio semantics. Structural identification only \u2014 no ground is selected/defaulted by this manifest."
  },
  {
    ordinal: 59,
    observedName: "Check76",
    technicalType: "checkbox",
    structuralGroup: "LEGAL_GROUND_OR_POSITION",
    repeatedGroupId: null,
    reviewSensitivity: "LEGAL_GROUND_OR_POSITION",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows explicit CYFSA 2017 s.74(2) clause citations (e.g. '[subclause 74(2)(a)(i)]', '[clause 74(2)(o)]'); form text explicitly instructs 'Check the applicable box(es)' confirming non-exclusive multi-select, not mutually exclusive radio semantics. Structural identification only \u2014 no ground is selected/defaulted by this manifest."
  },
  {
    ordinal: 60,
    observedName: "Check76",
    technicalType: "checkbox",
    structuralGroup: "LEGAL_GROUND_OR_POSITION",
    repeatedGroupId: null,
    reviewSensitivity: "LEGAL_GROUND_OR_POSITION",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows explicit CYFSA 2017 s.74(2) clause citations (e.g. '[subclause 74(2)(a)(i)]', '[clause 74(2)(o)]'); form text explicitly instructs 'Check the applicable box(es)' confirming non-exclusive multi-select, not mutually exclusive radio semantics. Structural identification only \u2014 no ground is selected/defaulted by this manifest."
  },
  {
    ordinal: 61,
    observedName: "Check76",
    technicalType: "checkbox",
    structuralGroup: "LEGAL_GROUND_OR_POSITION",
    repeatedGroupId: null,
    reviewSensitivity: "LEGAL_GROUND_OR_POSITION",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows explicit CYFSA 2017 s.74(2) clause citations (e.g. '[subclause 74(2)(a)(i)]', '[clause 74(2)(o)]'); form text explicitly instructs 'Check the applicable box(es)' confirming non-exclusive multi-select, not mutually exclusive radio semantics. Structural identification only \u2014 no ground is selected/defaulted by this manifest."
  },
  {
    ordinal: 62,
    observedName: "Check76",
    technicalType: "checkbox",
    structuralGroup: "LEGAL_GROUND_OR_POSITION",
    repeatedGroupId: null,
    reviewSensitivity: "LEGAL_GROUND_OR_POSITION",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows explicit CYFSA 2017 s.74(2) clause citations (e.g. '[subclause 74(2)(a)(i)]', '[clause 74(2)(o)]'); form text explicitly instructs 'Check the applicable box(es)' confirming non-exclusive multi-select, not mutually exclusive radio semantics. Structural identification only \u2014 no ground is selected/defaulted by this manifest."
  },
  {
    ordinal: 63,
    observedName: "Check76",
    technicalType: "checkbox",
    structuralGroup: "LEGAL_GROUND_OR_POSITION",
    repeatedGroupId: null,
    reviewSensitivity: "LEGAL_GROUND_OR_POSITION",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows explicit CYFSA 2017 s.74(2) clause citations (e.g. '[subclause 74(2)(a)(i)]', '[clause 74(2)(o)]'); form text explicitly instructs 'Check the applicable box(es)' confirming non-exclusive multi-select, not mutually exclusive radio semantics. Structural identification only \u2014 no ground is selected/defaulted by this manifest."
  },
  {
    ordinal: 64,
    observedName: "Check79",
    technicalType: "checkbox",
    structuralGroup: "LEGAL_GROUND_OR_POSITION",
    repeatedGroupId: null,
    reviewSensitivity: "LEGAL_GROUND_OR_POSITION",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows explicit CYFSA 2017 s.74(2) clause citations (e.g. '[subclause 74(2)(a)(i)]', '[clause 74(2)(o)]'); form text explicitly instructs 'Check the applicable box(es)' confirming non-exclusive multi-select, not mutually exclusive radio semantics. Structural identification only \u2014 no ground is selected/defaulted by this manifest."
  },
  {
    ordinal: 65,
    observedName: "Check79",
    technicalType: "checkbox",
    structuralGroup: "LEGAL_GROUND_OR_POSITION",
    repeatedGroupId: null,
    reviewSensitivity: "LEGAL_GROUND_OR_POSITION",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows explicit CYFSA 2017 s.74(2) clause citations (e.g. '[subclause 74(2)(a)(i)]', '[clause 74(2)(o)]'); form text explicitly instructs 'Check the applicable box(es)' confirming non-exclusive multi-select, not mutually exclusive radio semantics. Structural identification only \u2014 no ground is selected/defaulted by this manifest."
  },
  {
    ordinal: 66,
    observedName: "Check79",
    technicalType: "checkbox",
    structuralGroup: "LEGAL_GROUND_OR_POSITION",
    repeatedGroupId: null,
    reviewSensitivity: "LEGAL_GROUND_OR_POSITION",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows explicit CYFSA 2017 s.74(2) clause citations (e.g. '[subclause 74(2)(a)(i)]', '[clause 74(2)(o)]'); form text explicitly instructs 'Check the applicable box(es)' confirming non-exclusive multi-select, not mutually exclusive radio semantics. Structural identification only \u2014 no ground is selected/defaulted by this manifest."
  },
  {
    ordinal: 67,
    observedName: "Check79",
    technicalType: "checkbox",
    structuralGroup: "LEGAL_GROUND_OR_POSITION",
    repeatedGroupId: null,
    reviewSensitivity: "LEGAL_GROUND_OR_POSITION",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows explicit CYFSA 2017 s.74(2) clause citations (e.g. '[subclause 74(2)(a)(i)]', '[clause 74(2)(o)]'); form text explicitly instructs 'Check the applicable box(es)' confirming non-exclusive multi-select, not mutually exclusive radio semantics. Structural identification only \u2014 no ground is selected/defaulted by this manifest."
  },
  {
    ordinal: 68,
    observedName: "",
    technicalType: "text",
    structuralGroup: "PARTY_IDENTIFICATION",
    repeatedGroupId: null,
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    evidence: "DIRECT_STRUCTURAL_CONTEXT",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows '2. (name)' immediately before 'asks for an order,' \u2014 identifies which party is making the request, not the request itself."
  },
  {
    ordinal: 69,
    observedName: "Check77",
    technicalType: "checkbox",
    structuralGroup: "REQUESTED_ORDER",
    repeatedGroupId: null,
    reviewSensitivity: "REQUESTED_ORDER",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows 'asks for an order,' and enumerates specific relief options (placement with parent under society supervision, interim society care, extended society care, access, restraining order under CYFSA s.137, support payment, costs, other) each introduced by its own checkbox + detail text. Structural identification only \u2014 no order is selected/defaulted by this manifest."
  },
  {
    ordinal: 70,
    observedName: "",
    technicalType: "text",
    structuralGroup: "REQUESTED_ORDER",
    repeatedGroupId: null,
    reviewSensitivity: "REQUESTED_ORDER",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows 'asks for an order,' and enumerates specific relief options (placement with parent under society supervision, interim society care, extended society care, access, restraining order under CYFSA s.137, support payment, costs, other) each introduced by its own checkbox + detail text. Structural identification only \u2014 no order is selected/defaulted by this manifest."
  },
  {
    ordinal: 71,
    observedName: "",
    technicalType: "text",
    structuralGroup: "REQUESTED_ORDER",
    repeatedGroupId: null,
    reviewSensitivity: "REQUESTED_ORDER",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows 'asks for an order,' and enumerates specific relief options (placement with parent under society supervision, interim society care, extended society care, access, restraining order under CYFSA s.137, support payment, costs, other) each introduced by its own checkbox + detail text. Structural identification only \u2014 no order is selected/defaulted by this manifest."
  },
  {
    ordinal: 72,
    observedName: "",
    technicalType: "text",
    structuralGroup: "REQUESTED_ORDER",
    repeatedGroupId: null,
    reviewSensitivity: "REQUESTED_ORDER",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows 'asks for an order,' and enumerates specific relief options (placement with parent under society supervision, interim society care, extended society care, access, restraining order under CYFSA s.137, support payment, costs, other) each introduced by its own checkbox + detail text. Structural identification only \u2014 no order is selected/defaulted by this manifest."
  },
  {
    ordinal: 73,
    observedName: "Check77",
    technicalType: "checkbox",
    structuralGroup: "REQUESTED_ORDER",
    repeatedGroupId: null,
    reviewSensitivity: "REQUESTED_ORDER",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows 'asks for an order,' and enumerates specific relief options (placement with parent under society supervision, interim society care, extended society care, access, restraining order under CYFSA s.137, support payment, costs, other) each introduced by its own checkbox + detail text. Structural identification only \u2014 no order is selected/defaulted by this manifest."
  },
  {
    ordinal: 74,
    observedName: "",
    technicalType: "text",
    structuralGroup: "REQUESTED_ORDER",
    repeatedGroupId: null,
    reviewSensitivity: "REQUESTED_ORDER",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows 'asks for an order,' and enumerates specific relief options (placement with parent under society supervision, interim society care, extended society care, access, restraining order under CYFSA s.137, support payment, costs, other) each introduced by its own checkbox + detail text. Structural identification only \u2014 no order is selected/defaulted by this manifest."
  },
  {
    ordinal: 75,
    observedName: "",
    technicalType: "text",
    structuralGroup: "REQUESTED_ORDER",
    repeatedGroupId: null,
    reviewSensitivity: "REQUESTED_ORDER",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows 'asks for an order,' and enumerates specific relief options (placement with parent under society supervision, interim society care, extended society care, access, restraining order under CYFSA s.137, support payment, costs, other) each introduced by its own checkbox + detail text. Structural identification only \u2014 no order is selected/defaulted by this manifest."
  },
  {
    ordinal: 76,
    observedName: "Check77",
    technicalType: "checkbox",
    structuralGroup: "REQUESTED_ORDER",
    repeatedGroupId: null,
    reviewSensitivity: "REQUESTED_ORDER",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows 'asks for an order,' and enumerates specific relief options (placement with parent under society supervision, interim society care, extended society care, access, restraining order under CYFSA s.137, support payment, costs, other) each introduced by its own checkbox + detail text. Structural identification only \u2014 no order is selected/defaulted by this manifest."
  },
  {
    ordinal: 77,
    observedName: "",
    technicalType: "text",
    structuralGroup: "REQUESTED_ORDER",
    repeatedGroupId: null,
    reviewSensitivity: "REQUESTED_ORDER",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows 'asks for an order,' and enumerates specific relief options (placement with parent under society supervision, interim society care, extended society care, access, restraining order under CYFSA s.137, support payment, costs, other) each introduced by its own checkbox + detail text. Structural identification only \u2014 no order is selected/defaulted by this manifest."
  },
  {
    ordinal: 78,
    observedName: "",
    technicalType: "text",
    structuralGroup: "REQUESTED_ORDER",
    repeatedGroupId: null,
    reviewSensitivity: "REQUESTED_ORDER",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows 'asks for an order,' and enumerates specific relief options (placement with parent under society supervision, interim society care, extended society care, access, restraining order under CYFSA s.137, support payment, costs, other) each introduced by its own checkbox + detail text. Structural identification only \u2014 no order is selected/defaulted by this manifest."
  },
  {
    ordinal: 79,
    observedName: "",
    technicalType: "text",
    structuralGroup: "REQUESTED_ORDER",
    repeatedGroupId: null,
    reviewSensitivity: "REQUESTED_ORDER",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows 'asks for an order,' and enumerates specific relief options (placement with parent under society supervision, interim society care, extended society care, access, restraining order under CYFSA s.137, support payment, costs, other) each introduced by its own checkbox + detail text. Structural identification only \u2014 no order is selected/defaulted by this manifest."
  },
  {
    ordinal: 80,
    observedName: "",
    technicalType: "text",
    structuralGroup: "REQUESTED_ORDER",
    repeatedGroupId: null,
    reviewSensitivity: "REQUESTED_ORDER",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows 'asks for an order,' and enumerates specific relief options (placement with parent under society supervision, interim society care, extended society care, access, restraining order under CYFSA s.137, support payment, costs, other) each introduced by its own checkbox + detail text. Structural identification only \u2014 no order is selected/defaulted by this manifest."
  },
  {
    ordinal: 81,
    observedName: "",
    technicalType: "text",
    structuralGroup: "REQUESTED_ORDER",
    repeatedGroupId: null,
    reviewSensitivity: "REQUESTED_ORDER",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows 'asks for an order,' and enumerates specific relief options (placement with parent under society supervision, interim society care, extended society care, access, restraining order under CYFSA s.137, support payment, costs, other) each introduced by its own checkbox + detail text. Structural identification only \u2014 no order is selected/defaulted by this manifest."
  },
  {
    ordinal: 82,
    observedName: "Check77",
    technicalType: "checkbox",
    structuralGroup: "REQUESTED_ORDER",
    repeatedGroupId: null,
    reviewSensitivity: "REQUESTED_ORDER",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows 'asks for an order,' and enumerates specific relief options (placement with parent under society supervision, interim society care, extended society care, access, restraining order under CYFSA s.137, support payment, costs, other) each introduced by its own checkbox + detail text. Structural identification only \u2014 no order is selected/defaulted by this manifest."
  },
  {
    ordinal: 83,
    observedName: "",
    technicalType: "text",
    structuralGroup: "REQUESTED_ORDER",
    repeatedGroupId: null,
    reviewSensitivity: "REQUESTED_ORDER",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows 'asks for an order,' and enumerates specific relief options (placement with parent under society supervision, interim society care, extended society care, access, restraining order under CYFSA s.137, support payment, costs, other) each introduced by its own checkbox + detail text. Structural identification only \u2014 no order is selected/defaulted by this manifest."
  },
  {
    ordinal: 84,
    observedName: "Check77",
    technicalType: "checkbox",
    structuralGroup: "REQUESTED_ORDER",
    repeatedGroupId: null,
    reviewSensitivity: "REQUESTED_ORDER",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows 'asks for an order,' and enumerates specific relief options (placement with parent under society supervision, interim society care, extended society care, access, restraining order under CYFSA s.137, support payment, costs, other) each introduced by its own checkbox + detail text. Structural identification only \u2014 no order is selected/defaulted by this manifest."
  },
  {
    ordinal: 85,
    observedName: "",
    technicalType: "text",
    structuralGroup: "REQUESTED_ORDER",
    repeatedGroupId: null,
    reviewSensitivity: "REQUESTED_ORDER",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows 'asks for an order,' and enumerates specific relief options (placement with parent under society supervision, interim society care, extended society care, access, restraining order under CYFSA s.137, support payment, costs, other) each introduced by its own checkbox + detail text. Structural identification only \u2014 no order is selected/defaulted by this manifest."
  },
  {
    ordinal: 86,
    observedName: "Check77",
    technicalType: "checkbox",
    structuralGroup: "REQUESTED_ORDER",
    repeatedGroupId: null,
    reviewSensitivity: "REQUESTED_ORDER",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows 'asks for an order,' and enumerates specific relief options (placement with parent under society supervision, interim society care, extended society care, access, restraining order under CYFSA s.137, support payment, costs, other) each introduced by its own checkbox + detail text. Structural identification only \u2014 no order is selected/defaulted by this manifest."
  },
  {
    ordinal: 87,
    observedName: "",
    technicalType: "text",
    structuralGroup: "REQUESTED_ORDER",
    repeatedGroupId: null,
    reviewSensitivity: "REQUESTED_ORDER",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows 'asks for an order,' and enumerates specific relief options (placement with parent under society supervision, interim society care, extended society care, access, restraining order under CYFSA s.137, support payment, costs, other) each introduced by its own checkbox + detail text. Structural identification only \u2014 no order is selected/defaulted by this manifest."
  },
  {
    ordinal: 88,
    observedName: "",
    technicalType: "text",
    structuralGroup: "REQUESTED_ORDER",
    repeatedGroupId: null,
    reviewSensitivity: "REQUESTED_ORDER",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows 'asks for an order,' and enumerates specific relief options (placement with parent under society supervision, interim society care, extended society care, access, restraining order under CYFSA s.137, support payment, costs, other) each introduced by its own checkbox + detail text. Structural identification only \u2014 no order is selected/defaulted by this manifest."
  },
  {
    ordinal: 89,
    observedName: "Check77",
    technicalType: "checkbox",
    structuralGroup: "REQUESTED_ORDER",
    repeatedGroupId: null,
    reviewSensitivity: "REQUESTED_ORDER",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows 'asks for an order,' and enumerates specific relief options (placement with parent under society supervision, interim society care, extended society care, access, restraining order under CYFSA s.137, support payment, costs, other) each introduced by its own checkbox + detail text. Structural identification only \u2014 no order is selected/defaulted by this manifest."
  },
  {
    ordinal: 90,
    observedName: "",
    technicalType: "text",
    structuralGroup: "REQUESTED_ORDER",
    repeatedGroupId: null,
    reviewSensitivity: "REQUESTED_ORDER",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows 'asks for an order,' and enumerates specific relief options (placement with parent under society supervision, interim society care, extended society care, access, restraining order under CYFSA s.137, support payment, costs, other) each introduced by its own checkbox + detail text. Structural identification only \u2014 no order is selected/defaulted by this manifest."
  },
  {
    ordinal: 91,
    observedName: "Check77",
    technicalType: "checkbox",
    structuralGroup: "REQUESTED_ORDER",
    repeatedGroupId: null,
    reviewSensitivity: "REQUESTED_ORDER",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows 'asks for an order,' and enumerates specific relief options (placement with parent under society supervision, interim society care, extended society care, access, restraining order under CYFSA s.137, support payment, costs, other) each introduced by its own checkbox + detail text. Structural identification only \u2014 no order is selected/defaulted by this manifest."
  },
  {
    ordinal: 92,
    observedName: "Check77",
    technicalType: "checkbox",
    structuralGroup: "REQUESTED_ORDER",
    repeatedGroupId: null,
    reviewSensitivity: "REQUESTED_ORDER",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows 'asks for an order,' and enumerates specific relief options (placement with parent under society supervision, interim society care, extended society care, access, restraining order under CYFSA s.137, support payment, costs, other) each introduced by its own checkbox + detail text. Structural identification only \u2014 no order is selected/defaulted by this manifest."
  },
  {
    ordinal: 93,
    observedName: "",
    technicalType: "text",
    structuralGroup: "REQUESTED_ORDER",
    repeatedGroupId: null,
    reviewSensitivity: "REQUESTED_ORDER",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows 'asks for an order,' and enumerates specific relief options (placement with parent under society supervision, interim society care, extended society care, access, restraining order under CYFSA s.137, support payment, costs, other) each introduced by its own checkbox + detail text. Structural identification only \u2014 no order is selected/defaulted by this manifest."
  },
  {
    ordinal: 94,
    observedName: "",
    technicalType: "checkbox",
    structuralGroup: "REQUESTED_ORDER",
    repeatedGroupId: null,
    reviewSensitivity: "REQUESTED_ORDER",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Same visual/table position as the preceding requested-order cluster (checkbox + detail text pattern) but the associated label text ('deemed to be a parenting order under s.28 of the Children's Law Reform Act', 'restrained under s.102(3) of the CYFSA') differs in statutory register from the immediately preceding CYFSA-society-care relief block, suggesting these may belong to a distinct order sub-pathway (e.g. a status-review / custody-and-access variant) rather than the same protection-order list. Category REQUESTED_ORDER is confident; the PROTECTION_CONTEXT vs STATUS_REVIEW_CONTEXT sub-pathway distinction is NOT established from structure alone and is left REQUIRES_REVIEW rather than guessed."
  },
  {
    ordinal: 95,
    observedName: "",
    technicalType: "text",
    structuralGroup: "REQUESTED_ORDER",
    repeatedGroupId: null,
    reviewSensitivity: "REQUESTED_ORDER",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Same visual/table position as the preceding requested-order cluster (checkbox + detail text pattern) but the associated label text ('deemed to be a parenting order under s.28 of the Children's Law Reform Act', 'restrained under s.102(3) of the CYFSA') differs in statutory register from the immediately preceding CYFSA-society-care relief block, suggesting these may belong to a distinct order sub-pathway (e.g. a status-review / custody-and-access variant) rather than the same protection-order list. Category REQUESTED_ORDER is confident; the PROTECTION_CONTEXT vs STATUS_REVIEW_CONTEXT sub-pathway distinction is NOT established from structure alone and is left REQUIRES_REVIEW rather than guessed."
  },
  {
    ordinal: 96,
    observedName: "",
    technicalType: "checkbox",
    structuralGroup: "REQUESTED_ORDER",
    repeatedGroupId: null,
    reviewSensitivity: "REQUESTED_ORDER",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Same visual/table position as the preceding requested-order cluster (checkbox + detail text pattern) but the associated label text ('deemed to be a parenting order under s.28 of the Children's Law Reform Act', 'restrained under s.102(3) of the CYFSA') differs in statutory register from the immediately preceding CYFSA-society-care relief block, suggesting these may belong to a distinct order sub-pathway (e.g. a status-review / custody-and-access variant) rather than the same protection-order list. Category REQUESTED_ORDER is confident; the PROTECTION_CONTEXT vs STATUS_REVIEW_CONTEXT sub-pathway distinction is NOT established from structure alone and is left REQUIRES_REVIEW rather than guessed."
  },
  {
    ordinal: 97,
    observedName: "",
    technicalType: "text",
    structuralGroup: "REQUESTED_ORDER",
    repeatedGroupId: null,
    reviewSensitivity: "REQUESTED_ORDER",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Same visual/table position as the preceding requested-order cluster (checkbox + detail text pattern) but the associated label text ('deemed to be a parenting order under s.28 of the Children's Law Reform Act', 'restrained under s.102(3) of the CYFSA') differs in statutory register from the immediately preceding CYFSA-society-care relief block, suggesting these may belong to a distinct order sub-pathway (e.g. a status-review / custody-and-access variant) rather than the same protection-order list. Category REQUESTED_ORDER is confident; the PROTECTION_CONTEXT vs STATUS_REVIEW_CONTEXT sub-pathway distinction is NOT established from structure alone and is left REQUIRES_REVIEW rather than guessed."
  },
  {
    ordinal: 98,
    observedName: "",
    technicalType: "checkbox",
    structuralGroup: "REQUESTED_ORDER",
    repeatedGroupId: null,
    reviewSensitivity: "REQUESTED_ORDER",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Same visual/table position as the preceding requested-order cluster (checkbox + detail text pattern) but the associated label text ('deemed to be a parenting order under s.28 of the Children's Law Reform Act', 'restrained under s.102(3) of the CYFSA') differs in statutory register from the immediately preceding CYFSA-society-care relief block, suggesting these may belong to a distinct order sub-pathway (e.g. a status-review / custody-and-access variant) rather than the same protection-order list. Category REQUESTED_ORDER is confident; the PROTECTION_CONTEXT vs STATUS_REVIEW_CONTEXT sub-pathway distinction is NOT established from structure alone and is left REQUIRES_REVIEW rather than guessed."
  },
  {
    ordinal: 99,
    observedName: "",
    technicalType: "text",
    structuralGroup: "REQUESTED_ORDER",
    repeatedGroupId: null,
    reviewSensitivity: "REQUESTED_ORDER",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Same visual/table position as the preceding requested-order cluster (checkbox + detail text pattern) but the associated label text ('deemed to be a parenting order under s.28 of the Children's Law Reform Act', 'restrained under s.102(3) of the CYFSA') differs in statutory register from the immediately preceding CYFSA-society-care relief block, suggesting these may belong to a distinct order sub-pathway (e.g. a status-review / custody-and-access variant) rather than the same protection-order list. Category REQUESTED_ORDER is confident; the PROTECTION_CONTEXT vs STATUS_REVIEW_CONTEXT sub-pathway distinction is NOT established from structure alone and is left REQUIRES_REVIEW rather than guessed."
  },
  {
    ordinal: 100,
    observedName: "",
    technicalType: "text",
    structuralGroup: "REQUESTED_ORDER",
    repeatedGroupId: null,
    reviewSensitivity: "REQUESTED_ORDER",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Same visual/table position as the preceding requested-order cluster (checkbox + detail text pattern) but the associated label text ('deemed to be a parenting order under s.28 of the Children's Law Reform Act', 'restrained under s.102(3) of the CYFSA') differs in statutory register from the immediately preceding CYFSA-society-care relief block, suggesting these may belong to a distinct order sub-pathway (e.g. a status-review / custody-and-access variant) rather than the same protection-order list. Category REQUESTED_ORDER is confident; the PROTECTION_CONTEXT vs STATUS_REVIEW_CONTEXT sub-pathway distinction is NOT established from structure alone and is left REQUIRES_REVIEW rather than guessed."
  },
  {
    ordinal: 101,
    observedName: "Check79",
    technicalType: "checkbox",
    structuralGroup: "APPLICATION_CONTEXT",
    repeatedGroupId: null,
    reviewSensitivity: "SWORN_FACT",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows '3. To the applicant's best knowledge, the child(ren)' / 'has/have never before been in the care of a society under an out-of-court agreement under s.75...' \u2014 an applicant factual assertion, not a requested order."
  },
  {
    ordinal: 102,
    observedName: "Check76",
    technicalType: "checkbox",
    structuralGroup: "APPLICATION_CONTEXT",
    repeatedGroupId: null,
    reviewSensitivity: "SWORN_FACT",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Companion checkbox: 'has/have been in the care of a society under an out-of-court agreement under s.75...'. Mutually exclusive with order 101 only by plain-language reading ('never ... / has been ...'); exclusivity is stated in the form's prose, not independently verified via a radio-group technical control."
  },
  {
    ordinal: 103,
    observedName: "",
    technicalType: "text",
    structuralGroup: "APPLICATION_CONTEXT",
    repeatedGroupId: "prior_care_details",
    reviewSensitivity: "SWORN_FACT",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows '...The details are as follows: (Set out the number of times each child was in society care...)'."
  },
  {
    ordinal: 104,
    observedName: "Check76",
    technicalType: "checkbox",
    structuralGroup: "APPLICATION_CONTEXT",
    repeatedGroupId: null,
    reviewSensitivity: "SWORN_FACT",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows '4. To the applicant's best knowledge, the parties or the child(ren)' / 'have'."
  },
  {
    ordinal: 105,
    observedName: "Check76",
    technicalType: "checkbox",
    structuralGroup: "APPLICATION_CONTEXT",
    repeatedGroupId: null,
    reviewSensitivity: "SWORN_FACT",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Companion checkbox 'have not' (prior court case)."
  },
  {
    ordinal: 106,
    observedName: "",
    technicalType: "text",
    structuralGroup: "APPLICATION_CONTEXT",
    repeatedGroupId: null,
    reviewSensitivity: "SWORN_FACT",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows '...been in a court case before relating to...(Provide details...)'."
  },
  {
    ordinal: 107,
    observedName: "Check76",
    technicalType: "checkbox",
    structuralGroup: "APPLICATION_CONTEXT",
    repeatedGroupId: null,
    reviewSensitivity: "SWORN_FACT",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows '5. The parties' / 'have' (written agreement)."
  },
  {
    ordinal: 108,
    observedName: "Check76",
    technicalType: "checkbox",
    structuralGroup: "APPLICATION_CONTEXT",
    repeatedGroupId: null,
    reviewSensitivity: "SWORN_FACT",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Companion checkbox 'have not' (written agreement)."
  },
  {
    ordinal: 109,
    observedName: "",
    technicalType: "text",
    structuralGroup: "APPLICATION_CONTEXT",
    repeatedGroupId: null,
    reviewSensitivity: "SWORN_FACT",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows '...made a written agreement dealing with any matter...(give date...which terms are in dispute)'."
  },
  {
    ordinal: 110,
    observedName: "",
    technicalType: "text",
    structuralGroup: "FACTUAL_NARRATIVE",
    repeatedGroupId: null,
    reviewSensitivity: "SWORN_FACT",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Directly follows '6. The following is a brief statement of the facts upon which the applicant is relying...'. Free-text narrative container; no text is generated or inferred by this manifest."
  },
  {
    ordinal: 111,
    observedName: "",
    technicalType: "text",
    structuralGroup: "OTHER",
    repeatedGroupId: null,
    reviewSensitivity: "UNRESOLVED",
    evidence: "STRUCTURAL_INFERENCE",
    mapReadiness: "REQUIRES_REVIEW",
    rationale: "Falls between 'Put a line through any blank space left on this page.' and the 'Date of signature' / 'Signature' labels on page 6; could not be confirmed whether this is a continuation of the facts narrative (order 110) or an unrelated control \u2014 left REQUIRES_REVIEW rather than assumed."
  },
  {
    ordinal: 112,
    observedName: "",
    technicalType: "text",
    structuralGroup: "SIGNATURE_OR_ATTESTATION",
    repeatedGroupId: null,
    reviewSensitivity: "SIGNATURE_OR_ATTESTATION",
    evidence: "DIRECT_STRUCTURAL_CONTEXT",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Positioned directly under the 'Date of signature' column label."
  },
  {
    ordinal: 113,
    observedName: "",
    technicalType: "text",
    structuralGroup: "SIGNATURE_OR_ATTESTATION",
    repeatedGroupId: null,
    reviewSensitivity: "SIGNATURE_OR_ATTESTATION",
    evidence: "DIRECT_STRUCTURAL_CONTEXT",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Positioned directly under the 'Signature' column label (a static signature line captured as a legacy text field in this DOCX; no signature is generated/populated by this manifest)."
  },
  {
    ordinal: 114,
    observedName: "",
    technicalType: "text",
    structuralGroup: "REQUESTED_ORDER",
    repeatedGroupId: null,
    reviewSensitivity: "REQUESTED_ORDER",
    evidence: "DIRECT_LABEL",
    mapReadiness: "SAFE_TO_MAP",
    rationale: "Page 7 'APPENDIX' \u2014 'The terms and conditions proposed for the child(ren)'s supervision are as follows...'. Detail narrative attached to the supervision relief requested at order 69-82; structural identification only."
  },
];

if (FORM_8B_STRUCTURAL_MANIFEST.length !== 115) {
  throw new Error(
    `Form 8B structural manifest must account for exactly 115 technical controls (frozen inventory fieldCount); got ${FORM_8B_STRUCTURAL_MANIFEST.length}.`
  );
}

// No default/selected pleading answer is ever encoded in this manifest: entries carry no
// `value`, `checked`, `selected`, or `defaultValue` field at all — only structural/sensitivity
// metadata. This is enforced structurally (the type has no such field) and defensively by
// the guard below, which fails the module load if that invariant is ever violated.
for (const entry of FORM_8B_STRUCTURAL_MANIFEST) {
  if (Object.prototype.hasOwnProperty.call(entry, "value") ||
      Object.prototype.hasOwnProperty.call(entry, "checked") ||
      Object.prototype.hasOwnProperty.call(entry, "selected") ||
      Object.prototype.hasOwnProperty.call(entry, "defaultValue")) {
    throw new Error(
      `Form 8B structural manifest entry (ordinal ${entry.ordinal}) carries a value/selection field — structural manifests must never encode a pleading answer.`
    );
  }
}
