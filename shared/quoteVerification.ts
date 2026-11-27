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

/**
 * Canonical form with a source map, stored compactly: `text` is the canonical string and, for every UTF-16 unit of it,
 * `starts`/`ends` give the code-point span in the input that the unit's code point came from (both units of an astral
 * code point carry the same span). "whitespace" collapses runs of whitespace to one space. "variant" also lowercases
 * and maps punctuation. Typed arrays keep a 200-page document's maps at 8 bytes per character instead of three
 * pointer arrays plus a per-character string array.
 */
interface Canonical {
  text: string;
  starts: Int32Array;
  ends: Int32Array;
}

function unitsToString(units: Uint16Array, from: number, to: number): string {
  // String.fromCharCode keeps lone surrogates exactly; TextDecoder would replace them.
  const parts: string[] = [];
  for (let i = from; i < to; i += 8192) parts.push(String.fromCharCode.apply(null, units.subarray(i, Math.min(i + 8192, to)) as unknown as number[]));
  return parts.join("");
}

function canonicalize(input: string, mode: "whitespace" | "variant"): Canonical {
  let cap = Math.max(16, input.length);
  let units = new Uint16Array(cap);
  let starts = new Int32Array(cap);
  let ends = new Int32Array(cap);
  let len = 0;
  const push = (out: string, k: number) => {
    if (len + out.length > cap) {
      cap = cap * 2 + out.length;
      const u = new Uint16Array(cap); u.set(units.subarray(0, len)); units = u;
      const st = new Int32Array(cap); st.set(starts.subarray(0, len)); starts = st;
      const en = new Int32Array(cap); en.set(ends.subarray(0, len)); ends = en;
    }
    for (let j = 0; j < out.length; j++) {
      units[len] = out.charCodeAt(j);
      starts[len] = k;
      ends[len] = k + 1;
      len++;
    }
  };
  let k = 0;
  for (const c of input) {
    const code = c.charCodeAt(0);
    // ASCII fast path: in ASCII, \s is exactly tab, line feed, vertical tab, form feed, carriage return and space.
    const isSpace = code < 128 ? code === 32 || (code >= 9 && code <= 13) : SPACE.test(c);
    if (isSpace) {
      // The last unit is a space only when the last element is a collapsed space (an astral element ends in a surrogate).
      if (len > 0 && units[len - 1] === 32) ends[len - 1] = k + 1;
      else push(" ", k);
    } else if (mode === "variant") {
      if (code < 128) {
        // No ASCII character is dropped or mapped; only capitals change.
        push(code >= 65 && code <= 90 ? String.fromCharCode(code + 32) : c, k);
      } else if (!DROPPED.has(c)) {
        const mapped = PUNCTUATION_MAP[c] ?? c.toLowerCase();
        // Only single code points are kept, so every element maps to exactly one source position.
        push(Array.from(mapped).length === 1 ? mapped : c, k);
      }
    } else {
      push(c, k);
    }
    k++;
  }
  // Trim the leading and trailing space so a quote and its source compare on content only.
  let from = 0;
  let to = len;
  while (from < to && units[from] === 32) from++;
  while (to > from && units[to - 1] === 32) to--;
  return { text: unitsToString(units, from, to), starts: starts.subarray(from, to), ends: ends.subarray(from, to) };
}

