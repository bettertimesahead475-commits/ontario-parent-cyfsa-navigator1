// Stage 9D-4B-2A-ii — Form 33B.1 CONTROLLED POPULATION / EXECUTION ENGINE
//
// SCOPE: Implements the execution layer governing how validated source information
// may flow into each of the 169 Form 33B.1 controls while strictly preserving all frozen
// structural constraints, semantic field definitions, decision categories, sensitivity
// classifications, provenance rules, explicit-authorization requirements, unanswered-state
// requirements, and signature/attestation protections.
//
// FROZEN BASELINE SHA-256: 79d718a2de8be55001b47649a34366613b7050a69f98dfb6a4fd394870908a6e
// FROZEN BASELINE HEAD: fefab4b6c711b3e32eeef706080e505e35b141f7

import {
  FORM_33B1_STRUCTURAL_MANIFEST,
  FORM_33B1_TOTAL_TECHNICAL_CONTROLS,
  type Form33B1StructuralManifestEntry,
  type Form33B1StructuralSection
} from "./form33b1StructuralManifest.js";
import {
  FORM_33B1_DECISION_BOUNDARIES,
  FORM_33B1_DECISION_AUTHORITIES,
  isAuthorizedPartyResponse,
  authorizePartyResponse,
  UNANSWERED_STATE,
  type Form33B1DecisionBoundaryEntry,
  type Form33B1DecisionCategory,
  type Form33B1DecisionAuthority,
  type Form33B1Sensitivity,
  type AuthorizedPartyResponse,
  type UnansweredState
} from "./form33b1DecisionBoundaries.js";
import {
  FORM_33B1_SEMANTIC_ENTRIES,
  FORM_33B1_SEMANTIC_FIELD_MAP,
  type Form33B1SemanticEntry
} from "./form33b1SemanticFieldMapS1.js";

// ---------------------------------------------------------------------------
// 1. CONTROLLED POPULATION STATES & OUTCOME CONTRACTS
// ---------------------------------------------------------------------------

export type ControlledPopulationState =
  | "UNANSWERED"
  | "SOURCE_AVAILABLE"
  | "PROPOSED"
  | "USER_ENTERED"
  | "USER_AUTHORIZED"
  | "REJECTED"
  | "NOT_APPLICABLE";

export type PopulationOutcomeStatus =
  | "POPULATED"
  | "PROPOSED_ONLY"
  | "UNANSWERED"
  | "AUTHORIZATION_REQUIRED"
  | "PROVENANCE_REJECTED"
  | "INVALID_VALUE"
  | "NOT_APPLICABLE";

export interface Form33B1PopulationRequest<T = unknown> {
  /** 0-based ordinal in Form 33B.1 (0..168). Optional if stableTechnicalId is provided. */
  readonly ordinal?: number;
  /** Stable technical ID. Optional if ordinal is provided. */
  readonly stableTechnicalId?: string;
  /** Candidate value to populate or propose. */
  readonly value?: T;
  /** Decision authority provenance of the candidate value. */
  readonly provenance: Form33B1DecisionAuthority;
  /** Explicit authorization object created via authorizePartyResponse(). */
  readonly authorizationToken?: unknown;
  /** Optional applicability flag (default: true). */
  readonly isApplicable?: boolean;
  /** Optional metadata describing source context (e.g. evidence document reference). */
  readonly sourceContext?: string;
}

export interface Form33B1PopulationResult<T = unknown> {
  readonly ordinal: number;
  readonly stableTechnicalId: string;
  readonly structuralSection: Form33B1StructuralSection;
  readonly decisionCategory: Form33B1DecisionCategory;
  readonly sensitivity: Form33B1Sensitivity;
  readonly outcomeStatus: PopulationOutcomeStatus;
  readonly controlledState: ControlledPopulationState;
  /** Populated value. ONLY non-null if outcomeStatus === "POPULATED". */
  readonly populatedValue: T | null;
  /** Proposed/source value when available but unpopulated/unauthorized. */
  readonly proposedValue: T | null;
  readonly sourceProvenance: Form33B1DecisionAuthority;
  readonly requiresExplicitAuthorization: boolean;
  readonly requiresUnansweredState: boolean;
  readonly authorizationSatisfied: boolean;
  readonly authorizerIdentity: string | null;
  readonly semanticRuleApplied: string;
  readonly rejectionReason: string | null;
}

