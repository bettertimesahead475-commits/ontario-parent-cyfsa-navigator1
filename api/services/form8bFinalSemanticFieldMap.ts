// Stage 9D-4B-2A-ii-b4B-iii — Form 8B semantic field map, FINAL PASS 3 OF 3:
// LEGAL-GROUND / SIGNATURE-BLOCK / NARRATIVE / OTHER controls.
//
// SCOPE: exactly the controls NOT owned by pass 1 (`form8bAdminChildPartySemanticFieldMap.ts`,
// CLOSED/FROZEN) or pass 2 (`form8bRequestedOrderSemanticFieldMap.ts`, CLOSED/FROZEN). The set is
// DERIVED at module load (all 115 frozen-manifest ordinals minus pass-1 minus pass-2) and the
// module refuses to load if its specs do not cover exactly that set. Neither prior pass nor the
// frozen b4A manifest (`form8bStructuralManifest.ts`) is modified.
//
// NOTE ON FILE NAME: the frozen b4B-ii test asserts that `form8bLegalGroundSemanticFieldMap.ts`
// and `form8bSemanticFieldMap.ts` do not exist; this module uses a different name so that frozen
// assertion keeps holding without editing it.
//
// WHAT THIS MAP SAYS: for each control, WHICH OFFICIAL THING the printed Form 8B presents there —
// which statutory protection ground a checkbox labels, which signature-block caption a blank sits
// above, what kind of content the paragraph-6 box is for. WHAT IT NEVER SAYS: that a ground is
// established / proven / satisfied / applicable / recommended / should be asserted; that anything
// has been signed / executed / attested; or any narrative content. Those states cannot be
// expressed by any record type in this module (compile-time `?: never` mapped types, reusing the
// b4B-ii mechanism) and are rejected at module load (runtime twin).
//
// EVIDENCE BASIS: raw word/document.xml of the real Form 8B DOCX
// (sha256 02a5c3fdc32b42ed1f2db20115c1ff8bb9cf0233aa510a48063af9a10c5e7799):
//   - ordinals 47..59 : 3rd top-level <w:tbl>, rows 13..25; ordinals 60..67 : 4th <w:tbl>, rows 3..10.
//     Paragraph 1 heading: "The applicant children's aid society asks the court to make a finding
//     under Part V of the Child, Youth and Family Services Act, 2017 that the child(ren) named in this
//     application is/are in need of protection because:" + printed instruction "(Check the applicable
//     box(es). In each checked paragraph, delete those portions of the text that are not relevant.)"
//     and, above it, "CLAIM BY APPLICANT / NOTE: If this case is an application for a status review,
//     strike out paragraph 1 and go immediately to paragraph 2." Ordinals 48/49 and 51/52 sit in an INDENTED cell (c2, gridSpan 2) under 47 / 50.
//   - ordinal 110 : 6th <w:tbl> row 15, under "6. The following is a brief statement of the facts
//     upon which the applicant is relying in this application." + "(Set out the facts in numbered
//     paragraphs. ...)".
//   - ordinals 111/112/113 : 6th <w:tbl> rows 17 and 19. Caption rows 18 ("Date of signature" |
//     "Signature") and 20 ("If applicant is a children's aid society, give office or position of
//     person signing." | "Print or type name.") sit BELOW ruled cells: rows 17 and 19 cells carry
//     <w:bottom w:val="single"/>, the caption cells carry <w:top w:val="single"/> and no bottom rule.
//     Row 17's right-hand cell (the signature line itself) contains NO form field.
import {
  DEFAULT_LEGAL_REQUIREDNESS_STATE,
  type SemanticFieldMap,
  type SemanticFieldMapEntry,
  type SemanticValueType,
  type ReviewSensitivityCategory,
  type PermittedProvenanceClasses,
  type FieldValueProvenance
} from "./semanticFieldMap.js";
import {
  FORM_8B_STRUCTURAL_MANIFEST,
  type Form8BStructuralGroup,
  type StructuralEvidenceStrength,
  type MapReadinessState
} from "./form8bStructuralManifest.js";
import {
  FORM_8B_EXACT_TEMPLATE_BINDING,
  FORM_8B_TOTAL_TECHNICAL_CONTROLS,
  FORM_8B_PASS1_SEMANTIC_ENTRIES
} from "./form8bAdminChildPartySemanticFieldMap.js";
import { FORM_8B_PASS2_SEMANTIC_ENTRIES, FORM_8B_PASS2_UNRESOLVED_ORDINALS } from "./form8bRequestedOrderSemanticFieldMap.js";

export const FORM_8B_PASS3_MAP_VERSION_LABEL = "form8b-semantic-map-pass3-legal-ground-signature-narrative-v1";
export const FORM_8B_PASS3_DISPOSITIONS = ["MAPPED", "UNRESOLVED"] as const;
export type Form8BPass3Disposition = (typeof FORM_8B_PASS3_DISPOSITIONS)[number];

// ---------------------------------------------------------------------------
// EXACT REMAINING SET — derived, never hand-copied.
// ---------------------------------------------------------------------------
export function deriveForm8BPass3Ordinals(): number[] {
  const p1 = new Set(FORM_8B_PASS1_SEMANTIC_ENTRIES.map(e => e.technicalIdentity.ordinal));
  const p2 = new Set([...FORM_8B_PASS2_SEMANTIC_ENTRIES.map(e => e.technicalIdentity.ordinal), ...FORM_8B_PASS2_UNRESOLVED_ORDINALS]);
  return FORM_8B_STRUCTURAL_MANIFEST.map(m => m.ordinal).filter(o => !p1.has(o) && !p2.has(o));
}

// ---------------------------------------------------------------------------
// TYPE-LEVEL NO-CONCLUSION / NO-EXECUTION / NO-CONTENT BOUNDARIES.
// Same mechanism as the frozen b4B-ii Form8BRequestedOrderNoAnswerState: every forbidden property
// is declared `?: never`, so an object literal AND a spread/variable carrying one both fail
// `tsc --noEmit --strict`. Do not relax these to make mapping convenient.
// ---------------------------------------------------------------------------
export const FORBIDDEN_LEGAL_GROUND_STATE_KEYS = [
  "established", "isEstablished", "proven", "isProven", "notProven", "satisfied", "isSatisfied", "failed",
  "applicable", "isApplicable", "applies", "selected", "isSelected", "asserted", "isAsserted",
  "recommended", "isRecommended", "likely", "likelihood", "confidence", "probability", "score", "rank",
  "shouldAssert", "shouldSelect", "shouldPlead", "courtShouldAccept", "courtShouldReject", "accepted", "rejected",
  "checked", "isChecked", "value", "default", "defaultValue", "defaultChecked"
] as const;
export type ForbiddenLegalGroundStateKey = (typeof FORBIDDEN_LEGAL_GROUND_STATE_KEYS)[number];
export type Form8BLegalGroundNoConclusionState = { readonly [K in ForbiddenLegalGroundStateKey]?: never };

