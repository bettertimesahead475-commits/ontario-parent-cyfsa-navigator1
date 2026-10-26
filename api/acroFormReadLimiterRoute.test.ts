import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import express from "express";
import request from "supertest";
import { registerAcroFormRoutes } from "./acroFormRoutes.js";
import { verifyFirebaseToken } from "./services/firebaseAdmin.js";
import { ingestAcroFormPdf } from "./services/acroFormIngestion.js";
import { buildSyntheticAcroFormPdf } from "./testSupport/acroFormFixtures.js";

vi.mock("./services/firebaseAdmin.js", () => ({ verifyFirebaseToken: vi.fn() }));
// The shared backend calls the database. In this file the database is unreachable: the route must refuse, not allow.
vi.mock("./services/access.js", () => ({
  getSupabase: vi.fn(() => {
    throw new Error("database unreachable");
  })
}));
vi.mock("./services/acroFormIngestion.js", async importOriginal => {
  const actual: any = await importOriginal();
  return { ...actual, ingestAcroFormPdf: vi.fn(actual.ingestAcroFormPdf) };
});

const app = express();
registerAcroFormRoutes(app);

const AUTH = { authorization: "Bearer test-token" };

describe("AcroForm route with the shared read limiter", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ACROFORM_FIELD_INGESTION = "true";
    process.env.ACROFORM_LIMIT_BACKEND = "shared";
    vi.mocked(verifyFirebaseToken).mockResolvedValue({ uid: "uid-shared" } as any);
  });
  afterEach(() => {
    delete process.env.ACROFORM_FIELD_INGESTION;
    delete process.env.ACROFORM_LIMIT_BACKEND;
  });

  it("refuses the read with 503 when the shared limiter cannot answer, and never reads the PDF", async () => {
    const pdf = await buildSyntheticAcroFormPdf({ courtFileValue: "CV-1" });
    const res = await request(app)
      .post("/api/acroform/ingest")
      .set(AUTH)
      .send({ mimeType: "application/pdf", base64: pdf.toString("base64") });
    expect(res.status).toBe(503);
    expect(res.body.code).toBe("LIMITER_UNAVAILABLE");
    expect(ingestAcroFormPdf).not.toHaveBeenCalled();
    expect(JSON.stringify(res.body)).not.toContain("database unreachable");
  });

  it("the refusal message is plain language (Grade 8 or below, estimate)", async () => {
    const pdf = await buildSyntheticAcroFormPdf({ courtFileValue: "CV-1" });
    const res = await request(app)
      .post("/api/acroform/ingest")
      .set(AUTH)
      .send({ mimeType: "application/pdf", base64: pdf.toString("base64") });
    const words = res.body.error.split(/\s+/).length;
    const sentences = res.body.error.split(/[.!?]+/).filter((s: string) => s.trim()).length;
    const syl = (w: string) => Math.max(1, (w.toLowerCase().replace(/[^a-z]/g, "").match(/[aeiouy]{1,2}/g) ?? []).length);
    const syllables = res.body.error.split(/\s+/).reduce((a: number, w: string) => a + syl(w), 0);
    const grade = 0.39 * (words / sentences) + 11.8 * (syllables / words) - 15.59;
    expect(grade).toBeLessThanOrEqual(8);
  });
});
