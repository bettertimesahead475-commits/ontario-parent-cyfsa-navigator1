// Stage 9D-4B-2A-ii-b5A-ii — Form 33B.1 STRUCTURAL GROUPS & STABLE TECHNICAL IDS MANIFEST.
//
// SCOPE: section and repeated-group reconstruction + semantically-neutral stable technical IDs
// for all 169 controls of official Form 33B.1 (Answer and Plan of Care).
// Does NOT perform b5A-iii decision-boundary classification, answer inference, form population,
// or AI generation.
//
// Source SHA256: 79d718a2de8be55001b47649a34366613b7050a69f98dfb6a4fd394870908a6e

export const FORM_33B1_STRUCTURAL_MANIFEST_SOURCE_SHA256 =
  "79d718a2de8be55001b47649a34366613b7050a69f98dfb6a4fd394870908a6e";

export const FORM_33B1_TOTAL_TECHNICAL_CONTROLS = 169;

export const FORM_33B1_STRUCTURAL_SECTIONS = [
  "COURT_ADMINISTRATION",
  "PARTY_IDENTIFICATION",
  "CHILD_IDENTIFICATION",
  "RESPONSE_TO_APPLICATION_CLAIMS",
  "PLAN_OF_CARE_PROPOSAL",
  "REQUESTED_ORDERS",
  "SIGNATURE_OR_ATTESTATION"
] as const;
export type Form33B1StructuralSection = (typeof FORM_33B1_STRUCTURAL_SECTIONS)[number];

export const FORM_33B1_REPEATED_GROUPS = ["REPEATED_CHILD_BLOCK"] as const;
export type Form33B1RepeatedGroup = (typeof FORM_33B1_REPEATED_GROUPS)[number];

export interface Form33B1RepeatedGroupDefinition {
  groupId: Form33B1RepeatedGroup;
  label: string;
  sourceSection: Form33B1StructuralSection;
  startOrdinal: number;
  endOrdinal: number;
  repeatSemantics: string;
  minimumKnownCardinality: number;
  additionalRepetitionsStructurallySupported: boolean;
}

export const FORM_33B1_REPEATED_GROUP_DEFINITIONS: readonly Form33B1RepeatedGroupDefinition[] = [
  {
    groupId: "REPEATED_CHILD_BLOCK",
    label: "Child Identification Block (3 repeated slots in template table)",
    sourceSection: "CHILD_IDENTIFICATION",
    startOrdinal: 17,
    endOrdinal: 40,
    repeatSemantics:
      "3 repeated child rows with 8 attributes per child (full name, DOB, sex, residence, school, special needs, indigenous status, band/community)",
    minimumKnownCardinality: 1,
    additionalRepetitionsStructurallySupported: true
  }
];

export interface Form33B1StructuralManifestEntry {
  /** 0-based order in word/document.xml — matches TechnicalFieldIdentity.ordinal (0..168). */
  ordinal: number;
  /** Semantically neutral, machine-readable, stable technical identifier for structural location. */
  stableTechnicalId: string;
  /** w:name value from the frozen technical inventory, or "" for an unnamed field. */
  observedName: string;
  technicalType: "text" | "checkbox" | "dropdown";
  structuralSection: Form33B1StructuralSection;
  /** Non-null only for controls belonging to a repeated structure. */
  repeatedGroupId: Form33B1RepeatedGroup | null;
  /** 0-based index of repetition slot within repeated structure, if applicable. */
  repeatedGroupIndex: number | null;
  evidence: "DIRECT_LABEL" | "DIRECT_STRUCTURAL_CONTEXT" | "STRUCTURAL_INFERENCE";
  rationale: string;
}

import { DOCX_FIELD_INVENTORIES } from "./docxFieldInventoryData";

const frozenInv = DOCX_FIELD_INVENTORIES.find(f => f.formNumber === "33B.1");

const entries: Form33B1StructuralManifestEntry[] = [];

// Helper to push entries
function add(
  ordinal: number,
  stableTechnicalId: string,
  observedName: string,
  technicalType: "text" | "checkbox" | "dropdown",
  structuralSection: Form33B1StructuralSection,
  repeatedGroupId: Form33B1RepeatedGroup | null,
  repeatedGroupIndex: number | null,
  evidence: "DIRECT_LABEL" | "DIRECT_STRUCTURAL_CONTEXT" | "STRUCTURAL_INFERENCE",
  rationale: string
) {
  const invName = frozenInv?.fields[ordinal]?.name || "";
  entries.push({
    ordinal,
    stableTechnicalId,
    observedName: observedName || invName,
    technicalType,
    structuralSection,
    repeatedGroupId,
    repeatedGroupIndex,
    evidence,
    rationale
  });
}

