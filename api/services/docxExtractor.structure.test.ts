import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { extractDocxDocument, extractTextFromDocx, MAX_XML_PART_CHARS } from "./docxExtractor.js";
import { buildZip } from "../testSupport/docxFixture.js";

const W = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const NS = `${W} xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:v="urn:schemas-microsoft-com:vml" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"`;
const xml = (root: string, body: string) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><${root} ${NS}>${body}</${root}>`;
const para = (text: string) => `<w:p><w:r><w:t xml:space="preserve">${text}</w:t></w:r></w:p>`;
const docBody = (inner: string) => xml("w:document", `<w:body>${inner}<w:sectPr/></w:body>`);
const rels = (items: string) =>
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${items}</Relationships>`;
const IMAGE_REL = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";

describe("extractDocxDocument: Word structure", () => {
  it("keeps body paragraphs and tables in authored order, with cell boundaries", () => {
    const body = para("Before the table") +
      `<w:tbl><w:tr><w:tc>${para("Date")}</w:tc><w:tc>${para("Event")}</w:tc></w:tr>` +
      `<w:tr><w:tc>${para("2026-01-04")}</w:tc><w:tc>${para("Visit cancelled")}</w:tc></w:tr></w:tbl>` +
      para("After the table");
    const doc = extractDocxDocument(buildZip({ "word/document.xml": docBody(body) }));
    expect(doc.text).toBe("Before the table\n\nDate | Event\n2026-01-04 | Visit cancelled\n\nAfter the table");
    const table = doc.blocks.find((b) => b.kind === "table");
    expect(table?.rows).toEqual([["Date", "Event"], ["2026-01-04", "Visit cancelled"]]);
    expect(doc.complete).toBe(true);
  });

  it("preserves tabs and line breaks", () => {
    const body = `<w:p><w:r><w:t>Date</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>Amount</w:t></w:r></w:p>` +
      `<w:p><w:r><w:t>Line one</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>Line two</w:t></w:r></w:p>`;
    expect(extractTextFromDocx(buildZip({ "word/document.xml": docBody(body) }))).toBe("Date\tAmount\n\nLine one\nLine two");
  });

  it("reads headers and footers with labels, so case numbers and page footers are not lost", () => {
    const pkg = buildZip({
      "word/document.xml": docBody(para("Affidavit body")),
      "word/header1.xml": xml("w:hdr", para("COURT FILE NO: FC-26-8888")),
      "word/footer1.xml": xml("w:ftr", para("Page footer text")),
    });
    const doc = extractDocxDocument(pkg);
    expect(doc.text.split("\n\n")).toEqual([
      "[Header] COURT FILE NO: FC-26-8888",
      "Affidavit body",
      "[Footer] Page footer text",
    ]);
  });

  it("reads text box content once, after its paragraph, and does not duplicate the legacy fallback", () => {
    const drawing = (inner: string) => `<w:r><w:drawing><wp:inline><a:graphic><a:graphicData><w:txbxContent>${inner}</w:txbxContent></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
    const body = `<w:p><mc:AlternateContent><mc:Choice Requires="wps">${drawing(para("BOX TEXT"))}</mc:Choice>` +
      `<mc:Fallback><w:r><w:pict>${`<w:txbxContent>${para("BOX TEXT")}</w:txbxContent>`}</w:pict></w:r></mc:Fallback></mc:AlternateContent>` +
      `<w:r><w:t>AFTER BOX</w:t></w:r></w:p>`;
    const doc = extractDocxDocument(buildZip({ "word/document.xml": docBody(body) }));
    expect(doc.text.match(/BOX TEXT/g)).toHaveLength(1);
    expect(doc.text).toContain("AFTER BOX");
    expect(doc.blocks.some((b) => b.kind === "textbox")).toBe(true);
  });

  it("includes footnotes with their numbers and skips separator entries", () => {
    const pkg = buildZip({
      "word/document.xml": docBody(`<w:p><w:r><w:t>Claim</w:t></w:r><w:r><w:footnoteReference w:id="1"/></w:r></w:p>`),
      "word/footnotes.xml": xml("w:footnotes",
        `<w:footnote w:type="separator" w:id="-1">${para("")}</w:footnote>` +
        `<w:footnote w:id="1">${para("See s. 74 of the CYFSA")}</w:footnote>`),
    });
    const doc = extractDocxDocument(pkg);
    // The reference stays in the body where it occurs, and the note text follows as its own labelled block.
    expect(doc.text).toContain("Claim[footnote 1]");
    expect(doc.text).toContain("[Footnote 1] See s. 74 of the CYFSA");
    expect(doc.text).not.toContain("[Footnote -1]");
  });

  it("excludes tracked deletions, counts them, and marks the result incomplete", () => {
    const body = `<w:p><w:r><w:t>Kept wording </w:t></w:r><w:del w:id="1" w:author="x"><w:r><w:delText>removed wording</w:delText></w:r></w:del><w:ins w:id="2" w:author="x"><w:r><w:t>inserted</w:t></w:r></w:ins></w:p>`;
    const doc = extractDocxDocument(buildZip({ "word/document.xml": docBody(body) }));
    expect(doc.text).toBe("Kept wording inserted");
    expect(doc.trackedDeletionsSkipped).toBe(1);
    expect(doc.complete).toBe(false);
    expect(doc.notes.join(" ")).toMatch(/tracked deletion/);
  });

  it("detects embedded images, reports them, and marks the extraction incomplete", () => {
    const pkg = buildZip({
      "word/document.xml": docBody(`${para("Letterhead follows")}<w:p><w:r><w:drawing><a:blip r:embed="rId5"/></w:drawing></w:r></w:p>`),
      "word/_rels/document.xml.rels": rels(`<Relationship Id="rId5" Type="${IMAGE_REL}" Target="media/image1.png"/>`),
      "word/media/image1.png": "not really a png, only the entry matters",
    });
    const doc = extractDocxDocument(pkg);
    expect(doc.images).toEqual([{ part: "word/document.xml", target: "word/media/image1.png" }]);
    expect(doc.complete).toBe(false);
    expect(doc.notes.join(" ")).toMatch(/embedded image/);
    expect(doc.text).toBe("Letterhead follows");
  });

  it("flags an image reference with no relationship instead of ignoring it", () => {
    const pkg = buildZip({
      "word/document.xml": docBody(`${para("Text")}<w:p><w:r><w:drawing><a:blip r:embed="rIdMissing"/></w:drawing></w:r></w:p>`),
    });
    const doc = extractDocxDocument(pkg);
    expect(doc.complete).toBe(false);
    expect(doc.notes.join(" ")).toMatch(/rIdMissing/);
  });

  it("reads core metadata and records the declared page count as metadata only", () => {
    const pkg = buildZip({
      "word/document.xml": docBody(para("Body")),
      "docProps/core.xml": xml("cp:coreProperties", `<dc:title>Affidavit draft</dc:title><dc:creator>Worker A</dc:creator><dcterms:modified>2026-02-01T10:00:00Z</dcterms:modified>`)
        .replace(`${NS}`, `${NS} xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"`),
      "docProps/app.xml": `<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Pages>7</Pages></Properties>`,
    });
    const doc = extractDocxDocument(pkg);
    expect(doc.metadata).toMatchObject({ title: "Affidavit draft", author: "Worker A", modified: "2026-02-01T10:00:00Z", declaredPageCount: "7" });
  });

  it("content controls (w:sdt) are read in place", () => {
    const body = `<w:sdt><w:sdtContent>${para("Inside a content control")}</w:sdtContent></w:sdt>`;
    expect(extractTextFromDocx(buildZip({ "word/document.xml": docBody(body) }))).toBe("Inside a content control");
  });
});

