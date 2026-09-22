// Stage 9D-4B-2A-ii-b2 — REAL Form 35.1A (Affidavit (child protection information)) semantic
// field map.
//
// SCOPE: maps the 68 real technical form-fields already inventoried in
// `docxFieldInventoryData.ts` (Stage 9D-4B-2A-i) to their WHAT-THE-CONTROL-REPRESENTS meaning,
// using the fail-closed type system and exact-template binding built in Stage 9D-4B-2A-ii-a
// (`semanticFieldMap.ts`) and the map SHAPE established by the frozen Form 14A map
// (`form14aSemanticFieldMap.ts`, 9D-4B-2A-ii-b1). This is the SECOND real per-form map and
// covers ONLY Form 35.1A. It does not modify, and is not derived by copying assumptions from,
// Form 14A's own map — 35.1A was independently re-read from its own real document.xml (see
// evidence basis below).
//
// This module does NOT:
//   - populate word/document.xml or generate a completed Form 35.1A,
//   - write or suggest completion VALUES for any field (no CompletionDraftValue is created here),
//   - decide what a deponent should swear to, whether an allegation is true, or how persuasive a
//     statement is,
//   - mark any field LEGALLY_REQUIRED (all entries use the conservative default state), or
//   - map any of the other four controlled forms (8B, 33B.1, 33C) or Form 14A (frozen) or the
//     quarantined Form 33B.
//
// EVIDENCE BASIS: every semantic key/label/rationale below is grounded in the real Form 35.1A
// document.xml text (visible labels, captions, table-column headings and headings adjacent to
// each FORMTEXT/FORMDROPDOWN field), extracted directly from the verified real DOCX artifact
// (/root/.claude/uploads/f5b74824-3969-5f04-a809-1a60f42bc26e/48d81005-form-35-1a-en-dec20.docx,
// sha256 4efdb1baabe0e621caceb73b0b9924b414665d9872e5f280a29e3ff61b28fbcc — matches
// officialFormSourceManifest.ts's REAL_ARTIFACT_BYTE_VERIFICATIONS entry and
// docxFieldInventoryData.ts's Form 35.1A entry exactly), NOT from generic legal knowledge about
// child-protection affidavits or from Form 14A's own mapping choices.
//
// The observed reading-order text (captions immediately preceding/following each field's
// <w:ffData> block, extracted via a direct python XML walk of word/document.xml — not just the
// frozen inventory's field list) was:
//
//   ONTARIO [court-level dropdown, ord.0] Court File Number [CourtFileNo, ord.1] at (Name of court)
//   Form 35.1A: Affidavit (child protection information)
//   [ord.2] (Court address)
//   Applicant(s) Full legal name & address for service... Lawyer's name & address...
//     [ord.3] [ord.4]
//   Respondent(s) Full legal name & address for service... Lawyer's name & address...
//     [ord.5] [ord.6]
//   My name is (full legal name) [ord.7]
//   I live in: (name of city, town or municipality...) [ord.8]
//   I swear/affirm that the following is true:
//   1. I am currently or I have been involved in the following child protection court cases:
//      Names of people involved in the case | Name of children's aid society | Court location |
//      Court orders made (include dates of orders)   [ord.9 .. ord.24 — 4 columns x 4 rows,
//      all technically named "Text1" (frozen duplicate-name anomaly)]
//   2. I have been involved with child protection services in the following way:
//      Names of other people involved | Name of children's aid society |
//      Location of children's aid society | Child protection service(s) (include dates...)
//      [ord.25 .. ord.40 — 4 columns x 4 rows, "Text1"]
//   3. To the best of my knowledge, the other party and/or the children in this case have been
//      involved in the following child protection court cases: [same 4 column headings as
//      paragraph 1] [ord.41 .. ord.52 — 4 columns x 3 rows, "Text1"]
//   4. To the best of my knowledge, the other party and/or the children in this case have been
//      involved with child protection services in the following way: [same 4 column headings as
//      paragraph 2] [ord.53 .. ord.64 — 4 columns x 3 rows, "Text1"]
//   Sworn/Affirmed before me at [ord.65] Municipality
//   in [ord.66] province, state, or country
//   on [ord.67] Signature (This form is to be signed in front of a lawyer, justice of the peace,
//      notary public or commissioner for taking affidavits.) Date Commissioner for taking
//      affidavits (Type or print name below if signature is illegible.)
//
// Note on the 8 unnamed fields (ord.2..8, excluding ord.1 CourtFileNo): the frozen inventory
// records these with an EMPTY w:name (anomalies.emptyNamedFieldCount: 8), so identity for these
// rests entirely on ordinal + paragraphOrdinal (never on name), exactly as
// TechnicalFieldIdentity requires.
//
// Note on the 59 "Text1"-named fields (ord.9..67 except the 3 jurat fields at the very end share
// the same duplicate name too — see below): docxFieldInventoryData.ts's anomalies.duplicateNames
// records ONLY ["Text1"], i.e. every non-empty, non-CourtFileNo field name in this document is
// literally "Text1" — a single name reused 59 times. This is materially DIFFERENT from Form
// 14A's duplicate-name situation (14A had two SEPARATE duplicated names, "Text6" x4 and "Text3"
// x4, each locally consistent with one semantic role per pair). Here, one name is reused across
// FOUR semantically distinct repeating table sections plus the three jurat fields, so field NAME
// carries no semantic evidence at all for any of these 59 fields; semantic meaning rests
// entirely on (a) which of the four repeating tables/jurat block the field's paragraphOrdinal
// falls within (DIRECT_STRUCTURAL_CONTEXT — each table is unambiguously delimited by its own
// intro sentence and column-heading row) and (b) position-within-row for the 4-column tables
// (STRUCTURAL_INFERENCE — row-major reading order matched against the 4 column headings; not
// confirmed by a per-cell label, since no per-cell label exists).
import {
  buildExpectedBinding,
  TECHNICAL_INVENTORY_SCHEMA_VERSION,
  DEFAULT_LEGAL_REQUIREDNESS_STATE,
  type SemanticFieldMap,
  type SemanticFieldMapEntry,
  type ExactTemplateBinding,
  type ApplicabilityState,
  type ReviewSensitivityCategory,
  type SemanticValueType,
  type PermittedProvenanceClasses
} from "./semanticFieldMap.js";

