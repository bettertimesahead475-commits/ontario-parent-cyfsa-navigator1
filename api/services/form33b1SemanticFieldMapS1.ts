// Stage 9D-4B-2A-ii-b5B — Form 33B.1 (Answer and Plan of Care) SEMANTIC FIELD MAP.
//
// SCOPE: complete, authoritative 169-control semantic field mapping for Form 33B.1.
// Connects the frozen structural manifest (`form33b1StructuralManifest.ts`) and frozen decision
// boundaries (`form33b1DecisionBoundaries.ts`) to exact semantic field identities, purposes,
// constraints, review sensitivities, and permitted provenance rules.
//
// FROZEN BASELINE HEAD: cf37fe233f0238495543e58bdc56c5096a9c8fb1
// Source SHA256: 79d718a2de8be55001b47649a34366613b7050a69f98dfb6a4fd394870908a6e

import {
  buildExpectedBinding,
  TECHNICAL_INVENTORY_SCHEMA_VERSION,
  DEFAULT_LEGAL_REQUIREDNESS_STATE,
  type SemanticFieldMap,
  type SemanticFieldMapEntry,
  type ExactTemplateBinding,
  type SemanticValueType,
  type ApplicabilityState,
  type PermittedProvenanceClasses,
  type TechnicalFieldIdentity,
  type ReviewSensitivityCategory
} from "./semanticFieldMap.js";
import {
  FORM_33B1_STRUCTURAL_MANIFEST,
  FORM_33B1_TOTAL_TECHNICAL_CONTROLS,
  type Form33B1StructuralSection,
  type Form33B1RepeatedGroup
} from "./form33b1StructuralManifest.js";
import {
  FORM_33B1_DECISION_BOUNDARIES,
  type Form33B1DecisionCategory,
  type Form33B1Sensitivity
} from "./form33b1DecisionBoundaries.js";
import { DOCX_FIELD_INVENTORIES } from "./docxFieldInventoryData.js";

export const FORM_33B1_SOURCE_SHA256_HEX =
  "79d718a2de8be55001b47649a34366613b7050a69f98dfb6a4fd394870908a6e";

export const FORM_33B1_EXACT_TEMPLATE_BINDING: ExactTemplateBinding = buildExpectedBinding({
  formId: "official-form-33b1",
  formNumber: "33B.1",
  formVersionId: "official-form-33b1-version-dec-2020",
  versionLabel: "December 2020",
  templateId: "official-form-33b1-template-docx-form-33b-1-en-dec20",
  sourceSha256Hex: FORM_33B1_SOURCE_SHA256_HEX,
  technicalInventorySchemaVersion: TECHNICAL_INVENTORY_SCHEMA_VERSION
});

export const FORM_33B1_MAP_VERSION_LABEL = "form33b1-semantic-map-v1";
export const FORM_33B1_SLICE1_MAP_VERSION_LABEL = FORM_33B1_MAP_VERSION_LABEL;

export const FORM_33B1_ORDINAL_RANGE = {
  startOrdinal: 0,
  endOrdinal: 168,
  count: 169
} as const;
export const FORM_33B1_SLICE1_ORDINAL_RANGE = FORM_33B1_ORDINAL_RANGE;

export interface Form33B1SemanticEntry extends SemanticFieldMapEntry {
  ordinal: number;
  stableTechnicalId: string;
  structuralSection: Form33B1StructuralSection;
  repeatedGroupId: Form33B1RepeatedGroup | null;
  repeatedGroupIndex: number | null;
  decisionCategory: Form33B1DecisionCategory;
  boundarySensitivity: Form33B1Sensitivity;
  requiresExplicitAuthorization: boolean;
  requiresUnansweredState: boolean;
}
export type Form33B1Slice1SemanticEntry = Form33B1SemanticEntry;

const frozenInv = DOCX_FIELD_INVENTORIES.find(f => f.formNumber === "33B.1")!;
if (!frozenInv) {
  throw new Error("Missing frozen DOCX field inventory for Form 33B.1");
}

