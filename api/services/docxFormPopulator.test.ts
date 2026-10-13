// Tests use SYNTHETIC legacy-field DOCX fixtures built in this file. They prove the population
// mechanics only. They are not, and must not be read as, the prescribed Ontario court forms.
import { describe, it, expect } from "vitest";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { buildDocxFieldInventory } from "./docxFieldInventory.js";
import { populateLegacyFormFields, readLegacyFieldValues, DocxPopulationError, escapeXmlText } from "./docxFormPopulator.js";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function textField(name: string, shown: string, maxLength?: number): string {
  const max = maxLength === undefined ? "" : `<w:maxLength w:val="${maxLength}"/>`;
  return (
    `<w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="${name}"/><w:enabled/>` +
    `<w:textInput>${max}</w:textInput></w:ffData></w:fldChar></w:r>` +
    `<w:r><w:instrText xml:space="preserve"> FORMTEXT </w:instrText></w:r>` +
    `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
    `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${shown}</w:t></w:r>` +
    `<w:r><w:fldChar w:fldCharType="end"/></w:r>`
  );
}

function checkField(name: string, checked: boolean): string {
  return (
    `<w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="${name}"/><w:enabled/>` +
    `<w:checkBox><w:sizeAuto/><w:default w:val="0"/>${checked ? "<w:checked/>" : ""}</w:checkBox></w:ffData></w:fldChar></w:r>` +
    `<w:r><w:instrText xml:space="preserve"> FORMCHECKBOX </w:instrText></w:r>` +
    `<w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
    `<w:r><w:fldChar w:fldCharType="end"/></w:r>`
  );
}

function syntheticDocx(bodyXml: string, extraParts: Record<string, string> = {}): Buffer {
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${W}><w:body>${bodyXml}</w:body></w:document>`;
  const parts: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"/>`
    ),
    "word/document.xml": strToU8(documentXml),
    "docProps/custom.xml": strToU8("<Properties/>")
  };
  for (const [k, v] of Object.entries(extraParts)) parts[k] = strToU8(v);
  return Buffer.from(zipSync(parts));
}

const STATIC_LABEL = "Applicant name: ";
const baseBody =
  `<w:p><w:r><w:t>${STATIC_LABEL}</w:t></w:r>${textField("applicant_name", "PLACEHOLDER", 40)}</w:p>` +
  `<w:p><w:r><w:t>Consent: </w:t></w:r>${checkField("consent", false)}<w:r><w:t>I consent.</w:t></w:r></w:p>` +
  `<w:p><w:r><w:t>Notes: </w:t></w:r>${textField("notes", "none")}</w:p>`;

