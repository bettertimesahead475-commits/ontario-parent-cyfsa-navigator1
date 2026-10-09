/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CYFSA Navigator — Monitoring Express Routes
 * Gated by ADMIN_SECRET or CRON_SECRET.
 */

import express, { type Request, type Response, type NextFunction } from "express";
import { runMonitoringChecks } from "./runner.js";
import { monitoringHistory } from "./historyBuffer.js";

export const monitoringRouter = express.Router();

function requireAdminOrCron(req: Request, res: Response, next: NextFunction): void {
  const adminSecretOk =
    Boolean(process.env.ADMIN_SECRET) && req.headers["x-admin-secret"] === process.env.ADMIN_SECRET;
  const cronSecretOk =
    Boolean(process.env.CRON_SECRET) && req.headers["authorization"] === `Bearer ${process.env.CRON_SECRET}`;

  if (!adminSecretOk && !cronSecretOk) {
    res.status(401).json({ error: "Unauthorized." });
    return;
  }
  next();
}

monitoringRouter.use(requireAdminOrCron);

// GET /api/admin/monitoring/status - returns latest status and historical ring buffer
monitoringRouter.get("/status", (_req: Request, res: Response) => {
  const latest = monitoringHistory.getLatestReport();
  const history = monitoringHistory.getHistory();
  const incidents = monitoringHistory.getIncidents();

  res.json({
    latest,
    historySummary: {
      bufferedRunsCount: history.length,
      unresolvedIncidentsCount: incidents.length,
    },
    history,
    incidents,
  });
});

// Handler for executing a fresh check run
async function handleRunChecks(req: Request, res: Response) {
  try {
    const baseUrl = req.query.baseUrl ? String(req.query.baseUrl) : undefined;
    const report = await runMonitoringChecks({ baseUrl });
    const httpStatus = report.status === "failed" ? 503 : 200;
    res.status(httpStatus).json(report);
  } catch (err: any) {
    console.error("[/api/admin/monitoring/run] execution failed:", err);
    res.status(500).json({ error: "Failed to execute monitoring run", details: err.message || String(err) });
  }
}

// POST /api/admin/monitoring/run - admin-triggered manual run
monitoringRouter.post("/run", handleRunChecks);

// GET /api/admin/monitoring/run - compatible with Vercel Cron invocation
monitoringRouter.get("/run", handleRunChecks);

// GET /api/admin/monitoring/incidents - list of recorded incidents
monitoringRouter.get("/incidents", (_req: Request, res: Response) => {
  res.json({ incidents: monitoringHistory.getIncidents() });
});
