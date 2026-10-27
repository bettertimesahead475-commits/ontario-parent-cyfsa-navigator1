// What a parent is shown for citation and quotation verification. These tests read the parent-facing text, so a status
// the analyzer could not establish cannot appear as a verified fact. Covers Quick Review and Forensic In-Depth, which
// share the same report fields.
import { describe, expect, it } from "vitest";
import { buildParentReportView } from "./parentReportView";
import { findBundledStatute } from "./statuteReference";
import { QUOTE_LABEL } from "../../shared/reportSectionLabels";

function viewFor(flag: Record<string, unknown>) {
  const view = buildParentReportView({
    documentTitle: "Affidavit",
    redFlags: [{ id: "rf1", category: "Hearsay", severity: "CRITICAL", evidenceClassification: "HEARSAY", explanation: "x", verifyRequirement: "y", ...flag }],
  } as any);
  return view.findings[0];
}

describe("quotation wording in the parent view", () => {
  it("EXACT is presented as the record's own words", () => {
    const f = viewFor({ phraseDetected: "a neighbour told me", quoteVerification: "EXACT", quoteVerified: true, quoteLocation: { page: 2, startOffset: 0, endOffset: 1 } });
    expect(f.whatHappened).toMatch(/^The record says: "a neighbour told me"/);
    expect(f.evidenceDetail.location).toBe("Page 2 (quoted passage)");
  });

  it("shows the model's locator together with the page of the quoted passage when both exist", () => {
    const f = viewFor({ phraseDetected: "a neighbour told me", quoteVerification: "EXACT", quoteVerified: true, locationInDocument: "Page 3, Paragraph 1", quoteLocation: { page: 2, startOffset: 0, endOffset: 1 } });
    expect(f.evidenceDetail.location).toBe("Page 3, Paragraph 1 (quoted passage: page 2)");
  });

  it("NORMALIZED_WHITESPACE says spacing differs and does not claim the wording is an exact copy", () => {
    const f = viewFor({ phraseDetected: "a neighbour\ntold me", quoteVerification: "NORMALIZED_WHITESPACE", quoteVerified: true });
    expect(f.whatHappened).toMatch(/line breaks or spacing differ/);
    expect(f.whatHappened).not.toMatch(/^The record says:/);
  });

  it("CASE_OR_PUNCTUATION_VARIANT is a qualified paraphrase warning", () => {
    const f = viewFor({ phraseDetected: "A NEIGHBOUR TOLD ME", quoteVerification: "CASE_OR_PUNCTUATION_VARIANT", quoteVerified: false });
    expect(f.whatHappened).toMatch(/capitalisation or punctuation does not match/);
    expect(f.whatHappened).toMatch(/paraphrase/);
    expect(f.whatHappened).not.toMatch(/^The record says/);
  });

  it("AMBIGUOUS says the wording appears more than once", () => {
    const f = viewFor({ phraseDetected: "the worker said it", quoteVerification: "AMBIGUOUS", quoteVerified: false });
    expect(f.whatHappened).toMatch(/more than one place/);
  });

  it("ABSENT is an unverified allegation and carries the analyzer's warning", () => {
    const f = viewFor({
      phraseDetected: "the parent admitted neglect",
      quoteVerification: "ABSENT",
      quoteVerified: false,
      verificationNote: "The quoted passage could not be located in the uploaded document.",
    });
    expect(f.whatHappened).toMatch(/could not be found in the record/);
    expect(f.whatHappened).toMatch(/unverified allegation/);
    expect(f.whatHappened).toMatch(/could not be located in the uploaded document/);
    expect(f.whatHappened).not.toMatch(/^The record says/);
  });

  it("a legacy NORMALIZED_PUNCTUATION record is never presented as the record's words", () => {
    const f = viewFor({ phraseDetected: "A NEIGHBOUR", quoteVerification: "NORMALIZED_PUNCTUATION", quoteVerified: true });
    expect(f.whatHappened).not.toMatch(/^The record says/);
  });

  it("a record with no quotation check is not presented as checked", () => {
    const f = viewFor({ phraseDetected: "a neighbour told me" });
    expect(f.whatHappened).toMatch(/has not been checked against the record/);
  });

  it("every stored status has a label in the report-section labels", () => {
    for (const k of ["EXACT", "NORMALIZED_WHITESPACE", "CASE_OR_PUNCTUATION_VARIANT", "AMBIGUOUS", "ABSENT", "UNRECORDED_MATCH", "NOT_CHECKED"]) {
      expect(QUOTE_LABEL[k as keyof typeof QUOTE_LABEL], k).toBeTruthy();
    }
  });
});

describe("citation wording in the parent view", () => {
  it("an internal reference match says it is not verified against official e-Laws and does not show applicability", () => {
    const f = viewFor({ legalReference: "CYFSA, s. 88", citationStatus: "INTERNAL_REFERENCE_MATCH" });
    expect(f.evidenceDetail.citationStatus).toMatch(/internal reference text only/);
    expect(f.evidenceDetail.citationStatus).toMatch(/not been checked against official e-Laws/);
    expect(f.evidenceDetail.citationStatus).toMatch(/does not show that this section applies/);
    expect(f.evidenceDetail.citationStatus).not.toMatch(/confirmed/i);
  });

  it("a Family Law Act citation is unverified, even when a stored status says otherwise", () => {
    const f = viewFor({ legalReference: "Family Law Act, s. 88", citationStatus: "CONFIRMED_REFERENCE" });
    expect(f.evidenceDetail.citationStatus).toMatch(/Citation unverified/);
    expect(f.evidenceDetail.citationStatus).not.toMatch(/internal reference/);
  });

  it("a citation with no recorded status is unverified", () => {
    const f = viewFor({ legalReference: "CYFSA s. 74(2)" });
    expect(f.evidenceDetail.citationStatus).toMatch(/Citation unverified/);
  });
});

describe("bundled reference text is shown only for an unambiguous CYFSA match", () => {
  it("CYFSA, s. 88 returns its text", () => {
    expect(findBundledStatute("CYFSA, s. 88")?.citation).toBe("CYFSA s. 88");
  });

  it("another Act's section with the same number returns nothing", () => {
    expect(findBundledStatute("Family Law Act, s. 88")).toBeNull();
    expect(findBundledStatute("Criminal Code, s. 81(7)")).toBeNull();
  });

  it("a mixed or multi-section citation returns nothing", () => {
    expect(findBundledStatute("CYFSA ss. 74(2) and 94(1)")).toBeNull();
    expect(findBundledStatute("CYFSA s. 88 and Family Law Act s. 88")).toBeNull();
  });

  it("an unlisted CYFSA section returns nothing", () => {
    expect(findBundledStatute("CYFSA s. 94(5)")).toBeNull();
  });
});