export const FORBIDDEN_SIGNATURE_EXECUTION_STATE_KEYS = [
  "signed", "isSigned", "executed", "isExecuted", "attested", "isAttested", "sworn", "affirmed", "commissioned",
  "verified", "isVerified", "completed", "isCompleted", "signedAt", "signedBy", "signerIdentity",
  "signatureImage", "signatureData", "value", "default", "defaultValue"
] as const;
export type ForbiddenSignatureExecutionStateKey = (typeof FORBIDDEN_SIGNATURE_EXECUTION_STATE_KEYS)[number];
export type Form8BSignatureNoExecutionState = { readonly [K in ForbiddenSignatureExecutionStateKey]?: never };

export const FORBIDDEN_NARRATIVE_CONTENT_KEYS = [
  "value", "default", "defaultValue", "content", "text", "generatedText", "draftText", "suggestedText",
  "suggestedWording", "recommendedWording", "summary", "prefill", "autoFill", "isFact", "established", "proven"
] as const;
export type ForbiddenNarrativeContentKey = (typeof FORBIDDEN_NARRATIVE_CONTENT_KEYS)[number];
export type Form8BNarrativeNoContentState = { readonly [K in ForbiddenNarrativeContentKey]?: never };

/** Official statutory text PRINTED in a ground's wording. Association only — never applicability/proof. */
export interface OfficialGroundCitation extends Form8BLegalGroundNoConclusionState {
  readonly printedReference: string;
  readonly associationOnly: true;
}

interface Pass3EvidenceBase {
  readonly ordinal: number;
  readonly frozenStructuralGroup: Form8BStructuralGroup;
  readonly frozenB4aMapReadiness: MapReadinessState;
  readonly disposition: Form8BPass3Disposition;
  /** Identity of the official control, never an answer. null only when UNRESOLVED. */
  readonly semanticKey: string | null;
  readonly officialLabelEvidence: string;
  readonly evidence: StructuralEvidenceStrength;
  readonly evidenceDetail: string;
  readonly rawLocation: string;
}

export interface Form8BLegalGroundEvidenceRecord extends Pass3EvidenceBase, Form8BLegalGroundNoConclusionState {
  readonly kind: "LEGAL_GROUND";
  readonly role: "GROUND_BOX" | "GROUND_SUB_BOX";
  /** For GROUND_SUB_BOX: the indented-under ground box (structural nesting only). */
  readonly parentGroundOrdinal: number | null;
  /** The clause the form prints (or, for 47/50, the clause both printed sub-rows share). */
  readonly officialClauseIdentity: string;
  readonly citationPrintedOnOwnRow: boolean;
  readonly statutoryAssociations: readonly OfficialGroundCitation[];
  readonly structuralConditionality: "STRUCTURALLY_CONDITIONAL_BY_PRINTED_INSTRUCTION";
  readonly printedGroupInstruction: "MULTIPLE_BOXES_PERMITTED_BY_PRINTED_INSTRUCTION";
}

export interface Form8BSignatureBlockEvidenceRecord extends Pass3EvidenceBase, Form8BSignatureNoExecutionState {
  readonly kind: "SIGNATURE_BLOCK";
  readonly role: "DATE_OF_SIGNATURE" | "SIGNER_OFFICE_OR_POSITION" | "SIGNER_PRINTED_NAME";
  /** No Form 8B control captures the signature itself: the signature line (tbl6 row17 c2) has no field. */
  readonly capturesSignatureItself: false;
  /** Where b4A's frozen rationale text reads differently from this pass's raw-XML finding. */
  readonly frozenB4aRationaleDivergence: string | null;
}

export interface Form8BNarrativeEvidenceRecord extends Pass3EvidenceBase, Form8BNarrativeNoContentState {
  readonly kind: "NARRATIVE";
  /** WHAT KIND of content the official form asks for — a description, never content. */
  readonly officialContentPurpose: string;
}

export type Form8BPass3EvidenceRecord = Form8BLegalGroundEvidenceRecord | Form8BSignatureBlockEvidenceRecord | Form8BNarrativeEvidenceRecord;

// ---------------------------------------------------------------------------
// PROVENANCE ≠ LEGAL CONCLUSION / ≠ EXECUTION.
// ---------------------------------------------------------------------------
/** Only a person's own entry may place a value in any pass-3 control. No automatic source. */
export const FORM_8B_PASS3_PERMITTED_PROVENANCE: PermittedProvenanceClasses = ["USER_ENTERED"];

/**
 * No provenance class — FACT/ALLEGATION content, MATTER_DERIVED, MACHINE_SUGGESTED,
 * PROFESSIONALLY_REVIEWED, not even USER_ENTERED — establishes, proves or makes applicable a
 * statutory ground. Legal-ground identity is not a legal-ground conclusion.
 */
export function provenanceEstablishesLegalGround(_p: FieldValueProvenance): false {
  return false;
}
/** No provenance class constitutes a signature, execution or attestation. */
export function provenanceExecutesSignature(_p: FieldValueProvenance): false {
  return false;
}
export const FORM_8B_LEGAL_GROUND_BOUNDARY =
  "LEGAL-GROUND IDENTITY != LEGAL-GROUND CONCLUSION. FACT / ALLEGATION / PROFESSIONAL_ASSESSMENT / MATTER_DERIVED / " +
  "MACHINE_SUGGESTED / PROFESSIONALLY_REVIEWED != GROUND ESTABLISHED. A printed statutory citation is an association, " +
  "not applicability, proof, legal requiredness or a recommendation. No case-intelligence output may set a ground box.";

// ---------------------------------------------------------------------------
// LEGAL-GROUND SPECS (paragraph 1, s. 74(2) CYFSA grounds as printed on the form).
// ---------------------------------------------------------------------------
interface GroundSpec extends Form8BLegalGroundNoConclusionState {
  readonly ordinal: number;
  readonly name: string;
  readonly paragraphOrdinal: number;
  readonly semanticKey: string;
  readonly label: string;
  readonly role: "GROUND_BOX" | "GROUND_SUB_BOX";
  readonly parent: number | null;
  readonly clause: string;
  readonly printed: string | null;
  readonly wording: string;
  readonly evidence: StructuralEvidenceStrength;
  readonly raw: string;
}

