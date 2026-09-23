// Stage 9D-4B-2A-ii-b5A-iii — Form 33B.1 DECISION-BOUNDARY SAFETY & ADVERSARIAL TEST SUITE
import { describe, it, expect } from "vitest";
import {
  FORM_33B1_DECISION_BOUNDARIES,
  FORM_33B1_DECISION_BOUNDARIES_SOURCE_SHA256,
  FORM_33B1_DECISION_CATEGORIES,
  FORM_33B1_DECISION_AUTHORITIES,
  FORM_33B1_SENSITIVITY_LEVELS,
  UNANSWERED_STATE,
  authorizePartyResponse,
  isAuthorizedPartyResponse,
  AuthorizedPartyResponse,
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
  // 4. Adversarial Protection & Type Safety Tests
  // -------------------------------------------------------------------------
  it("10. matter-derived allegation cannot become admission without explicit authorization", () => {
    const matterAllegation = { source: "MATTER_EVIDENCE", text: "Child missed school" };
    expect(isAuthorizedPartyResponse(matterAllegation)).toBe(false);
    expect(() => authorizePartyResponse(matterAllegation, "OFFICIAL_STATIC_FORM_CONTENT", "")).toThrow();
  });

  it("11. matter-derived allegation cannot become denial without explicit authorization", () => {
    const matterDenial = { source: "CAS_RECORD", statement: "Denies allegation 3" };
    expect(isAuthorizedPartyResponse(matterDenial)).toBe(false);
  });

  it("12. evidence cannot become agreement or disagreement automatically", () => {
    const evidence = { type: "AFFIDAVIT_EXHIBIT", content: "Parent agreed to supervision" };
    expect(isAuthorizedPartyResponse(evidence)).toBe(false);
  });

  it("13. machine suggestion cannot become authorized response without authorization transition", () => {
    const machineSuggestion = { suggestedChoice: "agree", confidence: 0.95 };
    expect(isAuthorizedPartyResponse(machineSuggestion)).toBe(false);
  });

  it("14. professional review alone cannot become authorized response without explicit authorization", () => {
    const profFinding = { reviewer: "Lawyer A", notes: "Likely agree" };
    expect(isAuthorizedPartyResponse(profFinding)).toBe(false);
  });

  it("15. UNANSWERED state is explicit and distinct from false, empty string, or unchecked", () => {
    expect(UNANSWERED_STATE.status).toBe("UNANSWERED");
    expect(isAuthorizedPartyResponse(UNANSWERED_STATE)).toBe(false);
    expect(isAuthorizedPartyResponse(false)).toBe(false);
    expect(isAuthorizedPartyResponse("")).toBe(false);
    expect(isAuthorizedPartyResponse(undefined)).toBe(false);
    expect(isAuthorizedPartyResponse(null)).toBe(false);
  });

  it("16. object spread injection defense: spread payloads cannot fake AuthorizedPartyResponse", () => {
    const matterDerivedData = {
      value: "agree",
      provenance: "MATTER_DERIVED" as Form33B1DecisionAuthority,
      authorizedBy: "AI_AUTOMATION",
      authorizedAtIso: new Date().toISOString()
    };
    const injected = { ...matterDerivedData };
    expect(isAuthorizedPartyResponse(injected)).toBe(false);

    const payload = { value: "dismissApplication", checked: true };
    const injectedOrder = { ...payload, authorizedBy: "User" };
    expect(isAuthorizedPartyResponse(injectedOrder)).toBe(false);
  });

  it("17. generic boolean or string cannot satisfy authorized decision type", () => {
    expect(isAuthorizedPartyResponse(true)).toBe(false);
    expect(isAuthorizedPartyResponse(false)).toBe(false);
    expect(isAuthorizedPartyResponse("REQUESTED")).toBe(false);
    expect(isAuthorizedPartyResponse("AGREE")).toBe(false);
  });

  it("18. requested order cannot be machine-selected or authorized with static form content", () => {
    expect(() => authorizePartyResponse("dismissApplication", "OFFICIAL_STATIC_FORM_CONTENT", "parent_user")).toThrow();
  });

  it("19. signature and attestation cannot be authorized with empty or whitespace authorizer identity", () => {
    expect(() => authorizePartyResponse("John Doe", "USER_ENTERED", "")).toThrow();
    expect(() => authorizePartyResponse("John Doe", "USER_ENTERED", "   ")).toThrow();
  });

  it("20. valid authorizePartyResponse creates a frozen, branded authorized object", () => {
    const auth = authorizePartyResponse("Agree to placement", "USER_ENTERED", "parent_123");
    expect(isAuthorizedPartyResponse(auth)).toBe(true);
    expect(auth.value).toBe("Agree to placement");
    expect(auth.provenance).toBe("USER_ENTERED");
    expect(auth.authorizedBy).toBe("parent_123");
    expect(Object.isFrozen(auth)).toBe(true);
  });
});
