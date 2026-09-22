// Stage 9D-4B-2A-ii-b4B-i — Form 8B semantic field map, NARROWED PASS 1 OF 3:
// ADMINISTRATIVE + CHILD/PARTY IDENTIFICATION controls only.
//
// SCOPE: this is deliberately NOT the full Form 8B semantic map, and is deliberately NOT named
// `form8bSemanticFieldMap.ts` (the frozen Form 14A/35.1A/33C suites assert that no full Form 8B
// map module exists yet — that remains true). It covers exactly the controls that the frozen
// b4A structural manifest (`form8bStructuralManifest.ts`, NOT modified here) assigns to the
// structural groups COURT_ADMINISTRATION (9), APPLICATION_CONTEXT (9), PARTY_IDENTIFICATION (3),
// REPRESENTATIVE_INFORMATION (3) and CHILD_IDENTIFICATION (32) — 56 of the 115 real technical
// controls. The remaining 59 controls (REQUESTED_ORDER 34, LEGAL_GROUND_OR_POSITION 21,
// SIGNATURE_OR_ATTESTATION 2, FACTUAL_NARRATIVE 1, OTHER 1) are recorded as
// DEFERRED_TO_FUTURE_PASS: not attempted here by design (future b4B-ii / b4B-iii passes), and
// kept OUT of the SemanticFieldMap entries so no pleading control can acquire a semantic key in
// this pass.
//
// This module does NOT populate Form 8B (no DOCX writes), does NOT choose requested orders or
// legal grounds, does NOT infer a party's legal role from a name, and marks NO field legally
// required (every entry uses DEFAULT_LEGAL_REQUIREDNESS_STATE = "UNKNOWN").
//
// EVIDENCE BASIS: the real Form 8B DOCX
// (/root/.claude/uploads/f5b74824-3969-5f04-a809-1a60f42bc26e/d39f83dd-form-8b-feb_1_2022-en.docx,
// sha256 02a5c3fdc32b42ed1f2db20115c1ff8bb9cf0233aa510a48063af9a10c5e7799 — equal to
// officialFormSourceManifest.ts's REAL_ARTIFACT_BYTE_VERIFICATIONS 8B/DOCX entry and
// docxFieldInventoryData.ts's 8B entry), re-read from its raw word/document.xml.
//
// CHILD-IDENTIFICATION TABLE — NEW EVIDENCE (b4A left all 32 cells REQUIRES_REVIEW because its
// linear-text walk could not resolve columns). Walking the real OOXML table markup:
//   - The 32 fields live in the 3rd top-level <w:tbl> of document.xml (page-3 table), no nested
//     tables. Its <w:tblGrid> has 14 grid columns with widths
//     [459,396,236,160,1008,1134,738,558,649,971,1463,157,999,1729].
//   - Row 4 (0-based) is the header row with SEVEN <w:tc>: "Child's Full Legal Name"
//     (gridSpan 5 -> grid 0-4), "Birthdate" (grid 5), "Age" (grid 6), "Sex" (grid 7),
//     "Full Legal Name(s) of Parent(s)" (gridSpan 4 -> grid 8-11), "Is the Child First Nations,
//     Inuk, or Métis?" (grid 12), "Child's Bands and First Nations, Inuit, or Métis Communities"
//     (grid 13).
//   - Rows 5, 6, 7, 8 each have EIGHT <w:tc>, each containing exactly one FORMTEXT <w:ffData>:
//     gridSpan 5 (grid 0-4), grid 5, grid 6, grid 7 (maxLength 2), gridSpan 2 (grid 8-9),
//     gridSpan 2 (grid 10-11), grid 12, grid 13. No gridBefore/gridAfter/vMerge in any of them.
//   - Therefore the 8 data cells align EXACTLY to the header's grid spans; the header's
//     4-column "Parent(s)" span is covered by TWO data cells (grid 8-9 and 10-11). The "7 columns"
//     reported by b4A are really 7 headers over 8 data slots per row; 4 rows x 8 = 32 fields,
//     ordinals 15..46 in row-major document order.
//   - Promotion decision: all 32 are MAPPED. 24 (name/birthdate/age/sex/status/communities x 4)
//     carry DIRECT_STRUCTURAL_CONTEXT (exact grid alignment under a single header). The 8 parent
//     slots carry STRUCTURAL_INFERENCE: grid alignment proves both cells sit under the
//     "Full Legal Name(s) of Parent(s)" header, but that the two cells are "one parent name
//     each" (rather than, e.g., one overflow cell) is an inference from the plural header, and
//     slot order carries NO parent-role meaning (no mother/father/other label exists).
import {
  buildExpectedBinding,
  TECHNICAL_INVENTORY_SCHEMA_VERSION,
  DEFAULT_LEGAL_REQUIREDNESS_STATE,
  type SemanticFieldMap,
  type SemanticFieldMapEntry,
  type ExactTemplateBinding,
  type SemanticValueType,
  type ApplicabilityState,
  type ReviewSensitivityCategory,
  type PermittedProvenanceClasses
} from "./semanticFieldMap.js";
import type { Form8BStructuralGroup, StructuralEvidenceStrength } from "./form8bStructuralManifest.js";

