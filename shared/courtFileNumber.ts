/**
 * Court file numbers as they appear in scanned or extracted court documents. A number is often split by a line break
 * or a hyphen at the end of a line, so comparing raw strings reports a false discrepancy. Normalize first, then compare.
 */

// Court file number: a court code (2 to 4 letters), a two-digit year, and a sequence number, such as FC-26-1234.
const COURT_FILE_NUMBER = /\b([A-Z]{2,4})\s*[-–]?\s*(\d{2})\s*[-–]\s*(\d{3,6})\b|\b([A-Z]{2,4})\s*[-–]?\s*(\d{2})\s+(\d{3,6})\b/;

/**
 * Returns the canonical form (for example "FC-26-1234"), or null if the text holds no court file number.
 * Line breaks, extra spaces, and a hyphen split across a line break are all removed before matching.
 */
export function normalizeCourtFileNumber(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Join a hyphen or dash that ends a line with the next line, and collapse all remaining whitespace.
  const joined = raw.replace(/([-–])\s*\n\s*/g, "$1").replace(/\s+/g, " ").toUpperCase();
  const m = joined.match(COURT_FILE_NUMBER);
  if (!m) return null;
  const [, code1, year1, seq1, code2, year2, seq2] = m;
  return code1 ? `${code1}-${year1}-${seq1}` : `${code2}-${year2}-${seq2}`;
}

/** True when both texts name the same court file number after normalization. Missing numbers are never equal. */
export function sameCourtFileNumber(a: string | null | undefined, b: string | null | undefined): boolean {
  const na = normalizeCourtFileNumber(a);
  const nb = normalizeCourtFileNumber(b);
  return na !== null && nb !== null && na === nb;
}
