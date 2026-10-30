import { createHash } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { PDFDocument, PDFName, PDFRawStream } from "pdf-lib";
import { afterEach, describe, expect, it, vi } from "vitest";

const FIX = path.resolve(__dirname, "../tests/fixtures/synthetic");
const b64 = (f: string) => fs.readFileSync(path.join(FIX, f)).toString("base64");
const verify = vi.fn();
vi.mock("../functions/api/_auth-check", () => ({ verifyFirebaseRequest: (...a: unknown[]) => verify(...a) }));
const { handleExtractRequest } = await import("../functions/api/extract-text");
const { extractDocument, docxToText } = await import("../functions/api/_document-extraction");
const { classifyGeminiStatus, resolveGeminiModel, DEFAULT_GEMINI_OCR_MODEL } = await import("../functions/api/_gemini");

const ENV = { FIREBASE_PROJECT_ID: "p", GEMINI_API_KEY: "test-key-not-real" };
const signedIn = () => verify.mockResolvedValue({ status: "verified", uid: "u1", email: "u@example.test", emailVerified: true });

/** SHA-256 of every image XObject's raw bytes on each page, in page order. */
async function imageHashesPerPage(bytes: Uint8Array): Promise<string[][]> {
  const doc = await PDFDocument.load(bytes);
  return doc.getPages().map((p) => {
    const xobjects = p.node.Resources()?.lookup(PDFName.of("XObject")) as any;
    if (!xobjects) return [];
    return xobjects.keys().map((k: PDFName) => {
      const s = doc.context.lookup(xobjects.get(k)) as PDFRawStream;
      return createHash("sha256").update(s.contents).digest("hex");
    });
  });
}

const PAGE_TEXT = [
  "OCR PAGE ONE: AFFIDAVIT OF JORDAN EXAMPLE ... March 3, 2026 anonymous neighbour.",
  "OCR PAGE TWO: The caller reported that the child Riley Sample was left alone.",
  "OCR PAGE THREE: Sworn before me on March 10, 2026.",
];

/** A Gemini stand-in that "reads" a one-page PDF by recognising which original page's image it contains. */
async function pageAwareGemini(original: Uint8Array) {
  const byPage = await imageHashesPerPage(original);
  const calls: Array<{ url: string; key: string | null; pageSeen: number; body: any }> = [];
  const fetcher = vi.fn(async (url: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body));
    const inline = body.contents[0].parts.find((p: any) => p.inlineData).inlineData;
    let pageSeen = 0;
    if (inline.mimeType === "application/pdf") {
      const sent = await imageHashesPerPage(Buffer.from(inline.data, "base64"));
      expect(sent).toHaveLength(1); // one page per OCR request
      pageSeen = byPage.findIndex((h) => h.length > 0 && h.every((x) => sent[0].includes(x))) + 1;
    } else pageSeen = 2; // the PNG fixture is page two's image
    calls.push({ url, key: new Headers(init.headers).get("x-goog-api-key"), pageSeen, body });
    return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: PAGE_TEXT[pageSeen - 1] ?? "" }] }, finishReason: "STOP" }], usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 40 } }), { status: 200 });
  });
  return { fetcher, calls };
}

const req = (fileData: Record<string, unknown>) =>
  new Request("https://staging.example/api/extract-text", { method: "POST", headers: { Authorization: "Bearer a.b.c", "content-type": "application/json" }, body: JSON.stringify({ fileData }) });

