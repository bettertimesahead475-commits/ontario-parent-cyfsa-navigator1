// Stage 9D-4B-2A-i — real DOCX technical field inventory ONLY.
//
// SCOPE (deliberately narrow — see task prompt 52918-i): this module parses the actual OOXML of
// a .docx template and enumerates its legacy `w:ffData` form fields as a plain technical
// inventory (name, type, default value, ordering, containing paragraph/table context, duplicate
// and unnamed-field detection, protection settings). It does NOT build field-map binding,
// semantic/legal classification of fields, population, provenance, or review-gate logic — those
// are separate future sub-stages (9D-4B-2A-ii/iii/iv). It does not modify the source bytes.
//
// Safety: container-level (ZIP) hardening lives in docxZipSafe.ts. This module never uses a
// general XML DOM parser with DTD/entity support — it explicitly rejects any DOCTYPE/ENTITY
// declaration in a part before scanning it, and otherwise only does bounded regex/string
// scanning over the returned bytes. No network access, no external relationship following.
import { openDocxSafely, DocxSafetyError } from "./docxZipSafe.js";

export type FfFieldType = "text" | "checkbox" | "dropdown" | "unknown";

export interface FfFieldInventoryEntry {
  /** 0-based order in which the field appears in word/document.xml. */
  order: number;
  /** The `w:name w:val="..."` value, or null if the field has no name element (anomaly). */
  name: string | null;
  type: FfFieldType;
  /** Current/default value as encoded in the OOXML (best-effort; see notes per type). */
  defaultValue: string | null;
  /** Text fields only: `w:maxLength w:val`, if present. */
  maxLength: number | null;
  /** Checkbox fields only. */
  checkbox: { defaultChecked: boolean | null; currentlyChecked: boolean | null; autoSize: boolean } | null;
  /** Dropdown fields only. */
  dropdown: { listEntries: string[]; resultIndex: number | null } | null;
  /** Whether `<w:enabled/>` is present (absent commonly means the field is locked/disabled). */
  enabled: boolean;
  /** Approximate 0-based paragraph ordinal containing this field (see caveat in module docs). */
  paragraphOrdinal: number;
  /** Nesting depth of `w:tbl` elements enclosing this field (0 = not inside any table). */
  tableDepth: number;
  /** Raw XML snippet of the <w:ffData>...</w:ffData> block, for downstream inspection/debugging. */
  rawFfDataXml: string;
}

export interface DocxFieldInventoryAnomalies {
  /** Non-empty names that occur on more than one field. */
  duplicateNames: string[];
  /** Fields with no <w:name> element at all (name === null). */
  unnamedFieldCount: number;
  /** Fields with a <w:name w:val=""/> element present but empty — distinct from "no name element". */
  emptyNamedFieldCount: number;
  fieldsWithUnknownType: number;
  fieldsMissingEnabled: number;
}

export interface DocxFieldInventoryResult {
  /** True if the document contains legacy w:ffData fields (the reported/expected structure). */
  usesLegacyFormFields: boolean;
  /** True if the document instead (or additionally) contains SDT content controls (w:sdt). */
  usesContentControls: boolean;
  contentControlCount: number;
  fields: FfFieldInventoryEntry[];
  anomalies: DocxFieldInventoryAnomalies;
  documentProtection: {
    present: boolean;
    edit: string | null;
    enforcement: boolean | null;
  };
  allPackagePartNames: string[];
}

const DOCUMENT_XML_PART = "word/document.xml";
const SETTINGS_XML_PART = "word/settings.xml";

function rejectUnsafeXmlDeclarations(xml: string, partName: string): void {
  // Defense-in-depth: this reader never uses a DTD-aware XML parser, so entity expansion is
  // already structurally impossible. Still, refuse to proceed if a DOCTYPE/ENTITY declaration is
  // present at all, since a real Word-produced document.xml/settings.xml never contains one and
  // its presence is itself a signal of a tampered/adversarial file.
  if (/<!DOCTYPE/i.test(xml) || /<!ENTITY/i.test(xml)) {
    throw new DocxSafetyError(
      "UNEXPECTED_DOCTYPE_OR_ENTITY",
      `Part "${partName}" contains a DOCTYPE/ENTITY declaration, which a genuine Word-produced part never does. Refusing to scan it.`
    );
  }
}

