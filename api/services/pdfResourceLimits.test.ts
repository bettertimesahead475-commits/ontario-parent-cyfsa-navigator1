import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";
import {
  expandedBytesWithin,
  lzwDecodedLength,
  runLengthDecodedLength,
  asciiHexDecode,
  ascii85Decode,
  ANALYZER_MAX_EXPANDED_BYTES
} from "./pdfResourceLimits";
import { OFFICIAL_FORMS_CURRENT_DIR } from "../testSupport/officialFormFixtures.js";

/** A minimal PDF object wrapper around one stream, enough for the scanner (which reads the dictionary before `stream`). */
function pdfWithStream(dict: string, data: Buffer): Buffer {
  return Buffer.concat([
    Buffer.from(`%PDF-1.4\n1 0 obj\n<< ${dict} /Length ${data.length} >>\nstream\n`, "latin1"),
    data,
    Buffer.from("\nendstream\nendobj\n%%EOF\n", "latin1")
  ]);
}

/** Reference LZW encoder (PDF variant, EarlyChange 1). Code width grows as the table fills, so 10-, 11- and 12-bit codes
 *  are exercised. Used only to build test data. */
function lzwEncode(input: Buffer): Buffer {
  const out: number[] = [];
  let acc = 0;
  let bits = 0;
  let width = 9;
  const emit = (code: number) => {
    acc = (acc << width) | code;
    bits += width;
    while (bits >= 8) {
      out.push((acc >>> (bits - 8)) & 255);
      bits -= 8;
    }
    acc &= (1 << bits) - 1;
  };
  let dict = new Map<string, number>();
  let next = 258;
  emit(256);
  let w = "";
  for (const b of input) {
    const c = String.fromCharCode(b);
    const wc = w + c;
    if (wc.length === 1 || dict.has(wc)) {
      w = wc;
      continue;
    }
    emit(w.length === 1 ? w.charCodeAt(0) : dict.get(w)!);
    dict.set(wc, next++);
    // The encoder widens when its table reaches 512 entries. The decoder widens one code earlier (EarlyChange 1).
    if (next >= 1 << width && width < 12) width++;
    w = c;
    if (next >= 4000) {
      emit(256);
      dict = new Map();
      next = 258;
      width = 9;
    }
  }
  if (w) emit(w.length === 1 ? w.charCodeAt(0) : dict.get(w)!);
  emit(257);
  if (bits > 0) out.push((acc << (8 - bits)) & 255);
  return Buffer.from(out);
}

/** Reference ASCII85 encoder (test data only). */
function ascii85Encode(input: Buffer): Buffer {
  let out = "";
  for (let i = 0; i < input.length; i += 4) {
    const chunk = input.subarray(i, i + 4);
    const n = chunk.length;
    if (n === 4 && chunk.every(b => b === 0)) {
      out += "z";
      continue;
    }
    const padded = Buffer.concat([chunk, Buffer.alloc(4 - n)]);
    let v = padded.readUInt32BE(0);
    const digits: string[] = [];
    for (let k = 0; k < 5; k++) {
      digits.unshift(String.fromCharCode(33 + (v % 85)));
      v = Math.floor(v / 85);
    }
    out += digits.slice(0, n + 1).join("");
  }
  return Buffer.from(out + "~>", "latin1");
}

const RL_BOMB_BUDGET = ANALYZER_MAX_EXPANDED_BYTES;

describe("LZW: bounded decoded length", () => {
  it("reports the true decoded length of a valid LZW stream (round trip)", () => {
    const text = Buffer.from(Array.from({ length: 3000 }, (_, i) => `line ${i % 97} word${(i * 7) % 113} `).join(""), "latin1");
    const encoded = lzwEncode(text);
    expect(lzwDecodedLength(encoded, 1 << 30)).toBe(text.length);
  });

  it("stops at the budget for a stream that expands far beyond it, without building the output", () => {
    const run = Buffer.alloc(4 * 1024 * 1024, 0x61);
    const encoded = lzwEncode(run);
    expect(encoded.length).toBeLessThan(1024 * 1024);
    // Unbounded, the decoder reports the exact run length, so the bounded result is a real overrun and not a bug.
    expect(lzwDecodedLength(encoded, 1 << 30)).toBe(run.length);
    expect(lzwDecodedLength(encoded, 1 * 1024 * 1024)).toBe(-1);
  });

  it("refuses an LZW stream whose decoded size exceeds the budget it is checked against", () => {
    // Same check as the analyzer budget at a size the reference encoder can build quickly.
    const budget = 1024 * 1024;
    const run = Buffer.alloc(budget + 1024 * 1024, 0x62);
    const pdf = pdfWithStream("/Filter /LZWDecode", lzwEncode(run));
    expect(expandedBytesWithin(pdf, budget)).toBe(false);
    expect(expandedBytesWithin(pdf, 4 * 1024 * 1024)).toBe(true);
  }, 120000);

  it("accepts a small LZW stream", () => {
    const text = Buffer.from("BT /F1 12 Tf (Hello court form) Tj ET\n".repeat(50), "latin1");
    expect(expandedBytesWithin(pdfWithStream("/Filter /LZWDecode", lzwEncode(text)), RL_BOMB_BUDGET)).toBe(true);
  });
});

