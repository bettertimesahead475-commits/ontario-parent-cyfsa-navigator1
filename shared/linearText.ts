/**
 * Linear-time replacements for regular expressions that backtracked super-linearly (SonarCloud
 * typescript:S8786 / ReDoS). Each helper documents the exact regular expression whose result it
 * reproduces; api/services/linearText.test.ts pins that equivalence against the original patterns.
 *
 * Every helper here does a bounded number of passes over its input, so the time taken is
 * proportional to the input length whatever the input contains.
 */

const WHITESPACE = /\s/;

/** True for exactly the characters matched by the regular-expression class `\s` (the same set String.prototype.trim removes). */
export function isRegexWhitespace(ch: string): boolean {
  return WHITESPACE.test(ch);
}

/**
 * Accepts exactly the strings /^[^\s@]+@[^\s@]+\.[^\s@]+$/ accepted: a local part, "@", and a domain with a dot
 * that is neither its first nor its last character. In the original the domain's [^\s@]+ could also match the
 * dot, so a long dotted domain followed by a space backtracked quadratically; here the part before the first
 * qualifying dot cannot contain a dot (only its first character may be one), so each character is tried once.
 */
export const SIMPLE_EMAIL_SHAPE = /^[^\s@]+@[^\s@][^\s@.]*\.[^\s@]+$/;

const FENCE = "```";

export interface FencedBlockOptions {
  /** Match the optional `json` language tag case-insensitively (the original pattern had the `i` flag). */
  ignoreCase?: boolean;
  /** Drop whitespace between the block content and the closing fence (the original pattern ended `\s*```). */
  trimTrailingWhitespace?: boolean;
  /** A missing closing fence ends the block at the end of the text (the original pattern ended (?:```|$)). */
  allowUnterminated?: boolean;
}

/**
 * Content of the first ```-fenced block, or null when there is none. Reproduces capture group 1 of:
 * - default:                        /```(?:json)?\s*([\s\S]*?)```/
 * - trimTrailingWhitespace:         /```(?:json)?\s*([\s\S]*?)\s*```/
 * - ignoreCase:                     the same patterns with the `i` flag
 * - allowUnterminated:              /```(?:json)?\s*([\s\S]*?)(?:```|$)/
 * Those patterns backtrack polynomially when an opening fence is followed by a long run of whitespace
 * and no closing fence.
 */
export function extractFencedBlock(text: string, options: FencedBlockOptions = {}): string | null {
  const open = text.indexOf(FENCE);
  if (open < 0) return null;
  let start = open + FENCE.length;
  const tag = text.slice(start, start + 4);
  if (options.ignoreCase ? /^json$/i.test(tag) : tag === "json") start += 4;
  while (start < text.length && isRegexWhitespace(text[start])) start++;
  // Nothing between the opening fence and `start` is a backtick, so searching from `start` finds the
  // same closing fence as searching from the end of the opening fence.
  let close = text.indexOf(FENCE, start);
  if (close < 0) {
    // No later fence means no later opening fence can have a closing fence either.
    if (!options.allowUnterminated) return null;
    close = text.length;
  }
  let end = close;
  if (options.trimTrailingWhitespace) {
    while (end > start && isRegexWhitespace(text[end - 1])) end--;
  }
  return text.slice(start, end);
}

/**
 * Same result as `text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, "")`: removes a leading code fence
 * (with optional `json` tag) and a trailing code fence, each with their surrounding whitespace.
 */
export function stripJsonCodeFence(text: string): string {
  let start = 0;
  let lead = 0;
  while (lead < text.length && isRegexWhitespace(text[lead])) lead++;
  if (text.startsWith(FENCE, lead)) {
    start = lead + FENCE.length;
    if (text.startsWith("json", start)) start += 4;
    while (start < text.length && isRegexWhitespace(text[start])) start++;
  }
  // A trailing fence is only removed when it lies wholly after the leading one.
  let end = text.length;
  while (end > start && isRegexWhitespace(text[end - 1])) end--;
  if (end - FENCE.length >= start && text.startsWith(FENCE, end - FENCE.length)) {
    end -= FENCE.length;
    while (end > start && isRegexWhitespace(text[end - 1])) end--;
    return text.slice(start, end);
  }
  return text.slice(start);
}

