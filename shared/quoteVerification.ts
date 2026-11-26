/**
 * Quotation location and display rules for analyzer reports. Pure, so the server and the UI use the same definitions.
 *
 * Match types, strictest first:
 *   EXACT                       the quoted text appears once, character for character.
 *   NORMALIZED_WHITESPACE       appears once after collapsing runs of whitespace (line breaks, extra spaces, NBSP).
 *   CASE_OR_PUNCTUATION_VARIANT appears once after ignoring capitalisation and typographic punctuation (curly quotes,
 *                               dashes). The words are present, but the quoted wording is not the document's wording.
 *   AMBIGUOUS                   appears in more than one place, so the location cannot be fixed. Never a word-for-word match.
 *   ABSENT                      not found at all.
 *
 * Only EXACT and NORMALIZED_WHITESPACE count as "verified": the quoted words are in the document. Everything else
 * is shown as a qualified match, and nothing says "word-for-word" unless the match is EXACT.
 */
import { trimCharacters } from "./linearText";

export const QUOTE_MATCH_STATUSES = [
  "EXACT",
  "NORMALIZED_WHITESPACE",
  "CASE_OR_PUNCTUATION_VARIANT",
  "AMBIGUOUS",
  "ABSENT",
] as const;
export type QuoteMatchStatus = (typeof QUOTE_MATCH_STATUSES)[number];

/** Status shown for a stored flag that predates match types. Never word-for-word. */
export const UNRECORDED_MATCH = "UNRECORDED_MATCH";
export const NOT_CHECKED = "NOT_CHECKED";
export type DisplayQuoteStatus = QuoteMatchStatus | typeof UNRECORDED_MATCH | typeof NOT_CHECKED;

export interface QuoteLocation {
  status: QuoteMatchStatus;
  /** Page of the match when the source carries "[Page N]" markers (PDF text); otherwise null. */
  page: number | null;
  /** Code-point offsets in the source text, end exclusive. Null when the match is not unique or absent. */
  startOffset: number | null;
  endOffset: number | null;
}

const SPACE = /\s/u;
// Characters dropped before comparison: soft hyphens and zero-width marks, which OCR and copy-paste add.
const DROPPED = new Set(["­", "​", "‌", "‍", "﻿"]);
const PUNCTUATION_MAP: Record<string, string> = {
  "‘": "'", "’": "'", "‚": "'", "‛": "'",
  "“": '"', "”": '"', "„": '"', "‟": '"',
  "–": "-", "—": "-",
};

interface Canonical {
  chars: string[];
  starts: number[];
  ends: number[];
}

/**
 * Canonical form with a source map. Each element is one code point; starts/ends map it back to the original text.
 * "whitespace" collapses runs of whitespace to one space. "variant" also lowercases and maps punctuation.
 */
function canonicalize(input: string, mode: "whitespace" | "variant"): Canonical {
  const chars: string[] = [];
  const starts: number[] = [];
  const ends: number[] = [];
  const codePoints = Array.from(input);
  for (let k = 0; k < codePoints.length; k++) {
    const c = codePoints[k];
    const code = c.charCodeAt(0);
    // ASCII fast path: in ASCII, \s is exactly tab, line feed, vertical tab, form feed, carriage return and space.
    const isSpace = code < 128 ? code === 32 || (code >= 9 && code <= 13) : SPACE.test(c);
    if (isSpace) {
      if (chars.length > 0 && chars[chars.length - 1] === " ") {
        ends[ends.length - 1] = k + 1;
      } else {
        chars.push(" ");
        starts.push(k);
        ends.push(k + 1);
      }
      continue;
    }
    if (mode === "variant") {
      if (code < 128) {
        // No ASCII character is dropped or mapped; only capitals change.
        chars.push(code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : c);
        starts.push(k);
        ends.push(k + 1);
        continue;
      }
      if (DROPPED.has(c)) continue;
      const mapped = PUNCTUATION_MAP[c] ?? c.toLowerCase();
      // Only single code points are kept, so every element maps to exactly one source position.
      const out = Array.from(mapped).length === 1 ? mapped : c;
      chars.push(out);
    } else {
      chars.push(c);
    }
    starts.push(k);
    ends.push(k + 1);
  }
  // Trim the leading and trailing space so a quote and its source compare on content only.
  while (chars.length > 0 && chars[0] === " ") {
    chars.shift();
    starts.shift();
    ends.shift();
  }
  while (chars.length > 0 && chars[chars.length - 1] === " ") {
    chars.pop();
    starts.pop();
    ends.pop();
  }
  return { chars, starts, ends };
}

