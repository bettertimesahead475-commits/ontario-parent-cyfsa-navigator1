// Stage 9D-4B-2A-ii-b5A-iii — Form 33B.1 DECISION-BOUNDARY CLASSIFICATION & SAFETY MODEL
//
// Source SHA256: 79d718a2de8be55001b47649a34366613b7050a69f98dfb6a4fd394870908a6e
// Source HEAD: eb536028689a03bf13cdf9e28b250a00f0db7bfc
//
// CORE SAFETY INVARIANT:
// The system classifies WHAT KIND OF HUMAN DECISION a field requires.
// The system MUST NEVER DETERMINE WHAT THE HUMAN'S DECISION IS.
// No default party position. No inferred answer. No AI-selected checkbox.

import {
  FORM_33B1_STRUCTURAL_MANIFEST,
  Form33B1StructuralSection
} from "./form33b1StructuralManifest.js";

export const FORM_33B1_DECISION_BOUNDARIES_SOURCE_SHA256 =
  "79d718a2de8be55001b47649a34366613b7050a69f98dfb6a4fd394870908a6e";

// ---------------------------------------------------------------------------
// 1. DECISION CATEGORIES
// ---------------------------------------------------------------------------
export const FORM_33B1_DECISION_CATEGORIES = [
  "ADMINISTRATIVE",
  "IDENTITY",
  "CONTACT_INFORMATION",
  "CHILD_INFORMATION",
  "FACTUAL_ASSERTION",
  "ALLEGATION_RESPONSE",
  "ADMISSION_DENIAL",
  "AGREEMENT_DISAGREEMENT",
  "LEGAL_POSITION",
  "PLAN_OF_CARE_COMMITMENT",
  "REQUESTED_ORDER",
  "SIGNATURE",
  "ATTESTATION",
  "DATE",
  "OTHER_HUMAN_DECISION",
  "NON_DECISION_INFORMATION",
  "UNKNOWN"
] as const;
export type Form33B1DecisionCategory = (typeof FORM_33B1_DECISION_CATEGORIES)[number];

// ---------------------------------------------------------------------------
// 2. DECISION AUTHORITY / PROVENANCE CLASSES
// ---------------------------------------------------------------------------
export const FORM_33B1_DECISION_AUTHORITIES = [
  "USER_ENTERED",
  "MATTER_DERIVED",
  "MACHINE_SUGGESTED",
  "PROFESSIONALLY_REVIEWED",
  "OFFICIAL_STATIC_FORM_CONTENT"
] as const;
export type Form33B1DecisionAuthority = (typeof FORM_33B1_DECISION_AUTHORITIES)[number];

// ---------------------------------------------------------------------------
// 3. SENSITIVITY LEVELS
// ---------------------------------------------------------------------------
export const FORM_33B1_SENSITIVITY_LEVELS = [
  "LOW",
  "PERSONAL_INFORMATION",
  "CHILD_PERSONAL_INFORMATION",
  "LEGAL_FACTUAL_CONTENT",
  "PARTY_POSITION",
  "HIGH_STAKES_LEGAL_DECISION",
  "SIGNATURE_OR_ATTESTATION"
] as const;
export type Form33B1Sensitivity = (typeof FORM_33B1_SENSITIVITY_LEVELS)[number];

// ---------------------------------------------------------------------------
// 4. BRANDED AUTHORIZED PARTY RESPONSE & NO-ANSWER STATE MODEL
// ---------------------------------------------------------------------------

export const AUTHORIZED_BRAND_SYMBOL = Symbol("AUTHORIZED_PARTY_RESPONSE");

/** Module-private memory registry storing genuine authorized response object references */
const AUTHORIZED_OBJECT_REGISTRY = new WeakSet<object>();

export interface AuthorizedPartyResponse<T = unknown> {
  readonly [AUTHORIZED_BRAND_SYMBOL]: "AUTHORIZED_PARTY_RESPONSE";
  readonly stableTechnicalId: string;
  readonly value: T;
  readonly provenance: Form33B1DecisionAuthority;
  readonly authorizedBy: string;
  readonly authorizedAtIso: string;
}

export interface UnansweredState {
  readonly status: "UNANSWERED";
  readonly explicitUnansweredSemantics: string;
}

export const UNANSWERED_STATE: Readonly<UnansweredState> = Object.freeze({
  status: "UNANSWERED",
  explicitUnansweredSemantics: "Absence of response is not an authorized party position"
});

export type DecisionFieldState<T = unknown> =
  | UnansweredState
  | {
      readonly status: "CANDIDATE";
      readonly candidateValue: T;
      readonly provenance: Form33B1DecisionAuthority;
      readonly rationale: string;
    }
  | AuthorizedPartyResponse<T>;

