// Stage 9D-4B-2A-ii — Form 33B.1 CONTROLLED POPULATION ENGINE SUITE
//
// Verifies all 25 security, safety, provenance, authorization, structural,
// and determinism requirements for the Form 33B.1 execution/population engine.

import { describe, it, expect } from "vitest";
import {
  attemptPopulateControl,
  getForm33B1ControlDefinition,
  populateForm33B1Document,
  type Form33B1PopulationRequest
} from "./form33b1PopulationEngine.js";
import {
  FORM_33B1_STRUCTURAL_MANIFEST,
  FORM_33B1_TOTAL_TECHNICAL_CONTROLS
} from "./form33b1StructuralManifest.js";
import {
  FORM_33B1_DECISION_BOUNDARIES,
  authorizePartyResponse,
  isAuthorizedPartyResponse
} from "./form33b1DecisionBoundaries.js";
import {
  FORM_33B1_SEMANTIC_ENTRIES,
  FORM_33B1_SEMANTIC_FIELD_MAP
} from "./form33b1SemanticFieldMapS1.js";

describe("Form 33B.1 Controlled Population / Execution Layer", () => {
  // REQUIREMENT 1: All 169 controls are recognized
  it("1. recognizes all 169 Form 33B.1 controls by ordinal and stable technical ID", () => {
    expect(FORM_33B1_TOTAL_TECHNICAL_CONTROLS).toBe(169);
    for (let i = 0; i < 169; i++) {
      const byOrdinal = getForm33B1ControlDefinition(i);
      expect(byOrdinal).not.toBeNull();
      expect(byOrdinal!.manifest.ordinal).toBe(i);
      expect(byOrdinal!.boundary.ordinal).toBe(i);
      expect(byOrdinal!.semantic.ordinal).toBe(i);

      const stableId = byOrdinal!.manifest.stableTechnicalId;
      const byStableId = getForm33B1ControlDefinition(stableId);
      expect(byStableId).not.toBeNull();
      expect(byStableId!.manifest.ordinal).toBe(i);
    }
  });

  // REQUIREMENT 2: Unknown controls fail closed
  it("2. fails closed for unknown controls", () => {
    const res1 = attemptPopulateControl({
      ordinal: 999,
      provenance: "USER_ENTERED",
      value: "test"
    });
    expect(res1.outcomeStatus).toBe("INVALID_VALUE");
    expect(res1.controlledState).toBe("REJECTED");
    expect(res1.populatedValue).toBeNull();
    expect(res1.rejectionReason).toContain("Unknown or invalid");

    const res2 = attemptPopulateControl({
      stableTechnicalId: "non_existent_control_id",
      provenance: "USER_ENTERED",
      value: "test"
    });
    expect(res2.outcomeStatus).toBe("INVALID_VALUE");
    expect(res2.controlledState).toBe("REJECTED");
    expect(res2.populatedValue).toBeNull();
  });

  // REQUIREMENT 3: Unknown provenance fails closed
  it("3. fails closed for unknown provenance", () => {
    const res = attemptPopulateControl({
      ordinal: 0,
      provenance: "AI_GENERATED_HALLUCINATION" as any,
      value: "City of Ottawa"
    });
    expect(res.outcomeStatus).toBe("PROVENANCE_REJECTED");
    expect(res.controlledState).toBe("REJECTED");
    expect(res.populatedValue).toBeNull();
    expect(res.rejectionReason).toContain("Unknown or unpermitted decision authority provenance");
  });

  // REQUIREMENT 4: Missing protected-control authorization preserves UNANSWERED
  it("4. preserves UNANSWERED state when protected-control explicit authorization is missing", () => {
    for (let ordinal = 41; ordinal <= 168; ordinal++) {
      const res = attemptPopulateControl({
        ordinal,
        provenance: "USER_ENTERED",
        value: "Some Candidate Answer"
      });
      expect(res.requiresExplicitAuthorization).toBe(true);
      expect(res.outcomeStatus).toBe("AUTHORIZATION_REQUIRED");
      expect(res.controlledState).toBe("UNANSWERED");
      expect(res.populatedValue).toBeNull();
      expect(res.authorizationSatisfied).toBe(false);
    }
  });

  // REQUIREMENT 5: Matter-derived high-stakes content cannot populate protected controls
  it("5. prevents MATTER_DERIVED high-stakes content from populating protected controls", () => {
    for (let ordinal = 41; ordinal <= 168; ordinal++) {
      const res = attemptPopulateControl({
        ordinal,
        provenance: "MATTER_DERIVED",
        value: "Fact derived from CAS file"
      });
      expect(res.populatedValue).toBeNull();
      expect(res.controlledState).toBe("SOURCE_AVAILABLE");
      expect(res.proposedValue).toBe("Fact derived from CAS file");
      expect(res.outcomeStatus).toBe("AUTHORIZATION_REQUIRED");
    }
  });

  // REQUIREMENT 6: Machine-suggested high-stakes content cannot populate protected controls
  it("6. prevents MACHINE_SUGGESTED high-stakes content from populating protected controls", () => {
    for (let ordinal = 41; ordinal <= 168; ordinal++) {
      const res = attemptPopulateControl({
        ordinal,
        provenance: "MACHINE_SUGGESTED",
        value: "AI generated suggestion"
      });
      expect(res.populatedValue).toBeNull();
      expect(res.controlledState).toBe("PROPOSED");
      expect(res.proposedValue).toBe("AI generated suggestion");
      expect(res.outcomeStatus).toBe("AUTHORIZATION_REQUIRED");
    }
  });

  // REQUIREMENT 7: Proper USER_ENTERED + valid explicit authorization succeeds where permitted
  it("7. permits population with valid USER_ENTERED explicit authorization token", () => {
    const ordinal = 41; // Allegation response
    const def = getForm33B1ControlDefinition(ordinal)!;
    const token = authorizePartyResponse(
      def.manifest.stableTechnicalId,
      "The parent denies the allegations in paragraph 3.",
      "USER_ENTERED",
      "Parent Jane Doe"
    );

    const res = attemptPopulateControl({
      ordinal,
      provenance: "USER_ENTERED",
      value: token.value,
      authorizationToken: token
    });

    expect(res.outcomeStatus).toBe("POPULATED");
    expect(res.controlledState).toBe("USER_AUTHORIZED");
    expect(res.populatedValue).toBe("The parent denies the allegations in paragraph 3.");
    expect(res.authorizationSatisfied).toBe(true);
    expect(res.authorizerIdentity).toBe("Parent Jane Doe");
  });

  // REQUIREMENT 8: Authorization for one ordinal cannot authorize another
  it("8. prevents cross-control authorization reuse", () => {
    const def41 = getForm33B1ControlDefinition(41)!;
    const token41 = authorizePartyResponse(
      def41.manifest.stableTechnicalId,
      "Denial of allegation 1",
      "USER_ENTERED",
      "Parent Jane Doe"
    );

    // Attempt to use token41 for ordinal 42
    const res42 = attemptPopulateControl({
      ordinal: 42,
      provenance: "USER_ENTERED",
      value: "Denial of allegation 2",
      authorizationToken: token41
    });

    expect(res42.outcomeStatus).toBe("AUTHORIZATION_REQUIRED");
    expect(res42.controlledState).toBe("UNANSWERED");
    expect(res42.populatedValue).toBeNull();
    expect(res42.authorizationSatisfied).toBe(false);
  });

  // REQUIREMENT 9: Copied authorization objects cannot bypass runtime protection
  it("9. rejects shallow-copied authorization objects", () => {
    const def = getForm33B1ControlDefinition(45)!;
    const token = authorizePartyResponse(
      def.manifest.stableTechnicalId,
      "Authorized Text",
      "USER_ENTERED",
      "Parent"
    );

    const copiedToken = { ...token };

    const res = attemptPopulateControl({
      ordinal: 45,
      provenance: "USER_ENTERED",
      value: "Authorized Text",
      authorizationToken: copiedToken
    });

    expect(res.outcomeStatus).toBe("AUTHORIZATION_REQUIRED");
    expect(res.controlledState).toBe("UNANSWERED");
    expect(res.populatedValue).toBeNull();
  });

  // REQUIREMENT 10: Spread objects cannot bypass protection
  it("10. rejects spread authorization objects with modified fields", () => {
    const def = getForm33B1ControlDefinition(50)!;
    const token = authorizePartyResponse(
      def.manifest.stableTechnicalId,
      "Original Value",
      "USER_ENTERED",
      "Parent"
    );

    const spreadToken = { ...token, value: "Hacked Value" };

    const res = attemptPopulateControl({
      ordinal: 50,
      provenance: "USER_ENTERED",
      value: "Hacked Value",
      authorizationToken: spreadToken
    });

    expect(res.outcomeStatus).toBe("AUTHORIZATION_REQUIRED");
    expect(res.controlledState).toBe("UNANSWERED");
    expect(res.populatedValue).toBeNull();
  });

  // REQUIREMENT 11: Object.assign cannot bypass protection
  it("11. rejects Object.assign copied authorization objects", () => {
    const def = getForm33B1ControlDefinition(60)!;
    const token = authorizePartyResponse(
      def.manifest.stableTechnicalId,
      "Assigned Text",
      "USER_ENTERED",
      "Parent"
    );

    const assignedToken = Object.assign({}, token);

    const res = attemptPopulateControl({
      ordinal: 60,
      provenance: "USER_ENTERED",
      value: "Assigned Text",
      authorizationToken: assignedToken
    });

    expect(res.outcomeStatus).toBe("AUTHORIZATION_REQUIRED");
    expect(res.controlledState).toBe("UNANSWERED");
    expect(res.populatedValue).toBeNull();
  });

  // REQUIREMENT 12: JSON round-trip cannot bypass protection
  it("12. rejects JSON round-tripped authorization objects", () => {
    const def = getForm33B1ControlDefinition(70)!;
    const token = authorizePartyResponse(
      def.manifest.stableTechnicalId,
      "JSON Text",
      "USER_ENTERED",
      "Parent"
    );

    const jsonToken = JSON.parse(JSON.stringify(token));

    const res = attemptPopulateControl({
      ordinal: 70,
      provenance: "USER_ENTERED",
      value: "JSON Text",
      authorizationToken: jsonToken
    });

    expect(res.outcomeStatus).toBe("AUTHORIZATION_REQUIRED");
    expect(res.controlledState).toBe("UNANSWERED");
    expect(res.populatedValue).toBeNull();
  });

  // REQUIREMENT 13: Mutation cannot manufacture authorization
  it("13. rejects manufactured authorization from property mutation", () => {
    const fakeToken: any = {
      stableTechnicalId: FORM_33B1_STRUCTURAL_MANIFEST[80].stableTechnicalId,
      value: "Fake Value",
      provenance: "USER_ENTERED",
      authorizedBy: "Attacker",
      authorizedAtIso: new Date().toISOString()
    };

    const res = attemptPopulateControl({
      ordinal: 80,
      provenance: "USER_ENTERED",
      value: "Fake Value",
      authorizationToken: fakeToken
    });

    expect(res.outcomeStatus).toBe("AUTHORIZATION_REQUIRED");
    expect(res.controlledState).toBe("UNANSWERED");
    expect(res.populatedValue).toBeNull();
  });

  // REQUIREMENT 14: Allegation responses remain unanswered without authorization (ordinals 41..112)
  it("14. keeps all allegation-response controls (ordinals 41..112) UNANSWERED without authorization", () => {
    for (let ordinal = 41; ordinal <= 112; ordinal++) {
      const def = getForm33B1ControlDefinition(ordinal)!;
      expect(def.boundary.decisionCategory).toBe("ALLEGATION_RESPONSE");

      const res = attemptPopulateControl({
        ordinal,
        provenance: "MATTER_DERIVED",
        value: "Allegation fact"
      });

      expect(res.outcomeStatus).toBe("AUTHORIZATION_REQUIRED");
      expect(res.controlledState).toBe("SOURCE_AVAILABLE");
      expect(res.populatedValue).toBeNull();
    }
  });

  // REQUIREMENT 15: Plan-of-care commitments remain unanswered without authorization (ordinals 113..146)
  it("15. keeps all plan-of-care commitment controls (ordinals 113..146) UNANSWERED without authorization", () => {
    for (let ordinal = 113; ordinal <= 146; ordinal++) {
      const def = getForm33B1ControlDefinition(ordinal)!;
      expect(def.boundary.decisionCategory).toBe("PLAN_OF_CARE_COMMITMENT");

      const res = attemptPopulateControl({
        ordinal,
        provenance: "MACHINE_SUGGESTED",
        value: "Proposed counseling plan"
      });

      expect(res.outcomeStatus).toBe("AUTHORIZATION_REQUIRED");
      expect(res.controlledState).toBe("PROPOSED");
      expect(res.populatedValue).toBeNull();
    }
  });

  // REQUIREMENT 16: Requested orders remain unanswered without authorization (ordinals 147..164)
  it("16. keeps all requested order controls (ordinals 147..164) UNANSWERED without authorization", () => {
    for (let ordinal = 147; ordinal <= 164; ordinal++) {
      const def = getForm33B1ControlDefinition(ordinal)!;
      expect(def.boundary.decisionCategory).toBe("REQUESTED_ORDER");

      const res = attemptPopulateControl({
        ordinal,
        provenance: "MATTER_DERIVED",
        value: "Supervised access requested"
      });

      expect(res.outcomeStatus).toBe("AUTHORIZATION_REQUIRED");
      expect(res.controlledState).toBe("SOURCE_AVAILABLE");
      expect(res.populatedValue).toBeNull();
    }
  });

  // REQUIREMENT 17: Signature controls retain frozen protections (ordinal 165: DATE, ordinal 166: SIGNATURE)
  it("17. enforces USER_ENTERED and explicit authorization for signature block controls", () => {
    const defDate = getForm33B1ControlDefinition(165)!;
    expect(defDate.boundary.decisionCategory).toBe("DATE");
    expect(defDate.boundary.permittedAuthorityClasses).toEqual(["USER_ENTERED"]);

    const resDerived = attemptPopulateControl({
      ordinal: 165,
      provenance: "MATTER_DERIVED",
      value: "2026-09-24"
    });
    expect(resDerived.outcomeStatus).toBe("AUTHORIZATION_REQUIRED");
    expect(resDerived.populatedValue).toBeNull();

    const token = authorizePartyResponse(
      defDate.manifest.stableTechnicalId,
      "2026-09-24",
      "USER_ENTERED",
      "Jane Doe"
    );
    const resAuth = attemptPopulateControl({
      ordinal: 165,
      provenance: "USER_ENTERED",
      value: "2026-09-24",
      authorizationToken: token
    });
    expect(resAuth.outcomeStatus).toBe("POPULATED");
    expect(resAuth.populatedValue).toBe("2026-09-24");
  });

  // REQUIREMENT 18: Attestation controls retain frozen protections (ordinal 166: SIGNATURE, ordinal 167: ATTESTATION)
  it("18. enforces USER_ENTERED and explicit authorization for attestation controls", () => {
    const defSig = getForm33B1ControlDefinition(166)!;
    expect(defSig.boundary.decisionCategory).toBe("SIGNATURE");

    const resDerived = attemptPopulateControl({
      ordinal: 166,
      provenance: "MATTER_DERIVED",
      value: "Jane Doe Printed Name"
    });
    expect(resDerived.outcomeStatus).toBe("AUTHORIZATION_REQUIRED");

    const token = authorizePartyResponse(
      defSig.manifest.stableTechnicalId,
      "Jane Doe",
      "USER_ENTERED",
      "Jane Doe"
    );
    const resAuth = attemptPopulateControl({
      ordinal: 166,
      provenance: "USER_ENTERED",
      value: "Jane Doe",
      authorizationToken: token
    });
    expect(resAuth.outcomeStatus).toBe("POPULATED");
    expect(resAuth.populatedValue).toBe("Jane Doe");
  });

  // REQUIREMENT 19: Final protected date controls retain frozen protections (ordinals 167..168)
  it("19. enforces USER_ENTERED and explicit authorization for lawyer attestation & date controls (167..168)", () => {
    const def167 = getForm33B1ControlDefinition(167)!;
    expect(def167.boundary.decisionCategory).toBe("ATTESTATION");

    const def168 = getForm33B1ControlDefinition(168)!;
    expect(def168.boundary.decisionCategory).toBe("DATE");

    for (let ordinal = 167; ordinal <= 168; ordinal++) {
      const def = getForm33B1ControlDefinition(ordinal)!;

      const resDerived = attemptPopulateControl({
        ordinal,
        provenance: "MATTER_DERIVED",
        value: "2026-09-24"
      });
      expect(resDerived.outcomeStatus).toBe("AUTHORIZATION_REQUIRED");

      const token = authorizePartyResponse(
        def.manifest.stableTechnicalId,
        "Authorized Value",
        "USER_ENTERED",
        "John Smith, Counsel"
      );
      const resAuth = attemptPopulateControl({
        ordinal,
        provenance: "USER_ENTERED",
        value: "Authorized Value",
        authorizationToken: token
      });
      expect(resAuth.outcomeStatus).toBe("POPULATED");
      expect(resAuth.populatedValue).toBe("Authorized Value");
    }
  });

  // REQUIREMENT 20: Semantic metadata cannot override decision-boundary security
  it("20. prevents semantic metadata from overriding decision-boundary security rules", () => {
    const def = getForm33B1ControlDefinition(41)!;
    expect(def.semantic.requiresExplicitAuthorization).toBe(true);

    const res = attemptPopulateControl({
      ordinal: 41,
      provenance: "USER_ENTERED",
      value: def.semantic.label
    });

    expect(res.outcomeStatus).toBe("AUTHORIZATION_REQUIRED");
    expect(res.controlledState).toBe("UNANSWERED");
    expect(res.populatedValue).toBeNull();
  });

  // REQUIREMENT 21: Structural metadata cannot override decision-boundary security
  it("21. prevents structural section metadata from overriding decision-boundary security", () => {
    const def = getForm33B1ControlDefinition(113)!;
    expect(def.manifest.structuralSection).toBe("PLAN_OF_CARE_PROPOSAL");

    const res = attemptPopulateControl({
      ordinal: 113,
      provenance: "USER_ENTERED",
      value: "Plan text from section structure"
    });

    expect(res.outcomeStatus).toBe("AUTHORIZATION_REQUIRED");
    expect(res.controlledState).toBe("UNANSWERED");
    expect(res.populatedValue).toBeNull();
  });

  // REQUIREMENT 22: Proposed values remain distinguishable from authorized populated values
  it("22. clearly distinguishes proposed values from authorized populated values", () => {
    const res = attemptPopulateControl({
      ordinal: 45,
      provenance: "MACHINE_SUGGESTED",
      value: "AI Proposed Denial"
    });

    expect(res.outcomeStatus).toBe("AUTHORIZATION_REQUIRED");
    expect(res.controlledState).toBe("PROPOSED");
    expect(res.populatedValue).toBeNull();
    expect(res.proposedValue).toBe("AI Proposed Denial");
  });

  // REQUIREMENT 23: Source availability alone cannot populate a protected control
  it("23. proves source availability alone cannot populate a protected control", () => {
    const res = attemptPopulateControl({
      ordinal: 120,
      provenance: "MATTER_DERIVED",
      value: "Extracted fact from client intake document",
      sourceContext: "Intake Document Section 4"
    });

    expect(res.outcomeStatus).toBe("AUTHORIZATION_REQUIRED");
    expect(res.controlledState).toBe("SOURCE_AVAILABLE");
    expect(res.populatedValue).toBeNull();
    expect(res.proposedValue).toBe("Extracted fact from client intake document");
  });

  // REQUIREMENT 24: Repeated execution is deterministic
  it("24. produces deterministic results on repeated execution", () => {
    const req: Form33B1PopulationRequest = {
      ordinal: 15,
      provenance: "MATTER_DERIVED",
      value: "Jane Doe"
    };

    const run1 = attemptPopulateControl(req);
    const run2 = attemptPopulateControl(req);

    expect(run1).toEqual(run2);

    const docState1 = populateForm33B1Document([req]);
    const docState2 = populateForm33B1Document([req]);

    expect(docState1).toEqual(docState2);
  });

  // REQUIREMENT 25: Frozen baseline objects remain immutable
  it("25. verifies frozen baseline objects remain completely immutable after engine execution", () => {
    expect(Object.isFrozen(FORM_33B1_STRUCTURAL_MANIFEST)).toBe(true);
    expect(Object.isFrozen(FORM_33B1_DECISION_BOUNDARIES)).toBe(true);
    expect(Object.isFrozen(FORM_33B1_SEMANTIC_ENTRIES)).toBe(true);
    expect(Object.isFrozen(FORM_33B1_SEMANTIC_FIELD_MAP)).toBe(true);

    populateForm33B1Document([
      { ordinal: 0, provenance: "USER_ENTERED", value: "Toronto" },
      { ordinal: 41, provenance: "MATTER_DERIVED", value: "Fact" }
    ]);

    expect(Object.isFrozen(FORM_33B1_STRUCTURAL_MANIFEST)).toBe(true);
    expect(Object.isFrozen(FORM_33B1_DECISION_BOUNDARIES)).toBe(true);
    expect(Object.isFrozen(FORM_33B1_SEMANTIC_ENTRIES)).toBe(true);
    expect(FORM_33B1_STRUCTURAL_MANIFEST.length).toBe(169);
    expect(FORM_33B1_DECISION_BOUNDARIES.length).toBe(169);
    expect(FORM_33B1_SEMANTIC_ENTRIES.length).toBe(169);
  });
});
