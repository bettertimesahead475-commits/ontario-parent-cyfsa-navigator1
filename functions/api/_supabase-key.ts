/**
 * Normalizes a Supabase API key read from a Cloudflare secret before it is placed in a header.
 *
 * A pasted secret can carry invisible leading/trailing characters (line breaks, non-breaking
 * spaces, a byte-order mark). Header normalization strips only HTTP whitespace, so the remaining
 * bytes reach Cloudflare's edge, which rejects the request with an empty HTTP 400 before it ever
 * reaches Supabase. String.prototype.trim() removes all of those characters.
 */
export function normalizeSupabaseKey(raw: string | undefined | null): string | undefined {
  const key = typeof raw === 'string' ? raw.trim() : '';
  return key || undefined;
}

/** Boolean facts about a configured key for diagnostics. Never returns or logs key material. */
export function supabaseKeyHygiene(raw: string | undefined | null): { trimChanges: boolean; invalidHeaderChars: boolean } {
  const value = typeof raw === 'string' ? raw : '';
  return {
    trimChanges: value !== value.trim(),
    // Visible ASCII only is valid in an API key header value.
    invalidHeaderChars: /[^\x21-\x7e]/.test(value.trim()),
  };
}