// ---------------------------------------------------------------------------
// Evidence-strength classification — Form 14A's map (9D-4B-2A-ii-b1) does not carry a separate
// typed evidence-strength field on SemanticFieldMapEntry (the frozen semanticFieldMap.ts type has
// none); it instead recorded evidence strength as prose inside `description`/`warnings`. This
// module reuses that SAME prose convention on every entry AND additionally provides this local,
// non-frozen companion export for programmatic/test access, without modifying the frozen type.
// ---------------------------------------------------------------------------
export const EVIDENCE_STRENGTH_LEVELS = [
  "DIRECT_LABEL",
  "DIRECT_STRUCTURAL_CONTEXT",
  "STRUCTURAL_INFERENCE",
  "UNRESOLVED"
] as const;
export type EvidenceStrength = (typeof EVIDENCE_STRENGTH_LEVELS)[number];

export interface Form351aEvidenceRecord {
  ordinal: number;
  semanticKey: string;
  evidenceStrength: EvidenceStrength;
}

// ---------------------------------------------------------------------------
// Exact-template binding for the real, byte-verified Form 35.1A DOCX artifact.
// ---------------------------------------------------------------------------
export const FORM_351A_SOURCE_SHA256_HEX =
  "4efdb1baabe0e621caceb73b0b9924b414665d9872e5f280a29e3ff61b28fbcc";

export const FORM_351A_EXACT_TEMPLATE_BINDING: ExactTemplateBinding = buildExpectedBinding({
  formId: "official-form-35-1a",
  formNumber: "35.1A",
  formVersionId: "official-form-35-1a-version-dec-1-2020",
  versionLabel: "Dec. 1, 2020",
  templateId: "official-form-35-1a-template-docx-form-35-1a-en-dec20",
  sourceSha256Hex: FORM_351A_SOURCE_SHA256_HEX,
  technicalInventorySchemaVersion: TECHNICAL_INVENTORY_SCHEMA_VERSION
});

export const FORM_351A_MAP_VERSION_LABEL = "form351a-semantic-map-v1";

function entry(overrides: SemanticFieldMapEntry): SemanticFieldMapEntry {
  return overrides;
}