export interface Form33B1ControlDefinition {
  readonly manifest: Form33B1StructuralManifestEntry;
  readonly boundary: Form33B1DecisionBoundaryEntry;
  readonly semantic: Form33B1SemanticEntry;
}

// ---------------------------------------------------------------------------
// 2. CONTROL RESOLUTION & REGISTRY LOOKUP
// ---------------------------------------------------------------------------

const CONTROL_BY_ORDINAL = new Map<number, Form33B1ControlDefinition>();
const CONTROL_BY_STABLE_ID = new Map<string, Form33B1ControlDefinition>();

for (let i = 0; i < FORM_33B1_TOTAL_TECHNICAL_CONTROLS; i++) {
  const manifest = FORM_33B1_STRUCTURAL_MANIFEST[i];
  const boundary = FORM_33B1_DECISION_BOUNDARIES[i];
  const semantic = FORM_33B1_SEMANTIC_ENTRIES[i];

  if (!manifest || !boundary || !semantic) {
    throw new Error(`Incomplete baseline alignment for Form 33B.1 control ordinal ${i}`);
  }

  if (manifest.ordinal !== i || boundary.ordinal !== i || semantic.ordinal !== i) {
    throw new Error(`Ordinal mismatch for Form 33B.1 control ordinal ${i}`);
  }

  if (
    manifest.stableTechnicalId !== boundary.stableTechnicalId ||
    boundary.stableTechnicalId !== semantic.stableTechnicalId
  ) {
    throw new Error(`Stable Technical ID mismatch for Form 33B.1 control ordinal ${i}`);
  }

  const def: Form33B1ControlDefinition = Object.freeze({
    manifest,
    boundary,
    semantic
  });

  CONTROL_BY_ORDINAL.set(i, def);
  CONTROL_BY_STABLE_ID.set(manifest.stableTechnicalId, def);
}

/**
 * Retrieves the full combined control definition (manifest + boundary + semantic map)
 * for any of the 169 Form 33B.1 controls by ordinal or stable technical ID.
 */
export function getForm33B1ControlDefinition(
  identifier: number | string
): Form33B1ControlDefinition | null {
  if (typeof identifier === "number") {
    return CONTROL_BY_ORDINAL.get(identifier) || null;
  }
  if (typeof identifier === "string") {
    return CONTROL_BY_STABLE_ID.get(identifier) || null;
  }
  return null;
}

// ---------------------------------------------------------------------------
// 3. CONTROLLED POPULATION EXECUTION ENGINE
// ---------------------------------------------------------------------------

/**
 * Attempts to populate a single Form 33B.1 control according to the frozen structural,
 * semantic, decision boundary, provenance, and authorization security rules.
 *
 * HARD INVARIANTS:
 * 1. Missing explicit authorization on protected controls (41..168) ALWAYS preserves UNANSWERED state.
 * 2. Matter-derived and machine-suggested facts can NEVER populate protected controls.
 * 3. Authorization is control-specific; tokens generated for one control cannot populate another.
 * 4. Fake, spread, assigned, or mutated authorization objects fail closed.
 */