// ---------------------------------------------------------------------------
// 1. COURT_ADMINISTRATION (Ordinals 0..1)
// ---------------------------------------------------------------------------
add(0, "form33b1.court.courtName", "", "dropdown", "COURT_ADMINISTRATION", null, null, "DIRECT_LABEL", "Court location dropdown");
add(1, "form33b1.court.fileNumber", "", "text", "COURT_ADMINISTRATION", null, null, "DIRECT_LABEL", "Court file number blank");

// ---------------------------------------------------------------------------
// 2. PARTY_IDENTIFICATION (Ordinals 2..16)
// ---------------------------------------------------------------------------
add(2, "form33b1.party.applicantName", "", "text", "PARTY_IDENTIFICATION", null, null, "DIRECT_LABEL", "Applicant name");
add(3, "form33b1.party.answeringPartyName", "", "text", "PARTY_IDENTIFICATION", null, null, "DIRECT_LABEL", "Answering party name");
add(4, "form33b1.party.answeringPartyAddress", "", "text", "PARTY_IDENTIFICATION", null, null, "DIRECT_LABEL", "Answering party address");
add(5, "form33b1.party.answeringPartyPhone", "", "text", "PARTY_IDENTIFICATION", null, null, "DIRECT_LABEL", "Answering party phone");
add(6, "form33b1.party.answeringPartyEmail", "", "text", "PARTY_IDENTIFICATION", null, null, "DIRECT_LABEL", "Answering party email");
add(7, "form33b1.party.relationshipToChild", "", "text", "PARTY_IDENTIFICATION", null, null, "DIRECT_LABEL", "Relationship to child");
add(8, "form33b1.party.lawyerName", "", "text", "PARTY_IDENTIFICATION", null, null, "DIRECT_LABEL", "Lawyer name");
add(9, "form33b1.party.lawyerAddress", "", "text", "PARTY_IDENTIFICATION", null, null, "DIRECT_LABEL", "Lawyer address");
add(10, "form33b1.party.lawyerPhone", "", "text", "PARTY_IDENTIFICATION", null, null, "DIRECT_LABEL", "Lawyer phone");
add(11, "form33b1.party.lawyerFax", "", "text", "PARTY_IDENTIFICATION", null, null, "DIRECT_LABEL", "Lawyer fax");
add(12, "form33b1.party.lawyerEmail", "", "text", "PARTY_IDENTIFICATION", null, null, "DIRECT_LABEL", "Lawyer email");
add(13, "form33b1.party.childNameLine", "", "text", "PARTY_IDENTIFICATION", null, null, "DIRECT_STRUCTURAL_CONTEXT", "Child name header line");
add(14, "form33b1.party.caseNumberLine", "", "text", "PARTY_IDENTIFICATION", null, null, "DIRECT_STRUCTURAL_CONTEXT", "Case number header line");
add(15, "form33b1.party.hearingDateLine", "", "text", "PARTY_IDENTIFICATION", null, null, "DIRECT_STRUCTURAL_CONTEXT", "Hearing date header line");
add(16, "form33b1.party.courtLocationLine", "", "text", "PARTY_IDENTIFICATION", null, null, "DIRECT_STRUCTURAL_CONTEXT", "Court location header line");

// ---------------------------------------------------------------------------
// 3. CHILD_IDENTIFICATION (Ordinals 17..40) — 3 repeated slots x 8 fields
// ---------------------------------------------------------------------------
const childAttrs = [
  "fullName",
  "dob",
  "sex",
  "residence",
  "schoolGrade",
  "specialNeeds",
  "indigenousStatus",
  "bandCommunity"
] as const;

for (let slot = 0; slot < 3; slot++) {
  for (let a = 0; a < 8; a++) {
    const ord = 17 + slot * 8 + a;
    const attr = childAttrs[a];
    add(
      ord,
      `form33b1.child[${slot}].${attr}`,
      "",
      "text",
      "CHILD_IDENTIFICATION",
      "REPEATED_CHILD_BLOCK",
      slot,
      "DIRECT_LABEL",
      `Child slot ${slot + 1} ${attr} field`
    );
  }
}

