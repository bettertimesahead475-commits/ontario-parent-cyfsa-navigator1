/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CYFSA Navigator — Hardened DOCX Text Extractor
 * Extracts plain text from Microsoft Word .docx OOXML packages using safe zip inflation.
 */

import { openDocxSafely, DocxSafetyError } from "./docxZipSafe.js";

function decodeXmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

/**
 * Safely extracts textual body paragraphs from a DOCX buffer.
 * Traverses paragraphs (<w:p>) and text runs (<w:t>) in word/document.xml.
 */
export function extractTextFromDocx(bytes: Buffer): string {
  if (!bytes || bytes.length === 0) {
    throw new Error("Cannot extract DOCX from empty buffer.");
  }

  try {
    const pkg = openDocxSafely(bytes, ["word/document.xml"]);
    const docXmlBuf = pkg.parts.get("word/document.xml");
    if (!docXmlBuf) {
      throw new Error("Invalid DOCX package: word/document.xml not found.");
    }

    const xml = docXmlBuf.toString("utf8");
    const pRegex = /<w:p\b[^>]*>([\s\S]*?)<\/w:p>/gi;
    const paragraphs: string[] = [];
    let pMatch: RegExpExecArray | null;

    while ((pMatch = pRegex.exec(xml)) !== null) {
      const pContent = pMatch[1];
      const tRegex = /<w:t\b[^>]*>([^<]*)<\/w:t>/gi;
      let textRuns = "";
      let tMatch: RegExpExecArray | null;

      while ((tMatch = tRegex.exec(pContent)) !== null) {
        textRuns += tMatch[1];
      }

      const decoded = decodeXmlEntities(textRuns).trim();
      if (decoded) {
        paragraphs.push(decoded);
      }
    }

    return paragraphs.join("\n\n");
  } catch (err: any) {
    if (err instanceof DocxSafetyError) {
      throw new Error(`DOCX security verification failed: ${err.message}`);
    }
    throw err;
  }
}