export const FORM_8B_SOURCE_SHA256_HEX =
  "02a5c3fdc32b42ed1f2db20115c1ff8bb9cf0233aa510a48063af9a10c5e7799";

export const FORM_8B_EXACT_TEMPLATE_BINDING: ExactTemplateBinding = buildExpectedBinding({
  formId: "official-form-8b",
  formNumber: "8B",
  formVersionId: "official-form-8b-version-feb-1-2022",
  versionLabel: "February 1, 2022",
  templateId: "official-form-8b-template-docx-form-8b-feb_1_2022-en",
  sourceSha256Hex: FORM_8B_SOURCE_SHA256_HEX,
  technicalInventorySchemaVersion: TECHNICAL_INVENTORY_SCHEMA_VERSION
});

/** Pass-1 map version label. Passes 2/3 will register NEW labels; this one is never mutated. */
export const FORM_8B_PASS1_MAP_VERSION_LABEL = "form8b-semantic-map-pass1-admin-child-party-v1";

export const FORM_8B_TOTAL_TECHNICAL_CONTROLS = 115 as const;

export const FORM_8B_PASS1_IN_SCOPE_GROUPS: readonly Form8BStructuralGroup[] = [
  "COURT_ADMINISTRATION",
  "APPLICATION_CONTEXT",
  "PARTY_IDENTIFICATION",
  "REPRESENTATIVE_INFORMATION",
  "CHILD_IDENTIFICATION"
];
export const FORM_8B_PASS1_DEFERRED_GROUPS: readonly Form8BStructuralGroup[] = [
  "REQUESTED_ORDER",
  "LEGAL_GROUND_OR_POSITION",
  "SIGNATURE_OR_ATTESTATION",
  "FACTUAL_NARRATIVE",
  "OTHER"
];

export const FORM_8B_PASS1_DISPOSITIONS = ["MAPPED", "UNRESOLVED", "DEFERRED_TO_FUTURE_PASS"] as const;
export type Form8BPass1Disposition = (typeof FORM_8B_PASS1_DISPOSITIONS)[number];

/** Per-control evidence record (the frozen SemanticFieldMapEntry type has no evidence field). */
export interface Form8BPass1EvidenceRecord {
  ordinal: number;
  frozenStructuralGroup: Form8BStructuralGroup;
  evidence: StructuralEvidenceStrength;
  evidenceDetail: string;
}

const TEXT = { technicalType: "text" as const, technicalMaxLength: 32000, technicalDropdownOptions: null, technicallyRequired: false };
const CHECKBOX = { technicalType: "checkbox" as const, technicalMaxLength: null, technicalDropdownOptions: null, technicallyRequired: false };
const ADMIN_PROV: PermittedProvenanceClasses = ["USER_ENTERED", "MATTER_DERIVED"];
const SWORN_PROV: PermittedProvenanceClasses = ["USER_ENTERED", "PROFESSIONALLY_REVIEWED"];

interface Spec {
  ordinal: number;
  name: string;
  type: "text" | "checkbox" | "dropdown";
  paragraphOrdinal: number;
  group: Form8BStructuralGroup;
  semanticKey: string;
  label: string;
  description: string;
  formSection: string;
  valueType: SemanticValueType;
  technicalMaxLength?: number;
  applicability: ApplicabilityState;
  provenance: PermittedProvenanceClasses;
  sensitivity: ReviewSensitivityCategory;
  evidence: StructuralEvidenceStrength;
  evidenceDetail: string;
  notes?: string | null;
  warnings?: string[];
}

const COURT_LEVEL_OPTIONS = ["          ", "Superior Court of Justice", "Superior Court of Justice, Family Court", "Ontario Court of Justice"];