const P1_SECTION = "Claim by applicant — paragraph 1 (finding that the child(ren) is/are in need of protection)";
const PHYS_HARM = "the child(ren) has/have suffered physical harm, inflicted by the person having charge of the child(ren) or caused by that person's";
const RISK_PHYS_HARM = "there is a risk that the child(ren) is/are likely to suffer physical harm inflicted by the person having charge of the child(ren) or caused by that person's";
const FAIL_CARE = "failure to care for, provide for, supervise or protect the child(ren) adequately";
const NEGLECT = "pattern of neglect in caring for, providing for, supervising or protecting the child(ren)";

const GROUND_SPECS = [
  { ordinal: 47, name: "Check76", paragraphOrdinal: 142, semanticKey: "legalGround.cyfsaS74_2_a.physicalHarmSuffered",
    label: "Ground box: physical harm suffered (s. 74(2)(a) lead-in)", role: "GROUND_BOX", parent: null, clause: "74(2)(a)", printed: null,
    wording: PHYS_HARM, evidence: "DIRECT_STRUCTURAL_CONTEXT", raw: "tbl3 row13 cell1" },
  { ordinal: 48, name: "Check77", paragraphOrdinal: 146, semanticKey: "legalGround.cyfsaS74_2_a_i.physicalHarmSufferedFailureToCare",
    label: "Ground sub-box: physical harm suffered — failure to care/provide/supervise/protect [74(2)(a)(i)]", role: "GROUND_SUB_BOX", parent: 47, clause: "74(2)(a)(i)",
    printed: "subclause 74(2)(a)(i)", wording: `${FAIL_CARE} [subclause 74(2)(a)(i)].`, evidence: "DIRECT_LABEL", raw: "tbl3 row14 cell2" },
  { ordinal: 49, name: "Check78", paragraphOrdinal: 150, semanticKey: "legalGround.cyfsaS74_2_a_ii.physicalHarmSufferedPatternOfNeglect",
    label: "Ground sub-box: physical harm suffered — pattern of neglect [74(2)(a)(ii)]", role: "GROUND_SUB_BOX", parent: 47, clause: "74(2)(a)(ii)",
    printed: "subclause 74(2)(a)(ii)", wording: `${NEGLECT} [subclause 74(2)(a)(ii)].`, evidence: "DIRECT_LABEL", raw: "tbl3 row15 cell2" },
  { ordinal: 50, name: "Check79", paragraphOrdinal: 153, semanticKey: "legalGround.cyfsaS74_2_b.riskOfPhysicalHarm",
    label: "Ground box: risk of physical harm (s. 74(2)(b) lead-in)", role: "GROUND_BOX", parent: null, clause: "74(2)(b)", printed: null,
    wording: RISK_PHYS_HARM, evidence: "DIRECT_STRUCTURAL_CONTEXT", raw: "tbl3 row16 cell1" },
  { ordinal: 51, name: "Check77", paragraphOrdinal: 157, semanticKey: "legalGround.cyfsaS74_2_b_i.riskOfPhysicalHarmFailureToCare",
    label: "Ground sub-box: risk of physical harm — failure to care/provide/supervise/protect [74(2)(b)(i)]", role: "GROUND_SUB_BOX", parent: 50, clause: "74(2)(b)(i)",
    printed: "subclause 74(2)(b)(i)", wording: `${FAIL_CARE} [subclause 74(2)(b)(i)].`, evidence: "DIRECT_LABEL", raw: "tbl3 row17 cell2" },
  { ordinal: 52, name: "Check78", paragraphOrdinal: 161, semanticKey: "legalGround.cyfsaS74_2_b_ii.riskOfPhysicalHarmPatternOfNeglect",
    label: "Ground sub-box: risk of physical harm — pattern of neglect [74(2)(b)(ii)]", role: "GROUND_SUB_BOX", parent: 50, clause: "74(2)(b)(ii)",
    printed: "subclause 74(2)(b)(ii)", wording: `${NEGLECT} [subclause 74(2)(b)(ii)].`, evidence: "DIRECT_LABEL", raw: "tbl3 row18 cell2" },
  { ordinal: 53, name: "Check76", paragraphOrdinal: 164, semanticKey: "legalGround.cyfsaS74_2_c.sexualAbuseOrExploitation",
    label: "Ground box: sexually abused or sexually exploited [74(2)(c)]", role: "GROUND_BOX", parent: null, clause: "74(2)(c)", printed: "clause 74(2)(c)",
    wording: "the child(ren) has/have been sexually abused or sexually exploited, by the person having charge of the child(ren) or by another person where the person having charge knows or should know of the possibility of sexual abuse or sexual exploitation and fails to protect the child(ren) [clause 74(2)(c)].",
    evidence: "DIRECT_LABEL", raw: "tbl3 row19 cell1" },
  { ordinal: 54, name: "Check76", paragraphOrdinal: 167, semanticKey: "legalGround.cyfsaS74_2_d.riskOfSexualAbuseOrExploitation",
    label: "Ground box: risk of sexual abuse or sexual exploitation [74(2)(d)]", role: "GROUND_BOX", parent: null, clause: "74(2)(d)", printed: "clause 74(2)(d)",
    wording: "there is a risk that the child(ren) is/are likely to be sexually abused or sexually exploited, by the person having charge of the child(ren) or by another person where the person having charge knows of should know of the possibility of sexual abuse or sexual exploitation and fails to protect the child(ren) [clause 74(2)(d)].",
    evidence: "DIRECT_LABEL", raw: "tbl3 row20 cell1" },
  { ordinal: 55, name: "Check76", paragraphOrdinal: 170, semanticKey: "legalGround.cyfsaS74_2_d1.sexualExploitationChildSexTrafficking",
    label: "Ground box: sexually exploited through child sex trafficking [74(2)(d.1)]", role: "GROUND_BOX", parent: null, clause: "74(2)(d.1)", printed: "clause 74(2)(d.1)",
    wording: "the child(ren) has/have been sexually exploited as a result of being subject to child sex trafficking [clause 74(2)(d.1)].", evidence: "DIRECT_LABEL", raw: "tbl3 row21 cell1" },
  { ordinal: 56, name: "Check76", paragraphOrdinal: 173, semanticKey: "legalGround.cyfsaS74_2_d2.riskOfSexualExploitationChildSexTrafficking",
    label: "Ground box: risk of sexual exploitation through child sex trafficking [74(2)(d.2)]", role: "GROUND_BOX", parent: null, clause: "74(2)(d.2)", printed: "clause 74(2)(d.2)",
    wording: "there is a risk that the child(ren) is/are likely to be sexually exploited as a result of being subjected to child sex trafficking [clause 74(2)(d.2)].", evidence: "DIRECT_LABEL", raw: "tbl3 row22 cell1" },
  { ordinal: 57, name: "Check76", paragraphOrdinal: 176, semanticKey: "legalGround.cyfsaS74_2_e.treatmentForPhysicalHarmNotProvided",
    label: "Ground box: treatment for physical harm or suffering not provided/consented [74(2)(e)]", role: "GROUND_BOX", parent: null, clause: "74(2)(e)", printed: "clause 74(2)(e)",
    wording: "the child(ren) require(s) treatment to cure, prevent or alleviate physical harm or suffering and the child(ren)'s parent or the person having charge of the child(ren) does not provide the treatment or access to the treatment, or, where the child(ren) is/are incapable of consenting to the treatment under the Health Care Consent Act, 1996 and the parent is a substitute decision-maker for the child(ren), the parent refuses or is unavailable or unable to consent to the treatment on the child(ren)'s behalf [clause 74(2)(e)].",
    evidence: "DIRECT_LABEL", raw: "tbl3 row23 cell1" },
  { ordinal: 58, name: "Check76", paragraphOrdinal: 179, semanticKey: "legalGround.cyfsaS74_2_f.emotionalHarmFromActionsOrNeglect",
    label: "Ground box: emotional harm suffered resulting from actions/failure to act/pattern of neglect [74(2)(f)]", role: "GROUND_BOX", parent: null, clause: "74(2)(f)", printed: "clause 74(2)(f)",
    wording: "the child(ren) has/have suffered emotional harm, demonstrated by serious anxiety, depression, withdrawal, self-destructive or aggressive behaviour, or delayed development and there are reasonable grounds to believe that the emotional harm suffered by the child(ren) results from the actions, failure to act or pattern of neglect on the part of the child(ren)'s parent or the person having charge of the child(ren) [clause 74(2)(f)].",
    evidence: "DIRECT_LABEL", raw: "tbl3 row24 cell1" },
  { ordinal: 59, name: "Check76", paragraphOrdinal: 182, semanticKey: "legalGround.cyfsaS74_2_g.emotionalHarmTreatmentNotProvided",
    label: "Ground box: emotional harm suffered, treatment not provided/consented [74(2)(g)]", role: "GROUND_BOX", parent: null, clause: "74(2)(g)", printed: "clause 74(2)(g)",
    wording: "the child(ren) has/have suffered emotional harm, demonstrated by serious anxiety, depression, withdrawal, self-destructive or aggressive behaviour, or delayed development and the child(ren)'s parent or the person having charge of the child(ren) does not provide treatment or access to treatment, or, where the child(ren) is/are incapable of consenting to treatment under the Health Care Consent Act, 1996, refuses or is unavailable or unable to consent to the treatment to remedy or alleviate the harm [clause 74(2)(g)].",
    evidence: "DIRECT_LABEL", raw: "tbl3 row25 cell1" },
  { ordinal: 60, name: "Check76", paragraphOrdinal: 197, semanticKey: "legalGround.cyfsaS74_2_h.riskOfEmotionalHarmFromActionsOrNeglect",
    label: "Ground box: risk of emotional harm resulting from actions/failure to act/pattern of neglect [74(2)(h)]", role: "GROUND_BOX", parent: null, clause: "74(2)(h)", printed: "clause 74(2)(h)",
    wording: "there is a risk that the child(ren) is/are likely to suffer emotional harm, demonstrated by serious anxiety, depression, withdrawal, self-destructive or aggressive behaviour, or delayed development resulting from the actions, failure to act or pattern of neglect on the part of the child(ren)'s parent or the person having charge of the child(ren) [clause 74(2)(h)].",
    evidence: "DIRECT_LABEL", raw: "tbl4 row3 cell1" },
  { ordinal: 61, name: "Check76", paragraphOrdinal: 200, semanticKey: "legalGround.cyfsaS74_2_i.riskOfEmotionalHarmTreatmentNotProvided",
    label: "Ground box: risk of emotional harm, treatment not provided/consented [74(2)(i)]", role: "GROUND_BOX", parent: null, clause: "74(2)(i)", printed: "clause 74(2)(i)",
    wording: "there is a risk that the child(ren) is/are likely to suffer emotional harm, demonstrated by serious anxiety, depression, withdrawal, self-destructive or aggressive behaviour, or delayed development and that the child(ren)'s parent or the person having charge of the child(ren) does not provide treatment or access to treatment, or, where the child(ren) is/are incapable of consenting to treatment under the Health Care Consent Act, 1996, refuses or is unavailable or unable to consent to treatment to prevent the harm [clause 74(2)(i)].",
    evidence: "DIRECT_LABEL", raw: "tbl4 row4 cell1" },
  { ordinal: 62, name: "Check76", paragraphOrdinal: 203, semanticKey: "legalGround.cyfsaS74_2_j.developmentalConditionTreatmentNotProvided",
    label: "Ground box: mental/emotional/developmental condition, treatment not provided/consented [74(2)(j)]", role: "GROUND_BOX", parent: null, clause: "74(2)(j)", printed: "clause 74(2)(j)",
    wording: "the child(ren) suffer(s) from a mental, emotional or developmental condition that, if not remedied, could seriously impair the child(ren)'s development and the child(ren)'s parent or the person having charge of the child(ren) does not provide treatment or access to treatment, or, where the child(ren) is/are incapable of consenting to treatment under the Health Care Consent Act, 1996, refuses or is unavailable or unable to consent to the treatment to remedy or alleviate the condition [clause 74(2)(j)].",
    evidence: "DIRECT_LABEL", raw: "tbl4 row5 cell1" },
  { ordinal: 63, name: "Check76", paragraphOrdinal: 206, semanticKey: "legalGround.cyfsaS74_2_k.parentDiedOrUnavailableOrNotResumingCare",
    label: "Ground box: parent died/unavailable without adequate provision, or residential-placement care not resumed [74(2)(k)]", role: "GROUND_BOX", parent: null, clause: "74(2)(k)", printed: "clause 74(2)(k)",
    wording: "the child(ren)'s parent has died or is unavailable to exercise the rights of custody over the child(ren) and has not made adequate provision for the child(ren)'s care and custody, or the child(ren) is/are in a residential placement and the parent refuses or is unable or unwilling to resume the child(ren)'s care and custody [clause 74(2)(k)].",
    evidence: "DIRECT_LABEL", raw: "tbl4 row6 cell1" },
  { ordinal: 64, name: "Check79", paragraphOrdinal: 209, semanticKey: "legalGround.cyfsaS74_2_l.under12SeriousHarmServicesNotProvided",
    label: "Ground box: child under twelve, serious injury/damage, services or treatment not provided/consented [74(2)(l)]", role: "GROUND_BOX", parent: null, clause: "74(2)(l)", printed: "clause 74(2)(l)",
    wording: "the child(ren) is/are younger than twelve and has/have killed or seriously injured another person or caused serious damage to another person's property, services or treatment are necessary to prevent a recurrence and the child(ren)'s parent or the person having charge of the child(ren) does not provide services or treatment or access to services or treatment, or, where the child(ren) is/are incapable of consenting to treatment under the Health Care Consent Act, 1996, refuses or is unavailable or unable to consent to treatment [clause 74(2)(l)].",
    evidence: "DIRECT_LABEL", raw: "tbl4 row7 cell1" },
  { ordinal: 65, name: "Check79", paragraphOrdinal: 212, semanticKey: "legalGround.cyfsaS74_2_m.under12RepeatedHarmEncouragementOrInadequateSupervision",
    label: "Ground box: child under twelve, repeated injury/damage with encouragement or inadequate supervision [74(2)(m)]", role: "GROUND_BOX", parent: null, clause: "74(2)(m)", printed: "clause 74(2)(m)",
    wording: "the child(ren) is/are less than twelve years old and has/have, on more than one occasion, injured another person or caused loss or damage to another person's property, with the encouragement of the person having charge of the child(ren) or because of that person's failure or inability to supervise the child(ren) adequately [clause 74(2)(m)].",
    evidence: "DIRECT_LABEL", raw: "tbl4 row8 cell1" },
  { ordinal: 66, name: "Check79", paragraphOrdinal: 215, semanticKey: "legalGround.cyfsaS74_2_n.parentUnableToCareBroughtWithConsent",
    label: "Ground box: parent unable to care, brought before the court with consent(s) [74(2)(n)]", role: "GROUND_BOX", parent: null, clause: "74(2)(n)", printed: "clause 74(2)(n)",
    wording: "the child(ren)'s parent is unable to care for the child(ren) and the child(ren) is/are brought before the court with the parent's consent and, where the child(ren) is/are twelve years of age or older, with the child(ren)'s consent, for the matter to be dealt with under Part V of the Child, Youth and Family Services Act, 2017 [clause 74(2)(n)].",
    evidence: "DIRECT_LABEL", raw: "tbl4 row9 cell1" },
  { ordinal: 67, name: "Check79", paragraphOrdinal: 218, semanticKey: "legalGround.cyfsaS74_2_o.age16Or17PrescribedCircumstanceOrCondition",
    label: "Ground box: sixteen or seventeen, prescribed circumstance or condition [74(2)(o)]", role: "GROUND_BOX", parent: null, clause: "74(2)(o)", printed: "clause 74(2)(o)",
    wording: "the child(ren) is/are sixteen or seventeen years of age and a prescribed circumstance or condition exists [clause 74(2)(o)].", evidence: "DIRECT_LABEL", raw: "tbl4 row10 cell1" }
] as const satisfies readonly GroundSpec[];

