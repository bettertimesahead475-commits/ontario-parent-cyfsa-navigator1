// Stage 9D-4B-2A-ii — Form 33B.1 DRAFT ORCHESTRATION & HUMAN REVIEW SUITE
//
// Verifies all 27 security, safety, provenance, authorization, structural,
// human-review transition, conflict, and completeness requirements.

import { describe, it, expect } from "vitest";
import {
  createForm33B1DraftState,
  applyReviewAction,
  summarizeDraftCompleteness,
  LEGAL_SUFFICIENCY_DISCLAIMER,
  type Form33B1DraftState
} from "./form33b1DraftReview.js";
import {
  FORM_33B1_STRUCTURAL_MANIFEST,
  FORM_33B1_TOTAL_TECHNICAL_CONTROLS
} from "./form33b1StructuralManifest.js";
import {
  FORM_33B1_DECISION_BOUNDARIES,
  authorizePartyResponse
} from "./form33b1DecisionBoundaries.js";
import {
  FORM_33B1_SEMANTIC_ENTRIES,
  FORM_33B1_SEMANTIC_FIELD_MAP
} from "./form33b1SemanticFieldMapS1.js";
import {
  attemptPopulateControl,
  getForm33B1ControlDefinition
} from "./form33b1PopulationEngine.js";

