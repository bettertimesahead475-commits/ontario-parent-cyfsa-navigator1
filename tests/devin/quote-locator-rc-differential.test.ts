/**
 * DEVIN-PERF-04 on the release candidate: the compact quotation locator must return exactly what the release-candidate
 * locator returned (fixtures/quoteVerificationRc147.ts, frozen at 8dc7a93 with its compound-word, dash, negation,
 * soft-hyphen and contraction rules). Equality, not properties: the memory change must not alter a single result.
 * Seeded synthetic inputs. Synthetic text only.
 */
import { describe, expect, it } from "vitest";
import * as NEW from "../../shared/quoteVerification";
import * as RC from "./fixtures/quoteVerificationRc147";

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
  "The", "child", "was", "CAFÉ", "can't", "can’t", "can＇t", "father", "“", "”", "‘", "’", "—", "–", "‐", "‑",
  "­", "​", "‌", "\u{1F600}", "\u{1D400}", "\n", "\t", "  ", " ", "[Page 1]", "[Page 2]", "[Page 12]", "untrue", "true",
  "Café", "cafe\u0301", "-", ".", ",", "\"", "'", "x", "1", "1-Child", "　", " ", "naïve", "ß", "İ", "\r\n",
  "non", "non-", "non‐", "non—", "violent", "non-violent", "not", "NOT", "Never", "nor", "without", "guilty", "no", "No",
  "evidence", "I", "can", "＇", "t", "T", "ʼ", "un\u00ADtrue", "\u{1F600}child",
];
const SEP = [" ", "", "  ", "\n", "-", "—"];

function sourceFrom(r: () => number): string {
  const n = 1 + Math.floor(r() * 60);
  let source = "";
  for (let i = 0; i < n; i++) source += TOKENS[Math.floor(r() * TOKENS.length)] + SEP[Math.floor(r() * SEP.length)];
  return source;
}

function quoteFrom(r: () => number, cps: string[]): string {
  const a = Math.floor(r() * cps.length);
  const b = Math.min(cps.length, a + 1 + Math.floor(r() * 40));
  let quote = cps.slice(a, b).join("");
  const m = r();
  if (m < 0.15) quote = quote.toUpperCase();
  else if (m < 0.3) quote = "“" + quote + "”";
  else if (m < 0.4) quote = quote.replace(/'/g, "’").replace(/-/g, "—");
  else if (m < 0.48) quote = "­" + quote;
  else if (m < 0.58) quote = TOKENS[Math.floor(r() * TOKENS.length)] + " " + quote;
  else if (m < 0.64) quote = quote + "[Page 2]";
  else if (m < 0.68) quote = "";
  return quote;
}

describe("compact quotation locator is identical to the release-candidate locator", () => {
  it("48,000 seeded cases: locateQuote, createQuoteLocator and containsQuoteOnWordBoundaries agree exactly", () => {
    const r = rng(20261127);
    let cases = 0;
    const failures: string[] = [];
    for (let s = 0; s < 1500; s++) {
      const source = sourceFrom(r);
      const cps = Array.from(source);
      const locate = NEW.createQuoteLocator(source);
      const rcLocate = RC.createQuoteLocator(source);
      for (let q = 0; q < 32; q++) {
        const quote = quoteFrom(r, cps);
        cases++;
        const expected = JSON.stringify(rcLocate(quote));
        const got = [JSON.stringify(locate(quote)), JSON.stringify(NEW.locateQuote(source, quote))];
        const contains = NEW.containsQuoteOnWordBoundaries(source, quote) === RC.containsQuoteOnWordBoundaries(source, quote);
        if (got[0] !== expected || got[1] !== expected || !contains) {
          if (failures.length < 5) failures.push(JSON.stringify({ source, quote, expected, got, contains }));
        }
      }
    }
    expect(failures).toEqual([]);
    expect(cases).toBe(48000);
  });

  it("agrees on the release-candidate quote fixes (compound words, dashes, negation, contractions)", () => {
    const pairs: Array<[string, string]> = [
      ["The parent was non-violent at the visit.", "violent at the visit"],
      ["The parent was non‐violent at the visit.", "violent at the visit"],
      ["The parent was calm — violent behaviour was not seen.", "violent behaviour was not seen"],
      ["The finding: Not guilty of the allegation.", "guilty of the allegation"],
      ["No evidence of neglect. There was evidence of neglect elsewhere.", "evidence of neglect"],
      ["The mother said she can't attend.", "she can"],
      ["The mother said she can＇t attend.", "she can"],
      ["It is un\u00ADtrue that he struck the child.", "true that he struck the child"],
      ["Line 1-Child was seen.", "Child was seen"],
      ["Visit \u{1F600} rest was calm.", "\uDE00 rest was calm"],
      ["Café — CAFÉ non- — CAFÉ visit", "CAFÉ visit"],
      ["[Page 3]\nThe worker WROTE that the child — was fed.", "the worker wrote that the child - was fed"],
    ];
    for (const [source, quote] of pairs) expect(NEW.locateQuote(source, quote)).toEqual(RC.locateQuote(source, quote));
  });

  it("a 200-page document: identical results for 60 random quotations", () => {
    const lines: string[] = [];
    for (let p = 1; p <= 200; p++) {
      lines.push(`[Page ${p}]`);
      for (let l = 0; l < 40; l++) lines.push(`${p}.${l} Observation ${p * 100 + l} non-violent — not seen at access visits.`);
    }
    const text = lines.join("\n");
    const cps = Array.from(text);
    const r = rng(11);
    const locate = NEW.createQuoteLocator(text);
    const rc = RC.createQuoteLocator(text);
    for (let i = 0; i < 60; i++) {
      const a = Math.floor(r() * cps.length);
      const quote = cps.slice(a, a + 20 + Math.floor(r() * 60)).join("");
      expect(locate(quote)).toEqual(rc(quote));
    }
  });
});