export function attemptPopulateControl<T = unknown>(
  request: Form33B1PopulationRequest<T>
): Form33B1PopulationResult<T> {
  // 1. Resolve Control Definition
  let def: Form33B1ControlDefinition | null = null;
  if (request.ordinal !== undefined) {
    def = getForm33B1ControlDefinition(request.ordinal);
  } else if (request.stableTechnicalId !== undefined) {
    def = getForm33B1ControlDefinition(request.stableTechnicalId);
  }

  if (!def) {
    return Object.freeze({
      ordinal: request.ordinal ?? -1,
      stableTechnicalId: request.stableTechnicalId ?? "UNKNOWN_CONTROL",
      structuralSection: "COURT_ADMINISTRATION",
      decisionCategory: "UNKNOWN",
      sensitivity: "LOW",
      outcomeStatus: "INVALID_VALUE",
      controlledState: "REJECTED",
      populatedValue: null,
      proposedValue: null,
      sourceProvenance: request.provenance ?? "USER_ENTERED",
      requiresExplicitAuthorization: false,
      requiresUnansweredState: false,
      authorizationSatisfied: false,
      authorizerIdentity: null,
      semanticRuleApplied: "FAIL_CLOSED_UNKNOWN_CONTROL",
      rejectionReason: "Unknown or invalid Form 33B.1 control identifier"
    });
  }

  const { manifest, boundary } = def;

  // 2. Applicability Check
  if (request.isApplicable === false) {
    return Object.freeze({
      ordinal: manifest.ordinal,
      stableTechnicalId: manifest.stableTechnicalId,
      structuralSection: manifest.structuralSection,
      decisionCategory: boundary.decisionCategory,
      sensitivity: boundary.sensitivity,
      outcomeStatus: "NOT_APPLICABLE",
      controlledState: "NOT_APPLICABLE",
      populatedValue: null,
      proposedValue: null,
      sourceProvenance: request.provenance,
      requiresExplicitAuthorization: boundary.requiresExplicitAuthorization,
      requiresUnansweredState: boundary.requiresUnansweredState,
      authorizationSatisfied: false,
      authorizerIdentity: null,
      semanticRuleApplied: "APPLICABILITY_CHECK",
      rejectionReason: null
    });
  }

  // 3. Provenance Format Verification
  if (!FORM_33B1_DECISION_AUTHORITIES.includes(request.provenance)) {
    return Object.freeze({
      ordinal: manifest.ordinal,
      stableTechnicalId: manifest.stableTechnicalId,
      structuralSection: manifest.structuralSection,
      decisionCategory: boundary.decisionCategory,
      sensitivity: boundary.sensitivity,
      outcomeStatus: "PROVENANCE_REJECTED",
      controlledState: "REJECTED",
      populatedValue: null,
      proposedValue: null,
      sourceProvenance: request.provenance,
      requiresExplicitAuthorization: boundary.requiresExplicitAuthorization,
      requiresUnansweredState: boundary.requiresUnansweredState,
      authorizationSatisfied: false,
      authorizerIdentity: null,
      semanticRuleApplied: "PROVENANCE_VALIDATION",
      rejectionReason: `Unknown or unpermitted decision authority provenance '${String(request.provenance)}'`
    });
  }

  // 4. Protected Control Handling (Requires Explicit Authorization: Ordinals 41..168)
  if (boundary.requiresExplicitAuthorization) {
    const rawCandidate = request.value;

    // Check if valid explicit party authorization token was supplied
    const isValidAuth = isAuthorizedPartyResponse<T>(
      request.authorizationToken,
      boundary.stableTechnicalId
    );

    if (isValidAuth) {
      const authObj = request.authorizationToken as AuthorizedPartyResponse<T>;
      return Object.freeze({
        ordinal: manifest.ordinal,
        stableTechnicalId: manifest.stableTechnicalId,
        structuralSection: manifest.structuralSection,
        decisionCategory: boundary.decisionCategory,
        sensitivity: boundary.sensitivity,
        outcomeStatus: "POPULATED",
        controlledState: "USER_AUTHORIZED",
        populatedValue: authObj.value,
        proposedValue: null,
        sourceProvenance: authObj.provenance,
        requiresExplicitAuthorization: true,
        requiresUnansweredState: true,
        authorizationSatisfied: true,
        authorizerIdentity: authObj.authorizedBy,
        semanticRuleApplied: "EXPLICIT_HUMAN_AUTHORIZATION_SATISFIED",
        rejectionReason: null
      });
    }

    // Explicit authorization is missing or invalid.
    // Check whether the provenance is restricted for this control (e.g. signature controls strictly require USER_ENTERED).
    const isPermittedProvenance = boundary.permittedAuthorityClasses.includes(request.provenance);

    let controlledState: ControlledPopulationState = "UNANSWERED";
    let outcomeStatus: PopulationOutcomeStatus = "AUTHORIZATION_REQUIRED";
    let rejectionReason = "Explicit party authorization required for this control but missing or invalid authorization object";

    if (request.provenance === "MATTER_DERIVED") {
      controlledState = "SOURCE_AVAILABLE";
      if (!isPermittedProvenance) {
        rejectionReason = `Provenance 'MATTER_DERIVED' is not permitted for high-stakes protected control '${manifest.stableTechnicalId}'`;
      }
    } else if (request.provenance === "MACHINE_SUGGESTED") {
      controlledState = "PROPOSED";
      if (!isPermittedProvenance) {
        rejectionReason = `Provenance 'MACHINE_SUGGESTED' is not permitted for high-stakes protected control '${manifest.stableTechnicalId}'`;
      }
    } else if (!isPermittedProvenance) {
      outcomeStatus = "PROVENANCE_REJECTED";
      controlledState = "REJECTED";
      rejectionReason = `Provenance '${request.provenance}' is not permitted for protected control '${manifest.stableTechnicalId}'`;
    }

    return Object.freeze({
      ordinal: manifest.ordinal,
      stableTechnicalId: manifest.stableTechnicalId,
      structuralSection: manifest.structuralSection,
      decisionCategory: boundary.decisionCategory,
      sensitivity: boundary.sensitivity,
      outcomeStatus,
      controlledState,
      populatedValue: null,
      proposedValue: rawCandidate !== undefined ? rawCandidate : null,
      sourceProvenance: request.provenance,
      requiresExplicitAuthorization: true,
      requiresUnansweredState: true,
      authorizationSatisfied: false,
      authorizerIdentity: null,
      semanticRuleApplied: "PROTECTED_CONTROL_PRESERVE_UNANSWERED",
      rejectionReason
    });
  }

  // 5. Non-Protected Administrative / Identification Controls (Ordinals 0..40)
  const isPermittedProvenance = boundary.permittedAuthorityClasses.includes(request.provenance);
  if (!isPermittedProvenance) {
    return Object.freeze({
      ordinal: manifest.ordinal,
      stableTechnicalId: manifest.stableTechnicalId,
      structuralSection: manifest.structuralSection,
      decisionCategory: boundary.decisionCategory,
      sensitivity: boundary.sensitivity,
      outcomeStatus: "PROVENANCE_REJECTED",
      controlledState: "REJECTED",
      populatedValue: null,
      proposedValue: request.value !== undefined ? request.value : null,
      sourceProvenance: request.provenance,
      requiresExplicitAuthorization: false,
      requiresUnansweredState: false,
      authorizationSatisfied: false,
      authorizerIdentity: null,
      semanticRuleApplied: "PERMITTED_PROVENANCE_CHECK",
      rejectionReason: `Provenance '${request.provenance}' is not in permitted authority classes [${boundary.permittedAuthorityClasses.join(", ")}] for control '${manifest.stableTechnicalId}'`
    });
  }

  if (request.value === undefined || request.value === null) {
    return Object.freeze({
      ordinal: manifest.ordinal,
      stableTechnicalId: manifest.stableTechnicalId,
      structuralSection: manifest.structuralSection,
      decisionCategory: boundary.decisionCategory,
      sensitivity: boundary.sensitivity,
      outcomeStatus: "INVALID_VALUE",
      controlledState: "UNANSWERED",
      populatedValue: null,
      proposedValue: null,
      sourceProvenance: request.provenance,
      requiresExplicitAuthorization: false,
      requiresUnansweredState: false,
      authorizationSatisfied: false,
      authorizerIdentity: null,
      semanticRuleApplied: "VALUE_PRESENCE_CHECK",
      rejectionReason: "Value is undefined or null for non-protected control"
    });
  }

  const controlledState: ControlledPopulationState =
    request.provenance === "USER_ENTERED" ? "USER_ENTERED" : "SOURCE_AVAILABLE";

  return Object.freeze({
    ordinal: manifest.ordinal,
    stableTechnicalId: manifest.stableTechnicalId,
    structuralSection: manifest.structuralSection,
    decisionCategory: boundary.decisionCategory,
    sensitivity: boundary.sensitivity,
    outcomeStatus: "POPULATED",
    controlledState,
    populatedValue: request.value,
    proposedValue: null,
    sourceProvenance: request.provenance,
    requiresExplicitAuthorization: false,
    requiresUnansweredState: false,
    authorizationSatisfied: false,
    authorizerIdentity: null,
    semanticRuleApplied: "UNPROTECTED_CONTROL_POPULATED",
    rejectionReason: null
  });
}