// ---------------------------------------------------------------------------
// 5. DECISION BOUNDARY MANIFEST ENTRY INTERFACE & MANIFEST BUILD
// ---------------------------------------------------------------------------
export interface Form33B1DecisionBoundaryEntry {
  readonly ordinal: number;
  readonly stableTechnicalId: string;
  readonly structuralSection: Form33B1StructuralSection;
  readonly decisionCategory: Form33B1DecisionCategory;
  readonly sensitivity: Form33B1Sensitivity;
  readonly permittedAuthorityClasses: readonly Form33B1DecisionAuthority[];
  readonly requiresExplicitAuthorization: boolean;
  readonly requiresUnansweredState: boolean;
  readonly evidence: string;
}

// ---------------------------------------------------------------------------
// 6. CONTROL-BY-CONTROL CLASSIFICATION FOR ALL 169 CONTROLS
// ---------------------------------------------------------------------------

const boundaryEntries: Form33B1DecisionBoundaryEntry[] = [];

for (let i = 0; i < FORM_33B1_STRUCTURAL_MANIFEST.length; i++) {
  const item = FORM_33B1_STRUCTURAL_MANIFEST[i];
  let category: Form33B1DecisionCategory = "UNKNOWN";
  let sensitivity: Form33B1Sensitivity = "LOW";
  let authorities: readonly Form33B1DecisionAuthority[] = ["USER_ENTERED"];
  let requiresAuth = false;
  let requiresUnanswered = false;

  switch (item.structuralSection) {
    case "COURT_ADMINISTRATION":
      category = "ADMINISTRATIVE";
      sensitivity = "LOW";
      authorities = item.ordinal === 0 ? ["USER_ENTERED", "MATTER_DERIVED", "OFFICIAL_STATIC_FORM_CONTENT"] : ["USER_ENTERED", "MATTER_DERIVED"];
      requiresAuth = false;
      requiresUnanswered = false;
      break;

    case "PARTY_IDENTIFICATION":
      if (item.stableTechnicalId.includes("address") || item.stableTechnicalId.includes("phone") || item.stableTechnicalId.includes("email") || item.stableTechnicalId.includes("fax") || item.stableTechnicalId.includes("lawyer")) {
        category = "CONTACT_INFORMATION";
        sensitivity = "PERSONAL_INFORMATION";
      } else if (item.stableTechnicalId.includes("relationship")) {
        category = "FACTUAL_ASSERTION";
        sensitivity = "PERSONAL_INFORMATION";
      } else if (item.stableTechnicalId.includes("hearingDate")) {
        category = "DATE";
        sensitivity = "LOW";
      } else if (item.stableTechnicalId.includes("childName")) {
        category = "IDENTITY";
        sensitivity = "CHILD_PERSONAL_INFORMATION";
      } else if (item.stableTechnicalId.includes("caseNumber") || item.stableTechnicalId.includes("courtLocation")) {
        category = "ADMINISTRATIVE";
        sensitivity = "LOW";
      } else {
        category = "IDENTITY";
        sensitivity = "PERSONAL_INFORMATION";
      }
      authorities = ["USER_ENTERED", "MATTER_DERIVED"];
      requiresAuth = false;
      requiresUnanswered = false;
      break;

    case "CHILD_IDENTIFICATION":
      category = "CHILD_INFORMATION";
      sensitivity = "CHILD_PERSONAL_INFORMATION";
      authorities = ["USER_ENTERED", "MATTER_DERIVED"];
      requiresAuth = false;
      requiresUnanswered = false;
      break;

    case "RESPONSE_TO_APPLICATION_CLAIMS":
      category = "ALLEGATION_RESPONSE";
      sensitivity = "LEGAL_FACTUAL_CONTENT";
      authorities = ["USER_ENTERED", "PROFESSIONALLY_REVIEWED"];
      requiresAuth = true;
      requiresUnanswered = true;
      break;

    case "PLAN_OF_CARE_PROPOSAL":
      category = "PLAN_OF_CARE_COMMITMENT";
      sensitivity = "HIGH_STAKES_LEGAL_DECISION";
      authorities = ["USER_ENTERED", "PROFESSIONALLY_REVIEWED"];
      requiresAuth = true;
      requiresUnanswered = true;
      break;

    case "REQUESTED_ORDERS":
      category = "REQUESTED_ORDER";
      sensitivity = "HIGH_STAKES_LEGAL_DECISION";
      authorities = ["USER_ENTERED", "PROFESSIONALLY_REVIEWED"];
      requiresAuth = true;
      requiresUnanswered = true;
      break;

    case "SIGNATURE_OR_ATTESTATION": {
      const idLower = item.stableTechnicalId.toLowerCase();
      if (idLower.includes("date")) {
        category = "DATE";
        sensitivity = "SIGNATURE_OR_ATTESTATION";
      } else if (idLower.includes("lawyer")) {
        category = "ATTESTATION";
        sensitivity = "SIGNATURE_OR_ATTESTATION";
      } else {
        category = "SIGNATURE";
        sensitivity = "SIGNATURE_OR_ATTESTATION";
      }
      authorities = ["USER_ENTERED"];
      requiresAuth = true;
      requiresUnanswered = true;
      break;
    }

    default:
      category = "UNKNOWN";
      sensitivity = "LOW";
      authorities = ["USER_ENTERED"];
      requiresAuth = false;
      requiresUnanswered = false;
      break;
  }

  boundaryEntries.push(
    Object.freeze({
      ordinal: item.ordinal,
      stableTechnicalId: item.stableTechnicalId,
      structuralSection: item.structuralSection,
      decisionCategory: category,
      sensitivity,
      permittedAuthorityClasses: authorities,
      requiresExplicitAuthorization: requiresAuth,
      requiresUnansweredState: requiresUnanswered,
      evidence: `Classified based on ${item.structuralSection} section role and control label ${item.rationale}`
    })
  );
}

