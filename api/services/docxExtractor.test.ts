import { describe, expect, it } from "vitest";
import zlib from "node:zlib";
import { extractTextFromDocx } from "./docxExtractor.js";

// Helper to construct a minimal valid DOCX ZIP buffer
function crc32(buf: Buffer): number {
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    let byte = buf[i];
    for (let j = 0; j < 8; j++) {
      const bit = (crc ^ byte) & 1;
      crc = (crc >>> 1) ^ (bit ? 0xedb88320 : 0);
      byte >>>= 1;
    }
  }
  return (crc ^ -1) >>> 0;
}

function buildSyntheticDocx(paragraphs: string[]): Buffer {
  const pTags = paragraphs.map(p => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("");
  const docXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${pTags}</w:body></w:document>`;
  const docXmlBuf = Buffer.from(docXml, "utf8");

  // Minimal zip containing word/document.xml
  const filename = "word/document.xml";
  const filenameBuf = Buffer.from(filename, "utf8");
  const compressed = zlib.deflateRawSync(docXmlBuf);

  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(8, 8); // Deflate
  localHeader.writeUInt16LE(0, 10);
  localHeader.writeUInt16LE(0, 12);
  localHeader.writeUInt32LE(crc32(docXmlBuf), 14);
  localHeader.writeUInt32LE(compressed.length, 18);
  localHeader.writeUInt32LE(docXmlBuf.length, 22);
  localHeader.writeUInt16LE(filenameBuf.length, 26);
  localHeader.writeUInt16LE(0, 28);

  const localPart = Buffer.concat([localHeader, filenameBuf, compressed]);

  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(0, 8);
  centralHeader.writeUInt16LE(8, 10);
  centralHeader.writeUInt16LE(0, 12);
  centralHeader.writeUInt16LE(0, 14);
  centralHeader.writeUInt32LE(crc32(docXmlBuf), 16);
  centralHeader.writeUInt32LE(compressed.length, 20);
  centralHeader.writeUInt32LE(docXmlBuf.length, 24);
  centralHeader.writeUInt16LE(filenameBuf.length, 28);
  centralHeader.writeUInt16LE(0, 30);
  centralHeader.writeUInt16LE(0, 32);
  centralHeader.writeUInt16LE(0, 34);
  centralHeader.writeUInt16LE(0, 36);
  centralHeader.writeUInt32LE(0, 38);
  centralHeader.writeUInt32LE(0, 42); // local header offset = 0

  const centralPart = Buffer.concat([centralHeader, filenameBuf]);

  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(centralPart.length, 12);
  eocd.writeUInt32LE(localPart.length, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([localPart, centralPart, eocd]);
}

describe("extractTextFromDocx", () => {
  it("extracts paragraphs from synthetic DOCX buffer", () => {
    const docxBuf = buildSyntheticDocx([
      "IN THE ONTARIO COURT OF JUSTICE",
      "COURT FILE NO: FC-26-8888",
      "AFFIDAVIT OF SOCIETY WORKER REGARDING CYFSA SECTION 74(2)",
    ]);

    const extracted = extractTextFromDocx(docxBuf);
    expect(extracted).toContain("IN THE ONTARIO COURT OF JUSTICE");
    expect(extracted).toContain("COURT FILE NO: FC-26-8888");
    expect(extracted).toContain("AFFIDAVIT OF SOCIETY WORKER REGARDING CYFSA SECTION 74(2)");
  });

  it("decodes XML entities accurately", () => {
    const docxBuf = buildSyntheticDocx([
      "Smith &amp; Jones CAS Report &lt;Confidential&gt;",
    ]);

    const extracted = extractTextFromDocx(docxBuf);
    expect(extracted).toBe("Smith & Jones CAS Report <Confidential>");
  });

  it("rejects empty or corrupt buffer", () => {
    expect(() => extractTextFromDocx(Buffer.alloc(0))).toThrow(/empty buffer/i);
    expect(() => extractTextFromDocx(Buffer.from("not a docx"))).toThrow();
  });
});