// ---------------------------------------------------------------------------
// 4. BATCH POPULATION ENGINE & DOCUMENT STATE CONTAINER
// ---------------------------------------------------------------------------

export interface Form33B1DocumentPopulationState {
  readonly totalControls: number;
  readonly populatedCount: number;
  readonly unansweredCount: number;
  readonly authorizationRequiredCount: number;
  readonly rejectedCount: number;
  readonly notApplicableCount: number;
  readonly results: readonly Form33B1PopulationResult[];
}

/**
 * Evaluates population requests across Form 33B.1 controls, returning a deterministic
 * accounting of document state.
 */
export function populateForm33B1Document(
  requests: readonly Form33B1PopulationRequest[]
): Form33B1DocumentPopulationState {
  const mapByOrdinal = new Map<number, Form33B1PopulationRequest>();
  for (const req of requests) {
    if (req.ordinal !== undefined) {
      mapByOrdinal.set(req.ordinal, req);
    } else if (req.stableTechnicalId !== undefined) {
      const def = getForm33B1ControlDefinition(req.stableTechnicalId);
      if (def) {
        mapByOrdinal.set(def.manifest.ordinal, req);
      }
    }
  }

  const results: Form33B1PopulationResult[] = [];
  let populatedCount = 0;
  let unansweredCount = 0;
  let authorizationRequiredCount = 0;
  let rejectedCount = 0;
  let notApplicableCount = 0;

  for (let i = 0; i < FORM_33B1_TOTAL_TECHNICAL_CONTROLS; i++) {
    const req = mapByOrdinal.get(i);
    let result: Form33B1PopulationResult;

    if (!req) {
      // Default state for unspecified controls: UNANSWERED
      const def = getForm33B1ControlDefinition(i)!;
      result = Object.freeze({
        ordinal: def.manifest.ordinal,
        stableTechnicalId: def.manifest.stableTechnicalId,
        structuralSection: def.manifest.structuralSection,
        decisionCategory: def.boundary.decisionCategory,
        sensitivity: def.boundary.sensitivity,
        outcomeStatus: def.boundary.requiresExplicitAuthorization ? "AUTHORIZATION_REQUIRED" : "UNANSWERED",
        controlledState: "UNANSWERED",
        populatedValue: null,
        proposedValue: null,
        sourceProvenance: "USER_ENTERED",
        requiresExplicitAuthorization: def.boundary.requiresExplicitAuthorization,
        requiresUnansweredState: def.boundary.requiresUnansweredState,
        authorizationSatisfied: false,
        authorizerIdentity: null,
        semanticRuleApplied: "UNSPECIFIED_DEFAULT_UNANSWERED",
        rejectionReason: null
      });
    } else {
      result = attemptPopulateControl(req);
    }

    results.push(result);

    switch (result.outcomeStatus) {
      case "POPULATED":
        populatedCount++;
        break;
      case "UNANSWERED":
        unansweredCount++;
        break;
      case "AUTHORIZATION_REQUIRED":
        authorizationRequiredCount++;
        unansweredCount++;
        break;
      case "PROVENANCE_REJECTED":
      case "INVALID_VALUE":
        rejectedCount++;
        break;
      case "NOT_APPLICABLE":
        notApplicableCount++;
        break;
      default:
        break;
    }
  }

  return Object.freeze({
    totalControls: FORM_33B1_TOTAL_TECHNICAL_CONTROLS,
    populatedCount,
    unansweredCount,
    authorizationRequiredCount,
    rejectedCount,
    notApplicableCount,
    results: Object.freeze(results)
  });
}
