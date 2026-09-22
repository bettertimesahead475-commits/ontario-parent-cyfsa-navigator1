// Stage 9D-4B-2A-ii-b3 — REAL Form 33C (Statement of Agreed Facts (Child Protection)) semantic
// field map.
//
// SCOPE: maps the 46 real technical form-fields already inventoried in
// `docxFieldInventoryData.ts` (Stage 9D-4B-2A-i) to their WHAT-THE-CONTROL-REPRESENTS meaning,
// using the fail-closed type system and exact-template binding built in Stage 9D-4B-2A-ii-a
// (`semanticFieldMap.ts`) and the map SHAPE established by the frozen Form 14A / Form 35.1A maps
// (`form14aSemanticFieldMap.ts`, `form351aSemanticFieldMap.ts`). This is the THIRD real per-form
// map and covers ONLY Form 33C. It does not modify, and is not derived by copying semantic
// assumptions from, either prior map — Form 33C was independently re-read from its own real
// document.xml (see evidence basis below). It does not map Form 8B or Form 33B.1, and does not
// touch the quarantined Form 33B.
//
// This module does NOT:
//   - populate word/document.xml or generate a completed Form 33C,
//   - write or suggest completion VALUES for any field (no CompletionDraftValue is created here),
//   - decide WHAT FACTS ARE AGREED, whether a fact is true, whether parties should agree, what
//     should be written, or what legal position should be taken,
//   - infer party agreement, or encode AGREED=true as any default/implicit property,
//   - mark any field LEGALLY_REQUIRED (all entries use the conservative default state), or
//   - map any of the other four controlled forms (8B, 33B.1, 35.1A) or Form 14A (frozen), or the
//     quarantined Form 33B.
//
// ---------------------------------------------------------------------------
// THE CENTRAL DOMAIN BOUNDARY FOR THIS FORM: AGREED FACT != FACT, AND PROVENANCE != AGREEMENT.
// ---------------------------------------------------------------------------
// Form 33C's own printed text (paragraphs 2-5, evidenced directly below) repeatedly and
// explicitly instructs drafters that content in those fields must represent unanimous party
// agreement ("this is a statement of AGREED FACTS... you must not set out something as a fact if
// another party disagrees with it... If there is no agreement at all... write 'No agreement
// reached.'"). That instruction is a fact ABOUT THE FORM's own drafting rules — it is evidence
// that these particular technical controls are WHERE agreed-fact/agreed-position content
// belongs, not evidence that any content placed there IS agreed, true, or should be agreed to.
// This map:
//   - identifies which technical controls represent agreed-fact/agreed-position content
//     (distinctly from ordinary administrative content — see AGREED-FACT MODEL below),
//   - never asserts, defaults, or infers that any specific value in those fields is agreed,
//   - never lets a field's own USER_ENTERED/MATTER_DERIVED/MACHINE_SUGGESTED/
//     PROFESSIONALLY_REVIEWED provenance stand in for agreement (provenance describes where a
//     candidate value CAME FROM; agreement is a separate human/legal event this stage does not
//     model or emit),
//   - generates no content and populates nothing.
//
// AGREED-FACT MODEL (architecture-gap check performed, no gap found — see task Step 4): the
// frozen `ReviewSensitivityCategory` enum in semanticFieldMap.ts has no field literally named
// "AGREED_FACT". It was read in full before concluding on this. Its eight members were designed
// around the sensitivity dimension "how consequential/reviewable is this content", not a
// provenance/agreement dimension — and three of its existing members are each independently a
// good structural fit for different agreed-content controls on THIS form, once combined with the
// deterministic `notes` field to record the human-readable "this represents agreed-fact content,
// not established fact" caveat (the closed type system already provides `notes: string | null`
// for exactly this kind of rationale — see `SemanticFieldMapEntry.notes`, which explicitly exists
// so nothing needs to be silently baked into a fabricated category):
//   - ADMISSION_OR_DENIAL — used for the agreed-narrative-fact controls (CAS prior involvement,
//     place-of-safety circumstances, important events). "Admission or denial" already captures a
//     party's own assertion of a state of affairs by consent (an admission), which is exactly
//     what a multi-party "statement of agreed facts" is: a joint admission, not sworn independent
//     testimony (there is no oath/jurat anywhere on this form; SWORN_FACT would be
//     misleading here) and not routine administrative metadata.
//   - LEGAL_GROUND_OR_POSITION — used for the "grounds for a protection finding" control
//     (paragraph 4), because the form's own text there is explicitly a legal-ground clause, not a
//     narrative-fact clause.
//   - REQUESTED_ORDER — used for the "order the parties agree would serve the child(ren)'s best
//     interests" control (paragraph 5), because the form's own text there is explicitly about the
//     ORDER sought, not a fact.
// Every one of these entries additionally carries an explicit `notes` string stating that the
// mapping identifies WHERE agreed-fact content belongs and does NOT assert agreement, truth, or a
// legal position — see constraint 7/19 in the task and the "AGREED FACT != FACT" tests in the
// companion test file. If a future stage concludes these three categories are insufficiently
// distinguishable from their ordinary (non-Form-33C) uses elsewhere, that is a legitimate
// follow-on finding for 2A-ii-a's owner to evaluate — but on the evidence available at this
// stage, forcing a wholly new frozen-type-system category was not necessary and was not done
// (constraint 34: no modification of frozen architecture in this task).
//
// EVIDENCE BASIS: every semantic key/label/rationale below is grounded in the real Form 33C
// document.xml text (visible labels, captions, table-column headings and headings adjacent to
// each FORMTEXT/FORMDROPDOWN field), extracted directly from the verified real DOCX artifact
// (/root/.claude/uploads/f5b74824-3969-5f04-a809-1a60f42bc26e/3bf6f793-form_33c_2018.docx,
// sha256 d73d4f9d8641616fe502ec0dd2f67511e424e69a1a7fff68015d403f5645407b — matches
// officialFormSourceManifest.ts's REAL_ARTIFACT_BYTE_VERIFICATIONS entry and
// docxFieldInventoryData.ts's Form 33C entry exactly), via a direct python XML walk of the real
// word/document.xml pairing each of the 46 <w:ffData> field blocks (in document order) with its
// immediately preceding/following <w:t> text runs — NOT from generic legal knowledge about
// child-protection agreements or from Form 14A/35.1A's own mapping choices.
//
// The observed reading-order text was:
//
//   ONTARIO [court-level dropdown, ord.0] Court File Number [ord.1, w:name="CourtFileNumber"]
//   (Name of court) Form 33C: Statement of Agreed Facts (Child Protection) at [ord.2] Court
//   office address
//   Applicant(s) [In most cases, the applicant will be a children's aid society.]
//     Full legal name & address for service... | Lawyer's name & address...
//     [ord.3] [ord.4]
//   Respondent(s) [In most cases, a respondent will be a "parent" within s.74 CYFSA 2017.]
//     Full legal name & address for service... | Lawyer's name & address...
//     [ord.5] [ord.6]
//   Children's Lawyer
//     Name & address of Children's Lawyer's agent for service... and name of person represented.
//     [ord.7]
//   THE PEOPLE SIGNING THIS AGREEMENT ARE: (Give full legal name. If you are a respondent, state
//   your relationship to the child(ren). If you are an employee of the children's aid society,
//   state your position within the society.)
//     Print or type full legal name | Relationship to child OR position within CAS | Signature |
//     Date of signature  — repeated for THREE signatories:
//     [ord.8,9,10] [ord.11,12,13] [ord.14,15,16]   (no technical field exists for the "Signature"
//     column itself in any of the three rows — a blank cell with no <w:ffData>, exactly the
//     Form 14A jurat pattern of not fabricating a signature control that the DOCX does not have)
//   1. The information about the child(ren) in this case is as follows: (Note that "parent" means
//      parent as defined in s.74 CYFSA 2017.)
//      Full legal name of first child: | Date of birth | Age | Sex
//      [ord.17,18,19,20]
//      Is the child a First Nations, Inuk, or Métis person? [ord.21]
//      Name of each of the child's bands and First Nations, Inuit, or Métis communities and their
//        representative(s) [ord.22]
//      If child was brought to a place of safety, address and identity of place from which the
//        child was removed [ord.23]
//      Full legal name(s) of child's parent(s) (List everyone who is a parent of the child as
//        defined in section 74 of the Child, Youth and Family Services Act, 2017) [ord.24]
//      — repeated identically for "second child" [ord.25-32] and "third child" [ord.33-40], then
//      "If there are more children, attach a sheet and number it."
//   2. The details of the children's aid society's previous involvement with one or more of these
//      children in this case are as follows: (Write "Nil" if no involvement... Please remember
//      that this is a statement of AGREED FACTS. That means that you must not set out something
//      as a fact if another party disagrees with it. If you cannot agree at all about anything,
//      write: "No agreement reached.") [ord.41]
//   3. The child(ren) was/were brought to a place of safety because: (If the child(ren) was/were
//      not brought to a place of safety, write "Nil". Again, there must be full agreement by all
//      parties. Any point on which there is disagreement must be excluded. If there is no
//      agreement at all on anything, write: "No agreement reached.") [ord.42]
//   4. We agree that the court should make a finding that the child(ren) is/are in need of
//      protection on the following reasons: (Use only the reasons listed on page 3 of the
//      application [form 8B]. Any reason on which there is disagreement must be excluded. If
//      there is no agreement at all, write: "No agreement reached." In any event, the court can
//      always make some other finding.) [ord.43]
//   4.1 The following important events relating to the child(ren)'s best interests have occurred
//      since the date this application began: [ord.44]
//   5. We agree that the order that would best serve the best interests of the child(ren) is:
//      (Again, list only the terms and conditions on which there is full agreement by all
//      parties. If there is no agreement at all, write: "No agreement reached." In any event, the
//      court is always free to make some other order...) [ord.45]
//   Put a line through any space left on this page.  (document ends — no jurat/commissioning
//      block exists on this form at all; it is a multi-party agreement, not a sworn affidavit)
//
// Note on the 45 empty-w:name fields (anomalies.emptyNamedFieldCount: 45; only ord.1 has a real
// w:name, "CourtFileNumber"): identity for all of these rests entirely on the full
// TechnicalFieldIdentity tuple (ordinal + type + tableDepth + paragraphOrdinal), never on name,
// exactly as the frozen type system requires. There are zero fully-unnamed fields
// (anomalies.unnamedFieldCount: 0) and zero duplicate w:names (anomalies.duplicateNames: []) on
// this form — every field has SOME name string, even if it is empty; this is a distinct anomaly
// shape from both Form 14A (duplicate non-empty names) and Form 35.1A (duplicate names +
// unnamed), and is recorded here rather than assumed to match either.
//
// Note on the paired/grouped fields (applicant/respondent name+lawyer pairs; the three signatory
// name+relationship+date rows; the four child-data columns x3 children): where TWO OR MORE
// captions precede TWO OR MORE fields with no disambiguating per-field caption, the field order =
// caption order pairing used below is a STRUCTURAL ordering inference (same class of evidence
// used in the Form 14A/35.1A maps for their own paired fields), flagged with an explicit
// `warnings` entry rather than presented as certain. Where a single caption immediately and
// uniquely precedes a single field with nothing else intervening (e.g. the Indigenous-status
// question, the band/community field, the place-of-safety field, each child's parents field, and
// all five numbered-paragraph agreed-content fields), that is direct structural context, not
// inference, and is described as such without a warning.
import {
  buildExpectedBinding,
  TECHNICAL_INVENTORY_SCHEMA_VERSION,
  DEFAULT_LEGAL_REQUIREDNESS_STATE,
  type SemanticFieldMap,
  type SemanticFieldMapEntry,
  type ExactTemplateBinding
} from "./semanticFieldMap.js";