function resolveReviewSensitivity(
  boundarySensitivity: Form33B1Sensitivity,
  decisionCategory: Form33B1DecisionCategory,
  structuralSection: Form33B1StructuralSection
): ReviewSensitivityCategory {
  if (boundarySensitivity === "SIGNATURE_OR_ATTESTATION") {
    return "SIGNATURE_OR_ATTESTATION";
  }
  if (decisionCategory === "ALLEGATION_RESPONSE") {
    return "ADMISSION_OR_DENIAL";
  }
  if (decisionCategory === "PLAN_OF_CARE_COMMITMENT") {
    return "PLAN_OF_CARE_POSITION";
  }
  if (decisionCategory === "REQUESTED_ORDER") {
    return "REQUESTED_ORDER";
  }
  return "NORMAL_ADMINISTRATIVE";
}

const entries: Form33B1SemanticEntry[] = [];

function createSemanticEntry(args: {
  ordinal: number;
  semanticKey: string;
  label: string;
  description: string;
  valueType: SemanticValueType;
  applicability: ApplicabilityState;
  notes?: string | null;
  warnings?: string[];
}): Form33B1SemanticEntry {
  const { ordinal, semanticKey, label, description, valueType, applicability, notes, warnings } = args;

  const struct = FORM_33B1_STRUCTURAL_MANIFEST[ordinal];
  const boundary = FORM_33B1_DECISION_BOUNDARIES[ordinal];
  const rawField = frozenInv.fields[ordinal];

  if (!struct || !boundary || !rawField) {
    throw new Error(`Incomplete frozen definitions for ordinal ${ordinal}`);
  }

  if (struct.ordinal !== ordinal || boundary.ordinal !== ordinal || rawField.order !== ordinal) {
    throw new Error(`Ordinal mismatch at index ${ordinal}`);
  }

  const technicalIdentity: TechnicalFieldIdentity = {
    ordinal: rawField.order,
    name: rawField.name,
    type: rawField.type,
    tableDepth: rawField.tableDepth,
    paragraphOrdinal: rawField.paragraphOrdinal
  };

  const isDropdown = rawField.type === "dropdown";
  const isCheckbox = rawField.type === "checkbox";
  const dropdownOptions = rawField.dropdown?.listEntries ?? null;

  const reviewSensitivity = resolveReviewSensitivity(
    boundary.sensitivity,
    boundary.decisionCategory,
    struct.structuralSection
  );

  const entry: Form33B1SemanticEntry = {
    semanticKey,
    label,
    description,
    technicalIdentity,
    formSection: struct.structuralSection,
    semanticConstraints: {
      valueType: isCheckbox ? "BOOLEAN" : valueType,
      cardinality: "SINGLE",
      allowedValues: isDropdown ? dropdownOptions : null,
      maxLength: isDropdown || isCheckbox ? null : (rawField.maxLength ?? 32000)
    },
    technicalConstraints: {
      technicalType: rawField.type,
      technicalMaxLength: isDropdown || isCheckbox ? null : rawField.maxLength,
      technicalDropdownOptions: dropdownOptions,
      technicallyRequired: false
    },
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    applicability,
    permittedProvenance: boundary.permittedAuthorityClasses as PermittedProvenanceClasses,
    reviewSensitivity,
    mappingResolution: "HUMAN_MAPPED",
    notes: notes ?? null,
    warnings: warnings ?? [],
    ordinal: struct.ordinal,
    stableTechnicalId: struct.stableTechnicalId,
    structuralSection: struct.structuralSection,
    repeatedGroupId: struct.repeatedGroupId,
    repeatedGroupIndex: struct.repeatedGroupIndex,
    decisionCategory: boundary.decisionCategory,
    boundarySensitivity: boundary.sensitivity,
    requiresExplicitAuthorization: boundary.requiresExplicitAuthorization,
    requiresUnansweredState: boundary.requiresUnansweredState
  };

  return Object.freeze(entry);
}

// ---------------------------------------------------------------------------
// 1. COURT_ADMINISTRATION (Ordinals 0..1) — 2 controls
// ---------------------------------------------------------------------------
entries.push(
  createSemanticEntry({
    ordinal: 0,
    semanticKey: "form33b1.court.courtName",
    label: "Court location / court level",
    description: "Ontario court location dropdown menu.",
    valueType: "ENUM",
    applicability: "ALWAYS_APPLICABLE",
    notes: "First entry in dropdown is empty padding string."
  }),
  createSemanticEntry({
    ordinal: 1,
    semanticKey: "form33b1.court.fileNumber",
    label: "Court file number",
    description: "Court file number blank field.",
    valueType: "COURT_FILE_NUMBER",
    applicability: "ALWAYS_APPLICABLE"
  })
);

