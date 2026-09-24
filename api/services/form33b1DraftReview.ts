// Stage 9D-4B-2A-ii — Form 33B.1 DRAFT ORCHESTRATION & HUMAN REVIEW LAYER
//
// SCOPE: Orchestrates candidate discovery, proposal selection, human review, explicit user
// authorization, value editing, rejection, conflict representation, and completeness tracking
// for Form 33B.1.
//
// HARD INVARIANT: ALL population decisions MUST flow through `attemptPopulateControl()` in
// `form33b1PopulationEngine.ts`. This orchestration layer NEVER independently decides whether
// protected legal content is authorized.
//
// FROZEN BASELINE HEAD: 84acfc3658377186a33172e1e2a054f6195b8f32

import {
  FORM_33B1_STRUCTURAL_MANIFEST,
  FORM_33B1_TOTAL_TECHNICAL_CONTROLS,
  type Form33B1StructuralManifestEntry,
  type Form33B1StructuralSection
} from "./form33b1StructuralManifest.js";
import {
  FORM_33B1_DECISION_BOUNDARIES,
  FORM_33B1_DECISION_AUTHORITIES,
  authorizePartyResponse,
  isAuthorizedPartyResponse,
  type Form33B1DecisionBoundaryEntry,
  type Form33B1DecisionCategory,
  type Form33B1DecisionAuthority,
  type Form33B1Sensitivity,
  type AuthorizedPartyResponse
} from "./form33b1DecisionBoundaries.js";
import {
  FORM_33B1_SEMANTIC_ENTRIES,
  type Form33B1SemanticEntry
} from "./form33b1SemanticFieldMapS1.js";
import {
  attemptPopulateControl,
  getForm33B1ControlDefinition,
  type Form33B1PopulationResult,
  type ControlledPopulationState,
  type PopulationOutcomeStatus,
  type Form33B1ControlDefinition
} from "./form33b1PopulationEngine.js";

// ---------------------------------------------------------------------------
// 1. NORMALIZED SOURCE CANDIDATE CONTRACT
// ---------------------------------------------------------------------------

export interface Form33B1NormalizedCandidate<T = unknown> {
  readonly candidateId: string;
  readonly ordinal: number;
  readonly stableTechnicalId: string;
  readonly proposedValue: T;
  readonly provenance: Form33B1DecisionAuthority;
  readonly sourceReferenceId: string;
  readonly confidenceScore?: number;
  readonly humanReviewNote?: string;
  readonly createdAtIso: string;
}

// ---------------------------------------------------------------------------
// 2. DRAFT CONTROL STATE & DOCUMENT STATE CONTRACT
// ---------------------------------------------------------------------------

export interface Form33B1DraftControlState<T = unknown> {
  readonly ordinal: number;
  readonly stableTechnicalId: string;
  readonly structuralSection: Form33B1StructuralSection;
  readonly decisionCategory: Form33B1DecisionCategory;
  readonly sensitivity: Form33B1Sensitivity;
  readonly requiresExplicitAuthorization: boolean;
  readonly requiresUnansweredState: boolean;
  readonly isApplicable: boolean;
  readonly candidates: readonly Form33B1NormalizedCandidate<T>[];
  readonly hasConflict: boolean;
  readonly activeProposal: Form33B1NormalizedCandidate<T> | null;
  readonly authorizationToken: AuthorizedPartyResponse<T> | null;
  readonly populationResult: Form33B1PopulationResult<T>;
}

export interface Form33B1DraftAuditEntry {
  readonly controlOrdinal: number;
  readonly stableTechnicalId: string;
  readonly actionType: string;
  readonly sourceReferenceId: string | null;
  readonly priorOutcomeStatus: PopulationOutcomeStatus;
  readonly newOutcomeStatus: PopulationOutcomeStatus;
  readonly provenance: Form33B1DecisionAuthority;
  readonly rejectionReason: string | null;
}