function toEntry(s: Spec): SemanticFieldMapEntry {
  const isDropdown = s.type === "dropdown";
  const technicalConstraints = isDropdown
    ? { technicalType: "dropdown" as const, technicalMaxLength: null, technicalDropdownOptions: COURT_LEVEL_OPTIONS, technicallyRequired: false }
    : s.type === "checkbox"
      ? CHECKBOX
      : { ...TEXT, technicalMaxLength: s.technicalMaxLength ?? 32000 };
  return {
    semanticKey: s.semanticKey,
    label: s.label,
    description: s.description,
    technicalIdentity: { ordinal: s.ordinal, name: s.name, type: s.type, tableDepth: 1, paragraphOrdinal: s.paragraphOrdinal },
    formSection: s.formSection,
    semanticConstraints: {
      valueType: s.valueType,
      cardinality: "SINGLE",
      allowedValues: isDropdown ? COURT_LEVEL_OPTIONS : null,
      maxLength: s.type === "text" ? (s.technicalMaxLength ?? 32000) : null
    },
    technicalConstraints,
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    applicability: s.applicability,
    permittedProvenance: s.provenance,
    reviewSensitivity: s.sensitivity,
    mappingResolution: "HUMAN_MAPPED",
    notes: s.notes ?? null,
    warnings: s.warnings ?? []
  };
}

const OPTION_BOX_NOTE =
  "This key names the checkbox SLOT printed on the form, not an answer: no default/selected " +
  "state is encoded (technical defaultChecked=false, no allowedValues), and the map does not " +
  "assert which option is true. Companion boxes are not technically linked as mutually " +
  "exclusive in the DOCX markup.";

