/**
 * Shared resource checks for uploaded PDFs and base64 payloads, run before any PDF parser.
 *
 * isBase64Text: the accepted set of the former backtracking pattern, checked in linear time. That pattern overflowed the
 * call stack on a 12 million character string (measured).
 *
 * expandedBytesWithin: sums the decoded size of every content stream whose filter a PDF reader would decode for text
 * (Flate, LZW, RunLength) and stops at a budget. Measured: a 102 KB Flate file expanded to 50 MB and cost 7 s of CPU.
 * Decoders stop at the budget, so a bomb costs at most the budget.
 *
 * Fail-closed rules:
 *   - A filter chain that combines LZW or RunLength with another filter is refused. Its decoded size is not checked.
 *   - A /Filter entry that is not a name or name array (for example an indirect reference) is refused.
 *   - Image codecs (DCT, JPX, JBIG2, CCITT) are not decoded by the text and field readers, so they are not sized here.
 *     This is a stated boundary, listed in the release checklist.
 */
import zlib from "node:zlib";

/** Canonical length, character set, and padding, in one linear pass. Equivalent to the former pattern for every input. */
export function isBase64Text(s: string): boolean {
  return s.length > 0 && s.length % 4 === 0 && /^[A-Za-z0-9+/]*={0,2}$/.test(s);
}

/** LZW (PDF variant, EarlyChange 1). Returns the decoded length, or -1 when the budget would be exceeded. Does not
 *  materialise output: each code's decoded length is tracked, which is all the budget needs. */
export function lzwDecodedLength(input: Buffer, budget: number): number {
  const prefix = new Int32Array(4096).fill(-1);
  const length = new Int32Array(4096);
  const first = new Uint8Array(4096);
  for (let i = 0; i < 256; i++) {
    length[i] = 1;
    first[i] = i;
  }
  let next = 258;
  let width = 9;
  let prev = -1;
  let total = 0;
  let bitPos = 0;
  const totalBits = input.length * 8;
  const readCode = (): number => {
    let code = 0;
    for (let b = 0; b < width; b++) {
      const bit = bitPos < totalBits ? (input[bitPos >> 3] >> (7 - (bitPos & 7))) & 1 : 0;
      code = (code << 1) | bit;
      bitPos++;
    }
    return code;
  };
  while (bitPos + width <= totalBits) {
    const code = readCode();
    if (code === 256) {
      next = 258;
      width = 9;
      prev = -1;
      continue;
    }
    if (code === 257) break;
    if (prev === -1) {
      if (code > 255) return -1; // not a valid stream; the PDF reader will reject it
      total += 1;
      prev = code;
      continue;
    }
    let entryLength: number;
    let entryFirst: number;
    if (code < next) {
      entryLength = length[code];
      entryFirst = first[code];
    } else if (code === next) {
      entryLength = length[prev] + 1;
      entryFirst = first[prev];
    } else {
      return -1;
    }
    total += entryLength;
    if (total > budget) return -1;
    if (next < 4096) {
      prefix[next] = prev;
      length[next] = length[prev] + 1;
      first[next] = first[prev];
      next++;
    }
    if (next + 1 >= 1 << width && width < 12) width++;
    prev = code;
    void entryFirst;
  }
  return total;
}

/** RunLength. Returns the decoded length, or -1 when the budget would be exceeded. */
export function runLengthDecodedLength(input: Buffer, budget: number): number {
  let total = 0;
  let i = 0;
  while (i < input.length) {
    const n = input[i++];
    if (n === 128) break;
    if (n < 128) {
      total += n + 1;
      i += n + 1;
    } else {
      total += 257 - n;
      i += 1;
    }
    if (total > budget) return -1;
  }
  return total;
}

const DECODE_BEFORE = new Set(["ASCIIHexDecode", "ASCII85Decode"]);
const CONTENT = new Set(["FlateDecode", "LZWDecode", "RunLengthDecode"]);
const IMAGE_ONLY = new Set(["DCTDecode", "JPXDecode", "JBIG2Decode", "CCITTFaxDecode"]);

type StreamVerdict = { ok: true; decoded: number } | { ok: false };

/** Reads the filter names from the object dictionary that precedes a stream. */
function filtersFor(dict: string): string[] | "UNPARSEABLE" {
  if (!/\/Filter\b/.test(dict)) return [];
  const array = /\/Filter\s*\[([^\]]*)\]/.exec(dict);
  if (array) return [...array[1].matchAll(/\/([A-Za-z0-9]+)/g)].map(m => m[1]);
  const single = /\/Filter\s*\/([A-Za-z0-9]+)/.exec(dict);
  return single ? [single[1]] : "UNPARSEABLE";
}