export const FORM_33B1_DECISION_BOUNDARIES: readonly Form33B1DecisionBoundaryEntry[] =
  Object.freeze(boundaryEntries);

/**
 * Creates an authorized party response object after explicit human authorization transition,
 * strictly verifying that the transition is permitted for the given Form 33B.1 control.
 *
 * Plain objects, spread operations, Object.assign copies, JSON round-trips, booleans, or
 * unpermitted provenance cannot satisfy or fake this private registered state.
 */
export function authorizePartyResponse<T>(
  stableTechnicalId: string,
  candidateValue: T,
  provenance: Form33B1DecisionAuthority,
  authorizedBy: string
): AuthorizedPartyResponse<T> {
  const boundary = FORM_33B1_DECISION_BOUNDARIES.find(b => b.stableTechnicalId === stableTechnicalId);
  if (!boundary) {
    throw new Error(`Unknown Form 33B.1 control ID: ${stableTechnicalId}`);
  }

  if (provenance === "OFFICIAL_STATIC_FORM_CONTENT") {
    throw new Error(`Static form content cannot be authorized as a party response for control '${stableTechnicalId}'`);
  }

  if (!boundary.permittedAuthorityClasses.includes(provenance)) {
    throw new Error(
      `Provenance '${provenance}' is not permitted for control '${stableTechnicalId}'. Permitted provenance classes: ${boundary.permittedAuthorityClasses.join(", ")}`
    );
  }

  if (boundary.requiresExplicitAuthorization) {
    if (!authorizedBy || typeof authorizedBy !== "string" || authorizedBy.trim() === "") {
      throw new Error(`Party response authorization for control '${stableTechnicalId}' requires an explicit non-empty authorizer identity`);
    }
  }

  if (candidateValue === undefined || candidateValue === null) {
    throw new Error(`Cannot authorize undefined or null value for control '${stableTechnicalId}'`);
  }

  if (typeof candidateValue === "string" && candidateValue.trim() === "" && boundary.requiresExplicitAuthorization) {
    throw new Error(`Cannot authorize empty string as an authorized response for control '${stableTechnicalId}'`);
  }

  const authObj = Object.freeze({
    [AUTHORIZED_BRAND_SYMBOL]: "AUTHORIZED_PARTY_RESPONSE" as const,
    stableTechnicalId: boundary.stableTechnicalId,
    value: candidateValue,
    provenance,
    authorizedBy: authorizedBy.trim(),
    authorizedAtIso: new Date().toISOString()
  });

  AUTHORIZED_OBJECT_REGISTRY.add(authObj);
  return authObj as AuthorizedPartyResponse<T>;
}

/**
 * Validates that an object is a genuine, privately registered AuthorizedPartyResponse created by authorizePartyResponse().
 * If expectedTechnicalId is provided, also verifies that the response is bound to that exact control.
 */
export function isAuthorizedPartyResponse<T>(
  obj: unknown,
  expectedTechnicalId?: string
): obj is AuthorizedPartyResponse<T> {
  if (!obj || typeof obj !== "object") return false;
  if (!AUTHORIZED_OBJECT_REGISTRY.has(obj as object)) return false;

  const auth = obj as any;
  if (auth[AUTHORIZED_BRAND_SYMBOL] !== "AUTHORIZED_PARTY_RESPONSE") return false;
  if (!("value" in auth)) return false;
  if (typeof auth.stableTechnicalId !== "string") return false;
  if (typeof auth.provenance !== "string") return false;
  if (typeof auth.authorizedBy !== "string" || auth.authorizedBy.trim() === "") return false;
  if (typeof auth.authorizedAtIso !== "string") return false;

  if (expectedTechnicalId !== undefined && auth.stableTechnicalId !== expectedTechnicalId) {
    return false;
  }

  return true;
}