export interface Form33B1DraftState {
  readonly totalControls: number;
  readonly controls: readonly Form33B1DraftControlState[];
  readonly auditTrail: readonly Form33B1DraftAuditEntry[];
}

export interface Form33B1DraftCompletenessSummary {
  readonly totalControls: number;
  readonly populatedCount: number;
  readonly unansweredCount: number;
  readonly authorizationRequiredCount: number;
  readonly proposedCount: number;
  readonly conflictingCount: number;
  readonly rejectedCount: number;
  readonly notApplicableCount: number;
  readonly isTechnicallyComplete: boolean;
  readonly legalSufficiencyDisclaimer: string;
}

export const LEGAL_SUFFICIENCY_DISCLAIMER =
  "TECHNICAL COMPLETENESS DOES NOT IMPLY LEGAL SUFFICIENCY. Legal adequacy, factual accuracy, and strategic position remain the exclusive responsibility of the authorizing party and legal counsel.";

// ---------------------------------------------------------------------------
// 3. HUMAN REVIEW ACTIONS CONTRACT
// ---------------------------------------------------------------------------

export type Form33B1ReviewActionType =
  | "ADD_CANDIDATE"
  | "SELECT_PROPOSAL"
  | "REJECT_PROPOSAL"
  | "PROVIDE_USER_ANSWER"
  | "AUTHORIZE_RESPONSE"
  | "EDIT_PROPOSED_VALUE"
  | "MARK_NOT_APPLICABLE"
  | "BULK_REVIEW_ACTION";

export interface Form33B1ReviewActionPayload {
  readonly actionType: Form33B1ReviewActionType;
  readonly ordinal?: number;
  readonly stableTechnicalId?: string;
  readonly candidateId?: string;
  readonly value?: unknown;
  readonly provenance?: Form33B1DecisionAuthority;
  readonly sourceReferenceId?: string;
  readonly authorizedBy?: string;
  readonly authorizationToken?: unknown;
  readonly isApplicable?: boolean;
  readonly bulkActions?: readonly Form33B1ReviewActionPayload[];
}

// ---------------------------------------------------------------------------
// 4. DRAFT INITIALIZATION
// ---------------------------------------------------------------------------

/**
 * Creates a fresh, unpopulated Form 33B.1 draft state containing all 169 controls.
 * Every protected control begins in the frozen UNANSWERED state.
 */
export function createForm33B1DraftState(): Form33B1DraftState {
  const controls: Form33B1DraftControlState[] = [];

  for (let i = 0; i < FORM_33B1_TOTAL_TECHNICAL_CONTROLS; i++) {
    const def = getForm33B1ControlDefinition(i);
    if (!def) {
      throw new Error(`Missing control definition for ordinal ${i}`);
    }

    const initialPopulation = attemptPopulateControl({
      ordinal: i,
      provenance: "USER_ENTERED",
      isApplicable: true
    });

    controls.push(
      Object.freeze({
        ordinal: def.manifest.ordinal,
        stableTechnicalId: def.manifest.stableTechnicalId,
        structuralSection: def.manifest.structuralSection,
        decisionCategory: def.boundary.decisionCategory,
        sensitivity: def.boundary.sensitivity,
        requiresExplicitAuthorization: def.boundary.requiresExplicitAuthorization,
        requiresUnansweredState: def.boundary.requiresUnansweredState,
        isApplicable: true,
        candidates: Object.freeze([]),
        hasConflict: false,
        activeProposal: null,
        authorizationToken: null,
        populationResult: initialPopulation
      })
    );
  }

  return Object.freeze({
    totalControls: FORM_33B1_TOTAL_TECHNICAL_CONTROLS,
    controls: Object.freeze(controls),
    auditTrail: Object.freeze([])
  });
}

// ---------------------------------------------------------------------------
// 5. REVIEW ACTION TRANSITION ENGINE
// ---------------------------------------------------------------------------