// ---------------------------------------------------------------------------
// Header / preamble entries — ordinals 0..8. Each one directly labelled or, for the two
// name+address pairs, a structural-ordering inference (same evidence class as Form 14A's
// analogous applicant/respondent fields).
// ---------------------------------------------------------------------------
const HEADER_ENTRIES: SemanticFieldMapEntry[] = [
  entry({
    semanticKey: "courtLevel",
    label: "Court level",
    description:
      "Which Ontario court the affidavit is filed in. Evidence: static 'ONTARIO' heading above " +
      "the dropdown, and the dropdown's own listEntries are exact Ontario court-level names " +
      "(Ontario Court of Justice / Superior Court of Justice / Superior Court of Justice, Family " +
      "Court). Evidence strength: DIRECT_LABEL.",
    technicalIdentity: { ordinal: 0, name: "", type: "dropdown", tableDepth: 1, paragraphOrdinal: 2 },
    formSection: "Header — court identification",
    semanticConstraints: {
      valueType: "ENUM",
      cardinality: "SINGLE",
      allowedValues: [
        "          ",
        "Ontario Court of Justice",
        "Superior Court of Justice",
        "Superior Court of Justice, Family Court"
      ],
      maxLength: null
    },
    technicalConstraints: {
      technicalType: "dropdown",
      technicalMaxLength: null,
      technicalDropdownOptions: [
        "          ",
        "Ontario Court of Justice",
        "Superior Court of Justice",
        "Superior Court of Justice, Family Court"
      ],
      technicallyRequired: false
    },
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    applicability: "ALWAYS_APPLICABLE",
    permittedProvenance: ["USER_ENTERED", "MATTER_DERIVED"],
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    mappingResolution: "HUMAN_MAPPED",
    notes: "Blank first entry is the unselected default state, not a fourth court option.",
    warnings: []
  }),
  entry({
    semanticKey: "courtFileNumber",
    label: "Court file number",
    description:
      "The case's court file number. Evidence: the field's own w:name ('CourtFileNo') and the " +
      "'Court File Number' caption text immediately preceding it. Evidence strength: DIRECT_LABEL.",
    technicalIdentity: { ordinal: 1, name: "CourtFileNo", type: "text", tableDepth: 1, paragraphOrdinal: 5 },
    formSection: "Header — court identification",
    semanticConstraints: { valueType: "COURT_FILE_NUMBER", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
    technicalConstraints: { technicalType: "text", technicalMaxLength: 32000, technicalDropdownOptions: null, technicallyRequired: false },
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    applicability: "ALWAYS_APPLICABLE",
    permittedProvenance: ["USER_ENTERED", "MATTER_DERIVED"],
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    mappingResolution: "HUMAN_MAPPED",
    notes: null,
    warnings: []
  }),
  entry({
    semanticKey: "courtOfficeAddress",
    label: "Court office address",
    description:
      "The court office location named in the affidavit heading. Evidence: the '(Court address)' " +
      "caption appears immediately after this field in document order, directly labelling it, " +
      "separated only by blank lines. Evidence strength: DIRECT_STRUCTURAL_CONTEXT (the caption " +
      "does not sit on the same line/run as the field the way 'Court File Number' does for " +
      "ordinal 1, but no other candidate field or caption intervenes).",
    technicalIdentity: { ordinal: 2, name: "", type: "text", tableDepth: 1, paragraphOrdinal: 11 },
    formSection: "Header — affidavit heading",
    semanticConstraints: { valueType: "ADDRESS", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
    technicalConstraints: { technicalType: "text", technicalMaxLength: 32000, technicalDropdownOptions: null, technicallyRequired: false },
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    applicability: "ALWAYS_APPLICABLE",
    permittedProvenance: ["USER_ENTERED", "MATTER_DERIVED"],
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    mappingResolution: "HUMAN_MAPPED",
    notes: null,
    warnings: []
  }),
  entry({
    semanticKey: "applicantNameAndAddressForService",
    label: "Applicant's full legal name & address for service",
    description:
      "Evidence: sits under the 'Applicant(s)' heading, and is the FIRST of two fields following " +
      "the two captions 'Full legal name & address for service...' and 'Lawyer's name & " +
      "address...'. Evidence strength: STRUCTURAL_INFERENCE (ordering-based; both captions " +
      "precede both fields with no per-field label, same pattern independently observed here as " +
      "in Form 14A but re-derived from 35.1A's own document.xml, not copied from 14A).",
    technicalIdentity: { ordinal: 3, name: "", type: "text", tableDepth: 1, paragraphOrdinal: 23 },
    formSection: "Applicant(s) — party identification block",
    semanticConstraints: { valueType: "TEXT", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
    technicalConstraints: { technicalType: "text", technicalMaxLength: 32000, technicalDropdownOptions: null, technicallyRequired: false },
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    applicability: "ALWAYS_APPLICABLE",
    permittedProvenance: ["USER_ENTERED", "MATTER_DERIVED"],
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    mappingResolution: "HUMAN_MAPPED",
    notes: "Combined name+address caption — semantic valueType kept as generic TEXT, not PERSON_NAME/ADDRESS alone.",
    warnings: [
      "name-vs-lawyer field pairing (ordinal 3 vs 4) is a structural/positional inference from " +
        "field ordering, not confirmed by adjacent per-field text; both captions precede both fields."
    ]
  }),
  entry({
    semanticKey: "applicantLawyerNameAndAddress",
    label: "Applicant's lawyer's name & address",
    description:
      "Evidence: SECOND of the two 'Applicant(s)' fields (see ordinal-3 rationale). Evidence " +
      "strength: STRUCTURAL_INFERENCE.",
    technicalIdentity: { ordinal: 4, name: "", type: "text", tableDepth: 1, paragraphOrdinal: 26 },
    formSection: "Applicant(s) — party identification block",
    semanticConstraints: { valueType: "TEXT", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
    technicalConstraints: { technicalType: "text", technicalMaxLength: 32000, technicalDropdownOptions: null, technicallyRequired: false },
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    applicability: "CONDITIONALLY_APPLICABLE",
    permittedProvenance: ["USER_ENTERED", "MATTER_DERIVED"],
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    mappingResolution: "HUMAN_MAPPED",
    notes: "Only applicable when the applicant is legally represented; blank is valid for self-represented parties.",
    warnings: [
      "name-vs-lawyer field pairing (ordinal 3 vs 4) is a structural/positional inference from " +
        "field ordering, not confirmed by adjacent per-field text; both captions precede both fields."
    ]
  }),
  entry({
    semanticKey: "respondentNameAndAddressForService",
    label: "Respondent's full legal name & address for service",
    description:
      "Evidence: sits under the 'Respondent(s)' heading; FIRST of that section's two fields, by " +
      "the same structural-ordering inference used for the Applicant(s) block. Evidence strength: " +
      "STRUCTURAL_INFERENCE.",
    technicalIdentity: { ordinal: 5, name: "", type: "text", tableDepth: 1, paragraphOrdinal: 32 },
    formSection: "Respondent(s) — party identification block",
    semanticConstraints: { valueType: "TEXT", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
    technicalConstraints: { technicalType: "text", technicalMaxLength: 32000, technicalDropdownOptions: null, technicallyRequired: false },
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    applicability: "ALWAYS_APPLICABLE",
    permittedProvenance: ["USER_ENTERED", "MATTER_DERIVED"],
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    mappingResolution: "HUMAN_MAPPED",
    notes: "Combined name+address caption — semantic valueType kept as generic TEXT.",
    warnings: [
      "name-vs-lawyer field pairing (ordinal 5 vs 6) is a structural/positional inference from " +
        "field ordering, not confirmed by adjacent per-field text; both captions precede both fields."
    ]
  }),
  entry({
    semanticKey: "respondentLawyerNameAndAddress",
    label: "Respondent's lawyer's name & address",
    description:
      "Evidence: SECOND of the 'Respondent(s)' block's two fields (see ordinal-5 rationale). " +
      "Evidence strength: STRUCTURAL_INFERENCE.",
    technicalIdentity: { ordinal: 6, name: "", type: "text", tableDepth: 1, paragraphOrdinal: 35 },
    formSection: "Respondent(s) — party identification block",
    semanticConstraints: { valueType: "TEXT", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
    technicalConstraints: { technicalType: "text", technicalMaxLength: 32000, technicalDropdownOptions: null, technicallyRequired: false },
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    applicability: "CONDITIONALLY_APPLICABLE",
    permittedProvenance: ["USER_ENTERED", "MATTER_DERIVED"],
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    mappingResolution: "HUMAN_MAPPED",
    notes: "Only applicable when the respondent is legally represented; blank is valid for self-represented parties.",
    warnings: [
      "name-vs-lawyer field pairing (ordinal 5 vs 6) is a structural/positional inference from " +
        "field ordering, not confirmed by adjacent per-field text; both captions precede both fields."
    ]
  }),
  entry({
    semanticKey: "deponentFullLegalName",
    label: "Deponent's full legal name",
    description:
      "Evidence: immediately follows the caption 'My name is (full legal name)', within the " +
      "sworn declaration preamble. Evidence strength: DIRECT_LABEL. Classified SWORN_FACT: sworn " +
      "content asserted within the deponent's own oath, not case-administrative metadata.",
    technicalIdentity: { ordinal: 7, name: "", type: "text", tableDepth: 1, paragraphOrdinal: 37 },
    formSection: "Sworn/affirmed declaration preamble",
    semanticConstraints: { valueType: "PERSON_NAME", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
    technicalConstraints: { technicalType: "text", technicalMaxLength: 32000, technicalDropdownOptions: null, technicallyRequired: false },
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    applicability: "ALWAYS_APPLICABLE",
    permittedProvenance: ["USER_ENTERED", "PROFESSIONALLY_REVIEWED"],
    reviewSensitivity: "SWORN_FACT",
    mappingResolution: "HUMAN_MAPPED",
    notes:
      "Sworn content: permittedProvenance deliberately excludes MACHINE_SUGGESTED and " +
      "MATTER_DERIVED — matter-derived/machine-suggested data must never automatically become " +
      "sworn content (task constraints 11/21/27).",
    warnings: []
  }),
  entry({
    semanticKey: "deponentResidence",
    label: "Deponent's city/town/municipality (and province, state or country if outside Ontario) of residence",
    description:
      "Evidence: immediately follows the caption 'I live in: (name of city, town or municipality " +
      "and province, state or country if outside of Ontario)', within the same sworn preamble as " +
      "deponentFullLegalName. Evidence strength: DIRECT_LABEL. SWORN_FACT for the same reason.",
    technicalIdentity: { ordinal: 8, name: "", type: "text", tableDepth: 1, paragraphOrdinal: 39 },
    formSection: "Sworn/affirmed declaration preamble",
    semanticConstraints: { valueType: "TEXT", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
    technicalConstraints: { technicalType: "text", technicalMaxLength: 32000, technicalDropdownOptions: null, technicallyRequired: false },
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    applicability: "ALWAYS_APPLICABLE",
    permittedProvenance: ["USER_ENTERED", "PROFESSIONALLY_REVIEWED"],
    reviewSensitivity: "SWORN_FACT",
    mappingResolution: "HUMAN_MAPPED",
    notes: "Kept as generic TEXT rather than ADDRESS: the caption asks for city/municipality (+ province/state/country if outside Ontario), not a street address.",
    warnings: []
  })
];

// ---------------------------------------------------------------------------
// Repeated 4-column table sections (paragraphs 1-4). Each column is one recurring semanticKey
// with REPEATED cardinality. Column assignment is by reading-order position within each row of
// 4 cells, matched against the table's own column-heading row (the ONLY evidence available for
// per-cell meaning, since every cell shares the identical technical name "Text1" — see
// module-level note). Evidence strength: DIRECT_STRUCTURAL_CONTEXT for "this cell belongs to
// THIS table" (each table is unambiguously delimited by its own intro sentence + column headings,
// with no other field intervening), and STRUCTURAL_INFERENCE for "this cell is column N" (row-
// major positional reading, not a per-cell label).
// ---------------------------------------------------------------------------
interface RepeatedColumnDef {
  semanticKey: string;
  label: string;
  description: string;
  valueType: SemanticValueType;
}

function buildRepeatedSection(args: {
  paragraphOrdinals: readonly number[];
  ordinalStart: number;
  formSection: string;
  columns: readonly RepeatedColumnDef[]; // length 4
  applicability: ApplicabilityState;
  reviewSensitivity: ReviewSensitivityCategory;
  permittedProvenance: PermittedProvenanceClasses;
}): SemanticFieldMapEntry[] {
  const { paragraphOrdinals, ordinalStart, formSection, columns, applicability, reviewSensitivity, permittedProvenance } = args;
  return paragraphOrdinals.map((paragraphOrdinal, i) => {
    const col = columns[i % 4];
    const rowNumber = Math.floor(i / 4) + 1;
    return entry({
      semanticKey: col.semanticKey,
      label: `${col.label} (row ${rowNumber})`,
      description: col.description,
      technicalIdentity: {
        ordinal: ordinalStart + i,
        name: "Text1",
        type: "text",
        tableDepth: 1,
        paragraphOrdinal
      },
      formSection,
      semanticConstraints: { valueType: col.valueType, cardinality: "REPEATED", allowedValues: null, maxLength: 32000 },
      technicalConstraints: { technicalType: "text", technicalMaxLength: 32000, technicalDropdownOptions: null, technicallyRequired: false },
      legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
      applicability,
      permittedProvenance,
      reviewSensitivity,
      mappingResolution: "HUMAN_MAPPED",
      notes:
        "Duplicate technical name 'Text1' (frozen inventory anomaly, all 59 non-empty non-" +
        "CourtFileNo fields in this document share this one name). Column assignment is a " +
        "row-major structural-position inference against this table's 4 column headings, not a " +
        "per-cell label — see module-level note.",
      warnings: [
        "STRUCTURAL_INFERENCE: this cell's column (of 4) is inferred from row-major reading order " +
          "against the table's column headings, not from a per-cell label. Row/table membership " +
          "itself is DIRECT_STRUCTURAL_CONTEXT (delimited by this section's own intro sentence and " +
          "column-heading row, with no other field intervening)."
      ]
    });
  });
}

const SECTION1_PARAGRAPH_ORDINALS = [47, 48, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58, 59, 60, 61, 62];
const SECTION2_PARAGRAPH_ORDINALS = [69, 70, 71, 72, 73, 74, 75, 76, 77, 78, 79, 80, 81, 82, 83, 84];
const SECTION3_PARAGRAPH_ORDINALS = [100, 101, 102, 103, 104, 105, 106, 107, 108, 109, 110, 111];
const SECTION4_PARAGRAPH_ORDINALS = [118, 119, 120, 121, 122, 123, 124, 125, 126, 127, 128, 129];

// Paragraph 1 — "I am currently or I have been involved in the following child protection court
// cases" (deponent's OWN prior/current court cases). 4 rows.
const SECTION1_ENTRIES = buildRepeatedSection({
  paragraphOrdinals: SECTION1_PARAGRAPH_ORDINALS,
  ordinalStart: 9,
  formSection: "Paragraph 1 — deponent's own child protection court cases",
  applicability: "ALWAYS_APPLICABLE",
  reviewSensitivity: "SWORN_FACT",
  permittedProvenance: ["USER_ENTERED", "PROFESSIONALLY_REVIEWED"],
  columns: [
    {
      semanticKey: "ownCourtCaseNamesInvolved",
      label: "Names of people involved in the case",
      description:
        "Column 1 of paragraph 1's table, per the column heading 'Names of people involved in " +
        "the case'. Part of the sworn 'I swear/affirm that the following is true' declaration " +
        "covering the deponent's own prior child protection court cases.",
      valueType: "TEXT"
    },
    {
      semanticKey: "ownCourtCaseAgencyName",
      label: "Name of children's aid society",
      description: "Column 2, per the column heading \"Name of children's aid society\".",
      valueType: "TEXT"
    },
    {
      semanticKey: "ownCourtCaseLocation",
      label: "Court location",
      description: "Column 3, per the column heading 'Court location'.",
      valueType: "TEXT"
    },
    {
      semanticKey: "ownCourtCaseOrdersMade",
      label: "Court orders made (include dates of orders)",
      description:
        "Column 4, per the column heading 'Court orders made (include dates of orders)'. Kept as " +
        "FREE_TEXT_NARRATIVE, not a structured date field, since the caption asks for narrative " +
        "orders text with embedded dates, not a bare date.",
      valueType: "FREE_TEXT_NARRATIVE"
    }
  ]
});

// Paragraph 2 — "I have been involved with child protection services in the following way"
// (deponent's own service involvement). 4 rows.
const SECTION2_ENTRIES = buildRepeatedSection({
  paragraphOrdinals: SECTION2_PARAGRAPH_ORDINALS,
  ordinalStart: 25,
  formSection: "Paragraph 2 — deponent's own child protection service involvement",
  applicability: "ALWAYS_APPLICABLE",
  reviewSensitivity: "SWORN_FACT",
  permittedProvenance: ["USER_ENTERED", "PROFESSIONALLY_REVIEWED"],
  columns: [
    {
      semanticKey: "ownServiceNamesInvolved",
      label: "Names of other people involved",
      description: "Column 1, per the column heading 'Names of other people involved'.",
      valueType: "TEXT"
    },
    {
      semanticKey: "ownServiceAgencyName",
      label: "Name of children's aid society",
      description: "Column 2, per the column heading \"Name of children's aid society\".",
      valueType: "TEXT"
    },
    {
      semanticKey: "ownServiceAgencyLocation",
      label: "Location of children's aid society",
      description: "Column 3, per the column heading \"Location of children's aid society\".",
      valueType: "TEXT"
    },
    {
      semanticKey: "ownServiceDetails",
      label: "Child protection service(s) (include dates of any agreements or other measures)",
      description:
        "Column 4, per the column heading 'Child protection service(s) (include dates of any " +
        "agreements or other measures)'. Kept as FREE_TEXT_NARRATIVE, same reasoning as the " +
        "paragraph-1 orders column.",
      valueType: "FREE_TEXT_NARRATIVE"
    }
  ]
});

// Paragraph 3 — "To the best of my knowledge, the other party and/or the children in this case
// have been involved in the following child protection court cases" (about the OTHER party /
// children, not the deponent — explicitly hedged 'to the best of my knowledge'). 3 rows.
const SECTION3_ENTRIES = buildRepeatedSection({
  paragraphOrdinals: SECTION3_PARAGRAPH_ORDINALS,
  ordinalStart: 41,
  formSection: "Paragraph 3 — other party/children's child protection court cases (to deponent's knowledge)",
  applicability: "CONDITIONALLY_APPLICABLE",
  reviewSensitivity: "SWORN_FACT",
  permittedProvenance: ["USER_ENTERED", "PROFESSIONALLY_REVIEWED"],
  columns: [
    {
      semanticKey: "otherPartyCourtCaseNamesInvolved",
      label: "Names of people involved in the case",
      description:
        "Column 1, per the column heading 'Names of people involved in the case'. Governed by " +
        "the paragraph's own explicit hedge 'To the best of my knowledge' — this map does not " +
        "assert or imply certainty beyond that hedge; it only identifies the control.",
      valueType: "TEXT"
    },
    {
      semanticKey: "otherPartyCourtCaseAgencyName",
      label: "Name of children's aid society",
      description: "Column 2, per the column heading \"Name of children's aid society\".",
      valueType: "TEXT"
    },
    {
      semanticKey: "otherPartyCourtCaseLocation",
      label: "Court location",
      description: "Column 3, per the column heading 'Court location'.",
      valueType: "TEXT"
    },
    {
      semanticKey: "otherPartyCourtCaseOrdersMade",
      label: "Court orders made (include dates of orders)",
      description: "Column 4, per the column heading 'Court orders made (include dates of orders)'.",
      valueType: "FREE_TEXT_NARRATIVE"
    }
  ]
});

// Paragraph 4 — "To the best of my knowledge, the other party and/or the children in this case
// have been involved with child protection services in the following way". 3 rows.
const SECTION4_ENTRIES = buildRepeatedSection({
  paragraphOrdinals: SECTION4_PARAGRAPH_ORDINALS,
  ordinalStart: 53,
  formSection: "Paragraph 4 — other party/children's child protection service involvement (to deponent's knowledge)",
  applicability: "CONDITIONALLY_APPLICABLE",
  reviewSensitivity: "SWORN_FACT",
  permittedProvenance: ["USER_ENTERED", "PROFESSIONALLY_REVIEWED"],
  columns: [
    {
      semanticKey: "otherPartyServiceNamesInvolved",
      label: "Names of people involved",
      description:
        "Column 1, per the column heading 'Names of people involved'. Governed by paragraph 4's " +
        "own 'To the best of my knowledge' hedge, same as paragraph 3.",
      valueType: "TEXT"
    },
    {
      semanticKey: "otherPartyServiceAgencyName",
      label: "Name of children's aid society",
      description: "Column 2, per the column heading \"Name of children's aid society\".",
      valueType: "TEXT"
    },
    {
      semanticKey: "otherPartyServiceAgencyLocation",
      label: "Location of children's aid society",
      description: "Column 3, per the column heading \"Location of children's aid society\".",
      valueType: "TEXT"
    },
    {
      semanticKey: "otherPartyServiceDetails",
      label: "Child protection service(s) (include dates of any agreements or other measures)",
      description: "Column 4, per the column heading 'Child protection service(s) (include dates of any agreements or other measures)'.",
      valueType: "FREE_TEXT_NARRATIVE"
    }
  ]
});

// ---------------------------------------------------------------------------
// Jurat / commissioning block — ordinals 65..67. THE ONLY three technical fields in the entire
// jurat block. No technical field exists for the deponent's signature, the printed name if
// illegible, or the commissioner's identity/certification — those remain static blank lines in
// the document with no <w:ffData> control (confirmed by the same document.xml walk used for
// every other field in this module). This module does NOT fabricate a signature or commissioning-
// identity field for them (task constraint 12/13): they are simply absent from the 68-field
// technical inventory and therefore absent here too, by omission, not by a fabricated control.
// ---------------------------------------------------------------------------
const JURAT_ENTRIES: SemanticFieldMapEntry[] = [
  entry({
    semanticKey: "jurisdictionMunicipalityOfSwearing",
    label: "Municipality where the affidavit was sworn/affirmed",
    description:
      "Evidence: sits in the jurat clause 'Sworn/Affirmed before me at ___' with the caption " +
      "'Municipality' immediately following. Evidence strength: DIRECT_LABEL. Classified " +
      "COMMISSIONING_OR_CERTIFICATION: part of the commissioner's jurat clause, not ordinary " +
      "case-administrative data.",
    technicalIdentity: { ordinal: 65, name: "Text1", type: "text", tableDepth: 1, paragraphOrdinal: 132 },
    formSection: "Jurat / commissioning block",
    semanticConstraints: { valueType: "TEXT", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
    technicalConstraints: { technicalType: "text", technicalMaxLength: 32000, technicalDropdownOptions: null, technicallyRequired: false },
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    applicability: "ALWAYS_APPLICABLE",
    permittedProvenance: ["USER_ENTERED"],
    reviewSensitivity: "COMMISSIONING_OR_CERTIFICATION",
    mappingResolution: "HUMAN_MAPPED",
    notes:
      "Duplicate technical name 'Text1', but unambiguous by position: the only 'Text1' field " +
      "inside the jurat block at this paragraphOrdinal, immediately followed by the 'Municipality' " +
      "caption.",
    warnings: []
  }),
  entry({
    semanticKey: "jurisdictionProvinceOfSwearing",
    label: "Province, state, or country where the affidavit was sworn/affirmed",
    description:
      "Evidence: sits in the jurat clause '...in ___' with the caption 'province, state, or " +
      "country' immediately following. Evidence strength: DIRECT_LABEL. COMMISSIONING_OR_CERTIFICATION, same reasoning as ordinal 65.",
    technicalIdentity: { ordinal: 66, name: "Text1", type: "text", tableDepth: 1, paragraphOrdinal: 142 },
    formSection: "Jurat / commissioning block",
    semanticConstraints: { valueType: "TEXT", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
    technicalConstraints: { technicalType: "text", technicalMaxLength: 32000, technicalDropdownOptions: null, technicallyRequired: false },
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    applicability: "ALWAYS_APPLICABLE",
    permittedProvenance: ["USER_ENTERED"],
    reviewSensitivity: "COMMISSIONING_OR_CERTIFICATION",
    mappingResolution: "HUMAN_MAPPED",
    notes: "Duplicate technical name 'Text1'; unambiguous by position within the jurat block.",
    warnings: []
  }),
  entry({
    semanticKey: "dateOfSwearing",
    label: "Date the affidavit was sworn/affirmed",
    description:
      "Evidence: sits in the jurat clause '...on ___' immediately before the static 'Signature' / " +
      "'Date' / 'Commissioner for taking affidavits' labels that follow with NO further technical " +
      "field. Evidence strength: DIRECT_LABEL (the 'on ___' clause structure directly identifies " +
      "this as the swearing date; the separate static 'Date' caption further down the page is part " +
      "of the unfillable signature block, not a second technical field — see module-level note). " +
      "COMMISSIONING_OR_CERTIFICATION, same reasoning as ordinals 65-66.",
    technicalIdentity: { ordinal: 67, name: "Text1", type: "text", tableDepth: 1, paragraphOrdinal: 152 },
    formSection: "Jurat / commissioning block",
    semanticConstraints: { valueType: "DATE", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
    technicalConstraints: { technicalType: "text", technicalMaxLength: 32000, technicalDropdownOptions: null, technicallyRequired: false },
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    applicability: "ALWAYS_APPLICABLE",
    permittedProvenance: ["USER_ENTERED"],
    reviewSensitivity: "COMMISSIONING_OR_CERTIFICATION",
    mappingResolution: "HUMAN_MAPPED",
    notes:
      "This is the LAST technical field in the document. No technical field exists for the " +
      "deponent's signature, the printed name if illegible, or the commissioner's own identity — " +
      "confirmed absent from the real document.xml, not fabricated here (task constraint 12/13).",
    warnings: []
  })
];

// ---------------------------------------------------------------------------
// Full entry list — 68 entries, one per real technical field (9 header/preamble + 56 repeated
// table cells + 3 jurat). None UNRESOLVED: every field's table/section membership was
// establishable from its paragraphOrdinal falling within one clearly-delimited section, even
// where the fine-grained column assignment is only STRUCTURAL_INFERENCE.
// ---------------------------------------------------------------------------
export const FORM_351A_SEMANTIC_ENTRIES: readonly SemanticFieldMapEntry[] = [
  ...HEADER_ENTRIES,
  ...SECTION1_ENTRIES,
  ...SECTION2_ENTRIES,
  ...SECTION3_ENTRIES,
  ...SECTION4_ENTRIES,
  ...JURAT_ENTRIES
];

export const FORM_351A_SEMANTIC_FIELD_MAP: SemanticFieldMap = {
  binding: FORM_351A_EXACT_TEMPLATE_BINDING,
  mapVersionLabel: FORM_351A_MAP_VERSION_LABEL,
  entries: FORM_351A_SEMANTIC_ENTRIES
};

// ---------------------------------------------------------------------------
// Evidence-strength companion table (see module-level note above) — parsed out of each entry's
// own `description` text so it can never drift silently from the prose that a human reviewer
// actually reads; this is a derivation, not a second source of truth.
// ---------------------------------------------------------------------------
export function form351aEvidenceStrength(): readonly Form351aEvidenceRecord[] {
  return FORM_351A_SEMANTIC_ENTRIES.map(e => {
    let strength: EvidenceStrength = "UNRESOLVED";
    if (e.mappingResolution === "UNRESOLVED") strength = "UNRESOLVED";
    else if (e.description.includes("DIRECT_LABEL")) strength = "DIRECT_LABEL";
    else if (e.description.includes("DIRECT_STRUCTURAL_CONTEXT")) strength = "DIRECT_STRUCTURAL_CONTEXT";
    else if (e.description.includes("STRUCTURAL_INFERENCE") || e.warnings.some(w => w.includes("STRUCTURAL_INFERENCE"))) {
      strength = "STRUCTURAL_INFERENCE";
    }
    return { ordinal: e.technicalIdentity.ordinal, semanticKey: e.semanticKey, evidenceStrength: strength };
  });
}

// ---------------------------------------------------------------------------
// Coverage summary (computed, not hand-maintained) — used by tests/reporting.
// ---------------------------------------------------------------------------
export function form351aCoverageSummary(): {
  totalTechnicalFields: 68;
  mapped: number;
  unresolved: number;
  administrative: number;
  swornFact: number;
  signatureOrAttestation: number;
  commissioningOrCertification: number;
  directLabel: number;
  directStructuralContext: number;
  structuralInference: number;
} {
  const entries = FORM_351A_SEMANTIC_ENTRIES;
  const evidence = form351aEvidenceStrength();
  return {
    totalTechnicalFields: 68,
    mapped: entries.filter(e => e.mappingResolution !== "UNRESOLVED").length,
    unresolved: entries.filter(e => e.mappingResolution === "UNRESOLVED").length,
    administrative: entries.filter(e => e.reviewSensitivity === "NORMAL_ADMINISTRATIVE").length,
    swornFact: entries.filter(e => e.reviewSensitivity === "SWORN_FACT").length,
    signatureOrAttestation: entries.filter(e => e.reviewSensitivity === "SIGNATURE_OR_ATTESTATION").length,
    commissioningOrCertification: entries.filter(e => e.reviewSensitivity === "COMMISSIONING_OR_CERTIFICATION").length,
    directLabel: evidence.filter(e => e.evidenceStrength === "DIRECT_LABEL").length,
    directStructuralContext: evidence.filter(e => e.evidenceStrength === "DIRECT_STRUCTURAL_CONTEXT").length,
    structuralInference: evidence.filter(e => e.evidenceStrength === "STRUCTURAL_INFERENCE").length
  };
}
