// Stage 9D-4B-2A-ii-a — adversarial tests for the semantic field-map type system,
// exact-template binding and fail-closed validator. Uses only small SYNTHETIC fixture
// inventories (never a real Ontario form field) to prove the architecture's logic.
import { describe, it, expect } from "vitest";
import type { DocxFieldInventoryResult, FfFieldInventoryEntry } from "./docxFieldInventory.js";
import {
  buildExpectedBinding,
  validateSemanticFieldMap,
  FieldMapVersionRegistry,
  DEFAULT_LEGAL_REQUIREDNESS_STATE,
  LEGAL_REQUIREDNESS_STATES,
  REVIEW_SENSITIVITY_CATEGORIES,
  MAPPING_RESOLUTION_STATES,
  TECHNICAL_INVENTORY_SCHEMA_VERSION,
  isValidCompletionDraftValue,
  type SemanticFieldMap,
  type SemanticFieldMapEntry,
  type ExactTemplateBinding
} from "./semanticFieldMap.js";

function fixtureField(overrides: Partial<FfFieldInventoryEntry> = {}): FfFieldInventoryEntry {
  return {
    order: 0,
    name: "Text1",
    type: "text",
    defaultValue: null,
    maxLength: 20,
    checkbox: null,
    dropdown: null,
    enabled: true,
    paragraphOrdinal: 0,
    tableDepth: 0,
    rawFfDataXml: "<w:ffData/>",
    ...overrides
  };
}

function fixtureInventory(fields: FfFieldInventoryEntry[]): DocxFieldInventoryResult {
  return {
    usesLegacyFormFields: fields.length > 0,
    usesContentControls: false,
    contentControlCount: 0,
    fields,
    anomalies: {
      duplicateNames: [],
      unnamedFieldCount: fields.filter(f => f.name === null).length,
      emptyNamedFieldCount: 0,
      fieldsWithUnknownType: 0,
      fieldsMissingEnabled: 0
    },
    documentProtection: { present: false, edit: null, enforcement: null },
    allPackagePartNames: ["word/document.xml"]
  };
}

function baseBinding(overrides: Partial<ExactTemplateBinding> = {}): ExactTemplateBinding {
  return buildExpectedBinding({
    formId: "form-1",
    formNumber: "8B",
    formVersionId: "version-1",
    versionLabel: "v1",
    templateId: "template-1",
    sourceSha256Hex: "a".repeat(64),
    ...overrides
  });
}

function baseEntry(overrides: Partial<SemanticFieldMapEntry> = {}): SemanticFieldMapEntry {
  return {
    semanticKey: "childFirstName",
    label: "Child's first name",
    description: "Synthetic fixture field — not a real form field.",
    technicalIdentity: { ordinal: 0, name: "Text1", type: "text", tableDepth: 0, paragraphOrdinal: 0 },
    formSection: null,
    semanticConstraints: { valueType: "TEXT", cardinality: "SINGLE", allowedValues: null, maxLength: 20 },
    technicalConstraints: { technicalType: "text", technicalMaxLength: 20, technicalDropdownOptions: null, technicallyRequired: false },
    legalRequiredness: DEFAULT_LEGAL_REQUIREDNESS_STATE,
    applicability: "UNKNOWN",
    permittedProvenance: ["USER_ENTERED"],
    reviewSensitivity: "NORMAL_ADMINISTRATIVE",
    mappingResolution: "STRUCTURALLY_IDENTIFIED",
    notes: null,
    warnings: [],
    ...overrides
  };
}

function baseMap(overrides: Partial<SemanticFieldMap> = {}): SemanticFieldMap {
  return {
    binding: baseBinding(),
    mapVersionLabel: "map-v1",
    entries: [baseEntry()],
    ...overrides
  };
}

const inv1 = fixtureInventory([fixtureField()]);

