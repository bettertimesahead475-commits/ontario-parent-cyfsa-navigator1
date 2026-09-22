// Stage 9D-4B-2A-ii-b2 — real Form 35.1A semantic field map tests.
//
// Follows the pattern established by form14aSemanticFieldMap.test.ts (9D-4B-2A-ii-b1): exact-
// template binding against the REAL Form 35.1A technical inventory (Stage 9D-4B-2A-i's
// docxFieldInventoryData.ts entry) and, where the real uploaded DOCX artifact is present, against
// a freshly re-parsed inventory of the real bytes. Independently varies each validation dimension
// (lockstep-blind-spot heuristic), sensitivity/provenance/legal-requiredness boundaries,
// duplicate-name disambiguation (this form's single reused "Text1" name, 59 occurrences — a
// materially different anomaly shape from Form 14A's two separate duplicated names), repeated-
// table cardinality, determinism, immutability, Form 14A regression, and confirms the remaining
// controlled forms + Form 33B stay unmapped.
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
  FORM_351A_SEMANTIC_FIELD_MAP,
  FORM_351A_SEMANTIC_ENTRIES,
  FORM_351A_EXACT_TEMPLATE_BINDING,
  FORM_351A_SOURCE_SHA256_HEX,
  FORM_351A_MAP_VERSION_LABEL,
  form351aCoverageSummary,
  form351aEvidenceStrength
} from "./form351aSemanticFieldMap.js";
import {
  FORM_14A_SEMANTIC_FIELD_MAP,
  FORM_14A_EXACT_TEMPLATE_BINDING,
  FORM_14A_SOURCE_SHA256_HEX
} from "./form14aSemanticFieldMap.js";