// ---------------------------------------------------------------------------
// 2. PARTY_IDENTIFICATION (Ordinals 2..16) — 15 controls
// ---------------------------------------------------------------------------
entries.push(
  createSemanticEntry({
    ordinal: 2,
    semanticKey: "form33b1.party.applicantName",
    label: "Applicant full legal name",
    description: "Full legal name of the applicant party (typically Children's Aid Society).",
    valueType: "PERSON_NAME",
    applicability: "ALWAYS_APPLICABLE"
  }),
  createSemanticEntry({
    ordinal: 3,
    semanticKey: "form33b1.party.answeringPartyName",
    label: "Answering party full legal name",
    description: "Full legal name of the answering party filling Form 33B.1.",
    valueType: "PERSON_NAME",
    applicability: "ALWAYS_APPLICABLE"
  }),
  createSemanticEntry({
    ordinal: 4,
    semanticKey: "form33b1.party.answeringPartyAddress",
    label: "Answering party address for service",
    description: "Address for service of the answering party.",
    valueType: "ADDRESS",
    applicability: "ALWAYS_APPLICABLE"
  }),
  createSemanticEntry({
    ordinal: 5,
    semanticKey: "form33b1.party.answeringPartyPhone",
    label: "Answering party telephone number",
    description: "Telephone number of the answering party.",
    valueType: "TEXT",
    applicability: "ALWAYS_APPLICABLE"
  }),
  createSemanticEntry({
    ordinal: 6,
    semanticKey: "form33b1.party.answeringPartyEmail",
    label: "Answering party email address",
    description: "Email address of the answering party.",
    valueType: "TEXT",
    applicability: "ALWAYS_APPLICABLE"
  }),
  createSemanticEntry({
    ordinal: 7,
    semanticKey: "form33b1.party.relationshipToChild",
    label: "Answering party relationship to child(ren)",
    description: "Relationship of the answering party to the child or children.",
    valueType: "TEXT",
    applicability: "ALWAYS_APPLICABLE"
  }),
  createSemanticEntry({
    ordinal: 8,
    semanticKey: "form33b1.party.lawyerName",
    label: "Lawyer name",
    description: "Name of the answering party's lawyer.",
    valueType: "PERSON_NAME",
    applicability: "CONDITIONALLY_APPLICABLE"
  }),
  createSemanticEntry({
    ordinal: 9,
    semanticKey: "form33b1.party.lawyerAddress",
    label: "Lawyer address for service",
    description: "Address for service of lawyer.",
    valueType: "ADDRESS",
    applicability: "CONDITIONALLY_APPLICABLE"
  }),
  createSemanticEntry({
    ordinal: 10,
    semanticKey: "form33b1.party.lawyerPhone",
    label: "Lawyer telephone number",
    description: "Telephone number of lawyer.",
    valueType: "TEXT",
    applicability: "CONDITIONALLY_APPLICABLE"
  }),
  createSemanticEntry({
    ordinal: 11,
    semanticKey: "form33b1.party.lawyerFax",
    label: "Lawyer fax number",
    description: "Fax number of lawyer.",
    valueType: "TEXT",
    applicability: "CONDITIONALLY_APPLICABLE"
  }),
  createSemanticEntry({
    ordinal: 12,
    semanticKey: "form33b1.party.lawyerEmail",
    label: "Lawyer email address",
    description: "Email address of lawyer.",
    valueType: "TEXT",
    applicability: "CONDITIONALLY_APPLICABLE"
  }),
  createSemanticEntry({
    ordinal: 13,
    semanticKey: "form33b1.party.childNameLine",
    label: "Header context: child name",
    description: "Child name header line.",
    valueType: "PERSON_NAME",
    applicability: "ALWAYS_APPLICABLE"
  }),
  createSemanticEntry({
    ordinal: 14,
    semanticKey: "form33b1.party.caseNumberLine",
    label: "Header context: case number",
    description: "Case number header line.",
    valueType: "COURT_FILE_NUMBER",
    applicability: "ALWAYS_APPLICABLE"
  }),
  createSemanticEntry({
    ordinal: 15,
    semanticKey: "form33b1.party.hearingDateLine",
    label: "Header context: hearing date",
    description: "Hearing date header line.",
    valueType: "DATE",
    applicability: "ALWAYS_APPLICABLE"
  }),
  createSemanticEntry({
    ordinal: 16,
    semanticKey: "form33b1.party.courtLocationLine",
    label: "Header context: court location",
    description: "Court location header line.",
    valueType: "TEXT",
    applicability: "ALWAYS_APPLICABLE"
  })
);

