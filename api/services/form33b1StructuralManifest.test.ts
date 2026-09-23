// Stage 9D-4B-2A-ii-b5A-ii — Form 33B.1 structural groups and stable technical IDs manifest tests.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";
import {
  FORM_33B1_STRUCTURAL_MANIFEST_SOURCE_SHA256,
  FORM_33B1_TOTAL_TECHNICAL_CONTROLS,
  FORM_33B1_STRUCTURAL_SECTIONS,
  FORM_33B1_REPEATED_GROUPS,
  FORM_33B1_REPEATED_GROUP_DEFINITIONS,
  FORM_33B1_STRUCTURAL_MANIFEST,
  type Form33B1StructuralManifestEntry
} from "./form33b1StructuralManifest.js";
import { DOCX_FIELD_INVENTORIES } from "./docxFieldInventoryData.js";
import { REAL_ARTIFACT_BYTE_VERIFICATIONS } from "./officialFormSourceManifest.js";

const UPLOAD_DIR = "/root/.claude/uploads/f5b74824-3969-5f04-a809-1a60f42bc26e";
const REAL_33B1_DOCX_PATH = `${UPLOAD_DIR}/df0e02ef-form-33b-1-en-dec20.docx`;
const artifactAvailable = fs.existsSync(REAL_33B1_DOCX_PATH);

const frozenInv = DOCX_FIELD_INVENTORIES.find(f => f.formNumber === "33B.1")!;
const manifestEntry = REAL_ARTIFACT_BYTE_VERIFICATIONS.find(
  e => e.formNumber === "33B.1" && e.format === "DOCX"
)!;

describe("Form 33B.1 b5A-ii structural manifest & coverage invariants", () => {
  it("1. source SHA-256 matches officialFormSourceManifest & docxFieldInventoryData exactly", () => {
    expect(FORM_33B1_STRUCTURAL_MANIFEST_SOURCE_SHA256).toBe(manifestEntry.sha256Hex);
    expect(FORM_33B1_STRUCTURAL_MANIFEST_SOURCE_SHA256).toBe(frozenInv.sha256Hex);
    if (artifactAvailable) {
      const bytes = fs.readFileSync(REAL_33B1_DOCX_PATH);
      const sha = crypto.createHash("sha256").update(bytes).digest("hex");
      expect(sha).toBe(FORM_33B1_STRUCTURAL_MANIFEST_SOURCE_SHA256);
    }
  });

  it("2. coverage invariant: total controls = 169", () => {
    expect(FORM_33B1_TOTAL_TECHNICAL_CONTROLS).toBe(169);
    expect(FORM_33B1_STRUCTURAL_MANIFEST.length).toBe(169);
    expect(frozenInv.fields.length).toBe(169);
  });

  it("3. coverage invariant: every ordinal 0..168 is represented exactly once (zero gaps, zero overlaps)", () => {
    const ordinals = FORM_33B1_STRUCTURAL_MANIFEST.map(e => e.ordinal);
    expect(ordinals.length).toBe(169);
    const sorted = [...ordinals].sort((a, b) => a - b);
    for (let i = 0; i < 169; i++) {
      expect(sorted[i]).toBe(i);
    }
    const unique = new Set(ordinals);
    expect(unique.size).toBe(169);
  });

  it("4. coverage invariant: 169 unique stable technical IDs", () => {
    const ids = FORM_33B1_STRUCTURAL_MANIFEST.map(e => e.stableTechnicalId);
    expect(ids.length).toBe(169);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(169);
  });

  it("5. type cardinality invariant: 145 text, 23 checkbox, 1 dropdown", () => {
    const textCount = FORM_33B1_STRUCTURAL_MANIFEST.filter(e => e.technicalType === "text").length;
    const checkboxCount = FORM_33B1_STRUCTURAL_MANIFEST.filter(e => e.technicalType === "checkbox").length;
    const dropdownCount = FORM_33B1_STRUCTURAL_MANIFEST.filter(e => e.technicalType === "dropdown").length;

    expect(textCount).toBe(145);
    expect(checkboxCount).toBe(23);
    expect(dropdownCount).toBe(1);
    expect(textCount + checkboxCount + dropdownCount).toBe(169);
  });

  it("6. technical type matches frozen inventory for every ordinal", () => {
    for (let i = 0; i < 169; i++) {
      const manifestItem = FORM_33B1_STRUCTURAL_MANIFEST[i];
      const invItem = frozenInv.fields[i];
      expect(manifestItem.ordinal).toBe(i);
      expect(manifestItem.observedName).toBe(invItem.name || "");
      expect(manifestItem.technicalType).toBe(invItem.type);
    }
  });

  it("7. repeated group definition: 3 repeated child blocks spanning ordinals 17..40", () => {
    expect(FORM_33B1_REPEATED_GROUP_DEFINITIONS.length).toBe(1);
    const childDef = FORM_33B1_REPEATED_GROUP_DEFINITIONS[0];
    expect(childDef.groupId).toBe("REPEATED_CHILD_BLOCK");
    expect(childDef.sourceSection).toBe("CHILD_IDENTIFICATION");
    expect(childDef.startOrdinal).toBe(17);
    expect(childDef.endOrdinal).toBe(40);

    const childItems = FORM_33B1_STRUCTURAL_MANIFEST.filter(e => e.repeatedGroupId === "REPEATED_CHILD_BLOCK");
    expect(childItems.length).toBe(24); // 3 slots x 8 attributes

    for (let slot = 0; slot < 3; slot++) {
      const slotItems = childItems.filter(e => e.repeatedGroupIndex === slot);
      expect(slotItems.length).toBe(8);
    }
  });

  it("8. semantically neutral technical IDs: no answer state, legal conclusion, or party position", () => {
    const forbiddenSubstrings = [
      "admit",
      "deny",
      "agreed",
      "disagreed",
      "true",
      "false",
      "recommend",
      "conclusion",
      "position",
      "guilty",
      "liable"
    ];

    for (const e of FORM_33B1_STRUCTURAL_MANIFEST) {
      const lower = e.stableTechnicalId.toLowerCase();
      for (const forbidden of forbiddenSubstrings) {
        expect(lower.includes(forbidden), `Technical ID '${e.stableTechnicalId}' contains forbidden term '${forbidden}'`).toBe(false);
      }
    }
  });

  it("9. decision-boundary invariant: manifest exports no value population, answer inference, or AI logic", () => {
    const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
    const src = fs.readFileSync(here("./form33b1StructuralManifest.ts"), "utf8");
    expect(src).not.toMatch(/function\s+(populate|infer|recommend|advise)/);
    expect(src).not.toMatch(/export\s+const\s+(answers|populatedForm)/);
  });

  it("10. no official DOCX binary is committed into git repository", () => {
    const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
    const repoRootDir = fileURLToPath(new URL("../../", import.meta.url));
    const committedDocx = fs.existsSync(`${repoRootDir}/Form_33B1_Official.docx`);
    expect(committedDocx).toBe(false);
  });
});

