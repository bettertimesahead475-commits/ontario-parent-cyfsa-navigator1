// Stage 9D-4B-2A-ii-b5B — Form 33B.1 Semantic Field Map Test Suite (All 169 Controls)
import { describe, it, expect } from "vitest";
import {
  FORM_33B1_SOURCE_SHA256_HEX,
  FORM_33B1_EXACT_TEMPLATE_BINDING,
  FORM_33B1_MAP_VERSION_LABEL,
  FORM_33B1_SEMANTIC_ENTRIES,
  FORM_33B1_SEMANTIC_FIELD_MAP,
  FORM_33B1_SLICE1_SEMANTIC_ENTRIES,
  FORM_33B1_SLICE1_SEMANTIC_FIELD_MAP,
  form33b1FullAccounting,
  form33b1Slice1Accounting,
  type Form33B1SemanticEntry
} from "./form33b1SemanticFieldMapS1.js";
import {
  FORM_33B1_STRUCTURAL_MANIFEST,
  FORM_33B1_TOTAL_TECHNICAL_CONTROLS,
  FORM_33B1_STRUCTURAL_MANIFEST_SOURCE_SHA256
} from "./form33b1StructuralManifest.js";
import {
  FORM_33B1_DECISION_BOUNDARIES,
  FORM_33B1_DECISION_BOUNDARIES_SOURCE_SHA256,
  UNANSWERED_STATE,
  AUTHORIZED_BRAND_SYMBOL,
  authorizePartyResponse,
  isAuthorizedPartyResponse
} from "./form33b1DecisionBoundaries.js";
import { DOCX_FIELD_INVENTORIES } from "./docxFieldInventoryData.js";
import { validateSemanticFieldMap, type SemanticFieldMap } from "./semanticFieldMap.js";
import type { DocxFieldInventoryResult } from "./docxFieldInventory.js";

const frozenInvRecord = DOCX_FIELD_INVENTORIES.find(f => f.formNumber === "33B.1")!;

function form33b1InventoryFromFrozenData(): DocxFieldInventoryResult {
  return {
    usesLegacyFormFields: frozenInvRecord.usesLegacyFormFields,
    usesContentControls: frozenInvRecord.usesContentControls,
    contentControlCount: frozenInvRecord.contentControlCount,
    fields: frozenInvRecord.fields.map(f => ({
      order: f.order,
      name: f.name,
      type: f.type,
      defaultValue: f.defaultValue,
      maxLength: f.maxLength,
      checkbox: f.checkbox,
      dropdown: f.dropdown,
      enabled: f.enabled,
      paragraphOrdinal: f.paragraphOrdinal,
      tableDepth: f.tableDepth,
      rawFfDataXml: "<w:ffData/>"
    })),
    anomalies: frozenInvRecord.anomalies,
    documentProtection: frozenInvRecord.documentProtection,
    allPackagePartNames: ["word/document.xml"]
  };
}

const frozenInv = form33b1InventoryFromFrozenData();

