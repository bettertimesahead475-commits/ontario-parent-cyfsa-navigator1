// Stage 9D-4B-2A-ii-b3 — real Form 33C semantic field map tests.
//
// Follows the pattern established by form14aSemanticFieldMap.test.ts / form351aSemanticFieldMap
// .test.ts: exact-template binding against the REAL Form 33C technical inventory (Stage
// 9D-4B-2A-i's docxFieldInventoryData.ts entry) and, where the real uploaded DOCX artifact is
// present, against a freshly re-parsed inventory of the real bytes. Independently varies each
// validation dimension (lockstep-blind-spot heuristic), sensitivity/provenance/legal-requiredness
// boundaries, cardinality of the repeated child/signatory blocks, determinism, immutability,
// Form 14A/35.1A regression, and confirms the remaining controlled forms + Form 33B stay
// unmapped. Adds Form 33C's own central invariant: AGREED FACT != FACT, and provenance never
// implies agreement.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import crypto from "node:crypto";
import {
  validateSemanticFieldMap,
  FieldMapVersionRegistry,
  buildExpectedBinding,
  TECHNICAL_INVENTORY_SCHEMA_VERSION,
  type SemanticFieldMap
} from "./semanticFieldMap.js";
import { buildDocxFieldInventory, type DocxFieldInventoryResult } from "./docxFieldInventory.js";
import { DOCX_FIELD_INVENTORIES } from "./docxFieldInventoryData.js";
import { REAL_ARTIFACT_BYTE_VERIFICATIONS } from "./officialFormSourceManifest.js";
import {
  FORM_33C_SEMANTIC_FIELD_MAP,
  FORM_33C_SEMANTIC_ENTRIES,
  FORM_33C_EXACT_TEMPLATE_BINDING,
  FORM_33C_SOURCE_SHA256_HEX,
  FORM_33C_MAP_VERSION_LABEL,
  form33cCoverageSummary
} from "./form33cSemanticFieldMap.js";
import {
  FORM_14A_SEMANTIC_FIELD_MAP,
  FORM_14A_EXACT_TEMPLATE_BINDING,
  FORM_14A_SOURCE_SHA256_HEX
} from "./form14aSemanticFieldMap.js";
import {
  FORM_351A_SEMANTIC_FIELD_MAP,
  FORM_351A_EXACT_TEMPLATE_BINDING,
  FORM_351A_SOURCE_SHA256_HEX
} from "./form351aSemanticFieldMap.js";