describe("RunLength: bounded decoded length", () => {
  it("refuses a RunLength stream that expands past the budget (each 2 bytes decode to 128)", () => {
    const packets = Buffer.alloc(2 * 1024 * 1024);
    for (let i = 0; i < packets.length; i += 2) {
      packets[i] = 129;
      packets[i + 1] = 0x41;
    }
    expect(runLengthDecodedLength(packets, RL_BOMB_BUDGET)).toBe(-1);
    expect(expandedBytesWithin(pdfWithStream("/Filter /RunLengthDecode", packets), RL_BOMB_BUDGET)).toBe(false);
  });

  it("decodes literal and repeat packets to their true length", () => {
    const literal = Buffer.from([2, 0x41, 0x42, 0x43, 128]);
    expect(runLengthDecodedLength(literal, 1000)).toBe(3);
    const repeat = Buffer.from([253, 0x41, 128]);
    expect(runLengthDecodedLength(repeat, 1000)).toBe(4);
  });
});

describe("Flate behind a prefix decoder: no hiding a bomb", () => {
  it("refuses a Flate bomb wrapped in ASCII85, which a PDF reader decodes first", () => {
    const bomb = zlib.deflateSync(Buffer.alloc(ANALYZER_MAX_EXPANDED_BYTES + 8 * 1024 * 1024, 0x30));
    const wrapped = ascii85Encode(bomb);
    expect(expandedBytesWithin(pdfWithStream("/Filter [/ASCII85Decode /FlateDecode]", wrapped), RL_BOMB_BUDGET)).toBe(false);
  }, 120000);

  it("accepts a small ASCII85 + Flate stream", () => {
    const text = Buffer.from("small content stream\n".repeat(200));
    const wrapped = ascii85Encode(zlib.deflateSync(text));
    expect(expandedBytesWithin(pdfWithStream("/Filter [/ASCII85Decode /FlateDecode]", wrapped), RL_BOMB_BUDGET)).toBe(true);
  });

  it("refuses a chain that combines two content decoders", () => {
    const data = zlib.deflateSync(Buffer.from("x"));
    expect(expandedBytesWithin(pdfWithStream("/Filter [/FlateDecode /LZWDecode]", data), RL_BOMB_BUDGET)).toBe(false);
    expect(expandedBytesWithin(pdfWithStream("/Filter [/LZWDecode /FlateDecode]", lzwEncode(Buffer.from("x"))), RL_BOMB_BUDGET)).toBe(false);
  });

  it("refuses a filter entry that is an indirect reference, since the real filter cannot be seen", () => {
    expect(expandedBytesWithin(pdfWithStream("/Filter 12 0 R", Buffer.from("anything")), RL_BOMB_BUDGET)).toBe(false);
  });

  it("refuses malformed ASCII85 under a declared ASCII85 filter", () => {
    expect(expandedBytesWithin(pdfWithStream("/Filter /ASCII85Decode", Buffer.from("not\x7fvalid")), RL_BOMB_BUDGET)).toBe(false);
  });
});

describe("ASCII decoders (round trips)", () => {
  it("ASCIIHex decodes its own output", () => {
    expect(asciiHexDecode(Buffer.from("48656C6C6F>")).toString("latin1")).toBe("Hello");
    expect(asciiHexDecode(Buffer.from("4 8 6 5 >")).toString("latin1")).toBe("He");
  });

  it("ASCII85 round-trips arbitrary binary, including the zero-group shortcut", () => {
    const data = Buffer.concat([Buffer.alloc(8, 0), Buffer.from([1, 2, 3, 250, 251, 252, 253, 254, 255])]);
    expect(ascii85Decode(ascii85Encode(data))!.equals(data)).toBe(true);
  });
});

describe("real official PDFs (when present) are not refused by the bound", () => {
  it("accepts each current official PDF", () => {
    const dir = OFFICIAL_FORMS_CURRENT_DIR;
    const manifest = JSON.parse(
      fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../scripts/official-forms/current-manifest.json"), "utf8")
    ) as { files: { fileName: string }[] };
    if (!manifest.files.every(f => fs.existsSync(path.join(dir, f.fileName)))) return; // skipped by presence, not passed
    for (const f of manifest.files) {
      expect(expandedBytesWithin(fs.readFileSync(path.join(dir, f.fileName)), RL_BOMB_BUDGET), f.fileName).toBe(true);
    }
  });
});
