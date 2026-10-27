// Fail-closed fixture requirement. Off unless REQUIRE_OFFICIAL_FORMS_FIXTURES is "1" or "retrievable".
// When it is on, a missing or altered fixture fails the run instead of letting the real-artifact tests skip.
// It re-hashes every pinned file (SHA-256 and exact byte length, the same rule as verifyLib.mjs).
//
// Every pin is always registered, so every pin appears in the report. A pin that is not checked in the current mode is
// reported as a skip with its reason in the test name. Nothing is dropped from the report.
import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { OFFICIAL_FORMS_CURRENT_DIR, OFFICIAL_FORMS_DIR, officialFormCurrentFile, officialFormFile } from "../testSupport/officialFormFixtures.js";

// "1": every pinned file (17) must be present and match. "retrievable": only the entries whose bytes come from an official
// source (retrievable: true). The six superseded historical PDFs are then not checked. Any other value: off.
const mode = process.env.REQUIRE_OFFICIAL_FORMS_FIXTURES;
const required = mode === "1" || mode === "retrievable";
type Pin = { fileName: string; sha256: string; byteLength: number; retrievable?: boolean };
const readPins = (name: string): Pin[] =>
  JSON.parse(fs.readFileSync(resolve(fileURLToPath(new URL(`../../scripts/official-forms/${name}`, import.meta.url))), "utf8")).files;
const pins = readPins("manifest.json");
const currentPins = readPins("current-manifest.json");

const historicalChecked = (p: Pin) => mode === "1" || p.retrievable === true;
const currentChecked = (p: Pin) => mode === "1" || p.retrievable !== false;

function checkPin(p: Pin, path: string) {
  expect(fs.existsSync(path), `missing: ${p.fileName}`).toBe(true);
  const bytes = fs.readFileSync(path);
  expect(bytes.length).toBe(p.byteLength);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(p.sha256);
}

/** Registers one pin. Checked pins run; unchecked pins are reported as labelled skips, with the reason in the name. */
function registerPin(kind: "historical" | "current", p: Pin, checked: boolean, pathOf: (f: string) => string) {
  const name = `${kind} ${p.fileName} is present and matches its pinned SHA-256 and byte length`;
  if (!required) return it.skip(`${name} [skipped: REQUIRE_OFFICIAL_FORMS_FIXTURES is unset]`);
  if (!checked) return it.skip(`${name} [skipped: not checked in retrievable mode; superseded, no official source]`);
  it(name, () => checkPin(p, pathOf(p.fileName)));
}

describe("official-form fixtures are required (fail-closed)", () => {
  if (!required) {
    it.skip("the historical and current fixture folders exist [skipped: REQUIRE_OFFICIAL_FORMS_FIXTURES is unset]", () => undefined);
  } else {
    it("the historical and current fixture folders exist", () => {
      expect(fs.statSync(OFFICIAL_FORMS_DIR).isDirectory(), OFFICIAL_FORMS_DIR).toBe(true);
      expect(fs.statSync(OFFICIAL_FORMS_CURRENT_DIR).isDirectory(), OFFICIAL_FORMS_CURRENT_DIR).toBe(true);
    });
  }
  for (const p of pins) registerPin("historical", p, historicalChecked(p), officialFormFile);
  for (const p of currentPins) registerPin("current", p, currentChecked(p), officialFormCurrentFile);
});