const WORD_CHAR = /[\p{L}\p{N}]/u;

/**
 * Start indices (in elements) of every occurrence, counting overlaps. Stops at 2: more than one is already ambiguous.
 * A match must not start or end inside a word: "true that he struck" is not a quotation of "untrue that he struck".
 */
function occurrences(haystack: string[], needle: string[], joinedHaystack?: string): number[] {
  if (needle.length === 0) return [];
  const h = joinedHaystack ?? haystack.join("");
  const n = needle.join("");
  const boundedStart = WORD_CHAR.test(needle[0]);
  const boundedEnd = WORD_CHAR.test(needle[needle.length - 1]);
  const hits: number[] = [];
  let index = 0;
  let scanned = 0;
  let at = h.indexOf(n);
  while (at >= 0 && hits.length < 2) {
    index += Array.from(h.slice(scanned, at)).length;
    scanned = at;
    const before = haystack[index - 1];
    const after = haystack[index + needle.length];
    const cutsWordStart = boundedStart && before !== undefined && WORD_CHAR.test(before);
    // "can" followed by "'t" is the start of "can't": cutting there drops the negation.
    const cutsContraction = (after === "'" || after === "\u2019") && /^t$/i.test(haystack[index + needle.length + 1] ?? "") &&
      !WORD_CHAR.test(haystack[index + needle.length + 2] ?? "");
    const cutsWordEnd = boundedEnd && after !== undefined && (WORD_CHAR.test(after) || cutsContraction);
    if (!cutsWordStart && !cutsWordEnd) hits.push(index);
    at = h.indexOf(n, at + 1);
  }
  return hits;
}

/** Whether the quote occurs at least once on word boundaries, after collapsing whitespace. Uniqueness is not required. */
export function containsQuoteOnWordBoundaries(source: string, quote: string): boolean {
  const s = canonicalize(source || "", "whitespace").chars;
  const q = canonicalize(quote || "", "whitespace").chars;
  return occurrences(s, q).length > 0;
}

/** Strips quotation marks wrapped around the whole quote, then trims. */
function unwrapQuote(quote: string): string {
  // Same result as .replace(/^["'“‘]+|["'”’]+$/g, ""), whose trailing alternative was retried from every position
  // of a long run of quotation marks inside the quote.
  const unquoted = trimCharacters(trimCharacters((quote || "").trim(), "\"'“‘", { start: true }), "\"'”’", { end: true });
  return unquoted.trim();
}

/** The "[Page N]" marker that most recently precedes a code-point offset, or null when there is none. */
export function pageAtOffset(source: string, codePointOffset: number): number | null {
  const utf16 = Array.from(source).slice(0, codePointOffset).join("").length;
  const head = source.slice(0, utf16);
  let page: number | null = null;
  for (const m of head.matchAll(/\[Page (\d+)\]/g)) page = Number(m[1]);
  return page;
}

/**
 * The source with "[Page N]" markers removed, and the original code-point index of each remaining character. A
 * quotation that runs across a page break has no marker inside it, so it can only be matched on this text.
 */
function withoutPageMarkers(source: string): { body: string; originalIndex: number[] } {
  const cps = Array.from(source);
  const kept: string[] = [];
  const originalIndex: number[] = [];
  for (let k = 0; k < cps.length; ) {
    if (cps[k] === "[") {
      const marker = cps.slice(k, k + 20).join("").match(/^\[Page \d+\]/);
      if (marker) {
        k += Array.from(marker[0]).length;
        continue;
      }
    }
    kept.push(cps[k]);
    originalIndex.push(k);
    k++;
  }
  return { body: kept.join(""), originalIndex };
}

