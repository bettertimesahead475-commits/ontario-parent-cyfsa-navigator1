import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { registerAcroFormRoutes } from "./acroFormRoutes.js";
import { verifyFirebaseToken } from "./services/firebaseAdmin.js";
import { getSupabase } from "./services/access.js";
import { buildSyntheticAcroFormPdf } from "./testSupport/acroFormFixtures.js";
import { FIELD_NOT_ESTABLISHED_TEXT } from "./services/formFieldFacts.js";

vi.mock("./services/firebaseAdmin.js", () => ({ verifyFirebaseToken: vi.fn() }));
// Any database or credit access during ingestion is a failure. The route must not reach the data layer.
vi.mock("./services/access.js", () => ({
  getSupabase: vi.fn(() => {
    throw new Error("the ingestion route must not touch the database or billing");
  })
}));

const app = express();
app.use(express.json({ limit: "20mb" }));
registerAcroFormRoutes(app);

const toBase64 = (b: Buffer) => b.toString("base64");
const AUTH = { authorization: "Bearer test-token" };

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
    process.env.ACROFORM_FIELD_INGESTION = "true";
    (verifyFirebaseToken as any).mockResolvedValue({ uid: "user-1" });
  });
  afterEach(() => {
    delete process.env.ACROFORM_FIELD_INGESTION;
  });

  it("requires a verified identity", async () => {
    (verifyFirebaseToken as any).mockResolvedValue(null);
    const res = await request(app).post("/api/acroform/ingest").send({ mimeType: "application/pdf", base64: "JVBERi0=" });
    expect(res.status).toBe(401);
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
    expect([422]).toContain(res.status);
    expect(res.body.error).toBeTruthy();
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