// ---------------------------------------------------------------------------
// 3. CHILD_IDENTIFICATION (Ordinals 17..40) — 24 controls (3 slots x 8 attrs)
// ---------------------------------------------------------------------------
const childAttributeSpecs: {
  attr: string;
  label: string;
  valueType: SemanticValueType;
}[] = [
  { attr: "fullName", label: "full legal name", valueType: "PERSON_NAME" },
  { attr: "dob", label: "date of birth", valueType: "DATE" },
  { attr: "sex", label: "sex", valueType: "TEXT" },
  { attr: "residence", label: "residence", valueType: "ADDRESS" },
  { attr: "schoolGrade", label: "school / grade", valueType: "TEXT" },
  { attr: "specialNeeds", label: "special needs / medical details", valueType: "FREE_TEXT_NARRATIVE" },
  { attr: "indigenousStatus", label: "Indigenous status (First Nations, Inuk, Métis)", valueType: "TEXT" },
  { attr: "bandCommunity", label: "band or Indigenous community", valueType: "TEXT" }
];

for (let slot = 0; slot < 3; slot++) {
  for (let a = 0; a < 8; a++) {
    const ord = 17 + slot * 8 + a;
    const spec = childAttributeSpecs[a];
    entries.push(
      createSemanticEntry({
        ordinal: ord,
        semanticKey: `form33b1.child[${slot}].${spec.attr}`,
        label: `Child slot ${slot + 1} — ${spec.label}`,
        description: `Child slot ${slot + 1} ${spec.attr} field`,
        valueType: spec.valueType,
        applicability: slot === 0 ? "ALWAYS_APPLICABLE" : "CONDITIONALLY_APPLICABLE",
        notes: `Child slot index ${slot}, attribute ${spec.attr}.`
      })
    );
  }
}

// ---------------------------------------------------------------------------
// 4. RESPONSE_TO_APPLICATION_CLAIMS (Ordinals 41..112) — 72 text controls
// ---------------------------------------------------------------------------
for (let i = 0; i < 72; i++) {
  const ord = 41 + i;
  const slotNum = i + 1;
  entries.push(
    createSemanticEntry({
      ordinal: ord,
      semanticKey: `form33b1.response.paragraphSlot${slotNum}`,
      label: `Response to application claim paragraph slot ${slotNum}`,
      description: `Text response block for applicant claim paragraph ${slotNum}.`,
      valueType: "FREE_TEXT_NARRATIVE",
      applicability: "CONDITIONALLY_APPLICABLE",
      notes: "Requires explicit human authorization. UNANSWERED state must be preserved when absent."
    })
  );
}