/** Removes leading and trailing characters found in `chars` (each a single UTF-16 code unit). */
export function trimCharacters(text: string, chars: string, sides: { start?: boolean; end?: boolean } = { start: true, end: true }): string {
  let start = 0;
  let end = text.length;
  if (sides.start) while (start < end && chars.includes(text[start])) start++;
  if (sides.end) while (end > start && chars.includes(text[end - 1])) end--;
  return text.slice(start, end);
}

/** Same result as `text.replace(/[ \t]+\n/g, "\n")`: drops spaces and tabs that end a line. */
export function stripSpacesBeforeNewlines(text: string): string {
  const lines = text.split("\n");
  for (let i = 0; i < lines.length - 1; i++) lines[i] = trimCharacters(lines[i], " \t", { end: true });
  return lines.join("\n");
}

/**
 * Same result as `text.replace(/<[^>]*>/g, replacement)` for a replacement without `$` patterns
 * (it is inserted literally). The pattern rescans to the end of the text from every `<` that has no
 * later `>`.
 */
export function replaceAngleTags(text: string, replacement: string): string {
  let out = "";
  let pos = 0;
  for (;;) {
    const lt = text.indexOf("<", pos);
    if (lt < 0) break;
    const gt = text.indexOf(">", lt + 1);
    if (gt < 0) break; // no `<` from here on can be closed
    out += text.slice(pos, lt) + replacement;
    pos = gt + 1;
  }
  return out + text.slice(pos);
}

const isAsciiLetter = (c: number) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122);
const isAsciiDigit = (c: number) => c >= 48 && c <= 57;
// [A-Za-z0-9._%+-]
const isEmailLocalChar = (c: number) =>
  isAsciiLetter(c) || isAsciiDigit(c) || c === 46 || c === 95 || c === 37 || c === 43 || c === 45;
// [A-Za-z0-9.-]
const isEmailDomainChar = (c: number) => isAsciiLetter(c) || isAsciiDigit(c) || c === 46 || c === 45;

/** End of `[A-Za-z0-9.-]+\.[A-Za-z]{2,}` matched greedily at `from`, or -1. */
function emailDomainEnd(text: string, from: number): number {
  let runEnd = from;
  while (runEnd < text.length && isEmailDomainChar(text.charCodeAt(runEnd))) runEnd++;
  // The greedy domain gives characters back until it is followed by "." and two letters: the last such dot wins.
  for (let dot = runEnd - 3; dot > from; dot--) {
    if (text.charCodeAt(dot) === 46 && isAsciiLetter(text.charCodeAt(dot + 1)) && isAsciiLetter(text.charCodeAt(dot + 2))) {
      let end = dot + 3;
      while (end < text.length && isAsciiLetter(text.charCodeAt(end))) end++;
      return end;
    }
  }
  return -1;
}

/**
 * Same result as `text.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, replacement)` for a
 * replacement without `$` patterns (it is inserted literally). The pattern retries its leading
 * `[...]+` from every position of a long run of address characters, which is quadratic.
 */
export function replaceEmailAddresses(text: string, replacement: string): string {
  let out = "";
  let copied = 0;
  let resumeAt = 0; // where the global regex would resume (lastIndex)
  let at = text.indexOf("@");
  while (at >= 0) {
    let start = at;
    while (start > resumeAt && isEmailLocalChar(text.charCodeAt(start - 1))) start--;
    const end = start < at ? emailDomainEnd(text, at + 1) : -1;
    if (end >= 0) {
      out += text.slice(copied, start) + replacement;
      copied = resumeAt = end;
      at = text.indexOf("@", end);
    } else {
      at = text.indexOf("@", at + 1);
    }
  }
  return out + text.slice(copied);
}
