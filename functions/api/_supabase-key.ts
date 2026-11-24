/**
 * Normalizes a Supabase API key read from a Cloudflare secret before it is placed in a header.
 *
 * Supabase keys (legacy JWTs and sb_ keys) consist only of visible ASCII. A pasted secret can carry
 * invisible characters at either end or inside it (a wrapped line break, a non-breaking or
 * zero-width space, a byte-order mark). Header normalization strips only leading/trailing HTTP
 * whitespace, so the remaining bytes reach Cloudflare's edge, which rejects the request with an
 * empty HTTP 400 before it reaches Supabase. The staging executor's secret was observed in exactly
 * this state. Removing every non-visible-ASCII character cannot alter a valid key; a key that is
 * still wrong afterwards is rejected by Supabase with an explicit "Invalid API key" JSON error.
 */
export function normalizeSupabaseKey(raw: string | undefined | null): string | undefined {
  const key = typeof raw === 'string' ? raw.replace(/[^\x21-\x7e]/g, '') : '';
  return key || undefined;
}

/**
 * Facts about a configured key for diagnostics. Counts and booleans only; never key material.
 * `removedWhitespaceOnly` is true when every removed character was a space, line break, tab,
 * NBSP, BOM or zero-width character, i.e. paste damage rather than a different/wrong value.
 */
export function supabaseKeyHygiene(raw: string | undefined | null): {
  trimChanges: boolean;
  invalidHeaderChars: boolean;
  removedCount: number;
  removedWhitespaceOnly: boolean;
} {
  const value = typeof raw === 'string' ? raw : '';
  const removed = value.match(/[^\x21-\x7e]/g) || [];
  return {
    trimChanges: value !== value.trim(),
    invalidHeaderChars: /[^\x21-\x7e]/.test(value.trim()),
    removedCount: removed.length,
    removedWhitespaceOnly: removed.every((c) => /[\s\u200B-\u200D\u2060\uFEFF]/.test(c)),
  };
}
