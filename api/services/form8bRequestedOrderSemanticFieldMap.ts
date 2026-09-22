// Stage 9D-4B-2A-ii-b4B-ii — Form 8B semantic field map, NARROWED PASS 2 OF 3:
// REQUESTED-ORDER controls only.
//
// SCOPE: exactly the 34 controls the frozen b4A structural manifest (`form8bStructuralManifest.ts`,
// NOT modified) assigns to structuralGroup REQUESTED_ORDER: ordinals 13, 69..100, 114. Pass 1
// (`form8bAdminChildPartySemanticFieldMap.ts`, CLOSED/FROZEN, NOT modified) owns 56 other
// controls; the remaining 25 (LEGAL_GROUND_OR_POSITION 21, SIGNATURE_OR_ATTESTATION 2,
// FACTUAL_NARRATIVE 1, OTHER 1) stay DEFERRED to b4B-iii and are not touched here.
//
// WHAT THIS MAP SAYS: for each control, WHICH OFFICIAL REQUESTED-ORDER OPTION (or option-detail
// blank) the printed Form 8B presents at that position. WHAT IT NEVER SAYS: whether that order
// should be requested, is recommended, is selected, is legally available, or is authorized for
// filing. There is no ranking/scoring/recommendation/inference logic in this module, and no
// record type in it can carry answer state (see Form8BRequestedOrderNoAnswerState below —
// enforced at compile time AND by a module-load guard).
//
// EVIDENCE BASIS: raw word/document.xml of the real Form 8B DOCX
// (sha256 02a5c3fdc32b42ed1f2db20115c1ff8bb9cf0233aa510a48063af9a10c5e7799). Ordinals 69..81 sit
// in the 4th top-level <w:tbl> (rows 12..26), ordinals 82..100 in the 5th top-level <w:tbl>
// (rows 3..22, one continuous table — NO heading, sub-heading or instruction row separates the
// CYFSA-society-care options 82..93 from the CLRA-deemed options 94..100), ordinal 13 in the 1st
// table (row 22), ordinal 114 in the 7th table (page-7 APPENDIX). Every checkbox has
// <w:default w:val="0"/>. Paragraph 2 prints NO "check the applicable box(es)" / "check one"
// instruction, so group exclusivity is recorded as NOT_ESTABLISHED_BY_FORM.
import {
  DEFAULT_LEGAL_REQUIREDNESS_STATE,
  type SemanticFieldMap,
  type SemanticFieldMapEntry,
  type SemanticValueType,
  type ApplicabilityState,
  type PermittedProvenanceClasses,
  type FieldValueProvenance
} from "./semanticFieldMap.js";
import type { Form8BStructuralGroup, StructuralEvidenceStrength } from "./form8bStructuralManifest.js";
import { FORM_8B_EXACT_TEMPLATE_BINDING, FORM_8B_TOTAL_TECHNICAL_CONTROLS } from "./form8bAdminChildPartySemanticFieldMap.js";

export const FORM_8B_PASS2_MAP_VERSION_LABEL = "form8b-semantic-map-pass2-requested-order-v1";
export const FORM_8B_PASS2_IN_SCOPE_GROUP: Form8BStructuralGroup = "REQUESTED_ORDER";
export const FORM_8B_PASS2_DISPOSITIONS = ["MAPPED", "UNRESOLVED"] as const;
export type Form8BPass2Disposition = (typeof FORM_8B_PASS2_DISPOSITIONS)[number];

// ---------------------------------------------------------------------------
// TYPE-LEVEL NO-ANSWER BOUNDARY.
// Every answer-state property name is declared `?: never`, so ANY object carrying one — object
// literal (excess/incompatible property) or a spread/variable (never-typed property) — fails
// `tsc --noEmit --strict`. Do not relax this to make mapping convenient.
// ---------------------------------------------------------------------------
export const FORBIDDEN_ANSWER_STATE_KEYS = [
  "value", "checked", "isChecked", "selected", "isSelected", "default", "defaultValue", "defaultChecked",
  "recommended", "isRecommended", "preferred", "suggestedChoice", "isChosen", "shouldChoose",
  "shouldRequest", "autoSelect", "confidenceThatUserShouldChoose", "rank", "score", "best"
] as const;
export type ForbiddenAnswerStateKey = (typeof FORBIDDEN_ANSWER_STATE_KEYS)[number];
export type Form8BRequestedOrderNoAnswerState = { readonly [K in ForbiddenAnswerStateKey]?: never };

export const STRUCTURAL_CONDITIONALITY_STATES = [
  /** Detail blank printed inside a specific option's wording — structural only, NOT legal applicability. */
  "STRUCTURALLY_CONDITIONAL_ON_COMPANION_OPTION",
  /** Form prints an explicit "applies / omit if" instruction — still structural, NOT legal applicability. */
  "STRUCTURALLY_CONDITIONAL_BY_PRINTED_INSTRUCTION",
  "NO_STRUCTURAL_CONDITION_PRINTED"
] as const;
export type StructuralConditionality = (typeof STRUCTURAL_CONDITIONALITY_STATES)[number];