/** End offset (in code points) and number of every "[Page N]" marker, in document order. */
function pageMarkerEnds(source: string): { ends: number[]; pages: number[] } {
  const ends: number[] = [];
  const pages: number[] = [];
  let utf16 = 0;
  let codePoints = 0;
  for (const m of source.matchAll(/\[Page (\d+)\]/g)) {
    const matchEnd = (m.index ?? 0) + m[0].length;
    codePoints += Array.from(source.slice(utf16, matchEnd)).length;
    utf16 = matchEnd;
    ends.push(codePoints);
    pages.push(Number(m[1]));
  }
  return { ends, pages };
}

/**
 * Prepares a source document once and returns a function that locates quotations in it. Same result as calling
 * locateQuote(source, quote) for each quote, but the document is canonicalized once instead of once per quote, which
 * keeps report guards linear in document size (a 25-finding report on a 200-page document re-scanned it 25 times).
 * Holds no state outside the returned closure.
 */
export function createQuoteLocator(source: string): (quote: string) => QuoteLocation {
  const absent: QuoteLocation = { status: "ABSENT", page: null, startOffset: null, endOffset: null };
  const ambiguous: QuoteLocation = { status: "AMBIGUOUS", page: null, startOffset: null, endOffset: null };
  if (!source || !source.trim()) return () => ({ ...absent });
  // Nothing is prepared until the first quote arrives: a report with no quotes costs no memory or CPU here.
  let prepared: { body: string; originalIndex: number[]; bodyCp: string[] } | null | undefined;
  const prepare = () => {
    if (prepared === undefined) {
      const { body, originalIndex } = withoutPageMarkers(source);
      prepared = body.trim() ? { body, originalIndex, bodyCp: Array.from(body) } : null;
    }
    return prepared;
  };
  let ws: (Canonical & { joined: string }) | undefined;
  let vs: (Canonical & { joined: string }) | undefined;
  let markers: { ends: number[]; pages: number[] } | undefined;
  const pageAt = (codePointOffset: number): number | null => {
    markers ??= pageMarkerEnds(source);
    let lo = 0;
    let hi = markers.ends.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (markers.ends[mid] <= codePointOffset) lo = mid + 1;
      else hi = mid;
    }
    return lo === 0 ? null : markers.pages[lo - 1];
  };
  // Offsets in the matching text are mapped back to the original source, so the page and span refer to the document.
  const found = (status: QuoteMatchStatus, start: number, end: number): QuoteLocation => {
    const { originalIndex } = prepared as { originalIndex: number[] };
    const from = originalIndex[start];
    const to = originalIndex[end - 1] + 1;
    return { status, page: pageAt(from), startOffset: from, endOffset: to };
  };

  return (quote: string): QuoteLocation => {
    const q = withoutPageMarkers(unwrapQuote(quote)).body.trim();
    if (!q) return { ...absent };
    const doc = prepare();
    if (!doc) return { ...absent };
    const { body, bodyCp } = doc;
    const quoteCp = Array.from(q);

    const exact = occurrences(bodyCp, quoteCp, body);
    if (exact.length === 1) return found("EXACT", exact[0], exact[0] + quoteCp.length);
    if (exact.length > 1) return { ...ambiguous };

    if (!ws) {
      const c = canonicalize(body, "whitespace");
      ws = { ...c, joined: c.chars.join("") };
    }
    const wq = canonicalize(q, "whitespace");
    const wsHits = occurrences(ws.chars, wq.chars, ws.joined);
    if (wsHits.length === 1) {
      const h = wsHits[0];
      return found("NORMALIZED_WHITESPACE", ws.starts[h], ws.ends[h + wq.chars.length - 1]);
    }
    if (wsHits.length > 1) return { ...ambiguous };

    if (!vs) {
      const c = canonicalize(body, "variant");
      vs = { ...c, joined: c.chars.join("") };
    }
    const vq = canonicalize(q, "variant");
    const vHits = occurrences(vs.chars, vq.chars, vs.joined);
    if (vHits.length === 1) {
      const h = vHits[0];
      return found("CASE_OR_PUNCTUATION_VARIANT", vs.starts[h], vs.ends[h + vq.chars.length - 1]);
    }
    if (vHits.length > 1) return { ...ambiguous };
    return { ...absent };
  };
}