// ---------------------------------------------------------------------------
// 4. RESPONSE_TO_APPLICATION_CLAIMS (Ordinals 41..112) — 72 text fields
// ---------------------------------------------------------------------------
for (let i = 0; i < 72; i++) {
  const ord = 41 + i;
  add(
    ord,
    `form33b1.response.paragraphSlot${i + 1}`,
    "",
    "text",
    "RESPONSE_TO_APPLICATION_CLAIMS",
    null,
    null,
    "DIRECT_STRUCTURAL_CONTEXT",
    `Response to applicant claim paragraph slot ${i + 1}`
  );
}

// ---------------------------------------------------------------------------
// 5. PLAN_OF_CARE_PROPOSAL (Ordinals 113..146) — 34 controls
// ---------------------------------------------------------------------------
add(113, "form33b1.planOfCare.placementParent", "Check46", "checkbox", "PLAN_OF_CARE_PROPOSAL", null, null, "DIRECT_LABEL", "Plan of care placement option 1 (parent)");
add(114, "form33b1.planOfCare.placementRelative", "Check46", "checkbox", "PLAN_OF_CARE_PROPOSAL", null, null, "DIRECT_LABEL", "Plan of care placement option 2 (relative)");
add(115, "form33b1.planOfCare.placementOther", "Check46", "checkbox", "PLAN_OF_CARE_PROPOSAL", null, null, "DIRECT_LABEL", "Plan of care placement option 3 (other)");
add(116, "form33b1.planOfCare.placementDetail", "", "text", "PLAN_OF_CARE_PROPOSAL", null, null, "DIRECT_LABEL", "Plan of care placement detail blank");

add(117, "form33b1.planOfCare.supervisionOption1", "Check47", "checkbox", "PLAN_OF_CARE_PROPOSAL", null, null, "DIRECT_LABEL", "Supervision condition option 1");
add(118, "form33b1.planOfCare.supervisionOption2", "Check46", "checkbox", "PLAN_OF_CARE_PROPOSAL", null, null, "DIRECT_LABEL", "Supervision condition option 2");
add(119, "form33b1.planOfCare.supervisionOption3", "Check46", "checkbox", "PLAN_OF_CARE_PROPOSAL", null, null, "DIRECT_LABEL", "Supervision condition option 3");
add(120, "form33b1.planOfCare.supervisionDetail", "", "text", "PLAN_OF_CARE_PROPOSAL", null, null, "DIRECT_LABEL", "Supervision detail blank");

add(121, "form33b1.planOfCare.accessOption1", "Check48", "checkbox", "PLAN_OF_CARE_PROPOSAL", null, null, "DIRECT_LABEL", "Access arrangement option 1");
add(122, "form33b1.planOfCare.accessOption2", "Check48", "checkbox", "PLAN_OF_CARE_PROPOSAL", null, null, "DIRECT_LABEL", "Access arrangement option 2");
add(123, "form33b1.planOfCare.accessOption3", "Check48", "checkbox", "PLAN_OF_CARE_PROPOSAL", null, null, "DIRECT_LABEL", "Access arrangement option 3");
add(124, "form33b1.planOfCare.accessDetail", "", "text", "PLAN_OF_CARE_PROPOSAL", null, null, "DIRECT_LABEL", "Access detail blank");

add(125, "form33b1.planOfCare.servicesOption1", "Check49", "checkbox", "PLAN_OF_CARE_PROPOSAL", null, null, "DIRECT_LABEL", "Services proposal option 1");
add(126, "form33b1.planOfCare.servicesOption2", "Check49", "checkbox", "PLAN_OF_CARE_PROPOSAL", null, null, "DIRECT_LABEL", "Services proposal option 2");
add(127, "form33b1.planOfCare.servicesOption3", "Check49", "checkbox", "PLAN_OF_CARE_PROPOSAL", null, null, "DIRECT_LABEL", "Services proposal option 3");
add(128, "form33b1.planOfCare.servicesDetail", "", "text", "PLAN_OF_CARE_PROPOSAL", null, null, "DIRECT_LABEL", "Services detail blank");

for (let i = 0; i < 18; i++) {
  const ord = 129 + i;
  add(
    ord,
    `form33b1.planOfCare.supportDetailSlot${i + 1}`,
    "",
    "text",
    "PLAN_OF_CARE_PROPOSAL",
    null,
    null,
    "DIRECT_STRUCTURAL_CONTEXT",
    `Plan of care support detail slot ${i + 1}`
  );
}

