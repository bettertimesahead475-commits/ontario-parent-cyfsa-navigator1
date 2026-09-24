// Stage 9D-4B-2A-ii-b5B-S1 — Form 33B.1 (Answer and Plan of Care) SEMANTIC FIELD MAP SLICE 1: ORDINALS 0–40.
//
// SCOPE: Administrative controls (0..16) and Child identification block (17..40).
// Ordinals 41..168 remain unmapped by this slice.
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
  type TechnicalFieldIdentity
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
  type Form33B1Sensitivity,
  type Form33B1DecisionAuthority
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

export const FORM_33B1_SLICE1_MAP_VERSION_LABEL = "form33b1-semantic-map-slice1-v1";

export const FORM_33B1_SLICE1_ORDINAL_RANGE = {
  startOrdinal: 0,
  endOrdinal: 40,
  count: 41
} as const;

export interface Form33B1Slice1SemanticEntry extends SemanticFieldMapEntry {
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

const frozenInv = DOCX_FIELD_INVENTORIES.find(f => f.formNumber === "33B.1")!;
if (!frozenInv) {
  throw new Error("Missing frozen DOCX field inventory for Form 33B.1");
}

const entries: Form33B1Slice1SemanticEntry[] = [];

// Helper to construct slice 1 entry
function createSlice1Entry(args: {
  ordinal: number;
  semanticKey: string;
  label: string;
  description: string;
  valueType: SemanticValueType;
  applicability: ApplicabilityState;
  notes?: string | null;
  warnings?: string[];
}): Form33B1Slice1SemanticEntry {
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
  const dropdownOptions = rawField.dropdown?.listEntries ?? null;

  const entry: Form33B1Slice1SemanticEntry = {
    semanticKey,
    label,
    description,
    technicalIdentity,
    formSection: struct.structuralSection,
    semanticConstraints: {
      valueType,
      cardinality: "SINGLE",
      allowedValues: isDropdown ? dropdownOptions : null,
      maxLength: isDropdown ? null : (rawField.maxLength ?? 32000)
    },
    technicalConstraints: {
      technicalType: rawField.type,
      technicalMaxLength: isDropdown ? null : rawField.maxLength,
      technicalDropdownOptions: dropdownOptions,
      technicallyRequired: false
    },
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    applicability,
    permittedProvenance: boundary.permittedAuthorityClasses as PermittedProvenanceClasses,
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
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
// 1. COURT_ADMINISTRATION (Ordinals 0..1)
// ---------------------------------------------------------------------------
entries.push(
  createSlice1Entry({
    ordinal: 0,
    semanticKey: "form33b1.court.courtName",
    label: "Court location / court level",
    description: "Ontario court location dropdown menu.",
    valueType: "ENUM",
    applicability: "ALWAYS_APPLICABLE",
    notes: "First entry in dropdown is empty padding string."
  }),
  createSlice1Entry({
    ordinal: 1,
    semanticKey: "form33b1.court.fileNumber",
    label: "Court file number",
    description: "Court file number blank field.",
    valueType: "COURT_FILE_NUMBER",
    applicability: "ALWAYS_APPLICABLE"
  })
);

// ---------------------------------------------------------------------------
// 2. PARTY_IDENTIFICATION (Ordinals 2..16)
// ---------------------------------------------------------------------------
entries.push(
  createSlice1Entry({
    ordinal: 2,
    semanticKey: "form33b1.party.applicantName",
    label: "Applicant full legal name",
    description: "Full legal name of the applicant party (typically Children's Aid Society).",
    valueType: "PERSON_NAME",
    applicability: "ALWAYS_APPLICABLE"
  }),
  createSlice1Entry({
    ordinal: 3,
    semanticKey: "form33b1.party.answeringPartyName",
    label: "Answering party full legal name",
    description: "Full legal name of the answering party filing Form 33B.1.",
    valueType: "PERSON_NAME",
    applicability: "ALWAYS_APPLICABLE"
  }),
  createSlice1Entry({
    ordinal: 4,
    semanticKey: "form33b1.party.answeringPartyAddress",
    label: "Answering party address for service",
    description: "Address for service of the answering party.",
    valueType: "ADDRESS",
    applicability: "ALWAYS_APPLICABLE"
  }),
  createSlice1Entry({
    ordinal: 5,
    semanticKey: "form33b1.party.answeringPartyPhone",
    label: "Answering party telephone number",
    description: "Telephone number of the answering party.",
    valueType: "TEXT",
    applicability: "ALWAYS_APPLICABLE"
  }),
  createSlice1Entry({
    ordinal: 6,
    semanticKey: "form33b1.party.answeringPartyEmail",
    label: "Answering party email address",
    description: "Email address of the answering party.",
    valueType: "TEXT",
    applicability: "ALWAYS_APPLICABLE"
  }),
  createSlice1Entry({
    ordinal: 7,
    semanticKey: "form33b1.party.relationshipToChild",
    label: "Answering party relationship to child(ren)",
    description: "Relationship of the answering party to the child or children.",
    valueType: "TEXT",
    applicability: "ALWAYS_APPLICABLE"
  }),
  createSlice1Entry({
    ordinal: 8,
    semanticKey: "form33b1.party.lawyerName",
    label: "Lawyer name",
    description: "Name of the answering party's lawyer.",
    valueType: "PERSON_NAME",
    applicability: "CONDITIONALLY_APPLICABLE"
  }),
  createSlice1Entry({
    ordinal: 9,
    semanticKey: "form33b1.party.lawyerAddress",
    label: "Lawyer address for service",
    description: "Address for service of lawyer.",
    valueType: "ADDRESS",
    applicability: "CONDITIONALLY_APPLICABLE"
  }),
  createSlice1Entry({
    ordinal: 10,
    semanticKey: "form33b1.party.lawyerPhone",
    label: "Lawyer telephone number",
    description: "Telephone number of lawyer.",
    valueType: "TEXT",
    applicability: "CONDITIONALLY_APPLICABLE"
  }),
  createSlice1Entry({
    ordinal: 11,
    semanticKey: "form33b1.party.lawyerFax",
    label: "Lawyer fax number",
    description: "Fax number of lawyer.",
    valueType: "TEXT",
    applicability: "CONDITIONALLY_APPLICABLE"
  }),
  createSlice1Entry({
    ordinal: 12,
    semanticKey: "form33b1.party.lawyerEmail",
    label: "Lawyer email address",
    description: "Email address of lawyer.",
    valueType: "TEXT",
    applicability: "CONDITIONALLY_APPLICABLE"
  }),
  createSlice1Entry({
    ordinal: 13,
    semanticKey: "form33b1.party.childNameLine",
    label: "Header context: child name",
    description: "Child name header line.",
    valueType: "PERSON_NAME",
    applicability: "ALWAYS_APPLICABLE"
  }),
  createSlice1Entry({
    ordinal: 14,
    semanticKey: "form33b1.party.caseNumberLine",
    label: "Header context: case number",
    description: "Case number header line.",
    valueType: "COURT_FILE_NUMBER",
    applicability: "ALWAYS_APPLICABLE"
  }),
  createSlice1Entry({
    ordinal: 15,
    semanticKey: "form33b1.party.hearingDateLine",
    label: "Header context: hearing date",
    description: "Hearing date header line.",
    valueType: "DATE",
    applicability: "ALWAYS_APPLICABLE"
  }),
  createSlice1Entry({
    ordinal: 16,
    semanticKey: "form33b1.party.courtLocationLine",
    label: "Header context: court location",
    description: "Court location header line.",
    valueType: "TEXT",
    applicability: "ALWAYS_APPLICABLE"
  })
);

// ---------------------------------------------------------------------------
// 3. CHILD_IDENTIFICATION (Ordinals 17..40) — 3 repeated slots x 8 attributes
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
      createSlice1Entry({
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

export const FORM_33B1_SLICE1_SEMANTIC_ENTRIES: readonly Form33B1Slice1SemanticEntry[] =
  Object.freeze(entries);

export const FORM_33B1_SLICE1_SEMANTIC_FIELD_MAP: SemanticFieldMap = Object.freeze({
  binding: FORM_33B1_EXACT_TEMPLATE_BINDING,
  mapVersionLabel: FORM_33B1_SLICE1_MAP_VERSION_LABEL,
  entries: FORM_33B1_SLICE1_SEMANTIC_ENTRIES
});

export interface Form33B1Slice1Accounting {
  ordinal: number;
  stableTechnicalId: string;
  disposition: "MAPPED_IN_SLICE_1" | "UNMAPPED_OUT_OF_SLICE";
  semanticKey: string | null;
}

export function form33b1Slice1Accounting(): Form33B1Slice1Accounting[] {
  const byOrdinal = new Map(FORM_33B1_SLICE1_SEMANTIC_ENTRIES.map(e => [e.ordinal, e]));
  const result: Form33B1Slice1Accounting[] = [];

  for (let o = 0; o < FORM_33B1_TOTAL_TECHNICAL_CONTROLS; o++) {
    const struct = FORM_33B1_STRUCTURAL_MANIFEST[o];
    const mapped = byOrdinal.get(o);
    if (o <= 40) {
      if (!mapped) {
        throw new Error(`Ordinal ${o} is in Slice 1 scope (0..40) but missing from semantic entries.`);
      }
      result.push({
        ordinal: o,
        stableTechnicalId: struct.stableTechnicalId,
        disposition: "MAPPED_IN_SLICE_1",
        semanticKey: mapped.semanticKey
      });
    } else {
      if (mapped) {
        throw new Error(`Ordinal ${o} is out of Slice 1 scope (41..168) but present in semantic entries.`);
      }
      result.push({
        ordinal: o,
        stableTechnicalId: struct.stableTechnicalId,
        disposition: "UNMAPPED_OUT_OF_SLICE",
        semanticKey: null
      });
    }
  }

  return result;
}