export const GROUP_EXCLUSIVITY_STATES = ["NOT_ESTABLISHED_BY_FORM", "NOT_APPLICABLE_SINGLE_CONTROL"] as const;
export type GroupExclusivity = (typeof GROUP_EXCLUSIVITY_STATES)[number];

/** Official statutory text PRINTED next to an option. Association only — never applicability. */
export interface OfficialStatutoryAssociation extends Form8BRequestedOrderNoAnswerState {
  readonly printedReference: string;
  readonly associationOnly: true;
}

export interface Form8BRequestedOrderEvidenceRecord extends Form8BRequestedOrderNoAnswerState {
  readonly ordinal: number;
  readonly frozenStructuralGroup: "REQUESTED_ORDER";
  readonly disposition: Form8BPass2Disposition;
  /** Option identity, never an answer. null only when UNRESOLVED. */
  readonly semanticKey: string | null;
  readonly role: "OPTION_BOX" | "OPTION_DETAIL";
  /** For OPTION_DETAIL: the ordinal of the option box whose printed wording contains this blank. */
  readonly companionOptionOrdinal: number | null;
  readonly optionGroupId: string;
  readonly officialLabelEvidence: string;
  readonly statutoryAssociations: readonly OfficialStatutoryAssociation[];
  readonly structuralConditionality: StructuralConditionality;
  readonly groupExclusivity: GroupExclusivity;
  readonly evidence: StructuralEvidenceStrength;
  readonly evidenceDetail: string;
  readonly rawLocation: string;
}

// ---------------------------------------------------------------------------
// PROVENANCE ≠ AUTHORIZATION.
// ---------------------------------------------------------------------------
/** Only a person's own entry may place a value in a requested-order control. */
export const FORM_8B_REQUESTED_ORDER_PERMITTED_PROVENANCE: PermittedProvenanceClasses = ["USER_ENTERED"];

/**
 * No provenance class — not even USER_ENTERED, and not PROFESSIONALLY_REVIEWED — constitutes a
 * final pleading selection, authorized filing position, or lawyer-approved position. That is a
 * separate authorization fact that this map does not model and cannot grant.
 */
export function provenanceAuthorizesRequestedOrderSelection(_p: FieldValueProvenance): false {
  return false;
}
export const FORM_8B_REQUESTED_ORDER_AUTHORIZATION_BOUNDARY =
  "FACT != REQUESTED ORDER; ALLEGATION != REQUESTED ORDER; MATTER_DERIVED / MACHINE_SUGGESTED / " +
  "PROFESSIONALLY_REVIEWED are never a requested-order selection; USER_ENTERED is a value source, " +
  "not a final pleading selection, authorized filing position or lawyer-approved position.";

// ---------------------------------------------------------------------------
// Specs (literal records; `satisfies` keeps excess-property checking on each literal).
// ---------------------------------------------------------------------------
interface Spec extends Form8BRequestedOrderNoAnswerState {
  readonly ordinal: number;
  readonly name: string;
  readonly type: "text" | "checkbox";
  readonly paragraphOrdinal: number;
  readonly semanticKey: string;
  readonly label: string;
  readonly valueType: SemanticValueType;
  readonly role: "OPTION_BOX" | "OPTION_DETAIL";
  readonly companion: number | null;
  readonly group: string;
  readonly officialLabel: string;
  readonly statute: readonly string[];
  readonly conditionality: StructuralConditionality;
  readonly evidence: StructuralEvidenceStrength;
  readonly evidenceDetail: string;
  readonly raw: string;
  readonly formSection: string;
}

const P2 = "para2.orderOptions";
const P2_SECTION = "Claim by applicant — paragraph 2 ('asks for an order,')";
const OPTION_BOX_DETAIL =
  "Checkbox immediately followed, in the same table row, by the printed option wording quoted in officialLabelEvidence.";
const DETAIL = (after: string) => `Text field immediately follows the printed caption '${after}' inside its option's wording.`;