// ---------------------------------------------------------------------------
// Non-child in-scope controls (24).
// ---------------------------------------------------------------------------
const NON_CHILD_SPECS: readonly Spec[] = [
  { ordinal: 0, name: "", type: "dropdown", paragraphOrdinal: 4, group: "COURT_ADMINISTRATION", semanticKey: "court.level", label: "Court level",
    description: "Which Ontario court the application is filed in.", formSection: "Header — court identification", valueType: "ENUM",
    applicability: "ALWAYS_APPLICABLE", provenance: ADMIN_PROV, sensitivity: "NORMAL_ADMINISTRATIVE", evidence: "DIRECT_LABEL",
    evidenceDetail: "Dropdown listEntries are exactly the Ontario court-level names; sits in the header court block (b4A).",
    notes: "Blank first list entry is the unselected state, not a fourth court option." },
  { ordinal: 1, name: "CourtFileNo", type: "text", paragraphOrdinal: 7, group: "COURT_ADMINISTRATION", semanticKey: "court.fileNumber", label: "Court file number",
    description: "The case's court file number.", formSection: "Header — court identification", valueType: "COURT_FILE_NUMBER",
    applicability: "ALWAYS_APPLICABLE", provenance: ADMIN_PROV, sensitivity: "NORMAL_ADMINISTRATIVE", evidence: "DIRECT_LABEL",
    evidenceDetail: "w:name 'CourtFileNo' plus adjacent 'Court File Number' caption." },
  { ordinal: 2, name: "", type: "text", paragraphOrdinal: 15, group: "COURT_ADMINISTRATION", semanticKey: "court.officeAddress", label: "Court office address",
    description: "The court office location in the heading ('(Name of court) at ___').", formSection: "Header — court identification", valueType: "ADDRESS",
    applicability: "ALWAYS_APPLICABLE", provenance: ADMIN_PROV, sensitivity: "NORMAL_ADMINISTRATIVE", evidence: "DIRECT_LABEL",
    evidenceDetail: "Directly follows '(Name of court) at'; the document's 'Court office address' caption belongs to this heading block." },
  { ordinal: 3, name: "", type: "text", paragraphOrdinal: 27, group: "PARTY_IDENTIFICATION", semanticKey: "applicant.nameAndAddressForService", label: "Applicant(s): full legal name & address for service",
    description: "Applicant(s)' full legal name and address for service, as one free-text block.", formSection: "Header — Applicant(s)", valueType: "TEXT",
    applicability: "ALWAYS_APPLICABLE", provenance: ADMIN_PROV, sensitivity: "NORMAL_ADMINISTRATIVE", evidence: "DIRECT_LABEL",
    evidenceDetail: "Under the printed 'Applicant(s)' heading and 'Full legal name & address for service' column caption.",
    notes: "Party role 'applicant' comes from the template's printed heading, not from any name. One field may hold multiple applicants ('Applicant(s)')." },
  { ordinal: 4, name: "", type: "text", paragraphOrdinal: 29, group: "REPRESENTATIVE_INFORMATION", semanticKey: "applicant.lawyerNameAndAddress", label: "Applicant(s)' lawyer: name & address",
    description: "Name and address of the applicant(s)' lawyer, as one free-text block.", formSection: "Header — Applicant(s)", valueType: "TEXT",
    applicability: "CONDITIONALLY_APPLICABLE", provenance: ADMIN_PROV, sensitivity: "NORMAL_ADMINISTRATIVE", evidence: "DIRECT_LABEL",
    evidenceDetail: "Under 'Applicant(s)' heading, 'Lawyer's name & address' column caption." },
  { ordinal: 5, name: "", type: "text", paragraphOrdinal: 34, group: "PARTY_IDENTIFICATION", semanticKey: "respondent.nameAndAddressForService", label: "Respondent(s): full legal name & address for service",
    description: "Respondent(s)' full legal name and address for service, as one free-text block.", formSection: "Header — Respondent(s)", valueType: "TEXT",
    applicability: "ALWAYS_APPLICABLE", provenance: ADMIN_PROV, sensitivity: "NORMAL_ADMINISTRATIVE", evidence: "DIRECT_LABEL",
    evidenceDetail: "Under the printed 'Respondent(s)' heading and 'Full legal name & address for service' column caption.",
    notes: "Party role 'respondent' comes from the template's printed heading, not from any name." },
  { ordinal: 6, name: "", type: "text", paragraphOrdinal: 36, group: "REPRESENTATIVE_INFORMATION", semanticKey: "respondent.lawyerNameAndAddress", label: "Respondent(s)' lawyer: name & address",
    description: "Name and address of the respondent(s)' lawyer, as one free-text block.", formSection: "Header — Respondent(s)", valueType: "TEXT",
    applicability: "CONDITIONALLY_APPLICABLE", provenance: ADMIN_PROV, sensitivity: "NORMAL_ADMINISTRATIVE", evidence: "DIRECT_LABEL",
    evidenceDetail: "Under 'Respondent(s)' heading, 'Lawyer's name & address' column caption." },
  { ordinal: 7, name: "", type: "text", paragraphOrdinal: 39, group: "REPRESENTATIVE_INFORMATION", semanticKey: "childrensLawyer.agentNameAndAddress", label: "Children's Lawyer: agent for service",
    description: "Name & address of the Children's Lawyer's agent for service (and person represented).", formSection: "Header — Children's Lawyer", valueType: "TEXT",
    applicability: "CONDITIONALLY_APPLICABLE", provenance: ADMIN_PROV, sensitivity: "NORMAL_ADMINISTRATIVE", evidence: "DIRECT_LABEL",
    evidenceDetail: "Directly under the 'Children's Lawyer' heading / agent-for-service caption." },
  { ordinal: 8, name: "", type: "text", paragraphOrdinal: 43, group: "COURT_ADMINISTRATION", semanticKey: "firstCourtDate.date", label: "First court date",
    description: "The date of the first court appearance.", formSection: "Page 1 — notice to respondent(s)", valueType: "DATE",
    applicability: "ALWAYS_APPLICABLE", provenance: ADMIN_PROV, sensitivity: "NORMAL_ADMINISTRATIVE", evidence: "DIRECT_LABEL",
    evidenceDetail: "Directly follows 'THE FIRST COURT DATE IS (date)'." },
  { ordinal: 9, name: "", type: "text", paragraphOrdinal: 45, group: "COURT_ADMINISTRATION", semanticKey: "firstCourtDate.time", label: "First court date: time",
    description: "Clock time of the first court appearance (a.m./p.m. is chosen by separate boxes).", formSection: "Page 1 — notice to respondent(s)", valueType: "TEXT",
    applicability: "ALWAYS_APPLICABLE", provenance: ADMIN_PROV, sensitivity: "NORMAL_ADMINISTRATIVE", evidence: "DIRECT_LABEL",
    evidenceDetail: "Directly follows 'AT' after the first-court-date field and precedes the a.m./p.m. boxes." },
  { ordinal: 10, name: "", type: "checkbox", paragraphOrdinal: 46, group: "COURT_ADMINISTRATION", semanticKey: "firstCourtDate.amBox", label: "First court time: 'a.m.' box",
    description: "The 'a.m.' checkbox slot for the first court time.", formSection: "Page 1 — notice to respondent(s)", valueType: "BOOLEAN",
    applicability: "ALWAYS_APPLICABLE", provenance: ADMIN_PROV, sensitivity: "NORMAL_ADMINISTRATIVE", evidence: "DIRECT_LABEL",
    evidenceDetail: "Checkbox immediately followed by label 'a.m.'.", notes: OPTION_BOX_NOTE },
  { ordinal: 11, name: "", type: "checkbox", paragraphOrdinal: 48, group: "COURT_ADMINISTRATION", semanticKey: "firstCourtDate.pmBox", label: "First court time: 'p.m.' box",
    description: "The 'p.m.' checkbox slot for the first court time.", formSection: "Page 1 — notice to respondent(s)", valueType: "BOOLEAN",
    applicability: "ALWAYS_APPLICABLE", provenance: ADMIN_PROV, sensitivity: "NORMAL_ADMINISTRATIVE", evidence: "DIRECT_LABEL",
    evidenceDetail: "Checkbox immediately followed by label 'p.m.'.", notes: OPTION_BOX_NOTE },
  { ordinal: 12, name: "", type: "text", paragraphOrdinal: 52, group: "COURT_ADMINISTRATION", semanticKey: "firstCourtDate.address", label: "First court date: address",
    description: "Address where the first court appearance takes place.", formSection: "Page 1 — notice to respondent(s)", valueType: "ADDRESS",
    applicability: "ALWAYS_APPLICABLE", provenance: ADMIN_PROV, sensitivity: "NORMAL_ADMINISTRATIVE", evidence: "DIRECT_LABEL",
    evidenceDetail: "Directly follows '...or as soon as possible after that time, at: (address)'." },
  { ordinal: 14, name: "", type: "text", paragraphOrdinal: 77, group: "COURT_ADMINISTRATION", semanticKey: "court.dateOfIssue", label: "Date of issue",
    description: "The date the application is issued (the clerk-of-the-court issuing block).", formSection: "Page 2 — issuing block", valueType: "DATE",
    applicability: "ALWAYS_APPLICABLE", provenance: ADMIN_PROV, sensitivity: "NORMAL_ADMINISTRATIVE", evidence: "STRUCTURAL_INFERENCE",
    evidenceDetail:
      "NEW TABLE EVIDENCE (b4A: UNRESOLVED): field is the only <w:ffData> in 2nd top-level table row 9, cell 0 (tcW 4914, gridSpan 2); " +
      "the cell directly BELOW it (row 10, cell 0, identical tcW 4914/gridSpan 2) holds the caption 'Date of issue', while the other " +
      "column (row 10, cell 2) holds 'Clerk of the court' over an empty, field-less row-9 cell. Reading a caption-under-the-line as " +
      "labelling the line above is an inference, so this stays STRUCTURAL_INFERENCE.",
    notes: "Issued by the court; the map does not assume who fills it in.",
    warnings: ["STRUCTURAL_INFERENCE: caption sits below the field (column-aligned), not before it."] },
  { ordinal: 68, name: "", type: "text", paragraphOrdinal: 222, group: "PARTY_IDENTIFICATION", semanticKey: "claim.orderRequesterName", label: "Paragraph 2: name of the party asking for an order",
    description: "The name written in '2. (name) asks for an order, ...'. Identifies WHO asks, not WHAT is asked.", formSection: "Claim by applicant — paragraph 2", valueType: "PERSON_NAME",
    applicability: "UNKNOWN", provenance: ADMIN_PROV, sensitivity: "NORMAL_ADMINISTRATIVE", evidence: "DIRECT_STRUCTURAL_CONTEXT",
    evidenceDetail: "Directly follows '2. (name)' and immediately precedes 'asks for an order,'.",
    notes: "No party legal role is assigned: the template's '(name)' caption does not itself say this is the applicant society, so none is inferred. The requested order itself is deferred to pass 2.",
    warnings: [] },
  { ordinal: 101, name: "Check79", type: "checkbox", paragraphOrdinal: 378, group: "APPLICATION_CONTEXT", semanticKey: "priorOutOfCourtSocietyCare.neverBeenInCareBox", label: "Para 3: 'has/have never before been in the care of a society' box",
    description: "Checkbox slot for the statement that the child(ren) has/have never been in society care under an s.75 out-of-court agreement.", formSection: "3. Prior out-of-court society care", valueType: "BOOLEAN",
    applicability: "ALWAYS_APPLICABLE", provenance: SWORN_PROV, sensitivity: "SWORN_FACT", evidence: "DIRECT_LABEL",
    evidenceDetail: "Follows '3. To the applicant's best knowledge, the child(ren)' and precedes 'has/have never before been in the care of a society ... s. 75'.",
    notes: OPTION_BOX_NOTE + " Legacy name Check79 is shared with other ordinals; identity is the full technical tuple (ordinal 101)." },
  { ordinal: 102, name: "Check76", type: "checkbox", paragraphOrdinal: 381, group: "APPLICATION_CONTEXT", semanticKey: "priorOutOfCourtSocietyCare.hasBeenInCareBox", label: "Para 3: 'has/have been in the care of a society' box",
    description: "Checkbox slot for the statement that the child(ren) has/have been in society care under an s.75 out-of-court agreement.", formSection: "3. Prior out-of-court society care", valueType: "BOOLEAN",
    applicability: "ALWAYS_APPLICABLE", provenance: SWORN_PROV, sensitivity: "SWORN_FACT", evidence: "DIRECT_LABEL",
    evidenceDetail: "Precedes 'has/have been in the care of a society under an out-of-court agreement under s. 75 ...'.",
    notes: OPTION_BOX_NOTE + " Legacy name Check76 is shared by 5 in-scope ordinals (102,104,105,107,108) and others; identity is ordinal 102." },
  { ordinal: 103, name: "", type: "text", paragraphOrdinal: 385, group: "APPLICATION_CONTEXT", semanticKey: "priorOutOfCourtSocietyCare.details", label: "Para 3: details of prior society care",
    description: "Number of times each child was in society care, when care began and how long it lasted.", formSection: "3. Prior out-of-court society care", valueType: "FREE_TEXT_NARRATIVE",
    applicability: "CONDITIONALLY_APPLICABLE", provenance: SWORN_PROV, sensitivity: "SWORN_FACT", evidence: "DIRECT_LABEL",
    evidenceDetail: "Directly follows 'The details are as follows: (Set out the number of times each child was in society care, when the care began and how long it lasted.)'." },
  { ordinal: 104, name: "Check76", type: "checkbox", paragraphOrdinal: 388, group: "APPLICATION_CONTEXT", semanticKey: "priorRelatedCourtCase.haveBox", label: "Para 4: 'have' (been in a prior court case) box",
    description: "Checkbox slot 'have' in '4. ... the parties or the child(ren) have / have not been in a court case before ...'.", formSection: "4. Prior related court case", valueType: "BOOLEAN",
    applicability: "ALWAYS_APPLICABLE", provenance: SWORN_PROV, sensitivity: "SWORN_FACT", evidence: "DIRECT_LABEL",
    evidenceDetail: "Follows '4. To the applicant's best knowledge, the parties or the child(ren)' and precedes 'have'.", notes: OPTION_BOX_NOTE },
  { ordinal: 105, name: "Check76", type: "checkbox", paragraphOrdinal: 390, group: "APPLICATION_CONTEXT", semanticKey: "priorRelatedCourtCase.haveNotBox", label: "Para 4: 'have not' (been in a prior court case) box",
    description: "Checkbox slot 'have not' in paragraph 4.", formSection: "4. Prior related court case", valueType: "BOOLEAN",
    applicability: "ALWAYS_APPLICABLE", provenance: SWORN_PROV, sensitivity: "SWORN_FACT", evidence: "DIRECT_LABEL",
    evidenceDetail: "Precedes 'have not been in a court case before relating to the supervision, interim or extended society care ...'.", notes: OPTION_BOX_NOTE },
  { ordinal: 106, name: "", type: "text", paragraphOrdinal: 396, group: "APPLICATION_CONTEXT", semanticKey: "priorRelatedCourtCase.details", label: "Para 4: details of prior court case / existing orders",
    description: "Details of any prior related court case, including any existing parenting or contact order.", formSection: "4. Prior related court case", valueType: "FREE_TEXT_NARRATIVE",
    applicability: "CONDITIONALLY_APPLICABLE", provenance: SWORN_PROV, sensitivity: "SWORN_FACT", evidence: "DIRECT_LABEL",
    evidenceDetail: "Directly follows '(Provide details of any existing parenting or contact order, including whether made by a superior court or under the Divorce Act.)'." },
  { ordinal: 107, name: "Check76", type: "checkbox", paragraphOrdinal: 399, group: "APPLICATION_CONTEXT", semanticKey: "writtenAgreement.haveBox", label: "Para 5: 'have' (made a written agreement) box",
    description: "Checkbox slot 'have' in '5. The parties have / have not made a written agreement ...'.", formSection: "5. Written agreement", valueType: "BOOLEAN",
    applicability: "ALWAYS_APPLICABLE", provenance: SWORN_PROV, sensitivity: "SWORN_FACT", evidence: "DIRECT_LABEL",
    evidenceDetail: "Follows '5. The parties' and precedes 'have'.", notes: OPTION_BOX_NOTE },
  { ordinal: 108, name: "Check76", type: "checkbox", paragraphOrdinal: 401, group: "APPLICATION_CONTEXT", semanticKey: "writtenAgreement.haveNotBox", label: "Para 5: 'have not' (made a written agreement) box",
    description: "Checkbox slot 'have not' in paragraph 5.", formSection: "5. Written agreement", valueType: "BOOLEAN",
    applicability: "ALWAYS_APPLICABLE", provenance: SWORN_PROV, sensitivity: "SWORN_FACT", evidence: "DIRECT_LABEL",
    evidenceDetail: "Precedes 'have not made a written agreement dealing with any matter involved in this case.'", notes: OPTION_BOX_NOTE },
  { ordinal: 109, name: "", type: "text", paragraphOrdinal: 407, group: "APPLICATION_CONTEXT", semanticKey: "writtenAgreement.details", label: "Para 5: agreement date and disputed terms",
    description: "Date of the written agreement and which of its terms are in dispute.", formSection: "5. Written agreement", valueType: "FREE_TEXT_NARRATIVE",
    applicability: "CONDITIONALLY_APPLICABLE", provenance: SWORN_PROV, sensitivity: "SWORN_FACT", evidence: "DIRECT_LABEL",
    evidenceDetail: "Directly follows '(If you checked the first box, give date of agreement and indicate which of its terms are in dispute ...)'." }
];

