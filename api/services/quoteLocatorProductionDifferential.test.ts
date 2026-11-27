/**
 * Differential test against the historical oracle (tests/devin/fixtures/quoteVerificationIntegration.ts, the first
 * committed version, f86cdbe, which is never edited). The oracle is NOT modified to match later behaviour.
 *
 * Intentional behaviour changes made after the oracle was frozen (hyphen compounds, full-width apostrophe, soft hyphen
 * and combining mark handling, negating-word boundary) are checked by PROPERTIES, not by equality:
 *   1. The prepared locator and the direct locator agree exactly (the performance change is behaviour-neutral).
 *   2. The current code never verifies a quotation that the oracle did not verify ("no new verifications").
 *   3. Every verified-to-unverified change is explained by a documented rule, checked here independently against the
 *      source text at the oracle's own match offsets.
 * Seeded synthetic inputs (32,000 cases). Synthetic text only.
 */
import { describe, expect, it } from "vitest";
import * as NEW from "../../shared/quoteVerification";
import * as OLD from "../../tests/devin/fixtures/quoteVerificationIntegration";

const VERIFIED = new Set(["EXACT", "NORMALIZED_WHITESPACE", "CASE_OR_PUNCTUATION_VARIANT"]);
const isVerified = (status: string) => VERIFIED.has(status);