const SPECS = [
  { ordinal: 13, name: "Check75", type: "checkbox", paragraphOrdinal: 57, semanticKey: "requestedOrder.societyChildSupportClaimParagraph.appliesBox",
    label: "Notice: 'society is also making a claim for child support' — paragraph-applies box", valueType: "BOOLEAN", role: "OPTION_BOX", companion: null,
    group: "page1.childSupportClaimNotice",
    officialLabel: "Check this box if this paragraph applies | The children's aid society is also making a claim for child support. You MUST fill out a Financial Statement (Form 13 ...)",
    statute: [], conditionality: "STRUCTURALLY_CONDITIONAL_BY_PRINTED_INSTRUCTION", evidence: "DIRECT_LABEL",
    evidenceDetail: "Preceded by printed 'Check this box if this paragraph applies' and followed by the child-support-claim notice paragraph. The box marks whether that printed paragraph applies; it is not itself an order the map selects.",
    raw: "tbl1 row22 cell1", formSection: "Page 1 — notice to respondent(s)" },

  { ordinal: 69, name: "Check77", type: "checkbox", paragraphOrdinal: 225, semanticKey: "requestedOrder.placementWithPersonUnderSupervision.optionBox",
    label: "Option: placement with a parent/other person subject to society supervision", valueType: "BOOLEAN", role: "OPTION_BOX", companion: null, group: P2,
    officialLabel: "that the child(ren) be placed with (name of parent or another person) ... subject to the supervision of (full legal name of supervising society) for a period of ... months, on the terms and conditions set out in the Appendix on page 7",
    statute: [], conditionality: "NO_STRUCTURAL_CONDITION_PRINTED", evidence: "DIRECT_LABEL", evidenceDetail: OPTION_BOX_DETAIL, raw: "tbl4 row12 cell1", formSection: P2_SECTION },
  { ordinal: 70, name: "", type: "text", paragraphOrdinal: 227, semanticKey: "requestedOrder.placementWithPersonUnderSupervision.placementPersonName",
    label: "Supervision option: name of parent or other person", valueType: "PERSON_NAME", role: "OPTION_DETAIL", companion: 69, group: P2,
    officialLabel: "(name of parent or another person)", statute: [], conditionality: "STRUCTURALLY_CONDITIONAL_ON_COMPANION_OPTION", evidence: "DIRECT_LABEL",
    evidenceDetail: DETAIL("that the child(ren) be placed with (name of parent or another person)"), raw: "tbl4 row12 cell3", formSection: P2_SECTION },
  { ordinal: 71, name: "", type: "text", paragraphOrdinal: 233, semanticKey: "requestedOrder.placementWithPersonUnderSupervision.supervisingSocietyName",
    label: "Supervision option: supervising society", valueType: "TEXT", role: "OPTION_DETAIL", companion: 69, group: P2,
    officialLabel: "subject to the supervision of (full legal name of supervising society)", statute: [], conditionality: "STRUCTURALLY_CONDITIONAL_ON_COMPANION_OPTION", evidence: "DIRECT_LABEL",
    evidenceDetail: DETAIL("subject to the supervision of (full legal name of supervising society)"), raw: "tbl4 row14 cell2", formSection: P2_SECTION },
  { ordinal: 72, name: "", type: "text", paragraphOrdinal: 237, semanticKey: "requestedOrder.placementWithPersonUnderSupervision.supervisionPeriodMonths",
    label: "Supervision option: period (months)", valueType: "TEXT", role: "OPTION_DETAIL", companion: 69, group: P2,
    officialLabel: "for a period of ... months", statute: [], conditionality: "STRUCTURALLY_CONDITIONAL_ON_COMPANION_OPTION", evidence: "DIRECT_LABEL",
    evidenceDetail: DETAIL("for a period of") + " Followed by 'months'.", raw: "tbl4 row15 cell3", formSection: P2_SECTION },

  { ordinal: 73, name: "Check77", type: "checkbox", paragraphOrdinal: 243, semanticKey: "requestedOrder.interimSocietyCare.optionBox",
    label: "Option: interim society care for a period", valueType: "BOOLEAN", role: "OPTION_BOX", companion: null, group: P2,
    officialLabel: "that the child(ren) be placed in the interim society care of (full legal name of society) for a period of ... months",
    statute: [], conditionality: "NO_STRUCTURAL_CONDITION_PRINTED", evidence: "DIRECT_LABEL", evidenceDetail: OPTION_BOX_DETAIL, raw: "tbl4 row17 cell1", formSection: P2_SECTION },
  { ordinal: 74, name: "", type: "text", paragraphOrdinal: 247, semanticKey: "requestedOrder.interimSocietyCare.societyName",
    label: "Interim-care option: society", valueType: "TEXT", role: "OPTION_DETAIL", companion: 73, group: P2,
    officialLabel: "interim society care of (full legal name of society)", statute: [], conditionality: "STRUCTURALLY_CONDITIONAL_ON_COMPANION_OPTION", evidence: "DIRECT_LABEL",
    evidenceDetail: DETAIL("be placed in the interim society care of (full legal name of society)"), raw: "tbl4 row18 cell2", formSection: P2_SECTION },
  { ordinal: 75, name: "", type: "text", paragraphOrdinal: 251, semanticKey: "requestedOrder.interimSocietyCare.periodMonths",
    label: "Interim-care option: period (months)", valueType: "TEXT", role: "OPTION_DETAIL", companion: 73, group: P2,
    officialLabel: "for a period of ... months", statute: [], conditionality: "STRUCTURALLY_CONDITIONAL_ON_COMPANION_OPTION", evidence: "DIRECT_LABEL",
    evidenceDetail: DETAIL("for a period of") + " Followed by 'months' and then the next option box (76).", raw: "tbl4 row19 cell3", formSection: P2_SECTION },

  { ordinal: 76, name: "Check77", type: "checkbox", paragraphOrdinal: 254, semanticKey: "requestedOrder.interimSocietyCareThenSupervision.optionBox",
    label: "Option: interim society care, then return to a person subject to supervision", valueType: "BOOLEAN", role: "OPTION_BOX", companion: null, group: P2,
    officialLabel: "that the child(ren) be placed in the interim society care of (full legal name of society) for a period of ... months and then returned to (name of parent or another person) subject to the supervision of (full legal name of supervising society) for a period of ... months, on the terms and conditions set out in the Appendix on page 7",
    statute: [], conditionality: "NO_STRUCTURAL_CONDITION_PRINTED", evidence: "DIRECT_LABEL", evidenceDetail: OPTION_BOX_DETAIL, raw: "tbl4 row20 cell1", formSection: P2_SECTION },
  { ordinal: 77, name: "", type: "text", paragraphOrdinal: 258, semanticKey: "requestedOrder.interimSocietyCareThenSupervision.interimCareSocietyName",
    label: "Care-then-supervision option: interim-care society", valueType: "TEXT", role: "OPTION_DETAIL", companion: 76, group: P2,
    officialLabel: "interim society care of (full legal name of society)", statute: [], conditionality: "STRUCTURALLY_CONDITIONAL_ON_COMPANION_OPTION", evidence: "DIRECT_LABEL",
    evidenceDetail: DETAIL("be placed in the interim society care of (full legal name of society)"), raw: "tbl4 row21 cell2", formSection: P2_SECTION },
  { ordinal: 78, name: "", type: "text", paragraphOrdinal: 262, semanticKey: "requestedOrder.interimSocietyCareThenSupervision.interimCarePeriodMonths",
    label: "Care-then-supervision option: interim-care period (months)", valueType: "TEXT", role: "OPTION_DETAIL", companion: 76, group: P2,
    officialLabel: "for a period of ... months and then returned to", statute: [], conditionality: "STRUCTURALLY_CONDITIONAL_ON_COMPANION_OPTION", evidence: "DIRECT_LABEL",
    evidenceDetail: DETAIL("for a period of") + " Followed by 'months and then returned to'.", raw: "tbl4 row22 cell3", formSection: P2_SECTION },
  { ordinal: 79, name: "", type: "text", paragraphOrdinal: 266, semanticKey: "requestedOrder.interimSocietyCareThenSupervision.returnToPersonName",
    label: "Care-then-supervision option: person the child(ren) return to", valueType: "PERSON_NAME", role: "OPTION_DETAIL", companion: 76, group: P2,
    officialLabel: "then returned to (name of parent or another person)", statute: [], conditionality: "STRUCTURALLY_CONDITIONAL_ON_COMPANION_OPTION", evidence: "DIRECT_LABEL",
    evidenceDetail: DETAIL("months and then returned to (name of parent or another person)"), raw: "tbl4 row23 cell2", formSection: P2_SECTION },
  { ordinal: 80, name: "", type: "text", paragraphOrdinal: 272, semanticKey: "requestedOrder.interimSocietyCareThenSupervision.supervisingSocietyName",
    label: "Care-then-supervision option: supervising society", valueType: "TEXT", role: "OPTION_DETAIL", companion: 76, group: P2,
    officialLabel: "subject to the supervision of (full legal name of supervising society)", statute: [], conditionality: "STRUCTURALLY_CONDITIONAL_ON_COMPANION_OPTION", evidence: "DIRECT_LABEL",
    evidenceDetail: DETAIL("subject to the supervision of (full legal name of supervising society)"), raw: "tbl4 row25 cell2", formSection: P2_SECTION },
  { ordinal: 81, name: "", type: "text", paragraphOrdinal: 276, semanticKey: "requestedOrder.interimSocietyCareThenSupervision.supervisionPeriodMonths",
    label: "Care-then-supervision option: supervision period (months)", valueType: "TEXT", role: "OPTION_DETAIL", companion: 76, group: P2,
    officialLabel: "for a period of ... months, on the terms and conditions set out in the Appendix on page 7", statute: [], conditionality: "STRUCTURALLY_CONDITIONAL_ON_COMPANION_OPTION", evidence: "DIRECT_LABEL",
    evidenceDetail: DETAIL("for a period of") + " Followed by 'months, on the terms and conditions set out in the Appendix'.", raw: "tbl4 row26 cell3", formSection: P2_SECTION },

  { ordinal: 82, name: "Check77", type: "checkbox", paragraphOrdinal: 294, semanticKey: "requestedOrder.extendedSocietyCare.optionBox",
    label: "Option: extended society care", valueType: "BOOLEAN", role: "OPTION_BOX", companion: null, group: P2,
    officialLabel: "that the child(ren) be placed in the extended society care of (full legal name of caretaker society)",
    statute: [], conditionality: "NO_STRUCTURAL_CONDITION_PRINTED", evidence: "DIRECT_LABEL", evidenceDetail: OPTION_BOX_DETAIL, raw: "tbl5 row3 cell1", formSection: P2_SECTION },
  { ordinal: 83, name: "", type: "text", paragraphOrdinal: 298, semanticKey: "requestedOrder.extendedSocietyCare.caretakerSocietyName",
    label: "Extended-care option: caretaker society", valueType: "TEXT", role: "OPTION_DETAIL", companion: 82, group: P2,
    officialLabel: "(full legal name of caretaker society)", statute: [], conditionality: "STRUCTURALLY_CONDITIONAL_ON_COMPANION_OPTION", evidence: "DIRECT_STRUCTURAL_CONTEXT",
    evidenceDetail: "Text field in the row directly below option box 82 (tbl5 row4), whose printed wording ends with '(full legal name of caretaker society)'; no caption in its own row.",
    raw: "tbl5 row4 cell2", formSection: P2_SECTION },

  { ordinal: 84, name: "Check77", type: "checkbox", paragraphOrdinal: 300, semanticKey: "requestedOrder.accessUnderCyfsa.optionBox",
    label: "Option: order relating to access under the CYFSA", valueType: "BOOLEAN", role: "OPTION_BOX", companion: null, group: P2,
    officialLabel: "relating to access under the Child, Youth and Family Services Act, 2017, the details of which are as follows:",
    statute: ["Child, Youth and Family Services Act, 2017"], conditionality: "NO_STRUCTURAL_CONDITION_PRINTED", evidence: "DIRECT_LABEL", evidenceDetail: OPTION_BOX_DETAIL, raw: "tbl5 row5 cell1", formSection: P2_SECTION },
  { ordinal: 85, name: "", type: "text", paragraphOrdinal: 305, semanticKey: "requestedOrder.accessUnderCyfsa.details",
    label: "CYFSA-access option: details", valueType: "FREE_TEXT_NARRATIVE", role: "OPTION_DETAIL", companion: 84, group: P2,
    officialLabel: "the details of which are as follows:", statute: [], conditionality: "STRUCTURALLY_CONDITIONAL_ON_COMPANION_OPTION", evidence: "DIRECT_LABEL",
    evidenceDetail: DETAIL("the details of which are as follows:"), raw: "tbl5 row6 cell2", formSection: P2_SECTION },

  { ordinal: 86, name: "Check77", type: "checkbox", paragraphOrdinal: 307, semanticKey: "requestedOrder.restrainingOrderCyfsaS137.optionBox",
    label: "Option: restraining order under CYFSA s. 137", valueType: "BOOLEAN", role: "OPTION_BOX", companion: null, group: P2,
    officialLabel: "that (name of person) be restrained under s. 137 of the Child, Youth and Family Services Act, 2017 from having any contact with (name of child(ren) and/or any other caregiver)",
    statute: ["s. 137 of the Child, Youth and Family Services Act, 2017"], conditionality: "NO_STRUCTURAL_CONDITION_PRINTED", evidence: "DIRECT_LABEL", evidenceDetail: OPTION_BOX_DETAIL, raw: "tbl5 row7 cell1", formSection: P2_SECTION },
  { ordinal: 87, name: "", type: "text", paragraphOrdinal: 309, semanticKey: "requestedOrder.restrainingOrderCyfsaS137.restrainedPersonName",
    label: "s. 137 option: person to be restrained", valueType: "PERSON_NAME", role: "OPTION_DETAIL", companion: 86, group: P2,
    officialLabel: "that (name of person) be restrained", statute: [], conditionality: "STRUCTURALLY_CONDITIONAL_ON_COMPANION_OPTION", evidence: "DIRECT_LABEL",
    evidenceDetail: DETAIL("that (name of person)") + " Followed by 'be restrained under s. 137'.", raw: "tbl5 row7 cell3", formSection: P2_SECTION },
  { ordinal: 88, name: "", type: "text", paragraphOrdinal: 316, semanticKey: "requestedOrder.restrainingOrderCyfsaS137.protectedPersonsNames",
    label: "s. 137 option: child(ren) and/or other caregiver not to be contacted", valueType: "TEXT", role: "OPTION_DETAIL", companion: 86, group: P2,
    officialLabel: "from having any contact with (name of child(ren) and/or any other caregiver)", statute: [], conditionality: "STRUCTURALLY_CONDITIONAL_ON_COMPANION_OPTION", evidence: "DIRECT_LABEL",
    evidenceDetail: DETAIL("from having any contact with (name of child(ren) and/or any other caregiver)"), raw: "tbl5 row9 cell2", formSection: P2_SECTION },

  { ordinal: 89, name: "Check77", type: "checkbox", paragraphOrdinal: 318, semanticKey: "requestedOrder.supportWhileInCareOrSupervision.optionBox",
    label: "Option: order relating to support while in care or under supervision", valueType: "BOOLEAN", role: "OPTION_BOX", companion: null, group: P2,
    officialLabel: "relating to payment of support while the child(ren) is/are in care or subject to an order of supervision, the details of which are as follows:",
    statute: [], conditionality: "NO_STRUCTURAL_CONDITION_PRINTED", evidence: "DIRECT_LABEL", evidenceDetail: OPTION_BOX_DETAIL, raw: "tbl5 row10 cell1", formSection: P2_SECTION },
  { ordinal: 90, name: "", type: "text", paragraphOrdinal: 323, semanticKey: "requestedOrder.supportWhileInCareOrSupervision.details",
    label: "Support option: details", valueType: "FREE_TEXT_NARRATIVE", role: "OPTION_DETAIL", companion: 89, group: P2,
    officialLabel: "the details of which are as follows:", statute: [], conditionality: "STRUCTURALLY_CONDITIONAL_ON_COMPANION_OPTION", evidence: "DIRECT_LABEL",
    evidenceDetail: DETAIL("the details of which are as follows:"), raw: "tbl5 row11 cell2", formSection: P2_SECTION },

  { ordinal: 91, name: "Check77", type: "checkbox", paragraphOrdinal: 325, semanticKey: "requestedOrder.courtCosts.optionBox",
    label: "Option: court costs", valueType: "BOOLEAN", role: "OPTION_BOX", companion: null, group: P2,
    officialLabel: "for court costs.", statute: [], conditionality: "NO_STRUCTURAL_CONDITION_PRINTED", evidence: "DIRECT_LABEL", evidenceDetail: OPTION_BOX_DETAIL, raw: "tbl5 row12 cell1", formSection: P2_SECTION },

  { ordinal: 92, name: "Check77", type: "checkbox", paragraphOrdinal: 328, semanticKey: "requestedOrder.other.optionBox",
    label: "Option: other (specify)", valueType: "BOOLEAN", role: "OPTION_BOX", companion: null, group: P2,
    officialLabel: "other (Specify.)", statute: [], conditionality: "NO_STRUCTURAL_CONDITION_PRINTED", evidence: "DIRECT_LABEL", evidenceDetail: OPTION_BOX_DETAIL, raw: "tbl5 row13 cell1", formSection: P2_SECTION },
  { ordinal: 93, name: "", type: "text", paragraphOrdinal: 330, semanticKey: "requestedOrder.other.specification",
    label: "Other option: specification", valueType: "FREE_TEXT_NARRATIVE", role: "OPTION_DETAIL", companion: 92, group: P2,
    officialLabel: "(Specify.)", statute: [], conditionality: "STRUCTURALLY_CONDITIONAL_ON_COMPANION_OPTION", evidence: "DIRECT_LABEL",
    evidenceDetail: DETAIL("other (Specify.)") + " Same table row as box 92.", raw: "tbl5 row13 cell3", formSection: P2_SECTION },

  { ordinal: 94, name: "", type: "checkbox", paragraphOrdinal: 332, semanticKey: "requestedOrder.custodyDeemedParentingOrderClraS28.optionBox",
    label: "Option: custody to a named custodian (deemed CLRA s. 28 parenting order)", valueType: "BOOLEAN", role: "OPTION_BOX", companion: null, group: P2,
    officialLabel: "that the child(ren) be placed in the custody of (name of custodian – cannot be a foster parent of the child): ... (This order shall be deemed to be a parenting order under s. 28 of the Children's Law Reform Act.)",
    statute: ["deemed to be a parenting order under s. 28 of the Children's Law Reform Act"], conditionality: "NO_STRUCTURAL_CONDITION_PRINTED", evidence: "DIRECT_LABEL",
    evidenceDetail: OPTION_BOX_DETAIL + " Same continuous table (tbl5) as options 82-93, next row after box 92/field 93; no heading or instruction row separates them. b4A's REQUIRES_REVIEW concern was the sub-pathway (protection vs status review), which this map does NOT assert.",
    raw: "tbl5 row14 cell1", formSection: P2_SECTION },
  { ordinal: 95, name: "", type: "text", paragraphOrdinal: 336, semanticKey: "requestedOrder.custodyDeemedParentingOrderClraS28.custodianName",
    label: "Custody option: custodian", valueType: "PERSON_NAME", role: "OPTION_DETAIL", companion: 94, group: P2,
    officialLabel: "(name of custodian – cannot be a foster parent of the child):", statute: [], conditionality: "STRUCTURALLY_CONDITIONAL_ON_COMPANION_OPTION", evidence: "DIRECT_LABEL",
    evidenceDetail: DETAIL("be placed in the custody of (name of custodian – cannot be a foster parent of the child):"), raw: "tbl5 row15 cell2", formSection: P2_SECTION },

  { ordinal: 96, name: "", type: "checkbox", paragraphOrdinal: 341, semanticKey: "requestedOrder.accessDeemedParentingOrContactOrderClraS28.optionBox",
    label: "Option: order relating to access (deemed CLRA s. 28 parenting or contact order)", valueType: "BOOLEAN", role: "OPTION_BOX", companion: null, group: P2,
    officialLabel: "relating to access, the details of which are as follows: ... (This order shall be deemed to be a parenting or contact order, as the case may be, under s. 28 of the Children's Law Reform Act.)",
    statute: ["deemed to be a parenting or contact order, as the case may be, under s. 28 of the Children's Law Reform Act"], conditionality: "NO_STRUCTURAL_CONDITION_PRINTED", evidence: "DIRECT_LABEL",
    evidenceDetail: OPTION_BOX_DETAIL + " Distinct from option 84 (access 'under the Child, Youth and Family Services Act, 2017'): different printed wording and different deemed-order statement.",
    raw: "tbl5 row17 cell1", formSection: P2_SECTION },
  { ordinal: 97, name: "", type: "text", paragraphOrdinal: 346, semanticKey: "requestedOrder.accessDeemedParentingOrContactOrderClraS28.details",
    label: "CLRA-deemed access option: details", valueType: "FREE_TEXT_NARRATIVE", role: "OPTION_DETAIL", companion: 96, group: P2,
    officialLabel: "the details of which are as follows:", statute: [], conditionality: "STRUCTURALLY_CONDITIONAL_ON_COMPANION_OPTION", evidence: "DIRECT_LABEL",
    evidenceDetail: DETAIL("relating to access, the details of which are as follows:"), raw: "tbl5 row18 cell2", formSection: P2_SECTION },

  { ordinal: 98, name: "", type: "checkbox", paragraphOrdinal: 351, semanticKey: "requestedOrder.restrainingOrderCyfsaS102_3.optionBox",
    label: "Option: restraining order under CYFSA s. 102(3) (deemed CLRA s. 35 order)", valueType: "BOOLEAN", role: "OPTION_BOX", companion: null, group: P2,
    officialLabel: "that (name of person) be restrained under s. 102(3) of the Child, Youth and Family Services Act, 2017 from having contact with (name of child(ren) and/or any other caregiver) (This order shall be deemed to be an order under s. 35 of the Children's Law Reform Act.)",
    statute: ["s. 102(3) of the Child, Youth and Family Services Act, 2017", "deemed to be an order under s. 35 of the Children's Law Reform Act"],
    conditionality: "NO_STRUCTURAL_CONDITION_PRINTED", evidence: "DIRECT_LABEL",
    evidenceDetail: OPTION_BOX_DETAIL + " Distinct from option 86 (s. 137): different printed section reference and a printed deemed-order statement.", raw: "tbl5 row20 cell1", formSection: P2_SECTION },
  { ordinal: 99, name: "", type: "text", paragraphOrdinal: 353, semanticKey: "requestedOrder.restrainingOrderCyfsaS102_3.restrainedPersonName",
    label: "s. 102(3) option: person to be restrained", valueType: "PERSON_NAME", role: "OPTION_DETAIL", companion: 98, group: P2,
    officialLabel: "that (name of person) be restrained", statute: [], conditionality: "STRUCTURALLY_CONDITIONAL_ON_COMPANION_OPTION", evidence: "DIRECT_LABEL",
    evidenceDetail: DETAIL("that (name of person)") + " Followed by 'be restrained under s. 102(3)'.", raw: "tbl5 row20 cell3", formSection: P2_SECTION },
  { ordinal: 100, name: "", type: "text", paragraphOrdinal: 360, semanticKey: "requestedOrder.restrainingOrderCyfsaS102_3.protectedPersonsNames",
    label: "s. 102(3) option: child(ren) and/or other caregiver not to be contacted", valueType: "TEXT", role: "OPTION_DETAIL", companion: 98, group: P2,
    officialLabel: "from having contact with (name of child(ren) and/or any other caregiver)", statute: [], conditionality: "STRUCTURALLY_CONDITIONAL_ON_COMPANION_OPTION", evidence: "DIRECT_LABEL",
    evidenceDetail: DETAIL("from having contact with (name of child(ren) and/or any other caregiver)"), raw: "tbl5 row22 cell2", formSection: P2_SECTION },

  { ordinal: 114, name: "", type: "text", paragraphOrdinal: 444, semanticKey: "requestedOrder.supervisionTermsAppendix.proposedTermsAndConditions",
    label: "Appendix (page 7): proposed supervision terms and conditions", valueType: "FREE_TEXT_NARRATIVE", role: "OPTION_DETAIL", companion: null, group: "page7.appendix",
    officialLabel: "APPENDIX | The terms and conditions proposed for the child(ren)'s supervision are as follows: (Set out terms and conditions in numbered paragraphs. Omit this page if no supervision is sought.)",
    statute: [], conditionality: "STRUCTURALLY_CONDITIONAL_BY_PRINTED_INSTRUCTION", evidence: "DIRECT_LABEL",
    evidenceDetail: "Directly follows the printed APPENDIX caption. Options 69 and 76 refer to 'the Appendix on page 7'; companionOptionOrdinal is null because the Appendix is referenced by two options and the map does not tie it to either.",
    raw: "tbl7 row6 cell1", formSection: "Page 7 — APPENDIX" }
] as const satisfies readonly Spec[];