// ---------------------------------------------------------------------------
// Exact-template binding for the real, byte-verified Form 33C DOCX artifact.
// formId/formVersionId/templateId are internal identity strings (no live DB registration exists
// for Form 33C yet — none is created by this stage; see HANDOFF note on no-new-migration).
// ---------------------------------------------------------------------------
export const FORM_33C_SOURCE_SHA256_HEX =
  "d73d4f9d8641616fe502ec0dd2f67511e424e69a1a7fff68015d403f5645407b";

export const FORM_33C_EXACT_TEMPLATE_BINDING: ExactTemplateBinding = buildExpectedBinding({
  formId: "official-form-33c",
  formNumber: "33C",
  formVersionId: "official-form-33c-version-2018",
  versionLabel: "2018",
  templateId: "official-form-33c-template-docx-form_33c_2018",
  sourceSha256Hex: FORM_33C_SOURCE_SHA256_HEX,
  technicalInventorySchemaVersion: TECHNICAL_INVENTORY_SCHEMA_VERSION
});

export const FORM_33C_MAP_VERSION_LABEL = "form33c-semantic-map-v1";

function entry(overrides: SemanticFieldMapEntry): SemanticFieldMapEntry {
  return overrides;
}

const AGREED_FACT_CAVEAT =
  "AGREED-FACT CONTENT — this control is where Form 33C's own text requires unanimous " +
  "party agreement before anything may be written here (the form instructs: write \"Nil\"/\"No " +
  "agreement reached\" rather than set out a disputed matter as fact). This mapping identifies " +
  "WHERE agreed-fact/agreed-position content belongs on the technical form; it does NOT assert " +
  "that any specific content IS agreed, true, or should be agreed to, and agreement is never the " +
  "default state of this field. A value's provenance (USER_ENTERED / MATTER_DERIVED / " +
  "MACHINE_SUGGESTED / PROFESSIONALLY_REVIEWED) never by itself establishes agreement — those are " +
  "orthogonal. No content is generated or suggested by this map.";