describe("extractDocxDocument: safety", () => {
  it("refuses an XML document type declaration (entity expansion vector)", () => {
    const bomb = `<?xml version="1.0"?><!DOCTYPE w:document [<!ENTITY a "aaaa">]><w:document ${W}><w:body><w:p><w:r><w:t>&a;</w:t></w:r></w:p></w:body></w:document>`;
    expect(() => extractDocxDocument(buildZip({ "word/document.xml": bomb }))).toThrow(/document type declaration/);
  });

  it("refuses a package without word/document.xml", () => {
    expect(() => extractDocxDocument(buildZip({ "other.txt": "hello" }))).toThrow(/word\/document.xml not found/);
  });

  it("refuses a part too large to parse safely, before parsing it", () => {
    // Incompressible filler, so the ZIP ratio guard does not reject the archive before the XML size check runs.
    const filler = randomBytes(MAX_XML_PART_CHARS / 2).toString("hex");
    const huge = docBody(para("x")) + filler;
    expect(() => extractDocxDocument(buildZip({ "word/document.xml": huge }))).toThrow(/too large to read safely/);
  });

  it("refuses malformed XML rather than returning partial text", () => {
    expect(() => extractDocxDocument(buildZip({ "word/document.xml": "<w:document><w:body><w:p>" }))).toThrow();
  });

  it("refuses a package with no readable text and no images", () => {
    expect(() => extractDocxDocument(buildZip({ "word/document.xml": docBody("<w:p/>") }))).toThrow(/No readable text/);
  });

  it("refuses a file that is not a ZIP archive", () => {
    expect(() => extractDocxDocument(Buffer.from("this is plain text, not a word file at all"))).toThrow();
  });
});