// ---------------------------------------------------------------------------
// SIGNATURE-BLOCK / OTHER SPECS (page 6, 6th table rows 17..20).
// ---------------------------------------------------------------------------
interface SignatureSpec extends Form8BSignatureNoExecutionState {
  readonly ordinal: number;
  readonly paragraphOrdinal: number;
  readonly semanticKey: string;
  readonly label: string;
  readonly valueType: SemanticValueType;
  readonly role: "DATE_OF_SIGNATURE" | "SIGNER_OFFICE_OR_POSITION" | "SIGNER_PRINTED_NAME";
  readonly caption: string;
  readonly evidence: StructuralEvidenceStrength;
  readonly evidenceDetail: string;
  readonly divergence: string | null;
  readonly printedCondition: boolean;
  readonly raw: string;
}

const SIG_SECTION = "Page 6 — signature block (after paragraph 6)";
const CAPTION_BELOW =
  "Caption convention verified from raw borders: rows 17 and 19 cells carry a bottom rule (<w:bottom w:val=\"single\"/>) and the caption cells in rows 18/20 carry a top rule and no bottom rule, i.e. each caption sits directly BELOW the ruled line it describes, in the same column (same tcW).";

const SIGNATURE_SPECS = [
  { ordinal: 111, paragraphOrdinal: 416, semanticKey: "signatureBlock.dateOfSignature", label: "Date of signature", valueType: "DATE", role: "DATE_OF_SIGNATURE",
    caption: "Date of signature", evidence: "DIRECT_STRUCTURAL_CONTEXT", printedCondition: false, raw: "tbl6 row17 cell0",
    evidenceDetail: "Only field in the left ruled cell of row 17 (tcW 4869, gridSpan 7); the caption directly below it in the same column (row 18 cell0, tcW 4869) is 'Date of signature'. " + CAPTION_BELOW +
      " Row 16 above is the full-width 'Put a line through any blank space left on this page.' instruction row, so #111 is NOT inside the paragraph-6 facts cell (#110 is alone in row 15).",
    divergence: "b4A (OTHER / REQUIRES_REVIEW) could not decide between 'continuation of the facts narrative' and 'unrelated control'; the raw table/border structure resolves it as the date-of-signature blank." },
  { ordinal: 112, paragraphOrdinal: 422, semanticKey: "signatureBlock.signerOfficeOrPositionIfApplicantIsSociety", label: "Office or position of person signing (if applicant is a children's aid society)",
    valueType: "TEXT", role: "SIGNER_OFFICE_OR_POSITION", caption: "If applicant is a children's aid society, give office or position of person signing.",
    evidence: "DIRECT_STRUCTURAL_CONTEXT", printedCondition: true, raw: "tbl6 row19 cell0",
    evidenceDetail: "Left ruled cell of row 19 (tcW 4869); the caption directly below it in the same column (row 20 cell0) is 'If applicant is a children's aid society, give office or position of person signing.' " + CAPTION_BELOW +
      " Row 20 is the last row of the block, so its captions can only describe row 19.",
    divergence: "b4A rationale reads 'Positioned directly under the \"Date of signature\" column label' — positionally true (row 18 is above row 19), but under the caption-below convention that label describes #111, and #112's own caption is the office/position caption in row 20. b4A's SIGNATURE_OR_ATTESTATION group is unaffected; b4A is NOT modified." },
  { ordinal: 113, paragraphOrdinal: 424, semanticKey: "signatureBlock.signerPrintedName", label: "Printed or typed name (signature column)",
    valueType: "PERSON_NAME", role: "SIGNER_PRINTED_NAME", caption: "Print or type name.", evidence: "STRUCTURAL_INFERENCE", printedCondition: false, raw: "tbl6 row19 cell2",
    evidenceDetail: "Right ruled cell of row 19 (tcW 4861); the caption directly below it (row 20 cell2) is 'Print or type name.' " + CAPTION_BELOW +
      " That the printed name is the name of the person who signs is STRUCTURAL_INFERENCE from its position in the Signature column beneath the signature line; the caption itself does not say whose name.",
    divergence: "b4A rationale reads 'Positioned directly under the \"Signature\" column label (a static signature line captured as a legacy text field ...)'. Raw XML shows the signature line itself is row 17 cell2, which contains NO form field; #113 is the 'Print or type name.' blank. b4A's SIGNATURE_OR_ATTESTATION group is unaffected; b4A is NOT modified." }
] as const satisfies readonly SignatureSpec[];

