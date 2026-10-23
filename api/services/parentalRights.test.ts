import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { PARENTAL_RIGHTS, NOT_YET_VERIFIED } from "../../shared/parentalRights.js";
import { readability } from "../../src/utils/parentReportView.js";

const statute = readFileSync(
  resolve(__dirname, "../../legal-reference/CYFSA_full_text_2026-06-24_consolidation.txt"),
  "utf8"
);
// Normalise whitespace and typographic apostrophes so a quote matches the source line exactly.
const norm = (s: string) => s.replace(/\s+/g, " ").replace(/[‘’]/g, "'").trim();
const sourceText = norm(statute);

describe("parental rights sources", () => {
  it("has a unique id for every entry", () => {
    const ids = PARENTAL_RIGHTS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const right of PARENTAL_RIGHTS) {
    it(`quotes ${right.section} verbatim from the CYFSA consolidation`, () => {
      expect(sourceText).toContain(norm(right.quote));
    });
  }

  it("keeps plain-English text readable for a Grade 8 reader", () => {
    for (const right of PARENTAL_RIGHTS) {
      const r = readability(right.plainEnglish);
      expect(r.wordsPerSentence, right.id).toBeLessThanOrEqual(22);
      expect(r.gradeLevel, right.id).toBeLessThanOrEqual(10);
    }
  });

  it("does not claim a violation or a result in any plain-English text", () => {
    const text = PARENTAL_RIGHTS.map((r) => `${r.plainEnglish} ${r.appliesWhen} ${r.verifyInDocuments}`).join(" ");
    expect(text).not.toMatch(/\bviolat|\bbreach|\bunlawful|\bwill win|\bguarantee|\byou should win/i);
  });

  it("states what each entry does not cover", () => {
    for (const right of PARENTAL_RIGHTS) {
      expect(right.limitations.trim().length, right.id).toBeGreaterThan(20);
    }
  });

  it("lists gaps in verification instead of hiding them", () => {
    expect(NOT_YET_VERIFIED.join(" ")).toMatch(/Family Law Rules/);
    expect(NOT_YET_VERIFIED.join(" ")).toMatch(/case law/i);
  });
});
