/**
 * DEVIN-PERF-01: report guards canonicalized the whole source document once per finding. The locator prepares the
 * document once, which removes per-finding canonicalization. Each lookup still scans the prepared text, so guard cost
 * remains O(findings x document) in the scan; only the constant factor changes. Equivalence with the pre-PR
 * implementation is pinned in quote-locator-differential.test.ts. Synthetic text only.
 */
import { describe, expect, it } from "vitest";
import { createQuoteLocator, locateQuote } from "../../shared/quoteVerification";
import { applyReportGuards } from "../../api/services/analyzerSections";

const SOURCE = [
  "[Page 1]",
  "The worker wrote: \u201cThe child was   left alone\u201d on March 3.",
  "It is untrue that the father struck the child.",
  "[Page 2]",
  "The mother said she can't attend. The child was fed.",
  "The child was fed.",
  "Caf\u00e9 visit \u{1F600} occurred \u2014 twice.",
].join("\n");

const QUOTES = [
  "The child was left alone",
  '"It is untrue that the father struck the child."',
  "true that the father struck the child",
  "she can",
  "The child was fed.",
  "THE MOTHER SAID SHE CAN'T ATTEND",
  "Caf\u00e9 visit \u{1F600} occurred - twice.",
  "never written anywhere",
  "",
  "[Page 2]",
];

function largeDocument(pages: number): string {
  const lines: string[] = [];
  for (let p = 1; p <= pages; p++) {
    lines.push(`[Page ${p}]`);
    for (let l = 0; l < 40; l++) lines.push(`${p}.${l} Observation ${p * 100 + l} about supervision at access visits.`);
  }
  return lines.join("\n");
}

describe("createQuoteLocator", () => {
  it("returns the same result as locateQuote for every match type, page and offset", () => {
    const locate = createQuoteLocator(SOURCE);
    for (const q of QUOTES) expect(locate(q)).toEqual(locateQuote(SOURCE, q));
    expect(locate("The child was left alone")).toMatchObject({ status: "NORMALIZED_WHITESPACE", page: 1 });
    expect(locate("true that the father struck the child").status).toBe("ABSENT");
    expect(locate("she can").status).toBe("ABSENT");
    expect(locate("The child was fed.").status).toBe("AMBIGUOUS");
    expect(locate("THE MOTHER SAID SHE CAN'T ATTEND")).toMatchObject({ status: "CASE_OR_PUNCTUATION_VARIANT", page: 2 });
  });

  it("treats an empty or marker-only source as absent", () => {
    for (const src of ["", "   ", "[Page 1]\n[Page 2]"]) expect(createQuoteLocator(src)("anything").status).toBe("ABSENT");
  });

  it("does not share results between returned locators", () => {
    const a = createQuoteLocator("alpha beta gamma");
    const b = createQuoteLocator("delta epsilon");
    expect(a("beta").status).toBe("EXACT");
    expect(b("beta").status).toBe("ABSENT");
    const first = a("beta");
    first.page = 99;
    expect(a("beta").page).toBeNull();
  });

  // Functional only: 25 findings on one document all receive the verdict locateQuote gives them. No timing assertion,
  // because wall-clock ratios are flaky. Speed is measured in the benchmark notes, not asserted here.
  it("applyReportGuards gives 25 findings the same verdict as an independent per-finding locateQuote", () => {
    const text = largeDocument(120);
    const quoted = text.split("\n").filter((l) => !l.startsWith("[Page")).slice(0, 25);
    const flags = quoted.map((q, i) => ({ id: `rf${i + 1}`, severity: "Worth Raising With Counsel", phraseDetected: q.slice(-40), explanation: "x", legalReference: "" }));
    const guarded = applyReportGuards({ redFlags: flags, thresholdAnalysis: [] }, text);
    for (const f of guarded.redFlags) {
      expect(f.quoteVerification).toBe(locateQuote(text, f.phraseDetected).status);
    }
    expect(guarded.redFlags.every((f: any) => f.quoteVerification === "EXACT")).toBe(true);
  });
});