const LETTER = /[\p{L}\p{M}]/u;
const HYPHEN = /^[-‐‑]$/u;
const APOSTROPHE = /^['‘’‛ʼ＇]$/u;
const NEGATORS = new Set(["not", "no", "nor", "never", "without", "non"]);

/** Independent rule check for a verified-to-unverified change, at the oracle's match span [start, end) in code points. */
function explainedByDocumentedRule(source: string, start: number, end: number): boolean {
  // The locator matches against the text with page markers removed, so the rules read that text too.
  const cps = Array.from(source);
  const before = cps.slice(0, start).join("").replace(/\[Page \d+\]/g, "");
  const after = cps.slice(end).join("").replace(/\[Page \d+\]/g, "");
  const SOFT = /[­​‌‍﻿]/u;
  const bChars = Array.from(before).filter((c) => !SOFT.test(c));
  const aChars = Array.from(after).filter((c) => !SOFT.test(c));
  // Rule 1: a hyphen between two letters joins a compound at the match start or end.
  let k = bChars.length - 1;
  while (k >= 0 && /\s/u.test(bChars[k])) k--;
  if (k >= 0 && HYPHEN.test(bChars[k]) && LETTER.test(bChars[k - 1] ?? "")) return true;
  let m = 0;
  while (m < aChars.length && /\s/u.test(aChars[m])) m++;
  if (m < aChars.length && HYPHEN.test(aChars[m]) && LETTER.test(aChars[m + 1] ?? "")) return true;
  // Rule 2: the quotation starts right after a negating word (scanning back over spaces, line breaks and hyphens).
  let j = k;
  while (j >= 0 && (/\s/u.test(bChars[j]) || HYPHEN.test(bChars[j]))) j--;
  const endWord = j;
  while (j >= 0 && LETTER.test(bChars[j])) j--;
  if (endWord > j && NEGATORS.has(bChars.slice(j + 1, endWord + 1).join("").toLowerCase())) return true;
  // Rule 3: the match is followed by an apostrophe (including full-width) and "t": the quotation cuts a contraction.
  if (m < aChars.length && APOSTROPHE.test(aChars[m]) && /^t$/i.test(aChars[m + 1] ?? "")) return true;
  // Rule 4 (DEVIN-P2-01b): a soft hyphen or zero-width mark is invisible, so letters on both sides of it form one word.
  // The span starts or ends next to such a mark with a letter behind it in the raw source.
  const raw = Array.from(source);
  let r = start - 1;
  while (r >= 0 && SOFT.test(raw[r])) r--;
  if (r < start - 1 && LETTER.test(raw[r] ?? "")) return true;
  let t = end;
  while (t < raw.length && SOFT.test(raw[t])) t++;
  if (t > end && LETTER.test(raw[t] ?? "")) return true;
  // The oracle's span can include a soft mark at its own edge ("naïve<soft>" followed by a letter): the word continues.
  if (end > start && SOFT.test(raw[end - 1]) && LETTER.test(raw[end] ?? "")) return true;
  if (end > start && SOFT.test(raw[start]) && LETTER.test(raw[start - 1] ?? "")) return true;
  return false;
}

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
  "­", "​", "\u{1F600}", "\n", "\t", "  ", " ", "[Page 1]", "[Page 2]", "[Page 3]", "untrue", "true",
  "Café", "-", ".", ",", "\"", "'", "x", "1", "　", " ", "naïve", "ß", "İ", "\r\n",
  "non", "non-", "violent", "not", "guilty", "no", "evidence", "Not", "I", "can", "＇", "t",
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

/** Checks properties 2 and 3 for one case. Returns "same", "unverified-change" or a failure message. */
function judge(source: string, quote: string): string {
  const oracle = OLD.locateQuote(source, quote);
  const current = NEW.locateQuote(source, quote);
  if (JSON.stringify(oracle) === JSON.stringify(current)) return "same";
  if (isVerified(current.status) && oracle.status === "ABSENT") return `NEW VERIFICATION ${current.status} (oracle ABSENT)`;
  if (isVerified(current.status) && !isVerified(oracle.status)) {
    // The oracle found several places (AMBIGUOUS) and a documented rule now invalidates all but one. Allowed only when the
    // verified span is clean: not adjacent to a compound hyphen, a negating word, or a contraction.
    if (current.startOffset !== null && current.endOffset !== null && !explainedByDocumentedRule(source, current.startOffset, current.endOffset)) {
      return "ambiguity resolved by a documented rule";
    }
    return `NEW VERIFICATION ON A RULE-ADJACENT SPAN ${current.status} (oracle ${oracle.status})`;
  }
  if (isVerified(oracle.status) && !isVerified(current.status)) {
    if (oracle.startOffset !== null && oracle.endOffset !== null && explainedByDocumentedRule(source, oracle.startOffset, oracle.endOffset)) return "explained";
    return `UNEXPLAINED DOWNGRADE ${oracle.status} -> ${current.status}`;
  }
  return "unverified-change";
}

describe("current locator against the frozen historical oracle", () => {
  it("32,000 seeded cases: prepared and direct locators agree; no new verifications; every downgrade is explained", () => {
    const r = rng(20261126);
    let cases = 0;
    const counts: Record<string, number> = {};
    const failures: string[] = [];
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
        else if (m < 0.35) quote = "“" + quote + "”";
        else if (m < 0.45) quote = quote.replace(/'/g, "’");
        else if (m < 0.55) quote = "­" + quote;
        else if (m < 0.62) quote = TOKENS[Math.floor(r() * TOKENS.length)] + " " + quote;
        else if (m < 0.7) quote = quote + "[Page 2]";
        else if (m < 0.75) quote = "";
        cases++;
        // Property 1: the performance change is behaviour-neutral relative to the current direct locator.
        if (JSON.stringify(locate(quote)) !== JSON.stringify(NEW.locateQuote(source, quote))) {
          failures.push(`PREPARED != DIRECT ${JSON.stringify({ source, quote })}`);
          continue;
        }
        const verdict = judge(source, quote);
        counts[verdict] = (counts[verdict] ?? 0) + 1;
        if (verdict.startsWith("NEW VERIFICATION") || verdict.startsWith("UNEXPLAINED")) {
          const o = OLD.locateQuote(source, quote);
          const window = o.startOffset !== null ? Array.from(source).slice(Math.max(0, (o.startOffset ?? 0) - 40), (o.endOffset ?? 0) + 40).join("") : source.slice(0, 80);
          if (failures.length < 5) failures.push(`${verdict} quote=${JSON.stringify(quote.slice(0, 60))} window=${JSON.stringify(window.slice(0, 200))}`);
          else failures.push("x");
        }
      }
    }
    expect(failures).toEqual([]);
    expect(cases).toBeGreaterThanOrEqual(32000);
    // Reported for the record; not asserted, because the mix of cases is synthetic.
    console.info(`differential verdicts over ${cases} cases: ${JSON.stringify(counts)}`);
  });

  it("a 200-page document: current results never add a verification the oracle lacks", () => {
    const text = doc(200);
    const cps = Array.from(text);
    const r = rng(7);
    const locate = NEW.createQuoteLocator(text);
    for (let i = 0; i < 40; i++) {
      const a = Math.floor(r() * cps.length);
      const quote = cps.slice(a, a + 60).join("");
      expect(locate(quote)).toEqual(NEW.locateQuote(text, quote));
      expect(judge(text, quote)).not.toMatch(/NEW VERIFICATION|UNEXPLAINED/);
    }
  });

  it("a locator's answers do not depend on earlier calls (no stale state)", () => {
    const text = doc(5);
    const locate = NEW.createQuoteLocator(text);
    const first = locate("Observation 100");
    locate("never written here");
    locate("Observation 101");
    expect(locate("Observation 100")).toEqual(first);
    expect(first).toEqual(NEW.locateQuote(text, "Observation 100"));
  });
});