/** Ordinals intentionally left UNRESOLVED in this pass (none: every option is directly printed). */
export const FORM_8B_PASS2_UNRESOLVED_ORDINALS: readonly number[] = [];

const CHECKBOX = { technicalType: "checkbox" as const, technicalMaxLength: null, technicalDropdownOptions: null, technicallyRequired: false };

function toEntry(s: Spec): SemanticFieldMapEntry {
  const applicability: ApplicabilityState = s.conditionality === "NO_STRUCTURAL_CONDITION_PRINTED" ? "UNKNOWN" : "CONDITIONALLY_APPLICABLE";
  return {
    semanticKey: s.semanticKey,
    label: s.label,
    description: `Official Form 8B requested-order ${s.role === "OPTION_BOX" ? "option slot" : "option detail blank"}: ${s.officialLabel}`,
    technicalIdentity: { ordinal: s.ordinal, name: s.name, type: s.type, tableDepth: 1, paragraphOrdinal: s.paragraphOrdinal },
    formSection: s.formSection,
    semanticConstraints: { valueType: s.valueType, cardinality: "SINGLE", allowedValues: null, maxLength: s.type === "text" ? 32000 : null },
    technicalConstraints: s.type === "checkbox" ? CHECKBOX : { technicalType: "text", technicalMaxLength: 32000, technicalDropdownOptions: null, technicallyRequired: false },
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    applicability,
    permittedProvenance: FORM_8B_REQUESTED_ORDER_PERMITTED_PROVENANCE,
    reviewSensitivity: "REQUESTED_ORDER",
    mappingResolution: "HUMAN_MAPPED",
    notes:
      "Describes the printed OPTION, never an answer: no selected/default/recommended state; whether to request it is a pleading decision this map does not make. " +
      "Structural conditionality is not legal applicability; any statutory reference is the form's printed association only.",
    warnings: s.evidence === "DIRECT_STRUCTURAL_CONTEXT" ? ["DIRECT_STRUCTURAL_CONTEXT: caption belongs to the option row above, not this cell."] : []
  };
}

