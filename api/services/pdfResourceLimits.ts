/**
 * Shared resource checks for uploaded PDFs and base64 payloads, run before any parser.
 *
 * isBase64Text: the same accepted set as the former backtracking pattern, checked in linear time. A pattern with nested
 * optional groups overflowed the call stack on a 12 million character string (measured), which is roughly a 9 MB file.
 *
 * expandedBytesWithin: sums the decompressed size of every Flate-compressed stream and stops at a budget. Measured: a
 * 102 KB file expanded to 50 MB and cost 7 s of CPU. Inflation stops at the budget, so a bomb costs at most the budget.
 * Only Flate is checked. Streams that are not Flate data are left to the PDF reader.
 */
import zlib from "node:zlib";

/** Canonical length, character set, and padding, in one linear pass. Equivalent to the former pattern for every input. */
export function isBase64Text(s: string): boolean {
  return s.length > 0 && s.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(s);
}

export function expandedBytesWithin(bytes: Buffer, budget: number): boolean {
  const text = bytes.toString("latin1");
  const open = /(?<!end)stream\r?\n/g;
  let total = 0;
  let m: RegExpExecArray | null;
  while ((m = open.exec(text)) !== null) {
    const start = m.index + m[0].length;
    const end = text.indexOf("endstream", start);
    if (end < 0) break;
    try {
      const out = zlib.inflateSync(bytes.subarray(start, end), { maxOutputLength: budget - total + 1 });
      total += out.length;
      if (total > budget) return false;
    } catch (e: any) {
      if (e?.code === "ERR_BUFFER_TOO_LARGE") return false;
      // Not Flate data, or corrupt: the PDF reader decides.
    }
    open.lastIndex = end + "endstream".length;
  }
  return true;
}

/** Budget for the existing analyzer. Scanned pages can legitimately inflate, so this is larger than the form budget. */
export const ANALYZER_MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