// ---------------------------------------------------------------------------
// 6. REQUESTED_ORDERS (Ordinals 147..164) — 18 controls
// ---------------------------------------------------------------------------
add(147, "form33b1.requestedOrders.dismissApplication", "Check50", "checkbox", "REQUESTED_ORDERS", null, null, "DIRECT_LABEL", "Order option: dismiss application");
add(148, "form33b1.requestedOrders.placeWithAnsweringParty", "Check51", "checkbox", "REQUESTED_ORDERS", null, null, "DIRECT_LABEL", "Order option: place child with answering party");
add(149, "form33b1.requestedOrders.placementDetailLine1", "", "text", "REQUESTED_ORDERS", null, null, "DIRECT_LABEL", "Placement terms detail line 1");
add(150, "form33b1.requestedOrders.placementDetailLine2", "", "text", "REQUESTED_ORDERS", null, null, "DIRECT_LABEL", "Placement terms detail line 2");

add(151, "form33b1.requestedOrders.accessOption1", "Check58", "checkbox", "REQUESTED_ORDERS", null, null, "DIRECT_LABEL", "Requested access option 1");
add(152, "form33b1.requestedOrders.accessOption2", "Check59", "checkbox", "REQUESTED_ORDERS", null, null, "DIRECT_LABEL", "Requested access option 2");
add(153, "form33b1.requestedOrders.accessOption3", "Check60", "checkbox", "REQUESTED_ORDERS", null, null, "DIRECT_LABEL", "Requested access option 3");
add(154, "form33b1.requestedOrders.accessOption4", "Check60", "checkbox", "REQUESTED_ORDERS", null, null, "DIRECT_LABEL", "Requested access option 4");
add(155, "form33b1.requestedOrders.accessDetail", "", "text", "REQUESTED_ORDERS", null, null, "DIRECT_LABEL", "Requested access detail blank");

add(156, "form33b1.requestedOrders.counselOrder", "Check61", "checkbox", "REQUESTED_ORDERS", null, null, "DIRECT_LABEL", "Legal representation order checkbox");
add(157, "form33b1.requestedOrders.counselDetail", "", "text", "REQUESTED_ORDERS", null, null, "DIRECT_LABEL", "Legal representation detail blank");

add(158, "form33b1.requestedOrders.otherOrder", "Check62", "checkbox", "REQUESTED_ORDERS", null, null, "DIRECT_LABEL", "Other requested order checkbox");
add(159, "form33b1.requestedOrders.otherDetail", "", "text", "REQUESTED_ORDERS", null, null, "DIRECT_LABEL", "Other requested order detail blank");

add(160, "form33b1.requestedOrders.costsOrder", "Check63", "checkbox", "REQUESTED_ORDERS", null, null, "DIRECT_LABEL", "Costs order checkbox");
add(161, "form33b1.requestedOrders.costsDetail", "", "text", "REQUESTED_ORDERS", null, null, "DIRECT_LABEL", "Costs order detail blank");

add(162, "form33b1.requestedOrders.proceduralOption1", "Check64", "checkbox", "REQUESTED_ORDERS", null, null, "DIRECT_LABEL", "Procedural order option 1");
add(163, "form33b1.requestedOrders.proceduralOption2", "Check65", "checkbox", "REQUESTED_ORDERS", null, null, "DIRECT_LABEL", "Procedural order option 2");
add(164, "form33b1.requestedOrders.proceduralDetail", "", "text", "REQUESTED_ORDERS", null, null, "DIRECT_LABEL", "Procedural order detail blank");

// ---------------------------------------------------------------------------
// 7. SIGNATURE_OR_ATTESTATION (Ordinals 165..168) — 4 text controls
// ---------------------------------------------------------------------------
add(165, "form33b1.signature.date", "", "text", "SIGNATURE_OR_ATTESTATION", null, null, "DIRECT_LABEL", "Date of signature blank");
add(166, "form33b1.signature.answeringPartyPrintedName", "", "text", "SIGNATURE_OR_ATTESTATION", null, null, "DIRECT_LABEL", "Printed name of answering party");
add(167, "form33b1.signature.lawyerPrintedName", "", "text", "SIGNATURE_OR_ATTESTATION", null, null, "DIRECT_LABEL", "Printed name of lawyer");
add(168, "form33b1.signature.lawyerDate", "", "text", "SIGNATURE_OR_ATTESTATION", null, null, "DIRECT_LABEL", "Date of lawyer signature blank");

export const FORM_33B1_STRUCTURAL_MANIFEST: readonly Form33B1StructuralManifestEntry[] = Object.freeze(entries);