/** Locates a quotation in the source text and reports the strictest match type that applies. */
export function locateQuote(source: string, quote: string): QuoteLocation {
  // An empty quote is absent without preparing the source.
  if (!withoutPageMarkers(unwrapQuote(quote)).body.trim()) {
    return { status: "ABSENT", page: null, startOffset: null, endOffset: null };
  }
  return createQuoteLocator(source)(quote);
}

export function isVerbatimQuoteStatus(status: string): boolean {
  return status === "EXACT" || status === "NORMALIZED_WHITESPACE";
}

/** The highest severity a red flag may keep, given how its quotation was located. Model severity is kept elsewhere. */
export const SEVERITY_LEVELS = ["Affects Evidentiary Weight", "Worth Raising With Counsel", "CRITICAL"] as const;
export function severityCeiling(status: DisplayQuoteStatus): (typeof SEVERITY_LEVELS)[number] {
  switch (status) {
    case "EXACT":
    case "NORMALIZED_WHITESPACE":
      return "CRITICAL";
    case "CASE_OR_PUNCTUATION_VARIANT":
    case "AMBIGUOUS":
    case UNRECORDED_MATCH:
      return "Worth Raising With Counsel";
    default:
      // ABSENT and NOT_CHECKED: the quoted passage cannot be shown, so the point is an unverified allegation.
      return "Affects Evidentiary Weight";
  }
}

/** Short status for a red flag: states what the search established, nothing more. */
export const VERIFICATION_STATUS: Record<QuoteMatchStatus, string> = {
  EXACT: "LOCATED_EXACT",
  NORMALIZED_WHITESPACE: "LOCATED_SPACING_DIFFERS",
  CASE_OR_PUNCTUATION_VARIANT: "LOCATED_WORDING_DIFFERS",
  AMBIGUOUS: "LOCATED_MULTIPLE_PLACES",
  ABSENT: "NOT_LOCATED",
};

/** The quote status to display for a stored flag. Maps legacy values; never upgrades a stored result. */
export function effectiveQuoteStatus(flag: { quoteVerification?: unknown; quoteVerified?: unknown } | null | undefined): DisplayQuoteStatus {
  const q = flag?.quoteVerification;
  if (q === "NORMALIZED_PUNCTUATION") return "CASE_OR_PUNCTUATION_VARIANT";
  if (typeof q === "string" && (QUOTE_MATCH_STATUSES as readonly string[]).includes(q)) return q as QuoteMatchStatus;
  if (flag?.quoteVerified === true) return UNRECORDED_MATCH;
  if (flag?.quoteVerified === false) return "ABSENT";
  return NOT_CHECKED;
}

/** Display wording for each quote status. `wordForWord` is true only for EXACT, the only status that may say so. */
export const QUOTE_DISPLAY: Record<DisplayQuoteStatus, { label: string; wordForWord: boolean; verified: boolean }> = {
  EXACT: { label: "Found word-for-word in the document.", wordForWord: true, verified: true },
  NORMALIZED_WHITESPACE: {
    label: "Found in the document. Line breaks or spacing differ from the quoted text, but the words match.",
    wordForWord: false,
    verified: true,
  },
  CASE_OR_PUNCTUATION_VARIANT: {
    label: "Close match only. The document has these words, but capitalisation or punctuation differs. Check the wording against the original.",
    wordForWord: false,
    verified: false,
  },
  AMBIGUOUS: {
    label: "Appears in more than one place in the document, so the exact location is not certain. Check the wording against the original.",
    wordForWord: false,
    verified: false,
  },
  ABSENT: {
    label: "Not found in the document. Treat this as an unverified allegation until the passage is located.",
    wordForWord: false,
    verified: false,
  },
  UNRECORDED_MATCH: {
    label: "Found in the document. The type of match was not recorded for this report, so check the wording.",
    wordForWord: false,
    verified: true,
  },
  NOT_CHECKED: {
    label: "The quoted wording has not been checked against the document.",
    wordForWord: false,
    verified: false,
  },
};
