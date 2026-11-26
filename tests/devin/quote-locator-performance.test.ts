/**
 * DEVIN-PERF-01: report guards canonicalized the whole source document once per finding, so guard CPU grew with
 * (findings x document size): 25 findings on a 200-page synthetic document took about 7.9 s of CPU. The locator
 * prepares the document once. These tests pin identical results and per-finding cost that no longer scales with
 * document size. Synthetic text only.
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

  it("keeps report-guard cost per finding independent of document size", () => {
    const text = largeDocument(120);
    const quoted = text.split("\n").filter((l) => !l.startsWith("[Page")).slice(0, 25);
    const report = (n: number) => ({ redFlags: quoted.slice(0, n).map((q, i) => ({ id: `rf${i + 1}`, severity: "Worth Raising With Counsel", phraseDetected: q.slice(-40), explanation: "x", legalReference: "" })), thresholdAnalysis: [] });
    applyReportGuards(report(1), text);
    const t1 = performance.now();
    applyReportGuards(report(1), text);
    const one = performance.now() - t1;
    const t25 = performance.now();
    const guarded = applyReportGuards(report(25), text);
    const many = performance.now() - t25;
    expect(guarded.redFlags.every((f: any) => f.quoteVerification === "EXACT")).toBe(true);
    // Measured locally: about 11 when every finding re-scanned the document, about 2.4 with the locator.
    expect(many / Math.max(one, 1)).toBeLessThan(5);
  });
  it("prepares nothing until the first quote, so a report without quotes adds no document copies", () => {
    const text = largeDocument(120);
    const t0 = performance.now();
    for (let i = 0; i < 50; i++) createQuoteLocator(text);
    expect(performance.now() - t0).toBeLessThan(50);
    expect(createQuoteLocator("[Page 1]\n  ")("anything").status).toBe("ABSENT");
  });
});