// ---------------------------------------------------------------------------
// 5. PLAN_OF_CARE_PROPOSAL (Ordinals 113..146) — 34 controls
// ---------------------------------------------------------------------------
entries.push(
  createSemanticEntry({
    ordinal: 113,
    semanticKey: "form33b1.planOfCare.placementParent",
    label: "Plan of care proposal: placement with parent",
    description: "Checkbox slot for placement proposal option 1 (parent).",
    valueType: "BOOLEAN",
    applicability: "CONDITIONALLY_APPLICABLE",
    notes: "Requires explicit human authorization."
  }),
  createSemanticEntry({
    ordinal: 114,
    semanticKey: "form33b1.planOfCare.placementRelative",
    label: "Plan of care proposal: placement with relative / family member",
    description: "Checkbox slot for placement proposal option 2 (relative).",
    valueType: "BOOLEAN",
    applicability: "CONDITIONALLY_APPLICABLE",
    notes: "Requires explicit human authorization."
  }),
  createSemanticEntry({
    ordinal: 115,
    semanticKey: "form33b1.planOfCare.placementOther",
    label: "Plan of care proposal: placement with other person",
    description: "Checkbox slot for placement proposal option 3 (other).",
    valueType: "BOOLEAN",
    applicability: "CONDITIONALLY_APPLICABLE",
    notes: "Requires explicit human authorization."
  }),
  createSemanticEntry({
    ordinal: 116,
    semanticKey: "form33b1.planOfCare.placementDetail",
    label: "Plan of care proposal: placement terms detail narrative",
    description: "Plan of care placement terms detail narrative.",
    valueType: "FREE_TEXT_NARRATIVE",
    applicability: "CONDITIONALLY_APPLICABLE",
    notes: "Requires explicit human authorization."
  }),
  createSemanticEntry({
    ordinal: 117,
    semanticKey: "form33b1.planOfCare.supervisionOption1",
    label: "Plan of care proposal: supervision condition option 1",
    description: "Checkbox slot for supervision condition option 1.",
    valueType: "BOOLEAN",
    applicability: "CONDITIONALLY_APPLICABLE",
    notes: "Requires explicit human authorization."
  }),
  createSemanticEntry({
    ordinal: 118,
    semanticKey: "form33b1.planOfCare.supervisionOption2",
    label: "Plan of care proposal: supervision condition option 2",
    description: "Checkbox slot for supervision condition option 2.",
    valueType: "BOOLEAN",
    applicability: "CONDITIONALLY_APPLICABLE",
    notes: "Requires explicit human authorization."
  }),
  createSemanticEntry({
    ordinal: 119,
    semanticKey: "form33b1.planOfCare.supervisionOption3",
    label: "Plan of care proposal: supervision condition option 3",
    description: "Checkbox slot for supervision condition option 3.",
    valueType: "BOOLEAN",
    applicability: "CONDITIONALLY_APPLICABLE",
    notes: "Requires explicit human authorization."
  }),
  createSemanticEntry({
    ordinal: 120,
    semanticKey: "form33b1.planOfCare.supervisionDetail",
    label: "Plan of care proposal: supervision detail narrative",
    description: "Plan of care supervision order terms detail narrative.",
    valueType: "FREE_TEXT_NARRATIVE",
    applicability: "CONDITIONALLY_APPLICABLE",
    notes: "Requires explicit human authorization."
  }),
  createSemanticEntry({
    ordinal: 121,
    semanticKey: "form33b1.planOfCare.accessOption1",
    label: "Plan of care proposal: access option 1",
    description: "Checkbox slot for access arrangement option 1.",
    valueType: "BOOLEAN",
    applicability: "CONDITIONALLY_APPLICABLE",
    notes: "Requires explicit human authorization."
  }),
  createSemanticEntry({
    ordinal: 122,
    semanticKey: "form33b1.planOfCare.accessOption2",
    label: "Plan of care proposal: access option 2",
    description: "Checkbox slot for access arrangement option 2.",
    valueType: "BOOLEAN",
    applicability: "CONDITIONALLY_APPLICABLE",
    notes: "Requires explicit human authorization."
  }),
  createSemanticEntry({
    ordinal: 123,
    semanticKey: "form33b1.planOfCare.accessOption3",
    label: "Plan of care proposal: access option 3",
    description: "Checkbox slot for access arrangement option 3.",
    valueType: "BOOLEAN",
    applicability: "CONDITIONALLY_APPLICABLE",
    notes: "Requires explicit human authorization."
  }),
  createSemanticEntry({
    ordinal: 124,
    semanticKey: "form33b1.planOfCare.accessDetail",
    label: "Plan of care proposal: access detail narrative",
    description: "Plan of care access arrangement terms detail narrative.",
    valueType: "FREE_TEXT_NARRATIVE",
    applicability: "CONDITIONALLY_APPLICABLE",
    notes: "Requires explicit human authorization."
  }),
  createSemanticEntry({
    ordinal: 125,
    semanticKey: "form33b1.planOfCare.servicesOption1",
    label: "Plan of care proposal: services option 1",
    description: "Checkbox slot for services proposal option 1.",
    valueType: "BOOLEAN",
    applicability: "CONDITIONALLY_APPLICABLE",
    notes: "Requires explicit human authorization."
  }),
  createSemanticEntry({
    ordinal: 126,
    semanticKey: "form33b1.planOfCare.servicesOption2",
    label: "Plan of care proposal: services option 2",
    description: "Checkbox slot for services proposal option 2.",
    valueType: "BOOLEAN",
    applicability: "CONDITIONALLY_APPLICABLE",
    notes: "Requires explicit human authorization."
  }),
  createSemanticEntry({
    ordinal: 127,
    semanticKey: "form33b1.planOfCare.servicesOption3",
    label: "Plan of care proposal: services option 3",
    description: "Checkbox slot for services proposal option 3.",
    valueType: "BOOLEAN",
    applicability: "CONDITIONALLY_APPLICABLE",
    notes: "Requires explicit human authorization."
  }),
  createSemanticEntry({
    ordinal: 128,
    semanticKey: "form33b1.planOfCare.servicesDetail",
    label: "Plan of care proposal: services detail narrative",
    description: "Plan of care services proposal detail narrative.",
    valueType: "FREE_TEXT_NARRATIVE",
    applicability: "CONDITIONALLY_APPLICABLE",
    notes: "Requires explicit human authorization."
  })
);