function attrVal(xml: string, tagLocalName: string): string | null {
  // Matches e.g. <w:name w:val="Text1"/> or <w:name w:val="Text1"></w:name>, tolerant of
  // attribute order and self-closing vs. explicit close.
  const re = new RegExp(`<w:${tagLocalName}\\b[^>]*\\bw:val="([^"]*)"[^>]*/?>`, "i");
  const m = xml.match(re);
  return m ? m[1] : null;
}

function hasTag(xml: string, tagLocalName: string): boolean {
  return new RegExp(`<w:${tagLocalName}\\b[^>]*/?>`, "i").test(xml);
}

function parseFfDataBlock(block: string): {
  name: string | null;
  enabled: boolean;
  type: FfFieldType;
  maxLength: number | null;
  checkbox: FfFieldInventoryEntry["checkbox"];
  dropdown: FfFieldInventoryEntry["dropdown"];
} {
  const name = attrVal(block, "name");
  const enabled = hasTag(block, "enabled");

  if (/<w:textInput\b/i.test(block)) {
    const maxLenRaw = attrVal(block, "maxLength");
    return {
      name,
      enabled,
      type: "text",
      maxLength: maxLenRaw !== null ? Number.parseInt(maxLenRaw, 10) : null,
      checkbox: null,
      dropdown: null
    };
  }

  if (/<w:checkBox\b/i.test(block)) {
    const checkBoxMatch = block.match(/<w:checkBox\b[\s\S]*?<\/w:checkBox>/i);
    const cbXml = checkBoxMatch ? checkBoxMatch[0] : block;
    const defaultVal = attrVal(cbXml, "default");
    const checkedVal = attrVal(cbXml, "checked");
    const autoSize = hasTag(cbXml, "sizeAuto");
    return {
      name,
      enabled,
      type: "checkbox",
      maxLength: null,
      checkbox: {
        defaultChecked: defaultVal === null ? null : defaultVal === "1" || defaultVal.toLowerCase() === "true",
        currentlyChecked: checkedVal === null ? null : checkedVal === "1" || checkedVal.toLowerCase() === "true",
        autoSize
      },
      dropdown: null
    };
  }

  if (/<w:ddList\b/i.test(block)) {
    const ddMatch = block.match(/<w:ddList\b[\s\S]*?<\/w:ddList>/i);
    const ddXml = ddMatch ? ddMatch[0] : block;
    const resultRaw = attrVal(ddXml, "result");
    const listEntries: string[] = [];
    const entryRe = /<w:listEntry\b[^>]*\bw:val="([^"]*)"[^>]*\/?>/gi;
    let m: RegExpExecArray | null;
    while ((m = entryRe.exec(ddXml)) !== null) {
      listEntries.push(m[1]);
    }
    return {
      name,
      enabled,
      type: "dropdown",
      maxLength: null,
      checkbox: null,
      dropdown: {
        listEntries,
        resultIndex: resultRaw !== null ? Number.parseInt(resultRaw, 10) : null
      }
    };
  }

  return { name, enabled, type: "unknown", maxLength: null, checkbox: null, dropdown: null };
}

/** Resolves the default/current text value for a text-type ffData field, if encoded nearby.
 * Legacy text form fields encode their "current" value inside the ffData block itself only when
 * `<w:default w:val="..."/>` is present under `<w:textInput>`; the value visibly shown in the
 * document body between the field's "separate" and "end" fldChar markers is the true current
 * value shown to a user opening the form, and is resolved separately by the caller from
 * surrounding document.xml, not from inside the ffData block. This function only extracts the
 * `w:textInput/w:default` value when present.
 */
function textInputDefaultValue(block: string): string | null {
  const textInputMatch = block.match(/<w:textInput\b[\s\S]*?<\/w:textInput>/i);
  if (!textInputMatch) return null;
  return attrVal(textInputMatch[0], "default");
}

function countTableDepthBefore(xml: string, index: number): number {
  const upTo = xml.slice(0, index);
  const opens = (upTo.match(/<w:tbl>/g) ?? []).length;
  const closes = (upTo.match(/<\/w:tbl>/g) ?? []).length;
  return Math.max(0, opens - closes);
}

