// Demonstration-release gate for quotation verification. A quotation must never verify when it cuts through a word, a
// contraction or a surrogate pair, and legitimate quotations must still verify. Synthetic text only.
import { describe, expect, it } from "vitest";
import { locateQuote } from "../../shared/quoteVerification";

const verified = (status: string) => status === "EXACT" || status === "NORMALIZED_WHITESPACE" || status === "CASE_OR_PUNCTUATION_VARIANT";

describe("defects that must not reach the demonstration release", () => {
  it("'true' is not a verbatim quotation from 'untrue'", () => {
    const r = locateQuote("He said it was untrue that he struck the child.", "true that he struck the child");
    expect(r.status).toBe("ABSENT");
  });

  it("'I can' is not a verbatim quotation from \"I can't\" (straight apostrophe)", () => {
    expect(locateQuote("I can't attend the meeting.", "I can").status).toBe("ABSENT");
  });

  it("'I can' is not a verbatim quotation from \"I can't\" (curly apostrophe)", () => {
    expect(locateQuote("I can’t attend the meeting.", "I can").status).toBe("ABSENT");
  });

  it("'I can' is not a verbatim quotation from \"I can't\" with a soft hyphen after the apostrophe", () => {
    expect(locateQuote("I can't­ attend.", "I can").status).toBe("ABSENT");
  });

  it("a lone high surrogate is never verified", () => {
    expect(locateQuote("Smile \u{1F600} now.", "Smile \uD83D").status).toBe("ABSENT");
  });

  it("a lone low surrogate is never verified", () => {
    expect(locateQuote("Smile \u{1F600} now.", "\uDE00 now").status).toBe("ABSENT");
  });

  it("a quotation that cuts a word in half is not verified", () => {
    expect(locateQuote("The child was fed.", "child was fe").status).toBe("ABSENT");
  });

  it("a quotation that cuts a word at its start is not verified", () => {
    expect(locateQuote("The careful plan.", "care").status).toBe("ABSENT");
  });
});

describe("legitimate quotations still verify", () => {
  it("an exact sentence verifies", () => {
    expect(locateQuote("The child was fed. She was calm.", "The child was fed.").status).toBe("EXACT");
  });

  it("a contraction quoted whole verifies", () => {
    expect(locateQuote("She can't attend.", "can't attend").status).toBe("EXACT");
  });

  it("a curly-apostrophe source matches a straight-apostrophe quote (punctuation normalization)", () => {
    expect(verified(locateQuote("She can’t attend.", "She can't attend").status)).toBe(true);
  });

  it("a quotation wrapped in quotation marks is unwrapped and verifies", () => {
    expect(verified(locateQuote("He said “No” today.", "\"No\"").status)).toBe(true);
  });

  it("a quotation inside a longer word-bounded phrase verifies at the right offset", () => {
    const src = "The worker wrote: the child was fed. Later.";
    const r = locateQuote(src, "the child was fed.");
    expect(verified(r.status)).toBe(true);
    expect(src.slice(r.startOffset!, r.endOffset!).toLowerCase()).toBe("the child was fed.");
  });

  it("an accented word verifies as a whole word", () => {
    expect(locateQuote("Le garçon est ici.", "garçon").status).toBe("EXACT");
  });

  it("an emoji pair quoted whole verifies", () => {
    expect(locateQuote("Smile \u{1F600} now.", "\u{1F600}").status).toBe("EXACT");
  });
});

describe("page attribution is preserved", () => {
  it("a quotation reports the page it appears on", () => {
    const src = "[Page 1]\nThe child was fed.\n[Page 2]\nThe mother said she was tired.";
    const r = locateQuote(src, "The mother said she was tired.");
    expect(r.page).toBe(2);
  });
});
