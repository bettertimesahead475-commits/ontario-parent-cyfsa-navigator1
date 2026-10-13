// Stage 9D — DOCX population for legacy w:ffData form fields.
//
// Writes values into the exact legacy form fields of a DOCX template. Only the value state of
// the named fields changes: a text field's displayed result runs (between its `separate` and
// `end` fldChar markers) and a checkbox's `w:checked` state. Every other byte of the package is
// copied through unchanged. The caller must supply values released by
// getReviewedValuesForPopulation(); this module does not decide what a value should be.
//
// Fail-closed: unknown or duplicate field names, unnamed fields, content controls, unsupported
// field structure, multi-line text, control characters, overlong text and dropdown values
// throw DocxPopulationError. After writing, the output is re-inventoried and every populated
// value is read back and compared; any mismatch throws rather than returning a document.
import { zipSync } from "fflate";
import { buildDocxFieldInventory, type FfFieldInventoryEntry } from "./docxFieldInventory.js";
import { openDocxSafely } from "./docxZipSafe.js";

export class DocxPopulationError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = "DocxPopulationError";
    this.code = code;
  }
}

const DOCUMENT_XML_PART = "word/document.xml";
const FFDATA_RE = /<w:ffData>([\s\S]*?)<\/w:ffData>/g;
const SEPARATE_RE = /<w:fldChar\s+w:fldCharType="separate"\s*\/>/;
const END_RE = /<w:fldChar\s+w:fldCharType="end"\s*\/>/;
const BEGIN_RE = /<w:fldChar\s+w:fldCharType="begin"/;
// XML 1.0 forbids C0 controls other than tab, LF and CR; line breaks are rejected separately.
const FORBIDDEN_CONTROL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/;

export type LegacyFieldValue = string | boolean;

export function escapeXmlText(value: string): string {
  return value.replace(/[&<>"']/g, ch => {
    switch (ch) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      default: return "&apos;";
    }
  });
}

function unescapeXmlText(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

interface TextFieldSpan {
  resultStart: number;
  resultEnd: number;
  resultXml: string;
}

/** Index of the start of the `w:r` run that contains `index`, or -1. */
function runStartContaining(xml: string, index: number): number {
  const re = /<w:r(?:\s[^>]*)?>/g;
  let last = -1;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null && m.index < index) last = m.index;
  return last;
}

/**
 * Locate the displayed result region of the legacy field whose ffData block begins at `fromIndex`.
 * The region is aligned to whole runs: it starts after the run that holds `separate` and ends at
 * the run that holds `end`. Anything that does not sit cleanly on run boundaries fails closed,
 * because splicing inside a run would produce nested or invalid WordprocessingML.
 */
function locateResultRegion(xml: string, fromIndex: number, fieldName: string): TextFieldSpan {
  const unsupported = (why: string) => new DocxPopulationError("UNSUPPORTED_FIELD_STRUCTURE", `Field "${fieldName}": ${why}.`);
  const rest = xml.slice(fromIndex);
  const sep = SEPARATE_RE.exec(rest);
  if (!sep) throw unsupported("no separate marker");
  const sepIndex = fromIndex + sep.index;
  const sepRunStart = runStartContaining(xml, sepIndex);
  const sepRunClose = xml.indexOf("</w:r>", sepIndex);
  if (sepRunStart < 0 || sepRunClose < 0) throw unsupported("separate marker is not inside a run");
  const sepRunOpen = /^<w:r(?:\s[^>]*)?>/.exec(xml.slice(sepRunStart))![0];
  if (xml.slice(sepRunStart + sepRunOpen.length, sepIndex) !== "" || xml.slice(sepIndex + sep[0].length, sepRunClose) !== "") {
    throw unsupported("separate marker shares a run with other content");
  }
  const resultStart = sepRunClose + "</w:r>".length;

  const endMatch = END_RE.exec(xml.slice(resultStart));
  if (!endMatch) throw unsupported("no end marker");
  const endIndex = resultStart + endMatch.index;
  const endRunStart = runStartContaining(xml, endIndex);
  if (endRunStart < resultStart) throw unsupported("end marker is not inside a run after the result");
  const endRunOpen = /^<w:r(?:\s[^>]*)?>/.exec(xml.slice(endRunStart))![0];
  if (xml.slice(endRunStart + endRunOpen.length, endIndex) !== "") {
    throw unsupported("end marker shares a run with result text");
  }
  const resultXml = xml.slice(resultStart, endRunStart);
  if (BEGIN_RE.test(resultXml) || /<w:fldChar\b/.test(resultXml)) throw unsupported("result contains another field marker");
  return { resultStart, resultEnd: endRunStart, resultXml };
}