// ---------------------------------------------------------------------------
// Child-identification table (32): 4 rows x 8 data cells, from real <w:tbl>/<w:tr>/<w:tc> markup.
// ---------------------------------------------------------------------------
interface ChildColumn {
  cell: number;
  gridCols: string;
  header: string;
  keySuffix: string;
  label: string;
  valueType: SemanticValueType;
  maxLength: number;
  inference: boolean;
}
const CHILD_COLUMNS: readonly ChildColumn[] = [
  { cell: 0, gridCols: "0-4 (gridSpan 5)", header: "Child's Full Legal Name", keySuffix: "fullLegalName", label: "full legal name", valueType: "PERSON_NAME", maxLength: 32000, inference: false },
  { cell: 1, gridCols: "5", header: "Birthdate", keySuffix: "birthdate", label: "birthdate", valueType: "DATE", maxLength: 32000, inference: false },
  { cell: 2, gridCols: "6", header: "Age", keySuffix: "age", label: "age", valueType: "TEXT", maxLength: 32000, inference: false },
  { cell: 3, gridCols: "7", header: "Sex", keySuffix: "sex", label: "sex", valueType: "TEXT", maxLength: 2, inference: false },
  { cell: 4, gridCols: "8-9 (gridSpan 2)", header: "Full Legal Name(s) of Parent(s)", keySuffix: "parentFullLegalNameSlot1", label: "parent full legal name — slot 1", valueType: "PERSON_NAME", maxLength: 32000, inference: true },
  { cell: 5, gridCols: "10-11 (gridSpan 2)", header: "Full Legal Name(s) of Parent(s)", keySuffix: "parentFullLegalNameSlot2", label: "parent full legal name — slot 2", valueType: "PERSON_NAME", maxLength: 32000, inference: true },
  { cell: 6, gridCols: "12", header: "Is the Child First Nations, Inuk, or Métis?", keySuffix: "firstNationsInukOrMetisStatus", label: "First Nations / Inuk / Métis status", valueType: "TEXT", maxLength: 32000, inference: false },
  { cell: 7, gridCols: "13", header: "Child's Bands and First Nations, Inuit, or Métis Communities", keySuffix: "bandsAndCommunities", label: "bands and First Nations / Inuit / Métis communities", valueType: "TEXT", maxLength: 32000, inference: false }
];
const CHILD_TABLE_ROWS = [5, 6, 7, 8] as const; // 0-based <w:tr> index inside the 3rd top-level table
const CHILD_FIRST_ORDINAL = 15;
const CHILD_FIRST_PARAGRAPH_ORDINAL = 103; // frozen inventory: ordinals 15..46 -> paragraphOrdinals 103..134

