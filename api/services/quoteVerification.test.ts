// Regression tests for shared/quoteVerification.ts: exact, whitespace, case/punctuation, ambiguous and absent quotations,
// with source locations, and the rule that only an exact match may be described as word-for-word.
import { describe, expect, it } from "vitest";
import {
  effectiveQuoteStatus,
  isVerbatimQuoteStatus,
  locateQuote,
  pageAtOffset,
  QUOTE_DISPLAY,
  severityCeiling,
  VERIFICATION_STATUS,
} from "../../shared/quoteVerification";

const DOC = "Page one text.\n\nThe worker stated that a neighbour told me the child was unsafe.\nLater the worker said it again.";

const slice = (source: string, loc: { startOffset: number | null; endOffset: number | null }) =>
  loc.startOffset === null || loc.endOffset === null ? null : Array.from(source).slice(loc.startOffset, loc.endOffset).join("");

describe("exact quotations", () => {
  it("a quotation that appears once, character for character, is EXACT and its location is the matched text", () => {
    const loc = locateQuote(DOC, "a neighbour told me the child was unsafe");
    expect(loc.status).toBe("EXACT");
    expect(slice(DOC, loc)).toBe("a neighbour told me the child was unsafe");
  });

  it("surrounding quotation marks are not part of the match", () => {
    expect(locateQuote(DOC, '"a neighbour told me the child was unsafe"').status).toBe("EXACT");
  });
});

describe("whitespace-normalized matches (OCR and line-break spacing)", () => {
  it("a line break where the source has a space is NORMALIZED_WHITESPACE, with the source span", () => {
    const loc = locateQuote(DOC, "a neighbour told me\nthe child was unsafe");
    expect(loc.status).toBe("NORMALIZED_WHITESPACE");
    expect(slice(DOC, loc)).toMatch(/^a neighbour told me\s+the child was unsafe$/);
  });

  it("double spaces and non-breaking spaces match as whitespace", () => {
    expect(locateQuote(DOC, "a  neighbour told me the child was unsafe").status).toBe("NORMALIZED_WHITESPACE");
  });

  it("an OCR-split word ('contin ued') is NOT located: it is not treated as the same word", () => {
    expect(locateQuote("the matter continued today", "the matter contin ued today").status).toBe("ABSENT");
  });

  it("a soft hyphen inserted by OCR or copy-paste is ignored as a punctuation variant", () => {
    expect(locateQuote("the matter contin­uity was noted", "the matter continuity was noted").status).toBe("CASE_OR_PUNCTUATION_VARIANT");
  });
});

describe("case or punctuation variations", () => {
  it("a change of capitalisation is CASE_OR_PUNCTUATION_VARIANT, not an exact match", () => {
    const loc = locateQuote("The worker said the child was unsafe.", "THE WORKER SAID THE CHILD WAS UNSAFE");
    expect(loc.status).toBe("CASE_OR_PUNCTUATION_VARIANT");
    expect(slice("The worker said the child was unsafe.", loc)).toBe("The worker said the child was unsafe");
  });

  it("curly quotes in the source against straight quotes in the quotation are a variant", () => {
    expect(locateQuote("He said “left alone”.", 'He said "left alone".').status).toBe("CASE_OR_PUNCTUATION_VARIANT");
  });

  it("an en dash in the source against a hyphen in the quotation is a variant", () => {
    expect(locateQuote("twenty–three days", "twenty-three days").status).toBe("CASE_OR_PUNCTUATION_VARIANT");
  });
});

describe("duplicate quotations", () => {
  it("a quotation found twice, exactly, is AMBIGUOUS, not EXACT", () => {
    const loc = locateQuote("the worker said it. the worker said it.", "the worker said it");
    expect(loc.status).toBe("AMBIGUOUS");
    expect(loc.startOffset).toBeNull();
  });

  it("a quotation found twice only after normalizing case is AMBIGUOUS", () => {
    expect(locateQuote("The worker said it. the worker said it.", "THE WORKER SAID IT").status).toBe("AMBIGUOUS");
  });

  it("a quotation found twice after normalizing whitespace is AMBIGUOUS", () => {
    expect(locateQuote("a  b c. a b  c.", "a b c").status).toBe("AMBIGUOUS");
  });
});

describe("absent quotations", () => {
  it("text not in the source is ABSENT with no location", () => {
    const loc = locateQuote(DOC, "the parent admitted neglect");
    expect(loc).toEqual({ status: "ABSENT", page: null, startOffset: null, endOffset: null });
  });

  it("an empty quotation or empty source is ABSENT", () => {
    expect(locateQuote(DOC, "   ").status).toBe("ABSENT");
    expect(locateQuote("", "anything").status).toBe("ABSENT");
  });

  it("a quotation that merely shares a few words is ABSENT", () => {
    expect(locateQuote(DOC, "the worker stated that the child was fine").status).toBe("ABSENT");
  });
});