const ORDERED: readonly Spec[] = [...SPECS].sort((a, b) => a.ordinal - b.ordinal);

export const FORM_8B_PASS2_SEMANTIC_ENTRIES: readonly SemanticFieldMapEntry[] = ORDERED.map(toEntry);

export const FORM_8B_PASS2_EVIDENCE: readonly Form8BRequestedOrderEvidenceRecord[] = ORDERED.map(s => ({
  ordinal: s.ordinal,
  frozenStructuralGroup: "REQUESTED_ORDER" as const,
  disposition: "MAPPED" as const,
  semanticKey: s.semanticKey,
  role: s.role,
  companionOptionOrdinal: s.companion,
  optionGroupId: s.group,
  officialLabelEvidence: s.officialLabel,
  statutoryAssociations: s.statute.map(printedReference => ({ printedReference, associationOnly: true as const })),
  structuralConditionality: s.conditionality,
  groupExclusivity: s.group === P2 ? ("NOT_ESTABLISHED_BY_FORM" as const) : ("NOT_APPLICABLE_SINGLE_CONTROL" as const),
  evidence: s.evidence,
  evidenceDetail: s.evidenceDetail,
  rawLocation: s.raw
}));

export const FORM_8B_PASS2_SEMANTIC_FIELD_MAP: SemanticFieldMap = {
  binding: FORM_8B_EXACT_TEMPLATE_BINDING,
  mapVersionLabel: FORM_8B_PASS2_MAP_VERSION_LABEL,
  entries: FORM_8B_PASS2_SEMANTIC_ENTRIES
};

