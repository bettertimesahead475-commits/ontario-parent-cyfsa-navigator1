// Stage 9D-4B-2A-ii-b5A-i — Form 33B.1 real-artifact verification + independent OOXML control
// inventory (NARROWED PASS 1 OF 3).
//
// SCOPE: this module is a pass-specific, independent verification artifact. It is deliberately
// NOT a modification of the frozen api/services/docxFieldInventory.ts / docxFieldInventoryData.ts
// files, and it deliberately does NOT reuse buildDocxFieldInventory()'s own field-extraction
// logic — the point of this pass is to re-derive the raw control inventory for Form 33B.1 from
// the OOXML bytes using an independent extraction method, so that a match against the frozen
// inventory is genuine corroboration rather than the same code agreeing with itself.
//
// It DOES reuse docxZipSafe.ts's openDocxSafely() for the ZIP/OOXML container read itself, since
// that module is a separately security-reviewed, hardened, read-only ZIP reader (zip-slip,
// zip-bomb, ZIP64, malformed-archive hardening) — re-implementing container parsing here would
// only reintroduce that same class of risk for no independent-verification benefit. The
// *field*-extraction (this module's actual job) is independent, from scratch.
//
// OUT OF SCOPE for this pass (see prior split, b5A-ii/iii): section/repeated-group
// reconstruction, stable technical IDs, decision-boundary classification, sensitivity/
// SAFE_TO_MAP tagging, no-answer-state types. This module produces ONLY: verified real-artifact
// identity (SHA-256) + a raw, independently-derived control inventory (count / type breakdown /
// name / ordinal / constraints) + duplicate/unnamed detection.
import crypto from "node:crypto";
import { openDocxSafely } from "./docxZipSafe.js";

export type RawFieldType = "textInput" | "checkBox" | "ddList" | "other";

export interface RawFieldEntry {
  /** 0-based order of the <w:ffData> block in document.xml, independently counted. */
  ordinal: number;
  /** Raw <w:name w:val="..."> value; "" if the name attribute is present but empty. */
  rawName: string;
  /** true if the field has no <w:name> element at all (distinct from an empty w:val). */
  unnamed: boolean;
  type: RawFieldType;
  textInput: { maxLength: number | null } | null;
  checkBox: { size: number | null; defaultChecked: boolean | null } | null;
  ddList: { listEntries: string[]; defaultIndex: number | null } | null;
}

export interface RawInventoryResult {
  sha256Hex: string;
  byteLength: number;
  totalControls: number;
  typeBreakdown: { textInput: number; checkBox: number; ddList: number; other: number };
  fields: RawFieldEntry[];
  duplicateNonEmptyNames: Record<string, number[]>;
  unnamedOrEmptyNameCount: number;
}

/**
 * Independently re-derives the raw legacy form-field control inventory for a .docx's
 * word/document.xml, from scratch, using a self-contained regex/string scan over the
 * <w:ffData>...</w:ffData> blocks in document order. Does not call buildDocxFieldInventory().
 */
export function deriveRawFieldInventory(bytes: Buffer): RawInventoryResult {
  const pkg = openDocxSafely(bytes, ["word/document.xml"]);
  const documentXmlBytes = pkg.parts.get("word/document.xml");
  if (!documentXmlBytes) {
    throw new Error("word/document.xml not found in package");
  }
  const xml = documentXmlBytes.toString("utf-8");

  // Reject any DOCTYPE/ENTITY declaration before scanning, matching the project's established
  // no-DOM-parser / no-entity-resolution safety posture for OOXML parts.
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error("document.xml contains a DOCTYPE/ENTITY declaration — refusing to scan");
  }

  const ffDataBlocks = matchAllFfData(xml);

  const fields: RawFieldEntry[] = [];
  const typeBreakdown = { textInput: 0, checkBox: 0, ddList: 0, other: 0 };
  const nameOrdinals = new Map<string, number[]>();
  let unnamedOrEmptyNameCount = 0;

  ffDataBlocks.forEach((block, ordinal) => {
    const nameMatch = /<w:name\s+w:val="([^"]*)"/.exec(block);
    const unnamed = nameMatch === null;
    const rawName = nameMatch ? decodeXmlEntities(nameMatch[1]) : "";

    let type: RawFieldType = "other";
    let textInput: RawFieldEntry["textInput"] = null;
    let checkBox: RawFieldEntry["checkBox"] = null;
    let ddList: RawFieldEntry["ddList"] = null;

    if (block.includes("<w:textInput")) {
      type = "textInput";
      const maxLenMatch = /<w:maxLength\s+w:val="(\d+)"/.exec(block);
      textInput = { maxLength: maxLenMatch ? Number(maxLenMatch[1]) : null };
    } else if (block.includes("<w:checkBox")) {
      type = "checkBox";
      const sizeMatch = /<w:checkBox>[\s\S]*?<w:size\s+w:val="(\d+)"/.exec(block);
      const defaultMatch = /<w:checkBox>[\s\S]*?<w:default\s+w:val="(\d+)"/.exec(block);
      checkBox = {
        size: sizeMatch ? Number(sizeMatch[1]) : null,
        defaultChecked: defaultMatch ? defaultMatch[1] === "1" : null
      };
    } else if (block.includes("<w:ddList")) {
      type = "ddList";
      const entryPattern = /<w:listEntry\s+w:val="([^"]*)"/g;
      const listEntries: string[] = [];
      let m: RegExpExecArray | null;
      while ((m = entryPattern.exec(block)) !== null) {
        listEntries.push(decodeXmlEntities(m[1]));
      }
      const defaultMatch = /<w:ddList>[\s\S]*?<w:default\s+w:val="(\d+)"/.exec(block);
      ddList = { listEntries, defaultIndex: defaultMatch ? Number(defaultMatch[1]) : null };
    }

    typeBreakdown[type]++;

    if (unnamed || rawName === "") {
      unnamedOrEmptyNameCount++;
    }
    if (!unnamed && rawName !== "") {
      const list = nameOrdinals.get(rawName) ?? [];
      list.push(ordinal);
      nameOrdinals.set(rawName, list);
    }

    fields.push({ ordinal, rawName, unnamed, type, textInput, checkBox, ddList });
  });

  const duplicateNonEmptyNames: Record<string, number[]> = {};
  for (const [name, ordinals] of nameOrdinals) {
    if (ordinals.length > 1) {
      duplicateNonEmptyNames[name] = ordinals;
    }
  }

  return {
    sha256Hex: crypto.createHash("sha256").update(bytes).digest("hex"),
    byteLength: bytes.length,
    totalControls: fields.length,
    typeBreakdown,
    fields,
    duplicateNonEmptyNames,
    unnamedOrEmptyNameCount
  };
}

/** Self-contained (not delegated) balanced-tag scan for <w:ffData>...</w:ffData> blocks. */
function matchAllFfData(xml: string): string[] {
  const blocks: string[] = [];
  const open = "<w:ffData>";
  const close = "</w:ffData>";
  let searchFrom = 0;
  while (true) {
    const start = xml.indexOf(open, searchFrom);
    if (start === -1) break;
    const end = xml.indexOf(close, start);
    if (end === -1) {
      throw new Error(`Unterminated <w:ffData> block starting at offset ${start}`);
    }
    blocks.push(xml.slice(start, end + close.length));
    searchFrom = end + close.length;
  }
  return blocks;
}

function decodeXmlEntities(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}