for (let i = 0; i < 18; i++) {
  const ord = 129 + i;
  const slotNum = i + 1;
  entries.push(
    createSemanticEntry({
      ordinal: ord,
      semanticKey: `form33b1.planOfCare.supportDetailSlot${slotNum}`,
      label: `Plan of care support detail slot ${slotNum}`,
      description: `Plan of care support detail text slot ${slotNum}.`,
      valueType: "FREE_TEXT_NARRATIVE",
      applicability: "CONDITIONALLY_APPLICABLE",
      notes: "Requires explicit human authorization."
    })
  );
}

// ---------------------------------------------------------------------------
// 6. REQUESTED_ORDERS (Ordinals 147..164) — 18 controls
// ---------------------------------------------------------------------------
entries.push(
  createSemanticEntry({
    ordinal: 147,
    semanticKey: "form33b1.requestedOrders.dismissApplication",
    label: "Requested order: dismiss application",
    description: "Checkbox slot to request dismissal of society application.",
    valueType: "BOOLEAN",
    applicability: "CONDITIONALLY_APPLICABLE",
    notes: "Requires explicit human authorization."
  }),
  createSemanticEntry({
    ordinal: 148,
    semanticKey: "form33b1.requestedOrders.placeWithAnsweringParty",
    label: "Requested order: place child with answering party",
    description: "Checkbox slot to request placement of child with answering party.",
    valueType: "BOOLEAN",
    applicability: "CONDITIONALLY_APPLICABLE",
    notes: "Requires explicit human authorization."
  }),
  createSemanticEntry({
    ordinal: 149,
    semanticKey: "form33b1.requestedOrders.placementDetailLine1",
    label: "Requested order: placement detail line 1",
    description: "Placement terms detail narrative line 1.",
    valueType: "FREE_TEXT_NARRATIVE",
    applicability: "CONDITIONALLY_APPLICABLE",
    notes: "Requires explicit human authorization."
  }),
  createSemanticEntry({
    ordinal: 150,
    semanticKey: "form33b1.requestedOrders.placementDetailLine2",
    label: "Requested order: placement detail line 2",
    description: "Placement terms detail narrative line 2.",
    valueType: "FREE_TEXT_NARRATIVE",
    applicability: "CONDITIONALLY_APPLICABLE",
    notes: "Requires explicit human authorization."
  }),
  createSemanticEntry({
    ordinal: 151,
    semanticKey: "form33b1.requestedOrders.accessOption1",
    label: "Requested order: access option 1",
    description: "Checkbox slot for requested access option 1.",
    valueType: "BOOLEAN",
    applicability: "CONDITIONALLY_APPLICABLE",
    notes: "Requires explicit human authorization."
  }),
  createSemanticEntry({
    ordinal: 152,
    semanticKey: "form33b1.requestedOrders.accessOption2",
    label: "Requested order: access option 2",
    description: "Checkbox slot for requested access option 2.",
    valueType: "BOOLEAN",
    applicability: "CONDITIONALLY_APPLICABLE",
    notes: "Requires explicit human authorization."
  }),
  createSemanticEntry({
    ordinal: 153,
    semanticKey: "form33b1.requestedOrders.accessOption3",
    label: "Requested order: access option 3",
    description: "Checkbox slot for requested access option 3.",
    valueType: "BOOLEAN",
    applicability: "CONDITIONALLY_APPLICABLE",
    notes: "Requires explicit human authorization."
  }),
  createSemanticEntry({
    ordinal: 154,
    semanticKey: "form33b1.requestedOrders.accessOption4",
    label: "Requested order: access option 4",
    description: "Checkbox slot for requested access option 4.",
    valueType: "BOOLEAN",
    applicability: "CONDITIONALLY_APPLICABLE",
    notes: "Requires explicit human authorization."
  }),
  createSemanticEntry({
    ordinal: 155,
    semanticKey: "form33b1.requestedOrders.accessDetail",
    label: "Requested order: access detail narrative",
    description: "Requested access terms detail narrative.",
    valueType: "FREE_TEXT_NARRATIVE",
    applicability: "CONDITIONALLY_APPLICABLE",
    notes: "Requires explicit human authorization."
  }),
  createSemanticEntry({
    ordinal: 156,
    semanticKey: "form33b1.requestedOrders.counselOrder",
    label: "Requested order: legal representation order for child",
    description: "Checkbox slot to request child legal representation order.",
    valueType: "BOOLEAN",
    applicability: "CONDITIONALLY_APPLICABLE",
    notes: "Requires explicit human authorization."
  }),
  createSemanticEntry({
    ordinal: 157,
    semanticKey: "form33b1.requestedOrders.counselDetail",
    label: "Requested order: legal representation detail narrative",
    description: "Legal representation detail narrative.",
    valueType: "FREE_TEXT_NARRATIVE",
    applicability: "CONDITIONALLY_APPLICABLE",
    notes: "Requires explicit human authorization."
  }),
  createSemanticEntry({
    ordinal: 158,
    semanticKey: "form33b1.requestedOrders.otherOrder",
    label: "Requested order: other requested order",
    description: "Checkbox slot for other requested order.",
    valueType: "BOOLEAN",
    applicability: "CONDITIONALLY_APPLICABLE",
    notes: "Requires explicit human authorization."
  }),
  createSemanticEntry({
    ordinal: 159,
    semanticKey: "form33b1.requestedOrders.otherDetail",
    label: "Requested order: other requested order detail narrative",
    description: "Other requested order detail narrative.",
    valueType: "FREE_TEXT_NARRATIVE",
    applicability: "CONDITIONALLY_APPLICABLE",
    notes: "Requires explicit human authorization."
  }),
  createSemanticEntry({
    ordinal: 160,
    semanticKey: "form33b1.requestedOrders.costsOrder",
    label: "Requested order: costs order",
    description: "Checkbox slot for costs order request.",
    valueType: "BOOLEAN",
    applicability: "CONDITIONALLY_APPLICABLE",
    notes: "Requires explicit human authorization."
  }),
  createSemanticEntry({
    ordinal: 161,
    semanticKey: "form33b1.requestedOrders.costsDetail",
    label: "Requested order: costs order detail narrative",
    description: "Costs order detail narrative.",
    valueType: "FREE_TEXT_NARRATIVE",
    applicability: "CONDITIONALLY_APPLICABLE",
    notes: "Requires explicit human authorization."
  }),
  createSemanticEntry({
    ordinal: 162,
    semanticKey: "form33b1.requestedOrders.proceduralOption1",
    label: "Requested order: procedural order option 1",
    description: "Checkbox slot for procedural order option 1.",
    valueType: "BOOLEAN",
    applicability: "CONDITIONALLY_APPLICABLE",
    notes: "Requires explicit human authorization."
  }),
  createSemanticEntry({
    ordinal: 163,
    semanticKey: "form33b1.requestedOrders.proceduralOption2",
    label: "Requested order: procedural order option 2",
    description: "Checkbox slot for procedural order option 2.",
    valueType: "BOOLEAN",
    applicability: "CONDITIONALLY_APPLICABLE",
    notes: "Requires explicit human authorization."
  }),
  createSemanticEntry({
    ordinal: 164,
    semanticKey: "form33b1.requestedOrders.proceduralDetail",
    label: "Requested order: procedural order detail narrative",
    description: "Procedural order detail narrative.",
    valueType: "FREE_TEXT_NARRATIVE",
    applicability: "CONDITIONALLY_APPLICABLE",
    notes: "Requires explicit human authorization."
  })
);