/**
 * Applies a human review action or candidate discovery to the draft state, delegating ALL
 * population evaluation to `attemptPopulateControl()` in `form33b1PopulationEngine.ts`.
 */
export function applyReviewAction(
  currentState: Form33B1DraftState,
  action: Form33B1ReviewActionPayload
): Form33B1DraftState {
  // Handle Bulk Actions
  if (action.actionType === "BULK_REVIEW_ACTION") {
    if (!action.bulkActions || !Array.isArray(action.bulkActions)) {
      throw new Error("BULK_REVIEW_ACTION payload must provide a bulkActions array");
    }
    let state = currentState;
    for (const subAction of action.bulkActions) {
      state = applyReviewAction(state, subAction);
    }
    return state;
  }

  // Target control resolution
  let ordinal = action.ordinal;
  if (ordinal === undefined && action.stableTechnicalId !== undefined) {
    const def = getForm33B1ControlDefinition(action.stableTechnicalId);
    if (def) {
      ordinal = def.manifest.ordinal;
    }
  }

  if (ordinal === undefined || ordinal < 0 || ordinal >= FORM_33B1_TOTAL_TECHNICAL_CONTROLS) {
    throw new Error(`Unknown or invalid Form 33B.1 control for review action: ${action.ordinal ?? action.stableTechnicalId}`);
  }

  const def = getForm33B1ControlDefinition(ordinal);
  if (!def) {
    throw new Error(`Unknown Form 33B.1 control ordinal ${ordinal}`);
  }

  const existingControl = currentState.controls[ordinal];
  const priorOutcomeStatus = existingControl.populationResult.outcomeStatus;

  let newCandidates = [...existingControl.candidates];
  let newActiveProposal = existingControl.activeProposal;
  let newAuthToken = existingControl.authorizationToken;
  let newIsApplicable = existingControl.isApplicable;
  let actionProvenance: Form33B1DecisionAuthority = action.provenance ?? "USER_ENTERED";

  switch (action.actionType) {
    case "ADD_CANDIDATE": {
      if (!FORM_33B1_DECISION_AUTHORITIES.includes(actionProvenance)) {
        throw new Error(`Unknown provenance '${actionProvenance}' for ADD_CANDIDATE`);
      }
      if (action.value === undefined || action.value === null) {
        throw new Error("ADD_CANDIDATE action requires a non-null value");
      }

      const candidateId = `cand_${def.manifest.ordinal}_${newCandidates.length + 1}_${Date.now()}`;
      const candidate: Form33B1NormalizedCandidate = Object.freeze({
        candidateId,
        ordinal: def.manifest.ordinal,
        stableTechnicalId: def.manifest.stableTechnicalId,
        proposedValue: action.value,
        provenance: actionProvenance,
        sourceReferenceId: action.sourceReferenceId ?? "UNSPECIFIED_SOURCE",
        createdAtIso: new Date().toISOString()
      });

      newCandidates.push(candidate);

      // If no active proposal exists, default proposal to this newly added candidate
      if (!newActiveProposal) {
        newActiveProposal = candidate;
      }
      break;
    }

    case "SELECT_PROPOSAL": {
      if (!action.candidateId) {
        throw new Error("SELECT_PROPOSAL action requires a candidateId");
      }
      const found = newCandidates.find(c => c.candidateId === action.candidateId);
      if (!found) {
        throw new Error(`Candidate '${action.candidateId}' not found for control ${ordinal}`);
      }
      newActiveProposal = found;
      actionProvenance = found.provenance;

      // Note: Changing active proposal invalidates any authorization token tied to a different value!
      if (newAuthToken && newAuthToken.value !== found.proposedValue) {
        newAuthToken = null;
      }
      break;
    }

    case "REJECT_PROPOSAL": {
      if (action.candidateId) {
        newCandidates = newCandidates.filter(c => c.candidateId !== action.candidateId);
      }
      if (newActiveProposal && (!action.candidateId || newActiveProposal.candidateId === action.candidateId)) {
        newActiveProposal = newCandidates.length > 0 ? newCandidates[newCandidates.length - 1] : null;
      }
      // Rejection clears authorization
      newAuthToken = null;
      break;
    }

    case "PROVIDE_USER_ANSWER": {
      if (!FORM_33B1_DECISION_AUTHORITIES.includes(actionProvenance)) {
        throw new Error(`Unknown provenance '${actionProvenance}' for PROVIDE_USER_ANSWER`);
      }
      if (action.value === undefined || action.value === null) {
        throw new Error("PROVIDE_USER_ANSWER action requires a non-null value");
      }

      const candidateId = `user_${def.manifest.ordinal}_${Date.now()}`;
      const candidate: Form33B1NormalizedCandidate = Object.freeze({
        candidateId,
        ordinal: def.manifest.ordinal,
        stableTechnicalId: def.manifest.stableTechnicalId,
        proposedValue: action.value,
        provenance: actionProvenance,
        sourceReferenceId: action.sourceReferenceId ?? "USER_DIRECT_INPUT",
        createdAtIso: new Date().toISOString()
      });

      newCandidates.push(candidate);
      newActiveProposal = candidate;

      if (action.authorizationToken) {
        newAuthToken = action.authorizationToken as any;
      } else if (action.authorizedBy && typeof action.authorizedBy === "string" && action.authorizedBy.trim() !== "") {
        newAuthToken = authorizePartyResponse(
          def.manifest.stableTechnicalId,
          action.value,
          actionProvenance,
          action.authorizedBy
        );
      } else {
        newAuthToken = null;
      }
      break;
    }

    case "AUTHORIZE_RESPONSE": {
      const targetValue = action.value !== undefined ? action.value : newActiveProposal?.proposedValue;

      if (action.authorizationToken) {
        // Pass supplied authorization token directly to population engine for verification
        newAuthToken = action.authorizationToken as any;
      } else if (action.authorizedBy && typeof action.authorizedBy === "string" && action.authorizedBy.trim() !== "") {
        if (targetValue === undefined || targetValue === null) {
          throw new Error(`Cannot authorize response for control ${ordinal}: missing candidate value`);
        }
        newAuthToken = authorizePartyResponse(
          def.manifest.stableTechnicalId,
          targetValue,
          actionProvenance,
          action.authorizedBy
        );
      } else {
        throw new Error(`AUTHORIZE_RESPONSE requires either authorizationToken or authorizedBy string for control ${ordinal}`);
      }
      break;
    }

    case "EDIT_PROPOSED_VALUE": {
      if (action.value === undefined || action.value === null) {
        throw new Error("EDIT_PROPOSED_VALUE requires a non-null replacement value");
      }

      const candidateId = `edit_${def.manifest.ordinal}_${Date.now()}`;
      const candidate: Form33B1NormalizedCandidate = Object.freeze({
        candidateId,
        ordinal: def.manifest.ordinal,
        stableTechnicalId: def.manifest.stableTechnicalId,
        proposedValue: action.value,
        provenance: actionProvenance,
        sourceReferenceId: action.sourceReferenceId ?? "HUMAN_EDIT",
        createdAtIso: new Date().toISOString()
      });

      newCandidates.push(candidate);
      newActiveProposal = candidate;

      // CRITICAL INVARIANT: Material value change MUST INVALIDATE previous authorization!
      newAuthToken = null;
      break;
    }

    case "MARK_NOT_APPLICABLE": {
      newIsApplicable = action.isApplicable !== undefined ? action.isApplicable : false;
      break;
    }

    default: {
      throw new Error(`Unknown review action type '${(action as any).actionType}'`);
    }
  }

  // Conflict Detection: 2 or more candidates with differing proposed values
  const uniqueValues = new Set(newCandidates.map(c => JSON.stringify(c.proposedValue)));
  const hasConflict = uniqueValues.size > 1;

  // MANDATORY: Reevaluate population status EXCLUSIVELY via `attemptPopulateControl()`
  const candidateValue = newActiveProposal ? newActiveProposal.proposedValue : action.value;

  const populationResult = attemptPopulateControl({
    ordinal: def.manifest.ordinal,
    stableTechnicalId: def.manifest.stableTechnicalId,
    value: candidateValue,
    provenance: actionProvenance,
    authorizationToken: newAuthToken ?? undefined,
    isApplicable: newIsApplicable
  });

  const updatedControlState: Form33B1DraftControlState = Object.freeze({
    ordinal: def.manifest.ordinal,
    stableTechnicalId: def.manifest.stableTechnicalId,
    structuralSection: def.manifest.structuralSection,
    decisionCategory: def.boundary.decisionCategory,
    sensitivity: def.boundary.sensitivity,
    requiresExplicitAuthorization: def.boundary.requiresExplicitAuthorization,
    requiresUnansweredState: def.boundary.requiresUnansweredState,
    isApplicable: newIsApplicable,
    candidates: Object.freeze(newCandidates),
    hasConflict,
    activeProposal: newActiveProposal,
    authorizationToken: newAuthToken,
    populationResult
  });

  const auditEntry: Form33B1DraftAuditEntry = Object.freeze({
    controlOrdinal: def.manifest.ordinal,
    stableTechnicalId: def.manifest.stableTechnicalId,
    actionType: action.actionType,
    sourceReferenceId: action.sourceReferenceId ?? newActiveProposal?.sourceReferenceId ?? null,
    priorOutcomeStatus,
    newOutcomeStatus: populationResult.outcomeStatus,
    provenance: actionProvenance,
    rejectionReason: populationResult.rejectionReason
  });

  const updatedControls = [...currentState.controls];
  updatedControls[ordinal] = updatedControlState;

  return Object.freeze({
    totalControls: FORM_33B1_TOTAL_TECHNICAL_CONTROLS,
    controls: Object.freeze(updatedControls),
    auditTrail: Object.freeze([...currentState.auditTrail, auditEntry])
  });
}