describe("exact-template binding validation", () => {
  it("1. exact source SHA accepted", () => {
    expect(() => validateSemanticFieldMap({ map: baseMap(), expectedBinding: baseBinding(), technicalInventory: inv1 })).not.toThrow();
  });

  it("2. wrong source SHA rejected", () => {
    const map = baseMap({ binding: baseBinding({ sourceSha256Hex: "b".repeat(64) }) });
    expect(() => validateSemanticFieldMap({ map, expectedBinding: baseBinding(), technicalInventory: inv1 })).toThrow(/source SHA-256/);
  });

  it("3. wrong form identity rejected", () => {
    const map = baseMap({ binding: baseBinding({ formId: "other-form" }) });
    expect(() => validateSemanticFieldMap({ map, expectedBinding: baseBinding(), technicalInventory: inv1 })).toThrow(/form identity/);
  });

  it("4. wrong version rejected", () => {
    const map = baseMap({ binding: baseBinding({ formVersionId: "other-version" }) });
    expect(() => validateSemanticFieldMap({ map, expectedBinding: baseBinding(), technicalInventory: inv1 })).toThrow(/form version/);
  });

  it("5. wrong template identity rejected", () => {
    const map = baseMap({ binding: baseBinding({ templateId: "other-template" }) });
    expect(() => validateSemanticFieldMap({ map, expectedBinding: baseBinding(), technicalInventory: inv1 })).toThrow(/template identity/);
  });

  it("6. wrong format rejected", () => {
    const map = baseMap({ binding: { ...baseBinding(), format: "PDF" as unknown as "DOCX" } });
    expect(() => validateSemanticFieldMap({ map, expectedBinding: baseBinding(), technicalInventory: inv1 })).toThrow(/format/);
  });

  it("7. wrong technical inventory version rejected", () => {
    const map = baseMap({ binding: baseBinding({ technicalInventorySchemaVersion: "old-version" }) });
    expect(() => validateSemanticFieldMap({ map, expectedBinding: baseBinding(), technicalInventory: inv1 })).toThrow(/inventory schema version/);
  });

  it("baseline: TECHNICAL_INVENTORY_SCHEMA_VERSION is used by default in buildExpectedBinding", () => {
    expect(baseBinding().technicalInventorySchemaVersion).toBe(TECHNICAL_INVENTORY_SCHEMA_VERSION);
  });
});

describe("technical field existence/type checks", () => {
  it("8. nonexistent technical field rejected", () => {
    const map = baseMap({ entries: [baseEntry({ technicalIdentity: { ordinal: 99, name: "Ghost", type: "text", tableDepth: 0, paragraphOrdinal: 0 } })] });
    expect(() => validateSemanticFieldMap({ map, expectedBinding: baseBinding(), technicalInventory: inv1 })).toThrow(/does not exist in the real inventory/);
  });

  it("9. field-type mismatch rejected", () => {
    const map = baseMap({ entries: [baseEntry({ technicalConstraints: { technicalType: "checkbox", technicalMaxLength: null, technicalDropdownOptions: null, technicallyRequired: false } })] });
    expect(() => validateSemanticFieldMap({ map, expectedBinding: baseBinding(), technicalInventory: inv1 })).toThrow(/type mismatch/);
  });

  it("10. duplicate technical field names remain distinguishable (addressable by full identity)", () => {
    const dupFields = [
      fixtureField({ order: 0, name: "Dup" }),
      fixtureField({ order: 1, name: "Dup" })
    ];
    const inv = fixtureInventory(dupFields);
    const map = baseMap({
      entries: [
        baseEntry({ semanticKey: "first", technicalIdentity: { ordinal: 0, name: "Dup", type: "text", tableDepth: 0, paragraphOrdinal: 0 } }),
        baseEntry({ semanticKey: "second", technicalIdentity: { ordinal: 1, name: "Dup", type: "text", tableDepth: 0, paragraphOrdinal: 0 } })
      ]
    });
    expect(() => validateSemanticFieldMap({ map, expectedBinding: baseBinding(), technicalInventory: inv })).not.toThrow();
  });

  it("11. unnamed technical fields remain addressable", () => {
    const inv = fixtureInventory([fixtureField({ order: 0, name: null })]);
    const map = baseMap({ entries: [baseEntry({ technicalIdentity: { ordinal: 0, name: null, type: "text", tableDepth: 0, paragraphOrdinal: 0 } })] });
    expect(() => validateSemanticFieldMap({ map, expectedBinding: baseBinding(), technicalInventory: inv })).not.toThrow();
  });

  it("12. map stable across repeated validation (no nondeterminism)", () => {
    const map = baseMap();
    const results = [0, 1, 2].map(() => {
      try {
        validateSemanticFieldMap({ map, expectedBinding: baseBinding(), technicalInventory: inv1 });
        return "ok";
      } catch (e) {
        return (e as Error).message;
      }
    });
    expect(new Set(results).size).toBe(1);
  });
});

describe("legal vs technical requiredness separation", () => {
  it("13. legal requiredness does not default to LEGALLY_REQUIRED/ESTABLISHED", () => {
    expect(DEFAULT_LEGAL_REQUIREDNESS_STATE).toBe("UNKNOWN");
    expect(LEGAL_REQUIREDNESS_STATES).not.toContain("LEGALLY_REQUIRED");
  });

  it("14. technical requiredness is independently settable from legal requiredness", () => {
    const entry = baseEntry({
      technicalConstraints: { technicalType: "text", technicalMaxLength: 20, technicalDropdownOptions: null, technicallyRequired: true },
      legalRequiredness: "UNKNOWN"
    });
    expect(entry.technicalConstraints.technicallyRequired).toBe(true);
    expect(entry.legalRequiredness).toBe("UNKNOWN");
  });
});

