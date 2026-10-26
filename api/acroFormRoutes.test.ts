import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { registerAcroFormRoutes, ACROFORM_MAX_CONCURRENT } from "./acroFormRoutes.js";
import { verifyFirebaseToken } from "./services/firebaseAdmin.js";
import { getSupabase } from "./services/access.js";
import { ingestAcroFormPdf } from "./services/acroFormIngestion.js";
import { buildSyntheticAcroFormPdf, buildExpansionPdf } from "./testSupport/acroFormFixtures.js";
import { FIELD_NOT_ESTABLISHED_TEXT } from "./services/formFieldFacts.js";

vi.mock("./services/firebaseAdmin.js", () => ({ verifyFirebaseToken: vi.fn() }));
// Any database or credit access during ingestion is a failure. The route must not reach the data layer.
vi.mock("./services/access.js", () => ({
  getSupabase: vi.fn(() => {
    throw new Error("the ingestion route must not touch the database or billing");
  })
}));
// Wraps the real reader so a test can hold reads open and prove the concurrency limit.
vi.mock("./services/acroFormIngestion.js", async importOriginal => {
  const actual: any = await importOriginal();
  return { ...actual, ingestAcroFormPdf: vi.fn(actual.ingestAcroFormPdf) };
});

// No global body parser: the route parses its own bounded body, exactly as in production.
const app = express();
registerAcroFormRoutes(app);

const toBase64 = (b: Buffer) => b.toString("base64");
const AUTH = { authorization: "Bearer test-token" };
const ON = () => {
  process.env.ACROFORM_FIELD_INGESTION = "true";
};

// Real official PDFs, when this environment has them. Skipped otherwise, never reported as passed.
const CURRENT_DIR = "/root/.claude/uploads/f5b74824-3969-5f04-a809-1a60f42bc26e-current";
const manifest = JSON.parse(
  fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../scripts/official-forms/current-manifest.json"), "utf8")
) as { files: { formNumber: string; fileName: string }[] };
const realFile14A = manifest.files.find(f => f.formNumber === "14A")!;
const realPresent = fs.existsSync(path.join(CURRENT_DIR, realFile14A.fileName));
const realIt = realPresent ? it : it.skip;

describe("AcroForm ingestion route: flag defaults OFF", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.ACROFORM_FIELD_INGESTION;
  });
  afterEach(() => {
    delete process.env.ACROFORM_FIELD_INGESTION;
  });

  it("returns 404 with no other work when the flag is absent: no auth check, no parsing", async () => {
    const pdf = await buildSyntheticAcroFormPdf({ courtFileValue: "CV-1" });
    const res = await request(app).post("/api/acroform/ingest").set(AUTH).send({ mimeType: "application/pdf", base64: toBase64(pdf) });
    expect(res.status).toBe(404);
    expect(verifyFirebaseToken).not.toHaveBeenCalled();
    expect(ingestAcroFormPdf).not.toHaveBeenCalled();
  });

  it("refuses before parsing the body: a malformed body still gets 404 when the flag is off", async () => {
    const res = await request(app).post("/api/acroform/ingest").set("Content-Type", "application/json").send('{"not json');
    expect(res.status).toBe(404);
  });

  it("is off for any value other than exactly 'true'", async () => {
    process.env.ACROFORM_FIELD_INGESTION = "1";
    const res = await request(app).post("/api/acroform/ingest").set(AUTH).send({ mimeType: "application/pdf", base64: "JVBERi0=" });
    expect(res.status).toBe(404);
  });
});

