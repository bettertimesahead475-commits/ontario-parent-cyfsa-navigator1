// DEVIN-P2-01 for the 2026-11-26 hotfix: a quotation that starts or ends inside a word, a contraction or an emoji is not
// a word-for-word match. Each case below is EXACT on be46ad7 (production) and on 9c75884. Synthetic text only.
import { describe, expect, it } from "vitest";
import { createQuoteLocator, locateQuote } from "../../shared/quoteVerification";
import * as PROD from "../../tests/devin/fixtures/quoteVerificationProduction";

const CASES: [string, string, string][] = [
  ["drops the negation of 'untrue'", "It is untrue that the father struck the child.", "true that the father struck the child"],
  ["drops the negation of a contraction", "I can't attend the meeting on Tuesday.", "I can"],
  ["ends inside a word", "The parent was uncooperative at the visit.", "The parent was uncooperat"],
  ["starts inside an emoji", "She said \u{1F600} rest of the visit was calm.", "\uDE00 rest of the visit was calm"],
  ["starts after a soft hyphen inside 'untrue'", "It is un\u00ADtrue that the father struck the child.", "true that the father struck the child"],
  ["drops a contraction written with U+2018", "I can\u2018t attend the meeting on Tuesday.", "I can"],
  ["drops a contraction followed by a zero-width space", "I can't\u200B attend the meeting on Tuesday.", "I can"],
  ["ends before a combining accent", "The cafe\u0301 visit was calm.", "The cafe"],
  ["ends inside an emoji", "She said \u{1F600} rest of the visit was calm.", "said \uD83D"],
];

describe("hyphenated compounds and full-width apostrophes (release candidate 20261126 review)", () => {
  it.each([
    ["clipped hyphenated prefix", "The father was non-violent during the visit.", "violent during the visit"],
    ["clipped non-breaking-hyphen prefix", "The father was non\u2011violent during the visit.", "violent during the visit"],
    ["clipped compound end", "The report was non-urgent.", "The report was non"],
    ["case variant of a clipped prefix", "The father was non-violent.", "VIOLENT."],
    ["full-width apostrophe contraction", "I can\uFF07t attend.", "I can"],
  ])("%s: ABSENT", (_label, source, quote) => {
    expect(locateQuote(source, quote).status).toBe("ABSENT");
    expect(createQuoteLocator(source)(quote).status).toBe("ABSENT");
  });

  it("whole compounds and hyphens used as separators still verify", () => {
    expect(locateQuote("The father was non-violent during the visit.", "non-violent during the visit").status).toBe("EXACT");
    expect(locateQuote("A well-known risk.", "A well-known risk.").status).toBe("EXACT");
    expect(locateQuote("Visit 2 - the child was calm.", "the child was calm.").status).toBe("EXACT");
    expect(locateQuote("Visit 2 -the child was calm.", "the child was calm.").status).toBe("EXACT");
    expect(locateQuote("I can\uFF07t attend.", "I can\uFF07t attend.").status).toBe("EXACT");
  });
});

describe("quotations must start and end on whole words and whole characters", () => {
  it.each(CASES)("%s: ABSENT (production said EXACT)", (_label, source, quote) => {
    expect(PROD.locateQuote(source, quote).status).toBe("EXACT");
    expect(locateQuote(source, quote).status).toBe("ABSENT");
    expect(createQuoteLocator(source)(quote).status).toBe("ABSENT");
  });

  it("whole-word quotations are unchanged", () => {
    expect(locateQuote("It is untrue that the father struck the child.", "untrue that the father struck the child").status).toBe("EXACT");
    expect(locateQuote("I can't attend the meeting on Tuesday.", "I can't attend").status).toBe("EXACT");
    expect(locateQuote("She said \u{1F600} rest of the visit was calm.", "said \u{1F600} rest").status).toBe("EXACT");
    expect(locateQuote("It is un\u00ADtrue that he left.", "un\u00ADtrue that he left").status).toBe("EXACT");
    expect(locateQuote("The cafe\u0301 visit was calm.", "The cafe\u0301 visit").status).toBe("EXACT");
    expect(locateQuote("The home was clean\u200B. Nothing else.", "The home was clean").status).toBe("EXACT");
    expect(locateQuote("[Page 2]\nThe worker said the home was clean.", "the home was clean")).toMatchObject({ status: "EXACT", page: 2 });
  });

  it("a sub-word occurrence no longer makes a real quotation ambiguous", () => {
    const source = "It is untrue that he left. Later: true that he left.";
    expect(PROD.locateQuote(source, "true that he left").status).toBe("AMBIGUOUS");
    expect(locateQuote(source, "true that he left").status).toBe("EXACT");
  });
});