describe("semantic vs technical constraints separation", () => {
  it("15. semantic constraints (e.g. date) are represented separately from technical constraints (text, maxlength)", () => {
    const entry = baseEntry({
      semanticConstraints: { valueType: "DATE", cardinality: "SINGLE", allowedValues: null, maxLength: null },
      technicalConstraints: { technicalType: "text", technicalMaxLength: 20, technicalDropdownOptions: null, technicallyRequired: false }
    });
    expect(entry.semanticConstraints.valueType).toBe("DATE");
    expect(entry.technicalConstraints.technicalType).toBe("text");
  });
});

describe("sensitive-field classification coverage (16-22)", () => {
  const categories = [
    "NORMAL_ADMINISTRATIVE",
    "SWORN_FACT",
    "ADMISSION_OR_DENIAL",
    "REQUESTED_ORDER",
    "PLAN_OF_CARE_POSITION",
    "LEGAL_GROUND_OR_POSITION",
    "SIGNATURE_OR_ATTESTATION",
    "COMMISSIONING_OR_CERTIFICATION"
  ] as const;

  for (const category of categories) {
    it(`represents ${category}`, () => {
      expect(REVIEW_SENSITIVITY_CATEGORIES).toContain(category);
      const entry = baseEntry({ reviewSensitivity: category });
      expect(entry.reviewSensitivity).toBe(category);
    });
  }
});

describe("provenance / review-state integrity", () => {
  it("23. machine-suggested provenance does not imply reviewed status", () => {
    expect(
      isValidCompletionDraftValue({
        binding: baseBinding(),
        mapVersionLabel: "map-v1",
        semanticKey: "childFirstName",
        technicalIdentity: { ordinal: 0, name: "Text1", type: "text", tableDepth: 0, paragraphOrdinal: 0 },
        value: "Alex",
        provenance: "MACHINE_SUGGESTED",
        reviewState: "MACHINE_SUGGESTED_UNREVIEWED"
      })
    ).toBe(true);
  });

  it("24. professional-review state cannot be fabricated by a map default (machine-suggested + professionally-reviewed rejected)", () => {
    expect(
      isValidCompletionDraftValue({
        binding: baseBinding(),
        mapVersionLabel: "map-v1",
        semanticKey: "childFirstName",
        technicalIdentity: { ordinal: 0, name: "Text1", type: "text", tableDepth: 0, paragraphOrdinal: 0 },
        value: "Alex",
        provenance: "MACHINE_SUGGESTED",
        reviewState: "PROFESSIONALLY_REVIEWED"
      })
    ).toBe(false);
  });

  it("25. unresolved/ambiguous mapping status is a valid, safely-handled state (not an error)", () => {
    const map = baseMap({ entries: [baseEntry({ mappingResolution: "UNRESOLVED" })] });
    expect(() => validateSemanticFieldMap({ map, expectedBinding: baseBinding(), technicalInventory: inv1 })).not.toThrow();
    expect(MAPPING_RESOLUTION_STATES).toContain("UNRESOLVED");
  });

  it("26. an unmapped technical field does not cause the validator to guess/invent a mapping for it", () => {
    // Inventory has 2 fields, map only covers field 0 — validator must not synthesize field 1.
    const inv = fixtureInventory([fixtureField({ order: 0, name: "Text1" }), fixtureField({ order: 1, name: "B", paragraphOrdinal: 1 })]);
    const map = baseMap();
    validateSemanticFieldMap({ map, expectedBinding: baseBinding(), technicalInventory: inv });
    expect(map.entries.length).toBe(1);
    expect(map.entries.some(e => e.technicalIdentity.ordinal === 1)).toBe(false);
  });
});