describe("Form 33B.1 Comprehensive Semantic Field Map Suite (All 169 Controls)", () => {
  // -------------------------------------------------------------------------
  // 1. Frozen Baseline Preservation & Identity
  // -------------------------------------------------------------------------
  it("1. frozen SHA-256 baselines match exactly across all manifests", () => {
    expect(FORM_33B1_SOURCE_SHA256_HEX).toBe("79d718a2de8be55001b47649a34366613b7050a69f98dfb6a4fd394870908a6e");
    expect(FORM_33B1_STRUCTURAL_MANIFEST_SOURCE_SHA256).toBe(FORM_33B1_SOURCE_SHA256_HEX);
    expect(FORM_33B1_DECISION_BOUNDARIES_SOURCE_SHA256).toBe(FORM_33B1_SOURCE_SHA256_HEX);
    expect(frozenInvRecord.sha256Hex).toBe(FORM_33B1_SOURCE_SHA256_HEX);
  });

  // -------------------------------------------------------------------------
  // 2. Control Completeness & Cardinality Invariants (169 Controls)
  // -------------------------------------------------------------------------
  it("2. exactly 169 controls are mapped with zero unmapped or extra controls", () => {
    expect(FORM_33B1_TOTAL_TECHNICAL_CONTROLS).toBe(169);
    expect(FORM_33B1_SEMANTIC_ENTRIES.length).toBe(169);
    expect(FORM_33B1_SEMANTIC_FIELD_MAP.entries.length).toBe(169);
  });

  it("3. every ordinal 0..168 is represented exactly once (zero gaps, zero overlaps)", () => {
    const ordinals = FORM_33B1_SEMANTIC_ENTRIES.map(e => e.ordinal).sort((a, b) => a - b);
    expect(ordinals.length).toBe(169);
    for (let i = 0; i < 169; i++) {
      expect(ordinals[i]).toBe(i);
    }
    const uniqueOrdinals = new Set(ordinals);
    expect(uniqueOrdinals.size).toBe(169);
  });

  it("4. 169 unique stable technical IDs and 169 unique semantic physical targets", () => {
    const techIds = FORM_33B1_SEMANTIC_ENTRIES.map(e => e.stableTechnicalId);
    expect(techIds.length).toBe(169);
    expect(new Set(techIds).size).toBe(169);

    const semKeys = FORM_33B1_SEMANTIC_ENTRIES.map(e => e.semanticKey);
    expect(semKeys.length).toBe(169);
    expect(new Set(semKeys).size).toBe(169);
  });

  it("5. full accounting verification shows zero unmapped or duplicate controls", () => {
    const accounting = form33b1FullAccounting();
    expect(accounting.length).toBe(169);
    for (let i = 0; i < 169; i++) {
      expect(accounting[i].ordinal).toBe(i);
      expect(accounting[i].stableTechnicalId).toBe(FORM_33B1_STRUCTURAL_MANIFEST[i].stableTechnicalId);
      expect(accounting[i].semanticKey).toBeDefined();
    }
  });

  it("6. Slice 1 sub-view (ordinals 0..40) contains exactly 41 entries", () => {
    expect(FORM_33B1_SLICE1_SEMANTIC_ENTRIES.length).toBe(41);
    expect(FORM_33B1_SLICE1_SEMANTIC_FIELD_MAP.entries.length).toBe(41);

    const slice1Accounting = form33b1Slice1Accounting();
    expect(slice1Accounting.filter(a => a.disposition === "MAPPED_IN_SLICE_1").length).toBe(41);
    expect(slice1Accounting.filter(a => a.disposition === "UNMAPPED_OUT_OF_SLICE").length).toBe(128);
  });

  // -------------------------------------------------------------------------
  // 3. Structural & Decision Boundary Alignment
  // -------------------------------------------------------------------------
  it("7. semantic mappings correspond to frozen structural manifest", () => {
    for (let i = 0; i < 169; i++) {
      const entry = FORM_33B1_SEMANTIC_ENTRIES[i];
      const struct = FORM_33B1_STRUCTURAL_MANIFEST[i];

      expect(entry.ordinal).toBe(struct.ordinal);
      expect(entry.stableTechnicalId).toBe(struct.stableTechnicalId);
      expect(entry.structuralSection).toBe(struct.structuralSection);
      expect(entry.repeatedGroupId).toBe(struct.repeatedGroupId);
      expect(entry.repeatedGroupIndex).toBe(struct.repeatedGroupIndex);
    }
  });

  it("8. decision categories correspond to frozen b5A-iii decision boundaries", () => {
    for (let i = 0; i < 169; i++) {
      const entry = FORM_33B1_SEMANTIC_ENTRIES[i];
      const boundary = FORM_33B1_DECISION_BOUNDARIES[i];

      expect(entry.decisionCategory).toBe(boundary.decisionCategory);
      expect(entry.boundarySensitivity).toBe(boundary.sensitivity);
      expect(entry.requiresExplicitAuthorization).toBe(boundary.requiresExplicitAuthorization);
      expect(entry.requiresUnansweredState).toBe(boundary.requiresUnansweredState);
      expect(entry.permittedProvenance).toEqual(boundary.permittedAuthorityClasses);
    }
  });

  it("9. exactly 128 controls require explicit authorization and unanswered state", () => {
    const explicitAuthControls = FORM_33B1_SEMANTIC_ENTRIES.filter(e => e.requiresExplicitAuthorization);
    const unansweredControls = FORM_33B1_SEMANTIC_ENTRIES.filter(e => e.requiresUnansweredState);

    expect(explicitAuthControls.length).toBe(128);
    expect(unansweredControls.length).toBe(128);

    expect(explicitAuthControls.filter(e => e.structuralSection === "RESPONSE_TO_APPLICATION_CLAIMS").length).toBe(72);
    expect(explicitAuthControls.filter(e => e.structuralSection === "PLAN_OF_CARE_PROPOSAL").length).toBe(34);
    expect(explicitAuthControls.filter(e => e.structuralSection === "REQUESTED_ORDERS").length).toBe(18);
    expect(explicitAuthControls.filter(e => e.structuralSection === "SIGNATURE_OR_ATTESTATION").length).toBe(4);
  });

  // -------------------------------------------------------------------------
  // 4. High-Stakes Section Safety Invariants
  // -------------------------------------------------------------------------
  it("10. allegation responses (41..112) cannot be silently resolved and reject MATTER_DERIVED / MACHINE_SUGGESTED", () => {
    const responseControls = FORM_33B1_SEMANTIC_ENTRIES.filter(
      e => e.structuralSection === "RESPONSE_TO_APPLICATION_CLAIMS"
    );
    expect(responseControls.length).toBe(72);

    for (const c of responseControls) {
      expect(c.requiresExplicitAuthorization).toBe(true);
      expect(c.requiresUnansweredState).toBe(true);
      expect(c.permittedProvenance).not.toContain("MATTER_DERIVED");
      expect(c.permittedProvenance).not.toContain("MACHINE_SUGGESTED");
    }
  });

  it("11. plan-of-care commitments (113..146) cannot be silently created and reject MATTER_DERIVED / MACHINE_SUGGESTED", () => {
    const planControls = FORM_33B1_SEMANTIC_ENTRIES.filter(
      e => e.structuralSection === "PLAN_OF_CARE_PROPOSAL"
    );
    expect(planControls.length).toBe(34);

    for (const c of planControls) {
      expect(c.requiresExplicitAuthorization).toBe(true);
      expect(c.requiresUnansweredState).toBe(true);
      expect(c.permittedProvenance).not.toContain("MATTER_DERIVED");
      expect(c.permittedProvenance).not.toContain("MACHINE_SUGGESTED");
    }
  });

  it("12. requested orders (147..164) cannot be silently selected and reject MATTER_DERIVED / MACHINE_SUGGESTED", () => {
    const orderControls = FORM_33B1_SEMANTIC_ENTRIES.filter(
      e => e.structuralSection === "REQUESTED_ORDERS"
    );
    expect(orderControls.length).toBe(18);

    for (const c of orderControls) {
      expect(c.requiresExplicitAuthorization).toBe(true);
      expect(c.requiresUnansweredState).toBe(true);
      expect(c.permittedProvenance).not.toContain("MATTER_DERIVED");
      expect(c.permittedProvenance).not.toContain("MACHINE_SUGGESTED");
    }
  });

  it("13. signature/attestation controls (165..168) permit ONLY USER_ENTERED provenance", () => {
    const sigControls = FORM_33B1_SEMANTIC_ENTRIES.filter(
      e => e.structuralSection === "SIGNATURE_OR_ATTESTATION"
    );
    expect(sigControls.length).toBe(4);

    for (const c of sigControls) {
      expect(c.requiresExplicitAuthorization).toBe(true);
      expect(c.requiresUnansweredState).toBe(true);
      expect(c.permittedProvenance).toEqual(["USER_ENTERED"]);
    }
  });

  // -------------------------------------------------------------------------
  // 5. Fail-Closed Validator Integration
  // -------------------------------------------------------------------------
  it("14. fail-closed validator accepts full Form 33B.1 semantic field map", () => {
    expect(() =>
      validateSemanticFieldMap({
        map: FORM_33B1_SEMANTIC_FIELD_MAP,
        expectedBinding: FORM_33B1_EXACT_TEMPLATE_BINDING,
        technicalInventory: frozenInv
      })
    ).not.toThrow();
  });

  it("15. fail-closed validator accepts Slice 1 sub-map", () => {
    expect(() =>
      validateSemanticFieldMap({
        map: FORM_33B1_SLICE1_SEMANTIC_FIELD_MAP,
        expectedBinding: FORM_33B1_EXACT_TEMPLATE_BINDING,
        technicalInventory: frozenInv
      })
    ).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // 6. Runtime Authorization Integrity & Bypass Prevention
  // -------------------------------------------------------------------------
  it("16. genuine authorized party response succeeds for explicit auth control", () => {
    const auth = authorizePartyResponse("form33b1.response.paragraphSlot1", "Deny paragraph 1", "USER_ENTERED", "parent_456");
    expect(isAuthorizedPartyResponse(auth)).toBe(true);
    expect(isAuthorizedPartyResponse(auth, "form33b1.response.paragraphSlot1")).toBe(true);
  });

  it("17. cross-control authorization reuse is rejected", () => {
    const slot1Auth = authorizePartyResponse("form33b1.response.paragraphSlot1", "Deny paragraph 1", "USER_ENTERED", "parent_456");
    expect(isAuthorizedPartyResponse(slot1Auth, "form33b1.response.paragraphSlot1")).toBe(true);
    expect(isAuthorizedPartyResponse(slot1Auth, "form33b1.response.paragraphSlot2")).toBe(false);
  });

  it("18. object spread or property mutation cannot manufacture authorization", () => {
    const real = authorizePartyResponse("form33b1.response.paragraphSlot1", "Deny paragraph 1", "USER_ENTERED", "parent_456");
    const spread = { ...real, value: "Admit paragraph 1" };
    expect(isAuthorizedPartyResponse(spread)).toBe(false);
  });

  it("19. JSON round-trip cannot manufacture authorization", () => {
    const real = authorizePartyResponse("form33b1.response.paragraphSlot1", "Deny paragraph 1", "USER_ENTERED", "parent_456");
    const roundtrip = JSON.parse(JSON.stringify(real));
    expect(isAuthorizedPartyResponse(roundtrip)).toBe(false);
  });

  it("20. unauthorized machine-derived high-stakes values remain rejected", () => {
    expect(() =>
      authorizePartyResponse("form33b1.requestedOrders.dismissApplication", true, "MACHINE_SUGGESTED", "user1")
    ).toThrow(/Provenance 'MACHINE_SUGGESTED' is not permitted/);

    expect(() =>
      authorizePartyResponse("form33b1.planOfCare.placementParent", true, "MATTER_DERIVED", "user1")
    ).toThrow(/Provenance 'MATTER_DERIVED' is not permitted/);
  });

  // -------------------------------------------------------------------------
  // 7. Adversarial Integrity Checks
  // -------------------------------------------------------------------------
  it("21. adversarial: detects unknown control ID in authorization request", () => {
    expect(() => authorizePartyResponse("nonexistent.control", "val", "USER_ENTERED", "user1")).toThrow(
      /Unknown Form 33B.1 control ID/
    );
  });

  it("22. adversarial: rejects empty authorizer identity", () => {
    expect(() => authorizePartyResponse("form33b1.response.paragraphSlot1", "Deny", "USER_ENTERED", "")).toThrow(
      /explicit non-empty authorizer identity/
    );
  });

  it("23. adversarial: rejects empty string response for explicit authorization controls", () => {
    expect(() => authorizePartyResponse("form33b1.response.paragraphSlot1", "", "USER_ENTERED", "user1")).toThrow(
      /Cannot authorize empty string/
    );
  });

  it("24. adversarial: UNANSWERED state cannot be confused with boolean false, null, or empty string", () => {
    expect(UNANSWERED_STATE.status).toBe("UNANSWERED");
    expect(isAuthorizedPartyResponse(UNANSWERED_STATE)).toBe(false);
    expect(isAuthorizedPartyResponse(false)).toBe(false);
    expect(isAuthorizedPartyResponse("")).toBe(false);
    expect(isAuthorizedPartyResponse(null)).toBe(false);
  });
});