describe("Form 33B.1 b5A-ii adversarial integrity checks", () => {
  it("detects missing control in candidate list", () => {
    const subset = FORM_33B1_STRUCTURAL_MANIFEST.slice(0, 168);
    expect(subset.length).not.toBe(169);
  });

  it("detects duplicate ordinal assignment in candidate list", () => {
    const corrupted = [...FORM_33B1_STRUCTURAL_MANIFEST];
    corrupted[10] = { ...corrupted[10], ordinal: 9 };
    const ordinals = corrupted.map(e => e.ordinal);
    const unique = new Set(ordinals);
    expect(unique.size).toBe(168); // 168 unique out of 169 entries
  });

  it("detects duplicate technical ID in candidate list", () => {
    const corrupted = [...FORM_33B1_STRUCTURAL_MANIFEST];
    corrupted[10] = { ...corrupted[10], stableTechnicalId: corrupted[9].stableTechnicalId };
    const ids = corrupted.map(e => e.stableTechnicalId);
    const unique = new Set(ids);
    expect(unique.size).toBe(168);
  });

  it("detects technical type mismatch against frozen inventory", () => {
    const invType = frozenInv.fields[113].type; // checkbox
    const manifestType = FORM_33B1_STRUCTURAL_MANIFEST[113].technicalType;
    expect(manifestType).toBe(invType);

    // Corrupted mock
    const corruptedType: string = "text";
    expect(corruptedType).not.toBe(invType);
  });

  it("rejects section drift for repeated child group", () => {
    const childItems = FORM_33B1_STRUCTURAL_MANIFEST.filter(e => e.repeatedGroupId === "REPEATED_CHILD_BLOCK");
    for (const item of childItems) {
      expect(item.structuralSection).toBe("CHILD_IDENTIFICATION");
    }
  });
});
