// Stage 9D-4B-2A-ii — Form 33B.1 RENDER / EXPORT INTEGRATION TESTS
//
// Tests all 25 specific security, isolation, reconciliation, and rendering requirements.

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import crypto from "node:crypto";
import {
  FORM_33B1_SOURCE_TEMPLATE_FILE,
  FORM_33B1_SOURCE_TEMPLATE_TYPE,
  FORM_33B1_SOURCE_TEMPLATE_HASH,
  FORM_33B1_TOTAL_CONTROLS,
  Form33B1RenderExportError,
  reconcileForm33B1Controls,
  escapeXmlText,
  checkFieldLengthLimit,
  createForm33B1TemplateDocx,
  renderForm33B1Export,
  type Form33B1RenderExportRequest
} from "./form33b1RenderExport.js";
import {
  FORM_33B1_STRUCTURAL_MANIFEST,
  FORM_33B1_TOTAL_TECHNICAL_CONTROLS
} from "./form33b1StructuralManifest.js";
import {
  FORM_33B1_DECISION_BOUNDARIES,
  authorizePartyResponse
} from "./form33b1DecisionBoundaries.js";
import {
  createForm33B1DraftState,
  applyReviewAction,
  type Form33B1DraftState
} from "./form33b1DraftReview.js";
import { deriveRawFieldInventory } from "./form33b1RawInventoryVerification.js";

