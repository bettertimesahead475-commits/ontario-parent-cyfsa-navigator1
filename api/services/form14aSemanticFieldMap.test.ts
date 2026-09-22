// Stage 9D-4B-2A-ii-b1 — real Form 14A semantic field map tests.
//
// Covers: exact-template binding against the REAL Form 14A technical inventory (Stage
// 9D-4B-2A-i's docxFieldInventoryData.ts entry) and, where the real uploaded DOCX artifact is
// present, against a freshly re-parsed inventory of the real bytes. Explicitly varies each
// validation dimension ONE AT A TIME (lockstep-blind-spot heuristic — see module header of
// semanticFieldMap.ts and the task's own instruction 16), sensitivity/provenance/legal-
// requiredness boundaries, duplicate/unnamed-field disambiguation, determinism, immutability, and
// confirms the other four controlled forms + Form 33B remain unmapped in this diff.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
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
  FORM_14A_SEMANTIC_FIELD_MAP,
  FORM_14A_SEMANTIC_ENTRIES,
  FORM_14A_EXACT_TEMPLATE_BINDING,
  FORM_14A_SOURCE_SHA256_HEX,
  FORM_14A_MAP_VERSION_LABEL,
  form14aCoverageSummary
} from "./form14aSemanticFieldMap.js";