function readResultText(resultXml: string): string {
  const parts: string[] = [];
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(resultXml)) !== null) parts.push(unescapeXmlText(m[1]));
  return parts.join("");
}

function buildResultRun(resultXml: string, value: string): string {
  const rPr = /<w:rPr>[\s\S]*?<\/w:rPr>/.exec(resultXml)?.[0] ?? "";
  if (value.length === 0) return "";
  return `<w:r>${rPr}<w:t xml:space="preserve">${escapeXmlText(value)}</w:t></w:r>`;
}

function validateTextValue(entry: FfFieldInventoryEntry, value: string): void {
  if (/[\r\n]/.test(value)) {
    throw new DocxPopulationError("MULTILINE_UNSUPPORTED", `Field "${entry.name}" is a single-line legacy text field.`);
  }
  if (FORBIDDEN_CONTROL_RE.test(value)) {
    throw new DocxPopulationError("INVALID_CHARACTERS", `Field "${entry.name}" contains characters that XML cannot store.`);
  }
  if (entry.maxLength !== null && [...value].length > entry.maxLength) {
    throw new DocxPopulationError("MAX_LENGTH_EXCEEDED", `Field "${entry.name}" allows at most ${entry.maxLength} characters.`);
  }
}

function assertPopulatable(docxBytes: Buffer, values: Record<string, LegacyFieldValue>) {
  const inventory = buildDocxFieldInventory(docxBytes);
  if (inventory.usesContentControls) {
    throw new DocxPopulationError("CONTENT_CONTROLS_UNSUPPORTED", "Template contains content controls, which this populator does not handle.");
  }
  if (inventory.anomalies.duplicateNames.length) {
    throw new DocxPopulationError("DUPLICATE_FIELD_NAMES", `Duplicate field names: ${inventory.anomalies.duplicateNames.join(", ")}`);
  }
  if (inventory.anomalies.unnamedFieldCount || inventory.anomalies.emptyNamedFieldCount) {
    throw new DocxPopulationError("UNNAMED_FIELDS", "Template contains fields without usable names.");
  }
  const byName = new Map(inventory.fields.map(f => [f.name as string, f]));
  for (const key of Object.keys(values)) {
    const entry = byName.get(key);
    if (!entry) throw new DocxPopulationError("UNKNOWN_FIELD", `Template has no field named "${key}".`);
    if (entry.type === "dropdown") throw new DocxPopulationError("DROPDOWN_UNSUPPORTED", `Dropdown field "${key}" is not populated by this module.`);
    if (entry.type === "unknown") throw new DocxPopulationError("UNKNOWN_FIELD_TYPE", `Field "${key}" has an unrecognised type.`);
    const value = values[key];
    if (entry.type === "checkbox" && typeof value !== "boolean") throw new DocxPopulationError("TYPE_MISMATCH", `Checkbox "${key}" needs a boolean.`);
    if (entry.type === "text") {
      if (typeof value !== "string") throw new DocxPopulationError("TYPE_MISMATCH", `Text field "${key}" needs a string.`);
      validateTextValue(entry, value);
    }
  }
  return inventory;
}

/** Rejects XML in which a w:r would contain another w:r. Word and LibreOffice drop such content. */
function assertRunsNotNested(xml: string): void {
  const re = /<w:r(?:\s[^>]*?)?(\/?)>|<\/w:r>/g;
  let depth = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    if (m[0] === "</w:r>") {
      depth--;
    } else if (m[1] !== "/") {
      depth++;
      if (depth > 1) throw new DocxPopulationError("VERIFICATION_FAILED", "Populated XML would nest runs.");
    }
    if (depth < 0) throw new DocxPopulationError("VERIFICATION_FAILED", "Populated XML has unbalanced runs.");
  }
  if (depth !== 0) throw new DocxPopulationError("VERIFICATION_FAILED", "Populated XML has unbalanced runs.");
}