// ---------------------------------------------------------------------------
// NARRATIVE SPEC (paragraph 6).
// ---------------------------------------------------------------------------
const NARRATIVE_SPEC = {
  ordinal: 110, paragraphOrdinal: 414, semanticKey: "narrative.para6.applicantBriefStatementOfFactsRelied",
  label: "Paragraph 6: brief statement of the facts upon which the applicant is relying",
  officialLabel: "6. The following is a brief statement of the facts upon which the applicant is relying in this application. (Set out the facts in numbered paragraphs. If you need more space, you may attach a page, but you must date and sign each additional page.)",
  officialContentPurpose:
    "The applicant's own brief statement, in numbered paragraphs, of the facts it relies on in this application. What is written there is the applicant's pleaded account; this map does not treat it as established fact and never supplies it.",
  evidence: "DIRECT_LABEL" as StructuralEvidenceStrength,
  evidenceDetail: "Only field in 6th-table row 15 (full-width cell, gridSpan 15), directly below the paragraph-6 caption (row 13) and its printed instruction (row 14).",
  raw: "tbl6 row15 cell1"
} as const satisfies Form8BNarrativeNoContentState & Record<string, unknown>;

/** Ordinals intentionally left UNRESOLVED in pass 3 (none: every control has official evidence). */
export const FORM_8B_PASS3_UNRESOLVED_ORDINALS: readonly number[] = [];