// ---------------------------------------------------------------------------
// Build a DocxFieldInventoryResult shaped exactly like the frozen Form 14A entry in
// docxFieldInventoryData.ts, so validation is exercised against the real recorded field shapes
// without requiring the uploaded artifact to be present (used for the always-on tests below; the
// separately-gated "real artifact" describe block re-derives this from the actual bytes too).
// ---------------------------------------------------------------------------
function form14aInventoryFromFrozenData(): DocxFieldInventoryResult {
  const record = DOCX_FIELD_INVENTORIES.find(f => f.formNumber === "14A");
  expect(record, "Form 14A entry must exist in the frozen 9D-4B-2A-i inventory data").toBeTruthy();
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

const realInv = form14aInventoryFromFrozenData();

describe("Form 14A frozen technical inventory sanity", () => {
  it("has exactly 13 technical fields", () => {
    expect(realInv.fields.length).toBe(13);
  });

  it("SHA-256 cross-check: FORM_14A_SOURCE_SHA256_HEX matches officialFormSourceManifest.ts", () => {
    const manifestEntry = REAL_ARTIFACT_BYTE_VERIFICATIONS.find(e => e.format === "DOCX" && e.formNumber === "14A");
    expect(manifestEntry).toBeTruthy();
    expect(FORM_14A_SOURCE_SHA256_HEX).toBe(manifestEntry!.sha256Hex);
  });

  it("SHA-256 cross-check: matches docxFieldInventoryData.ts's Form 14A entry", () => {
    const record = DOCX_FIELD_INVENTORIES.find(f => f.formNumber === "14A");
    expect(record!.sha256Hex).toBe(FORM_14A_SOURCE_SHA256_HEX);
  });

  it("has the frozen Text3/Text6 duplicate-name anomaly", () => {
    expect(realInv.anomalies.duplicateNames.sort()).toEqual(["Text3", "Text6"].sort());
  });
});

describe("Form 14A real semantic map: exact-template binding success", () => {
  it("1. validates cleanly against the real Form 14A inventory + expected binding", () => {
    expect(() =>
      validateSemanticFieldMap({
        map: FORM_14A_SEMANTIC_FIELD_MAP,
        expectedBinding: FORM_14A_EXACT_TEMPLATE_BINDING,
        technicalInventory: realInv
      })
    ).not.toThrow();
  });

  it("every entry declares mappingResolution HUMAN_MAPPED, never PROFESSIONALLY_REVIEWED", () => {
    for (const e of FORM_14A_SEMANTIC_ENTRIES) {
      expect(e.mappingResolution).not.toBe("PROFESSIONALLY_REVIEWED");
    }
  });

  it("maps all 13 real technical fields (deliberately mapped or UNRESOLVED — none silently missing)", () => {
    const identityKey = (o: number, n: string | null, t: string, d: number, p: number) => `${o}::${n}::${t}::${d}::${p}`;
    const mappedKeys = new Set(
      FORM_14A_SEMANTIC_ENTRIES.map(e =>
        identityKey(e.technicalIdentity.ordinal, e.technicalIdentity.name, e.technicalIdentity.type, e.technicalIdentity.tableDepth, e.technicalIdentity.paragraphOrdinal)
      )
    );
    for (const f of realInv.fields) {
      expect(mappedKeys.has(identityKey(f.order, f.name, f.type, f.tableDepth, f.paragraphOrdinal))).toBe(true);
    }
    expect(FORM_14A_SEMANTIC_ENTRIES.length).toBe(13);
  });
});

// ---------------------------------------------------------------------------
// LOCKSTEP-BLIND-SPOT MATRIX — each dimension varied INDEPENDENTLY, all others left valid.
// ---------------------------------------------------------------------------
function wrongBinding(overrides: Partial<typeof FORM_14A_EXACT_TEMPLATE_BINDING>) {
  return { ...FORM_14A_EXACT_TEMPLATE_BINDING, ...overrides };
}

function mapWithBinding(binding: typeof FORM_14A_EXACT_TEMPLATE_BINDING): SemanticFieldMap {
  return { ...FORM_14A_SEMANTIC_FIELD_MAP, binding };
}

describe("Form 14A: independent-dimension (lockstep-blind-spot) failure matrix", () => {
  it("2. same form, wrong SHA only -> fails on SHA", () => {
    const map = mapWithBinding(wrongBinding({ sourceSha256Hex: "0".repeat(64) }));
    expect(() =>
      validateSemanticFieldMap({ map, expectedBinding: FORM_14A_EXACT_TEMPLATE_BINDING, technicalInventory: realInv })
    ).toThrow(/source SHA-256/);
  });

  it("3. same SHA fixture, wrong form identity only -> fails on form identity", () => {
    const map = mapWithBinding(wrongBinding({ formId: "official-form-8b", formNumber: "8B" }));
    expect(() =>
      validateSemanticFieldMap({ map, expectedBinding: FORM_14A_EXACT_TEMPLATE_BINDING, technicalInventory: realInv })
    ).toThrow(/form identity/);
  });

  it("4. wrong version only -> fails on form version", () => {
    const map = mapWithBinding(wrongBinding({ formVersionId: "official-form-14a-version-bogus", versionLabel: "bogus" }));
    expect(() =>
      validateSemanticFieldMap({ map, expectedBinding: FORM_14A_EXACT_TEMPLATE_BINDING, technicalInventory: realInv })
    ).toThrow(/form version/);
  });

  it("5. wrong template identity only -> fails on template identity", () => {
    const map = mapWithBinding(wrongBinding({ templateId: "official-form-14a-template-bogus" }));
    expect(() =>
      validateSemanticFieldMap({ map, expectedBinding: FORM_14A_EXACT_TEMPLATE_BINDING, technicalInventory: realInv })
    ).toThrow(/template identity/);
  });

  it("6. wrong format only -> fails on format", () => {
    const map = mapWithBinding(wrongBinding({ format: "PDF" as unknown as "DOCX" }));
    expect(() =>
      validateSemanticFieldMap({ map, expectedBinding: FORM_14A_EXACT_TEMPLATE_BINDING, technicalInventory: realInv })
    ).toThrow(/format/);
  });

  it("7. wrong inventory schema version only -> fails on inventory schema version", () => {
    const map = mapWithBinding(wrongBinding({ technicalInventorySchemaVersion: "old-schema-v0" }));
    expect(() =>
      validateSemanticFieldMap({ map, expectedBinding: FORM_14A_EXACT_TEMPLATE_BINDING, technicalInventory: realInv })
    ).toThrow(/inventory schema version/);
  });

  it("8. nonexistent technical field only -> fails on missing real field", () => {
    const bogusEntry = {
      ...FORM_14A_SEMANTIC_ENTRIES[0],
      semanticKey: "bogusField",
      technicalIdentity: { ordinal: 999, name: "NoSuchField", type: "text" as const, tableDepth: 1, paragraphOrdinal: 999 }
    };
    const map: SemanticFieldMap = { ...FORM_14A_SEMANTIC_FIELD_MAP, entries: [...FORM_14A_SEMANTIC_ENTRIES, bogusEntry] };
    expect(() =>
      validateSemanticFieldMap({ map, expectedBinding: FORM_14A_EXACT_TEMPLATE_BINDING, technicalInventory: realInv })
    ).toThrow(/does not exist in the real inventory/);
  });

  it("9. wrong field type only (same identity otherwise) -> fails on type mismatch", () => {
    const badEntry = {
      ...FORM_14A_SEMANTIC_ENTRIES[1], // courtFileNumber, real type "text"
      technicalConstraints: { ...FORM_14A_SEMANTIC_ENTRIES[1].technicalConstraints, technicalType: "checkbox" as const }
    };
    const map: SemanticFieldMap = {
      ...FORM_14A_SEMANTIC_FIELD_MAP,
      entries: FORM_14A_SEMANTIC_ENTRIES.map(e => (e.semanticKey === "courtFileNumber" ? badEntry : e))
    };
    expect(() =>
      validateSemanticFieldMap({ map, expectedBinding: FORM_14A_EXACT_TEMPLATE_BINDING, technicalInventory: realInv })
    ).toThrow(/type mismatch/);
  });

  it("10. wrong cardinality only (duplicate semantic target, SINGLE) -> fails on duplicate semantic target", () => {
    const dup = { ...FORM_14A_SEMANTIC_ENTRIES[1] }; // second entry with same semanticKey "courtFileNumber", SINGLE
    const map: SemanticFieldMap = { ...FORM_14A_SEMANTIC_FIELD_MAP, entries: [...FORM_14A_SEMANTIC_ENTRIES, dup] };
    expect(() =>
      validateSemanticFieldMap({ map, expectedBinding: FORM_14A_EXACT_TEMPLATE_BINDING, technicalInventory: realInv })
    ).toThrow(/duplicate semantic target/);
  });

  it("11. same cardinality, wrong type only -> fails on type, not cardinality", () => {
    // SINGLE cardinality unchanged; only technicalType altered to disagree with the real field.
    const badEntry = {
      ...FORM_14A_SEMANTIC_ENTRIES[3], // affidavitHeadingDate, real type "text", SINGLE cardinality
      technicalConstraints: { ...FORM_14A_SEMANTIC_ENTRIES[3].technicalConstraints, technicalType: "dropdown" as const }
    };
    const map: SemanticFieldMap = {
      ...FORM_14A_SEMANTIC_FIELD_MAP,
      entries: FORM_14A_SEMANTIC_ENTRIES.map(e => (e.semanticKey === "affidavitHeadingDate" ? badEntry : e))
    };
    expect(() =>
      validateSemanticFieldMap({ map, expectedBinding: FORM_14A_EXACT_TEMPLATE_BINDING, technicalInventory: realInv })
    ).toThrow(/type mismatch/);
  });

  it("12. semantic-key mismatch independently: same technical field, different semanticKey -> validates (key is metadata, not identity)", () => {
    const renamed = FORM_14A_SEMANTIC_ENTRIES.map(e =>
      e.semanticKey === "courtFileNumber" ? { ...e, semanticKey: "courtFileNumberRenamed" } : e
    );
    const map: SemanticFieldMap = { ...FORM_14A_SEMANTIC_FIELD_MAP, entries: renamed };
    expect(() =>
      validateSemanticFieldMap({ map, expectedBinding: FORM_14A_EXACT_TEMPLATE_BINDING, technicalInventory: realInv })
    ).not.toThrow();
    expect(renamed.some(e => e.semanticKey === "courtFileNumberRenamed")).toBe(true);
  });

  it("13. technical-field mismatch independently: same semanticKey, different technical field ordinal -> validates against the NEW target only if it's real", () => {
    const retargeted = FORM_14A_SEMANTIC_ENTRIES.map(e =>
      e.semanticKey === "affidavitHeadingDate"
        ? {
            ...e,
            technicalIdentity: FORM_14A_SEMANTIC_ENTRIES.find(x => x.semanticKey === "courtOfficeAddress")!.technicalIdentity,
            technicalConstraints: FORM_14A_SEMANTIC_ENTRIES.find(x => x.semanticKey === "courtOfficeAddress")!.technicalConstraints
          }
        : e
    );
    const map: SemanticFieldMap = { ...FORM_14A_SEMANTIC_FIELD_MAP, entries: retargeted };
    // Now two entries target the courtOfficeAddress technical field (Text1 ordinal 2) under SINGLE
    // cardinality: courtOfficeAddress itself, and the retargeted affidavitHeadingDate. That is a
    // duplicate-technical-target violation, independently confirming identity is by full
    // TechnicalFieldIdentity tuple, not by semanticKey.
    expect(() =>
      validateSemanticFieldMap({ map, expectedBinding: FORM_14A_EXACT_TEMPLATE_BINDING, technicalInventory: realInv })
    ).toThrow(/target the identical technical field/);
  });
});

describe("Form 14A: duplicate/unnamed technical-control disambiguation", () => {
  it("14. the four Text6 fields are mapped to four DISTINCT semanticKeys by full identity, never by bare name", () => {
    const text6Entries = FORM_14A_SEMANTIC_ENTRIES.filter(e => e.technicalIdentity.name === "Text6");
    expect(text6Entries.length).toBe(4);
    const ordinals = text6Entries.map(e => e.technicalIdentity.ordinal).sort((a, b) => a - b);
    expect(ordinals).toEqual([4, 5, 6, 7]);
    expect(new Set(text6Entries.map(e => e.semanticKey)).size).toBe(4);
  });

  it("the four Text3 fields are mapped to four DISTINCT semanticKeys by full identity", () => {
    const text3Entries = FORM_14A_SEMANTIC_ENTRIES.filter(e => e.technicalIdentity.name === "Text3");
    expect(text3Entries.length).toBe(4);
    expect(new Set(text3Entries.map(e => e.semanticKey)).size).toBe(4);
  });

  it("15. Form 14A has zero unnamed fields (nothing to disambiguate by ordinal alone here) — confirmed from frozen inventory, not assumed", () => {
    expect(realInv.anomalies.unnamedFieldCount).toBe(0);
  });
});

describe("Form 14A: sensitivity classification correctness", () => {
  it("16. administrative classification correct for header/party-identification fields", () => {
    const adminKeys = [
      "courtLevel",
      "courtFileNumber",
      "courtOfficeAddress",
      "affidavitHeadingDate",
      "applicantNameAndAddressForService",
      "applicantLawyerNameAndAddress",
      "respondentNameAndAddressForService",
      "respondentLawyerNameAndAddress"
    ];
    for (const k of adminKeys) {
      const e = FORM_14A_SEMANTIC_ENTRIES.find(x => x.semanticKey === k)!;
      expect(e, k).toBeTruthy();
      expect(e.reviewSensitivity).toBe("NORMAL_ADMINISTRATIVE");
    }
  });

  it("17. affidavit substantive body fields are classified SWORN_FACT", () => {
    const swornKeys = [
      "deponentFullLegalName",
      "deponentMunicipalityAndProvince",
      "statementOfFactsBody",
      "statementOfFactsContinuation"
    ];
    for (const k of swornKeys) {
      const e = FORM_14A_SEMANTIC_ENTRIES.find(x => x.semanticKey === k)!;
      expect(e, k).toBeTruthy();
      expect(e.reviewSensitivity).toBe("SWORN_FACT");
    }
  });

  it("18. commissioning field is classified/protected as COMMISSIONING_OR_CERTIFICATION", () => {
    const e = FORM_14A_SEMANTIC_ENTRIES.find(x => x.semanticKey === "jurisdictionOfSwearing")!;
    expect(e.reviewSensitivity).toBe("COMMISSIONING_OR_CERTIFICATION");
  });

  it("no field is classified SIGNATURE_OR_ATTESTATION (no technical control exists for signature/date/commissioner name — nothing fabricated)", () => {
    expect(FORM_14A_SEMANTIC_ENTRIES.some(e => e.reviewSensitivity === "SIGNATURE_OR_ATTESTATION")).toBe(false);
  });
});

describe("Form 14A: legal requiredness is never guessed", () => {
  it("19. every entry's legalRequiredness is UNKNOWN (conservative default; not established by this stage)", () => {
    for (const e of FORM_14A_SEMANTIC_ENTRIES) {
      expect(e.legalRequiredness).toBe("UNKNOWN");
    }
  });

  it("no entry uses ESTABLISHED or REQUIRES_LEGAL_REVIEW (would imply a review process that did not happen here)", () => {
    for (const e of FORM_14A_SEMANTIC_ENTRIES) {
      expect(["ESTABLISHED", "REQUIRES_LEGAL_REVIEW"]).not.toContain(e.legalRequiredness);
    }
  });

  it("20. technical requiredness (technicallyRequired) remains a distinct field from legal requiredness", () => {
    for (const e of FORM_14A_SEMANTIC_ENTRIES) {
      expect(typeof e.technicalConstraints.technicallyRequired).toBe("boolean");
      // technicallyRequired being false never implies legalRequiredness is settled either way.
      expect(e.legalRequiredness).toBe("UNKNOWN");
    }
  });
});

describe("Form 14A: provenance/review boundary", () => {
  it("21. machine-suggested provenance is never permitted for SWORN_FACT entries", () => {
    for (const e of FORM_14A_SEMANTIC_ENTRIES.filter(x => x.reviewSensitivity === "SWORN_FACT")) {
      expect(e.permittedProvenance).not.toContain("MACHINE_SUGGESTED");
    }
  });

  it("22. matter-derived provenance is never permitted for SWORN_FACT entries", () => {
    for (const e of FORM_14A_SEMANTIC_ENTRIES.filter(x => x.reviewSensitivity === "SWORN_FACT")) {
      expect(e.permittedProvenance).not.toContain("MATTER_DERIVED");
    }
  });

  it("23. professional review is never fabricated by the map itself (no PROFESSIONALLY_REVIEWED mappingResolution, no notes claiming review occurred)", () => {
    for (const e of FORM_14A_SEMANTIC_ENTRIES) {
      expect(e.mappingResolution).not.toBe("PROFESSIONALLY_REVIEWED");
      if (e.notes) {
        expect(e.notes.toLowerCase()).not.toMatch(/professionally reviewed by/);
      }
    }
  });
});

describe("Form 14A: unresolved-field handling stays safe", () => {
  it("24. an UNRESOLVED entry validates without the validator guessing a meaning for it", () => {
    const unresolvedEntry = {
      ...FORM_14A_SEMANTIC_ENTRIES[2],
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
    const map: SemanticFieldMap = { ...FORM_14A_SEMANTIC_FIELD_MAP, entries: [...FORM_14A_SEMANTIC_ENTRIES, unresolvedEntry] };
    expect(() => validateSemanticFieldMap({ map, expectedBinding: FORM_14A_EXACT_TEMPLATE_BINDING, technicalInventory: invWithExtra })).not.toThrow();
  });

  it("25. an unmapped real field does not silently trigger a guess — the coverage summary reports it, it is not synthesized", () => {
    const summary = form14aCoverageSummary();
    expect(summary.totalTechnicalFields).toBe(13);
    expect(summary.mapped + summary.unresolved).toBe(FORM_14A_SEMANTIC_ENTRIES.length);
  });
});

describe("Form 14A: determinism and immutability", () => {
  it("26. the map is deterministic across repeated reads (same module import, same object shape each time)", () => {
    const a = JSON.stringify(FORM_14A_SEMANTIC_FIELD_MAP);
    const b = JSON.stringify(FORM_14A_SEMANTIC_FIELD_MAP);
    expect(a).toBe(b);
  });

  it("27. map version is immutable: registering the same (templateId, mapVersionLabel) twice is rejected", () => {
    const registry = new FieldMapVersionRegistry();
    registry.register(FORM_14A_SEMANTIC_FIELD_MAP);
    expect(() => registry.register(FORM_14A_SEMANTIC_FIELD_MAP)).toThrow(/already registered/);
  });

  it("a correction requires a NEW mapVersionLabel, not a mutation of the registered one", () => {
    const registry = new FieldMapVersionRegistry();
    registry.register(FORM_14A_SEMANTIC_FIELD_MAP);
    const corrected: SemanticFieldMap = { ...FORM_14A_SEMANTIC_FIELD_MAP, mapVersionLabel: "form14a-semantic-map-v2" };
    expect(() => registry.register(corrected)).not.toThrow();
    expect(registry.listVersions(FORM_14A_EXACT_TEMPLATE_BINDING.templateId)).toEqual([
      FORM_14A_MAP_VERSION_LABEL,
      "form14a-semantic-map-v2"
    ]);
  });
});

describe("Form 14A: real-artifact validation", () => {
  const UPLOAD_DIR = "/root/.claude/uploads/f5b74824-3969-5f04-a809-1a60f42bc26e";
  const REAL_PATH = `${UPLOAD_DIR}/c01f056a-flr_14a_sept105_en_fil.docx`;
  const available = fs.existsSync(REAL_PATH);
  const d = available ? describe : describe.skip;

  if (!available) {
    // eslint-disable-next-line no-console
    console.warn("Stage 9D-4B-2A-ii-b1: real Form 14A DOCX upload path not present — skipping real-artifact validation (skip, not pass).");
  }

  d("against the actual uploaded bytes", () => {
    it("28. re-parses the real bytes, re-computes SHA-256, and the map validates against that freshly-built inventory", () => {
      const bytes = fs.readFileSync(REAL_PATH);
      const actualSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      expect(actualSha256).toBe(FORM_14A_SOURCE_SHA256_HEX);
      const freshInv = buildDocxFieldInventory(bytes);
      expect(freshInv.fields.length).toBe(13);
      expect(() =>
        validateSemanticFieldMap({ map: FORM_14A_SEMANTIC_FIELD_MAP, expectedBinding: FORM_14A_EXACT_TEMPLATE_BINDING, technicalInventory: freshInv })
      ).not.toThrow();
    });

    it("29. a synthetic substitution (same form number/filename, different bytes/SHA) cannot satisfy the real-artifact test", () => {
      const syntheticBytes = Buffer.from("PK\x03\x04not-a-real-docx-form14a-substitute");
      const syntheticSha256 = crypto.createHash("sha256").update(syntheticBytes).digest("hex");
      expect(syntheticSha256).not.toBe(FORM_14A_SOURCE_SHA256_HEX);
      const substituteBinding = buildExpectedBinding({
        ...FORM_14A_EXACT_TEMPLATE_BINDING,
        sourceSha256Hex: syntheticSha256
      });
      expect(() =>
        validateSemanticFieldMap({ map: FORM_14A_SEMANTIC_FIELD_MAP, expectedBinding: substituteBinding, technicalInventory: realInv })
      ).toThrow(/source SHA-256/);
    });
  });
});

describe("Other controlled forms remain unmapped in this diff (Stage 9D-4B-2A-ii-b1 is Form 14A only)", () => {
  it("30. no real semantic-map module exists for Form 8B, 33B.1, 33C, or 35.1A", () => {
    const otherFormFiles = [
      "./form8bSemanticFieldMap.ts",
      "./form33b1SemanticFieldMap.ts",
      "./form33cSemanticFieldMap.ts",
      "./form351aSemanticFieldMap.ts"
    ];
    for (const rel of otherFormFiles) {
      const abs = new URL(rel, import.meta.url).pathname;
      expect(fs.existsSync(abs), `${rel} must not exist yet — other four forms are future work`).toBe(false);
    }
  });

  it("31. Form 33B remains quarantined: no semantic-map module exists for it, and it has no entry in the technical inventory data used here", () => {
    const abs = new URL("./form33bSemanticFieldMap.ts", import.meta.url).pathname;
    expect(fs.existsSync(abs)).toBe(false);
    // Form "33B" (bare, quarantined) must be absent even though "33B.1" legitimately exists.
    expect(DOCX_FIELD_INVENTORIES.some(f => f.formNumber === "33B")).toBe(false);
  });

  it("32. PDF track remains unavailable: this map's binding format is DOCX only, and no PDF field-map module exists", () => {
    expect(FORM_14A_EXACT_TEMPLATE_BINDING.format).toBe("DOCX");
    const abs = new URL("./form14aSemanticFieldMapPdf.ts", import.meta.url).pathname;
    expect(fs.existsSync(abs)).toBe(false);
  });
});

describe("Form 14A: technical inventory schema version is bound explicitly, not left implicit", () => {
  it("33. binding declares the current TECHNICAL_INVENTORY_SCHEMA_VERSION", () => {
    expect(FORM_14A_EXACT_TEMPLATE_BINDING.technicalInventorySchemaVersion).toBe(TECHNICAL_INVENTORY_SCHEMA_VERSION);
  });
});