/** Module-load guard (runtime twin of the compile-time boundary). */
for (const rec of [...FORM_8B_PASS2_SEMANTIC_ENTRIES, ...FORM_8B_PASS2_EVIDENCE, ...ORDERED] as readonly object[]) {
  for (const k of FORBIDDEN_ANSWER_STATE_KEYS) {
    if (Object.prototype.hasOwnProperty.call(rec, k)) {
      throw new Error(`Form 8B requested-order map record carries forbidden answer-state property "${k}".`);
    }
  }
}

// ---------------------------------------------------------------------------
// Whole-form accounting across passes (pass 1 frozen, pass 2 here, pass 3 deferred).
// ---------------------------------------------------------------------------
export interface Form8BGlobalAccountingRow {
  ordinal: number;
  owner: "PASS1_B4B_I" | "PASS2_B4B_II" | "DEFERRED_TO_B4B_III";
  disposition: "MAPPED" | "UNRESOLVED" | "DEFERRED";
}

export function form8bGlobalAccounting(pass1MappedOrdinals: readonly number[], deferredToPass3: readonly number[]): Form8BGlobalAccountingRow[] {
  const p1 = new Set(pass1MappedOrdinals);
  const p2 = new Set(FORM_8B_PASS2_SEMANTIC_ENTRIES.map(e => e.technicalIdentity.ordinal));
  const p2u = new Set(FORM_8B_PASS2_UNRESOLVED_ORDINALS);
  const p3 = new Set(deferredToPass3);
  const out: Form8BGlobalAccountingRow[] = [];
  for (let o = 0; o < FORM_8B_TOTAL_TECHNICAL_CONTROLS; o++) {
    const hits = [p1.has(o), p2.has(o), p2u.has(o), p3.has(o)].filter(Boolean).length;
    if (hits !== 1) throw new Error(`Form 8B ordinal ${o} is accounted ${hits} times (must be exactly once).`);
    if (p1.has(o)) out.push({ ordinal: o, owner: "PASS1_B4B_I", disposition: "MAPPED" });
    else if (p2.has(o)) out.push({ ordinal: o, owner: "PASS2_B4B_II", disposition: "MAPPED" });
    else if (p2u.has(o)) out.push({ ordinal: o, owner: "PASS2_B4B_II", disposition: "UNRESOLVED" });
    else out.push({ ordinal: o, owner: "DEFERRED_TO_B4B_III", disposition: "DEFERRED" });
  }
  return out;
}
