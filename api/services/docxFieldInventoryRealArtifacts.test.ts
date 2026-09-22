// Stage 9D-4B-2A-i — real DOCX field inventory, run against the actual controlled 5-form set.
//
// SCOPE: this test parses the REAL DOCX artifacts (same five files Stage 9D-4B-1R byte-verified)
// with buildDocxFieldInventory() and asserts on the genuine structure found, cross-checking each
// file's SHA-256 against REAL_ARTIFACT_BYTE_VERIFICATIONS in officialFormSourceManifest.ts before
// trusting it. It builds no field map, no population, no provenance — inventory only.
//
// If the sandbox upload paths are unavailable in whatever environment later runs this suite,
// the artifact-dependent tests are skipped (not failed), matching the convention already
// established by officialFormRealArtifactIntegration.test.ts.
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import crypto from "node:crypto";
import { buildDocxFieldInventory } from "./docxFieldInventory.js";
import { DOCX_FIELD_INVENTORIES } from "./docxFieldInventoryData.js";
import { REAL_ARTIFACT_BYTE_VERIFICATIONS } from "./officialFormSourceManifest.js";

const UPLOAD_DIR = "/root/.claude/uploads/f5b74824-3969-5f04-a809-1a60f42bc26e";

const REAL_DOCX_FILES: { formNumber: string; path: string }[] = [
  { formNumber: "8B", path: `${UPLOAD_DIR}/d39f83dd-form-8b-feb_1_2022-en.docx` },
  { formNumber: "33B.1", path: `${UPLOAD_DIR}/df0e02ef-form-33b-1-en-dec20.docx` },
  { formNumber: "33C", path: `${UPLOAD_DIR}/3bf6f793-form_33c_2018.docx` },
  { formNumber: "35.1A", path: `${UPLOAD_DIR}/48d81005-form-35-1a-en-dec20.docx` },
  { formNumber: "14A", path: `${UPLOAD_DIR}/c01f056a-flr_14a_sept105_en_fil.docx` }
];

const filesAvailable = REAL_DOCX_FILES.every(f => fs.existsSync(f.path));
const describeReal = filesAvailable ? describe : describe.skip;

if (!filesAvailable) {
  // eslint-disable-next-line no-console
  console.warn(
    "Stage 9D-4B-2A-i: real DOCX upload paths not present in this environment — skipping real-artifact structural tests (this is a skip, not a pass; see officialFormRealArtifactIntegration.test.ts convention)."
  );
}

describeReal("Stage 9D-4B-2A-i: real DOCX field inventory against the controlled 5-form set", () => {
  for (const { formNumber, path } of REAL_DOCX_FILES) {
    describe(`Form ${formNumber}`, () => {
      it("byte-matches the frozen 9D-4B-1R manifest SHA-256 before any inventory is trusted", () => {
        const bytes = fs.readFileSync(path);
        const actualSha256 = crypto.createHash("sha256").update(bytes).digest("hex");
        const manifestEntry = REAL_ARTIFACT_BYTE_VERIFICATIONS.find(
          e => e.format === "DOCX" && e.formNumber === formNumber
        );
        expect(manifestEntry, `no 9D-4B-1R manifest DOCX entry found for form ${formNumber}`).toBeTruthy();
        expect(actualSha256).toBe(manifestEntry!.sha256Hex);
      });

      it("parses as legacy w:ffData form fields, not SDT content controls", () => {
        const bytes = fs.readFileSync(path);
        const inv = buildDocxFieldInventory(bytes);
        expect(inv.usesLegacyFormFields).toBe(true);
        expect(inv.fields.length).toBeGreaterThan(0);
      });

      it("declares document protection restricted to forms editing", () => {
        const bytes = fs.readFileSync(path);
        const inv = buildDocxFieldInventory(bytes);
        expect(inv.documentProtection.present).toBe(true);
        expect(inv.documentProtection.edit).toBe("forms");
      });

      it("matches the previously generated, stored inventory fixture exactly (field count, names, types, order)", () => {
        const bytes = fs.readFileSync(path);
        const freshInv = buildDocxFieldInventory(bytes);
        const stored = DOCX_FIELD_INVENTORIES.find(f => f.formNumber === formNumber);
        expect(stored, `no stored inventory found for form ${formNumber}`).toBeTruthy();
        expect(freshInv.fields.length).toBe(stored!.fieldCount);
        expect(freshInv.fields.map(f => ({ name: f.name, type: f.type, order: f.order }))).toEqual(
          stored!.fields.map(f => ({ name: f.name, type: f.type, order: f.order }))
        );
        expect(freshInv.anomalies).toEqual(stored!.anomalies);
      });
    });
  }

  it("finds at least one form with a text field and at least one form with a checkbox field (real structural diversity)", () => {
    const results = REAL_DOCX_FILES.map(f => buildDocxFieldInventory(fs.readFileSync(f.path)));
    const anyText = results.some(r => r.fields.some(f => f.type === "text"));
    const anyCheckbox = results.some(r => r.fields.some(f => f.type === "checkbox"));
    const anyDropdown = results.some(r => r.fields.some(f => f.type === "dropdown"));
    expect(anyText).toBe(true);
    expect(anyCheckbox).toBe(true);
    expect(anyDropdown).toBe(true);
  });
});