function childSpecs(): Spec[] {
  const out: Spec[] = [];
  CHILD_TABLE_ROWS.forEach((tr, rowIdx) => {
    const childNo = rowIdx + 1;
    for (const col of CHILD_COLUMNS) {
      const offset = rowIdx * 8 + col.cell;
      out.push({
        ordinal: CHILD_FIRST_ORDINAL + offset,
        name: "",
        type: "text",
        paragraphOrdinal: CHILD_FIRST_PARAGRAPH_ORDINAL + offset,
        group: "CHILD_IDENTIFICATION",
        semanticKey: `child${childNo}.${col.keySuffix}`,
        label: `Child ${childNo}: ${col.label}`,
        description: `Child-table row ${childNo}, column '${col.header}'.`,
        formSection: "Page 3 — THE CHILD(REN) table",
        valueType: col.valueType,
        technicalMaxLength: col.maxLength,
        applicability: childNo === 1 && col.cell !== 5 ? "ALWAYS_APPLICABLE" : "CONDITIONALLY_APPLICABLE",
        provenance: ADMIN_PROV,
        sensitivity: "NORMAL_ADMINISTRATIVE",
        evidence: col.inference ? "STRUCTURAL_INFERENCE" : "DIRECT_STRUCTURAL_CONTEXT",
        evidenceDetail:
          `NEW TABLE EVIDENCE: 3rd top-level <w:tbl>, <w:tr> ${tr}, <w:tc> ${col.cell} (grid col ${col.gridCols}); ` +
          `header row 4 cell spanning the same grid column(s): '${col.header}'.` +
          (col.inference ? " Header spans grid 8-11; this data cell covers only half of it." : ""),
        notes:
          col.inference
            ? "Slot number is positional only: it carries NO parent-role meaning (mother/father/other) — none is printed on the template."
            : col.cell === 6 || col.cell === 7
              ? "Identity-sensitive content; b4A's frozen NORMAL_ADMINISTRATIVE sensitivity is preserved, no status is inferred."
              : null,
        warnings: col.inference
          ? ["STRUCTURAL_INFERENCE: two data cells sit under one plural 'Parent(s)' header; one-name-per-slot is inferred."]
          : []
      });
    }
  });
  return out;
}