// ---------------------------------------------------------------------------
// Entries.
// ---------------------------------------------------------------------------
const CHECKBOX = { technicalType: "checkbox" as const, technicalMaxLength: null, technicalDropdownOptions: null, technicallyRequired: false };
const TEXT = { technicalType: "text" as const, technicalMaxLength: 32000, technicalDropdownOptions: null, technicallyRequired: false };

function groundEntry(s: GroundSpec): SemanticFieldMapEntry {
  return {
    semanticKey: s.semanticKey,
    label: s.label,
    description: `Official Form 8B paragraph-1 ground slot. Printed wording: ${s.wording}`,
    technicalIdentity: { ordinal: s.ordinal, name: s.name, type: "checkbox", tableDepth: 1, paragraphOrdinal: s.paragraphOrdinal },
    formSection: P1_SECTION,
    semanticConstraints: { valueType: "BOOLEAN", cardinality: "SINGLE", allowedValues: null, maxLength: null },
    technicalConstraints: CHECKBOX,
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    // Field applicability deliberately UNKNOWN (not CONDITIONALLY_APPLICABLE) so no reader can
    // confuse a form-structure state with a ground being "applicable".
    applicability: "UNKNOWN",
    permittedProvenance: FORM_8B_PASS3_PERMITTED_PROVENANCE,
    reviewSensitivity: "LEGAL_GROUND_OR_POSITION",
    mappingResolution: "HUMAN_MAPPED",
    notes:
      "Identifies WHICH printed statutory ground this box labels — never whether it is established, proven, satisfied, or should be pleaded. " +
      "The printed citation is an association only. Paragraph 1 is struck out on a status review (printed instruction).",
    warnings: s.evidence === "DIRECT_STRUCTURAL_CONTEXT"
      ? ["DIRECT_STRUCTURAL_CONTEXT: lead-in row with no citation of its own; clause identity taken from the two indented sub-rows' printed subclause citations."]
      : []
  };
}

