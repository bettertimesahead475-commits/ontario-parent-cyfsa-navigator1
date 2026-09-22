// Stage 9D-4B-2A-i — OOXML/ZIP container safety tests.
//
// These are synthetic, hand-built ZIP archives (no real Ontario form content) that probe the
// hardened reader in docxZipSafe.ts against zip-slip/path traversal, decompression bombs,
// malformed/truncated structures, and unsupported compression methods.
import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import { openDocxSafely, DocxSafetyError, ZIP_SAFETY_LIMITS } from "./docxZipSafe.js";

// --- Minimal hand-rolled ZIP writer (deliberately independent of any zip library, so these
// tests exercise the reader against bytes we fully control, including deliberately-broken ones).
interface EntrySpec {
  name: string;
  data: Buffer;
  method?: 0 | 8; // 0 = stored, 8 = deflate
  /** Override the declared uncompressed size in headers (to simulate a lying/bomb header). */
  declaredUncompressedSize?: number;
  /** Override the declared compressed size in headers. */
  declaredCompressedSize?: number;
}

function crc32(buf: Buffer): number {
  // Not used by our reader for validation, but included for structural realism.
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}
namespace crc32 {
  export let table: Int32Array | undefined;
}

function buildZip(entries: EntrySpec[]): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;

  for (const e of entries) {
    const method = e.method ?? 8;
    const payload = method === 8 ? zlib.deflateRawSync(e.data) : e.data;
    const compressedSize = e.declaredCompressedSize ?? payload.length;
    const uncompressedSize = e.declaredUncompressedSize ?? e.data.length;
    const nameBuf = Buffer.from(e.name, "utf8");
    const crc = crc32(e.data);

    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4); // version needed
    localHeader.writeUInt16LE(0, 6); // flags
    localHeader.writeUInt16LE(method, 8);
    localHeader.writeUInt16LE(0, 10); // mod time
    localHeader.writeUInt16LE(0, 12); // mod date
    localHeader.writeUInt32LE(crc, 14);
    localHeader.writeUInt32LE(compressedSize, 18);
    localHeader.writeUInt32LE(uncompressedSize, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);

    const localEntry = Buffer.concat([localHeader, nameBuf, payload]);
    localParts.push(localEntry);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4); // version made by
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0, 8); // flags
    centralHeader.writeUInt16LE(method, 10);
    centralHeader.writeUInt16LE(0, 12);
    centralHeader.writeUInt16LE(0, 14);
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(compressedSize, 20);
    centralHeader.writeUInt32LE(uncompressedSize, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(0, 38); // external attrs
    centralHeader.writeUInt32LE(offset, 42);

    centralParts.push(Buffer.concat([centralHeader, nameBuf]));
    offset += localEntry.length;
  }

  const localSection = Buffer.concat(localParts);
  const centralSection = Buffer.concat(centralParts);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSection.length, 12);
  eocd.writeUInt32LE(localSection.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localSection, centralSection, eocd]);
}

describe("docxZipSafe: baseline correctness", () => {
  it("reads back a well-formed stored entry", () => {
    const zip = buildZip([{ name: "word/document.xml", data: Buffer.from("<w:document/>"), method: 0 }]);
    const pkg = openDocxSafely(zip, ["word/document.xml"]);
    expect(pkg.parts.get("word/document.xml")?.toString("utf8")).toBe("<w:document/>");
    expect(pkg.allEntryNames).toEqual(["word/document.xml"]);
  });

  it("reads back a well-formed deflated entry", () => {
    const content = "x".repeat(5000);
    const zip = buildZip([{ name: "word/document.xml", data: Buffer.from(content), method: 8 }]);
    const pkg = openDocxSafely(zip, ["word/document.xml"]);
    expect(pkg.parts.get("word/document.xml")?.toString("utf8")).toBe(content);
  });

  it("only inflates the requested entries, not every entry in the archive", () => {
    const zip = buildZip([
      { name: "word/document.xml", data: Buffer.from("A") },
      { name: "word/media/image1.png", data: Buffer.from("B".repeat(1000)) }
    ]);
    const pkg = openDocxSafely(zip, ["word/document.xml"]);
    expect(pkg.parts.has("word/document.xml")).toBe(true);
    expect(pkg.parts.has("word/media/image1.png")).toBe(false);
    expect(pkg.allEntryNames).toContain("word/media/image1.png");
  });
});

