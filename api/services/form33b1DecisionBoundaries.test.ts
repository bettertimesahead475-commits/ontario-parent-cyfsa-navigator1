// Stage 9D-4B-2A-ii-b5A-iii — Form 33B.1 DECISION-BOUNDARY SAFETY & ADVERSARIAL TEST SUITE
import { describe, it, expect } from "vitest";
import {
  FORM_33B1_DECISION_BOUNDARIES,
  FORM_33B1_DECISION_BOUNDARIES_SOURCE_SHA256,
  FORM_33B1_DECISION_CATEGORIES,
  FORM_33B1_DECISION_AUTHORITIES,
  FORM_33B1_SENSITIVITY_LEVELS,
  UNANSWERED_STATE,
  AUTHORIZED_BRAND_SYMBOL,
  authorizePartyResponse,
  isAuthorizedPartyResponse,
  Form33B1DecisionAuthority
} from "./form33b1DecisionBoundaries.js";
import {
  FORM_33B1_STRUCTURAL_MANIFEST,
  FORM_33B1_TOTAL_TECHNICAL_CONTROLS,
  FORM_33B1_STRUCTURAL_MANIFEST_SOURCE_SHA256
} from "./form33b1StructuralManifest.js";

describe("Form 33B.1 b5A-iii Decision-Boundary Classification & Safety Suite", () => {
  // -------------------------------------------------------------------------
  // 1. Freeze-Preservation Invariant
  // -------------------------------------------------------------------------
  it("1. b5A-ii frozen structural manifest remains unchanged", () => {
    expect(FORM_33B1_STRUCTURAL_MANIFEST).toHaveLength(FORM_33B1_TOTAL_TECHNICAL_CONTROLS);
    expect(FORM_33B1_STRUCTURAL_MANIFEST_SOURCE_SHA256).toBe(
      "79d718a2de8be55001b47649a34366613b7050a69f98dfb6a4fd394870908a6e"
    );
    expect(FORM_33B1_DECISION_BOUNDARIES_SOURCE_SHA256).toBe(
      "79d718a2de8be55001b47649a34366613b7050a69f98dfb6a4fd394870908a6e"
    );
  });

  // -------------------------------------------------------------------------
  // 2. Control Completeness & Cardinality Invariants
  // -------------------------------------------------------------------------
  it("2. all 169 controls receive exactly one decision-boundary classification", () => {
    expect(FORM_33B1_DECISION_BOUNDARIES).toHaveLength(169);
    const boundaryOrdinals = FORM_33B1_DECISION_BOUNDARIES.map(e => e.ordinal).sort((a, b) => a - b);
    expect(boundaryOrdinals).toHaveLength(169);
    for (let i = 0; i < 169; i++) {
      expect(boundaryOrdinals[i]).toBe(i);
    }
  });

  it("3. all 169 controls match the frozen structural manifest ordinals and IDs", () => {
    for (let i = 0; i < 169; i++) {
      const manifestItem = FORM_33B1_STRUCTURAL_MANIFEST[i];
      const boundaryItem = FORM_33B1_DECISION_BOUNDARIES[i];
      expect(boundaryItem.ordinal).toBe(manifestItem.ordinal);
      expect(boundaryItem.stableTechnicalId).toBe(manifestItem.stableTechnicalId);
      expect(boundaryItem.structuralSection).toBe(manifestItem.structuralSection);
    }
  });

  it("4. no unknown technical IDs exist in decision boundaries", () => {
    const validIds = new Set(FORM_33B1_STRUCTURAL_MANIFEST.map(e => e.stableTechnicalId));
    for (const b of FORM_33B1_DECISION_BOUNDARIES) {
      expect(validIds.has(b.stableTechnicalId)).toBe(true);
    }
  });

  it("5. all categories, authorities, and sensitivity levels are valid enum members", () => {
    const validCategories = new Set(FORM_33B1_DECISION_CATEGORIES);
    const validAuthorities = new Set(FORM_33B1_DECISION_AUTHORITIES);
    const validSensitivities = new Set(FORM_33B1_SENSITIVITY_LEVELS);

    for (const b of FORM_33B1_DECISION_BOUNDARIES) {
      expect(validCategories.has(b.decisionCategory)).toBe(true);
      expect(validSensitivities.has(b.sensitivity)).toBe(true);
      for (const auth of b.permittedAuthorityClasses) {
        expect(validAuthorities.has(auth)).toBe(true);
      }
    }
  });

  // -------------------------------------------------------------------------
  // 3. High-Risk Section Safety & Authorization Invariants
  // -------------------------------------------------------------------------
  it("6. RESPONSE_TO_APPLICATION_CLAIMS (41..112) controls require explicit human authorization and UNANSWERED state", () => {
    const responseControls = FORM_33B1_DECISION_BOUNDARIES.filter(
      b => b.structuralSection === "RESPONSE_TO_APPLICATION_CLAIMS"
    );
    expect(responseControls).toHaveLength(72);
    for (const c of responseControls) {
      expect(c.requiresExplicitAuthorization).toBe(true);
      expect(c.requiresUnansweredState).toBe(true);
      expect(c.decisionCategory).toBe("ALLEGATION_RESPONSE");
      expect(c.sensitivity).toBe("LEGAL_FACTUAL_CONTENT");
      expect(c.permittedAuthorityClasses).not.toContain("MATTER_DERIVED");
      expect(c.permittedAuthorityClasses).not.toContain("MACHINE_SUGGESTED");
    }
  });

  it("7. PLAN_OF_CARE_PROPOSAL (113..146) controls require explicit human authorization and UNANSWERED state", () => {
    const planControls = FORM_33B1_DECISION_BOUNDARIES.filter(
      b => b.structuralSection === "PLAN_OF_CARE_PROPOSAL"
    );
    expect(planControls).toHaveLength(34);
    for (const c of planControls) {
      expect(c.requiresExplicitAuthorization).toBe(true);
      expect(c.requiresUnansweredState).toBe(true);
      expect(c.decisionCategory).toBe("PLAN_OF_CARE_COMMITMENT");
      expect(c.sensitivity).toBe("HIGH_STAKES_LEGAL_DECISION");
      expect(c.permittedAuthorityClasses).not.toContain("MATTER_DERIVED");
      expect(c.permittedAuthorityClasses).not.toContain("MACHINE_SUGGESTED");
    }
  });

  it("8. REQUESTED_ORDERS (147..164) controls require explicit human authorization and UNANSWERED state", () => {
    const orderControls = FORM_33B1_DECISION_BOUNDARIES.filter(
      b => b.structuralSection === "REQUESTED_ORDERS"
    );
    expect(orderControls).toHaveLength(18);
    for (const c of orderControls) {
      expect(c.requiresExplicitAuthorization).toBe(true);
      expect(c.requiresUnansweredState).toBe(true);
      expect(c.decisionCategory).toBe("REQUESTED_ORDER");
      expect(c.sensitivity).toBe("HIGH_STAKES_LEGAL_DECISION");
      expect(c.permittedAuthorityClasses).not.toContain("MATTER_DERIVED");
      expect(c.permittedAuthorityClasses).not.toContain("MACHINE_SUGGESTED");
    }
  });

  it("9. SIGNATURE_OR_ATTESTATION (165..168) controls require explicit human authorization and cannot be machine authorized", () => {
    const sigControls = FORM_33B1_DECISION_BOUNDARIES.filter(
      b => b.structuralSection === "SIGNATURE_OR_ATTESTATION"
    );
    expect(sigControls).toHaveLength(4);
    for (const c of sigControls) {
      expect(c.requiresExplicitAuthorization).toBe(true);
      expect(c.requiresUnansweredState).toBe(true);
      expect(c.sensitivity).toBe("SIGNATURE_OR_ATTESTATION");
      expect(c.permittedAuthorityClasses).toEqual(["USER_ENTERED"]);
    }
  });

  // -------------------------------------------------------------------------
  // 4. Defect A — Runtime Authorization Integrity & Object Mutation Protection
  // -------------------------------------------------------------------------
  it("10. genuine authorized object passes validation and is frozen", () => {
    const real = authorizePartyResponse("form33b1.response.paragraphSlot1", "Agreed in part", "USER_ENTERED", "parent_123");
    expect(isAuthorizedPartyResponse(real)).toBe(true);
    expect(isAuthorizedPartyResponse(real, "form33b1.response.paragraphSlot1")).toBe(true);
    expect(Object.isFrozen(real)).toBe(true);
  });

  it("11. object spread with value mutation fails runtime authorization validation", () => {
    const real = authorizePartyResponse("form33b1.response.paragraphSlot1", "Agreed in part", "USER_ENTERED", "parent_123");
    const tampered = { ...real, value: "Disagreed in full" };
    expect(isAuthorizedPartyResponse(tampered)).toBe(false);
  });

  it("12. object spread without mutation fails runtime authorization validation", () => {
    const real = authorizePartyResponse("form33b1.response.paragraphSlot1", "Agreed in part", "USER_ENTERED", "parent_123");
    const copied = { ...real };
    expect(isAuthorizedPartyResponse(copied)).toBe(false);
  });

  it("13. Object.assign fails runtime authorization validation", () => {
    const real = authorizePartyResponse("form33b1.response.paragraphSlot1", "Agreed in part", "USER_ENTERED", "parent_123");
    const assigned = Object.assign({}, real);
    expect(isAuthorizedPartyResponse(assigned)).toBe(false);
    const assignedMutated = Object.assign({}, real, { value: "Mutated value" });
    expect(isAuthorizedPartyResponse(assignedMutated)).toBe(false);
  });

  it("14. JSON round trip fails runtime authorization validation", () => {
    const real = authorizePartyResponse("form33b1.response.paragraphSlot1", "Agreed in part", "USER_ENTERED", "parent_123");
    const jsonRoundTrip = JSON.parse(JSON.stringify(real));
    expect(isAuthorizedPartyResponse(jsonRoundTrip)).toBe(false);
  });

  it("15. direct forgery object fails runtime authorization validation", () => {
    const forged = {
      [AUTHORIZED_BRAND_SYMBOL]: "AUTHORIZED_PARTY_RESPONSE",
      stableTechnicalId: "form33b1.response.paragraphSlot1",
      value: "Agreed in part",
      provenance: "USER_ENTERED",
      authorizedBy: "parent_123",
      authorizedAtIso: new Date().toISOString()
    };
    expect(isAuthorizedPartyResponse(forged)).toBe(false);
  });

  it("16. genuine authorized object property mutation fails", () => {
    const real = authorizePartyResponse("form33b1.response.paragraphSlot1", "Agreed in part", "USER_ENTERED", "parent_123");
    expect(() => {
      (real as any).value = "Unauthorized modification";
    }).toThrow();
    expect(real.value).toBe("Agreed in part");
  });

  // -------------------------------------------------------------------------
  // 5. Defect B — Control-Aware Provenance & Transition Enforcement
  // -------------------------------------------------------------------------
  it("17. authorization transition rejects unknown technical IDs", () => {
    expect(() => authorizePartyResponse("nonexistent.control.id", "val", "USER_ENTERED", "user1")).toThrow(
      /Unknown Form 33B.1 control ID/
    );
  });

  it("18. high-stakes controls reject MATTER_DERIVED provenance transition", () => {
    expect(() =>
      authorizePartyResponse("form33b1.response.paragraphSlot1", "Admit all", "MATTER_DERIVED", "user1")
    ).toThrow(/Provenance 'MATTER_DERIVED' is not permitted/);

    expect(() =>
      authorizePartyResponse("form33b1.requestedOrders.dismissApplication", true, "MATTER_DERIVED", "user1")
    ).toThrow(/Provenance 'MATTER_DERIVED' is not permitted/);
  });

  it("19. high-stakes controls reject MACHINE_SUGGESTED provenance transition", () => {
    expect(() =>
      authorizePartyResponse("form33b1.planOfCare.placementParent", true, "MACHINE_SUGGESTED", "user1")
    ).toThrow(/Provenance 'MACHINE_SUGGESTED' is not permitted/);
  });

  it("20. controls permit PROFESSIONALLY_REVIEWED provenance transition only when configured", () => {
    const profAuth = authorizePartyResponse("form33b1.response.paragraphSlot1", "Agree", "PROFESSIONALLY_REVIEWED", "lawyer_1");
    expect(isAuthorizedPartyResponse(profAuth)).toBe(true);

    expect(() =>
      authorizePartyResponse("form33b1.signature.answeringPartyPrintedName", "Jane Doe", "PROFESSIONALLY_REVIEWED", "lawyer_1")
    ).toThrow(/Provenance 'PROFESSIONALLY_REVIEWED' is not permitted/);
  });

  it("21. static form content cannot be authorized as a party response", () => {
    expect(() =>
      authorizePartyResponse("form33b1.court.courtName", "Toronto Court", "OFFICIAL_STATIC_FORM_CONTENT", "user1")
    ).toThrow(/Static form content cannot be authorized/);
  });

  it("22. valid USER_ENTERED explicit human authorization succeeds for valid control", () => {
    const validSig = authorizePartyResponse("form33b1.signature.answeringPartyPrintedName", "Jane Doe", "USER_ENTERED", "parent_1");
    expect(isAuthorizedPartyResponse(validSig)).toBe(true);
    expect(isAuthorizedPartyResponse(validSig, "form33b1.signature.answeringPartyPrintedName")).toBe(true);
  });

  it("23. cross-control reuse of authorization object is rejected by control-aware validator", () => {
    const slot1Auth = authorizePartyResponse("form33b1.response.paragraphSlot1", "Agree", "USER_ENTERED", "user1");
    expect(isAuthorizedPartyResponse(slot1Auth, "form33b1.response.paragraphSlot1")).toBe(true);
    expect(isAuthorizedPartyResponse(slot1Auth, "form33b1.response.paragraphSlot2")).toBe(false);
  });

  // -------------------------------------------------------------------------
  // 6. Unanswered & Signature Safety Tests
  // -------------------------------------------------------------------------
  it("24. UNANSWERED state is distinct from false, empty string, or unchecked", () => {
    expect(UNANSWERED_STATE.status).toBe("UNANSWERED");
    expect(isAuthorizedPartyResponse(UNANSWERED_STATE)).toBe(false);
    expect(isAuthorizedPartyResponse(false)).toBe(false);
    expect(isAuthorizedPartyResponse("")).toBe(false);
    expect(isAuthorizedPartyResponse(undefined)).toBe(false);
    expect(isAuthorizedPartyResponse(null)).toBe(false);
  });

  it("25. authorization requires non-empty and non-whitespace authorizer identity", () => {
    expect(() => authorizePartyResponse("form33b1.signature.answeringPartyPrintedName", "Jane Doe", "USER_ENTERED", "")).toThrow(
      /explicit non-empty authorizer identity/
    );
    expect(() => authorizePartyResponse("form33b1.signature.answeringPartyPrintedName", "Jane Doe", "USER_ENTERED", "   ")).toThrow(
      /explicit non-empty authorizer identity/
    );
  });

  it("26. empty string response is rejected for explicit authorization controls", () => {
    expect(() => authorizePartyResponse("form33b1.response.paragraphSlot1", "", "USER_ENTERED", "user1")).toThrow(
      /Cannot authorize empty string/
    );
  });

  // -------------------------------------------------------------------------
  // 7. Defect C — Ordinal 168 lawyerDate Explicit Classification Regression Test
  // -------------------------------------------------------------------------
  it("27. Ordinal 168 (form33b1.signature.lawyerDate) is classified as DATE category", () => {
    const item168 = FORM_33B1_DECISION_BOUNDARIES.find(b => b.ordinal === 168);
    expect(item168).toBeDefined();
    expect(item168?.stableTechnicalId).toBe("form33b1.signature.lawyerDate");
    expect(item168?.decisionCategory).toBe("DATE");
    expect(item168?.sensitivity).toBe("SIGNATURE_OR_ATTESTATION");
    expect(item168?.requiresExplicitAuthorization).toBe(true);
    expect(item168?.requiresUnansweredState).toBe(true);

    const dateCount = FORM_33B1_DECISION_BOUNDARIES.filter(b => b.decisionCategory === "DATE").length;
    const attestationCount = FORM_33B1_DECISION_BOUNDARIES.filter(b => b.decisionCategory === "ATTESTATION").length;
    expect(dateCount).toBe(3);
    expect(attestationCount).toBe(1);
  });
});