const genericText = { technicalType: "text" as const, technicalMaxLength: 32000, technicalDropdownOptions: null, technicallyRequired: false };

// ---------------------------------------------------------------------------
// The 46 real technical fields, each deliberately mapped or left UNRESOLVED. Accuracy over
// coverage: none of these is forced to a meaning beyond what the observed text supports. None was
// left UNRESOLVED for this form — every one of the 46 fields has an unambiguous nearest-caption
// or well-evidenced structural-pairing meaning (see per-entry `description`/`warnings`).
// ---------------------------------------------------------------------------
export const FORM_33C_SEMANTIC_ENTRIES: readonly SemanticFieldMapEntry[] = [
  // ordinal 0 — court-level dropdown
  entry({
    semanticKey: "courtLevel",
    label: "Court level",
    description:
      "Which Ontario court the statement of agreed facts is filed in. Evidence: static 'ONTARIO' " +
      "heading above the dropdown, and the dropdown's own listEntries are exact Ontario " +
      "court-level names.",
    technicalIdentity: { ordinal: 0, name: "", type: "dropdown", tableDepth: 1, paragraphOrdinal: 3 },
    formSection: "Header — court identification",
    semanticConstraints: {
      valueType: "ENUM",
      cardinality: "SINGLE",
      allowedValues: ["          ", "Superior Court of Justice", "Superior Court of Justice, Family Court", "Ontario Court of Justice"],
      maxLength: null
    },
    technicalConstraints: {
      technicalType: "dropdown",
      technicalMaxLength: null,
      technicalDropdownOptions: ["          ", "Superior Court of Justice", "Superior Court of Justice, Family Court", "Ontario Court of Justice"],
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

  // ordinal 1 — CourtFileNumber
  entry({
    semanticKey: "courtFileNumber",
    label: "Court file number",
    description:
      "The case's court file number. Evidence: the field's own w:name ('CourtFileNumber') and " +
      "the 'Court File Number' caption immediately preceding it.",
    technicalIdentity: { ordinal: 1, name: "CourtFileNumber", type: "text", tableDepth: 1, paragraphOrdinal: 6 },
    formSection: "Header — court identification",
    semanticConstraints: { valueType: "COURT_FILE_NUMBER", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
    technicalConstraints: genericText,
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    applicability: "ALWAYS_APPLICABLE",
    permittedProvenance: ["USER_ENTERED", "MATTER_DERIVED"],
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    mappingResolution: "HUMAN_MAPPED",
    notes: null,
    warnings: []
  }),

  // ordinal 2 — court office address ("at ___")
  entry({
    semanticKey: "courtOfficeAddress",
    label: "Court office address",
    description:
      "The court office location named in the heading ('Form 33C: Statement of Agreed Facts " +
      "(Child Protection) ... at ___'). Evidence: the 'Court office address' caption immediately " +
      "follows this field in document order.",
    technicalIdentity: { ordinal: 2, name: "", type: "text", tableDepth: 1, paragraphOrdinal: 12 },
    formSection: "Header — heading",
    semanticConstraints: { valueType: "ADDRESS", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
    technicalConstraints: genericText,
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    applicability: "ALWAYS_APPLICABLE",
    permittedProvenance: ["USER_ENTERED", "MATTER_DERIVED"],
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    mappingResolution: "HUMAN_MAPPED",
    notes: null,
    warnings: []
  }),

  // ordinal 3 — Applicant name & address for service
  entry({
    semanticKey: "applicantNameAndAddressForService",
    label: "Applicant's full legal name & address for service",
    description:
      "Evidence: sits under the 'Applicant(s)' heading ('In most cases, the applicant will be a " +
      "children's aid society.'); FIRST of that section's two fields, by structural-ordering " +
      "inference (both captions — name/address and lawyer's name/address — precede both fields).",
    technicalIdentity: { ordinal: 3, name: "", type: "text", tableDepth: 1, paragraphOrdinal: 23 },
    formSection: "Applicant(s) — party identification block",
    semanticConstraints: { valueType: "TEXT", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
    technicalConstraints: genericText,
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    applicability: "ALWAYS_APPLICABLE",
    permittedProvenance: ["USER_ENTERED", "MATTER_DERIVED"],
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    mappingResolution: "HUMAN_MAPPED",
    notes: "Combined name+address caption — semantic valueType kept generic TEXT rather than overclaiming PERSON_NAME/ADDRESS alone.",
    warnings: ["name/vs-lawyer field pairing (ordinal 3 vs 4) is a structural/positional inference from field ordering; both captions precede both fields."]
  }),

  // ordinal 4 — Applicant's lawyer's name & address
  entry({
    semanticKey: "applicantLawyerNameAndAddress",
    label: "Applicant's lawyer's name & address",
    description: "Evidence: SECOND of the 'Applicant(s)' block's two fields (see ordinal-3 rationale).",
    technicalIdentity: { ordinal: 4, name: "", type: "text", tableDepth: 1, paragraphOrdinal: 25 },
    formSection: "Applicant(s) — party identification block",
    semanticConstraints: { valueType: "TEXT", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
    technicalConstraints: genericText,
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    applicability: "CONDITIONALLY_APPLICABLE",
    permittedProvenance: ["USER_ENTERED", "MATTER_DERIVED"],
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    mappingResolution: "HUMAN_MAPPED",
    notes: "Only applicable when the applicant is legally represented.",
    warnings: ["name/vs-lawyer field pairing (ordinal 3 vs 4) is a structural/positional inference from field ordering; both captions precede both fields."]
  }),

  // ordinal 5 — Respondent name & address for service
  entry({
    semanticKey: "respondentNameAndAddressForService",
    label: "Respondent's full legal name & address for service",
    description:
      "Evidence: sits under the 'Respondent(s)' heading ('In most cases, a respondent will be a " +
      "\"parent\" within the meaning of section 74 of the Child, Youth and Family Services Act, " +
      "2017.'); FIRST of that section's two fields, by the same structural-ordering inference " +
      "used for the Applicant(s) block.",
    technicalIdentity: { ordinal: 5, name: "", type: "text", tableDepth: 1, paragraphOrdinal: 30 },
    formSection: "Respondent(s) — party identification block",
    semanticConstraints: { valueType: "TEXT", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
    technicalConstraints: genericText,
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    applicability: "ALWAYS_APPLICABLE",
    permittedProvenance: ["USER_ENTERED", "MATTER_DERIVED"],
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    mappingResolution: "HUMAN_MAPPED",
    notes: "Combined name+address caption — same reasoning as ordinal 3.",
    warnings: ["name/vs-lawyer field pairing (ordinal 5 vs 6) is a structural/positional inference from field ordering; both captions precede both fields."]
  }),

  // ordinal 6 — Respondent's lawyer's name & address
  entry({
    semanticKey: "respondentLawyerNameAndAddress",
    label: "Respondent's lawyer's name & address",
    description: "Evidence: SECOND of the 'Respondent(s)' block's two fields (see ordinal-5 rationale).",
    technicalIdentity: { ordinal: 6, name: "", type: "text", tableDepth: 1, paragraphOrdinal: 32 },
    formSection: "Respondent(s) — party identification block",
    semanticConstraints: { valueType: "TEXT", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
    technicalConstraints: genericText,
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    applicability: "CONDITIONALLY_APPLICABLE",
    permittedProvenance: ["USER_ENTERED", "MATTER_DERIVED"],
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    mappingResolution: "HUMAN_MAPPED",
    notes: "Only applicable when the respondent is legally represented.",
    warnings: ["name/vs-lawyer field pairing (ordinal 5 vs 6) is a structural/positional inference from field ordering; both captions precede both fields."]
  }),

  // ordinal 7 — Children's Lawyer agent for service
  entry({
    semanticKey: "childrensLawyerAgentNameAndAddress",
    label: "Name & address of Children's Lawyer's agent for service, and name of person represented",
    description:
      "Evidence: sits directly under the 'Children's Lawyer' heading, immediately following the " +
      "single caption 'Name & address of Children's Lawyer's agent for service ... and name of " +
      "person represented.' — single caption, single field, no ambiguity.",
    technicalIdentity: { ordinal: 7, name: "", type: "text", tableDepth: 1, paragraphOrdinal: 35 },
    formSection: "Children's Lawyer",
    semanticConstraints: { valueType: "TEXT", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
    technicalConstraints: genericText,
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    applicability: "CONDITIONALLY_APPLICABLE",
    permittedProvenance: ["USER_ENTERED", "MATTER_DERIVED"],
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    mappingResolution: "HUMAN_MAPPED",
    notes: "Only applicable when a Children's Lawyer is appointed/involved in the case.",
    warnings: []
  }),

  // ordinals 8-16 — three signatory rows (name, relationship/position, date of signature)
  ...(["One", "Two", "Three"] as const).flatMap((slot, i) => {
    const base = 8 + i * 3;
    const paragraphOrdinals = [
      [40, 41, 45],
      [50, 51, 55],
      [60, 61, 65]
    ][i];
    return [
      entry({
        semanticKey: `signatory${slot}FullLegalName`,
        label: `Signatory ${i + 1} — full legal name`,
        description:
          "Evidence: under 'THE PEOPLE SIGNING THIS AGREEMENT ARE:' and its instruction '(Give " +
          "full legal name. If you are a respondent, state your relationship to the child(ren). " +
          "If you are an employee of the children's aid society, state your position within the " +
          "society.)'; FIRST of the row's two captioned fields ('Print or type full legal name' " +
          "precedes 'Relationship to child OR position within children's aid society'), by " +
          "structural-ordering inference. A third column, 'Signature', has NO corresponding " +
          "technical field on this form (blank cell, no <w:ffData> — nothing fabricated here).",
        technicalIdentity: { ordinal: base, name: "", type: "text", tableDepth: 1, paragraphOrdinal: paragraphOrdinals[0] },
        formSection: "THE PEOPLE SIGNING THIS AGREEMENT ARE",
        semanticConstraints: { valueType: "PERSON_NAME", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
        technicalConstraints: genericText,
        legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
        applicability: i === 0 ? "ALWAYS_APPLICABLE" : "CONDITIONALLY_APPLICABLE",
        permittedProvenance: ["USER_ENTERED"],
        reviewSensitivity: "SIGNATURE_OR_ATTESTATION",
        mappingResolution: "HUMAN_MAPPED",
        notes:
          i === 0
            ? "At least one signatory row is expected to be completed; additional rows are conditional on additional signatories."
            : "Conditional on this signatory slot being used; the form provides three rows but does not require all three to be filled.",
        warnings: ["name/vs-relationship field pairing within this signatory row is a structural/positional inference from field ordering."]
      }),
      entry({
        semanticKey: `signatory${slot}RelationshipOrPosition`,
        label: `Signatory ${i + 1} — relationship to child or position within children's aid society`,
        description: "Evidence: SECOND of the signatory row's two captioned fields (see companion FullLegalName entry rationale).",
        technicalIdentity: { ordinal: base + 1, name: "", type: "text", tableDepth: 1, paragraphOrdinal: paragraphOrdinals[1] },
        formSection: "THE PEOPLE SIGNING THIS AGREEMENT ARE",
        semanticConstraints: { valueType: "TEXT", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
        technicalConstraints: genericText,
        legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
        applicability: i === 0 ? "ALWAYS_APPLICABLE" : "CONDITIONALLY_APPLICABLE",
        permittedProvenance: ["USER_ENTERED"],
        reviewSensitivity: "SIGNATURE_OR_ATTESTATION",
        mappingResolution: "HUMAN_MAPPED",
        notes: "Single field serves both possible captions ('relationship to child' for a respondent, or 'position within the society' for a CAS employee) — the form does not distinguish them with separate controls.",
        warnings: ["name/vs-relationship field pairing within this signatory row is a structural/positional inference from field ordering."]
      }),
      entry({
        semanticKey: `signatory${slot}DateOfSignature`,
        label: `Signatory ${i + 1} — date of signature`,
        description:
          "Evidence: the row's two column headers are 'Signature' and 'Date of signature'; only " +
          "ONE technical field exists for this row (under the 'Date of signature' column — the " +
          "'Signature' column cell has no <w:ffData>, consistent with a wet-ink signature line and " +
          "no fabricated signature control, matching the Form 14A jurat pattern).",
        technicalIdentity: { ordinal: base + 2, name: "", type: "text", tableDepth: 1, paragraphOrdinal: paragraphOrdinals[2] },
        formSection: "THE PEOPLE SIGNING THIS AGREEMENT ARE",
        semanticConstraints: { valueType: "DATE", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
        technicalConstraints: genericText,
        legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
        applicability: i === 0 ? "ALWAYS_APPLICABLE" : "CONDITIONALLY_APPLICABLE",
        permittedProvenance: ["USER_ENTERED"],
        reviewSensitivity: "SIGNATURE_OR_ATTESTATION",
        mappingResolution: "HUMAN_MAPPED",
        notes:
          "No technical field exists for the 'Signature' column itself in this row — it remains a " +
          "blank line in the static template. This map does not invent a control for it (protected " +
          "by omission, not by a fabricated signature field); do not simulate/populate signatures.",
        warnings: []
      })
    ];
  }),

  // ordinals 17-40 — three children's data blocks (name, DOB, age, sex, indigenous status, band,
  // place-of-safety, parents), each block structurally identical
  ...(["One", "Two", "Three"] as const).flatMap((slot, i) => {
    const base = 17 + i * 8;
    const po = [
      [92, 93, 94, 95, 99, 103, 107, 111],
      [119, 120, 121, 122, 126, 130, 134, 138],
      [146, 147, 148, 149, 153, 157, 161, 165]
    ][i];
    const ordinalWord = ["first", "second", "third"][i];
    return [
      entry({
        semanticKey: `child${slot}FullLegalName`,
        label: `Child ${i + 1} — full legal name`,
        description:
          `Evidence: under numbered paragraph 1 ('The information about the child(ren) in this ` +
          `case is as follows:'), immediately after the caption 'Full legal name of ${ordinalWord} ` +
          `child:'. FIRST of a 4-column row (name/DOB/age/sex captions all precede all 4 fields), ` +
          `by structural-ordering inference.`,
        technicalIdentity: { ordinal: base, name: "", type: "text", tableDepth: 1, paragraphOrdinal: po[0] },
        formSection: "1. Information about the child(ren)",
        semanticConstraints: { valueType: "PERSON_NAME", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
        technicalConstraints: genericText,
        legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
        applicability: i === 0 ? "ALWAYS_APPLICABLE" : "CONDITIONALLY_APPLICABLE",
        permittedProvenance: ["USER_ENTERED", "MATTER_DERIVED"],
        reviewSensitivity: "NORMAL_ADMINISTRATIVE",
        mappingResolution: "HUMAN_MAPPED",
        notes:
          i === 0
            ? "At least one child is expected in every child-protection agreement; the form's own text says 'If there are more children, attach a sheet and number it', so this template provides exactly 3 child slots as a fixed (not open-ended) structure."
            : `Conditional on there being a ${ordinalWord} child in this case.`,
        warnings: ["4-column (name/DOB/age/sex) pairing is a structural/positional inference from field ordering."]
      }),
      entry({
        semanticKey: `child${slot}DateOfBirth`,
        label: `Child ${i + 1} — date of birth`,
        description: "Evidence: SECOND of the 4-column child-data row (see companion FullLegalName rationale).",
        technicalIdentity: { ordinal: base + 1, name: "", type: "text", tableDepth: 1, paragraphOrdinal: po[1] },
        formSection: "1. Information about the child(ren)",
        semanticConstraints: { valueType: "DATE", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
        technicalConstraints: genericText,
        legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
        applicability: i === 0 ? "ALWAYS_APPLICABLE" : "CONDITIONALLY_APPLICABLE",
        permittedProvenance: ["USER_ENTERED", "MATTER_DERIVED"],
        reviewSensitivity: "NORMAL_ADMINISTRATIVE",
        mappingResolution: "HUMAN_MAPPED",
        notes: `Conditional on there being a ${ordinalWord} child in this case.`,
        warnings: ["4-column (name/DOB/age/sex) pairing is a structural/positional inference from field ordering."]
      }),
      entry({
        semanticKey: `child${slot}Age`,
        label: `Child ${i + 1} — age`,
        description: "Evidence: THIRD of the 4-column child-data row (see companion FullLegalName rationale).",
        technicalIdentity: { ordinal: base + 2, name: "", type: "text", tableDepth: 1, paragraphOrdinal: po[2] },
        formSection: "1. Information about the child(ren)",
        semanticConstraints: { valueType: "NUMBER", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
        technicalConstraints: genericText,
        legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
        applicability: i === 0 ? "ALWAYS_APPLICABLE" : "CONDITIONALLY_APPLICABLE",
        permittedProvenance: ["USER_ENTERED", "MATTER_DERIVED"],
        reviewSensitivity: "NORMAL_ADMINISTRATIVE",
        mappingResolution: "HUMAN_MAPPED",
        notes: `Conditional on there being a ${ordinalWord} child in this case.`,
        warnings: ["4-column (name/DOB/age/sex) pairing is a structural/positional inference from field ordering."]
      }),
      entry({
        semanticKey: `child${slot}Sex`,
        label: `Child ${i + 1} — sex`,
        description: "Evidence: FOURTH/last of the 4-column child-data row (see companion FullLegalName rationale).",
        technicalIdentity: { ordinal: base + 3, name: "", type: "text", tableDepth: 1, paragraphOrdinal: po[3] },
        formSection: "1. Information about the child(ren)",
        semanticConstraints: { valueType: "TEXT", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
        technicalConstraints: genericText,
        legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
        applicability: i === 0 ? "ALWAYS_APPLICABLE" : "CONDITIONALLY_APPLICABLE",
        permittedProvenance: ["USER_ENTERED", "MATTER_DERIVED"],
        reviewSensitivity: "NORMAL_ADMINISTRATIVE",
        mappingResolution: "HUMAN_MAPPED",
        notes: `Conditional on there being a ${ordinalWord} child in this case. Free-text field on this form — not constrained to an enumerated set (no dropdown options exist here).`,
        warnings: ["4-column (name/DOB/age/sex) pairing is a structural/positional inference from field ordering."]
      }),
      entry({
        semanticKey: `child${slot}IndigenousStatus`,
        label: `Child ${i + 1} — is the child a First Nations, Inuk, or Métis person?`,
        description:
          "Evidence: single caption 'Is the child a First Nations, Inuk, or Métis person?' " +
          "immediately and uniquely precedes this single field — direct structural context, not " +
          "an inference from pairing.",
        technicalIdentity: { ordinal: base + 4, name: "", type: "text", tableDepth: 1, paragraphOrdinal: po[4] },
        formSection: "1. Information about the child(ren)",
        semanticConstraints: { valueType: "TEXT", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
        technicalConstraints: genericText,
        legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
        applicability: i === 0 ? "ALWAYS_APPLICABLE" : "CONDITIONALLY_APPLICABLE",
        permittedProvenance: ["USER_ENTERED", "MATTER_DERIVED"],
        reviewSensitivity: "NORMAL_ADMINISTRATIVE",
        mappingResolution: "HUMAN_MAPPED",
        notes:
          `Conditional on there being a ${ordinalWord} child in this case. Sensitive personal/cultural-identity information about the child; no dedicated sensitivity category exists in the frozen type system for cultural-identity data specifically, so this is classified NORMAL_ADMINISTRATIVE (identifying data, not agreed-fact narrative content) rather than overclaiming a mismatched category — flagged here for awareness. Free-text field despite the yes/no phrasing (no dropdown/checkbox control exists for this question on this form).`,
        warnings: []
      }),
      entry({
        semanticKey: `child${slot}BandOrCommunityNames`,
        label: `Child ${i + 1} — name of each of the child's bands and First Nations, Inuit, or Métis communities and their representative(s)`,
        description:
          "Evidence: single caption immediately and uniquely precedes this single field — direct structural context.",
        technicalIdentity: { ordinal: base + 5, name: "", type: "text", tableDepth: 1, paragraphOrdinal: po[5] },
        formSection: "1. Information about the child(ren)",
        semanticConstraints: { valueType: "FREE_TEXT_NARRATIVE", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
        technicalConstraints: genericText,
        legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
        applicability: i === 0 ? "CONDITIONALLY_APPLICABLE" : "CONDITIONALLY_APPLICABLE",
        permittedProvenance: ["USER_ENTERED", "MATTER_DERIVED"],
        reviewSensitivity: "NORMAL_ADMINISTRATIVE",
        mappingResolution: "HUMAN_MAPPED",
        notes: `Conditional on the child having applicable band/community affiliation and this being a ${ordinalWord}-child case.`,
        warnings: []
      }),
      entry({
        semanticKey: `child${slot}PlaceOfSafetyDetails`,
        label: `Child ${i + 1} — if brought to a place of safety, address and identity of place from which the child was removed`,
        description:
          "Evidence: single caption 'If child was brought to a place of safety, address and " +
          "identity of place from which the child was removed' immediately and uniquely precedes " +
          "this single field — direct structural context.",
        technicalIdentity: { ordinal: base + 6, name: "", type: "text", tableDepth: 1, paragraphOrdinal: po[6] },
        formSection: "1. Information about the child(ren)",
        semanticConstraints: { valueType: "TEXT", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
        technicalConstraints: genericText,
        legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
        applicability: "CONDITIONALLY_APPLICABLE",
        permittedProvenance: ["USER_ENTERED", "MATTER_DERIVED"],
        reviewSensitivity: "NORMAL_ADMINISTRATIVE",
        mappingResolution: "HUMAN_MAPPED",
        notes: `Conditional on the child having been brought to a place of safety AND on this being a ${ordinalWord}-child case; caption implies this is blank/not-applicable otherwise.`,
        warnings: []
      }),
      entry({
        semanticKey: `child${slot}ParentsFullLegalNames`,
        label: `Child ${i + 1} — full legal name(s) of the child's parent(s)`,
        description:
          "Evidence: single caption 'Full legal name(s) of child's parent(s) (List everyone who " +
          "is a parent of the child as defined in section 74 of the Child, Youth and Family " +
          "Services Act, 2017)' immediately and uniquely precedes this single field — direct " +
          "structural context.",
        technicalIdentity: { ordinal: base + 7, name: "", type: "text", tableDepth: 1, paragraphOrdinal: po[7] },
        formSection: "1. Information about the child(ren)",
        semanticConstraints: { valueType: "FREE_TEXT_NARRATIVE", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
        technicalConstraints: genericText,
        legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
        applicability: i === 0 ? "ALWAYS_APPLICABLE" : "CONDITIONALLY_APPLICABLE",
        permittedProvenance: ["USER_ENTERED", "MATTER_DERIVED"],
        reviewSensitivity: "NORMAL_ADMINISTRATIVE",
        mappingResolution: "HUMAN_MAPPED",
        notes: `Conditional on there being a ${ordinalWord} child in this case. "Parent" here has the specific CYFSA s.74 statutory meaning named in the caption, not a lay meaning — this map records that fact about the label; it does not itself apply or interpret the statute.`,
        warnings: []
      })
    ];
  }),

  // ordinal 41 — paragraph 2: CAS prior involvement (AGREED-FACT narrative)
  entry({
    semanticKey: "casPriorInvolvementAgreedNarrative",
    label: "Children's aid society's previous involvement with the child(ren) — agreed narrative",
    description:
      "Evidence: immediately follows numbered paragraph 2's full caption: 'The details of the " +
      "children's aid society's previous involvement with one or more of these children in this " +
      "case are as follows: (Write \"Nil\" if no involvement. Indicate any involvement with " +
      "children's aid society in another part of Ontario or a child protection agency outside " +
      "Ontario. Please remember that this is a statement of AGREED FACTS. That means that you " +
      "must not set out something as a fact if another party disagrees with it. If you cannot " +
      "agree at all about anything, write: \"No agreement reached.\")'. Single caption, single " +
      "field — direct structural context, and the strongest available textual evidence on this " +
      "form for the AGREED-FACT classification (see AGREED-FACT MODEL above).",
    technicalIdentity: { ordinal: 41, name: "", type: "text", tableDepth: 1, paragraphOrdinal: 183 },
    formSection: "2. CAS prior involvement (agreed facts)",
    semanticConstraints: { valueType: "FREE_TEXT_NARRATIVE", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
    technicalConstraints: genericText,
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    applicability: "ALWAYS_APPLICABLE",
    permittedProvenance: ["USER_ENTERED", "PROFESSIONALLY_REVIEWED"],
    reviewSensitivity: "ADMISSION_OR_DENIAL",
    mappingResolution: "HUMAN_MAPPED",
    notes: AGREED_FACT_CAVEAT + " permittedProvenance deliberately excludes MACHINE_SUGGESTED and MATTER_DERIVED: matter-derived case-record data and machine-generated text must never automatically become agreed-fact content (constraints 8/10/11/20-23).",
    warnings: []
  }),

  // ordinal 42 — paragraph 3: reasons brought to a place of safety (AGREED-FACT narrative)
  entry({
    semanticKey: "placeOfSafetyReasonsAgreedNarrative",
    label: "Reasons the child(ren) was/were brought to a place of safety — agreed narrative",
    description:
      "Evidence: immediately follows numbered paragraph 3's full caption: 'The child(ren) " +
      "was/were brought to a place of safety because: (If the child(ren) was/were not brought to " +
      "a place of safety, write \"Nil\". Again, there must be full agreement by all parties. Any " +
      "point on which there is disagreement must be excluded. If there is no agreement at all on " +
      "anything, write: \"No agreement reached.\")'. Single caption, single field.",
    technicalIdentity: { ordinal: 42, name: "", type: "text", tableDepth: 1, paragraphOrdinal: 189 },
    formSection: "3. Reasons brought to a place of safety (agreed facts)",
    semanticConstraints: { valueType: "FREE_TEXT_NARRATIVE", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
    technicalConstraints: genericText,
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    applicability: "ALWAYS_APPLICABLE",
    permittedProvenance: ["USER_ENTERED", "PROFESSIONALLY_REVIEWED"],
    reviewSensitivity: "ADMISSION_OR_DENIAL",
    mappingResolution: "HUMAN_MAPPED",
    notes: AGREED_FACT_CAVEAT + " Caption itself instructs writing 'Nil' when not applicable, so this field is always present on the form (its content, not its existence, is conditional).",
    warnings: []
  }),

  // ordinal 43 — paragraph 4: grounds for a protection finding (AGREED legal-ground position)
  entry({
    semanticKey: "protectionFindingGroundsAgreed",
    label: "Agreed grounds for a finding the child(ren) is/are in need of protection",
    description:
      "Evidence: immediately follows numbered paragraph 4's full caption: 'We agree that the " +
      "court should make a finding that the child(ren) is/are in need of protection on the " +
      "following reasons: (Use only the reasons listed on page 3 of the application [form 8B]. " +
      "Any reason on which there is disagreement must be excluded. If there is no agreement at " +
      "all, write: \"No agreement reached.\" In any event, the court can always make some other " +
      "finding.)'. Single caption, single field. Classified LEGAL_GROUND_OR_POSITION rather than " +
      "ADMISSION_OR_DENIAL because the caption's own language ('finding that the child(ren) " +
      "is/are in need of protection ... reasons') is explicitly a statutory-ground clause, not a " +
      "narrative-fact clause, and explicitly cross-references Form 8B's own grounds list.",
    technicalIdentity: { ordinal: 43, name: "", type: "text", tableDepth: 1, paragraphOrdinal: 195 },
    formSection: "4. Agreed grounds for a protection finding",
    semanticConstraints: { valueType: "FREE_TEXT_NARRATIVE", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
    technicalConstraints: genericText,
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    applicability: "ALWAYS_APPLICABLE",
    permittedProvenance: ["USER_ENTERED", "PROFESSIONALLY_REVIEWED"],
    reviewSensitivity: "LEGAL_GROUND_OR_POSITION",
    mappingResolution: "HUMAN_MAPPED",
    notes: AGREED_FACT_CAVEAT + " This is a legal-ground/position clause, not merely a fact clause — doubly excluded from machine/matter-derived provenance for that reason as well as the agreed-fact reason. This map takes no position on which reasons in Form 8B apply, or whether the parties should agree to any (constraint 19).",
    warnings: []
  }),

  // ordinal 44 — paragraph 4.1: important events since application began (AGREED-FACT narrative)
  entry({
    semanticKey: "importantEventsSinceApplicationAgreed",
    label: "Important events relating to the child(ren)'s best interests since the application began — agreed narrative",
    description:
      "Evidence: immediately follows the caption '4.1 The following important events relating to " +
      "the child(ren)'s best interests have occurred since the date this application began:'. " +
      "Single caption, single field. Same document (the numbered-paragraph 'agreed facts' " +
      "sequence) as ordinals 41/42, so treated with the same AGREED-FACT classification even " +
      "though this particular caption does not repeat the 'write Nil/No agreement reached' " +
      "wording verbatim — it is textually and structurally part of the same agreed-facts numbered " +
      "sequence (paragraph 4.1 is a sub-clause of paragraph 4's 'WE AGREE' framing, not a separate, " +
      "unrelated administrative field).",
    technicalIdentity: { ordinal: 44, name: "", type: "text", tableDepth: 1, paragraphOrdinal: 199 },
    formSection: "4.1 Important events since the application began (agreed facts)",
    semanticConstraints: { valueType: "FREE_TEXT_NARRATIVE", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
    technicalConstraints: genericText,
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    applicability: "ALWAYS_APPLICABLE",
    permittedProvenance: ["USER_ENTERED", "PROFESSIONALLY_REVIEWED"],
    reviewSensitivity: "ADMISSION_OR_DENIAL",
    mappingResolution: "HUMAN_MAPPED",
    notes: AGREED_FACT_CAVEAT,
    warnings: ["Classification as AGREED-FACT content is a structural inference from this field's position within the numbered-paragraph agreed-facts sequence (immediately after paragraph 4's 'We agree...' clause), not from an exact repetition of the 'Nil'/'No agreement reached' wording used in paragraphs 2/3/5."]
  }),

  // ordinal 45 — paragraph 5: agreed proposed order (AGREED requested-order position)
  entry({
    semanticKey: "proposedOrderAgreedPosition",
    label: "Order the parties agree would best serve the best interests of the child(ren)",
    description:
      "Evidence: immediately follows numbered paragraph 5's full caption: 'We agree that the " +
      "order that would best serve the best interests of the child(ren) is: (Again, list only the " +
      "terms and conditions on which there is full agreement by all parties. If there is no " +
      "agreement at all, write: \"No agreement reached.\" In any event, the court is always free " +
      "to make some other order. If the order on which you all agree would remove the child(ren) " +
      "from the care of the person who had the child(ren) before the case started, explain why " +
      "less disruptive options would not be enough to protect the child(ren).)'. This is the last " +
      "field on the document (nothing follows it except the boilerplate 'Put a line through any " +
      "space left on this page.'). Classified REQUESTED_ORDER (not ADMISSION_OR_DENIAL) because " +
      "its own text is explicitly about the ORDER sought, not an underlying fact.",
    technicalIdentity: { ordinal: 45, name: "", type: "text", tableDepth: 1, paragraphOrdinal: 205 },
    formSection: "5. Agreed proposed order",
    semanticConstraints: { valueType: "FREE_TEXT_NARRATIVE", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
    technicalConstraints: genericText,
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    applicability: "ALWAYS_APPLICABLE",
    permittedProvenance: ["USER_ENTERED", "PROFESSIONALLY_REVIEWED"],
    reviewSensitivity: "REQUESTED_ORDER",
    mappingResolution: "HUMAN_MAPPED",
    notes:
      AGREED_FACT_CAVEAT +
      " This field represents an AGREED POSITION on the order sought, not a fact — it is kept " +
      "distinct from the ADMISSION_OR_DENIAL / LEGAL_GROUND_OR_POSITION fields above precisely so " +
      "'agreed order' is never confused with 'agreed fact' (constraint 19: no position is taken " +
      "here on what order should be sought).",
    warnings: []
  })
];

export const FORM_33C_SEMANTIC_FIELD_MAP: SemanticFieldMap = {
  binding: FORM_33C_EXACT_TEMPLATE_BINDING,
  mapVersionLabel: FORM_33C_MAP_VERSION_LABEL,
  entries: FORM_33C_SEMANTIC_ENTRIES
};

// ---------------------------------------------------------------------------
// Coverage summary (computed, not hand-maintained) — used by tests/reporting.
// ---------------------------------------------------------------------------
export function form33cCoverageSummary(): {
  totalTechnicalFields: 46;
  mapped: number;
  unresolved: number;
  administrative: number;
  agreedFactContent: number;
  signatureOrAttestation: number;
  swornFact: number;
} {
  const entries = FORM_33C_SEMANTIC_ENTRIES;
  const agreedFactKeys = new Set(["ADMISSION_OR_DENIAL", "LEGAL_GROUND_OR_POSITION", "REQUESTED_ORDER"]);
  return {
    totalTechnicalFields: 46,
    mapped: entries.filter(e => e.mappingResolution !== "UNRESOLVED").length,
    unresolved: entries.filter(e => e.mappingResolution === "UNRESOLVED").length,
    administrative: entries.filter(e => e.reviewSensitivity === "NORMAL_ADMINISTRATIVE").length,
    agreedFactContent: entries.filter(e => agreedFactKeys.has(e.reviewSensitivity)).length,
    signatureOrAttestation: entries.filter(e => e.reviewSensitivity === "SIGNATURE_OR_ATTESTATION").length,
    swornFact: entries.filter(e => e.reviewSensitivity === "SWORN_FACT").length
  };
}
