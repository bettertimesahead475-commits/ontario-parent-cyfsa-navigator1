import { describe, expect, it } from "vitest";
import { parseCaseBriefPoint, parseLabelledPipeItem } from "../../shared/caseBriefStructure";

describe("parseCaseBriefPoint", () => {
  it("splits the em-dash form the analyzer is asked to write", () => {
    const p = parseCaseBriefPoint(
      "ISSUE — hearsay reliance in para 12 — DOCUMENT EVIDENCE — \"the neighbour told me\" (p. 3, para 12) — SIGNIFICANCE — weight of untested hearsay — LIMITATION/COUNTERPOINT — the source is named — VERIFY/NEXT QUESTION — was the neighbour interviewed?"
    );
    expect(p.structured).toBe(true);
    expect(p.parts).toEqual({
      issue: "hearsay reliance in para 12",
      documentEvidence: "\"the neighbour told me\" (p. 3, para 12)",
      significance: "weight of untested hearsay",
      limitation: "the source is named",
      verify: "was the neighbour interviewed?",
    });
  });

  it("accepts colon and bold labels with spaced slashes", () => {
    const p = parseCaseBriefPoint(
      "**ISSUE:** Late disclosure. **DOCUMENT EVIDENCE:** Page 2 says notes were provided on day 30. **LIMITATION / COUNTERPOINT:** Disclosure dates may be in another record. **VERIFY / NEXT QUESTION:** Request the disclosure log."
    );
    expect(p.structured).toBe(true);
    expect(p.parts.issue).toBe("Late disclosure.");
    expect(p.parts.documentEvidence).toBe("Page 2 says notes were provided on day 30.");
    expect(p.parts.limitation).toBe("Disclosure dates may be in another record.");
    expect(p.parts.verify).toBe("Request the disclosure log.");
    expect(p.parts.significance).toBeUndefined();
  });

  it("keeps hyphenated words inside values and does not treat lower-case words as labels", () => {
    const p = parseCaseBriefPoint(
      "ISSUE: the issue of non-compliance with the significance of evidence — DOCUMENT EVIDENCE: para 4 — SIGNIFICANCE: credibility"
    );
    expect(p.parts.issue).toBe("the issue of non-compliance with the significance of evidence");
    expect(p.parts.documentEvidence).toBe("para 4");
    expect(p.parts.significance).toBe("credibility");
  });

  it("returns an unstructured point unchanged (no guessing)", () => {
    const p = parseCaseBriefPoint("The affidavit relies on **unsworn** third-party statements.");
    expect(p.structured).toBe(false);
    expect(p.parts).toEqual({});
    expect(p.text).toBe("The affidavit relies on unsworn third-party statements.");
  });

  it("is not structured by a single label", () => {
    expect(parseCaseBriefPoint("ISSUE: only one label here").structured).toBe(false);
  });

  it("keeps text written before the first label with the issue", () => {
    const p = parseCaseBriefPoint("Point 1. ISSUE — delay — SIGNIFICANCE — s. 94(1)");
    expect(p.parts.issue).toBe("Point 1. delay");
    expect(p.parts.significance).toBe("s. 94(1)");
  });

  it("does not split on a label inside a quotation", () => {
    const p = parseCaseBriefPoint("ISSUE: access — EVIDENCE: \u201CSIGNIFICANCE: none noted\u201D (p. 3) — SIGNIFICANCE: s. 74");
    expect(p.parts.documentEvidence).toBe("\u201CSIGNIFICANCE: none noted\u201D (p. 3)");
    expect(p.parts.significance).toBe("s. 74");
  });

  it("treats a straight inch mark inside curly-quoted evidence as text", () => {
    const p = parseCaseBriefPoint("ISSUE: home — EVIDENCE: \u201Ca 6\" gap in the gate\u201D (p. 2) — SIGNIFICANCE: s. 74(2)");
    expect(p.parts.documentEvidence).toBe("\u201Ca 6\" gap in the gate\u201D (p. 2)");
    expect(p.parts.significance).toBe("s. 74(2)");
  });

  it("handles non-string input", () => {
    expect(parseCaseBriefPoint(undefined as unknown as string)).toEqual({ structured: false, parts: {}, text: "" });
  });
});

describe("parseLabelledPipeItem", () => {
  it("splits the questions-for-counsel format", () => {
    expect(
      parseLabelledPipeItem("Question: Was consent given? | What the uploaded record shows: Not determinable from the uploaded documents | Still unknown: endorsement | Source: p. 2")
    ).toEqual([
      { label: "Question", value: "Was consent given?" },
      { label: "What the uploaded record shows", value: "Not determinable from the uploaded documents" },
      { label: "Still unknown", value: "endorsement" },
      { label: "Source", value: "p. 2" },
    ]);
  });

  it("returns null for plain items", () => {
    expect(parseLabelledPipeItem("Ask whether the worker's notes were disclosed.")).toBeNull();
  });
});
