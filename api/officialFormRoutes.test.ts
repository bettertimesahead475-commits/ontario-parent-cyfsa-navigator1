import { describe, it, expect, vi, beforeEach } from "vitest";
import express from "express";
import request from "supertest";
import { registerOfficialFormRoutes } from "./officialFormRoutes.js";
import * as registry from "./services/officialFormRegistry.js";
import { LifecycleError } from "./services/lifecycleErrors.js";

vi.mock("./services/officialFormRegistry.js", () => ({
  listActiveForms: vi.fn(),
  getForm: vi.fn(),
  listFormSources: vi.fn(),
  listFormVersions: vi.fn(),
  getFormVersion: vi.fn(),
  resolveCurrentVersion: vi.fn(),
  listTemplatesForVersion: vi.fn(),
  getTemplatePublic: vi.fn(),
  listFieldMapsForTemplate: vi.fn(),
  resolveFieldMapForTemplate: vi.fn()
}));

const app = express();
app.use(express.json());
registerOfficialFormRoutes(app);

describe("Stage 9D-4A official form read routes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("lists active forms with no authentication header at all", async () => {
    (registry.listActiveForms as any).mockResolvedValue([{ id: "f1", formNumber: "SYN-1" }]);
    const res = await request(app).get("/api/official-forms");
    expect(res.status).toBe(200);
    expect(res.body).toEqual([{ id: "f1", formNumber: "SYN-1" }]);
    expect(registry.listActiveForms).toHaveBeenCalledWith(undefined);
  });

  it("passes the cyfsaRelevant filter through without requiring matter context", async () => {
    (registry.listActiveForms as any).mockResolvedValue([]);
    await request(app).get("/api/official-forms?cyfsaRelevant=true");
    expect(registry.listActiveForms).toHaveBeenCalledWith({ cyfsaRelevant: true });
  });

  it("gets a single form", async () => {
    (registry.getForm as any).mockResolvedValue({ id: "f1" });
    const res = await request(app).get("/api/official-forms/f1");
    expect(res.status).toBe(200);
  });

  it("returns 404 without leaking internals when a form is not found", async () => {
    (registry.getForm as any).mockRejectedValue(new LifecycleError(404, "NOT_FOUND", "Official form not found."));
    const res = await request(app).get("/api/official-forms/does-not-exist");
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ code: "NOT_FOUND", error: "Official form not found." });
  });

  it("returns a generic message (no stack trace/internal detail) on an unexpected error", async () => {
    (registry.getForm as any).mockRejectedValue(new Error("supabase: internal path /var/data/leak"));
    const res = await request(app).get("/api/official-forms/f1");
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain("/var/data/leak");
    expect(res.body).toEqual({ code: "INTERNAL_ERROR", error: "An unexpected error occurred." });
  });

  it("resolves current version, 404s distinctly when none is verified-current", async () => {
    (registry.resolveCurrentVersion as any).mockResolvedValue(null);
    const res = await request(app).get("/api/official-forms/f1/current-version");
    expect(res.status).toBe(404);
    expect(res.body.code).toBe("NO_VERIFIED_CURRENT_VERSION");
  });

  it("resolves a field map only against its exact template via the route", async () => {
    (registry.resolveFieldMapForTemplate as any).mockRejectedValue(
      new LifecycleError(409, "FIELD_MAP_TEMPLATE_MISMATCH", "mismatch")
    );
    const res = await request(app).get("/api/official-form-templates/t2/field-maps/fm1/resolve");
    expect(res.status).toBe(409);
    expect(res.body.code).toBe("FIELD_MAP_TEMPLATE_MISMATCH");
  });

  it("exposes template metadata read but never a write/mutation route on this router", async () => {
    (registry.getTemplatePublic as any).mockResolvedValue({ id: "t1", sha256Hex: "a".repeat(64) });
    const getRes = await request(app).get("/api/official-form-templates/t1");
    expect(getRes.status).toBe(200);

    // No POST/PUT/PATCH/DELETE handler is registered anywhere on this router: 9D-4A adds
    // only a read API, per the "no mutation/admin ingestion endpoints" scope boundary.
    const postRes = await request(app).post("/api/official-form-templates/t1").send({ sha256Hex: "b".repeat(64) });
    expect(postRes.status).toBe(404);
    const putRes = await request(app).put("/api/official-forms/f1").send({ isActive: false });
    expect(putRes.status).toBe(404);
    const deleteRes = await request(app).delete("/api/official-forms/f1");
    expect(deleteRes.status).toBe(404);
  });

  it("does not require any authorization header for blank-form metadata reads", async () => {
    (registry.listActiveForms as any).mockResolvedValue([]);
    const res = await request(app).get("/api/official-forms");
    expect(res.status).toBe(200);
    // No verifyFirebaseToken import exists in officialFormRoutes.ts at all — nothing to bypass.
  });
});
