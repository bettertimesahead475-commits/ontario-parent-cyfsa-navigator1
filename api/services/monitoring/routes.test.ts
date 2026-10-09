/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, it, expect, vi, beforeEach, afterAll } from "vitest";
import express from "express";
import request from "supertest";
import { monitoringRouter } from "./routes.js";
import * as runner from "./runner.js";
import { monitoringHistory } from "./historyBuffer.js";

function makeApp() {
  const app = express();
  app.use(express.json());
  app.use("/api/admin/monitoring", monitoringRouter);
  return app;
}

const app = makeApp();

describe("Monitoring Routes (/api/admin/monitoring)", () => {
  const originalAdminSecret = process.env.ADMIN_SECRET;
  const originalCronSecret = process.env.CRON_SECRET;

  beforeEach(() => {
    process.env.ADMIN_SECRET = "test-admin-secret";
    process.env.CRON_SECRET = "test-cron-secret";
    monitoringHistory.clear();
    vi.restoreAllMocks();
  });

  afterAll(() => {
    process.env.ADMIN_SECRET = originalAdminSecret;
    process.env.CRON_SECRET = originalCronSecret;
  });

  it("rejects unauthenticated requests with 401 Unauthorized", async () => {
    const res = await request(app).get("/api/admin/monitoring/status");
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("Unauthorized.");
  });

  it("authenticates with x-admin-secret header", async () => {
    const res = await request(app)
      .get("/api/admin/monitoring/status")
      .set("x-admin-secret", "test-admin-secret");
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("latest");
    expect(res.body).toHaveProperty("history");
  });

  it("authenticates with Authorization: Bearer <CRON_SECRET>", async () => {
    const res = await request(app)
      .get("/api/admin/monitoring/status")
      .set("authorization", "Bearer test-cron-secret");
    expect(res.status).toBe(200);
  });

  it("executes fresh check run via POST /run", async () => {
    vi.spyOn(runner, "runMonitoringChecks").mockResolvedValue({
      status: "healthy",
      timestamp: new Date().toISOString(),
      environment: "test",
      summary: { total: 9, healthy: 9, degraded: 0, failed: 0 },
      latencySummary: {},
      checks: {} as any,
      incidents: [],
    });

    const res = await request(app)
      .post("/api/admin/monitoring/run")
      .set("x-admin-secret", "test-admin-secret");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("healthy");
    expect(runner.runMonitoringChecks).toHaveBeenCalled();
  });

  it("executes fresh check run via GET /run (compatible with Vercel Cron)", async () => {
    vi.spyOn(runner, "runMonitoringChecks").mockResolvedValue({
      status: "healthy",
      timestamp: new Date().toISOString(),
      environment: "test",
      summary: { total: 9, healthy: 9, degraded: 0, failed: 0 },
      latencySummary: {},
      checks: {} as any,
      incidents: [],
    });

    const res = await request(app)
      .get("/api/admin/monitoring/run")
      .set("authorization", "Bearer test-cron-secret");

    expect(res.status).toBe(200);
    expect(res.body.status).toBe("healthy");
  });

  it("returns HTTP 503 from /run when monitoring detects system failure", async () => {
    vi.spyOn(runner, "runMonitoringChecks").mockResolvedValue({
      status: "failed",
      timestamp: new Date().toISOString(),
      environment: "test",
      summary: { total: 9, healthy: 8, degraded: 0, failed: 1 },
      latencySummary: {},
      checks: {} as any,
      incidents: [{ id: "1", severity: "CRITICAL", component: "database", message: "unreachable", detectedAt: "now" }],
    });

    const res = await request(app)
      .post("/api/admin/monitoring/run")
      .set("x-admin-secret", "test-admin-secret");

    expect(res.status).toBe(503);
    expect(res.body.status).toBe("failed");
  });

  it("returns recorded incidents from /incidents", async () => {
    const res = await request(app)
      .get("/api/admin/monitoring/incidents")
      .set("x-admin-secret", "test-admin-secret");

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("incidents");
    expect(Array.isArray(res.body.incidents)).toBe(true);
  });
});