describe("Form 33B.1 Draft Orchestration & Human Review Layer", () => {
  // REQUIREMENT 1: All 169 controls can exist in draft state
  it("1. recognizes and initializes all 169 controls in draft state", () => {
    const draft = createForm33B1DraftState();
    expect(draft.totalControls).toBe(169);
    expect(draft.controls.length).toBe(169);
    for (let i = 0; i < 169; i++) {
      expect(draft.controls[i].ordinal).toBe(i);
      expect(draft.controls[i].stableTechnicalId).toBeTruthy();
    }
  });

  // REQUIREMENT 2: Initial protected controls preserve unanswered state
  it("2. preserves UNANSWERED state for all protected controls (ordinals 41..168) at initialization", () => {
    const draft = createForm33B1DraftState();
    for (let ordinal = 41; ordinal <= 168; ordinal++) {
      const ctrl = draft.controls[ordinal];
      expect(ctrl.requiresExplicitAuthorization).toBe(true);
      expect(ctrl.populationResult.outcomeStatus).toBe("AUTHORIZATION_REQUIRED");
      expect(ctrl.populationResult.controlledState).toBe("UNANSWERED");
      expect(ctrl.populationResult.populatedValue).toBeNull();
    }
  });

  // REQUIREMENT 3: Source candidate != populated answer
  it("3. proves adding a source candidate does NOT populate a protected control", () => {
    let draft = createForm33B1DraftState();
    draft = applyReviewAction(draft, {
      actionType: "ADD_CANDIDATE",
      ordinal: 41,
      value: "Evidence-derived allegation fact",
      provenance: "MATTER_DERIVED",
      sourceReferenceId: "CAS_REPORT_2026"
    });

    const ctrl = draft.controls[41];
    expect(ctrl.candidates.length).toBe(1);
    expect(ctrl.activeProposal?.proposedValue).toBe("Evidence-derived allegation fact");
    expect(ctrl.populationResult.populatedValue).toBeNull();
    expect(ctrl.populationResult.outcomeStatus).toBe("AUTHORIZATION_REQUIRED");
    expect(ctrl.populationResult.controlledState).toBe("SOURCE_AVAILABLE");
  });

  // REQUIREMENT 4: Proposal != authorization
  it("4. proves selecting a proposal does NOT satisfy explicit authorization", () => {
    let draft = createForm33B1DraftState();
    draft = applyReviewAction(draft, {
      actionType: "ADD_CANDIDATE",
      ordinal: 50,
      value: "Proposed AI denial",
      provenance: "MACHINE_SUGGESTED"
    });

    const candId = draft.controls[50].candidates[0].candidateId;
    draft = applyReviewAction(draft, {
      actionType: "SELECT_PROPOSAL",
      ordinal: 50,
      candidateId: candId
    });

    const ctrl = draft.controls[50];
    expect(ctrl.activeProposal?.proposedValue).toBe("Proposed AI denial");
    expect(ctrl.populationResult.populatedValue).toBeNull();
    expect(ctrl.populationResult.outcomeStatus).toBe("AUTHORIZATION_REQUIRED");
    expect(ctrl.populationResult.controlledState).toBe("PROPOSED");
  });

  // REQUIREMENT 5: User rejection != opposite legal position
  it("5. proves rejecting a proposal does NOT create an opposite legal position", () => {
    let draft = createForm33B1DraftState();
    draft = applyReviewAction(draft, {
      actionType: "ADD_CANDIDATE",
      ordinal: 42,
      value: "Admit paragraph 2",
      provenance: "MACHINE_SUGGESTED"
    });

    const candId = draft.controls[42].candidates[0].candidateId;
    draft = applyReviewAction(draft, {
      actionType: "REJECT_PROPOSAL",
      ordinal: 42,
      candidateId: candId
    });

    const ctrl = draft.controls[42];
    expect(ctrl.candidates.length).toBe(0);
    expect(ctrl.activeProposal).toBeNull();
    expect(ctrl.populationResult.populatedValue).toBeNull();
    expect(ctrl.populationResult.outcomeStatus).toBe("AUTHORIZATION_REQUIRED");
    expect(ctrl.populationResult.controlledState).toBe("UNANSWERED");
  });

  // REQUIREMENT 6: Genuine authorization flows through the population engine
  it("6. permits population when genuine explicit human authorization is provided", () => {
    let draft = createForm33B1DraftState();
    draft = applyReviewAction(draft, {
      actionType: "PROVIDE_USER_ANSWER",
      ordinal: 41,
      value: "Parent denies allegation 1",
      provenance: "USER_ENTERED",
      authorizedBy: "Parent Jane Doe"
    });

    const ctrl = draft.controls[41];
    expect(ctrl.populationResult.outcomeStatus).toBe("POPULATED");
    expect(ctrl.populationResult.controlledState).toBe("USER_AUTHORIZED");
    expect(ctrl.populationResult.populatedValue).toBe("Parent denies allegation 1");
    expect(ctrl.populationResult.authorizerIdentity).toBe("Parent Jane Doe");
  });

  // REQUIREMENT 7: Cross-control authorization fails
  it("7. prevents token generated for one control from populating another", () => {
    const def41 = getForm33B1ControlDefinition(41)!;
    const token41 = authorizePartyResponse(
      def41.manifest.stableTechnicalId,
      "Answer for 41",
      "USER_ENTERED",
      "Parent Jane Doe"
    );

    let draft = createForm33B1DraftState();
    draft = applyReviewAction(draft, {
      actionType: "AUTHORIZE_RESPONSE",
      ordinal: 42,
      value: "Answer for 42",
      authorizationToken: token41,
      authorizedBy: "Parent Jane Doe"
    });

    const ctrl42 = draft.controls[42];
    expect(ctrl42.populationResult.outcomeStatus).toBe("AUTHORIZATION_REQUIRED");
    expect(ctrl42.populationResult.populatedValue).toBeNull();
  });

  // REQUIREMENT 8: Authorization for one value cannot blindly authorize a materially changed value
  it("8. invalidates authorization when a proposed value is edited to a new value", () => {
    let draft = createForm33B1DraftState();
    draft = applyReviewAction(draft, {
      actionType: "PROVIDE_USER_ANSWER",
      ordinal: 45,
      value: "Original Answer A",
      provenance: "USER_ENTERED",
      authorizedBy: "Parent Jane Doe"
    });
    expect(draft.controls[45].populationResult.outcomeStatus).toBe("POPULATED");

    // Edit to value B without re-authorizing
    draft = applyReviewAction(draft, {
      actionType: "EDIT_PROPOSED_VALUE",
      ordinal: 45,
      value: "Modified Answer B",
      provenance: "USER_ENTERED"
    });

    const ctrl = draft.controls[45];
    expect(ctrl.activeProposal?.proposedValue).toBe("Modified Answer B");
    expect(ctrl.authorizationToken).toBeNull();
    expect(ctrl.populationResult.populatedValue).toBeNull();
    expect(ctrl.populationResult.outcomeStatus).toBe("AUTHORIZATION_REQUIRED");
  });

  // REQUIREMENT 9: Multiple candidates remain independently represented
  it("9. independently preserves multiple source candidates for a single control", () => {
    let draft = createForm33B1DraftState();
    draft = applyReviewAction(draft, {
      actionType: "ADD_CANDIDATE",
      ordinal: 60,
      value: "Source A view",
      provenance: "MATTER_DERIVED",
      sourceReferenceId: "DOC_1"
    });

    draft = applyReviewAction(draft, {
      actionType: "ADD_CANDIDATE",
      ordinal: 60,
      value: "Source B view",
      provenance: "MACHINE_SUGGESTED",
      sourceReferenceId: "MODEL_PROMPT_1"
    });

    const ctrl = draft.controls[60];
    expect(ctrl.candidates.length).toBe(2);
    expect(ctrl.candidates[0].proposedValue).toBe("Source A view");
    expect(ctrl.candidates[1].proposedValue).toBe("Source B view");
  });

  // REQUIREMENT 10: Conflicting protected candidates remain unresolved
  it("10. flags candidate conflicts and maintains UNANSWERED state", () => {
    let draft = createForm33B1DraftState();
    draft = applyReviewAction(draft, {
      actionType: "ADD_CANDIDATE",
      ordinal: 70,
      value: "Admit paragraph 5",
      provenance: "MATTER_DERIVED"
    });
    draft = applyReviewAction(draft, {
      actionType: "ADD_CANDIDATE",
      ordinal: 70,
      value: "Deny paragraph 5",
      provenance: "MACHINE_SUGGESTED"
    });

    const ctrl = draft.controls[70];
    expect(ctrl.hasConflict).toBe(true);
    expect(ctrl.populationResult.populatedValue).toBeNull();
    expect(ctrl.populationResult.outcomeStatus).toBe("AUTHORIZATION_REQUIRED");
  });

  // REQUIREMENT 11: MATTER_DERIVED candidate cannot populate protected controls
  it("11. rejects MATTER_DERIVED candidate from populating protected controls", () => {
    let draft = createForm33B1DraftState();
    draft = applyReviewAction(draft, {
      actionType: "ADD_CANDIDATE",
      ordinal: 80,
      value: "CAS intake note fact",
      provenance: "MATTER_DERIVED"
    });

    const ctrl = draft.controls[80];
    expect(ctrl.populationResult.populatedValue).toBeNull();
    expect(ctrl.populationResult.outcomeStatus).toBe("AUTHORIZATION_REQUIRED");
  });

  // REQUIREMENT 12: MACHINE_SUGGESTED candidate cannot populate protected controls
  it("12. rejects MACHINE_SUGGESTED candidate from populating protected controls", () => {
    let draft = createForm33B1DraftState();
    draft = applyReviewAction(draft, {
      actionType: "ADD_CANDIDATE",
      ordinal: 90,
      value: "AI summary suggestion",
      provenance: "MACHINE_SUGGESTED"
    });

    const ctrl = draft.controls[90];
    expect(ctrl.populationResult.populatedValue).toBeNull();
    expect(ctrl.populationResult.outcomeStatus).toBe("AUTHORIZATION_REQUIRED");
  });

  // REQUIREMENT 13: Unknown provenance fails closed
  it("13. fails closed when an unknown decision authority provenance is provided", () => {
    const draft = createForm33B1DraftState();
    expect(() =>
      applyReviewAction(draft, {
        actionType: "ADD_CANDIDATE",
        ordinal: 0,
        value: "City",
        provenance: "INVALID_PROVENANCE_TYPE" as any
      })
    ).toThrow(/Unknown provenance/);
  });

  // REQUIREMENT 14: Unknown control fails closed
  it("14. fails closed when targeting an unknown control ordinal or ID", () => {
    const draft = createForm33B1DraftState();
    expect(() =>
      applyReviewAction(draft, {
        actionType: "ADD_CANDIDATE",
        ordinal: 999,
        value: "Test",
        provenance: "USER_ENTERED"
      })
    ).toThrow(/Unknown or invalid/);
  });

  // REQUIREMENT 15: Unknown review action fails closed
  it("15. fails closed when an unknown review action type is passed", () => {
    const draft = createForm33B1DraftState();
    expect(() =>
      applyReviewAction(draft, {
        actionType: "HACK_DATABASE_DIRECTLY" as any,
        ordinal: 0,
        value: "Test"
      })
    ).toThrow(/Unknown review action type/);
  });

  // REQUIREMENT 16: Allegation responses require frozen authorization (ordinals 41..112)
  it("16. enforces explicit frozen authorization across all allegation-response controls (41..112)", () => {
    let draft = createForm33B1DraftState();
    for (let ordinal = 41; ordinal <= 112; ordinal++) {
      draft = applyReviewAction(draft, {
        actionType: "ADD_CANDIDATE",
        ordinal,
        value: `Fact for allegation ${ordinal}`,
        provenance: "MATTER_DERIVED"
      });

      const ctrl = draft.controls[ordinal];
      expect(ctrl.decisionCategory).toBe("ALLEGATION_RESPONSE");
      expect(ctrl.populationResult.populatedValue).toBeNull();
      expect(ctrl.populationResult.outcomeStatus).toBe("AUTHORIZATION_REQUIRED");
    }
  });

  // REQUIREMENT 17: Plan-of-care commitments require frozen authorization (ordinals 113..146)
  it("17. enforces explicit frozen authorization across all plan-of-care controls (113..146)", () => {
    let draft = createForm33B1DraftState();
    for (let ordinal = 113; ordinal <= 146; ordinal++) {
      draft = applyReviewAction(draft, {
        actionType: "ADD_CANDIDATE",
        ordinal,
        value: `Plan commitment ${ordinal}`,
        provenance: "MACHINE_SUGGESTED"
      });

      const ctrl = draft.controls[ordinal];
      expect(ctrl.decisionCategory).toBe("PLAN_OF_CARE_COMMITMENT");
      expect(ctrl.populationResult.populatedValue).toBeNull();
      expect(ctrl.populationResult.outcomeStatus).toBe("AUTHORIZATION_REQUIRED");
    }
  });

  // REQUIREMENT 18: Requested orders require frozen authorization (ordinals 147..164)
  it("18. enforces explicit frozen authorization across all requested-order controls (147..164)", () => {
    let draft = createForm33B1DraftState();
    for (let ordinal = 147; ordinal <= 164; ordinal++) {
      draft = applyReviewAction(draft, {
        actionType: "ADD_CANDIDATE",
        ordinal,
        value: `Requested order option ${ordinal}`,
        provenance: "MATTER_DERIVED"
      });

      const ctrl = draft.controls[ordinal];
      expect(ctrl.decisionCategory).toBe("REQUESTED_ORDER");
      expect(ctrl.populationResult.populatedValue).toBeNull();
      expect(ctrl.populationResult.outcomeStatus).toBe("AUTHORIZATION_REQUIRED");
    }
  });

  // REQUIREMENT 19: Signature remains protected (ordinal 165: DATE, ordinal 166: SIGNATURE)
  it("19. preserves signature protection for signature block controls", () => {
    let draft = createForm33B1DraftState();
    draft = applyReviewAction(draft, {
      actionType: "ADD_CANDIDATE",
      ordinal: 166,
      value: "Jane Doe Printed",
      provenance: "MATTER_DERIVED"
    });

    const ctrlDerived = draft.controls[166];
    expect(ctrlDerived.populationResult.populatedValue).toBeNull();
    expect(ctrlDerived.populationResult.outcomeStatus).toBe("AUTHORIZATION_REQUIRED");

    draft = applyReviewAction(draft, {
      actionType: "PROVIDE_USER_ANSWER",
      ordinal: 166,
      value: "Jane Doe Printed",
      provenance: "USER_ENTERED",
      authorizedBy: "Jane Doe"
    });
    expect(draft.controls[166].populationResult.outcomeStatus).toBe("POPULATED");
  });

  // REQUIREMENT 20: Attestation remains protected (ordinal 167: ATTESTATION)
  it("20. preserves attestation protection for lawyer attestation control (ordinal 167)", () => {
    let draft = createForm33B1DraftState();
    draft = applyReviewAction(draft, {
      actionType: "ADD_CANDIDATE",
      ordinal: 167,
      value: "Lawyer Name",
      provenance: "MACHINE_SUGGESTED"
    });

    const ctrlDerived = draft.controls[167];
    expect(ctrlDerived.populationResult.populatedValue).toBeNull();

    draft = applyReviewAction(draft, {
      actionType: "PROVIDE_USER_ANSWER",
      ordinal: 167,
      value: "John Smith, Counsel",
      provenance: "USER_ENTERED",
      authorizedBy: "John Smith, Counsel"
    });
    expect(draft.controls[167].populationResult.outcomeStatus).toBe("POPULATED");
  });

  // REQUIREMENT 21: Protected date remains protected (ordinal 168: DATE)
  it("21. preserves final protected date control (ordinal 168)", () => {
    let draft = createForm33B1DraftState();
    draft = applyReviewAction(draft, {
      actionType: "ADD_CANDIDATE",
      ordinal: 168,
      value: "2026-09-24",
      provenance: "MATTER_DERIVED"
    });

    expect(draft.controls[168].populationResult.populatedValue).toBeNull();

    draft = applyReviewAction(draft, {
      actionType: "PROVIDE_USER_ANSWER",
      ordinal: 168,
      value: "2026-09-24",
      provenance: "USER_ENTERED",
      authorizedBy: "John Smith, Counsel"
    });
    expect(draft.controls[168].populationResult.outcomeStatus).toBe("POPULATED");
  });

  // REQUIREMENT 22: Bulk operation cannot reuse one authorization across protected controls
  it("22. prevents bulk review actions from reusing a single authorization token across multiple protected controls", () => {
    const def41 = getForm33B1ControlDefinition(41)!;
    const token41 = authorizePartyResponse(
      def41.manifest.stableTechnicalId,
      "Denial 41",
      "USER_ENTERED",
      "Parent Jane Doe"
    );

    let draft = createForm33B1DraftState();
    draft = applyReviewAction(draft, {
      actionType: "BULK_REVIEW_ACTION",
      bulkActions: [
        {
          actionType: "AUTHORIZE_RESPONSE",
          ordinal: 41,
          value: "Denial 41",
          authorizationToken: token41,
          authorizedBy: "Parent Jane Doe"
        },
        {
          actionType: "AUTHORIZE_RESPONSE",
          ordinal: 42,
          value: "Denial 42",
          authorizationToken: token41, // Reusing token41 for ordinal 42
          authorizedBy: "Parent Jane Doe"
        }
      ]
    });

    expect(draft.controls[41].populationResult.outcomeStatus).toBe("POPULATED");
    expect(draft.controls[42].populationResult.outcomeStatus).toBe("AUTHORIZATION_REQUIRED");
    expect(draft.controls[42].populationResult.populatedValue).toBeNull();
  });

  // REQUIREMENT 23: Completeness counts are deterministic
  it("23. produces deterministic draft completeness summary counts", () => {
    let draft = createForm33B1DraftState();
    draft = applyReviewAction(draft, {
      actionType: "PROVIDE_USER_ANSWER",
      ordinal: 0,
      value: "Ottawa",
      provenance: "USER_ENTERED"
    });

    const summary1 = summarizeDraftCompleteness(draft);
    const summary2 = summarizeDraftCompleteness(draft);

    expect(summary1).toEqual(summary2);
    expect(summary1.totalControls).toBe(169);
    expect(summary1.populatedCount).toBe(1);
    expect(summary1.unansweredCount).toBe(128);
    expect(summary1.isTechnicallyComplete).toBe(false);
  });

  // REQUIREMENT 24: Technical completeness does not imply legal sufficiency
  it("24. asserts legal sufficiency disclaimer even when technically complete", () => {
    let draft = createForm33B1DraftState();

    // Populate non-protected 0..40
    for (let i = 0; i <= 40; i++) {
      draft = applyReviewAction(draft, {
        actionType: "PROVIDE_USER_ANSWER",
        ordinal: i,
        value: `Answer ${i}`,
        provenance: "USER_ENTERED"
      });
    }
    // Authorize protected 41..168
    for (let i = 41; i <= 168; i++) {
      draft = applyReviewAction(draft, {
        actionType: "PROVIDE_USER_ANSWER",
        ordinal: i,
        value: `Authorized Answer ${i}`,
        provenance: "USER_ENTERED",
        authorizedBy: "Parent Jane Doe"
      });
    }

    const summary = summarizeDraftCompleteness(draft);
    expect(summary.isTechnicallyComplete).toBe(true);
    expect(summary.legalSufficiencyDisclaimer).toBe(LEGAL_SUFFICIENCY_DISCLAIMER);
    expect(summary.legalSufficiencyDisclaimer).toContain("TECHNICAL COMPLETENESS DOES NOT IMPLY LEGAL SUFFICIENCY");
  });

  // REQUIREMENT 25: Repeated identical review transitions are deterministic
  it("25. produces deterministic state across repeated identical review transitions", () => {
    const action: any = {
      actionType: "ADD_CANDIDATE",
      ordinal: 15,
      value: "Jane Doe",
      provenance: "MATTER_DERIVED"
    };

    const draft1 = applyReviewAction(createForm33B1DraftState(), action);
    const draft2 = applyReviewAction(createForm33B1DraftState(), action);

    expect(draft1.controls[15].populationResult).toEqual(draft2.controls[15].populationResult);
    expect(draft1.auditTrail.length).toBe(draft2.auditTrail.length);
  });

  // REQUIREMENT 26: Population engine remains the final authority
  it("26. delegates final population status to attemptPopulateControl in population engine", () => {
    let draft = createForm33B1DraftState();
    draft = applyReviewAction(draft, {
      actionType: "ADD_CANDIDATE",
      ordinal: 41,
      value: "Denial text",
      provenance: "MATTER_DERIVED"
    });

    const ctrl = draft.controls[41];
    const directPopCheck = attemptPopulateControl({
      ordinal: 41,
      value: "Denial text",
      provenance: "MATTER_DERIVED"
    });

    expect(ctrl.populationResult).toEqual(directPopCheck);
  });

  // REQUIREMENT 27: Frozen baseline objects remain immutable
  it("27. verifies frozen baseline objects remain untouched after draft orchestration operations", () => {
    expect(Object.isFrozen(FORM_33B1_STRUCTURAL_MANIFEST)).toBe(true);
    expect(Object.isFrozen(FORM_33B1_DECISION_BOUNDARIES)).toBe(true);
    expect(Object.isFrozen(FORM_33B1_SEMANTIC_ENTRIES)).toBe(true);

    let draft = createForm33B1DraftState();
    draft = applyReviewAction(draft, {
      actionType: "PROVIDE_USER_ANSWER",
      ordinal: 41,
      value: "Test",
      provenance: "USER_ENTERED",
      authorizedBy: "Parent"
    });

    expect(Object.isFrozen(FORM_33B1_STRUCTURAL_MANIFEST)).toBe(true);
    expect(Object.isFrozen(FORM_33B1_DECISION_BOUNDARIES)).toBe(true);
    expect(Object.isFrozen(FORM_33B1_SEMANTIC_ENTRIES)).toBe(true);
    expect(FORM_33B1_STRUCTURAL_MANIFEST.length).toBe(169);
    expect(FORM_33B1_DECISION_BOUNDARIES.length).toBe(169);
    expect(FORM_33B1_SEMANTIC_ENTRIES.length).toBe(169);
  });
});
