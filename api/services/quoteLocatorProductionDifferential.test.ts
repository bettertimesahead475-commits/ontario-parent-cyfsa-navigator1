/**
 * DEVIN-PERF-01 differential test. The engineering/integration implementation with DEVIN-P2-01 word boundaries
 * (eaca5cf shared/quoteVerification.ts, kept in fixtures/quoteVerificationIntegration.ts as the oracle)
 * is compared with the prepared locator on deterministic synthetic
 * inputs: Unicode punctuation, soft hyphens, zero-width marks, astral emoji, NBSP and ideographic spaces, page markers
 * that a quotation may cross, and case or punctuation variants. Seeded, so every run checks the same 32,000 cases.
 * Synthetic text only.
 */
import { describe, expect, it } from "vitest";
import * as NEW from "../../shared/quoteVerification";
import * as OLD from "../../tests/devin/fixtures/quoteVerificationIntegration";

function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TOKENS = [
  "The", "child", "was", "CAFÉ", "can't", "can’t", "father", "“", "”", "‘", "’", "—", "–",
  "­", "​", "\u{1F600}", "\n", "\t", "  ", " ", "[Page 1]", "[Page 2]", "[Page 3]", "untrue", "true",
  "Café", "-", ".", ",", "\"", "'", "x", "1", "　", " ", "naïve", "ß", "İ", "\r\n",
];
const SEP = [" ", "", "  ", "\n"];

function doc(pages: number): string {
  const lines: string[] = [];
  for (let p = 1; p <= pages; p++) {
    lines.push(`[Page ${p}]`);
    for (let l = 0; l < 40; l++) lines.push(`${p}.${l} Observation ${p * 100 + l} about supervision at access visits.`);
  }
  return lines.join("\n");
}

describe("prepared quotation locator is identical to the integration implementation (DEVIN-P2-01)", () => {
  it("32,000 seeded synthetic cases: same status, page, offsets for createQuoteLocator and locateQuote", () => {
    const r = rng(20261126);
    let cases = 0;
    const mismatches: string[] = [];
    for (let s = 0; s < 1000; s++) {
      const n = 1 + Math.floor(r() * 60);
      let source = "";
      for (let i = 0; i < n; i++) source += TOKENS[Math.floor(r() * TOKENS.length)] + SEP[Math.floor(r() * SEP.length)];
      const cps = Array.from(source);
      const locate = NEW.createQuoteLocator(source);
      for (let q = 0; q < 32; q++) {
        const a = Math.floor(r() * cps.length);
        const b = Math.min(cps.length, a + 1 + Math.floor(r() * 40));
        let quote = cps.slice(a, b).join("");
        const m = r();
        if (m < 0.15) quote = quote.toUpperCase();
        else if (m < 0.25) quote = quote.replace(/ /g, " ");
        else if (m < 0.35) quote = "“" + quote + "”";
        else if (m < 0.45) quote = quote.replace(/'/g, "’");
        else if (m < 0.55) quote = "­" + quote;
        else if (m < 0.62) quote = TOKENS[Math.floor(r() * TOKENS.length)] + " " + quote;
        else if (m < 0.7) quote = quote + "[Page 2]";
        else if (m < 0.75) quote = "";
        cases++;
        const expected = JSON.stringify(OLD.locateQuote(source, quote));
        if (JSON.stringify(locate(quote)) !== expected || JSON.stringify(NEW.locateQuote(source, quote)) !== expected) {
          mismatches.push(JSON.stringify({ source, quote }));
        }
      }
    }
    expect(mismatches).toEqual([]);
    expect(cases).toBeGreaterThanOrEqual(32000);
  });

  it("a 200-page document: 40 quotations across the document match the baseline; one locator is reused", () => {
    const text = doc(200);
    const cps = Array.from(text);
    const r = rng(7);
    const locate = NEW.createQuoteLocator(text);
    for (let i = 0; i < 40; i++) {
      const a = Math.floor(r() * cps.length);
      const quote = cps.slice(a, a + 60).join("");
      expect(locate(quote)).toEqual(OLD.locateQuote(text, quote));
    }
  });

  it("a locator's answers do not depend on earlier calls (no stale state)", () => {
    const text = doc(5);
    const locate = NEW.createQuoteLocator(text);
    const first = locate("Observation 100");
    locate("never written here");
    locate("Observation 101");
    expect(locate("Observation 100")).toEqual(first);
    expect(first).toEqual(OLD.locateQuote(text, "Observation 100"));
  });
});
