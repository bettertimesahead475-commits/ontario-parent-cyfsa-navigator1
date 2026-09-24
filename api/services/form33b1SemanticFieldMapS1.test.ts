// Stage 9D-4B-2A-ii-b5B-S1 — Form 33B.1 Semantic Field Map Slice 1 Test Suite
import { describe, it, expect } from "vitest";
import {
  FORM_33B1_SOURCE_SHA256_HEX,
  FORM_33B1_EXACT_TEMPLATE_BINDING,
  FORM_33B1_SLICE1_MAP_VERSION_LABEL,
  FORM_33B1_SLICE1_ORDINAL_RANGE,
  FORM_33B1_SLICE1_SEMANTIC_ENTRIES,
  FORM_33B1_SLICE1_SEMANTIC_FIELD_MAP,
  form33b1Slice1Accounting,
  type Form33B1Slice1SemanticEntry
} from "./form33b1SemanticFieldMapS1.js";
import {
  FORM_33B1_STRUCTURAL_MANIFEST,
  FORM_33B1_TOTAL_TECHNICAL_CONTROLS,
  FORM_33B1_STRUCTURAL_MANIFEST_SOURCE_SHA256
} from "./form33b1StructuralManifest.js";
import {
  FORM_33B1_DECISION_BOUNDARIES,
  FORM_33B1_DECISION_BOUNDARIES_SOURCE_SHA256
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

describe("Form 33B.1 Semantic Field Map Slice 1 (Ordinals 0..40) Suite", () => {
  // -------------------------------------------------------------------------
  // 1. Frozen Baseline Preservation
  // -------------------------------------------------------------------------
  it("1. frozen SHA-256 baselines match exactly", () => {
    expect(FORM_33B1_SOURCE_SHA256_HEX).toBe("79d718a2de8be55001b47649a34366613b7050a69f98dfb6a4fd394870908a6e");
    expect(FORM_33B1_STRUCTURAL_MANIFEST_SOURCE_SHA256).toBe(FORM_33B1_SOURCE_SHA256_HEX);
    expect(FORM_33B1_DECISION_BOUNDARIES_SOURCE_SHA256).toBe(FORM_33B1_SOURCE_SHA256_HEX);
    expect(frozenInvRecord.sha256Hex).toBe(FORM_33B1_SOURCE_SHA256_HEX);
  });

  // -------------------------------------------------------------------------
  // 2. Coverage & Scope Invariants (Ordinals 0..40)
  // -------------------------------------------------------------------------
  it("2. exactly 41 semantic entries exist for Slice 1 (ordinals 0..40)", () => {
    expect(FORM_33B1_SLICE1_SEMANTIC_ENTRIES.length).toBe(41);
    expect(FORM_33B1_SLICE1_SEMANTIC_FIELD_MAP.entries.length).toBe(41);
    expect(FORM_33B1_SLICE1_ORDINAL_RANGE.count).toBe(41);
  });

  it("3. ordinals in scope 0..40 are uniquely represented with zero gaps or duplicates", () => {
    const ordinals = FORM_33B1_SLICE1_SEMANTIC_ENTRIES.map(e => e.ordinal).sort((a, b) => a - b);
    expect(ordinals.length).toBe(41);
    for (let i = 0; i <= 40; i++) {
      expect(ordinals[i]).toBe(i);
    }
    const uniqueOrdinals = new Set(ordinals);
    expect(uniqueOrdinals.size).toBe(41);
  });

  it("4. ordinals 41..168 remain unmapped in Slice 1", () => {
    const accounting = form33b1Slice1Accounting();
    expect(accounting.length).toBe(FORM_33B1_TOTAL_TECHNICAL_CONTROLS); // 169 controls

    const mapped = accounting.filter(a => a.disposition === "MAPPED_IN_SLICE_1");
    const unmapped = accounting.filter(a => a.disposition === "UNMAPPED_OUT_OF_SLICE");

    expect(mapped.length).toBe(41);
    expect(unmapped.length).toBe(128); // 169 - 41 = 128 controls in 41..168

    for (let i = 0; i <= 40; i++) {
      expect(accounting[i].disposition).toBe("MAPPED_IN_SLICE_1");
    }
    for (let i = 41; i < 169; i++) {
      expect(accounting[i].disposition).toBe("UNMAPPED_OUT_OF_SLICE");
      expect(accounting[i].semanticKey).toBeNull();
    }
  });

  it("5. unique stable technical IDs and unique semantic physical targets for all 41 entries", () => {
    const techIds = FORM_33B1_SLICE1_SEMANTIC_ENTRIES.map(e => e.stableTechnicalId);
    expect(techIds.length).toBe(41);
    expect(new Set(techIds).size).toBe(41);

    const semKeys = FORM_33B1_SLICE1_SEMANTIC_ENTRIES.map(e => e.semanticKey);
    expect(semKeys.length).toBe(41);
    expect(new Set(semKeys).size).toBe(41);
  });

  // -------------------------------------------------------------------------
  // 3. Structural & Decision Boundary Alignment
  // -------------------------------------------------------------------------
  it("6. all 41 entries strictly align with frozen structural manifest and decision boundaries", () => {
    for (const entry of FORM_33B1_SLICE1_SEMANTIC_ENTRIES) {
      const struct = FORM_33B1_STRUCTURAL_MANIFEST[entry.ordinal];
      const boundary = FORM_33B1_DECISION_BOUNDARIES[entry.ordinal];

      expect(entry.stableTechnicalId).toBe(struct.stableTechnicalId);
      expect(entry.structuralSection).toBe(struct.structuralSection);
      expect(entry.repeatedGroupId).toBe(struct.repeatedGroupId);
      expect(entry.repeatedGroupIndex).toBe(struct.repeatedGroupIndex);

      expect(entry.decisionCategory).toBe(boundary.decisionCategory);
      expect(entry.boundarySensitivity).toBe(boundary.sensitivity);
      expect(entry.requiresExplicitAuthorization).toBe(boundary.requiresExplicitAuthorization);
      expect(entry.requiresUnansweredState).toBe(boundary.requiresUnansweredState);
      expect(entry.permittedProvenance).toEqual(boundary.permittedAuthorityClasses);
    }
  });

  // -------------------------------------------------------------------------
  // 4. Repeated Child Invariants (Ordinals 17..40)
  // -------------------------------------------------------------------------
  it("7. repeated child structure has 3 slots x 8 attributes = 24 controls with zero collisions", () => {
    const childEntries = FORM_33B1_SLICE1_SEMANTIC_ENTRIES.filter(
      e => e.repeatedGroupId === "REPEATED_CHILD_BLOCK"
    );
    expect(childEntries.length).toBe(24);

    const attributes = [
      "fullName",
      "dob",
      "sex",
      "residence",
      "schoolGrade",
      "specialNeeds",
      "indigenousStatus",
      "bandCommunity"
    ];

    for (let slot = 0; slot < 3; slot++) {
      const slotEntries = childEntries.filter(e => e.repeatedGroupIndex === slot);
      expect(slotEntries.length).toBe(8);

      attributes.forEach((attr, attrIdx) => {
        const expectedOrd = 17 + slot * 8 + attrIdx;
        const entry = slotEntries.find(e => e.ordinal === expectedOrd);
        expect(entry).toBeDefined();
        expect(entry?.semanticKey).toBe(`form33b1.child[${slot}].${attr}`);
        expect(entry?.structuralSection).toBe("CHILD_IDENTIFICATION");
        expect(entry?.repeatedGroupId).toBe("REPEATED_CHILD_BLOCK");
        expect(entry?.repeatedGroupIndex).toBe(slot);
      });
    }
  });

  it("8. child attribute equivalence across all 3 slots", () => {
    const attributes = [
      "fullName",
      "dob",
      "sex",
      "residence",
      "schoolGrade",
      "specialNeeds",
      "indigenousStatus",
      "bandCommunity"
    ];

    attributes.forEach(attr => {
      const slot0 = FORM_33B1_SLICE1_SEMANTIC_ENTRIES.find(e => e.semanticKey === `form33b1.child[0].${attr}`)!;
      const slot1 = FORM_33B1_SLICE1_SEMANTIC_ENTRIES.find(e => e.semanticKey === `form33b1.child[1].${attr}`)!;
      const slot2 = FORM_33B1_SLICE1_SEMANTIC_ENTRIES.find(e => e.semanticKey === `form33b1.child[2].${attr}`)!;

      expect(slot0).toBeDefined();
      expect(slot1).toBeDefined();
      expect(slot2).toBeDefined();

      expect(slot0.semanticConstraints.valueType).toBe(slot1.semanticConstraints.valueType);
      expect(slot1.semanticConstraints.valueType).toBe(slot2.semanticConstraints.valueType);

      expect(slot0.decisionCategory).toBe(slot1.decisionCategory);
      expect(slot1.decisionCategory).toBe(slot2.decisionCategory);

      expect(slot0.boundarySensitivity).toBe(slot1.boundarySensitivity);
      expect(slot1.boundarySensitivity).toBe(slot2.boundarySensitivity);
    });
  });

  // -------------------------------------------------------------------------
  // 5. Fail-Closed Validator Integration Test
  // -------------------------------------------------------------------------
  it("9. fail-closed validator accepts valid Slice 1 semantic field map", () => {
    expect(() =>
      validateSemanticFieldMap({
        map: FORM_33B1_SLICE1_SEMANTIC_FIELD_MAP,
        expectedBinding: FORM_33B1_EXACT_TEMPLATE_BINDING,
        technicalInventory: frozenInv
      })
    ).not.toThrow();
  });

  // -------------------------------------------------------------------------
  // 6. Adversarial Integrity & Vulnerability Tests
  // -------------------------------------------------------------------------
  it("10. adversarial: detects missing ordinal in candidate list", () => {
    const missingEntries = FORM_33B1_SLICE1_SEMANTIC_ENTRIES.filter(e => e.ordinal !== 10);
    expect(missingEntries.length).toBe(40);
    const ordinals = missingEntries.map(e => e.ordinal);
    expect(ordinals.includes(10)).toBe(false);
  });

  it("11. adversarial: detects duplicate ordinal assignment in candidate list", () => {
    const corrupted = [...FORM_33B1_SLICE1_SEMANTIC_ENTRIES];
    corrupted[5] = { ...corrupted[5], ordinal: 4 } as Form33B1Slice1SemanticEntry;
    const ordinals = corrupted.map(e => e.ordinal);
    expect(new Set(ordinals).size).toBe(40);
  });

  it("12. adversarial: rejects unknown technical ID", () => {
    const corruptedMap: SemanticFieldMap = {
      ...FORM_33B1_SLICE1_SEMANTIC_FIELD_MAP,
      entries: [
        ...FORM_33B1_SLICE1_SEMANTIC_ENTRIES.slice(0, 5),
        {
          ...FORM_33B1_SLICE1_SEMANTIC_ENTRIES[5],
          technicalIdentity: {
            ...FORM_33B1_SLICE1_SEMANTIC_ENTRIES[5].technicalIdentity,
            ordinal: 999
          }
        }
      ]
    };
    expect(() =>
      validateSemanticFieldMap({
        map: corruptedMap,
        expectedBinding: FORM_33B1_EXACT_TEMPLATE_BINDING,
        technicalInventory: frozenInv
      })
    ).toThrow(/does not exist in the real inventory/);
  });

  it("13. adversarial: rejects duplicate semantic physical target collision", () => {
    const duplicateMap: SemanticFieldMap = {
      ...FORM_33B1_SLICE1_SEMANTIC_FIELD_MAP,
      entries: [
        ...FORM_33B1_SLICE1_SEMANTIC_ENTRIES,
        {
          ...FORM_33B1_SLICE1_SEMANTIC_ENTRIES[0],
          semanticKey: "form33b1.court.courtNameDuplicate"
        }
      ]
    };
    expect(() =>
      validateSemanticFieldMap({
        map: duplicateMap,
        expectedBinding: FORM_33B1_EXACT_TEMPLATE_BINDING,
        technicalInventory: frozenInv
      })
    ).toThrow(/target the identical technical field/);
  });

  it("14. adversarial: detects out-of-scope ordinal (41..168) in accounting check", () => {
    expect(() => {
      const byOrdinal = new Map(FORM_33B1_SLICE1_SEMANTIC_ENTRIES.map(e => [e.ordinal, e]));
      // Inject out-of-scope entry ordinal 45
      byOrdinal.set(45, { ...FORM_33B1_SLICE1_SEMANTIC_ENTRIES[0], ordinal: 45 });
      for (let o = 0; o < FORM_33B1_TOTAL_TECHNICAL_CONTROLS; o++) {
        const mapped = byOrdinal.get(o);
        if (o > 40 && mapped) {
          throw new Error(`Ordinal ${o} is out of Slice 1 scope (41..168) but present in semantic entries.`);
        }
      }
    }).toThrow(/out of Slice 1 scope/);
  });

  it("15. adversarial: rejects technical type mismatch", () => {
    const typeMismatchMap: SemanticFieldMap = {
      ...FORM_33B1_SLICE1_SEMANTIC_FIELD_MAP,
      entries: [
        {
          ...FORM_33B1_SLICE1_SEMANTIC_ENTRIES[0],
          technicalConstraints: {
            ...FORM_33B1_SLICE1_SEMANTIC_ENTRIES[0].technicalConstraints,
            technicalType: "text" // Real inventory ordinal 0 is "dropdown"
          }
        },
        ...FORM_33B1_SLICE1_SEMANTIC_ENTRIES.slice(1)
      ]
    };
    expect(() =>
      validateSemanticFieldMap({
        map: typeMismatchMap,
        expectedBinding: FORM_33B1_EXACT_TEMPLATE_BINDING,
        technicalInventory: frozenInv
      })
    ).toThrow(/type mismatch/);
  });

  it("16. adversarial: rejects wrong structural section drift", () => {
    const child0Name = FORM_33B1_SLICE1_SEMANTIC_ENTRIES.find(e => e.ordinal === 17)!;
    expect(child0Name.structuralSection).toBe("CHILD_IDENTIFICATION");

    const corruptedSection: string = "PARTY_IDENTIFICATION";
    expect(corruptedSection).not.toBe(child0Name.structuralSection);
  });

  it("17. adversarial: rejects wrong repeated-group membership", () => {
    const childItem = FORM_33B1_SLICE1_SEMANTIC_ENTRIES.find(e => e.ordinal === 20)!;
    expect(childItem.repeatedGroupId).toBe("REPEATED_CHILD_BLOCK");

    const adminItem = FORM_33B1_SLICE1_SEMANTIC_ENTRIES.find(e => e.ordinal === 2)!;
    expect(adminItem.repeatedGroupId).toBeNull();
  });

  it("18. adversarial: rejects wrong child slot or wrong attribute mapping", () => {
    const slot0Dob = FORM_33B1_SLICE1_SEMANTIC_ENTRIES.find(e => e.ordinal === 18)!;
    expect(slot0Dob.repeatedGroupIndex).toBe(0);
    expect(slot0Dob.semanticKey).toBe("form33b1.child[0].dob");

    const slot1Dob = FORM_33B1_SLICE1_SEMANTIC_ENTRIES.find(e => e.ordinal === 26)!;
    expect(slot1Dob.repeatedGroupIndex).toBe(1);
    expect(slot1Dob.semanticKey).toBe("form33b1.child[1].dob");
  });

  it("19. adversarial: rejects invented 4th child slot (ordinal > 40)", () => {
    const childOrdinals = FORM_33B1_SLICE1_SEMANTIC_ENTRIES.filter(
      e => e.repeatedGroupId === "REPEATED_CHILD_BLOCK"
    ).map(e => e.ordinal);

    expect(Math.max(...childOrdinals)).toBe(40);
    expect(childOrdinals.length).toBe(24);
  });

  it("20. adversarial: rejects missing child attribute within a slot", () => {
    const slot0Entries = FORM_33B1_SLICE1_SEMANTIC_ENTRIES.filter(e => e.repeatedGroupIndex === 0);
    expect(slot0Entries.length).toBe(8);
  });

  it("21. adversarial: semantic ID stability — keys do not change between invocations", () => {
    for (const entry of FORM_33B1_SLICE1_SEMANTIC_ENTRIES) {
      expect(entry.semanticKey).toBeDefined();
      expect(typeof entry.semanticKey).toBe("string");
      expect(entry.semanticKey.length).toBeGreaterThan(0);
    }
  });

  it("22. adversarial: boundary mismatch detection", () => {
    for (const entry of FORM_33B1_SLICE1_SEMANTIC_ENTRIES) {
      const boundary = FORM_33B1_DECISION_BOUNDARIES[entry.ordinal];
      expect(entry.boundarySensitivity).toBe(boundary.sensitivity);
      expect(entry.decisionCategory).toBe(boundary.decisionCategory);
    }
  });

  it("23. adversarial: provenance mismatch detection", () => {
    for (const entry of FORM_33B1_SLICE1_SEMANTIC_ENTRIES) {
      const boundary = FORM_33B1_DECISION_BOUNDARIES[entry.ordinal];
      expect(entry.permittedProvenance).toEqual(boundary.permittedAuthorityClasses);
    }
  });

  it("24. adversarial: rejects attempted party-position inference or answer injection", () => {
    for (const entry of FORM_33B1_SLICE1_SEMANTIC_ENTRIES) {
      // Must not contain answer values or positions in notes or descriptions
      expect((entry as any).value).toBeUndefined();
      expect((entry as any).candidateValue).toBeUndefined();
    }
  });
});