function countParagraphOrdinalBefore(xml: string, index: number): number {
  const upTo = xml.slice(0, index);
  return (upTo.match(/<w:p\b/g) ?? []).length;
}

export function buildDocxFieldInventory(bytes: Buffer): DocxFieldInventoryResult {
  const pkg = openDocxSafely(bytes, [DOCUMENT_XML_PART, SETTINGS_XML_PART]);

  const documentXmlBuf = pkg.parts.get(DOCUMENT_XML_PART);
  if (!documentXmlBuf) {
    throw new DocxSafetyError("MISSING_DOCUMENT_XML", "Package does not contain word/document.xml — not a valid Word document package.");
  }
  const documentXml = documentXmlBuf.toString("utf8");
  rejectUnsafeXmlDeclarations(documentXml, DOCUMENT_XML_PART);

  let settingsXml: string | null = null;
  const settingsBuf = pkg.parts.get(SETTINGS_XML_PART);
  if (settingsBuf) {
    settingsXml = settingsBuf.toString("utf8");
    rejectUnsafeXmlDeclarations(settingsXml, SETTINGS_XML_PART);
  }

  const fields: FfFieldInventoryEntry[] = [];
  const ffDataRe = /<w:ffData>([\s\S]*?)<\/w:ffData>/g;
  let match: RegExpExecArray | null;
  let order = 0;
  while ((match = ffDataRe.exec(documentXml)) !== null) {
    const block = match[1];
    const rawFfDataXml = match[0];
    const parsed = parseFfDataBlock(block);
    const defaultValue = parsed.type === "text" ? textInputDefaultValue(block) : null;

    fields.push({
      order: order++,
      name: parsed.name,
      type: parsed.type,
      defaultValue,
      maxLength: parsed.maxLength,
      checkbox: parsed.checkbox,
      dropdown: parsed.dropdown,
      enabled: parsed.enabled,
      paragraphOrdinal: countParagraphOrdinalBefore(documentXml, match.index),
      tableDepth: countTableDepthBefore(documentXml, match.index),
      rawFfDataXml
    });
  }

  const contentControlCount = (documentXml.match(/<w:sdt>/g) ?? []).length;

  const nameCounts = new Map<string, number>();
  let unnamedFieldCount = 0;
  let emptyNamedFieldCount = 0;
  for (const f of fields) {
    if (f.name === null) {
      unnamedFieldCount++;
    } else if (f.name === "") {
      emptyNamedFieldCount++;
    } else {
      nameCounts.set(f.name, (nameCounts.get(f.name) ?? 0) + 1);
    }
  }
  const duplicateNames = [...nameCounts.entries()].filter(([, count]) => count > 1).map(([n]) => n);
  const fieldsWithUnknownType = fields.filter(f => f.type === "unknown").length;
  const fieldsMissingEnabled = fields.filter(f => !f.enabled).length;

  let documentProtection: DocxFieldInventoryResult["documentProtection"] = {
    present: false,
    edit: null,
    enforcement: null
  };
  if (settingsXml) {
    const dpMatch = settingsXml.match(/<w:documentProtection\b[^>]*\/?>/i);
    if (dpMatch) {
      const editMatch = dpMatch[0].match(/\bw:edit="([^"]*)"/i);
      const enforcementMatch = dpMatch[0].match(/\bw:enforcement="([^"]*)"/i);
      documentProtection = {
        present: true,
        edit: editMatch ? editMatch[1] : null,
        enforcement: enforcementMatch ? enforcementMatch[1] === "1" || enforcementMatch[1].toLowerCase() === "true" : null
      };
    }
  }

  return {
    usesLegacyFormFields: fields.length > 0,
    usesContentControls: contentControlCount > 0,
    contentControlCount,
    fields,
    anomalies: {
      duplicateNames,
      unnamedFieldCount,
      emptyNamedFieldCount,
      fieldsWithUnknownType,
      fieldsMissingEnabled
    },
    documentProtection,
    allPackagePartNames: pkg.allEntryNames
  };
}

export { DocxSafetyError } from "./docxZipSafe.js";