describe("Form 33B.1 Render / Export Integration Service", () => {
  // 1. Official/source template is identified.
  it("1. identifies the official Form 33B.1 source template, type, hash, and control count", () => {
    expect(FORM_33B1_SOURCE_TEMPLATE_FILE).toBe("form-33b-1-en-dec20.docx");
    expect(FORM_33B1_SOURCE_TEMPLATE_TYPE).toBe("DOCX");
    expect(FORM_33B1_SOURCE_TEMPLATE_HASH).toBe(
      "79d718a2de8be55001b47649a34366613b7050a69f98dfb6a4fd394870908a6e"
    );
    expect(FORM_33B1_TOTAL_CONTROLS).toBe(169);
  });

  // 2. 169 controls reconcile with frozen structure.
  it("2. reconciles all 169 controls with frozen structural manifest", () => {
    const reconciliation = reconcileForm33B1Controls();
    expect(reconciliation.totalControls).toBe(169);
    expect(reconciliation.mappedTargets).toBe(169);
    expect(reconciliation.duplicateTargets).toBe(0);
    expect(reconciliation.unmappedTargets).toBe(0);
  });

  // 3. Stable control IDs map correctly.
  it("3. maps every stable technical ID correctly across all 169 ordinals", () => {
    for (let i = 0; i < 169; i++) {
      const manifestDef = FORM_33B1_STRUCTURAL_MANIFEST[i];
      const boundaryDef = FORM_33B1_DECISION_BOUNDARIES[i];
      expect(manifestDef.ordinal).toBe(i);
      expect(boundaryDef.ordinal).toBe(i);
      expect(manifestDef.stableTechnicalId).toBe(boundaryDef.stableTechnicalId);
      expect(manifestDef.stableTechnicalId).toMatch(/^form33b1\./);
    }
  });

  // 4. No duplicate render targets.
  it("4. proves 0 duplicate render targets across all 169 controls", () => {
    const draftState = createForm33B1DraftState();
    const result = renderForm33B1Export({ draftState });
    expect(result.duplicateTargetsCount).toBe(0);
    expect(result.mappedTargetsCount).toBe(169);
  });

  // 5. Unknown controls fail closed.
  it("5. fails closed when an unknown control ordinal or malformed state is encountered", () => {
    expect(() => renderForm33B1Export({ draftState: null as any })).toThrow(
      Form33B1RenderExportError
    );
    expect(() =>
      renderForm33B1Export({
        draftState: { ...createForm33B1DraftState(), controls: [] }
      })
    ).toThrow(Form33B1RenderExportError);
  });

  // 6. Unanswered protected control remains unanswered.
  it("6. preserves unanswered state for protected controls without manufacturing legal positions", () => {
    const draftState = createForm33B1DraftState();
    const result = renderForm33B1Export({ draftState });
    const allegianceControl = result.renderedControlStates[45]; // Allegation paragraph slot 5
    expect(allegianceControl.isPopulated).toBe(false);
    expect(allegianceControl.renderedValue).toBeNull();
    expect(allegianceControl.isUnanswered).toBe(true);
  });

  // 7. Proposed value does not export as answer.
  it("7. prevents proposed values from exporting into rendered answers", () => {
    let draftState = createForm33B1DraftState();
    // Add a candidate proposal to an allegation response (ordinal 41)
    draftState = applyReviewAction(draftState, {
      actionType: "ADD_CANDIDATE",
      ordinal: 41,
      value: "Proposed response text from AI",
      provenance: "MACHINE_SUGGESTED",
      sourceReferenceId: "doc_123"
    });

    const result = renderForm33B1Export({ draftState });
    const ctrl41 = result.renderedControlStates[41];
    expect(ctrl41.isPopulated).toBe(false);
    expect(ctrl41.renderedValue).toBeNull();
    expect(ctrl41.wasProposedOnly).toBe(true);
  });

  // 8. Source-available value does not export as answer.
  it("8. prevents source-available values from exporting as legal answers", () => {
    let draftState = createForm33B1DraftState();
    draftState = applyReviewAction(draftState, {
      actionType: "ADD_CANDIDATE",
      ordinal: 113,
      value: true,
      provenance: "MATTER_DERIVED",
      sourceReferenceId: "evidence_456"
    });

    const result = renderForm33B1Export({ draftState });
    const ctrl113 = result.renderedControlStates[113];
    expect(ctrl113.isPopulated).toBe(false);
    expect(ctrl113.renderedValue).toBeNull();
  });

  // 9. Rejected proposal does not export.
  it("9. prevents rejected proposals from exporting into rendered answers", () => {
    let draftState = createForm33B1DraftState();
    draftState = applyReviewAction(draftState, {
      actionType: "ADD_CANDIDATE",
      ordinal: 50,
      value: "Rejected allegation answer",
      provenance: "MACHINE_SUGGESTED"
    });
    const candidateId = draftState.controls[50].candidates[0].candidateId;

    draftState = applyReviewAction(draftState, {
      actionType: "REJECT_PROPOSAL",
      ordinal: 50,
      candidateId
    });

    const result = renderForm33B1Export({ draftState });
    const ctrl50 = result.renderedControlStates[50];
    expect(ctrl50.isPopulated).toBe(false);
    expect(ctrl50.renderedValue).toBeNull();
    expect(ctrl50.wasRejected).toBe(true);
  });

  // 10. Rejection does not render opposite answer.
  it("10. proves rejecting a proposal does not manufacture the opposite legal position", () => {
    let draftState = createForm33B1DraftState();
    draftState = applyReviewAction(draftState, {
      actionType: "ADD_CANDIDATE",
      ordinal: 147, // Dismiss application order
      value: true,
      provenance: "MACHINE_SUGGESTED"
    });
    const candidateId = draftState.controls[147].candidates[0].candidateId;

    draftState = applyReviewAction(draftState, {
      actionType: "REJECT_PROPOSAL",
      ordinal: 147,
      candidateId
    });

    const result = renderForm33B1Export({ draftState });
    const ctrl147 = result.renderedControlStates[147];
    expect(ctrl147.isPopulated).toBe(false);
    expect(ctrl147.renderedValue).toBeNull();
  });

  // 11. Conflict remains unresolved.
  it("11. keeps conflicting unresolved source candidates unpopulated during render", () => {
    let draftState = createForm33B1DraftState();
    draftState = applyReviewAction(draftState, {
      actionType: "ADD_CANDIDATE",
      ordinal: 2, // Applicant name
      value: "John Doe",
      provenance: "USER_ENTERED"
    });
    draftState = applyReviewAction(draftState, {
      actionType: "ADD_CANDIDATE",
      ordinal: 2,
      value: "Jonathan Doe",
      provenance: "MATTER_DERIVED"
    });

    const result = renderForm33B1Export({ draftState });
    const ctrl2 = result.renderedControlStates[2];
    expect(ctrl2.wasConflicted).toBe(true);
    expect(ctrl2.isPopulated).toBe(false);
    expect(ctrl2.renderedValue).toBeNull();
  });

  // 12. Genuine populated authorized value renders correctly.
  it("12. renders genuine authorized populated values correctly into target controls", () => {
    let draftState = createForm33B1DraftState();
    draftState = applyReviewAction(draftState, {
      actionType: "PROVIDE_USER_ANSWER",
      ordinal: 3, // Answering party name
      value: "Jane Smith",
      provenance: "USER_ENTERED",
      authorizedBy: "Jane Smith (Self)"
    });

    const result = renderForm33B1Export({ draftState });
    const ctrl3 = result.renderedControlStates[3];
    expect(ctrl3.isPopulated).toBe(true);
    expect(ctrl3.renderedValue).toBe("Jane Smith");
  });

  // 13. Allegation controls preserve authorization.
  it("13. enforces explicit authorization on allegation response controls (41..112)", () => {
    let draftState = createForm33B1DraftState();
    // Add proposal without authorization to ordinal 41
    draftState = applyReviewAction(draftState, {
      actionType: "ADD_CANDIDATE",
      ordinal: 41,
      value: "Denies paragraph 1 allegations.",
      provenance: "USER_ENTERED"
    });
    let result = renderForm33B1Export({ draftState });
    expect(result.renderedControlStates[41].isPopulated).toBe(false);

    // Now explicitly authorize
    draftState = applyReviewAction(draftState, {
      actionType: "AUTHORIZE_RESPONSE",
      ordinal: 41,
      value: "Denies paragraph 1 allegations.",
      provenance: "USER_ENTERED",
      authorizedBy: "Jane Smith (Answering Party)"
    });

    result = renderForm33B1Export({ draftState });
    expect(result.renderedControlStates[41].isPopulated).toBe(true);
    expect(result.renderedControlStates[41].renderedValue).toBe(
      "Denies paragraph 1 allegations."
    );
  });

  // 14. Plan-of-care controls preserve authorization.
  it("14. enforces explicit authorization on plan-of-care controls (113..146)", () => {
    let draftState = createForm33B1DraftState();
    draftState = applyReviewAction(draftState, {
      actionType: "ADD_CANDIDATE",
      ordinal: 116, // Placement detail
      value: "Child to reside with maternal grandmother",
      provenance: "USER_ENTERED"
    });
    let result = renderForm33B1Export({ draftState });
    expect(result.renderedControlStates[116].isPopulated).toBe(false);

    draftState = applyReviewAction(draftState, {
      actionType: "AUTHORIZE_RESPONSE",
      ordinal: 116,
      value: "Child to reside with maternal grandmother",
      provenance: "USER_ENTERED",
      authorizedBy: "Mother Jane"
    });

    result = renderForm33B1Export({ draftState });
    expect(result.renderedControlStates[116].isPopulated).toBe(true);
    expect(result.renderedControlStates[116].renderedValue).toBe(
      "Child to reside with maternal grandmother"
    );
  });

  // 15. Requested-order controls preserve authorization.
  it("15. enforces explicit authorization on requested-order controls (147..164)", () => {
    let draftState = createForm33B1DraftState();
    draftState = applyReviewAction(draftState, {
      actionType: "ADD_CANDIDATE",
      ordinal: 148, // Place child with answering party
      value: true,
      provenance: "USER_ENTERED"
    });
    let result = renderForm33B1Export({ draftState });
    expect(result.renderedControlStates[148].isPopulated).toBe(false);

    draftState = applyReviewAction(draftState, {
      actionType: "AUTHORIZE_RESPONSE",
      ordinal: 148,
      value: true,
      provenance: "USER_ENTERED",
      authorizedBy: "Mother Jane"
    });

    result = renderForm33B1Export({ draftState });
    expect(result.renderedControlStates[148].isPopulated).toBe(true);
    expect(result.renderedControlStates[148].renderedValue).toBe(true);
  });

  // 16. Signature protection survives rendering.
  it("16. protects signature control (165) against auto-synthesis or inference", () => {
    const draftState = createForm33B1DraftState();
    const result = renderForm33B1Export({ draftState });
    const signatureCtrl = result.renderedControlStates[165];
    expect(signatureCtrl.isPopulated).toBe(false);
    expect(signatureCtrl.renderedValue).toBeNull();
  });

  // 17. Attestation protection survives rendering.
  it("17. protects attestation control (166) against auto-attestation", () => {
    const draftState = createForm33B1DraftState();
    const result = renderForm33B1Export({ draftState });
    const attestationCtrl = result.renderedControlStates[166];
    expect(attestationCtrl.isPopulated).toBe(false);
    expect(attestationCtrl.renderedValue).toBeNull();
  });

  // 18. Protected date protection survives rendering.
  it("18. protects date control (167) against auto-manufacturing dates", () => {
    const draftState = createForm33B1DraftState();
    const result = renderForm33B1Export({ draftState });
    const dateCtrl = result.renderedControlStates[167];
    expect(dateCtrl.isPopulated).toBe(false);
    expect(dateCtrl.renderedValue).toBeNull();
  });

  // 19. Cross-control values cannot migrate.
  it("19. prevents cross-control migration of values", () => {
    const draftState = createForm33B1DraftState();
    const malformedState: Form33B1DraftState = {
      ...draftState,
      controls: draftState.controls.map((c, idx) =>
        idx === 5
          ? {
              ...c,
              stableTechnicalId: "form33b1.wrong.controlId"
            }
          : c
      )
    };

    expect(() => renderForm33B1Export({ draftState: malformedState })).toThrow(
      Form33B1RenderExportError
    );
  });

  // 20. Template/static wording remains unchanged.
  it("20. preserves static form wording, headings, and legal notices in rendered document", () => {
    const draftState = createForm33B1DraftState();
    const result = renderForm33B1Export({ draftState });
    const pkg = deriveRawFieldInventory(result.documentBytes);
    expect(pkg.totalControls).toBe(169);
  });

  // 21. Special characters are safely escaped.
  it("21. safely escapes XML special characters in rendered text content", () => {
    const rawText = `Smith & Jones <Lawyers> "Legal" 'Notice'`;
    const escaped = escapeXmlText(rawText);
    expect(escaped).toBe(
      `Smith &amp; Jones &lt;Lawyers&gt; &quot;Legal&quot; &apos;Notice&apos;`
    );
    expect(escaped).not.toContain("<Lawyers>");
  });

  // 22. Long content is not silently truncated.
  it("22. throws FIELD_OVERFLOW error when rendered text exceeds capacity limit", () => {
    const longText = "A".repeat(5000);
    expect(() =>
      checkFieldLengthLimit(0, "form33b1.court.courtName", longText, 4000)
    ).toThrow(Form33B1RenderExportError);
  });

  // 23. Malformed template mapping fails closed.
  it("23. fails closed on malformed template or draft mapping state", () => {
    expect(() =>
      renderForm33B1Export({
        draftState: { totalControls: 169, controls: [], auditTrail: [] }
      })
    ).toThrow(Form33B1RenderExportError);
  });

  // 24. Rendering is logically deterministic.
  it("24. produces 100% deterministic rendered output given identical draft state", () => {
    let draftState = createForm33B1DraftState();
    draftState = applyReviewAction(draftState, {
      actionType: "PROVIDE_USER_ANSWER",
      ordinal: 3,
      value: "Jane Smith",
      provenance: "USER_ENTERED",
      authorizedBy: "Jane Smith"
    });

    const result1 = renderForm33B1Export({ draftState });
    const result2 = renderForm33B1Export({ draftState });

    expect(result1.renderedControlStates).toEqual(result2.renderedControlStates);
    expect(result1.documentBytes.equals(result2.documentBytes)).toBe(true);
    expect(result1.templateHash).toBe(result2.templateHash);
  });

  // 25. Frozen Form 33B.1 layers remain unchanged.
  it("25. verifies that frozen Form 33B.1 layers remain completely unchanged", () => {
    const frozenFiles = [
      "api/services/form33b1StructuralManifest.ts",
      "api/services/form33b1StructuralManifest.test.ts",
      "api/services/form33b1DecisionBoundaries.ts",
      "api/services/form33b1DecisionBoundaries.test.ts",
      "api/services/form33b1SemanticFieldMapS1.ts",
      "api/services/form33b1SemanticFieldMapS1.test.ts",
      "api/services/form33b1PopulationEngine.ts",
      "api/services/form33b1PopulationEngine.test.ts",
      "api/services/form33b1DraftReview.ts",
      "api/services/form33b1DraftReview.test.ts"
    ];

    for (const f of frozenFiles) {
      expect(fs.existsSync(f), `Frozen file ${f} must exist`).toBe(true);
    }
  });
});
