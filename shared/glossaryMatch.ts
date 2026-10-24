/**
 * Whether a glossary trigger appears in the text as a whole term, or with a common inflection
 * ("apprehend" matches "apprehended", "300-day" matches "300-days"). A trigger must not run into
 * a letter or digit on either side, so "onus" does not match "bonus" and "s.74" does not match
 * "s.740". The check uses no lookbehind, which older browsers lack.
 */
const INFLECTION = /^(?:s|es|ed|ing)?/;
const WORD_CHARACTER = /[\p{L}\p{N}\p{M}]/u;

export function containsTrigger(text: string, trigger: string): boolean {
  const haystack = text.toLowerCase();
  const needle = trigger.toLowerCase();
  if (!needle) return false;
  let from = 0;
  for (let at = haystack.indexOf(needle, from); at !== -1; at = haystack.indexOf(needle, from)) {
    const before = at > 0 ? haystack.charAt(at - 1) : "";
    const rest = haystack.slice(at + needle.length);
    const suffix = INFLECTION.exec(rest)?.[0] ?? "";
    const after = rest.charAt(suffix.length);
    const wholeStart = before === "" || !WORD_CHARACTER.test(before);
    // A dot followed by a digit continues a decimal section number ("s.74.1" is not "s.74").
    const decimal = after === "." && /\d/.test(rest.charAt(suffix.length + 1));
    const wholeEnd = (after === "" || !WORD_CHARACTER.test(after)) && !decimal;
    if (wholeStart && wholeEnd) return true;
    from = at + 1;
  }
  return false;
}