const ALL_SPECS: readonly Spec[] = [...NON_CHILD_SPECS, ...childSpecs()].sort((a, b) => a.ordinal - b.ordinal);

export const FORM_8B_PASS1_SEMANTIC_ENTRIES: readonly SemanticFieldMapEntry[] = ALL_SPECS.map(toEntry);

export const FORM_8B_PASS1_EVIDENCE: readonly Form8BPass1EvidenceRecord[] = ALL_SPECS.map(s => ({
  ordinal: s.ordinal,
  frozenStructuralGroup: s.group,
  evidence: s.evidence,
  evidenceDetail: s.evidenceDetail
}));

export const FORM_8B_PASS1_SEMANTIC_FIELD_MAP: SemanticFieldMap = {
  binding: FORM_8B_EXACT_TEMPLATE_BINDING,
  mapVersionLabel: FORM_8B_PASS1_MAP_VERSION_LABEL,
  entries: FORM_8B_PASS1_SEMANTIC_ENTRIES
};

/** Ordinals intentionally NOT attempted in pass 1 (derived from the frozen b4A manifest groups). */
export const FORM_8B_PASS1_DEFERRED_ORDINALS: readonly number[] = [
  13, ...Array.from({ length: 21 }, (_, i) => 47 + i), ...Array.from({ length: 32 }, (_, i) => 69 + i), 110, 111, 112, 113, 114
];