// ---------------------------------------------------------------------------
// 7. SIGNATURE_OR_ATTESTATION (Ordinals 165..168) — 4 controls
// ---------------------------------------------------------------------------
entries.push(
  createSemanticEntry({
    ordinal: 165,
    semanticKey: "form33b1.signature.date",
    label: "Signature block: date of signature",
    description: "Date of signature blank.",
    valueType: "DATE",
    applicability: "ALWAYS_APPLICABLE",
    notes: "Requires explicit human authorization. Only USER_ENTERED provenance permitted."
  }),
  createSemanticEntry({
    ordinal: 166,
    semanticKey: "form33b1.signature.answeringPartyPrintedName",
    label: "Signature block: printed name of answering party",
    description: "Printed name of answering party.",
    valueType: "PERSON_NAME",
    applicability: "ALWAYS_APPLICABLE",
    notes: "Requires explicit human authorization. Only USER_ENTERED provenance permitted."
  }),
  createSemanticEntry({
    ordinal: 167,
    semanticKey: "form33b1.signature.lawyerPrintedName",
    label: "Signature block: printed name of lawyer",
    description: "Printed name of lawyer.",
    valueType: "PERSON_NAME",
    applicability: "CONDITIONALLY_APPLICABLE",
    notes: "Requires explicit human authorization. Only USER_ENTERED provenance permitted."
  }),
  createSemanticEntry({
    ordinal: 168,
    semanticKey: "form33b1.signature.lawyerDate",
    label: "Signature block: date of lawyer signature",
    description: "Date of lawyer signature blank.",
    valueType: "DATE",
    applicability: "CONDITIONALLY_APPLICABLE",
    notes: "Requires explicit human authorization. Only USER_ENTERED provenance permitted."
  })
);

