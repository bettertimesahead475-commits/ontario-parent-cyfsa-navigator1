// Adversarial quotation cases (negation prefixes, negated words, Unicode hyphens and apostrophes, OCR punctuation).
// A quotation that drops or inverts a negation must never verify. Legitimate quotations must still verify.
// Synthetic text only. A verified status is EXACT, NORMALIZED_WHITESPACE or CASE_OR_PUNCTUATION_VARIANT.
import { describe, expect, it } from "vitest";
import { isVerbatimQuoteStatus, locateQuote } from "../../shared/quoteVerification";

const status = (source: string, quote: string) => locateQuote(source, quote).status;
const mustNotVerify = (source: string, quote: string) => expect(isVerbatimQuoteStatus(status(source, quote))).toBe(false);
const mustVerify = (source: string, quote: string) => expect(isVerbatimQuoteStatus(status(source, quote))).toBe(true);

describe("hyphenated negation prefixes", () => {
  it("'violent during the visit' does not verify against 'non-violent during the visit'", () => {
    mustNotVerify("The father was non-violent during the visit.", "violent during the visit");
  });
  it("the same with a non-breaking hyphen (U+2011)", () => {
    mustNotVerify("The father was non‑violent during the visit.", "violent during the visit");
  });
  it("the same with a Unicode hyphen (U+2010)", () => {
    mustNotVerify("The father was non‐violent during the visit.", "violent during the visit");
  });
  it("'compliant' does not verify against 'non-compliant'", () => {
    mustNotVerify("The parent was non-compliant with the order.", "compliant with the order");
  });
  it("'abusive' does not verify against 'non-abusive'", () => {
    mustNotVerify("The home was non-abusive at all times.", "abusive at all times");
  });
  it("'threatening' does not verify against 'non-threatening'", () => {
    mustNotVerify("The message was non-threatening in tone.", "threatening in tone");
  });
  it("'urgent' does not verify against 'non-urgent' (partial word after a hyphen)", () => {
    mustNotVerify("The report was non-urgent.", "The report was non");
  });
  it("a whole hyphenated compound verifies", () => {
    mustVerify("The father was non-violent during the visit.", "non-violent during the visit");
  });
  it("a whole hyphenated compound with a Unicode hyphen verifies", () => {
    mustVerify("The father was non‑violent during the visit.", "non‑violent during the visit");
  });
  it("a hyphen used as a separator (a list or visit number) is not a compound", () => {
    mustVerify("Visit 2 - the child was fed.", "the child was fed");
  });
});

describe("negated words", () => {
  it("'guilty' is not verified as a quotation of 'Not guilty'", () => {
    mustNotVerify("The court found the parent Not guilty.", "guilty");
  });
  it("'evidence was found' is not verified as a quotation of 'No evidence was found'", () => {
    mustNotVerify("No evidence was found against the parent.", "evidence was found");
  });
  it("'Not guilty' verifies when quoted whole", () => {
    mustVerify("The court found the parent Not guilty.", "Not guilty");
  });
  it("'No evidence' verifies when quoted whole", () => {
    mustVerify("No evidence was found against the parent.", "No evidence was found");
  });
  it("'unsubstantiated' does not verify against 'substantiated' (prefix without a hyphen)", () => {
    mustNotVerify("The allegation was unsubstantiated.", "substantiated");
  });
  it("'did' does not verify against \"didn't\" (negation contraction)", () => {
    mustNotVerify("The parent didn't attend the visit.", "did");
  });
});

describe("apostrophes and contractions", () => {
  it("'I can' does not verify against \"I can’t\" (curly)", () => {
    mustNotVerify("I can’t attend the meeting.", "I can");
  });
  it("'I can' does not verify against 'I can＇t' (full-width apostrophe, U+FF07)", () => {
    mustNotVerify("I can＇t attend the meeting.", "I can");
  });
  it("'I can' does not verify against \"I can't\" (straight)", () => {
    mustNotVerify("I can't attend the meeting.", "I can");
  });
  it("a possessive is not a negation: 'The children' verifies from 'The children’s'", () => {
    mustVerify("The children’s needs were met.", "The children");
  });
});

describe("OCR-generated punctuation", () => {
  it("OCR inserts a space around a hyphen: a compound split by OCR is not silently verified as its second half", () => {
    // OCR output "non - violent" is ambiguous; it must not verify the bare word as a faithful quotation.
    mustNotVerify("The father was non - violent during the visit.", "violent during the visit");
  });
  it("OCR line-break hyphenation: 'non-\\nviolent' does not verify 'violent' alone", () => {
    mustNotVerify("The father was non-\nviolent during the visit.", "violent during the visit");
  });
  it("a whitespace-only difference in a legitimate quotation still verifies", () => {
    mustVerify("The child was  fed.", "The child was fed.");
  });
});

describe("no unnecessary rejection of legitimate quotations", () => {
  it("a plain sentence verifies", () => {
    mustVerify("The child was fed. She was calm.", "The child was fed.");
  });
  it("a quotation in the middle of a sentence verifies", () => {
    mustVerify("On Monday the worker wrote that the child was fed at noon.", "the child was fed");
  });
  it("a number with a hyphen verifies", () => {
    mustVerify("Section 74-2 applies.", "Section 74-2");
  });
  it("a quoted word after a sentence break verifies", () => {
    mustVerify("It was done. Not again.", "Not again.");
  });
});
