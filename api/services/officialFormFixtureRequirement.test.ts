// Fail-closed fixture requirement. Off unless REQUIRE_OFFICIAL_FORMS_FIXTURES=1 (set only by a protected job).
// When it is on, a missing or altered historical fixture fails the run instead of letting the real-artifact tests skip.
// It re-hashes every pinned file from scripts/official-forms/manifest.json, using the same SHA-256 and length rule as verify.mjs.
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { OFFICIAL_FORMS_CURRENT_DIR, OFFICIAL_FORMS_DIR, officialFormCurrentFile, officialFormFile } from "../testSupport/officialFormFixtures.js";

// "1": every pinned file (17) must be present and match. "retrievable": only the entries whose bytes come from an official
// source (retrievable: true). The six superseded historical PDFs are then not required. Any other value: off.
const mode = process.env.REQUIRE_OFFICIAL_FORMS_FIXTURES;
const required = mode === "1" || mode === "retrievable";
const manifestPath = resolve(fileURLToPath(new URL("../../scripts/official-forms/manifest.json", import.meta.url)));
type Pin = { fileName: string; sha256: string; byteLength: number; retrievable?: boolean };
const pins: Pin[] = JSON.parse(fs.readFileSync(manifestPath, "utf8")).files;
const currentManifestPath = resolve(fileURLToPath(new URL("../../scripts/official-forms/current-manifest.json", import.meta.url)));
const currentPins: Pin[] = JSON.parse(fs.readFileSync(currentManifestPath, "utf8")).files;

(required ? describe : describe.skip)("official-form fixtures are required (fail-closed)", () => {
  it("the historical and current fixture folders exist", () => {
    expect(fs.statSync(OFFICIAL_FORMS_DIR).isDirectory(), OFFICIAL_FORMS_DIR).toBe(true);
    expect(fs.statSync(OFFICIAL_FORMS_CURRENT_DIR).isDirectory(), OFFICIAL_FORMS_CURRENT_DIR).toBe(true);
  });

  for (const pin of pins.filter(p => mode === "1" || p.retrievable === true)) {
    it(`historical ${pin.fileName} is present and matches its pinned SHA-256 and byte length`, () => {
      const p = officialFormFile(pin.fileName);
      expect(fs.existsSync(p), `missing: ${pin.fileName}`).toBe(true);
      const bytes = fs.readFileSync(p);
      expect(bytes.length).toBe(pin.byteLength);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(pin.sha256);
    });
  }

  for (const pin of currentPins.filter(p => mode === "1" || p.retrievable !== false)) {
    it(`current ${pin.fileName} is present and matches its pinned SHA-256 and byte length`, () => {
      const p = officialFormCurrentFile(pin.fileName);
      expect(fs.existsSync(p), `missing: ${pin.fileName}`).toBe(true);
      const bytes = fs.readFileSync(p);
      expect(bytes.length).toBe(pin.byteLength);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(pin.sha256);
    });
  }
});