describe("docxZipSafe: zip-slip / path traversal rejection", () => {
  it.each([
    "../../etc/passwd",
    "..\\..\\windows\\system32\\evil.dll",
    "/etc/passwd",
    "C:\\evil.txt",
    "word/../../../etc/passwd"
  ])("rejects traversal entry name %s", name => {
    const zip = buildZip([{ name, data: Buffer.from("x") }]);
    expect(() => openDocxSafely(zip, [name])).toThrow(DocxSafetyError);
    try {
      openDocxSafely(zip, [name]);
    } catch (err) {
      expect((err as DocxSafetyError).code).toBe("ZIP_SLIP_REJECTED");
    }
  });
});

describe("docxZipSafe: decompression bomb bounding", () => {
  it("rejects an entry whose declared uncompressed size exceeds the per-entry cap", () => {
    const zip = buildZip([
      {
        name: "word/document.xml",
        data: Buffer.from("small"),
        declaredUncompressedSize: ZIP_SAFETY_LIMITS.maxEntryUncompressedBytes + 1
      }
    ]);
    expect(() => openDocxSafely(zip, ["word/document.xml"])).toThrow(DocxSafetyError);
  });

  it("rejects an entry with an implausible compression ratio (classic zip-bomb shape)", () => {
    // Highly compressible payload that deflates far smaller than it claims to be, at a ratio
    // beyond what real Office document parts ever exhibit.
    const real = Buffer.alloc(200, 0); // real tiny payload, deflates to a handful of bytes
    const zip = buildZip([
      {
        name: "word/document.xml",
        data: real,
        declaredUncompressedSize: real.length * (ZIP_SAFETY_LIMITS.maxCompressionRatio + 50)
      }
    ]);
    expect(() => openDocxSafely(zip, ["word/document.xml"])).toThrow(DocxSafetyError);
  });

  it("bounds actual inflate output via maxOutputLength even if a header lies moderately", () => {
    // Real compressed bytes for a payload larger than declared — reader must catch the mismatch
    // rather than trust the (smaller, lying) declared uncompressed size.
    const real = Buffer.from("y".repeat(10_000));
    const compressed = zlib.deflateRawSync(real);
    const zip = buildZip([
      {
        name: "word/document.xml",
        data: real,
        method: 8,
        declaredUncompressedSize: 10 // lies: claims tiny, but compressed bytes inflate to 10000
      }
    ]);
    // Our writer used the *real* uncompressed size for compression, but declared a small one —
    // simulate the mismatch by re-patching bytes is unnecessary here: declaredUncompressedSize
    // already drives the header value while `compressed` bytes stay the true payload.
    expect(() => openDocxSafely(zip, ["word/document.xml"])).toThrow(DocxSafetyError);
  });

  it("rejects an archive whose declared entry count exceeds the safety cap", () => {
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(ZIP_SAFETY_LIMITS.maxEntries + 1, 8);
    eocd.writeUInt16LE(ZIP_SAFETY_LIMITS.maxEntries + 1, 10);
    eocd.writeUInt32LE(0, 12);
    eocd.writeUInt32LE(0, 16);
    eocd.writeUInt16LE(0, 20);
    expect(() => openDocxSafely(eocd, ["word/document.xml"])).toThrow(DocxSafetyError);
  });
});