/** Read back the current value of every legacy field: text result text, or checkbox state. */
export function readLegacyFieldValues(docxBytes: Buffer): Record<string, LegacyFieldValue | null> {
  const inventory = buildDocxFieldInventory(docxBytes);
  const xml = openDocxSafely(docxBytes, [DOCUMENT_XML_PART]).parts.get(DOCUMENT_XML_PART)!.toString("utf8");
  const out: Record<string, LegacyFieldValue | null> = {};
  const matches = [...xml.matchAll(FFDATA_RE)];
  inventory.fields.forEach((entry, i) => {
    if (entry.name === null) return;
    if (entry.type === "checkbox") out[entry.name] = entry.checkbox?.currentlyChecked ?? null;
    else if (entry.type === "text") {
      const span = locateResultRegion(xml, matches[i].index! + matches[i][0].length, entry.name);
      out[entry.name] = readResultText(span.resultXml);
    }
  });
  return out;
}

/**
 * Populate named legacy fields of a DOCX template and return the new package bytes. Throws
 * DocxPopulationError on any unsupported condition; never returns a partially populated document.
 */
export function populateLegacyFormFields(docxBytes: Buffer, values: Record<string, LegacyFieldValue>): Buffer {
  assertPopulatable(docxBytes, values);

  const allNames = openDocxSafely(docxBytes, []).allEntryNames;
  const pkg = openDocxSafely(docxBytes, allNames.filter(n => !n.endsWith("/")));
  const originalXml = pkg.parts.get(DOCUMENT_XML_PART)!.toString("utf8");

  const matches = [...originalXml.matchAll(FFDATA_RE)];
  const inventory = buildDocxFieldInventory(docxBytes);
  if (matches.length !== inventory.fields.length) {
    throw new DocxPopulationError("INVENTORY_MISMATCH", "Field inventory does not align with document XML.");
  }

  // Build replacements as [start, end, replacement] over the original XML, applied right-to-left.
  const edits: Array<{ start: number; end: number; text: string }> = [];
  inventory.fields.forEach((entry, i) => {
    if (entry.name === null || !(entry.name in values)) return;
    const value = values[entry.name];
    const ffStart = matches[i].index!;
    const ffEnd = ffStart + matches[i][0].length;
    if (entry.type === "checkbox") {
      const checkedOn = value === true;
      const block = matches[i][0];
      // An explicit w:val is written for both states so the result does not depend on the default.
      const checkedXml = checkedOn ? "<w:checked/>" : `<w:checked w:val="0"/>`;
      const replaced = /<w:checked\b[^>]*\/?>/.test(block)
        ? block.replace(/<w:checked\b[^>]*\/?>/, checkedXml)
        : block.replace("</w:checkBox>", `${checkedXml}</w:checkBox>`);
      edits.push({ start: ffStart, end: ffEnd, text: replaced });
    } else if (entry.type === "text") {
      const span = locateResultRegion(originalXml, ffEnd, entry.name);
      edits.push({ start: span.resultStart, end: span.resultEnd, text: buildResultRun(span.resultXml, value as string) });
    }
  });

  edits.sort((a, b) => b.start - a.start);
  let xml = originalXml;
  for (const e of edits) xml = xml.slice(0, e.start) + e.text + xml.slice(e.end);

  assertRunsNotNested(xml);

  const parts: Record<string, Uint8Array> = {};
  for (const name of allNames) {
    if (name.endsWith("/")) continue;
    const data = name === DOCUMENT_XML_PART ? Buffer.from(xml, "utf8") : pkg.parts.get(name);
    if (!data) throw new DocxPopulationError("PACKAGE_READ_FAILED", `Could not read package part ${name}.`);
    parts[name] = new Uint8Array(data);
  }
  const output = Buffer.from(zipSync(parts, { level: 6 }));

  // Read back what was written; never return a document whose values do not match the request.
  const readBack = readLegacyFieldValues(output);
  for (const [key, expected] of Object.entries(values)) {
    if (readBack[key] !== expected) throw new DocxPopulationError("VERIFICATION_FAILED", `Read-back mismatch for field "${key}".`);
  }
  return output;
}
