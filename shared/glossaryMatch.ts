/**
 * Whether a glossary trigger appears in the text as a whole term. Plain substring matching let
 * "onus" match inside "bonus" and "s.74" match inside "s.740", so a trigger must not run into
 * a letter or digit on either side.
 */
export function containsTrigger(text: string, trigger: string): boolean {
  const escaped = trigger.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(?<![a-z0-9])${escaped}(?![a-z0-9])`).test(text.toLowerCase());
}