describe("populateLegacyFormFields (synthetic fixtures)", () => {
  it("writes text and checkbox values and reads them back", () => {
    const out = populateLegacyFormFields(syntheticDocx(baseBody), { applicant_name: "Jordan Lee", consent: true, notes: "Filed by parent" });
    expect(readLegacyFieldValues(out)).toEqual({ applicant_name: "Jordan Lee", consent: true, notes: "Filed by parent" });
  });

  it("preserves static text, field order, and unrelated package parts byte-for-byte", () => {
    const input = syntheticDocx(baseBody);
    const out = populateLegacyFormFields(input, { applicant_name: "Jordan Lee" });
    const before = unzipSync(new Uint8Array(input));
    const after = unzipSync(new Uint8Array(out));
    expect(Object.keys(after).sort()).toEqual(Object.keys(before).sort());
    expect(strFromU8(after["[Content_Types].xml"])).toEqual(strFromU8(before["[Content_Types].xml"]));
    expect(strFromU8(after["docProps/custom.xml"])).toEqual("<Properties/>");
    const xml = strFromU8(after["word/document.xml"]);
    expect(xml).toContain(STATIC_LABEL);
    expect(xml).toContain("I consent.");
    expect(xml.indexOf("applicant_name")).toBeLessThan(xml.indexOf('w:name w:val="consent"'));
    expect(xml).toContain("<w:b/>"); // result run formatting is retained
    expect(buildDocxFieldInventory(out).fields.map(f => f.name)).toEqual(["applicant_name", "consent", "notes"]);
  });

  it("writes the result inside its own run, never nested in the field's run", () => {
    const out = populateLegacyFormFields(syntheticDocx(baseBody), { applicant_name: "Jordan Lee", consent: true });
    const xml = strFromU8(unzipSync(new Uint8Array(out))["word/document.xml"]);
    expect(xml).toContain('<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Jordan Lee</w:t></w:r>');
    expect(xml).not.toMatch(/<w:r>(?:(?!<\/w:r>)[\s\S])*<w:r[ >]/);
  });

  it("fails closed when the end marker shares a run with result text", () => {
    const shared =
      `<w:p><w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="notes"/><w:enabled/><w:textInput/></w:ffData></w:fldChar></w:r>` +
      `<w:r><w:instrText xml:space="preserve"> FORMTEXT </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>` +
      `<w:r><w:t>x</w:t><w:fldChar w:fldCharType="end"/></w:r></w:p>`;
    expect(() => populateLegacyFormFields(syntheticDocx(shared), { notes: "y" })).toThrow(/shares a run/);
  });

  it("escapes XML-significant characters so values cannot inject markup", () => {
    const hostile = `A & B <c> "q" 'x'`;
    const out = populateLegacyFormFields(syntheticDocx(baseBody), { applicant_name: hostile });
    expect(readLegacyFieldValues(out).applicant_name).toBe(hostile);
    expect(strFromU8(unzipSync(new Uint8Array(out))["word/document.xml"])).not.toContain("<c>");
  });

  it("clears a checkbox that was checked", () => {
    const checkedBody = `<w:p>${checkField("consent", true)}</w:p>`;
    const out = populateLegacyFormFields(syntheticDocx(checkedBody), { consent: false });
    expect(readLegacyFieldValues(out).consent).toBe(false);
  });

  it("rejects a field name that the template does not contain", () => {
    expect(() => populateLegacyFormFields(syntheticDocx(baseBody), { no_such_field: "x" })).toThrow(DocxPopulationError);
  });

  it("rejects multi-line text, control characters, and overlong text", () => {
    const doc = syntheticDocx(baseBody);
    expect(() => populateLegacyFormFields(doc, { applicant_name: "line1\nline2" })).toThrow(/single-line/);
    expect(() => populateLegacyFormFields(doc, { applicant_name: "bad\u0001char" })).toThrow(/cannot store/);
    expect(() => populateLegacyFormFields(doc, { applicant_name: "x".repeat(41) })).toThrow(/at most 40/);
  });

  it("rejects a boolean for a text field and a string for a checkbox", () => {
    const doc = syntheticDocx(baseBody);
    expect(() => populateLegacyFormFields(doc, { applicant_name: true as unknown as string })).toThrow(/needs a string/);
    expect(() => populateLegacyFormFields(doc, { consent: "yes" as unknown as boolean })).toThrow(/needs a boolean/);
  });

  it("fails closed on duplicate field names", () => {
    const dup = syntheticDocx(baseBody + `<w:p>${textField("notes", "again")}</w:p>`);
    expect(() => populateLegacyFormFields(dup, { notes: "x" })).toThrow(/Duplicate field names|DUPLICATE/);
  });

  it("fails closed when the template contains content controls", () => {
    const sdt = syntheticDocx(baseBody + `<w:sdt><w:sdtContent><w:p/></w:sdtContent></w:sdt>`);
    expect(() => populateLegacyFormFields(sdt, { notes: "x" })).toThrow(/content controls/);
  });

  it("fails closed on a field without a separate marker", () => {
    const broken = syntheticDocx(
      `<w:p><w:r><w:fldChar w:fldCharType="begin"><w:ffData><w:name w:val="notes"/><w:enabled/><w:textInput/></w:ffData></w:fldChar></w:r><w:r><w:t>x</w:t></w:r></w:p>`
    );
    expect(() => populateLegacyFormFields(broken, { notes: "y" })).toThrow(DocxPopulationError);
  });

  it("escapeXmlText escapes all five XML predefined entities", () => {
    expect(escapeXmlText(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;");
  });
});