describe("cardinality / duplicate-target checks", () => {
  it("rejects duplicate SINGLE-cardinality semantic target", () => {
    const map = baseMap({
      entries: [
        baseEntry({ semanticKey: "childFirstName", technicalIdentity: { ordinal: 0, name: "Text1", type: "text", tableDepth: 0, paragraphOrdinal: 0 } }),
        baseEntry({ semanticKey: "childFirstName", technicalIdentity: { ordinal: 1, name: "Text2", type: "text", tableDepth: 0, paragraphOrdinal: 1 } })
      ]
    });
    const inv = fixtureInventory([fixtureField({ order: 0, name: "Text1" }), fixtureField({ order: 1, name: "Text2", paragraphOrdinal: 1 })]);
    expect(() => validateSemanticFieldMap({ map, expectedBinding: baseBinding(), technicalInventory: inv })).toThrow(/duplicate semantic target/);
  });

  it("allows duplicate semantic target when cardinality is REPEATED", () => {
    const map = baseMap({
      entries: [
        baseEntry({ semanticKey: "childName", semanticConstraints: { valueType: "TEXT", cardinality: "REPEATED", allowedValues: null, maxLength: 20 }, technicalIdentity: { ordinal: 0, name: "Text1", type: "text", tableDepth: 0, paragraphOrdinal: 0 } }),
        baseEntry({ semanticKey: "childName", semanticConstraints: { valueType: "TEXT", cardinality: "REPEATED", allowedValues: null, maxLength: 20 }, technicalIdentity: { ordinal: 1, name: "Text2", type: "text", tableDepth: 0, paragraphOrdinal: 1 } })
      ]
    });
    const inv = fixtureInventory([fixtureField({ order: 0, name: "Text1" }), fixtureField({ order: 1, name: "Text2", paragraphOrdinal: 1 })]);
    expect(() => validateSemanticFieldMap({ map, expectedBinding: baseBinding(), technicalInventory: inv })).not.toThrow();
  });

  it("rejects allowed values that conflict with technical dropdown options", () => {
    const inv = fixtureInventory([fixtureField({ order: 0, name: "Dd1", type: "dropdown", dropdown: { listEntries: ["Yes", "No"], resultIndex: 0 } })]);
    const map = baseMap({
      entries: [
        baseEntry({
          technicalIdentity: { ordinal: 0, name: "Dd1", type: "dropdown", tableDepth: 0, paragraphOrdinal: 0 },
          technicalConstraints: { technicalType: "dropdown", technicalMaxLength: null, technicalDropdownOptions: ["Yes", "Maybe"], technicallyRequired: false }
        })
      ]
    });
    expect(() => validateSemanticFieldMap({ map, expectedBinding: baseBinding(), technicalInventory: inv })).toThrow(/not present in the real technical dropdown options/);
  });

  it("required map metadata missing is rejected", () => {
    const badEntry = { ...baseEntry(), label: "" } as SemanticFieldMapEntry;
    const map = baseMap({ entries: [badEntry] });
    expect(() => validateSemanticFieldMap({ map, expectedBinding: baseBinding(), technicalInventory: inv1 })).toThrow(/missing required map metadata/);
  });
});

describe("map immutability (application-layer registry, mirrors 9D-4A DB guard)", () => {
  it("29. a historical/registered map version cannot be silently mutated", () => {
    const registry = new FieldMapVersionRegistry();
    const map = baseMap();
    registry.register(map);
    expect(() => registry.register(map)).toThrow(/cannot be mutated/);
    // Attempting to register a "changed" map under the same label is also rejected.
    const mutated = baseMap({ entries: [baseEntry({ semanticKey: "differentKey" })] });
    expect(() => registry.register(mutated)).toThrow(/cannot be mutated/);
  });

  it("30. a correction requires a new version (old version remains retrievable/intact)", () => {
    const registry = new FieldMapVersionRegistry();
    const v1 = baseMap({ mapVersionLabel: "map-v1" });
    registry.register(v1);
    const v2 = baseMap({ mapVersionLabel: "map-v2", entries: [baseEntry({ label: "Corrected label" })] });
    registry.register(v2);
    expect(registry.get("template-1", "map-v1")).toBe(v1);
    expect(registry.get("template-1", "map-v2")).toBe(v2);
    expect(registry.listVersions("template-1").sort()).toEqual(["map-v1", "map-v2"]);
  });
});

describe("one canonical map per template (31)", () => {
  it("type system has no parent-specific or professional-specific map variant field", () => {
    const map = baseMap();
    expect(Object.keys(map)).not.toContain("audience");
    expect(Object.keys(map)).not.toContain("parentVariant");
    expect(Object.keys(map)).not.toContain("professionalVariant");
    expect(Object.keys(map).sort()).toEqual(["binding", "entries", "mapVersionLabel"]);
  });

  it("registering two differently-labelled maps for the same template is allowed (versions), but the type carries no per-audience discriminator to abuse for a second concurrent map", () => {
    const registry = new FieldMapVersionRegistry();
    registry.register(baseMap({ mapVersionLabel: "map-v1" }));
    expect(() => registry.register(baseMap({ mapVersionLabel: "map-v1" }))).toThrow();
  });
});