function form351aInventoryFromFrozenData(): DocxFieldInventoryResult {
  const record = DOCX_FIELD_INVENTORIES.find(f => f.formNumber === "35.1A");
  expect(record, "Form 35.1A entry must exist in the frozen 9D-4B-2A-i inventory data").toBeTruthy();
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

const realInv = form351aInventoryFromFrozenData();

describe("Form 35.1A frozen technical inventory sanity", () => {
  it("has exactly 68 technical fields", () => {
    expect(realInv.fields.length).toBe(68);
  });

  it("SHA-256 cross-check: FORM_351A_SOURCE_SHA256_HEX matches officialFormSourceManifest.ts", () => {
    const manifestEntry = REAL_ARTIFACT_BYTE_VERIFICATIONS.find(e => e.format === "DOCX" && e.formNumber === "35.1A");
    expect(manifestEntry).toBeTruthy();
    expect(FORM_351A_SOURCE_SHA256_HEX).toBe(manifestEntry!.sha256Hex);
  });

  it("SHA-256 cross-check: matches docxFieldInventoryData.ts's Form 35.1A entry", () => {
    const record = DOCX_FIELD_INVENTORIES.find(f => f.formNumber === "35.1A");
    expect(record!.sha256Hex).toBe(FORM_351A_SOURCE_SHA256_HEX);
  });

  it("has the frozen single 'Text1' duplicate-name anomaly (59 occurrences)", () => {
    expect(realInv.anomalies.duplicateNames).toEqual(["Text1"]);
    expect(realInv.fields.filter(f => f.name === "Text1").length).toBe(59);
  });

  it("has 8 empty-named fields and 0 fully-unnamed fields, per the frozen anomalies record", () => {
    expect(realInv.anomalies.emptyNamedFieldCount).toBe(8);
    expect(realInv.anomalies.unnamedFieldCount).toBe(0);
  });
});

describe("Form 35.1A real semantic map: exact-template binding success", () => {
  it("1. validates cleanly against the real Form 35.1A inventory + expected binding", () => {
    expect(() =>
      validateSemanticFieldMap({
        map: FORM_351A_SEMANTIC_FIELD_MAP,
        expectedBinding: FORM_351A_EXACT_TEMPLATE_BINDING,
        technicalInventory: realInv
      })
    ).not.toThrow();
  });

  it("every entry declares mappingResolution HUMAN_MAPPED, never PROFESSIONALLY_REVIEWED", () => {
    for (const e of FORM_351A_SEMANTIC_ENTRIES) {
      expect(e.mappingResolution).not.toBe("PROFESSIONALLY_REVIEWED");
    }
  });

  it("12. maps all 68 real technical fields (deliberately mapped or UNRESOLVED — none silently missing)", () => {
    const identityKey = (o: number, n: string | null, t: string, d: number, p: number) => `${o}::${n}::${t}::${d}::${p}`;
    const mappedKeys = new Set(
      FORM_351A_SEMANTIC_ENTRIES.map(e =>
        identityKey(e.technicalIdentity.ordinal, e.technicalIdentity.name, e.technicalIdentity.type, e.technicalIdentity.tableDepth, e.technicalIdentity.paragraphOrdinal)
      )
    );
    for (const f of realInv.fields) {
      expect(mappedKeys.has(identityKey(f.order, f.name, f.type, f.tableDepth, f.paragraphOrdinal))).toBe(true);
    }
    expect(FORM_351A_SEMANTIC_ENTRIES.length).toBe(68);
  });
});

// ---------------------------------------------------------------------------
// LOCKSTEP-BLIND-SPOT MATRIX — each dimension varied INDEPENDENTLY, all others left valid.
// ---------------------------------------------------------------------------
function wrongBinding(overrides: Partial<typeof FORM_351A_EXACT_TEMPLATE_BINDING>) {
  return { ...FORM_351A_EXACT_TEMPLATE_BINDING, ...overrides };
}

function mapWithBinding(binding: typeof FORM_351A_EXACT_TEMPLATE_BINDING): SemanticFieldMap {
  return { ...FORM_351A_SEMANTIC_FIELD_MAP, binding };
}

describe("Form 35.1A: independent-dimension (lockstep-blind-spot) failure matrix", () => {
  it("3. same form, wrong SHA only -> fails on SHA", () => {
    const map = mapWithBinding(wrongBinding({ sourceSha256Hex: "1".repeat(64) }));
    expect(() =>
      validateSemanticFieldMap({ map, expectedBinding: FORM_351A_EXACT_TEMPLATE_BINDING, technicalInventory: realInv })
    ).toThrow(/source SHA-256/);
  });

  it("4. same SHA fixture, wrong form identity only -> fails on form identity", () => {
    const map = mapWithBinding(wrongBinding({ formId: "official-form-33c", formNumber: "33C" }));
    expect(() =>
      validateSemanticFieldMap({ map, expectedBinding: FORM_351A_EXACT_TEMPLATE_BINDING, technicalInventory: realInv })
    ).toThrow(/form identity/);
  });

  it("5. wrong version only -> fails on form version", () => {
    const map = mapWithBinding(wrongBinding({ formVersionId: "official-form-35-1a-version-bogus", versionLabel: "bogus" }));
    expect(() =>
      validateSemanticFieldMap({ map, expectedBinding: FORM_351A_EXACT_TEMPLATE_BINDING, technicalInventory: realInv })
    ).toThrow(/form version/);
  });

  it("6. wrong template identity only -> fails on template identity", () => {
    const map = mapWithBinding(wrongBinding({ templateId: "official-form-35-1a-template-bogus" }));
    expect(() =>
      validateSemanticFieldMap({ map, expectedBinding: FORM_351A_EXACT_TEMPLATE_BINDING, technicalInventory: realInv })
    ).toThrow(/template identity/);
  });

  it("7. wrong format only -> fails on format", () => {
    const map = mapWithBinding(wrongBinding({ format: "PDF" as unknown as "DOCX" }));
    expect(() =>
      validateSemanticFieldMap({ map, expectedBinding: FORM_351A_EXACT_TEMPLATE_BINDING, technicalInventory: realInv })
    ).toThrow(/format/);
  });

  it("8. wrong inventory schema version only -> fails on inventory schema version", () => {
    const map = mapWithBinding(wrongBinding({ technicalInventorySchemaVersion: "old-schema-v0" }));
    expect(() =>
      validateSemanticFieldMap({ map, expectedBinding: FORM_351A_EXACT_TEMPLATE_BINDING, technicalInventory: realInv })
    ).toThrow(/inventory schema version/);
  });

  it("9. nonexistent technical field only -> fails on missing real field", () => {
    const bogusEntry = {
      ...FORM_351A_SEMANTIC_ENTRIES[0],
      semanticKey: "bogusField",
      technicalIdentity: { ordinal: 999, name: "NoSuchField", type: "text" as const, tableDepth: 1, paragraphOrdinal: 999 }
    };
    const map: SemanticFieldMap = { ...FORM_351A_SEMANTIC_FIELD_MAP, entries: [...FORM_351A_SEMANTIC_ENTRIES, bogusEntry] };
    expect(() =>
      validateSemanticFieldMap({ map, expectedBinding: FORM_351A_EXACT_TEMPLATE_BINDING, technicalInventory: realInv })
    ).toThrow(/does not exist in the real inventory/);
  });

  it("10. wrong field type only (same identity otherwise) -> fails on type mismatch", () => {
    const badEntry = {
      ...FORM_351A_SEMANTIC_ENTRIES[1], // courtFileNumber, real type "text"
      technicalConstraints: { ...FORM_351A_SEMANTIC_ENTRIES[1].technicalConstraints, technicalType: "checkbox" as const }
    };
    const map: SemanticFieldMap = {
      ...FORM_351A_SEMANTIC_FIELD_MAP,
      entries: FORM_351A_SEMANTIC_ENTRIES.map(e => (e.semanticKey === "courtFileNumber" ? badEntry : e))
    };
    expect(() =>
      validateSemanticFieldMap({ map, expectedBinding: FORM_351A_EXACT_TEMPLATE_BINDING, technicalInventory: realInv })
    ).toThrow(/type mismatch/);
  });

  it("11. wrong cardinality only (duplicate semantic target, SINGLE) -> fails on duplicate semantic target", () => {
    const dup = { ...FORM_351A_SEMANTIC_ENTRIES[1] }; // second entry with same semanticKey "courtFileNumber", SINGLE
    const map: SemanticFieldMap = { ...FORM_351A_SEMANTIC_FIELD_MAP, entries: [...FORM_351A_SEMANTIC_ENTRIES, dup] };
    expect(() =>
      validateSemanticFieldMap({ map, expectedBinding: FORM_351A_EXACT_TEMPLATE_BINDING, technicalInventory: realInv })
    ).toThrow(/duplicate semantic target/);
  });

  it("same cardinality, wrong type only -> fails on type, not cardinality", () => {
    const badEntry = {
      ...FORM_351A_SEMANTIC_ENTRIES[2], // courtOfficeAddress, real type "text", SINGLE cardinality
      technicalConstraints: { ...FORM_351A_SEMANTIC_ENTRIES[2].technicalConstraints, technicalType: "dropdown" as const }
    };
    const map: SemanticFieldMap = {
      ...FORM_351A_SEMANTIC_FIELD_MAP,
      entries: FORM_351A_SEMANTIC_ENTRIES.map(e => (e.semanticKey === "courtOfficeAddress" ? badEntry : e))
    };
    expect(() =>
      validateSemanticFieldMap({ map, expectedBinding: FORM_351A_EXACT_TEMPLATE_BINDING, technicalInventory: realInv })
    ).toThrow(/type mismatch/);
  });

  it("semantic-key rename independently: same technical field, different semanticKey -> validates (key is metadata, not identity)", () => {
    const renamed = FORM_351A_SEMANTIC_ENTRIES.map(e =>
      e.semanticKey === "courtFileNumber" ? { ...e, semanticKey: "courtFileNumberRenamed" } : e
    );
    const map: SemanticFieldMap = { ...FORM_351A_SEMANTIC_FIELD_MAP, entries: renamed };
    expect(() =>
      validateSemanticFieldMap({ map, expectedBinding: FORM_351A_EXACT_TEMPLATE_BINDING, technicalInventory: realInv })
    ).not.toThrow();
    expect(renamed.some(e => e.semanticKey === "courtFileNumberRenamed")).toBe(true);
  });

  it("technical-field retargeting independently: same semanticKey, different real technical field -> duplicate-target rejected", () => {
    const retargeted = FORM_351A_SEMANTIC_ENTRIES.map(e =>
      e.semanticKey === "courtOfficeAddress"
        ? {
            ...e,
            technicalIdentity: FORM_351A_SEMANTIC_ENTRIES.find(x => x.semanticKey === "courtFileNumber")!.technicalIdentity,
            technicalConstraints: FORM_351A_SEMANTIC_ENTRIES.find(x => x.semanticKey === "courtFileNumber")!.technicalConstraints
          }
        : e
    );
    const map: SemanticFieldMap = { ...FORM_351A_SEMANTIC_FIELD_MAP, entries: retargeted };
    expect(() =>
      validateSemanticFieldMap({ map, expectedBinding: FORM_351A_EXACT_TEMPLATE_BINDING, technicalInventory: realInv })
    ).toThrow(/target the identical technical field/);
  });
});

describe("Form 35.1A: duplicate/unnamed technical-control disambiguation", () => {
  it("16. same-name fields remain distinguishable: all 59 'Text1' entries map to DISTINCT semanticKeys or REPEATED-cardinality shared keys, never SINGLE collisions", () => {
    const text1Entries = FORM_351A_SEMANTIC_ENTRIES.filter(e => e.technicalIdentity.name === "Text1");
    expect(text1Entries.length).toBe(59);
    // Every 'Text1' entry has a fully distinct technicalIdentity (ordinal disambiguates).
    const ordinals = new Set(text1Entries.map(e => e.technicalIdentity.ordinal));
    expect(ordinals.size).toBe(59);
    // No two entries silently share a technicalIdentity. The 56 repeated-table cells are
    // REPEATED cardinality; the 3 jurat 'Text1' fields (ordinals 65-67) are each a distinct
    // SINGLE-cardinality field disambiguated by position, not part of a repeating table.
    const tableCells = text1Entries.filter(e => e.technicalIdentity.ordinal < 65);
    const juratCells = text1Entries.filter(e => e.technicalIdentity.ordinal >= 65);
    expect(tableCells.length).toBe(56);
    expect(juratCells.length).toBe(3);
    for (const e of tableCells) {
      expect(e.semanticConstraints.cardinality).toBe("REPEATED");
    }
    for (const e of juratCells) {
      expect(e.semanticConstraints.cardinality).toBe("SINGLE");
    }
  });

  it("17. unnamed fields (empty w:name) remain distinguishable by ordinal + paragraphOrdinal, not by name", () => {
    const emptyNamed = FORM_351A_SEMANTIC_ENTRIES.filter(e => e.technicalIdentity.name === "");
    expect(emptyNamed.length).toBe(8);
    const ordinals = new Set(emptyNamed.map(e => e.technicalIdentity.ordinal));
    expect(ordinals.size).toBe(8);
    expect(new Set(emptyNamed.map(e => e.semanticKey)).size).toBe(8);
  });

  it("18. repeated table-cell controls retain exact cardinality (paragraph 1/2: 4 rows; paragraph 3/4: 3 rows — fixed, not unlimited)", () => {
    const countByKey = (key: string) => FORM_351A_SEMANTIC_ENTRIES.filter(e => e.semanticKey === key).length;
    expect(countByKey("ownCourtCaseNamesInvolved")).toBe(4);
    expect(countByKey("ownServiceNamesInvolved")).toBe(4);
    expect(countByKey("otherPartyCourtCaseNamesInvolved")).toBe(3);
    expect(countByKey("otherPartyServiceNamesInvolved")).toBe(3);
  });
});

describe("Form 35.1A: sensitivity classification correctness", () => {
  it("19. administrative classification correct for header/party-identification fields", () => {
    const adminKeys = [
      "courtLevel",
      "courtFileNumber",
      "courtOfficeAddress",
      "applicantNameAndAddressForService",
      "applicantLawyerNameAndAddress",
      "respondentNameAndAddressForService",
      "respondentLawyerNameAndAddress"
    ];
    for (const k of adminKeys) {
      const e = FORM_351A_SEMANTIC_ENTRIES.find(x => x.semanticKey === k)!;
      expect(e, k).toBeTruthy();
      expect(e.reviewSensitivity).toBe("NORMAL_ADMINISTRATIVE");
    }
  });

  it("20. substantive affidavit-content fields (deponent preamble + all four repeated tables) are classified SWORN_FACT", () => {
    const swornKeys = [
      "deponentFullLegalName",
      "deponentResidence",
      "ownCourtCaseNamesInvolved",
      "ownServiceDetails",
      "otherPartyCourtCaseOrdersMade",
      "otherPartyServiceDetails"
    ];
    for (const k of swornKeys) {
      const e = FORM_351A_SEMANTIC_ENTRIES.find(x => x.semanticKey === k)!;
      expect(e, k).toBeTruthy();
      expect(e.reviewSensitivity).toBe("SWORN_FACT");
    }
    // Every entry in all four repeated table sections is SWORN_FACT.
    for (const e of FORM_351A_SEMANTIC_ENTRIES) {
      if (e.formSection?.startsWith("Paragraph ")) {
        expect(e.reviewSensitivity).toBe("SWORN_FACT");
      }
    }
  });

  it("21/22. signature classification only if an actual field exists — no fabricated signature field for 35.1A", () => {
    expect(FORM_351A_SEMANTIC_ENTRIES.some(e => e.reviewSensitivity === "SIGNATURE_OR_ATTESTATION")).toBe(false);
    // Confirmed from the real inventory: 68 fields total, all accounted for above; none is a
    // signature control (the jurat's signature/printed-name lines are static text with no
    // <w:ffData>, per the module's own documented XML walk).
    expect(FORM_351A_SEMANTIC_ENTRIES.length).toBe(68);
  });

  it("23. commissioning/jurat fields are classified COMMISSIONING_OR_CERTIFICATION, supported by actual jurat structure (last 3 technical fields)", () => {
    const commissioningKeys = ["jurisdictionMunicipalityOfSwearing", "jurisdictionProvinceOfSwearing", "dateOfSwearing"];
    for (const k of commissioningKeys) {
      const e = FORM_351A_SEMANTIC_ENTRIES.find(x => x.semanticKey === k)!;
      expect(e, k).toBeTruthy();
      expect(e.reviewSensitivity).toBe("COMMISSIONING_OR_CERTIFICATION");
    }
    const ordinals = commissioningKeys.map(k => FORM_351A_SEMANTIC_ENTRIES.find(x => x.semanticKey === k)!.technicalIdentity.ordinal).sort((a, b) => a - b);
    expect(ordinals).toEqual([65, 66, 67]);
  });
});

describe("Form 35.1A: legal requiredness is never guessed", () => {
  it("24. every entry's legalRequiredness is UNKNOWN (conservative default; not established by this stage)", () => {
    for (const e of FORM_351A_SEMANTIC_ENTRIES) {
      expect(e.legalRequiredness).toBe("UNKNOWN");
    }
  });

  it("no entry uses ESTABLISHED or REQUIRES_LEGAL_REVIEW", () => {
    for (const e of FORM_351A_SEMANTIC_ENTRIES) {
      expect(["ESTABLISHED", "REQUIRES_LEGAL_REVIEW"]).not.toContain(e.legalRequiredness);
    }
  });

  it("25. technical requiredness remains a distinct field from legal requiredness", () => {
    for (const e of FORM_351A_SEMANTIC_ENTRIES) {
      expect(typeof e.technicalConstraints.technicallyRequired).toBe("boolean");
      expect(e.legalRequiredness).toBe("UNKNOWN");
    }
  });
});

describe("Form 35.1A: provenance/review boundary", () => {
  it("26. machine-suggested provenance is never permitted for SWORN_FACT entries", () => {
    for (const e of FORM_351A_SEMANTIC_ENTRIES.filter(x => x.reviewSensitivity === "SWORN_FACT")) {
      expect(e.permittedProvenance).not.toContain("MACHINE_SUGGESTED");
    }
  });

  it("27. matter-derived provenance is never permitted for SWORN_FACT entries", () => {
    for (const e of FORM_351A_SEMANTIC_ENTRIES.filter(x => x.reviewSensitivity === "SWORN_FACT")) {
      expect(e.permittedProvenance).not.toContain("MATTER_DERIVED");
    }
  });

  it("28. professional review is never fabricated by the map itself", () => {
    for (const e of FORM_351A_SEMANTIC_ENTRIES) {
      expect(e.mappingResolution).not.toBe("PROFESSIONALLY_REVIEWED");
      if (e.notes) {
        expect(e.notes.toLowerCase()).not.toMatch(/professionally reviewed by/);
      }
    }
  });
});

describe("Form 35.1A: static official content is never mapped as a writable target", () => {
  it("29. the static 'ONTARIO' heading, section-instruction prose, and jurat boilerplate ('Signature', 'Commissioner for taking affidavits', etc.) never appear as a semanticKey or label naming them as writable fields", () => {
    const forbiddenLabels = ["ONTARIO", "Signature", "Commissioner for taking affidavits"];
    for (const e of FORM_351A_SEMANTIC_ENTRIES) {
      for (const forbidden of forbiddenLabels) {
        expect(e.label).not.toBe(forbidden);
      }
    }
  });
});

describe("Form 35.1A: coverage / evidence-strength reporting", () => {
  it("13. every entry is mapped or UNRESOLVED — none silently missing; unresolved count is honestly reported (not forced to zero)", () => {
    const summary = form351aCoverageSummary();
    expect(summary.totalTechnicalFields).toBe(68);
    expect(summary.mapped + summary.unresolved).toBe(FORM_351A_SEMANTIC_ENTRIES.length);
  });

  it("14. directly-labelled mappings carry DIRECT_LABEL evidence", () => {
    const ev = form351aEvidenceStrength();
    const courtFileNumberEv = ev.find(e => e.semanticKey === "courtFileNumber")!;
    expect(courtFileNumberEv.evidenceStrength).toBe("DIRECT_LABEL");
    expect(ev.filter(e => e.evidenceStrength === "DIRECT_LABEL").length).toBeGreaterThan(0);
  });

  it("15. structurally-inferred mappings remain explicitly marked as inferred, never upgraded to certainty", () => {
    const ev = form351aEvidenceStrength();
    const applicantLawyerEv = ev.find(e => e.semanticKey === "applicantLawyerNameAndAddress")!;
    expect(applicantLawyerEv.evidenceStrength).toBe("STRUCTURAL_INFERENCE");
    const applicantLawyerEntry = FORM_351A_SEMANTIC_ENTRIES.find(e => e.semanticKey === "applicantLawyerNameAndAddress")!;
    expect(applicantLawyerEntry.warnings.length).toBeGreaterThan(0);
    expect(ev.filter(e => e.evidenceStrength === "STRUCTURAL_INFERENCE").length).toBeGreaterThan(0);
  });

  it("no entry is silently UNRESOLVED without being reported as such in the coverage summary", () => {
    const summary = form351aCoverageSummary();
    const unresolvedInEntries = FORM_351A_SEMANTIC_ENTRIES.filter(e => e.mappingResolution === "UNRESOLVED").length;
    expect(summary.unresolved).toBe(unresolvedInEntries);
  });
});

describe("Form 35.1A: determinism and immutability", () => {
  it("30. the map is deterministic across repeated reads", () => {
    const a = JSON.stringify(FORM_351A_SEMANTIC_FIELD_MAP);
    const b = JSON.stringify(FORM_351A_SEMANTIC_FIELD_MAP);
    expect(a).toBe(b);
  });

  it("map version is immutable: registering the same (templateId, mapVersionLabel) twice is rejected", () => {
    const registry = new FieldMapVersionRegistry();
    registry.register(FORM_351A_SEMANTIC_FIELD_MAP);
    expect(() => registry.register(FORM_351A_SEMANTIC_FIELD_MAP)).toThrow(/already registered/);
  });

  it("a correction requires a NEW mapVersionLabel, not a mutation of the registered one", () => {
    const registry = new FieldMapVersionRegistry();
    registry.register(FORM_351A_SEMANTIC_FIELD_MAP);
    const corrected: SemanticFieldMap = { ...FORM_351A_SEMANTIC_FIELD_MAP, mapVersionLabel: "form351a-semantic-map-v2" };
    expect(() => registry.register(corrected)).not.toThrow();
    expect(registry.listVersions(FORM_351A_EXACT_TEMPLATE_BINDING.templateId)).toEqual([
      FORM_351A_MAP_VERSION_LABEL,
      "form351a-semantic-map-v2"
    ]);
  });
});

describe("Form 35.1A: real-artifact validation", () => {
  const UPLOAD_DIR = "/root/.claude/uploads/f5b74824-3969-5f04-a809-1a60f42bc26e";
  const REAL_PATH = `${UPLOAD_DIR}/48d81005-form-35-1a-en-dec20.docx`;
  const available = fs.existsSync(REAL_PATH);
  const d = available ? describe : describe.skip;

  if (!available) {
    // eslint-disable-next-line no-console
    console.warn("Stage 9D-4B-2A-ii-b2: real Form 35.1A DOCX upload path not present — skipping real-artifact validation (skip, not pass).");
  }

  d("against the actual uploaded bytes", () => {
    it("2. re-parses the real bytes, re-computes SHA-256, and the map validates against that freshly-built inventory", () => {
      const bytes = fs.readFileSync(REAL_PATH);
      const actualSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
      expect(actualSha256).toBe(FORM_351A_SOURCE_SHA256_HEX);
      const freshInv = buildDocxFieldInventory(bytes);
      expect(freshInv.fields.length).toBe(68);
      expect(() =>
        validateSemanticFieldMap({ map: FORM_351A_SEMANTIC_FIELD_MAP, expectedBinding: FORM_351A_EXACT_TEMPLATE_BINDING, technicalInventory: freshInv })
      ).not.toThrow();
    });

    it("a synthetic substitution (different bytes/SHA) cannot satisfy the real-artifact test", () => {
      const syntheticBytes = Buffer.from("PK\x03\x04not-a-real-docx-form351a-substitute");
      const syntheticSha256 = crypto.createHash("sha256").update(syntheticBytes).digest("hex");
      expect(syntheticSha256).not.toBe(FORM_351A_SOURCE_SHA256_HEX);
      const substituteBinding = buildExpectedBinding({
        ...FORM_351A_EXACT_TEMPLATE_BINDING,
        sourceSha256Hex: syntheticSha256
      });
      expect(() =>
        validateSemanticFieldMap({ map: FORM_351A_SEMANTIC_FIELD_MAP, expectedBinding: substituteBinding, technicalInventory: realInv })
      ).toThrow(/source SHA-256/);
    });
  });
});

describe("Form 14A regression: remains frozen/stable alongside the new Form 35.1A map", () => {
  it("31. Form 14A's own map still validates against its own real inventory, unaffected by Form 35.1A's addition", () => {
    const record = DOCX_FIELD_INVENTORIES.find(f => f.formNumber === "14A")!;
    const inv: DocxFieldInventoryResult = {
      usesLegacyFormFields: record.usesLegacyFormFields,
      usesContentControls: record.usesContentControls,
      contentControlCount: record.contentControlCount,
      fields: record.fields.map(f => ({ ...f, rawFfDataXml: "<w:ffData/>" })),
      anomalies: record.anomalies,
      documentProtection: record.documentProtection,
      allPackagePartNames: ["word/document.xml"]
    };
    expect(() =>
      validateSemanticFieldMap({ map: FORM_14A_SEMANTIC_FIELD_MAP, expectedBinding: FORM_14A_EXACT_TEMPLATE_BINDING, technicalInventory: inv })
    ).not.toThrow();
    expect(FORM_14A_SOURCE_SHA256_HEX).toBe(record.sha256Hex);
  });

  it("Form 35.1A's binding is a completely distinct exact-template identity from Form 14A's (no cross-form confusion)", () => {
    expect(FORM_351A_EXACT_TEMPLATE_BINDING.sourceSha256Hex).not.toBe(FORM_14A_EXACT_TEMPLATE_BINDING.sourceSha256Hex);
    expect(FORM_351A_EXACT_TEMPLATE_BINDING.formId).not.toBe(FORM_14A_EXACT_TEMPLATE_BINDING.formId);
    expect(FORM_351A_EXACT_TEMPLATE_BINDING.templateId).not.toBe(FORM_14A_EXACT_TEMPLATE_BINDING.templateId);
  });
});

describe("Other controlled forms remain unmapped (Stage 9D-4B-2A-ii-b2 adds ONLY Form 35.1A)", () => {
  it("32/33/34. no real semantic-map module exists for Form 8B, 33B.1, or 33C", () => {
    const otherFormFiles = ["./form8bSemanticFieldMap.ts", "./form33b1SemanticFieldMap.ts", "./form33cSemanticFieldMap.ts"];
    for (const rel of otherFormFiles) {
      const abs = new URL(rel, import.meta.url).pathname;
      expect(fs.existsSync(abs), `${rel} must not exist yet — other three forms remain future work`).toBe(false);
    }
  });

  it("35. Form 33B remains quarantined: no semantic-map module exists for it, and it has no entry in the technical inventory data used here", () => {
    const abs = new URL("./form33bSemanticFieldMap.ts", import.meta.url).pathname;
    expect(fs.existsSync(abs)).toBe(false);
    expect(DOCX_FIELD_INVENTORIES.some(f => f.formNumber === "33B")).toBe(false);
  });

  it("36. PDF track remains unavailable: this map's binding format is DOCX only, and no PDF field-map module exists", () => {
    expect(FORM_351A_EXACT_TEMPLATE_BINDING.format).toBe("DOCX");
    const abs = new URL("./form351aSemanticFieldMapPdf.ts", import.meta.url).pathname;
    expect(fs.existsSync(abs)).toBe(false);
  });
});

describe("Form 35.1A: technical inventory schema version is bound explicitly, not left implicit", () => {
  it("binding declares the current TECHNICAL_INVENTORY_SCHEMA_VERSION", () => {
    expect(FORM_351A_EXACT_TEMPLATE_BINDING.technicalInventorySchemaVersion).toBe(TECHNICAL_INVENTORY_SCHEMA_VERSION);
  });
});
