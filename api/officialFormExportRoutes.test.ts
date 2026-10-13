// Route tests for the export-readiness endpoint (kept separate from the read-route suite). Firebase verification is mocked; no real identity
// provider or database is contacted.
import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";

const verifyMock = vi.hoisted(() => vi.fn());
vi.mock("./services/firebaseAdmin.js", () => ({ verifyFirebaseToken: verifyMock }));
vi.mock("./services/officialFormRegistry.js", () => ({}));

import { registerOfficialFormRoutes } from "./officialFormRoutes.js";

function app() {
  const a = express();
  registerOfficialFormRoutes(a);
  return a;
}

const draft = {
  formNumber: "14A",
  templateSha256Hex: "a".repeat(64),
  fields: [{ fieldKey: "name", value: "Jordan", provenance: "USER_ENTERED", review: "PENDING", reviewedByUser: false }]
};

describe("POST /api/official-forms/:formNumber/export-readiness", () => {
  beforeEach(() => verifyMock.mockReset());

  it("requires a verified sign-in", async () => {
    verifyMock.mockResolvedValue(null);
    const res = await request(app()).post("/api/official-forms/14A/export-readiness").send({ format: "DOCX", draft });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe("SIGN_IN_REQUIRED");
  });

  it("rejects unknown forms and malformed drafts", async () => {
    verifyMock.mockResolvedValue({ uid: "u1", email: null });
    const unknown = await request(app()).post("/api/official-forms/99Z/export-readiness").send({ format: "DOCX", draft });
    expect(unknown.status).toBe(404);
    const badFormat = await request(app()).post("/api/official-forms/14A/export-readiness").send({ format: "TXT", draft });
    expect(badFormat.status).toBe(400);
    const mismatch = await request(app()).post("/api/official-forms/8B/export-readiness").send({ format: "DOCX", draft });
    expect(mismatch.status).toBe(400);
    const badField = await request(app()).post("/api/official-forms/14A/export-readiness").send({
      format: "DOCX",
      draft: { ...draft, fields: [{ fieldKey: "name", value: 5, provenance: "USER_ENTERED", review: "PENDING", reviewedByUser: false }] }
    });
    expect(badField.status).toBe(400);
  });

  it("reports blocked readiness for an unreviewed draft and never says filing-ready", async () => {
    verifyMock.mockResolvedValue({ uid: "u1", email: null });
    const res = await request(app()).post("/api/official-forms/14A/export-readiness").send({ format: "DOCX", draft });
    expect(res.status).toBe(200);
    expect(res.body.canExportAsOfficial).toBe(false);
    expect(res.body.canDescribeAsFilingReady).toBe(false);
    expect(res.body.blockers.join(" ")).toMatch(/No official template has been supplied/);
  });
});