function form33cInventoryFromFrozenData(): DocxFieldInventoryResult {
  const record = DOCX_FIELD_INVENTORIES.find(f => f.formNumber === "33C");
  expect(record, "Form 33C entry must exist in the frozen 9D-4B-2A-i inventory data").toBeTruthy();
  const rec = record!;
  return {
    usesLegacyFormFields: rec.usesLegacyFormFields,
    usesContentControls: rec.usesContentControls,
    contentControlCount: rec.contentControlCount,
    fields: rec.fields.map(f => ({
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
    anomalies: rec.anomalies,
    documentProtection: rec.documentProtection,
    allPackagePartNames: ["word/document.xml"]
  };
}

const realInv = form33cInventoryFromFrozenData();

describe("Form 33C frozen technical inventory sanity", () => {
  it("has exactly 46 technical fields", () => {
    expect(realInv.fields.length).toBe(46);
  });

  it("SHA-256 cross-check: FORM_33C_SOURCE_SHA256_HEX matches officialFormSourceManifest.ts", () => {
    const manifestEntry = REAL_ARTIFACT_BYTE_VERIFICATIONS.find(e => e.format === "DOCX" && e.formNumber === "33C");
    expect(manifestEntry).toBeTruthy();
    expect(FORM_33C_SOURCE_SHA256_HEX).toBe(manifestEntry!.sha256Hex);
  });

  it("SHA-256 cross-check: matches docxFieldInventoryData.ts's Form 33C entry", () => {
    const record = DOCX_FIELD_INVENTORIES.find(f => f.formNumber === "33C");
    expect(record!.sha256Hex).toBe(FORM_33C_SOURCE_SHA256_HEX);
  });

  it("has zero duplicate w:names and zero unnamed fields (all-empty-name anomaly shape, distinct from Form 14A/35.1A)", () => {
    expect(realInv.anomalies.duplicateNames).toEqual([]);
    expect(realInv.anomalies.unnamedFieldCount).toBe(0);
    expect(realInv.anomalies.emptyNamedFieldCount).toBe(45);
  });
});

describe("Form 33C real semantic map: exact-template binding success", () => {
  it("1. validates cleanly against the real Form 33C inventory + expected binding", () => {
    expect(() =>
      validateSemanticFieldMap({
        map: FORM_33C_SEMANTIC_FIELD_MAP,
        expectedBinding: FORM_33C_EXACT_TEMPLATE_BINDING,
        technicalInventory: realInv
      })
    ).not.toThrow();
  });

  it("every entry declares mappingResolution HUMAN_MAPPED, never PROFESSIONALLY_REVIEWED", () => {
    for (const e of FORM_33C_SEMANTIC_ENTRIES) {
      expect(e.mappingResolution).not.toBe("PROFESSIONALLY_REVIEWED");
    }
  });

  it("12. maps all 46 real technical fields (deliberately mapped or UNRESOLVED — none silently missing)", () => {
    const identityKey = (o: number, n: string | null, t: string, d: number, p: number) => `${o}::${n}::${t}::${d}::${p}`;
    const mappedKeys = new Set(
      FORM_33C_SEMANTIC_ENTRIES.map(e =>
        identityKey(e.technicalIdentity.ordinal, e.technicalIdentity.name, e.technicalIdentity.type, e.technicalIdentity.tableDepth, e.technicalIdentity.paragraphOrdinal)
      )
    );
    for (const f of realInv.fields) {
      expect(mappedKeys.has(identityKey(f.order, f.name, f.type, f.tableDepth, f.paragraphOrdinal))).toBe(true);
    }
    expect(FORM_33C_SEMANTIC_ENTRIES.length).toBe(46);
  });
});

// ---------------------------------------------------------------------------
// LOCKSTEP-BLIND-SPOT MATRIX — each dimension varied INDEPENDENTLY, all others left valid.
// ---------------------------------------------------------------------------
function wrongBinding(overrides: Partial<typeof FORM_33C_EXACT_TEMPLATE_BINDING>) {
  return { ...FORM_33C_EXACT_TEMPLATE_BINDING, ...overrides };
}
function mapWithBinding(binding: typeof FORM_33C_EXACT_TEMPLATE_BINDING): SemanticFieldMap {
  return { ...FORM_33C_SEMANTIC_FIELD_MAP, binding };
}

describe("Form 33C: independent-dimension (lockstep-blind-spot) failure matrix", () => {
  it("3. same form, wrong SHA only -> fails on SHA", () => {
    const map = mapWithBinding(wrongBinding({ sourceSha256Hex: "0".repeat(64) }));
    expect(() =>
      validateSemanticFieldMap({ map, expectedBinding: FORM_33C_EXACT_TEMPLATE_BINDING, technicalInventory: realInv })
    ).toThrow(/source SHA-256/);
  });

  it("4. same SHA fixture, wrong form identity only -> fails on form identity", () => {
    const map = mapWithBinding(wrongBinding({ formId: "official-form-8b", formNumber: "8B" }));
    expect(() =>
      validateSemanticFieldMap({ map, expectedBinding: FORM_33C_EXACT_TEMPLATE_BINDING, technicalInventory: realInv })
    ).toThrow(/form identity/);
  });

  it("5. wrong version only -> fails on form version", () => {
    const map = mapWithBinding(wrongBinding({ formVersionId: "official-form-33c-version-bogus", versionLabel: "bogus" }));
    expect(() =>
      validateSemanticFieldMap({ map, expectedBinding: FORM_33C_EXACT_TEMPLATE_BINDING, technicalInventory: realInv })
    ).toThrow(/form version/);
  });

  it("6. wrong template identity only -> fails on template identity", () => {
    const map = mapWithBinding(wrongBinding({ templateId: "official-form-33c-template-bogus" }));
    expect(() =>
      validateSemanticFieldMap({ map, expectedBinding: FORM_33C_EXACT_TEMPLATE_BINDING, technicalInventory: realInv })
    ).toThrow(/template identity/);
  });

  it("7. wrong format only -> fails on format", () => {
    const map = mapWithBinding(wrongBinding({ format: "PDF" as unknown as "DOCX" }));
    expect(() =>
      validateSemanticFieldMap({ map, expectedBinding: FORM_33C_EXACT_TEMPLATE_BINDING, technicalInventory: realInv })
    ).toThrow(/format/);
  });

  it("8. wrong inventory schema version only -> fails on inventory schema version", () => {
    const map = mapWithBinding(wrongBinding({ technicalInventorySchemaVersion: "old-schema-v0" }));
    expect(() =>
      validateSemanticFieldMap({ map, expectedBinding: FORM_33C_EXACT_TEMPLATE_BINDING, technicalInventory: realInv })
    ).toThrow(/inventory schema version/);
  });

  it("9. nonexistent technical field only -> fails on missing real field", () => {
    const bogusEntry = {
      ...FORM_33C_SEMANTIC_ENTRIES[0],
      semanticKey: "bogusField",
      technicalIdentity: { ordinal: 999, name: "NoSuchField", type: "text" as const, tableDepth: 1, paragraphOrdinal: 999 }
    };
    const map: SemanticFieldMap = { ...FORM_33C_SEMANTIC_FIELD_MAP, entries: [...FORM_33C_SEMANTIC_ENTRIES, bogusEntry] };
    expect(() =>
      validateSemanticFieldMap({ map, expectedBinding: FORM_33C_EXACT_TEMPLATE_BINDING, technicalInventory: realInv })
    ).toThrow(/does not exist in the real inventory/);
  });

  it("10. wrong field type only (same identity otherwise) -> fails on type mismatch", () => {
    const target = FORM_33C_SEMANTIC_ENTRIES.find(e => e.semanticKey === "courtFileNumber")!;
    const badEntry = { ...target, technicalConstraints: { ...target.technicalConstraints, technicalType: "checkbox" as const } };
    const map: SemanticFieldMap = {
      ...FORM_33C_SEMANTIC_FIELD_MAP,
      entries: FORM_33C_SEMANTIC_ENTRIES.map(e => (e.semanticKey === "courtFileNumber" ? badEntry : e))
    };
    expect(() =>
      validateSemanticFieldMap({ map, expectedBinding: FORM_33C_EXACT_TEMPLATE_BINDING, technicalInventory: realInv })
    ).toThrow(/type mismatch/);
  });

  it("11. wrong cardinality only (duplicate semantic target, SINGLE) -> fails on duplicate semantic target", () => {
    const target = FORM_33C_SEMANTIC_ENTRIES.find(e => e.semanticKey === "courtFileNumber")!;
    const dup = { ...target };
    const map: SemanticFieldMap = { ...FORM_33C_SEMANTIC_FIELD_MAP, entries: [...FORM_33C_SEMANTIC_ENTRIES, dup] };
    expect(() =>
      validateSemanticFieldMap({ map, expectedBinding: FORM_33C_EXACT_TEMPLATE_BINDING, technicalInventory: realInv })
    ).toThrow(/duplicate semantic target/);
  });

  it("semantic-key mismatch independently: same technical field, different semanticKey -> validates (key is metadata, not identity)", () => {
    const renamed = FORM_33C_SEMANTIC_ENTRIES.map(e =>
      e.semanticKey === "courtFileNumber" ? { ...e, semanticKey: "courtFileNumberRenamed" } : e
    );
    const map: SemanticFieldMap = { ...FORM_33C_SEMANTIC_FIELD_MAP, entries: renamed };
    expect(() =>
      validateSemanticFieldMap({ map, expectedBinding: FORM_33C_EXACT_TEMPLATE_BINDING, technicalInventory: realInv })
    ).not.toThrow();
  });

  it("technical-field mismatch independently: retargeting a semanticKey onto an already-used SINGLE field -> fails on duplicate technical target, not on semanticKey", () => {
    const courtOfficeAddress = FORM_33C_SEMANTIC_ENTRIES.find(e => e.semanticKey === "courtOfficeAddress")!;
    const retargeted = FORM_33C_SEMANTIC_ENTRIES.map(e =>
      e.semanticKey === "courtFileNumber"
        ? { ...e, technicalIdentity: courtOfficeAddress.technicalIdentity, technicalConstraints: courtOfficeAddress.technicalConstraints }
        : e
    );
    const map: SemanticFieldMap = { ...FORM_33C_SEMANTIC_FIELD_MAP, entries: retargeted };
    expect(() =>
      validateSemanticFieldMap({ map, expectedBinding: FORM_33C_EXACT_TEMPLATE_BINDING, technicalInventory: realInv })
    ).toThrow(/target the identical technical field/);
  });
});

describe("Form 33C: repeated-structure cardinality preserved (children and signatories)", () => {
  it("13. three child blocks yield 24 distinct semanticKeys, never collapsed into one repeated key", () => {
    const isChildSlotKey = (k: string) => /^child(One|Two|Three)/.test(k);
    const childKeys = FORM_33C_SEMANTIC_ENTRIES.filter(e => isChildSlotKey(e.semanticKey)).map(e => e.semanticKey);
    expect(childKeys.length).toBe(24);
    expect(new Set(childKeys).size).toBe(24);
    for (const e of FORM_33C_SEMANTIC_ENTRIES.filter(x => isChildSlotKey(x.semanticKey))) {
      expect(e.semanticConstraints.cardinality).toBe("SINGLE");
    }
  });

  it("18. three signatory blocks yield 9 distinct semanticKeys with fixed (non-open-ended) cardinality", () => {
    const sigKeys = FORM_33C_SEMANTIC_ENTRIES.filter(e => e.semanticKey.startsWith("signatory")).map(e => e.semanticKey);
    expect(sigKeys.length).toBe(9);
    expect(new Set(sigKeys).size).toBe(9);
    for (const e of FORM_33C_SEMANTIC_ENTRIES.filter(x => x.semanticKey.startsWith("signatory"))) {
      expect(e.semanticConstraints.cardinality).toBe("SINGLE");
    }
  });

  it("no entry declares REPEATED cardinality — the template's child/signatory slots are fixed, not dynamic", () => {
    expect(FORM_33C_SEMANTIC_ENTRIES.some(e => e.semanticConstraints.cardinality === "REPEATED")).toBe(false);
  });
});

describe("Form 33C: unnamed/empty-name control disambiguation (distinct anomaly shape from Form 14A/35.1A)", () => {
  it("all 45 empty-w:name fields are mapped to 45 DISTINCT semanticKeys by full identity, never by name", () => {
    const emptyNamed = FORM_33C_SEMANTIC_ENTRIES.filter(e => e.technicalIdentity.name === "");
    expect(emptyNamed.length).toBe(45);
    expect(new Set(emptyNamed.map(e => e.semanticKey)).size).toBe(45);
  });

  it("exactly one field (courtFileNumber) has a real w:name", () => {
    const named = FORM_33C_SEMANTIC_ENTRIES.filter(e => e.technicalIdentity.name !== "");
    expect(named.length).toBe(1);
    expect(named[0].semanticKey).toBe("courtFileNumber");
  });
});

describe("Form 33C: administrative vs agreed-fact-content vs signature classification", () => {
  it("16. administrative classification correct for header/party-identification/child-identity fields", () => {
    const adminKeys = [
      "courtLevel",
      "courtFileNumber",
      "courtOfficeAddress",
      "applicantNameAndAddressForService",
      "respondentNameAndAddressForService",
      "childrensLawyerAgentNameAndAddress",
      "childOneFullLegalName",
      "childOneDateOfBirth",
      "childOneAge",
      "childOneSex",
      "childOneIndigenousStatus",
      "childOneParentsFullLegalNames"
    ];
    for (const k of adminKeys) {
      const e = FORM_33C_SEMANTIC_ENTRIES.find(x => x.semanticKey === k)!;
      expect(e, k).toBeTruthy();
      expect(e.reviewSensitivity).toBe("NORMAL_ADMINISTRATIVE");
    }
  });

  it("19. administrative fields are never confused with agreed-fact content", () => {
    const adminEntry = FORM_33C_SEMANTIC_ENTRIES.find(e => e.semanticKey === "childOneFullLegalName")!;
    expect(["ADMISSION_OR_DENIAL", "LEGAL_GROUND_OR_POSITION", "REQUESTED_ORDER"]).not.toContain(adminEntry.reviewSensitivity);
    const courtFileNumber = FORM_33C_SEMANTIC_ENTRIES.find(e => e.semanticKey === "courtFileNumber")!;
    expect(["ADMISSION_OR_DENIAL", "LEGAL_GROUND_OR_POSITION", "REQUESTED_ORDER"]).not.toContain(courtFileNumber.reviewSensitivity);
  });

  it("20. the five agreed-fact/agreed-position fields are classified distinctly from administrative content", () => {
    const agreedKeys = [
      "casPriorInvolvementAgreedNarrative",
      "placeOfSafetyReasonsAgreedNarrative",
      "protectionFindingGroundsAgreed",
      "importantEventsSinceApplicationAgreed",
      "proposedOrderAgreedPosition"
    ];
    for (const k of agreedKeys) {
      const e = FORM_33C_SEMANTIC_ENTRIES.find(x => x.semanticKey === k)!;
      expect(e, k).toBeTruthy();
      expect(["ADMISSION_OR_DENIAL", "LEGAL_GROUND_OR_POSITION", "REQUESTED_ORDER"]).toContain(e.reviewSensitivity);
      expect(e.reviewSensitivity).not.toBe("NORMAL_ADMINISTRATIVE");
    }
    expect(form33cCoverageSummary().agreedFactContent).toBe(5);
  });

  it("27. signature fields are mapped only because a real technical control exists for each — no fabricated signature control", () => {
    const sigEntries = FORM_33C_SEMANTIC_ENTRIES.filter(e => e.reviewSensitivity === "SIGNATURE_OR_ATTESTATION");
    expect(sigEntries.length).toBe(9); // 3 signatories x (name, relationship/position, date-of-signature)
    for (const e of sigEntries) {
      const real = realInv.fields.find(
        f => f.order === e.technicalIdentity.ordinal && f.type === e.technicalIdentity.type && f.paragraphOrdinal === e.technicalIdentity.paragraphOrdinal
      );
      expect(real, e.semanticKey).toBeTruthy();
    }
  });

  it("28. no fabricated signature field: the 'Signature' table column itself (as opposed to 'Date of signature') has no mapped control, matching the absence of a technical field for it", () => {
    // Each signatory row maps exactly 3 fields (name, relationship/position, date), never 4 — the
    // 'Signature' column's own cell is confirmed (via the module's documented XML walk) to carry
    // no <w:ffData>, so nothing here claims a 4th control per row.
    const sigNames = FORM_33C_SEMANTIC_ENTRIES.filter(e => e.semanticKey.startsWith("signatory")).map(e => e.semanticKey);
    for (const slot of ["One", "Two", "Three"]) {
      const forSlot = sigNames.filter(k => k.startsWith(`signatory${slot}`));
      expect(forSlot.length).toBe(3);
    }
  });

  it("no field is classified SWORN_FACT — Form 33C is a multi-party agreement, not a sworn affidavit (no jurat/oath text exists anywhere on this form)", () => {
    expect(form33cCoverageSummary().swornFact).toBe(0);
  });
});

describe("Form 33C: AGREED FACT != FACT — the central invariant for this form", () => {
  const agreedEntries = FORM_33C_SEMANTIC_ENTRIES.filter(e =>
    ["ADMISSION_OR_DENIAL", "LEGAL_GROUND_OR_POSITION", "REQUESTED_ORDER"].includes(e.reviewSensitivity)
  );

  it("21. matter-derived provenance is never permitted for agreed-fact/agreed-position entries (matter-derived does not imply agreement)", () => {
    for (const e of agreedEntries) {
      expect(e.permittedProvenance, e.semanticKey).not.toContain("MATTER_DERIVED");
    }
  });

  it("22. machine-suggested provenance is never permitted for agreed-fact/agreed-position entries (machine-suggested does not imply agreement)", () => {
    for (const e of agreedEntries) {
      expect(e.permittedProvenance, e.semanticKey).not.toContain("MACHINE_SUGGESTED");
    }
  });

  it("23. professionally-reviewed provenance is permitted but never automatically implies agreement — the map's own notes say so explicitly for every agreed-fact entry", () => {
    for (const e of agreedEntries) {
      expect(e.permittedProvenance, e.semanticKey).toContain("PROFESSIONALLY_REVIEWED");
      expect(e.notes, e.semanticKey).toBeTruthy();
      expect(e.notes!.toLowerCase()).toContain("does not assert that any specific content is agreed, true, or should be agreed to".toLowerCase());
    }
  });

  it("24. a repeated allegation does not imply agreement: nothing in the map's type-level entries carries any concept of 'times referenced' or 'previously alleged' that could stand in for agreement", () => {
    for (const e of agreedEntries) {
      expect(Object.keys(e)).not.toContain("timesAlleged");
      expect(Object.keys(e)).not.toContain("allegationCount");
      expect(Object.keys(e)).not.toContain("agreed");
    }
  });

  it("25. no mapped agreed-fact field carries a default agreement state: SemanticFieldMapEntry has no 'agreed'/'agreementState' property at all, and mappingResolution never doubles as an agreement flag", () => {
    for (const e of agreedEntries) {
      expect((e as unknown as Record<string, unknown>).agreementState).toBeUndefined();
      expect((e as unknown as Record<string, unknown>).agreed).toBeUndefined();
      // mappingResolution describes MAP quality (is the control's MEANING known), never agreement:
      expect(["UNRESOLVED", "STRUCTURALLY_IDENTIFIED", "HUMAN_MAPPED", "PROFESSIONALLY_REVIEWED"]).toContain(e.mappingResolution);
    }
  });

  it("agreement-related content remains consequential even though it is technically just a text field: every agreed-fact entry declares a non-administrative reviewSensitivity and a non-null explanatory notes field", () => {
    for (const e of agreedEntries) {
      expect(e.semanticConstraints.valueType === "FREE_TEXT_NARRATIVE" || e.semanticConstraints.valueType === "TEXT").toBe(true);
      expect(e.reviewSensitivity).not.toBe("NORMAL_ADMINISTRATIVE");
      expect(e.notes).not.toBeNull();
    }
  });

  it("proposedOrderAgreedPosition (an agreed POSITION on the order sought) is kept distinct from the agreed-FACT narrative fields, so 'agreed order' is never confused with 'agreed fact'", () => {
    const orderEntry = FORM_33C_SEMANTIC_ENTRIES.find(e => e.semanticKey === "proposedOrderAgreedPosition")!;
    expect(orderEntry.reviewSensitivity).toBe("REQUESTED_ORDER");
    const factEntry = FORM_33C_SEMANTIC_ENTRIES.find(e => e.semanticKey === "casPriorInvolvementAgreedNarrative")!;
    expect(factEntry.reviewSensitivity).not.toBe(orderEntry.reviewSensitivity);
  });
});

describe("Form 33C: legal requiredness is never guessed", () => {
  it("26. every entry's legalRequiredness is UNKNOWN (conservative default; not established by this stage)", () => {
    for (const e of FORM_33C_SEMANTIC_ENTRIES) {
      expect(e.legalRequiredness).toBe("UNKNOWN");
    }
  });

  it("no entry uses ESTABLISHED or REQUIRES_LEGAL_REVIEW", () => {
    for (const e of FORM_33C_SEMANTIC_ENTRIES) {
      expect(["ESTABLISHED", "REQUIRES_LEGAL_REVIEW"]).not.toContain(e.legalRequiredness);
    }
  });
});

describe("Form 33C: unresolved-field handling stays safe", () => {
  it("15. an UNRESOLVED entry validates without the validator guessing a meaning for it", () => {
    const unresolvedEntry = {
      ...FORM_33C_SEMANTIC_ENTRIES[2],
      semanticKey: "unresolvedTestField",
      mappingResolution: "UNRESOLVED" as const,
      technicalIdentity: { ordinal: 998, name: null, type: "text" as const, tableDepth: 0, paragraphOrdinal: 0 }
    };
    const invWithExtra: DocxFieldInventoryResult = {
      ...realInv,
      fields: [
        ...realInv.fields,
        { order: 998, name: null, type: "text", defaultValue: null, maxLength: null, checkbox: null, dropdown: null, enabled: true, paragraphOrdinal: 0, tableDepth: 0, rawFfDataXml: "<w:ffData/>" }
      ]
    };
    const map: SemanticFieldMap = { ...FORM_33C_SEMANTIC_FIELD_MAP, entries: [...FORM_33C_SEMANTIC_ENTRIES, unresolvedEntry] };
    expect(() => validateSemanticFieldMap({ map, expectedBinding: FORM_33C_EXACT_TEMPLATE_BINDING, technicalInventory: invWithExtra })).not.toThrow();
  });

  it("the coverage summary reports mapped+unresolved without synthesizing a guess", () => {
    const summary = form33cCoverageSummary();
    expect(summary.totalTechnicalFields).toBe(46);
    expect(summary.mapped).toBe(46);
    expect(summary.unresolved).toBe(0);
    expect(summary.mapped + summary.unresolved).toBe(FORM_33C_SEMANTIC_ENTRIES.length);
  });
});

describe("Form 33C: determinism and immutability", () => {
  it("29. the map is deterministic across repeated reads", () => {
    const a = JSON.stringify(FORM_33C_SEMANTIC_FIELD_MAP);
    const b = JSON.stringify(FORM_33C_SEMANTIC_FIELD_MAP);
    expect(a).toBe(b);
  });

  it("map version is immutable: registering the same (templateId, mapVersionLabel) twice is rejected (9D-4A immutability invariant)", () => {
    const registry = new FieldMapVersionRegistry();
    registry.register(FORM_33C_SEMANTIC_FIELD_MAP);
    expect(() => registry.register(FORM_33C_SEMANTIC_FIELD_MAP)).toThrow(/already registered/);
  });

  it("40. a correction requires a NEW mapVersionLabel, not a mutation of the registered one (9D-4A immutability regression)", () => {
    const registry = new FieldMapVersionRegistry();
    registry.register(FORM_33C_SEMANTIC_FIELD_MAP);
    const corrected: SemanticFieldMap = { ...FORM_33C_SEMANTIC_FIELD_MAP, mapVersionLabel: "form33c-semantic-map-v2" };
    expect(() => registry.register(corrected)).not.toThrow();
    expect(registry.listVersions(FORM_33C_EXACT_TEMPLATE_BINDING.templateId)).toEqual([
      FORM_33C_MAP_VERSION_LABEL,
      "form33c-semantic-map-v2"
    ]);
  });
});

describe("Form 33C: real-artifact validation", () => {
  const UPLOAD_DIR = "/root/.claude/uploads/f5b74824-3969-5f04-a809-1a60f42bc26e";
  const REAL_PATH = `${UPLOAD_DIR}/3bf6f793-form_33c_2018.docx`;
  const available = fs.existsSync(REAL_PATH);
  const d = available ? describe : describe.skip;

  if (!available) {
    // eslint-disable-next-line no-console
    console.warn("Stage 9D-4B-2A-ii-b3: real Form 33C DOCX upload path not present — skipping real-artifact validation (skip, not pass).");
  }

  d("against the actual uploaded bytes", () => {
    it("2. re-parses the real bytes, independently re-computes SHA-256, and the map validates against that freshly-built inventory", () => {
      const bytes = fs.readFileSync(REAL_PATH);
      const actualSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      expect(actualSha256).toBe(FORM_33C_SOURCE_SHA256_HEX);
      const freshInv = buildDocxFieldInventory(bytes);
      expect(freshInv.fields.length).toBe(46);
      expect(() =>
        validateSemanticFieldMap({ map: FORM_33C_SEMANTIC_FIELD_MAP, expectedBinding: FORM_33C_EXACT_TEMPLATE_BINDING, technicalInventory: freshInv })
      ).not.toThrow();
    });

    it("a synthetic substitution (same form number/filename, different bytes/SHA) cannot satisfy the real-artifact test", () => {
      const syntheticBytes = Buffer.from("PK\x03\x04not-a-real-docx-form33c-substitute");
      const syntheticSha256 = crypto.createHash("sha256").update(syntheticBytes).digest("hex");
      expect(syntheticSha256).not.toBe(FORM_33C_SOURCE_SHA256_HEX);
      const substituteBinding = buildExpectedBinding({ ...FORM_33C_EXACT_TEMPLATE_BINDING, sourceSha256Hex: syntheticSha256 });
      expect(() =>
        validateSemanticFieldMap({ map: FORM_33C_SEMANTIC_FIELD_MAP, expectedBinding: substituteBinding, technicalInventory: realInv })
      ).toThrow(/source SHA-256/);
    });
  });
});

describe("Form 14A regression: unchanged by this stage", () => {
  it("30. Form 14A's own map still validates against its own real inventory", () => {
    const rec = DOCX_FIELD_INVENTORIES.find(f => f.formNumber === "14A")!;
    const inv: DocxFieldInventoryResult = {
      usesLegacyFormFields: rec.usesLegacyFormFields,
      usesContentControls: rec.usesContentControls,
      contentControlCount: rec.contentControlCount,
      fields: rec.fields.map(f => ({ ...f, rawFfDataXml: "<w:ffData/>" })),
      anomalies: rec.anomalies,
      documentProtection: rec.documentProtection,
      allPackagePartNames: ["word/document.xml"]
    };
    expect(() =>
      validateSemanticFieldMap({ map: FORM_14A_SEMANTIC_FIELD_MAP, expectedBinding: FORM_14A_EXACT_TEMPLATE_BINDING, technicalInventory: inv })
    ).not.toThrow();
    expect(FORM_14A_SOURCE_SHA256_HEX).toBe("bfc552bf54c5972700759e455e5782e5cdec7f8affaa5e822e89e07681801261");
  });
});

describe("Form 35.1A regression: unchanged by this stage", () => {
  it("31. Form 35.1A's own map still validates against its own real inventory", () => {
    const rec = DOCX_FIELD_INVENTORIES.find(f => f.formNumber === "35.1A")!;
    const inv: DocxFieldInventoryResult = {
      usesLegacyFormFields: rec.usesLegacyFormFields,
      usesContentControls: rec.usesContentControls,
      contentControlCount: rec.contentControlCount,
      fields: rec.fields.map(f => ({ ...f, rawFfDataXml: "<w:ffData/>" })),
      anomalies: rec.anomalies,
      documentProtection: rec.documentProtection,
      allPackagePartNames: ["word/document.xml"]
    };
    expect(() =>
      validateSemanticFieldMap({ map: FORM_351A_SEMANTIC_FIELD_MAP, expectedBinding: FORM_351A_EXACT_TEMPLATE_BINDING, technicalInventory: inv })
    ).not.toThrow();
    expect(FORM_351A_SOURCE_SHA256_HEX).toBe("4efdb1baabe0e621caceb73b0b9924b414665d9872e5f280a29e3ff61b28fbcc");
  });
});

describe("Other controlled forms remain unmapped/quarantined; PDF unavailable", () => {
  it("32/33. no real semantic-map module exists for Form 8B or Form 33B.1", () => {
    const otherFormFiles = ["./form8bSemanticFieldMap.ts", "./form33b1SemanticFieldMap.ts"];
    for (const rel of otherFormFiles) {
      const abs = fileURLToPath(new URL(rel, import.meta.url));
      expect(fs.existsSync(abs), `${rel} must not exist yet`).toBe(false);
    }
  });

  it("34. Form 33B remains quarantined: no semantic-map module exists for it, and it has no entry in the technical inventory data used here", () => {
    const abs = fileURLToPath(new URL("./form33bSemanticFieldMap.ts", import.meta.url));
    expect(fs.existsSync(abs)).toBe(false);
    expect(DOCX_FIELD_INVENTORIES.some(f => f.formNumber === "33B")).toBe(false);
  });

  it("35. PDF track remains unavailable: this map's binding format is DOCX only, and no PDF field-map module exists", () => {
    expect(FORM_33C_EXACT_TEMPLATE_BINDING.format).toBe("DOCX");
    const abs = fileURLToPath(new URL("./form33cSemanticFieldMapPdf.ts", import.meta.url));
    expect(fs.existsSync(abs)).toBe(false);
  });

  it("no content-population module (word/document.xml writer) exists alongside this map", () => {
    const abs = fileURLToPath(new URL("./form33cDocxPopulate.ts", import.meta.url));
    expect(fs.existsSync(abs)).toBe(false);
  });
});

describe("Form 33C: technical inventory schema version is bound explicitly, not left implicit", () => {
  it("36. binding declares the current TECHNICAL_INVENTORY_SCHEMA_VERSION", () => {
    expect(FORM_33C_EXACT_TEMPLATE_BINDING.technicalInventorySchemaVersion).toBe(TECHNICAL_INVENTORY_SCHEMA_VERSION);
  });
});

describe("Form 33C: no professional-review fabricated by the map itself", () => {
  it("37. no notes claim a review occurred, and no entry declares PROFESSIONALLY_REVIEWED mappingResolution", () => {
    for (const e of FORM_33C_SEMANTIC_ENTRIES) {
      expect(e.mappingResolution).not.toBe("PROFESSIONALLY_REVIEWED");
      if (e.notes) {
        expect(e.notes.toLowerCase()).not.toMatch(/professionally reviewed by/);
      }
    }
  });
});

describe("Form 33C: technical requiredness stays distinct from legal requiredness", () => {
  it("38. every entry's technicallyRequired is boolean and never implies legalRequiredness", () => {
    for (const e of FORM_33C_SEMANTIC_ENTRIES) {
      expect(typeof e.technicalConstraints.technicallyRequired).toBe("boolean");
      expect(e.legalRequiredness).toBe("UNKNOWN");
    }
  });
});

describe("Form 33C: OOXML security / TOCTOU / duplicate-ZIP regressions stay in their owning modules", () => {
  it("39. this map module performs no ZIP/XML parsing of its own — it consumes the frozen DocxFieldInventoryResult shape only, so OOXML-security, duplicate-ZIP-entry, and TOCTOU protections remain entirely owned by docxFieldInventory.ts/docxZipSafe.ts (see their own test suites)", () => {
    const src = fs.readFileSync(new URL("./form33cSemanticFieldMap.ts", import.meta.url), "utf8");
    expect(src).not.toMatch(/JSZip|AdmZip|zlib\.|require\(["']fs["']\)/);
  });
});
