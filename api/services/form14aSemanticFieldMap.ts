// Stage 9D-4B-2A-ii-b1 — REAL Form 14A (Affidavit (General)) semantic field map.
//
// SCOPE: this module maps the 13 real technical form-fields already inventoried in
// `docxFieldInventoryData.ts` (Stage 9D-4B-2A-i) to their WHAT-THE-CONTROL-REPRESENTS meaning,
// using the fail-closed type system and exact-template binding built in Stage 9D-4B-2A-ii-a
// (`semanticFieldMap.ts`). It is the FIRST real per-form map, and covers ONLY Form 14A.
//
// This module does NOT:
//   - populate word/document.xml or generate a completed Form 14A,
//   - write or suggest completion VALUES for any field (no CompletionDraftValue is created here),
//   - decide what a deponent should swear to, or how persuasive a statement is,
//   - mark any field LEGALLY_REQUIRED (all entries use the conservative default state), or
//   - map any of the other four controlled forms (8B, 33B.1, 33C, 35.1A) or the quarantined
//     Form 33B.
//
// EVIDENCE BASIS: every semantic key/label/rationale below is grounded in the real Form 14A
// document.xml text (visible labels, captions and headings adjacent to each FORMTEXT/FORMDROPDOWN
// field), extracted directly from the verified real DOCX artifact
// (/root/.claude/uploads/f5b74824-3969-5f04-a809-1a60f42bc26e/c01f056a-flr_14a_sept105_en_fil.docx,
// sha256 bfc552bf54c5972700759e455e5782e5cdec7f8affaa5e822e89e07681801261 — matches
// officialFormSourceManifest.ts's REAL_ARTIFACT_BYTE_VERIFICATIONS entry and
// docxFieldInventoryData.ts's Form 14A entry exactly), NOT from generic legal knowledge about
// affidavits. The observed reading-order text (captions immediately preceding/following each
// field's <w:ffData> block) was:
//
//   ONTARIO [Dropdown1: court-level dropdown] "Court File Number" [CourtFileNo]
//   "(Name of court)  Form 14A: Affidavit (general) dated" [Text1: ord.2] "at"
//   "Court office address" [Dated: ord.3]                       <- see rationale below re: ordering
//   "Applicant(s) Full legal name & address for service ... Lawyer's name & address ..."
//     [Text6: ord.4] [Text6: ord.5]
//   "Respondent(s) Full legal name & address for service ... Lawyer's name & address ..."
//     [Text6: ord.6] [Text6: ord.7]
//   "My name is (full legal name)" [Text3: ord.8]
//   "I live in (municipality & province)" [Text3: ord.9]
//   "and I swear/affirm that the following is true: [numbered-paragraph instructions]" [Text3: ord.10]
//   "Form 14A: Affidavit (general) dated (page 2) Court File Number [ref] [ref]" [Text3: ord.11]
//   "Put a line through any blank space left on this page. Sworn/Affirmed before me at
//    municipality in" [Text10: ord.12] "province, state, or country on Signature date
//    Commissioner for taking affidavits (Type or print name below if signature is illegible.)
//    (This form is to be signed in front of a lawyer, justice of the peace, notary public or
//    commissioner for taking affidavits.)"
//
// Note on ordinals 2/3 (Text1/Dated): the field NAMED "Dated" (ordinal 3) is the header's
// "dated ___" blank (strong evidence: the field's own w:name), and Text1 (ordinal 2, immediately
// followed by the "Court office address" caption) is the header's "at ___" blank. This is
// grounded in the field name for "Dated" and the immediately-adjacent caption for Text1 — not an
// assumption from generic affidavit knowledge.
//
// Note on ordinals 4/5 and 6/7 (Text6 x4, a frozen duplicate-name anomaly — see
// docxFieldInventoryData.ts anomalies.duplicateNames: ["Text6","Text3"]): both captions ("Full
// legal name & address for service..." and "Lawyer's name & address...") appear together BEFORE
// the first field of each pair, with no text between the two fields in each pair. The
// first-field/second-field = first-caption/second-caption pairing used below is a STRUCTURAL
// ordering inference (explicitly permitted evidence per the task's evidence rules — "field
// ordering, surrounding paragraph structure"), consistent with the standard two-column
// party-info/lawyer-info table layout used across Ontario family court forms of this vintage.
// It is flagged with an explicit `warnings` entry on each of those four entries rather than
// silently presented as certain, and marked HUMAN_MAPPED (not PROFESSIONALLY_REVIEWED).
import {
  buildExpectedBinding,
  TECHNICAL_INVENTORY_SCHEMA_VERSION,
  DEFAULT_LEGAL_REQUIREDNESS_STATE,
  type SemanticFieldMap,
  type SemanticFieldMapEntry,
  type ExactTemplateBinding
} from "./semanticFieldMap.js";