// ---------------------------------------------------------------------------
// 6. DRAFT COMPLETENESS & DISCLOSURE ACCOUNTING
// ---------------------------------------------------------------------------

/**
 * Computes a deterministic summary of Form 33B.1 draft completeness.
 *
 * HARD INVARIANT: Technical completeness DOES NOT imply legal sufficiency.
 */
export function summarizeDraftCompleteness(
  draftState: Form33B1DraftState
): Form33B1DraftCompletenessSummary {
  let populatedCount = 0;
  let unansweredCount = 0;
  let authorizationRequiredCount = 0;
  let proposedCount = 0;
  let conflictingCount = 0;
  let rejectedCount = 0;
  let notApplicableCount = 0;

  for (const ctrl of draftState.controls) {
    if (ctrl.hasConflict) {
      conflictingCount++;
    }

    switch (ctrl.populationResult.outcomeStatus) {
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
      case "PROPOSED_ONLY":
        proposedCount++;
        break;
    }

    if (ctrl.activeProposal && ctrl.populationResult.outcomeStatus !== "POPULATED") {
      proposedCount++;
    }
  }

  const isTechnicallyComplete =
    populatedCount + notApplicableCount === FORM_33B1_TOTAL_TECHNICAL_CONTROLS &&
    unansweredCount === 0 &&
    authorizationRequiredCount === 0;

  return Object.freeze({
    totalControls: FORM_33B1_TOTAL_TECHNICAL_CONTROLS,
    populatedCount,
    unansweredCount,
    authorizationRequiredCount,
    proposedCount,
    conflictingCount,
    rejectedCount,
    notApplicableCount,
    isTechnicallyComplete,
    legalSufficiencyDisclaimer: LEGAL_SUFFICIENCY_DISCLAIMER
  });
}
