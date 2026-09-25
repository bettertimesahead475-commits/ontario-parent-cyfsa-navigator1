// Stage 10 slice 7: the ONE canonical recipient-email rule (STAGE_10_COMPLETION_DECISIONS.md §3).
//
// This is a line-for-line mirror of public.navigator_canonical_recipient_email() in
// create_navigator_matter_access_lifecycle_recipient_v4.sql, which is the authority: the database
// canonicalizes again on both creation and acceptance. The JavaScript copy exists only to refuse
// bad input early with a clear 400; recipientEmail.pg.test.ts proves the two agree.
//
//   a. trim surrounding ASCII whitespace: space and codes 9-13 (\t \n \v \f \r) -- NOT String.trim(),
//      which also strips Unicode spaces the database would not strip;
//   length: 3-254 characters;
//   b. every character is printable ASCII (codes 32-126);
//   c. exactly one '@', not first and not last;
//   d. lower-case ASCII A-Z only (no locale-sensitive lower-casing).
// Nothing else: no dot or plus-tag removal, no domain rewriting, no alias guessing.

const EDGE_WHITESPACE = /^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g;

/** Returns the canonical address, or null when the input is not a valid recipient email. */
export function canonicalRecipientEmail(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const v = input.replace(EDGE_WHITESPACE, '');
  // Length in characters (code points), as PostgreSQL's char_length counts them.
  const chars = Array.from(v);
  if (chars.length < 3 || chars.length > 254) return null;
  for (const ch of chars) {
    const code = ch.codePointAt(0)!;
    if (code < 32 || code > 126) return null;
  }
  const at = v.split('@').length - 1;
  if (at !== 1 || v.startsWith('@') || v.endsWith('@')) return null;
  return v.replace(/[A-Z]/g, c => String.fromCharCode(c.charCodeAt(0) + 32));
}