describe("document extraction: formats and page attribution", () => {
  afterEach(() => verify.mockReset());

  it("reads a digital multi-page PDF from its text layer, page by page, with no OCR call", async () => {
    const fetcher = vi.fn();
    const r = await extractDocument({ base64: b64("03-digital-3-pages.pdf"), mimeType: "application/pdf", fileName: "affidavit.pdf" }, ENV, { fetcher });
    expect(fetcher).not.toHaveBeenCalled();
    expect(r.pageCount).toBe(3);
    expect(r.pageAttribution).toBe("per-page");
    expect(r.pages.map((p) => [p.pageNumber, p.extractionMethod, p.status])).toEqual([[1, "TEXT_LAYER", "ok"], [2, "TEXT_LAYER", "ok"], [3, "TEXT_LAYER", "ok"]]);
    expect(r.pages[0].text).toContain("Page one");
    expect(r.pages[1].text).toContain("Page two");
    expect(r.pages[2].text).toContain("Sworn before me on March 10, 2026");
    expect(r.extractedText).toMatch(/^\[Page 1\]\n[\s\S]*\[Page 2\]\n[\s\S]*\[Page 3\]\n/);
    expect(r.pages[1].sourceLocation).toEqual({ documentId: r.documentId, fileName: "affidavit.pdf", page: 2 });
    expect(r.pages.every((p) => !("confidence" in p))).toBe(true);
  });

  it("OCRs each scanned page separately and attributes each result to the page it came from", async () => {
    const original = fs.readFileSync(path.join(FIX, "04-scanned-3-pages.pdf"));
    const g = await pageAwareGemini(original);
    const r = await extractDocument({ base64: original.toString("base64"), mimeType: "application/pdf", fileName: "scan.pdf" }, ENV, { fetcher: g.fetcher as any });
    expect(g.calls.map((c) => c.pageSeen).sort()).toEqual([1, 2, 3]);
    expect(r.pages.map((p) => [p.pageNumber, p.extractionMethod])).toEqual([[1, "OCR"], [2, "OCR"], [3, "OCR"]]);
    r.pages.forEach((p, i) => expect(p.text).toBe(PAGE_TEXT[i])); // page N's text came from page N's image
    expect(r.ocr).toMatchObject({ calls: 3, promptTokens: 900, outputTokens: 120, model: DEFAULT_GEMINI_OCR_MODEL });
    // The key goes in a header, never in the URL; the model comes from routing.
    expect(g.calls.every((c) => c.key === "test-key-not-real" && !c.url.includes("test-key-not-real"))).toBe(true);
    expect(g.calls[0].url).toBe(`https://generativelanguage.googleapis.com/v1beta/models/${DEFAULT_GEMINI_OCR_MODEL}:generateContent`);
  });

  it("handles a mixed PDF: text-layer pages stay as they are, only the scanned page is OCR'd", async () => {
    const original = fs.readFileSync(path.join(FIX, "05-mixed-text-and-scan.pdf"));
    const scanned = fs.readFileSync(path.join(FIX, "04-scanned-3-pages.pdf"));
    const g = await pageAwareGemini(scanned);
    const r = await extractDocument({ base64: original.toString("base64"), mimeType: "application/pdf", fileName: "mixed.pdf" }, ENV, { fetcher: g.fetcher as any });
    expect(g.calls).toHaveLength(1);
    expect(r.pages.map((p) => [p.pageNumber, p.extractionMethod])).toEqual([[1, "TEXT_LAYER"], [2, "OCR"], [3, "TEXT_LAYER"]]);
    expect(r.pages[1].text).toBe(PAGE_TEXT[1]);
    expect(r.pages[2].text).toContain("Page three");
  });

  it("reads a large 60-page PDF in full, every page attributed, nothing truncated", async () => {
    const r = await extractDocument({ base64: b64("08-large-60-pages.pdf"), mimeType: "application/pdf", fileName: "log.pdf" }, ENV, { fetcher: vi.fn() as any });
    expect(r.pageCount).toBe(60);
    r.pages.forEach((p, i) => {
      expect(p.pageNumber).toBe(i + 1);
      expect(p.text).toContain(`page ${i + 1} of 60`);
    });
    expect(r.incomplete).toEqual([]);
    expect(r.extractedText).toContain("[Page 60]\nFictional case log entry for page 60 of 60.");
  });

  it("OCRs an image as its single page", async () => {
    const g = await pageAwareGemini(fs.readFileSync(path.join(FIX, "04-scanned-3-pages.pdf")));
    const r = await extractDocument({ base64: b64("06-image.png"), mimeType: "image/png", fileName: "photo.png" }, ENV, { fetcher: g.fetcher as any });
    expect(r.pages).toHaveLength(1);
    expect(r.pages[0]).toMatchObject({ pageNumber: 1, extractionMethod: "OCR", status: "ok" });
    expect(g.calls[0].body.contents[0].parts[0].inlineData.mimeType).toBe("image/png");
  });

  it("reads a DOCX's structure in order: heading, paragraphs, list items, table rows", async () => {
    const r = await extractDocument({ base64: b64("02-paragraphs-tables.docx"), mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", fileName: "notes.docx" }, ENV);
    expect(r.pageAttribution).toBe("unavailable");
    expect(r.pages[0].pageNumber).toBeNull();
    const t = r.extractedText;
    expect(t).toContain("# Plan of Care Meeting Notes (fictional)");
    expect(t).toContain("- Worker Jordan Example confirmed the home visit of March 5, 2026.");
    expect(t).toContain("## Attendance");
    expect(t).toContain("| Name | Role |\n| Jordan Example | Child protection worker |\n| Casey Sample | Mother |");
    const order = ["Plan of Care", "Meeting held", "Worker Jordan", "Mother Casey", "Attendance", "| Name", "Next meeting"].map((s) => t.indexOf(s));
    expect(order.every((x) => x >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(t).not.toMatch(/<w:|PK\u0003\u0004/);
  });

  it("decodes XML entities and nested tables in DOCX XML", () => {
    const xml = '<w:document><w:body><w:p><w:r><w:t>A &amp; B &lt;C&gt; &#x2019;s</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>outer</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>inner</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:tc></w:tr></w:tbl></w:body></w:document>';
    const t = docxToText(xml);
    expect(t).toContain("A & B <C> ’s");
    expect(t).toContain("outer");
    expect(t).toContain("inner");
  });

  it("reads plain text as UTF-8 without inventing pages", async () => {
    const r = await extractDocument({ base64: b64("01-plain.txt"), mimeType: "text/plain", fileName: "notes.txt" }, ENV);
    expect(r.pages).toHaveLength(1);
    expect(r.pages[0]).toMatchObject({ pageNumber: null, extractionMethod: "PLAIN_TEXT" });
    expect(r.extractedText).not.toContain("[Page");
  });
});

describe("document extraction: refusals and provider errors", () => {
  afterEach(() => verify.mockReset());

  it("refuses unsigned requests before reading the file", async () => {
    verify.mockResolvedValue({ status: "denied" });
    const fetcher = vi.fn();
    const res = await handleExtractRequest(req({ base64: b64("03-digital-3-pages.pdf"), mimeType: "application/pdf" }), ENV, { fetcher: fetcher as any });
    expect(res.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    ["07-malformed.pdf", "application/pdf", 422, "PDF_MALFORMED"],
    ["09-encrypted.pdf", "application/pdf", 422, "PDF_ENCRYPTED"],
    ["06-image.png", "application/pdf", 415, "FILE_TYPE_MISMATCH"],
    ["03-digital-3-pages.pdf", "image/png", 415, "FILE_TYPE_MISMATCH"],
  ])("%s declared as %s → %i %s", async (file, mimeType, status, code) => {
    signedIn();
    const res = await handleExtractRequest(req({ base64: b64(file), mimeType, fileName: file }), ENV, { fetcher: vi.fn() as any });
    expect(res.status).toBe(status);
    expect((await res.json()).code).toBe(code);
  });

  it("refuses a renamed binary, a legacy .doc and bad base64", async () => {
    signedIn();
    const ole = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]).toString("base64");
    expect((await (await handleExtractRequest(req({ base64: ole, mimeType: "application/msword", fileName: "x.doc" }), ENV)).json()).code).toBe("UNSUPPORTED_TYPE");
    const bin = Buffer.from([0x00, 0x01, 0x02, 0xff, 0xfe, 0x00]).toString("base64");
    expect((await handleExtractRequest(req({ base64: bin, mimeType: "text/plain", fileName: "x.txt" }), ENV)).status).toBe(415);
    expect((await (await handleExtractRequest(req({ base64: "%%%not-base64%%%", mimeType: "text/plain" }), ENV)).json()).code).toBe("INVALID_BASE64");
  });

  it("refuses an oversized upload with 413", async () => {
    signedIn();
    const res = await handleExtractRequest(req({ base64: "A".repeat(28_000_000), mimeType: "application/pdf" }), ENV);
    expect(res.status).toBe(413);
  });

  it.each([
    [404, '{"error":{"code":404,"message":"models/gemini-2.0-flash is no longer available"}}', 503, "OCR_MODEL_UNAVAILABLE"],
    [403, '{"error":{"message":"API key not valid"}}', 503, "OCR_SERVICE_UNAVAILABLE"],
    [429, '{"error":{"status":"RESOURCE_EXHAUSTED","message":"rate limit"}}', 429, "OCR_RATE_LIMITED"],
    [429, '{"error":{"message":"You exceeded your current quota"}}', 503, "OCR_QUOTA_EXHAUSTED"],
    [500, '{"error":{"message":"internal"}}', 502, "OCR_PROVIDER_UNAVAILABLE"],
  ])("Gemini %i is classified, and its body never reaches the customer", async (status, body, httpStatus, code) => {
    signedIn();
    const fetcher = vi.fn(async () => new Response(body, { status }));
    const res = await handleExtractRequest(req({ base64: b64("06-image.png"), mimeType: "image/png", fileName: "p.png" }), ENV, { fetcher: fetcher as any });
    expect(res.status).toBe(httpStatus);
    const text = await res.text();
    expect(JSON.parse(text).code).toBe(code);
    expect(text).not.toMatch(/gemini-2\.0|API key|quota|internal|test-key/);
    expect(text).toMatch(/Nothing was charged/);
  });

  it("classifies a timeout and an unusable response", async () => {
    signedIn();
    const timeout = vi.fn(async () => { throw Object.assign(new Error("t"), { name: "TimeoutError" }); });
    expect((await (await handleExtractRequest(req({ base64: b64("06-image.png"), mimeType: "image/png" }), ENV, { fetcher: timeout as any })).json()).code).toBe("OCR_TIMEOUT");
    const junk = vi.fn(async () => new Response("not json", { status: 200 }));
    expect((await (await handleExtractRequest(req({ base64: b64("06-image.png"), mimeType: "image/png" }), ENV, { fetcher: junk as any })).json()).code).toBe("OCR_INVALID_RESPONSE");
  });

  it("returns EXTRACTION_EMPTY when OCR finds no text", async () => {
    signedIn();
    const empty = vi.fn(async () => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "[no text]" }] } }] }), { status: 200 }));
    const res = await handleExtractRequest(req({ base64: b64("06-image.png"), mimeType: "image/png" }), ENV, { fetcher: empty as any });
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("EXTRACTION_EMPTY");
  });

  it("routes models from configuration only, with no silent fallback", () => {
    expect(resolveGeminiModel({}, "ocr")).toBe(DEFAULT_GEMINI_OCR_MODEL);
    expect(resolveGeminiModel({ GEMINI_OCR_MODEL: "gemini-3.1-pro-preview" }, "ocr")).toBe("gemini-3.1-pro-preview");
    expect(resolveGeminiModel({ GEMINI_AUDIO_MODEL: "gemini-3.6-flash" }, "audio")).toBe("gemini-3.6-flash");
    expect(() => resolveGeminiModel({ GEMINI_OCR_MODEL: "../../etc" }, "ocr")).toThrow();
    expect(classifyGeminiStatus(400, '{"error":{"message":"models/x is not found for API version v1beta, or is not supported for generateContent"}}')).toBe("MODEL_UNAVAILABLE");
  });
});