describe("source locations", () => {
  const PDF_TEXT = "[Page 1]\nFirst page words.\n\n[Page 2]\nThe worker stated the concern.";

  it("reports the page marker that precedes the match", () => {
    const loc = locateQuote(PDF_TEXT, "The worker stated the concern.");
    expect(loc.status).toBe("EXACT");
    expect(loc.page).toBe(2);
  });

  it("reports page 1 for text on the first page", () => {
    expect(locateQuote(PDF_TEXT, "First page words").page).toBe(1);
  });

  it("reports no page when the source has no page markers (DOCX or text)", () => {
    expect(locateQuote(DOC, "a neighbour told me").page).toBeNull();
    expect(pageAtOffset(DOC, 5)).toBeNull();
  });
});

describe("what each status may claim", () => {
  it("only EXACT may be described as word-for-word", () => {
    for (const [status, display] of Object.entries(QUOTE_DISPLAY)) {
      if (status === "EXACT") {
        expect(display.wordForWord).toBe(true);
        expect(display.label).toMatch(/word-for-word/);
      } else {
        expect(display.wordForWord, status).toBe(false);
        expect(display.label, status).not.toMatch(/word-for-word/);
      }
    }
  });

  it("only exact or whitespace-only matches count as verified (verbatim)", () => {
    expect(isVerbatimQuoteStatus("EXACT")).toBe(true);
    expect(isVerbatimQuoteStatus("NORMALIZED_WHITESPACE")).toBe(true);
    expect(isVerbatimQuoteStatus("CASE_OR_PUNCTUATION_VARIANT")).toBe(false);
    expect(isVerbatimQuoteStatus("AMBIGUOUS")).toBe(false);
    expect(isVerbatimQuoteStatus("ABSENT")).toBe(false);
  });

  it("a legacy NORMALIZED_PUNCTUATION record is shown as a variant, never word-for-word", () => {
    const d = QUOTE_DISPLAY[effectiveQuoteStatus({ quoteVerification: "NORMALIZED_PUNCTUATION", quoteVerified: true })];
    expect(d.wordForWord).toBe(false);
  });

  it("a legacy record with only quoteVerified: true is shown as found, match type unrecorded, not word-for-word", () => {
    expect(effectiveQuoteStatus({ quoteVerified: true })).toBe("UNRECORDED_MATCH");
    expect(QUOTE_DISPLAY.UNRECORDED_MATCH.wordForWord).toBe(false);
  });

  it("a record with no quotation check is NOT_CHECKED", () => {
    expect(effectiveQuoteStatus({})).toBe("NOT_CHECKED");
  });

  it("the verification statuses are distinct and cover every match type", () => {
    expect(new Set(Object.values(VERIFICATION_STATUS)).size).toBe(5);
  });

  it("the severity ceiling falls as the quotation weakens", () => {
    expect(severityCeiling("EXACT")).toBe("CRITICAL");
    expect(severityCeiling("NORMALIZED_WHITESPACE")).toBe("CRITICAL");
    expect(severityCeiling("CASE_OR_PUNCTUATION_VARIANT")).toBe("Worth Raising With Counsel");
    expect(severityCeiling("AMBIGUOUS")).toBe("Worth Raising With Counsel");
    expect(severityCeiling("ABSENT")).toBe("Affects Evidentiary Weight");
  });
});

describe("quotations across page breaks", () => {
  const source = "[Page 1]\nThe worker attended the home on Monday and\n[Page 2]\nspoke with the mother for an hour.";
  const quote = "The worker attended the home on Monday and spoke with the mother for an hour.";

  it("a quotation that runs across a page break is found, not reported as absent", () => {
    const r = locateQuote(source, quote);
    expect(r.status).toBe("NORMALIZED_WHITESPACE");
    expect(r.page).toBe(1);
  });

  it("the reported span points at the quoted words in the original source", () => {
    const r = locateQuote(source, quote);
    expect(r.startOffset).not.toBeNull();
    const spanned = Array.from(source).slice(r.startOffset!, r.endOffset!).join("");
    // The span includes the page marker it crosses; without markers and with collapsed whitespace it is the quotation.
    expect(spanned.replace(/\[Page \d+\]/g, "").replace(/\s+/g, " ").trim()).toBe(quote);
  });

  it("a quotation that copies a page marker from the source is still matched", () => {
    const r = locateQuote(source, "[Page 2] spoke with the mother for an hour.");
    expect(r.status).not.toBe("ABSENT");
  });

  it("a source that holds only page markers has no text to match", () => {
    expect(locateQuote("[Page 1]\n[Page 2]", "anything").status).toBe("ABSENT");
  });
});
