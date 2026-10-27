// Fail-closed fixture requirement. Off unless REQUIRE_OFFICIAL_FORMS_FIXTURES=1 (set only by a protected job).
// When it is on, a missing or altered historical fixture fails the run instead of letting the real-artifact tests skip.
// It re-hashes every pinned file from scripts/official-forms/manifest.json, using the same SHA-256 and length rule as verify.mjs.
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { OFFICIAL_FORMS_DIR, officialFormFile } from "../testSupport/officialFormFixtures.js";

const required = process.env.REQUIRE_OFFICIAL_FORMS_FIXTURES === "1";
const manifestPath = resolve(fileURLToPath(new URL("../../scripts/official-forms/manifest.json", import.meta.url)));
const pins: { fileName: string; sha256: string; byteLength: number }[] = JSON.parse(fs.readFileSync(manifestPath, "utf8")).files;

(required ? describe : describe.skip)("official-form fixtures are required (fail-closed)", () => {
  it("OFFICIAL_FORMS_DIR is a directory", () => {
    expect(fs.statSync(OFFICIAL_FORMS_DIR).isDirectory(), OFFICIAL_FORMS_DIR).toBe(true);
  });

  for (const pin of pins) {
    it(`${pin.fileName} is present and matches its pinned SHA-256 and byte length`, () => {
      const p = officialFormFile(pin.fileName);
      expect(fs.existsSync(p), `missing: ${pin.fileName}`).toBe(true);
      const bytes = fs.readFileSync(p);
      expect(bytes.length).toBe(pin.byteLength);
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(pin.sha256);
    });
  }
});