// Combining marks continue a word ("cafe\u0301"), and soft hyphens and zero-width marks (DROPPED) are skipped when
// reading a match's neighbours, so "un\u00ADtrue" is one word and "can't\u200B" still ends a contraction (DEVIN-P2-01b).
const WORD_CHAR = /[\p{L}\p{N}\p{M}]/u;
const APOSTROPHE = /^['\u2018\u2019\u201B\u02BC\uFF07]$/u;
const HYPHEN = /^[-\u2010\u2011]$/u;
const LETTER = /[\p{L}\p{M}]/u;
/** Words whose omission inverts the meaning of the words that follow them. */
const NEGATORS = new Set(["not", "no", "nor", "never", "without", "non"]);

// Positions below are UTF-16 indices of code-point starts; -1 is "before the text" and >= length is "after it".

/** The code point starting at UTF-16 index `i`, or undefined outside the text. */
function codePointAtIndex(h: string, i: number): string | undefined {
  if (i < 0 || i >= h.length) return undefined;
  return String.fromCodePoint(h.codePointAt(i) as number);
}

/** Start of the code point that ends at UTF-16 index `i`, or -1 at the start. */
function previousStart(h: string, i: number): number {
  if (i <= 0) return -1;
  const lo = h.charCodeAt(i - 1);
  if (lo >= 0xdc00 && lo <= 0xdfff && i >= 2) {
    const hi = h.charCodeAt(i - 2);
    if (hi >= 0xd800 && hi <= 0xdbff) return i - 2;
  }
  return i - 1;
}

/** Start of the code point after the one at `i`. */
function nextStart(h: string, i: number): number {
  if (i < 0) return 0;
  if (i >= h.length) return i + 1;
  const c = h.codePointAt(i) as number;
  return i + (c > 0xffff ? 2 : 1);
}

/** First position from i, moving by step, that is not a soft hyphen or zero-width mark (all single UTF-16 units). */
function skipDropped(h: string, i: number, step: 1 | -1): number {
  while (i >= 0 && i < h.length && DROPPED.has(h[i])) i = step === 1 ? i + 1 : previousStart(h, i);
  return i;
}

function splitsSurrogatePair(h: string, i: number): boolean {
  if (i <= 0 || i >= h.length) return false;
  const hi = h.charCodeAt(i - 1);
  const lo = h.charCodeAt(i);
  return hi >= 0xd800 && hi <= 0xdbff && lo >= 0xdc00 && lo <= 0xdfff;
}

/**
 * The whole word immediately before position i (scanning back over spaces and hyphens, lowercased), or "" when there
 * is none. Used to see whether a quotation starts right after a negating word.
 */
function precedingWord(h: string, i: number, sourceChar?: (i: number) => string | undefined): string {
  // Only a real hyphen (in the source text) continues a negated word. An em dash mapped to "-" for variant matching is
  // a separator, not a hyphen: "non- — CAFÉ" must not make "CAFÉ" the object of "non".
  const realHyphen = (k: number) => HYPHEN.test(sourceChar ? sourceChar(k) ?? "" : codePointAtIndex(h, k) ?? "");
  let j = i;
  while (j >= 0 && (/\s/u.test(codePointAtIndex(h, j) ?? "") || realHyphen(j))) j = previousStart(h, j);
  const end = j;
  while (j >= 0 && LETTER.test(codePointAtIndex(h, j) ?? "")) j = previousStart(h, j);
  if (end < 0 || end === j) return "";
  return h.slice(nextStart(h, j), nextStart(h, end)).toLowerCase();
}

/**
 * UTF-16 start indices of every occurrence of n in h, counting overlaps. Stops at 2: more than one is already
 * ambiguous. A match must not start or end inside a word, a hyphenated compound or a surrogate pair, and must not cut a
 * contraction: "true that he struck" is not a quotation of "untrue that he struck" (DEVIN-P2-01). sourceChar returns
 * the source character behind a position when h is a variant form (dashes mapped to "-").
 */
function occurrences(h: string, n: string, sourceChar?: (i: number) => string | undefined): number[] {
  if (n.length === 0) return [];
  const first = codePointAtIndex(n, skipDropped(n, 0, 1)) ?? "";
  const last = codePointAtIndex(n, skipDropped(n, previousStart(n, n.length), -1)) ?? "";
  const boundedStart = WORD_CHAR.test(first);
  const boundedEnd = WORD_CHAR.test(last);
  const startsWithLetter = LETTER.test(first);
  const endsWithLetter = LETTER.test(last);
  const hits: number[] = [];
  let negatedOccurrence = false;
  let at = h.indexOf(n);
  while (at >= 0 && hits.length < 2) {
    const beforeAt = skipDropped(h, previousStart(h, at), -1);
    const before = codePointAtIndex(h, beforeAt);
    const afterAt = skipDropped(h, at + n.length, 1);
    const after = codePointAtIndex(h, afterAt);
    const tAt = skipDropped(h, nextStart(h, afterAt), 1);
    // A hyphen between two letters joins one compound word: "violent" is not a quotation of "non-violent".
    // Only a real hyphen between letters joins a compound: a dash mapped to "-" for variant matching, or a list
    // separator such as "1-Child", still ends a word.
    const cutsCompoundStart = startsWithLetter && HYPHEN.test(sourceChar ? sourceChar(beforeAt) ?? "" : before ?? "") &&
      LETTER.test(codePointAtIndex(h, skipDropped(h, previousStart(h, beforeAt), -1)) ?? "");
    const cutsCompoundEnd = endsWithLetter && HYPHEN.test(sourceChar ? sourceChar(afterAt) ?? "" : after ?? "") &&
      LETTER.test(codePointAtIndex(h, tAt) ?? "");
    const cutsWordStart = boundedStart && before !== undefined && (WORD_CHAR.test(before) || cutsCompoundStart);
    // "can" followed by "'t" is the start of "can't": cutting there drops the negation.
    const cutsContraction = APOSTROPHE.test(after ?? "") && /^t$/i.test(codePointAtIndex(h, tAt) ?? "") &&
      !WORD_CHAR.test(codePointAtIndex(h, skipDropped(h, nextStart(h, tAt), 1)) ?? "");
    const cutsWordEnd = boundedEnd && after !== undefined && (WORD_CHAR.test(after) || cutsContraction || cutsCompoundEnd);
    // A quotation that starts right after a negating word ("Not guilty" -> "guilty", "No evidence" -> "evidence", or
    // "non - violent" split by OCR) drops the negation. It is not a faithful quotation, so the match is not counted;
    // the finding is then reported as not located (unverified), never silently removed.
    const cutsNegation = startsWithLetter && NEGATORS.has(precedingWord(h, beforeAt, sourceChar));
    // Half of an emoji or other astral character is never a quotation of the whole character.
    const splitsCharacter = splitsSurrogatePair(h, at) || splitsSurrogatePair(h, at + n.length);
    if (!cutsWordStart && !cutsWordEnd && !splitsCharacter) {
      // An occurrence that follows a negating word is not a valid match, but it is still an occurrence of the words:
      // see below, where it makes a single valid match ambiguous instead of unique.
      if (cutsNegation) negatedOccurrence = true;
      else hits.push(at);
    }
    at = h.indexOf(n, at + 1);
  }
  // One valid match plus a negated occurrence: the quotation is not located uniquely, so it is ambiguous and cannot verify.
  // A negated occurrence alone is not located at all (no valid hit).
  if (negatedOccurrence && hits.length === 1) hits.push(hits[0]);
  return hits;
}

/** True when the quote occurs in the source on word boundaries, after whitespace is collapsed. Uniqueness is not required. */
export function containsQuoteOnWordBoundaries(source: string, quote: string): boolean {
  const s = canonicalize(source || "", "whitespace").text;
  const q = canonicalize(quote || "", "whitespace").text;
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

// "[Page N]" markers are removed before matching, so a quotation that runs across a page break can still match. A
// marker is at most 20 characters, so N has at most 13 digits; longer runs are ordinary text.
const PAGE_MARKER = /\[Page \d{1,13}\]/g;

function stripPageMarkers(text: string): string {
  return text.replace(PAGE_MARKER, "");
}

/** Sorted UTF-16 indices of the first unit of every astral code point (a valid surrogate pair). */
function astralStarts(text: string): Int32Array {
  const found: number[] = [];
  for (let i = 0; i + 1 < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        found.push(i);
        i++;
      }
    }
  }
  return Int32Array.from(found);
}