export const FORM_33B1_SLICE1_SEMANTIC_ENTRIES: readonly Form33B1SemanticEntry[] =
  Object.freeze(entries.slice(0, 41));

export const FORM_33B1_SEMANTIC_ENTRIES: readonly Form33B1SemanticEntry[] =
  Object.freeze(entries);

export const FORM_33B1_SLICE1_SEMANTIC_FIELD_MAP: SemanticFieldMap = Object.freeze({
  binding: FORM_33B1_EXACT_TEMPLATE_BINDING,
  mapVersionLabel: FORM_33B1_MAP_VERSION_LABEL,
  entries: FORM_33B1_SLICE1_SEMANTIC_ENTRIES
});

export const FORM_33B1_SEMANTIC_FIELD_MAP: SemanticFieldMap = Object.freeze({
  binding: FORM_33B1_EXACT_TEMPLATE_BINDING,
  mapVersionLabel: FORM_33B1_MAP_VERSION_LABEL,
  entries: FORM_33B1_SEMANTIC_ENTRIES
});

export interface Form33B1FullAccounting {
  ordinal: number;
  stableTechnicalId: string;
  structuralSection: Form33B1StructuralSection;
  semanticKey: string;
  decisionCategory: Form33B1DecisionCategory;
  boundarySensitivity: Form33B1Sensitivity;
  requiresExplicitAuthorization: boolean;
  requiresUnansweredState: boolean;
}

export function form33b1FullAccounting(): Form33B1FullAccounting[] {
  if (FORM_33B1_SEMANTIC_ENTRIES.length !== FORM_33B1_TOTAL_TECHNICAL_CONTROLS) {
    throw new Error(
      `Form 33B.1 semantic entries count (${FORM_33B1_SEMANTIC_ENTRIES.length}) does not match total technical controls (${FORM_33B1_TOTAL_TECHNICAL_CONTROLS})`
    );
  }

  return FORM_33B1_SEMANTIC_ENTRIES.map(e => ({
    ordinal: e.ordinal,
    stableTechnicalId: e.stableTechnicalId,
    structuralSection: e.structuralSection,
    semanticKey: e.semanticKey,
    decisionCategory: e.decisionCategory,
    boundarySensitivity: e.boundarySensitivity,
    requiresExplicitAuthorization: e.requiresExplicitAuthorization,
    requiresUnansweredState: e.requiresUnansweredState
  }));
}

export function form33b1Slice1Accounting() {
  return form33b1FullAccounting().map(a => ({
    ordinal: a.ordinal,
    stableTechnicalId: a.stableTechnicalId,
    disposition: a.ordinal <= 40 ? ("MAPPED_IN_SLICE_1" as const) : ("UNMAPPED_OUT_OF_SLICE" as const),
    semanticKey: a.ordinal <= 40 ? a.semanticKey : null
  }));
}