/** ASCIIHex decode. Output is smaller than input, so it is not counted against the budget. Null when malformed. */
export function asciiHexDecode(input: Buffer): Buffer | null {
  const out: number[] = [];
  let high = -1;
  for (const c of input) {
    if (c === 0x3e) break; // '>'
    if (/\s/.test(String.fromCharCode(c))) continue;
    const v = parseInt(String.fromCharCode(c), 16);
    if (Number.isNaN(v)) return null;
    if (high < 0) high = v;
    else {
      out.push(high * 16 + v);
      high = -1;
    }
  }
  if (high >= 0) out.push(high * 16);
  return Buffer.from(out);
}

/** ASCII85 decode. Output is smaller than input, so it is not counted against the budget. Null when malformed. */
export function ascii85Decode(input: Buffer): Buffer | null {
  const text = input.toString("latin1");
  const out: number[] = [];
  let group: number[] = [];
  const flush = (n: number) => {
    let v = 0;
    const padded = [...group, ...Array(5 - group.length).fill(84)];
    for (const d of padded) v = v * 85 + d;
    const bytes = [(v >>> 24) & 255, (v >>> 16) & 255, (v >>> 8) & 255, v & 255];
    out.push(...bytes.slice(0, n));
    group = [];
  };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (/\s/.test(ch)) continue;
    if (ch === "~") break;
    if (ch === "z" && group.length === 0) {
      out.push(0, 0, 0, 0);
      continue;
    }
    const code = ch.charCodeAt(0);
    if (code < 33 || code > 117) return null;
    group.push(code - 33);
    if (group.length === 5) flush(4);
  }
  if (group.length === 1) return null;
  if (group.length > 1) flush(group.length - 1);
  return Buffer.from(out);
}

function inflateBounded(data: Buffer, budget: number): number {
  try {
    return zlib.inflateSync(data, { maxOutputLength: budget + 1 }).length;
  } catch (e: any) {
    if (e?.code === "ERR_BUFFER_TOO_LARGE") return -1;
    return 0; // not valid Flate: the PDF reader decides
  }
}

function streamVerdict(bytes: Buffer, text: string, streamIndex: number, dataStart: number, dataEnd: number, budget: number): StreamVerdict {
  const filters = filtersFor(dictBefore(text, streamIndex));
  if (filters === "UNPARSEABLE") return { ok: false };
  let data: Buffer = bytes.subarray(dataStart, dataEnd);
  let i = 0;
  while (i < filters.length && DECODE_BEFORE.has(filters[i])) {
    const next = filters[i] === "ASCIIHexDecode" ? asciiHexDecode(data) : ascii85Decode(data);
    if (next === null) return { ok: false };
    data = next;
    i++;
  }
  if (i === filters.length) return { ok: true, decoded: 0 };
  const content = filters[i];
  if (!CONTENT.has(content)) return IMAGE_ONLY.has(content) && i === filters.length - 1 ? { ok: true, decoded: 0 } : { ok: false };
  for (const f of filters.slice(i + 1)) if (!IMAGE_ONLY.has(f)) return { ok: false };
  const decoded =
    content === "FlateDecode" ? inflateBounded(data, budget) :
    content === "LZWDecode" ? lzwDecodedLength(data, budget) :
    runLengthDecodedLength(data, budget);
  return decoded < 0 ? { ok: false } : { ok: true, decoded };
}

function dictBefore(text: string, streamIndex: number): string {
  const window = text.slice(Math.max(0, streamIndex - 4096), streamIndex);
  const objects = [...window.matchAll(/\d+\s+\d+\s+obj\b/g)];
  return objects.length ? window.slice(objects[objects.length - 1].index) : window;
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
    const verdict = streamVerdict(bytes, text, m.index, start, end, budget - total);
    if (!verdict.ok) return false;
    total += verdict.decoded;
    if (total > budget) return false;
    open.lastIndex = end + "endstream".length;
  }
  return true;
}

/** Budget for the existing analyzer. Scanned pages can legitimately inflate, so this is larger than the form budget. */
export const ANALYZER_MAX_EXPANDED_BYTES = 64 * 1024 * 1024;