/** Number of entries in a sorted array that are <= value (or < value when `strict`). */
function countUpTo(sorted: Int32Array, value: number, strict = false): number {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (strict ? sorted[mid] < value : sorted[mid] <= value) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** The body code point at a code-point offset. The j-th astral code point starts at code point astral[j] - j. */
function bodyCodePointAt(doc: PreparedBody, codePoint: number): string | undefined {
  let lo = 0;
  let hi = doc.astral.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (doc.astral[mid] - mid < codePoint) lo = mid + 1;
    else hi = mid;
  }
  return codePointAtIndex(doc.body, codePoint + lo);
}

/**
 * The source without page markers plus a compact map back to source code-point offsets: removed markers are recorded
 * by the body code-point offset where they stood and the running total of removed characters (markers are ASCII).
 */
interface PreparedBody {
  body: string;
  astral: Int32Array;
  markerAt: Int32Array;
  removedThrough: Int32Array;
}

function prepareBody(source: string): PreparedBody {
  const parts: string[] = [];
  const atUnits: number[] = [];
  const removed: number[] = [];
  let last = 0;
  let bodyUnits = 0;
  let total = 0;
  for (const m of source.matchAll(PAGE_MARKER)) {
    const index = m.index ?? 0;
    parts.push(source.slice(last, index));
    bodyUnits += index - last;
    total += m[0].length;
    atUnits.push(bodyUnits);
    removed.push(total);
    last = index + m[0].length;
  }
  parts.push(source.slice(last));
  const body = parts.join("");
  const astral = astralStarts(body);
  const markerAt = Int32Array.from(atUnits, (u) => u - countUpTo(astral, u, true));
  return { body, astral, markerAt, removedThrough: Int32Array.from(removed) };
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
  let prepared: PreparedBody | null | undefined;
  const prepare = () => {
    if (prepared === undefined) {
      const p = prepareBody(source);
      prepared = p.body.trim() ? p : null;
    }
    return prepared;
  };
  let ws: Canonical | undefined;
  let vs: Canonical | undefined;
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
  // Body code-point offset -> source code-point offset: add every marker removed at or before it.
  const toSource = (doc: PreparedBody, bodyCodePoint: number): number => {
    const j = countUpTo(doc.markerAt, bodyCodePoint);
    return bodyCodePoint + (j === 0 ? 0 : doc.removedThrough[j - 1]);
  };
  // Offsets in the matching text are mapped back to the original source, so the page and span refer to the document.
  const found = (doc: PreparedBody, status: QuoteMatchStatus, start: number, end: number): QuoteLocation => {
    const from = toSource(doc, start);
    const to = toSource(doc, end - 1) + 1;
    return { status, page: pageAt(from), startOffset: from, endOffset: to };
  };

  return (quote: string): QuoteLocation => {
    const q = stripPageMarkers(unwrapQuote(quote)).trim();
    if (!q) return { ...absent };
    const doc = prepare();
    if (!doc) return { ...absent };

    const exact = occurrences(doc.body, q);
    if (exact.length === 1) {
      const start = exact[0] - countUpTo(doc.astral, exact[0], true);
      return found(doc, "EXACT", start, start + Array.from(q).length);
    }
    if (exact.length > 1) return { ...ambiguous };

    ws ??= canonicalize(doc.body, "whitespace");
    const wq = canonicalize(q, "whitespace").text;
    const wsHits = occurrences(ws.text, wq);
    if (wsHits.length === 1) {
      const h = wsHits[0];
      return found(doc, "NORMALIZED_WHITESPACE", ws.starts[h], ws.ends[h + wq.length - 1]);
    }
    if (wsHits.length > 1) return { ...ambiguous };

    const variant = (vs ??= canonicalize(doc.body, "variant"));
    const vq = canonicalize(q, "variant").text;
    // Compound and negation rules read the source character behind a variant position (an em dash is not a hyphen).
    const vHits = occurrences(variant.text, vq, (i) => {
      const cp = variant.starts[i];
      return cp === undefined ? undefined : bodyCodePointAt(doc, cp);
    });
    if (vHits.length === 1) {
      const h = vHits[0];
      return found(doc, "CASE_OR_PUNCTUATION_VARIANT", vs.starts[h], vs.ends[h + vq.length - 1]);
    }
    if (vHits.length > 1) return { ...ambiguous };
    return { ...absent };
  };
}

/** Locates a quotation in the source text and reports the strictest match type that applies. */
export function locateQuote(source: string, quote: string): QuoteLocation {
  // An empty quote is absent without preparing the source.
  if (!stripPageMarkers(unwrapQuote(quote)).trim()) {
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