describe("AcroForm ingestion route: enabled", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ON();
    (verifyFirebaseToken as any).mockResolvedValue({ uid: "user-1" });
  });
  afterEach(() => {
    delete process.env.ACROFORM_FIELD_INGESTION;
  });

  it("requires a verified identity", async () => {
    (verifyFirebaseToken as any).mockResolvedValue(null);
    const res = await request(app).post("/api/acroform/ingest").send({ mimeType: "application/pdf", base64: "JVBERi0=" });
    expect(res.status).toBe(401);
    expect(ingestAcroFormPdf).not.toHaveBeenCalled();
  });

  it("refuses anything that is not declared as a PDF", async () => {
    const res = await request(app).post("/api/acroform/ingest").set(AUTH).send({ mimeType: "text/plain", base64: "aGVsbG8=" });
    expect(res.status).toBe(415);
    expect(res.body.code).toBe("UNSUPPORTED_TYPE");
  });

  it("rejects malformed base64 without parsing it", async () => {
    const res = await request(app).post("/api/acroform/ingest").set(AUTH).send({ mimeType: "application/pdf", base64: "not base64!!" });
    expect(res.status).toBe(400);
  });

  it("refuses bytes that are not a PDF, even when declared as one", async () => {
    const res = await request(app).post("/api/acroform/ingest").set(AUTH).send({ mimeType: "application/pdf", base64: toBase64(Buffer.from("hello world")) });
    expect(res.status).toBe(415);
    expect(res.body.code).toBe("NOT_A_PDF");
  });

  it("answers a malformed PDF with a safe classified error, not a server error", async () => {
    const res = await request(app).post("/api/acroform/ingest").set(AUTH).send({ mimeType: "application/pdf", base64: toBase64(Buffer.from("%PDF-1.4\ngarbage")) });
    expect(res.status).toBe(422);
    expect(res.body.error).toBeTruthy();
  });

  it("refuses an oversize body at the route's own limit with a JSON 413, before it is read in full", async () => {
    const res = await request(app)
      .post("/api/acroform/ingest")
      .set(AUTH)
      .set("Content-Type", "application/json")
      .send(JSON.stringify({ mimeType: "application/pdf", base64: "A".repeat(15 * 1024 * 1024) }));
    expect(res.status).toBe(413);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body.code).toBe("PDF_TOO_LARGE");
  });

  it("answers invalid JSON with a JSON 400, never an HTML error page", async () => {
    const res = await request(app).post("/api/acroform/ingest").set(AUTH).set("Content-Type", "application/json").send('{"broken');
    expect(res.status).toBe(400);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body.code).toBe("INVALID_INPUT");
  });

  it("reads a synthetic form end to end: confirmed label, unresolved radio and unlabelled field, duplicate on two pages", async () => {
    const pdf = await buildSyntheticAcroFormPdf({ courtFileValue: "CV-1", radioGroup: true, unlabelledField: true, conflictingDuplicate: true, ambiguousRows: true });
    const res = await request(app).post("/api/acroform/ingest").set(AUTH).send({ mimeType: "application/pdf", base64: toBase64(pdf) });
    expect(res.status).toBe(200);
    expect(res.body.identity).toBe("UNIDENTIFIED");
    expect(res.body.formNumber).toBeNull();
    expect(res.body.sourceProvenance).toBe("authenticated_pages");
    expect(res.body.summary.radioGroups).toBe(1);
    expect(res.body.summary.confirmed).toBeGreaterThanOrEqual(1);
    const facts: any[] = res.body.formFieldFacts;
    const court = facts.find(f => f.fieldName === "court_number_field");
    expect(court).toMatchObject({ labelRole: "COURT_FILE_NUMBER", labelRoleStatus: "CONFIRMED_BY_LABEL", enteredValue: "CV-1", pages: [1, 2] });
    for (const f of facts.filter(f => f.labelRoleStatus !== "CONFIRMED_BY_LABEL")) {
      expect(f.labelRole).toBeNull();
      expect(f.reportText).toBe(FIELD_NOT_ESTABLISHED_TEXT);
    }
    expect(facts.find(f => f.fieldName === "stray_field").enteredValue).toBeNull();
    for (const f of facts) {
      expect(f.partyAttribution).toBe("NOT_DETERMINED");
      expect(f.legalSignificance).toBe("NOT_ASSESSED");
    }
  });

  it("returns only the documented response fields: no PDF metadata, no raw bytes, no base64 echo", async () => {
    const pdf = await buildSyntheticAcroFormPdf({ courtFileValue: "CV-1" });
    const b64 = toBase64(pdf);
    const res = await request(app).post("/api/acroform/ingest").set(AUTH).send({ mimeType: "application/pdf", base64: b64 });
    expect(res.status).toBe(200);
    expect(Object.keys(res.body).sort()).toEqual(
      ["formFieldFacts", "formNumber", "identity", "pageCount", "rejected", "sourceProvenance", "sourceSha256", "summary"].sort()
    );
    expect(res.text).not.toContain(b64.slice(0, 64));
  });

  it("performs no database or billing access on a successful read", async () => {
    const pdf = await buildSyntheticAcroFormPdf({ courtFileValue: "CV-1" });
    const res = await request(app).post("/api/acroform/ingest").set(AUTH).send({ mimeType: "application/pdf", base64: toBase64(pdf) });
    expect(res.status).toBe(200);
    expect(getSupabase).not.toHaveBeenCalled();
  });

  it("reports 'uploaded_file_no_text' rather than a pasted-text provenance when the file has no printed text", async () => {
    const pdf = await buildSyntheticAcroFormPdf({ bare: true });
    const res = await request(app).post("/api/acroform/ingest").set(AUTH).send({ mimeType: "application/pdf", base64: toBase64(pdf) });
    expect(res.status).toBe(200);
    expect(res.body.sourceProvenance).toBe("uploaded_file_no_text");
    expect(res.body.formFieldFacts.every((f: any) => f.labelRoleStatus !== "CONFIRMED_BY_LABEL")).toBe(true);
  });

  it("does not let a JSON __proto__ key pollute the process or change the result", async () => {
    const pdf = await buildSyntheticAcroFormPdf({ courtFileValue: "CV-1" });
    const raw = `{"__proto__":{"isAdmin":true},"mimeType":"application/pdf","base64":"${toBase64(pdf)}"}`;
    const res = await request(app).post("/api/acroform/ingest").set(AUTH).set("Content-Type", "application/json").send(raw);
    expect(res.status).toBe(200);
    expect(({} as any).isAdmin).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty("isAdmin");
  });

  it("keeps a field named __proto__ as plain data in the response", async () => {
    const pdf = await buildSyntheticAcroFormPdf({ protoName: true, courtFileValue: "CV-1" });
    const res = await request(app).post("/api/acroform/ingest").set(AUTH).send({ mimeType: "application/pdf", base64: toBase64(pdf) });
    expect(res.status).toBe(200);
    const proto = res.body.formFieldFacts.find((f: any) => f.fieldName === "__proto__");
    expect(proto).toBeDefined();
    expect(typeof proto.reportText).toBe("string");
    expect(({} as any).polluted).toBeUndefined();
  });

  it("never writes a field value or document text to the console, on success or on failure", async () => {
    const spies = ["log", "info", "warn", "error", "debug"].map(m => vi.spyOn(console, m as any).mockImplementation(() => undefined));
    try {
      const pdf = await buildSyntheticAcroFormPdf({ courtFileValue: "SECRET-CV-98765" });
      await request(app).post("/api/acroform/ingest").set(AUTH).send({ mimeType: "application/pdf", base64: toBase64(pdf) });
      await request(app).post("/api/acroform/ingest").set(AUTH).send({ mimeType: "application/pdf", base64: toBase64(Buffer.from("%PDF-1.4\nSECRET-CV-98765")) });
      const logged = spies.flatMap(s => s.mock.calls).map(c => JSON.stringify(c)).join("\n");
      expect(logged).not.toContain("SECRET-CV-98765");
    } finally {
      spies.forEach(s => s.mockRestore());
    }
  });

  it("never echoes a field value or document text in an error response", async () => {
    const bad = Buffer.from("%PDF-1.4\nSECRET-CV-98765 garbage");
    const res = await request(app).post("/api/acroform/ingest").set(AUTH).send({ mimeType: "application/pdf", base64: toBase64(bad) });
    expect([415, 422]).toContain(res.status);
    expect(res.text).not.toContain("SECRET-CV-98765");
  });

  it("holds at most ACROFORM_MAX_CONCURRENT reads at once and answers the next with 429", async () => {
    let release!: () => void;
    const gate = new Promise<void>(r => (release = r));
    const actual: any = await vi.importActual("./services/acroFormIngestion.js");
    (ingestAcroFormPdf as any).mockImplementation(async (bytes: Buffer) => {
      await gate;
      return actual.ingestAcroFormPdf(bytes);
    });
    const pdf = await buildSyntheticAcroFormPdf({ courtFileValue: "CV-1" });
    const body = { mimeType: "application/pdf", base64: toBase64(pdf) };
    const holding = Array.from({ length: ACROFORM_MAX_CONCURRENT }, () => request(app).post("/api/acroform/ingest").set(AUTH).send(body).then(r => r));
    await vi.waitFor(() => expect(ingestAcroFormPdf).toHaveBeenCalledTimes(ACROFORM_MAX_CONCURRENT));
    const busy = await request(app).post("/api/acroform/ingest").set(AUTH).send(body);
    expect(busy.status).toBe(429);
    expect(busy.body.code).toBe("BUSY");
    expect(ingestAcroFormPdf).toHaveBeenCalledTimes(ACROFORM_MAX_CONCURRENT);
    release();
    const done = await Promise.all(holding);
    expect(done.map(r => r.status)).toEqual(Array(ACROFORM_MAX_CONCURRENT).fill(200));
    (ingestAcroFormPdf as any).mockImplementation(actual.ingestAcroFormPdf);
  });

  it("keeps two users' reads separate: each response describes only its own upload", async () => {
    const a = await buildSyntheticAcroFormPdf({ courtFileValue: "CV-A" });
    const b = await buildSyntheticAcroFormPdf({ courtFileValue: "CV-B" });
    (verifyFirebaseToken as any).mockResolvedValueOnce({ uid: "user-a" }).mockResolvedValueOnce({ uid: "user-b" });
    const ra = await request(app).post("/api/acroform/ingest").set(AUTH).send({ mimeType: "application/pdf", base64: toBase64(a) });
    const rb = await request(app).post("/api/acroform/ingest").set(AUTH).send({ mimeType: "application/pdf", base64: toBase64(b) });
    expect(ra.body.sourceSha256).not.toBe(rb.body.sourceSha256);
    expect(ra.text).not.toContain("CV-B");
    expect(rb.text).not.toContain("CV-A");
  });

  it("answers a large base64 string with one bad character with a clean 400, not a server error", async () => {
    const big = "A".repeat(12_000_000) + "!" + "A".repeat(3);
    const res = await request(app).post("/api/acroform/ingest").set(AUTH).send({ mimeType: "application/pdf", base64: big });
    expect(res.status).toBe(400);
    expect(res.body.code).toBe("INVALID_INPUT");
  }, 60000);

  it("accepts a PDF just under the 10 MB limit, and refuses one just over it with a JSON 413", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const under = await PDFDocument.create();
    under.addPage([612, 792]);
    await under.attach(randomBytes(9_500_000), "under.bin");
    const underBytes = Buffer.from(await under.save());
    expect(underBytes.length).toBeLessThan(10 * 1024 * 1024);
    const ok = await request(app).post("/api/acroform/ingest").set(AUTH).send({ mimeType: "application/pdf", base64: toBase64(underBytes) });
    expect(ok.status).toBe(200);
    expect(ok.body.pageCount).toBe(1);

    const over = await PDFDocument.create();
    over.addPage([612, 792]);
    await over.attach(randomBytes(11 * 1024 * 1024), "over.bin");
    const overBytes = Buffer.from(await over.save());
    const refused = await request(app).post("/api/acroform/ingest").set(AUTH).send({ mimeType: "application/pdf", base64: toBase64(overBytes) });
    expect(refused.status).toBe(413);
    expect(refused.body.code).toBe("PDF_TOO_LARGE");
  }, 120000);

  it("refuses a PDF with more than 20 pages without reading its fields", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    for (let i = 0; i < 21; i++) doc.addPage([612, 792]);
    const res = await request(app).post("/api/acroform/ingest").set(AUTH).send({ mimeType: "application/pdf", base64: toBase64(Buffer.from(await doc.save())) });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("UNSUPPORTED_PAGE_COUNT");
  });

  it("refuses a PDF with more than 2000 fields", async () => {
    const { PDFDocument } = await import("pdf-lib");
    const doc = await PDFDocument.create();
    const page = doc.addPage([612, 792]);
    const form = doc.getForm();
    for (let i = 0; i < 2001; i++) {
      form.createTextField(`f${i}`).addToPage(page, { x: 10, y: 10, width: 20, height: 10 });
    }
    const res = await request(app).post("/api/acroform/ingest").set(AUTH).send({ mimeType: "application/pdf", base64: toBase64(Buffer.from(await doc.save())) });
    expect(res.status).toBe(422);
    expect(res.body.code).toBe("TOO_MANY_WIDGETS");
  });

  realIt("reads the real current 14A official PDF: identified by pin, matches the recorded mapping coverage", async () => {
    const bytes = fs.readFileSync(path.join(CURRENT_DIR, realFile14A.fileName));
    const res = await request(app).post("/api/acroform/ingest").set(AUTH).send({ mimeType: "application/pdf", base64: toBase64(bytes) });
    expect(res.status).toBe(200);
    expect(res.body.identity).toBe("PINNED_OFFICIAL_FILE");
    expect(res.body.formNumber).toBe("14A");
    // Same numbers as the recorded mapping record (scripts/official-forms/compat/pdf-semantic-map-2026-10-26.json).
    expect(res.body.summary.fields).toBe(20);
    expect(res.body.summary.confirmed).toBe(19);
    expect(res.body.formFieldFacts.find((f: any) => f.labelRole === "COURT_FILE_NUMBER")).toBeDefined();
  });

  realIt("handles a truncated copy of the real 14A PDF without a server error, and never overstates confirmation", async () => {
    const bytes = fs.readFileSync(path.join(CURRENT_DIR, realFile14A.fileName));
    const res = await request(app).post("/api/acroform/ingest").set(AUTH).send({ mimeType: "application/pdf", base64: toBase64(bytes.subarray(0, 2000)) });
    expect([200, 422]).toContain(res.status);
    if (res.status === 200) expect(res.body.summary.confirmed).toBeLessThan(19);
  });
});

describe("AcroForm ingestion route: expansion limit", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    ON();
    (verifyFirebaseToken as any).mockResolvedValue({ uid: "user-1" });
  });
  afterEach(() => {
    delete process.env.ACROFORM_FIELD_INGESTION;
  });

  it("answers a small file that expands past the budget with a JSON 413, and reads nothing", async () => {
    const bomb = await buildExpansionPdf(40 * 1024 * 1024);
    const res = await request(app).post("/api/acroform/ingest").set(AUTH).send({ mimeType: "application/pdf", base64: toBase64(bomb) });
    expect(res.status).toBe(413);
    expect(res.body.code).toBe("EXPANDED_CONTENT_TOO_LARGE");
  }, 60000);
});