function signatureEntry(s: SignatureSpec): SemanticFieldMapEntry {
  return {
    semanticKey: s.semanticKey,
    label: s.label,
    description: `Official Form 8B signature-block blank captioned '${s.caption}'. It does not capture, and is not, a signature.`,
    technicalIdentity: { ordinal: s.ordinal, name: "", type: "text", tableDepth: 1, paragraphOrdinal: s.paragraphOrdinal },
    formSection: SIG_SECTION,
    semanticConstraints: { valueType: s.valueType, cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
    technicalConstraints: TEXT,
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    applicability: s.printedCondition ? "CONDITIONALLY_APPLICABLE" : "UNKNOWN",
    permittedProvenance: FORM_8B_PASS3_PERMITTED_PROVENANCE,
    reviewSensitivity: "SIGNATURE_OR_ATTESTATION",
    mappingResolution: "HUMAN_MAPPED",
    notes: "No signed/executed/attested state exists in this map; the handwritten signature line has no form control. Whose details go here is not inferred.",
    warnings: [
      ...(s.evidence === "STRUCTURAL_INFERENCE" ? ["STRUCTURAL_INFERENCE: signer association inferred from column position; caption does not name whose name."] : []),
      ...(s.divergence ? ["FROZEN_B4A_RATIONALE_DIVERGENCE: see evidence record; b4A unchanged."] : [])
    ]
  };
}

const NARRATIVE_ENTRY: SemanticFieldMapEntry = {
  semanticKey: NARRATIVE_SPEC.semanticKey,
  label: NARRATIVE_SPEC.label,
  description: `Official Form 8B paragraph-6 narrative container: ${NARRATIVE_SPEC.officialContentPurpose}`,
  technicalIdentity: { ordinal: 110, name: "", type: "text", tableDepth: 1, paragraphOrdinal: NARRATIVE_SPEC.paragraphOrdinal },
  formSection: "Claim by applicant — paragraph 6 (brief statement of facts)",
  semanticConstraints: { valueType: "FREE_TEXT_NARRATIVE", cardinality: "SINGLE", allowedValues: null, maxLength: 32000 },
  technicalConstraints: TEXT,
  legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
  applicability: "UNKNOWN",
  permittedProvenance: FORM_8B_PASS3_PERMITTED_PROVENANCE,
  // b4A's frozen sensitivity for this control is SWORN_FACT; preserved, not overridden.
  reviewSensitivity: "SWORN_FACT" satisfies ReviewSensitivityCategory,
  mappingResolution: "HUMAN_MAPPED",
  notes: "Maps PURPOSE only. No content is generated, summarized, drafted or suggested; allegation is never converted to fact.",
  warnings: []
};

const GROUND_ORDERED: readonly GroundSpec[] = [...GROUND_SPECS].sort((a, b) => a.ordinal - b.ordinal);

export const FORM_8B_PASS3_SEMANTIC_ENTRIES: readonly SemanticFieldMapEntry[] = [
  ...GROUND_ORDERED.map(groundEntry),
  NARRATIVE_ENTRY,
  ...SIGNATURE_SPECS.map(signatureEntry)
].sort((a, b) => a.technicalIdentity.ordinal - b.technicalIdentity.ordinal);

const b4a = (o: number) => FORM_8B_STRUCTURAL_MANIFEST[o];

export const FORM_8B_PASS3_LEGAL_GROUND_EVIDENCE: readonly Form8BLegalGroundEvidenceRecord[] = GROUND_ORDERED.map(s => ({
  kind: "LEGAL_GROUND" as const,
  ordinal: s.ordinal,
  frozenStructuralGroup: b4a(s.ordinal).structuralGroup,
  frozenB4aMapReadiness: b4a(s.ordinal).mapReadiness,
  disposition: "MAPPED" as const,
  semanticKey: s.semanticKey,
  officialLabelEvidence: s.wording,
  evidence: s.evidence,
  evidenceDetail: s.role === "GROUND_SUB_BOX"
    ? `Checkbox in the indented cell (gridSpan 2) under ground box ${s.parent}; the same row's text cell prints the wording and the citation [${s.printed}].`
    : s.printed
      ? `Checkbox immediately followed, in the same row, by the printed ground wording ending with the citation [${s.printed}].`
      : "Checkbox followed by a lead-in sentence that ends mid-clause ('caused by that person's'); it continues in the two indented sub-rows, whose printed citations share this clause.",
  rawLocation: s.raw,
  role: s.role,
  parentGroundOrdinal: s.parent,
  officialClauseIdentity: s.clause,
  citationPrintedOnOwnRow: s.printed !== null,
  statutoryAssociations: s.printed ? [{ printedReference: s.printed, associationOnly: true as const }] : [],
  structuralConditionality: "STRUCTURALLY_CONDITIONAL_BY_PRINTED_INSTRUCTION" as const,
  printedGroupInstruction: "MULTIPLE_BOXES_PERMITTED_BY_PRINTED_INSTRUCTION" as const
}));

export const FORM_8B_PASS3_SIGNATURE_EVIDENCE: readonly Form8BSignatureBlockEvidenceRecord[] = SIGNATURE_SPECS.map(s => ({
  kind: "SIGNATURE_BLOCK" as const,
  ordinal: s.ordinal,
  frozenStructuralGroup: b4a(s.ordinal).structuralGroup,
  frozenB4aMapReadiness: b4a(s.ordinal).mapReadiness,
  disposition: "MAPPED" as const,
  semanticKey: s.semanticKey,
  officialLabelEvidence: s.caption,
  evidence: s.evidence,
  evidenceDetail: s.evidenceDetail,
  rawLocation: s.raw,
  role: s.role,
  capturesSignatureItself: false as const,
  frozenB4aRationaleDivergence: s.divergence
}));

export const FORM_8B_PASS3_NARRATIVE_EVIDENCE: readonly Form8BNarrativeEvidenceRecord[] = [{
  kind: "NARRATIVE",
  ordinal: 110,
  frozenStructuralGroup: b4a(110).structuralGroup,
  frozenB4aMapReadiness: b4a(110).mapReadiness,
  disposition: "MAPPED",
  semanticKey: NARRATIVE_SPEC.semanticKey,
  officialLabelEvidence: NARRATIVE_SPEC.officialLabel,
  evidence: NARRATIVE_SPEC.evidence,
  evidenceDetail: NARRATIVE_SPEC.evidenceDetail,
  rawLocation: NARRATIVE_SPEC.raw,
  officialContentPurpose: NARRATIVE_SPEC.officialContentPurpose
}];

export const FORM_8B_PASS3_EVIDENCE: readonly Form8BPass3EvidenceRecord[] = [
  ...FORM_8B_PASS3_LEGAL_GROUND_EVIDENCE, ...FORM_8B_PASS3_NARRATIVE_EVIDENCE, ...FORM_8B_PASS3_SIGNATURE_EVIDENCE
].sort((a, b) => a.ordinal - b.ordinal);

export const FORM_8B_PASS3_SEMANTIC_FIELD_MAP: SemanticFieldMap = {
  binding: FORM_8B_EXACT_TEMPLATE_BINDING,
  mapVersionLabel: FORM_8B_PASS3_MAP_VERSION_LABEL,
  entries: FORM_8B_PASS3_SEMANTIC_ENTRIES
};

// ---------------------------------------------------------------------------
// b4A REQUIRES_REVIEW promotions (explicit, never silent).
// ---------------------------------------------------------------------------
export interface Form8BPass3Promotion {
  readonly ordinal: number;
  readonly originalB4aRationale: string;
  readonly additionalEvidence: string;
  readonly whyResolved: string;
  readonly remainingUncertainty: string;
}
export const FORM_8B_PASS3_REQUIRES_REVIEW_PROMOTIONS: readonly Form8BPass3Promotion[] = [{
  ordinal: 111,
  originalB4aRationale: b4a(111).rationale,
  additionalEvidence: "Per-cell table geometry and borders of 6th-table rows 15-20 (not the flattened paragraph flow b4A used): #110 alone in row 15; full-width instruction row 16; #111 alone in row 17 left ruled cell with the empty right ruled cell (signature line) beside it; caption row 18 'Date of signature' | 'Signature' directly beneath with matching column widths.",
  whyResolved: "#111 is in a different row from the facts box, separated by a full-width instruction row, so it cannot be a continuation of paragraph 6; the ruled-line-with-caption-below pattern (repeated in rows 19/20, where it is the only possible reading) assigns it the 'Date of signature' caption.",
  remainingUncertainty: "Only the general caption-below convention; no competing reading survives the raw structure. Legal requiredness of dating remains UNKNOWN; no date value is implied."
}];

// ---------------------------------------------------------------------------
// Module-load guards (runtime twin of the compile-time boundaries).
// ---------------------------------------------------------------------------
{
  const derived = deriveForm8BPass3Ordinals();
  const covered = [...FORM_8B_PASS3_SEMANTIC_ENTRIES.map(e => e.technicalIdentity.ordinal), ...FORM_8B_PASS3_UNRESOLVED_ORDINALS].sort((a, b) => a - b);
  if (JSON.stringify(derived) !== JSON.stringify(covered)) {
    throw new Error(`Form 8B pass-3 specs (${covered.join(",")}) do not equal the derived remaining set (${derived.join(",")}).`);
  }
  const check = (recs: readonly object[], keys: readonly string[], what: string) => {
    for (const r of recs) for (const k of keys) {
      if (Object.prototype.hasOwnProperty.call(r, k)) throw new Error(`Form 8B pass-3 ${what} record carries forbidden property "${k}".`);
    }
  };
  check([...GROUND_ORDERED, ...FORM_8B_PASS3_LEGAL_GROUND_EVIDENCE, ...FORM_8B_PASS3_LEGAL_GROUND_EVIDENCE.flatMap(e => e.statutoryAssociations)], FORBIDDEN_LEGAL_GROUND_STATE_KEYS, "legal-ground");
  check([...SIGNATURE_SPECS, ...FORM_8B_PASS3_SIGNATURE_EVIDENCE], FORBIDDEN_SIGNATURE_EXECUTION_STATE_KEYS, "signature-block");
  check([NARRATIVE_SPEC, ...FORM_8B_PASS3_NARRATIVE_EVIDENCE], FORBIDDEN_NARRATIVE_CONTENT_KEYS, "narrative");
  check(FORM_8B_PASS3_SEMANTIC_ENTRIES, [...new Set([...FORBIDDEN_LEGAL_GROUND_STATE_KEYS, ...FORBIDDEN_SIGNATURE_EXECUTION_STATE_KEYS, ...FORBIDDEN_NARRATIVE_CONTENT_KEYS])], "map-entry");
}

// ---------------------------------------------------------------------------
// FINAL whole-form accounting across the three passes.
// ---------------------------------------------------------------------------
export type Form8BFinalCategory = "ADMINISTRATIVE" | "CHILD_PARTY" | "REQUESTED_ORDER" | "LEGAL_GROUND" | "NARRATIVE" | "SIGNATURE" | "OTHER";
export interface Form8BFinalAccountingRow {
  readonly ordinal: number;
  readonly owner: "PASS1_B4B_I" | "PASS2_B4B_II" | "PASS3_B4B_III";
  readonly disposition: "MAPPED" | "UNRESOLVED";
  /** Category from the FROZEN b4A structural group (not re-classified here). */
  readonly category: Form8BFinalCategory;
}

const CATEGORY_OF: Record<Form8BStructuralGroup, Form8BFinalCategory> = {
  COURT_ADMINISTRATION: "ADMINISTRATIVE", APPLICATION_CONTEXT: "ADMINISTRATIVE", REPRESENTATIVE_INFORMATION: "ADMINISTRATIVE",
  PARTY_IDENTIFICATION: "CHILD_PARTY", CHILD_IDENTIFICATION: "CHILD_PARTY", REQUESTED_ORDER: "REQUESTED_ORDER",
  LEGAL_GROUND_OR_POSITION: "LEGAL_GROUND", FACTUAL_NARRATIVE: "NARRATIVE", SIGNATURE_OR_ATTESTATION: "SIGNATURE", OTHER: "OTHER"
};

export interface Form8BPassSets {
  pass1Entries: readonly SemanticFieldMapEntry[];
  pass2Entries: readonly SemanticFieldMapEntry[];
  pass2Unresolved: readonly number[];
  pass3Entries: readonly SemanticFieldMapEntry[];
  pass3Unresolved: readonly number[];
}
export const FORM_8B_ACTUAL_PASS_SETS: Form8BPassSets = {
  pass1Entries: FORM_8B_PASS1_SEMANTIC_ENTRIES,
  pass2Entries: FORM_8B_PASS2_SEMANTIC_ENTRIES,
  pass2Unresolved: FORM_8B_PASS2_UNRESOLVED_ORDINALS,
  pass3Entries: FORM_8B_PASS3_SEMANTIC_ENTRIES,
  pass3Unresolved: FORM_8B_PASS3_UNRESOLVED_ORDINALS
};

export function form8bFinalAccounting(sets: Form8BPassSets = FORM_8B_ACTUAL_PASS_SETS): Form8BFinalAccountingRow[] {
  type Hit = { owner: Form8BFinalAccountingRow["owner"]; disposition: Form8BFinalAccountingRow["disposition"] };
  const hits = new Map<number, Hit[]>();
  const add = (o: number, h: Hit) => {
    if (!Number.isInteger(o) || o < 0 || o >= FORM_8B_TOTAL_TECHNICAL_CONTROLS) throw new Error(`Form 8B ordinal ${o} is not a real Form 8B control.`);
    hits.set(o, [...(hits.get(o) ?? []), h]);
  };
  const resolved = (e: SemanticFieldMapEntry) => (e.mappingResolution === "UNRESOLVED" ? "UNRESOLVED" : "MAPPED");
  for (const e of sets.pass1Entries) add(e.technicalIdentity.ordinal, { owner: "PASS1_B4B_I", disposition: resolved(e) });
  for (const e of sets.pass2Entries) add(e.technicalIdentity.ordinal, { owner: "PASS2_B4B_II", disposition: resolved(e) });
  for (const o of sets.pass2Unresolved) add(o, { owner: "PASS2_B4B_II", disposition: "UNRESOLVED" });
  for (const e of sets.pass3Entries) add(e.technicalIdentity.ordinal, { owner: "PASS3_B4B_III", disposition: resolved(e) });
  for (const o of sets.pass3Unresolved) add(o, { owner: "PASS3_B4B_III", disposition: "UNRESOLVED" });
  const out: Form8BFinalAccountingRow[] = [];
  for (let o = 0; o < FORM_8B_TOTAL_TECHNICAL_CONTROLS; o++) {
    const h = hits.get(o) ?? [];
    if (h.length !== 1) throw new Error(`Form 8B ordinal ${o} is accounted ${h.length} times (must be exactly once).`);
    out.push({ ordinal: o, ...h[0], category: CATEGORY_OF[FORM_8B_STRUCTURAL_MANIFEST[o].structuralGroup] });
  }
  return out;
}