describe("AUDIT: duplicate central-directory entry gap (independent audit finding, 9D-4B-2A-i)", () => {
  // Reproduces the exact adversarial scenario the audit built: a ZIP whose central directory
  // lists two entries sharing the same part name ("word/document.xml"), one containing "AAA fake"
  // and one containing "BBB real". Before the fix, readCentralDirectory() resolved this silently
  // to whichever entry was encountered LAST while iterating (a plain Map.set() overwrite) — no
  // error, no anomaly, with allEntryNames listing the name twice. This proves the reader now fails
  // closed instead, consistent with this module's "throw rather than best-effort-parse" philosophy
  // for zip-slip, ratio-cap and entry-count-cap violations.
  it("throws rather than silently resolving to the last-seen entry when a part name is duplicated", () => {
    const zip = buildZip([
      { name: "word/document.xml", data: Buffer.from("AAA fake") },
      { name: "word/document.xml", data: Buffer.from("BBB real") }
    ]);

    expect(() => openDocxSafely(zip, ["word/document.xml"])).toThrow(DocxSafetyError);
    try {
      openDocxSafely(zip, ["word/document.xml"]);
      expect.unreachable("expected openDocxSafely to throw on a duplicate central-directory entry");
    } catch (err) {
      expect(err).toBeInstanceOf(DocxSafetyError);
      expect((err as DocxSafetyError).code).toBe("DUPLICATE_CENTRAL_DIR_ENTRY");
      expect((err as DocxSafetyError).message).toContain("word/document.xml");
    }
  });

  it("applies to any duplicated part name, not just word/document.xml (e.g. [Content_Types].xml)", () => {
    const zip = buildZip([
      { name: "[Content_Types].xml", data: Buffer.from("<Types>first</Types>") },
      { name: "word/document.xml", data: Buffer.from("<w:document/>") },
      { name: "[Content_Types].xml", data: Buffer.from("<Types>second</Types>") }
    ]);

    expect(() => openDocxSafely(zip, ["word/document.xml"])).toThrow(DocxSafetyError);
    try {
      openDocxSafely(zip, ["word/document.xml"]);
    } catch (err) {
      expect((err as DocxSafetyError).code).toBe("DUPLICATE_CENTRAL_DIR_ENTRY");
      expect((err as DocxSafetyError).message).toContain("[Content_Types].xml");
    }
  });

  it("does not regress normal archives where every part name appears exactly once", () => {
    const zip = buildZip([
      { name: "[Content_Types].xml", data: Buffer.from("<Types/>") },
      { name: "word/document.xml", data: Buffer.from("<w:document/>") },
      { name: "word/settings.xml", data: Buffer.from("<w:settings/>") }
    ]);
    const pkg = openDocxSafely(zip, ["word/document.xml", "word/settings.xml"]);
    expect(pkg.parts.get("word/document.xml")?.toString("utf8")).toBe("<w:document/>");
    expect(pkg.parts.get("word/settings.xml")?.toString("utf8")).toBe("<w:settings/>");
    expect(pkg.allEntryNames).toEqual(["[Content_Types].xml", "word/document.xml", "word/settings.xml"]);
  });
});

describe("docxZipSafe: malformed archive rejection", () => {
  it("rejects a file too small to contain an EOCD", () => {
    expect(() => openDocxSafely(Buffer.from("hi"), ["word/document.xml"])).toThrow(DocxSafetyError);
  });

  it("rejects a file with no EOCD signature at all", () => {
    const junk = Buffer.alloc(100, 0x41);
    expect(() => openDocxSafely(junk, ["word/document.xml"])).toThrow(DocxSafetyError);
  });

  it("rejects an unsupported compression method", () => {
    const zip = buildZip([{ name: "word/document.xml", data: Buffer.from("x"), method: 0 }]);
    // Patch the compression method field in both local and central headers to an unsupported value (99).
    const patched = Buffer.from(zip);
    patched.writeUInt16LE(99, 8); // local header compression method offset
    // Find central header (after local entry) and patch its compression method field too.
    const centralSigIndex = patched.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    patched.writeUInt16LE(99, centralSigIndex + 10);
    expect(() => openDocxSafely(patched, ["word/document.xml"])).toThrow(DocxSafetyError);
  });

  it("rejects a ZIP64 archive rather than guessing at its structure", () => {
    const zip = buildZip([{ name: "word/document.xml", data: Buffer.from("x") }]);
    const zip64Locator = Buffer.alloc(20);
    zip64Locator.writeUInt32LE(0x07064b50, 0);
    const eocdIndex = zip.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const withLocator = Buffer.concat([zip.subarray(0, eocdIndex), zip64Locator, zip.subarray(eocdIndex)]);
    expect(() => openDocxSafely(withLocator, ["word/document.xml"])).toThrow(DocxSafetyError);
  });

  it("rejects trailing garbage data after the ZIP comment", () => {
    const zip = buildZip([{ name: "word/document.xml", data: Buffer.from("x") }]);
    const withGarbage = Buffer.concat([zip, Buffer.from("TRAILING_GARBAGE")]);
    expect(() => openDocxSafely(withGarbage, ["word/document.xml"])).toThrow(DocxSafetyError);
  });
});