// ---------------------------------------------------------------------------
// Exact-template binding for the real, byte-verified Form 14A DOCX artifact.
// formId/formVersionId/templateId are internal identity strings (no live DB registration exists
// for Form 14A yet — none is created by this stage; see HANDOFF note on no-new-migration).
// ---------------------------------------------------------------------------
export const FORM_14A_SOURCE_SHA256_HEX =
  "bfc552bf54c5972700759e455e5782e5cdec7f8affaa5e822e89e07681801261";

export const FORM_14A_EXACT_TEMPLATE_BINDING: ExactTemplateBinding = buildExpectedBinding({
  formId: "official-form-14a",
  formNumber: "14A",
  formVersionId: "official-form-14a-version-sept-1-2005",
  versionLabel: "Sept. 1, 2005",
  templateId: "official-form-14a-template-docx-flr_14a_sept105_en_fil",
  sourceSha256Hex: FORM_14A_SOURCE_SHA256_HEX,
  technicalInventorySchemaVersion: TECHNICAL_INVENTORY_SCHEMA_VERSION
});

export const FORM_14A_MAP_VERSION_LABEL = "form14a-semantic-map-v1";

function entry(overrides: SemanticFieldMapEntry): SemanticFieldMapEntry {
  return overrides;
}

// ---------------------------------------------------------------------------
// The 13 real technical fields, each deliberately mapped or left UNRESOLVED. Accuracy over
// coverage: none of these is forced to a meaning beyond what the observed text supports.
// ---------------------------------------------------------------------------
export const FORM_14A_SEMANTIC_ENTRIES: readonly SemanticFieldMapEntry[] = [
  // ordinal 0 — Dropdown1 — court-level selector
  entry({
    semanticKey: "courtLevel",
    label: "Court level",
    description:
      "Which Ontario court the affidavit is filed in. Evidence: static 'ONTARIO' heading above the " +
      "dropdown, and the dropdown's own listEntries are exact Ontario court-level names (Ontario " +
      "Court of Justice / Superior Court of Justice / Superior Court of Justice Family Court " +
      "Branch), matching the 'ONTARIO [court level ▾]' heading convention on Ontario family court " +
      "forms.",
    technicalIdentity: { ordinal: 0, name: "Dropdown1", type: "dropdown", tableDepth: 1, paragraphOrdinal: 2 },
    formSection: "Header — court identification",
    semanticConstraints: {
      valueType: "ENUM",
      cardinality: "SINGLE",
      allowedValues: [
        "          ",
        "Ontario Court of Justice",
        "Superior Court of Justice",
        "Superior Court of Justice Family Court Branch"
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
        "Superior Court of Justice Family Court Branch"
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

  // ordinal 1 — CourtFileNo — court file number
  entry({
    semanticKey: "courtFileNumber",
    label: "Court file number",
    description:
      "The case's court file number. Evidence: the field's own w:name ('CourtFileNo') and the " +
      "'Court File Number' caption text immediately preceding it in the header table.",
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

  // ordinal 2 — Text1 — "at ___" location blank in the header, i.e. court office address
  entry({
    semanticKey: "courtOfficeAddress",
    label: "Court office address",
    description:
      "The court office location named in the affidavit heading ('Form 14A: Affidavit (general) " +
      "dated ___ at ___'). Evidence: the 'Court office address' caption appears immediately after " +
      "this field in document order, directly labelling it.",
    technicalIdentity: { ordinal: 2, name: "Text1", type: "text", tableDepth: 1, paragraphOrdinal: 10 },
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

  // ordinal 3 — Dated — header "dated ___" blank
  entry({
    semanticKey: "affidavitHeadingDate",
    label: "Affidavit heading date",
    description:
      "The date filled into the affidavit's own heading ('Form 14A: Affidavit (general) dated " +
      "___'). Evidence: the field's own w:name is literally 'Dated', and it sits within the same " +
      "heading clause as courtOfficeAddress. Distinct from any date on the jurat/commissioning " +
      "line (that line has no dedicated technical field — see ordinal 12 notes).",
    technicalIdentity: { ordinal: 3, name: "Dated", type: "text", tableDepth: 1, paragraphOrdinal: 16 },
    formSection: "Header — affidavit heading",
    semanticConstraints: { valueType: "DATE", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
    technicalConstraints: { technicalType: "text", technicalMaxLength: 32000, technicalDropdownOptions: null, technicallyRequired: false },
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    applicability: "ALWAYS_APPLICABLE",
    permittedProvenance: ["USER_ENTERED", "MATTER_DERIVED"],
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    mappingResolution: "HUMAN_MAPPED",
    notes: null,
    warnings: []
  }),

  // ordinal 4 — Text6 (1st of 4, duplicate name) — Applicant name & address for service
  entry({
    semanticKey: "applicantNameAndAddressForService",
    label: "Applicant's full legal name & address for service",
    description:
      "Evidence: sits under the 'Applicant(s)' heading, and is the FIRST of two fields following " +
      "the two captions 'Full legal name & address for service...' and 'Lawyer's name & " +
      "address...' (structural-ordering inference — see module-level note; not certain from text " +
      "alone).",
    technicalIdentity: { ordinal: 4, name: "Text6", type: "text", tableDepth: 1, paragraphOrdinal: 21 },
    formSection: "Applicant(s) — party identification block",
    semanticConstraints: { valueType: "TEXT", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
    technicalConstraints: { technicalType: "text", technicalMaxLength: 32000, technicalDropdownOptions: null, technicallyRequired: false },
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    applicability: "ALWAYS_APPLICABLE",
    permittedProvenance: ["USER_ENTERED", "MATTER_DERIVED"],
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    mappingResolution: "HUMAN_MAPPED",
    notes:
      "Combined name+address caption (no separate PERSON_NAME/ADDRESS fields exist for this " +
      "control) — semantic valueType kept as generic TEXT rather than overclaiming PERSON_NAME or " +
      "ADDRESS alone.",
    warnings: [
      "name/vs-lawyer field pairing (ordinal 4 vs 5) is a structural/positional inference from " +
        "field ordering, not confirmed by adjacent per-field text; both captions precede both fields."
    ]
  }),

  // ordinal 5 — Text6 (2nd) — Applicant's lawyer's name & address
  entry({
    semanticKey: "applicantLawyerNameAndAddress",
    label: "Applicant's lawyer's name & address",
    description:
      "Evidence: SECOND of the two 'Applicant(s)' fields (see ordinal-4 rationale); the second " +
      "caption in reading order is 'Lawyer's name & address...'.",
    technicalIdentity: { ordinal: 5, name: "Text6", type: "text", tableDepth: 1, paragraphOrdinal: 23 },
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
      "name/vs-lawyer field pairing (ordinal 4 vs 5) is a structural/positional inference from " +
        "field ordering, not confirmed by adjacent per-field text; both captions precede both fields."
    ]
  }),

  // ordinal 6 — Text6 (3rd) — Respondent name & address for service
  entry({
    semanticKey: "respondentNameAndAddressForService",
    label: "Respondent's full legal name & address for service",
    description:
      "Evidence: sits under the 'Respondent(s)' heading; FIRST of that section's two fields, by " +
      "the same structural-ordering inference used for the Applicant(s) block.",
    technicalIdentity: { ordinal: 6, name: "Text6", type: "text", tableDepth: 1, paragraphOrdinal: 31 },
    formSection: "Respondent(s) — party identification block",
    semanticConstraints: { valueType: "TEXT", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
    technicalConstraints: { technicalType: "text", technicalMaxLength: 32000, technicalDropdownOptions: null, technicallyRequired: false },
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    applicability: "ALWAYS_APPLICABLE",
    permittedProvenance: ["USER_ENTERED", "MATTER_DERIVED"],
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    mappingResolution: "HUMAN_MAPPED",
    notes:
      "Combined name+address caption — semantic valueType kept as generic TEXT, same reasoning as " +
      "ordinal 4.",
    warnings: [
      "name/vs-lawyer field pairing (ordinal 6 vs 7) is a structural/positional inference from " +
        "field ordering, not confirmed by adjacent per-field text; both captions precede both fields."
    ]
  }),

  // ordinal 7 — Text6 (4th) — Respondent's lawyer's name & address
  entry({
    semanticKey: "respondentLawyerNameAndAddress",
    label: "Respondent's lawyer's name & address",
    description:
      "Evidence: SECOND of the 'Respondent(s)' block's two fields (see ordinal-6 rationale).",
    technicalIdentity: { ordinal: 7, name: "Text6", type: "text", tableDepth: 1, paragraphOrdinal: 33 },
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
      "name/vs-lawyer field pairing (ordinal 6 vs 7) is a structural/positional inference from " +
        "field ordering, not confirmed by adjacent per-field text; both captions precede both fields."
    ]
  }),

  // ordinal 8 — Text3 (1st of 4, duplicate name) — deponent's full legal name
  entry({
    semanticKey: "deponentFullLegalName",
    label: "Deponent's full legal name",
    description:
      "Evidence: immediately follows the caption 'My name is (full legal name)', and is part of " +
      "the single sworn sentence 'My name is ___, I live in ___, and I swear/affirm that ___ is " +
      "true.' Classified SWORN_FACT (not merely NORMAL_ADMINISTRATIVE) because it is content " +
      "asserted within the deponent's own sworn/affirmed declaration, not case-administrative " +
      "metadata entered outside the oath.",
    technicalIdentity: { ordinal: 8, name: "Text3", type: "text", tableDepth: 1, paragraphOrdinal: 38 },
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
      "sworn content (this stage's constraint 8/20).",
    warnings: []
  }),

  // ordinal 9 — Text3 (2nd) — deponent's municipality & province of residence
  entry({
    semanticKey: "deponentMunicipalityAndProvince",
    label: "Deponent's municipality & province of residence",
    description:
      "Evidence: immediately follows the caption 'I live in (municipality & province)', within " +
      "the same sworn sentence as deponentFullLegalName (see ordinal-8 rationale). SWORN_FACT for " +
      "the same reason.",
    technicalIdentity: { ordinal: 9, name: "Text3", type: "text", tableDepth: 1, paragraphOrdinal: 40 },
    formSection: "Sworn/affirmed declaration preamble",
    semanticConstraints: { valueType: "TEXT", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
    technicalConstraints: { technicalType: "text", technicalMaxLength: 32000, technicalDropdownOptions: null, technicallyRequired: false },
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    applicability: "ALWAYS_APPLICABLE",
    permittedProvenance: ["USER_ENTERED", "PROFESSIONALLY_REVIEWED"],
    reviewSensitivity: "SWORN_FACT",
    mappingResolution: "HUMAN_MAPPED",
    notes:
      "Only municipality & province (not a full street address) per the caption text; kept as " +
      "generic TEXT rather than ADDRESS to avoid overclaiming a street-level address field.",
    warnings: []
  }),

  // ordinal 10 — Text3 (3rd) — statement of facts (numbered paragraphs), page 1
  entry({
    semanticKey: "statementOfFactsBody",
    label: "Statement of facts (numbered paragraphs)",
    description:
      "Evidence: immediately follows 'and I swear/affirm that the following is true:' plus the " +
      "form's own drafting instructions ('Set out the statements of fact in consecutively " +
      "numbered paragraphs...'). This is the affidavit's substantive sworn narrative content. " +
      "MAPPING ONLY — this module generates no content for this field; see module header.",
    technicalIdentity: { ordinal: 10, name: "Text3", type: "text", tableDepth: 1, paragraphOrdinal: 43 },
    formSection: "Statement of facts (numbered paragraphs)",
    semanticConstraints: { valueType: "FREE_TEXT_NARRATIVE", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
    technicalConstraints: { technicalType: "text", technicalMaxLength: 32000, technicalDropdownOptions: null, technicallyRequired: false },
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    applicability: "ALWAYS_APPLICABLE",
    permittedProvenance: ["USER_ENTERED", "PROFESSIONALLY_REVIEWED"],
    reviewSensitivity: "SWORN_FACT",
    mappingResolution: "HUMAN_MAPPED",
    notes:
      "The core sworn narrative field. permittedProvenance deliberately excludes MACHINE_SUGGESTED " +
      "and MATTER_DERIVED: matter-derived case data and machine-generated text must never " +
      "automatically become sworn fact content (constraint 8/20). This entry maps the CONTROL " +
      "only and asserts nothing about what content should be sworn (constraint 13).",
    warnings: []
  }),

  // ordinal 11 — Text3 (4th) — statement of facts continuation, page 2
  entry({
    semanticKey: "statementOfFactsContinuation",
    label: "Statement of facts — continuation (page 2)",
    description:
      "Evidence: appears after the page-2 repeat of the 'Form 14A: Affidavit (general) dated ' " +
      "heading and the REF CourtFileNo/Dated cross-references, and immediately before the page-2 " +
      "boilerplate instruction 'Put a line through any blank space left on this page' (a standard " +
      "continuation-page instruction). Classified as a continuation of the same sworn narrative, " +
      "not a separate statement.",
    technicalIdentity: { ordinal: 11, name: "Text3", type: "text", tableDepth: 1, paragraphOrdinal: 58 },
    formSection: "Statement of facts continuation (page 2)",
    semanticConstraints: { valueType: "FREE_TEXT_NARRATIVE", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
    technicalConstraints: { technicalType: "text", technicalMaxLength: 32000, technicalDropdownOptions: null, technicallyRequired: false },
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    applicability: "CONDITIONALLY_APPLICABLE",
    permittedProvenance: ["USER_ENTERED", "PROFESSIONALLY_REVIEWED"],
    reviewSensitivity: "SWORN_FACT",
    mappingResolution: "HUMAN_MAPPED",
    notes:
      "Only applicable when the numbered-paragraph statement overflows page 1. Same sworn-content " +
      "provenance restriction as statementOfFactsBody, for the same reason.",
    warnings: []
  }),

  // ordinal 12 — Text10 — jurat/commissioning: province, state, or country where sworn
  entry({
    semanticKey: "jurisdictionOfSwearing",
    label: "Province, state, or country where the affidavit was sworn/affirmed",
    description:
      "Evidence: sits in the jurat line 'Sworn/Affirmed before me at [municipality] in ___ " +
      "province, state, or country on [date] Signature ... Commissioner for taking affidavits'. " +
      "This is the ONLY technical field in the entire jurat/commissioning block — the municipality " +
      "blank, the date, the signature, and the commissioner's printed name are all blank lines in " +
      "the static document text with NO corresponding FORMTEXT/w:ffData control, so no signature " +
      "or commissioner-identity field exists to map (nothing is fabricated here). Classified " +
      "COMMISSIONING_OR_CERTIFICATION because it is part of the commissioner's jurat clause, not " +
      "ordinary case-administrative data.",
    technicalIdentity: { ordinal: 12, name: "Text10", type: "text", tableDepth: 1, paragraphOrdinal: 71 },
    formSection: "Jurat / commissioning block",
    semanticConstraints: { valueType: "TEXT", cardinality: "SINGLE", allowedValues: null, maxLength: null },
    technicalConstraints: { technicalType: "text", technicalMaxLength: null, technicalDropdownOptions: null, technicallyRequired: false },
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    applicability: "ALWAYS_APPLICABLE",
    permittedProvenance: ["USER_ENTERED"],
    reviewSensitivity: "COMMISSIONING_OR_CERTIFICATION",
    mappingResolution: "HUMAN_MAPPED",
    notes:
      "No technical field exists in this DOCX for the jurat municipality, the swearing date, the " +
      "deponent's signature, or the commissioner's printed name/identity — those remain blank " +
      "lines in the static template. This map does not invent controls for them; they are simply " +
      "absent from the 13-field technical inventory and therefore absent here too (protected by " +
      "omission, not by a fabricated 'signature field').",
    warnings: []
  })
];

export const FORM_14A_SEMANTIC_FIELD_MAP: SemanticFieldMap = {
  binding: FORM_14A_EXACT_TEMPLATE_BINDING,
  mapVersionLabel: FORM_14A_MAP_VERSION_LABEL,
  entries: FORM_14A_SEMANTIC_ENTRIES
};

// ---------------------------------------------------------------------------
// Coverage summary (computed, not hand-maintained) — used by tests/reporting.
// ---------------------------------------------------------------------------
export function form14aCoverageSummary(): {
  totalTechnicalFields: 13;
  mapped: number;
  unresolved: number;
  administrative: number;
  swornFact: number;
  signatureOrAttestation: number;
  commissioningOrCertification: number;
} {
  const entries = FORM_14A_SEMANTIC_ENTRIES;
  return {
    totalTechnicalFields: 13,
    mapped: entries.filter(e => e.mappingResolution !== "UNRESOLVED").length,
    unresolved: entries.filter(e => e.mappingResolution === "UNRESOLVED").length,
    administrative: entries.filter(e => e.reviewSensitivity === "NORMAL_ADMINISTRATIVE").length,
    swornFact: entries.filter(e => e.reviewSensitivity === "SWORN_FACT").length,
    signatureOrAttestation: entries.filter(e => e.reviewSensitivity === "SIGNATURE_OR_ATTESTATION").length,
    commissioningOrCertification: entries.filter(e => e.reviewSensitivity === "COMMISSIONING_OR_CERTIFICATION").length
  };
}
