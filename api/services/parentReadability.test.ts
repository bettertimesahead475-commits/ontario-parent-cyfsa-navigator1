import { describe, it, expect } from "vitest";
import { FIELD_NOT_ESTABLISHED_TEXT, buildFormFieldFact } from "./formFieldFacts";
import { mapPdfFields } from "./officialFormPdfSemanticMap";

/**
 * Automated plain-language check for parent-facing text. The grade is a Flesch-Kincaid estimate using a vowel-group
 * syllable count. It is a heuristic and not a certified reading-level tool, so it guards against regressions; a person
 * must still review final wording (checklist item O7).
 */
function syllables(word: string): number {
  const w = word.toLowerCase().replace(/[^a-z]/g, "");
  if (!w) return 0;
  if (w.length <= 3) return 1;
  const groups = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, "").replace(/^y/, "").match(/[aeiouy]{1,2}/g);
  return Math.max(1, groups ? groups.length : 1);
}

export function gradeEstimate(text: string) {
  const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
  const words = text.split(/\s+/).map(w => w.replace(/[^A-Za-z'-]/g, "")).filter(Boolean);
  const syl = words.reduce((a, w) => a + syllables(w), 0);
  const grade = 0.39 * (words.length / sentences.length) + 11.8 * (syl / words.length) - 15.59;
  const longest = Math.max(...sentences.map(s => s.split(/\s+/).length));
  return { grade, longest };
}

const SOURCE = { formNumber: "UNIDENTIFIED", sourceSha256: "a".repeat(64) };

describe("parent-facing wording stays at or below about Grade 8 (estimate)", () => {
  it("the not-established field sentence is within the target", () => {
    const { grade, longest } = gradeEstimate(FIELD_NOT_ESTABLISHED_TEXT);
    expect(grade).toBeLessThanOrEqual(8);
    expect(longest).toBeLessThanOrEqual(25);
  });

  it("a confirmed field sentence is within the target", () => {
    const [mapping] = mapPdfFields([{ name: "n", page: 1, type: "Tx", left: "", above: "Court File Number", below: "" }]);
    const fact = buildFormFieldFact(mapping, "CV-1", SOURCE);
    const { grade, longest } = gradeEstimate(fact.reportText);
    expect(grade).toBeLessThanOrEqual(8);
    expect(longest).toBeLessThanOrEqual(25);
  });

  it("parent-facing text avoids legal conclusion words", () => {
    const [mapping] = mapPdfFields([{ name: "n", page: 1, type: "Tx", left: "", above: "Court File Number", below: "" }]);
    const fact = buildFormFieldFact(mapping, "CV-1", SOURCE);
    for (const word of ["violation", "breach", "defect", "non-compliant", "illegal", "guilty"]) {
      expect(fact.reportText.toLowerCase()).not.toContain(word);
      expect(FIELD_NOT_ESTABLISHED_TEXT.toLowerCase()).not.toContain(word);
    }
  });
});