export interface Form8BPass1Accounting {
  ordinal: number;
  disposition: Form8BPass1Disposition;
  semanticKey: string | null;
}

/** Full 115-control accounting: every ordinal exactly once as MAPPED / UNRESOLVED / DEFERRED. */
export function form8bPass1Accounting(): Form8BPass1Accounting[] {
  const byOrdinal = new Map(FORM_8B_PASS1_SEMANTIC_ENTRIES.map(e => [e.technicalIdentity.ordinal, e]));
  const deferred = new Set(FORM_8B_PASS1_DEFERRED_ORDINALS);
  const out: Form8BPass1Accounting[] = [];
  for (let o = 0; o < FORM_8B_TOTAL_TECHNICAL_CONTROLS; o++) {
    const e = byOrdinal.get(o);
    if (e && deferred.has(o)) throw new Error(`ordinal ${o} is both mapped and deferred`);
    if (e) out.push({ ordinal: o, disposition: e.mappingResolution === "UNRESOLVED" ? "UNRESOLVED" : "MAPPED", semanticKey: e.semanticKey });
    else if (deferred.has(o)) out.push({ ordinal: o, disposition: "DEFERRED_TO_FUTURE_PASS", semanticKey: null });
    else throw new Error(`ordinal ${o} is neither mapped nor deferred`);
  }
  return out;
}

export function form8bPass1CoverageSummary(): { total: number; mapped: number; unresolved: number; deferred: number } {
  const a = form8bPass1Accounting();
  return {
    total: a.length,
    mapped: a.filter(x => x.disposition === "MAPPED").length,
    unresolved: a.filter(x => x.disposition === "UNRESOLVED").length,
    deferred: a.filter(x => x.disposition === "DEFERRED_TO_FUTURE_PASS").length
  };
}
