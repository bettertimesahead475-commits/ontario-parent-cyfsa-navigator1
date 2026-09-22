// Stage 9D-4B-2A-i — field inventory parser correctness tests (synthetic OOXML).
import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import { buildDocxFieldInventory } from "./docxFieldInventory.js";
import { DocxSafetyError } from "./docxZipSafe.js";

// --- Minimal ZIP builder (kept intentionally separate/duplicated from docxZipSafe.test.ts's
// builder so each test file is self-contained and one file's bugs can't mask the other's).
function buildDocxBuffer(documentXml: string, settingsXml?: string): Buffer {
  const entries: { name: string; data: Buffer }[] = [
    { name: "word/document.xml", data: Buffer.from(documentXml, "utf8") }
  ];
  if (settingsXml !== undefined) {
    entries.push({ name: "word/settings.xml", data: Buffer.from(settingsXml, "utf8") });
  }

  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  let offset = 0;
  for (const e of entries) {
    const compressed = zlib.deflateRawSync(e.data);
    const nameBuf = Buffer.from(e.name, "utf8");
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(20, 4);
    localHeader.writeUInt16LE(0, 6);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt32LE(0, 14);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(e.data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    localHeader.writeUInt16LE(0, 28);
    const localEntry = Buffer.concat([localHeader, nameBuf, compressed]);
    localParts.push(localEntry);

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(20, 4);
    centralHeader.writeUInt16LE(20, 6);
    centralHeader.writeUInt16LE(0, 8);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt32LE(0, 16);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(e.data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt32LE(offset, 42);
    centralParts.push(Buffer.concat([centralHeader, nameBuf]));
    offset += localEntry.length;
  }
  const localSection = Buffer.concat(localParts);
  const centralSection = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralSection.length, 12);
  eocd.writeUInt32LE(localSection.length, 16);
  return Buffer.concat([localSection, centralSection, eocd]);
}

const TEXT_FIELD = `
<w:p><w:r><w:fldChar w:fldCharType="begin"><w:ffData>
  <w:name w:val="CourtFileNo"/>
  <w:enabled/>
  <w:calcOnExit w:val="0"/>
  <w:textInput><w:maxLength w:val="40"/></w:textInput>
</w:ffData></w:fldChar></w:r></w:p>`;

const CHECKBOX_FIELD = `
<w:p><w:r><w:fldChar w:fldCharType="begin"><w:ffData>
  <w:name w:val="Check1"/>
  <w:enabled/>
  <w:checkBox><w:sizeAuto/><w:default w:val="0"/><w:checked w:val="1"/></w:checkBox>
</w:ffData></w:fldChar></w:r></w:p>`;

const DROPDOWN_FIELD = `
<w:p><w:r><w:fldChar w:fldCharType="begin"><w:ffData>
  <w:name w:val="Lang"/>
  <w:enabled/>
  <w:ddList>
    <w:result w:val="1"/>
    <w:listEntry w:val="English"/>
    <w:listEntry w:val="French"/>
  </w:ddList>
</w:ffData></w:fldChar></w:r></w:p>`;

function wrapDoc(...bodyParts: string[]): string {
  return `<?xml version="1.0"?><w:document><w:body>${bodyParts.join("")}</w:body></w:document>`;
}

describe("buildDocxFieldInventory: field type parsing", () => {
  it("parses a text field with name, maxLength and enabled", () => {
    const doc = buildDocxBuffer(wrapDoc(TEXT_FIELD));
    const inv = buildDocxFieldInventory(doc);
    expect(inv.usesLegacyFormFields).toBe(true);
    expect(inv.usesContentControls).toBe(false);
    expect(inv.fields).toHaveLength(1);
    expect(inv.fields[0]).toMatchObject({ name: "CourtFileNo", type: "text", maxLength: 40, enabled: true });
  });

  it("parses a checkbox field's default/current checked state", () => {
    const doc = buildDocxBuffer(wrapDoc(CHECKBOX_FIELD));
    const inv = buildDocxFieldInventory(doc);
    expect(inv.fields[0]).toMatchObject({
      name: "Check1",
      type: "checkbox",
      checkbox: { defaultChecked: false, currentlyChecked: true, autoSize: true }
    });
  });

  it("parses a dropdown field's list entries and selected result index", () => {
    const doc = buildDocxBuffer(wrapDoc(DROPDOWN_FIELD));
    const inv = buildDocxFieldInventory(doc);
    expect(inv.fields[0]).toMatchObject({
      name: "Lang",
      type: "dropdown",
      dropdown: { listEntries: ["English", "French"], resultIndex: 1 }
    });
  });

  it("preserves field ordering as they appear in the document", () => {
    const doc = buildDocxBuffer(wrapDoc(TEXT_FIELD, CHECKBOX_FIELD, DROPDOWN_FIELD));
    const inv = buildDocxFieldInventory(doc);
    expect(inv.fields.map(f => f.name)).toEqual(["CourtFileNo", "Check1", "Lang"]);
    expect(inv.fields.map(f => f.order)).toEqual([0, 1, 2]);
  });
});

describe("buildDocxFieldInventory: anomaly detection", () => {
  it("flags duplicate non-empty field names", () => {
    const dup = TEXT_FIELD.replace("CourtFileNo", "SameName");
    const doc = buildDocxBuffer(wrapDoc(dup, dup));
    const inv = buildDocxFieldInventory(doc);
    expect(inv.anomalies.duplicateNames).toEqual(["SameName"]);
  });

  it("distinguishes an unnamed field (no <w:name>) from an empty-named field (w:val=\"\")", () => {
    const noName = TEXT_FIELD.replace(/<w:name[^/]*\/>\s*/, "");
    const emptyName = TEXT_FIELD.replace('w:val="CourtFileNo"', 'w:val=""');
    const doc = buildDocxBuffer(wrapDoc(noName, emptyName));
    const inv = buildDocxFieldInventory(doc);
    expect(inv.fields[0].name).toBeNull();
    expect(inv.fields[1].name).toBe("");
    expect(inv.anomalies.unnamedFieldCount).toBe(1);
    expect(inv.anomalies.emptyNamedFieldCount).toBe(1);
  });

  it("counts fields missing <w:enabled/>", () => {
    const disabled = TEXT_FIELD.replace("<w:enabled/>", "");
    const doc = buildDocxBuffer(wrapDoc(disabled));
    const inv = buildDocxFieldInventory(doc);
    expect(inv.anomalies.fieldsMissingEnabled).toBe(1);
    expect(inv.fields[0].enabled).toBe(false);
  });

  it("reports a field with none of textInput/checkBox/ddList as type 'unknown'", () => {
    const weird = `<w:p><w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="Mystery"/></w:ffData></w:fldChar></w:r></w:p>`;
    const doc = buildDocxBuffer(wrapDoc(weird));
    const inv = buildDocxFieldInventory(doc);
    expect(inv.fields[0].type).toBe("unknown");
    expect(inv.anomalies.fieldsWithUnknownType).toBe(1);
  });
});

describe("buildDocxFieldInventory: context (paragraph/table) tracking", () => {
  it("tracks table nesting depth around a field", () => {
    const nested = `<w:tbl>${TEXT_FIELD}<w:tbl>${CHECKBOX_FIELD}</w:tbl></w:tbl>${DROPDOWN_FIELD}`;
    const doc = buildDocxBuffer(wrapDoc(nested));
    const inv = buildDocxFieldInventory(doc);
    expect(inv.fields[0].tableDepth).toBe(1); // CourtFileNo: inside one <w:tbl>
    expect(inv.fields[1].tableDepth).toBe(2); // Check1: inside nested <w:tbl><w:tbl>
    expect(inv.fields[2].tableDepth).toBe(0); // Lang: outside all tables
  });

  it("tracks an increasing paragraph ordinal across sibling fields", () => {
    const doc = buildDocxBuffer(wrapDoc(TEXT_FIELD, CHECKBOX_FIELD));
    const inv = buildDocxFieldInventory(doc);
    expect(inv.fields[1].paragraphOrdinal).toBeGreaterThan(inv.fields[0].paragraphOrdinal);
  });
});

describe("buildDocxFieldInventory: document protection and SDT detection", () => {
  it("reports documentProtection settings when settings.xml declares forms-only editing", () => {
    const settings = `<w:settings><w:documentProtection w:edit="forms" w:enforcement="1"/></w:settings>`;
    const doc = buildDocxBuffer(wrapDoc(TEXT_FIELD), settings);
    const inv = buildDocxFieldInventory(doc);
    expect(inv.documentProtection).toEqual({ present: true, edit: "forms", enforcement: true });
  });

  it("reports documentProtection absent when settings.xml has none", () => {
    const doc = buildDocxBuffer(wrapDoc(TEXT_FIELD), `<w:settings/>`);
    const inv = buildDocxFieldInventory(doc);
    expect(inv.documentProtection.present).toBe(false);
  });

  it("detects SDT content controls distinctly from legacy ffData fields", () => {
    const doc = buildDocxBuffer(wrapDoc(`<w:sdt><w:sdtContent/></w:sdt>`));
    const inv = buildDocxFieldInventory(doc);
    expect(inv.usesLegacyFormFields).toBe(false);
    expect(inv.usesContentControls).toBe(true);
    expect(inv.contentControlCount).toBe(1);
  });
});

describe("buildDocxFieldInventory: adversarial XML rejection", () => {
  it("refuses to scan a document.xml containing a DOCTYPE declaration", () => {
    const malicious = `<?xml version="1.0"?><!DOCTYPE foo [<!ENTITY xxe "pwned">]><w:document><w:body>${TEXT_FIELD}</w:body></w:document>`;
    const doc = buildDocxBuffer(malicious);
    expect(() => buildDocxFieldInventory(doc)).toThrow(DocxSafetyError);
  });

  it("throws MISSING_DOCUMENT_XML when the package has no word/document.xml", () => {
    const zip = buildDocxBuffer(wrapDoc(TEXT_FIELD));
    // Rebuild a package that only contains an unrelated part.
    const emptyPkgEntries = [{ name: "word/other.xml", data: Buffer.from("<x/>") }];
    // Reuse the same builder logic indirectly is overkill; simplest is to assert on a package
    // built without the document part using the shared helper name mismatch behavior:
    void zip; // (kept to show intent; real assertion below uses a fresh buffer)
    const localHeader = Buffer.alloc(30);
    const nameBuf = Buffer.from("word/other.xml");
    const data = Buffer.from("<x/>");
    const compressed = zlib.deflateRawSync(data);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(8, 8);
    localHeader.writeUInt32LE(compressed.length, 18);
    localHeader.writeUInt32LE(data.length, 22);
    localHeader.writeUInt16LE(nameBuf.length, 26);
    const localEntry = Buffer.concat([localHeader, nameBuf, compressed]);
    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(8, 10);
    centralHeader.writeUInt32LE(compressed.length, 20);
    centralHeader.writeUInt32LE(data.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt32LE(0, 42);
    const centralEntry = Buffer.concat([centralHeader, nameBuf]);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(1, 8);
    eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(centralEntry.length, 12);
    eocd.writeUInt32LE(localEntry.length, 16);
    const pkg = Buffer.concat([localEntry, centralEntry, eocd]);
    expect(() => buildDocxFieldInventory(pkg)).toThrow(DocxSafetyError);
  });
});
