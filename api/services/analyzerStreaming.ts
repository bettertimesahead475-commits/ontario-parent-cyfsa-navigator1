/**
 * CYFSA Navigator — Server-Sent Events (SSE) Streaming & Durable Job Store
 *
 * Provides real-time server-backed progress streaming and resilient job recovery
 * without fake percentages or simulated AI output.
 */

import { Response } from "express";

export type AnalysisStage =
  | "uploading"
  | "extracting"
  | "verifying_access"
  | "reviewing_evidence"
  | "building_chronology"
  | "identifying_legal_issues"
  | "verifying_findings"
  | "preparing_report"
  | "complete";

export interface StageInfo {
  stage: AnalysisStage;
  message: string;
  percent: number;
}

export const STAGE_DEFINITIONS: Record<AnalysisStage, { message: string; percent: number }> = {
  uploading: {
    message: "Uploading document and verifying integrity...",
    percent: 10,
  },
  extracting: {
    message: "Extracting document text and verifying structure...",
    percent: 20,
  },
  verifying_access: {
    message: "Verifying account access and analysis entitlements...",
    percent: 30,
  },
  reviewing_evidence: {
    message: "Reviewing evidence items and calculating Evidence Strength Index...",
    percent: 45,
  },
  building_chronology: {
    message: "Extracting document metadata, timeline anchors, and core facts...",
    percent: 60,
  },
  identifying_legal_issues: {
    message: "Analyzing CYFSA statutory thresholds and procedural timeline rules...",
    percent: 75,
  },
  verifying_findings: {
    message: "Conducting Claude Opus forensic verification on high-impact findings...",
    percent: 88,
  },
  preparing_report: {
    message: "Validating direct quotes and assembling final comprehensive audit...",
    percent: 95,
  },
  complete: {
    message: "Analysis verified and complete.",
    percent: 100,
  },
};

export interface AnalysisJob {
  jobId: string;
  uid: string | null;
  mode: "fast" | "full";
  status: "pending" | "analyzing" | "completed" | "failed";
  currentStage: AnalysisStage;
  percent: number;
  report?: any;
  error?: {
    code: string;
    message: string;
    statusCode: number;
    retryable: boolean;
  };
  createdAt: number;
  updatedAt: number;
}

import { getSupabase } from "./access.js";

const jobStore = new Map<string, AnalysisJob>();
const JOB_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours
const BUCKET_NAME = "analysis_jobs";
let bucketChecked = false;

function safeGetSupabase() {
  try {
    return getSupabase();
  } catch {
    return null;
  }
}

async function ensureBucket(): Promise<boolean> {
  if (bucketChecked) return true;
  const db = safeGetSupabase();
  if (!db) return false;
  try {
    const { data: buckets } = await db.storage.listBuckets();
    if (buckets && buckets.some((b: any) => b.name === BUCKET_NAME)) {
      bucketChecked = true;
      return true;
    }
    const { error: cErr } = await db.storage.createBucket(BUCKET_NAME, { public: false });
    if (!cErr || cErr.message?.includes("already exists")) {
      bucketChecked = true;
      return true;
    }
  } catch {
    // fallback
  }
  return false;
}

export async function persistJobToStorage(job: AnalysisJob): Promise<void> {
  const db = safeGetSupabase();
  if (!db) return;
  try {
    const hasBucket = await ensureBucket();
    if (hasBucket) {
      await db.storage
        .from(BUCKET_NAME)
        .upload(`${job.jobId}.json`, JSON.stringify(job), {
          upsert: true,
          contentType: "application/json",
        });
    }
  } catch {
    // ignore storage upload failures, memory state remains intact
  }
}

export async function fetchJobFromStorage(jobId: string): Promise<AnalysisJob | null> {
  const db = safeGetSupabase();
  if (!db) return null;
  try {
    const hasBucket = await ensureBucket();
    if (!hasBucket) return null;
    const { data, error } = await db.storage.from(BUCKET_NAME).download(`${jobId}.json`);
    if (data && !error) {
      const text = await data.text();
      const job = JSON.parse(text) as AnalysisJob;
      jobStore.set(job.jobId, job);
      return job;
    }
  } catch {
    // fallback
  }
  return null;
}

export function createAnalysisJob(params: {
  jobId: string;
  uid: string | null;
  mode: "fast" | "full";
}): AnalysisJob {
  // Prune expired jobs
  const now = Date.now();
  if (jobStore.size > 200) {
    for (const [id, job] of jobStore.entries()) {
      if (now - job.createdAt > JOB_RETENTION_MS) {
        jobStore.delete(id);
      }
    }
  }

  const job: AnalysisJob = {
    jobId: params.jobId,
    uid: params.uid,
    mode: params.mode,
    status: "analyzing",
    currentStage: "verifying_access",
    percent: STAGE_DEFINITIONS.verifying_access.percent,
    createdAt: now,
    updatedAt: now,
  };
  jobStore.set(params.jobId, job);
  // Asynchronously persist initial job record
  persistJobToStorage(job).catch(() => {});
  return job;
}

export function getAnalysisJob(jobId: string): AnalysisJob | null {
  return jobStore.get(jobId) || null;
}

export async function getAnalysisJobDurable(jobId: string): Promise<AnalysisJob | null> {
  const local = jobStore.get(jobId);
  if (local && (local.status === "completed" || local.status === "failed")) {
    return local;
  }
  const fromStorage = await fetchJobFromStorage(jobId);
  return fromStorage || local || null;
}

export function updateAnalysisJobStage(jobId: string, stage: AnalysisStage): void {
  const job = jobStore.get(jobId);
  if (job) {
    job.currentStage = stage;
    job.percent = STAGE_DEFINITIONS[stage]?.percent ?? job.percent;
    job.updatedAt = Date.now();
  }
}

export function completeAnalysisJob(jobId: string, report: any): void {
  const job = jobStore.get(jobId);
  if (job) {
    job.status = "completed";
    job.currentStage = "complete";
    job.percent = 100;
    job.report = report;
    job.updatedAt = Date.now();
    persistJobToStorage(job).catch(() => {});
  }
}

export function failAnalysisJob(
  jobId: string,
  error: { code: string; message: string; statusCode: number; retryable: boolean }
): void {
  const job = jobStore.get(jobId);
  if (job) {
    job.status = "failed";
    job.error = error;
    job.updatedAt = Date.now();
    persistJobToStorage(job).catch(() => {});
  }
}

export class SseStreamEmitter {
  private res: Response;
  private jobId: string;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private isClosed = false;

  constructor(res: Response, jobId: string) {
    this.res = res;
    this.jobId = jobId;

    // Set SSE HTTP headers
    this.res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    this.res.setHeader("Cache-Control", "no-cache, no-transform");
    this.res.setHeader("Connection", "keep-alive");
    this.res.setHeader("X-Accel-Buffering", "no");

    // Flush headers immediately if available
    if (typeof (this.res as any).flushHeaders === "function") {
      (this.res as any).flushHeaders();
    }

    // Start keep-alive heartbeat every 15s to keep proxy connections open
    this.heartbeatInterval = setInterval(() => {
      if (!this.isClosed) {
        this.res.write(": keep-alive\n\n");
      }
    }, 15000);

    // Clean up on client disconnect
    this.res.on("close", () => {
      this.close();
    });
  }

  public emitStage(stage: AnalysisStage, customMessage?: string): void {
    if (this.isClosed) return;
    const def = STAGE_DEFINITIONS[stage] || { message: "Processing...", percent: 50 };
    updateAnalysisJobStage(this.jobId, stage);

    const payload = {
      type: "stage",
      jobId: this.jobId,
      stage,
      message: customMessage || def.message,
      percent: def.percent,
      timestamp: Date.now(),
    };

    this.res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  public emitSection(sectionName: string, data: any): void {
    if (this.isClosed) return;
    const payload = {
      type: "section",
      jobId: this.jobId,
      section: sectionName,
      data,
      timestamp: Date.now(),
    };
    this.res.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  public emitComplete(report: any, credits?: any): void {
    if (this.isClosed) return;
    completeAnalysisJob(this.jobId, report);

    const payload = {
      type: "complete",
      jobId: this.jobId,
      stage: "complete",
      percent: 100,
      report,
      credits: credits || null,
      timestamp: Date.now(),
    };
    this.res.write(`data: ${JSON.stringify(payload)}\n\n`);
    this.close();
  }

  public emitError(error: { code: string; message: string; statusCode: number; retryable: boolean }): void {
    if (this.isClosed) return;
    failAnalysisJob(this.jobId, error);

    const payload = {
      type: "error",
      jobId: this.jobId,
      error: error.message,
      code: error.code,
      statusCode: error.statusCode,
      retryable: error.retryable,
      timestamp: Date.now(),
    };
    this.res.write(`data: ${JSON.stringify(payload)}\n\n`);
    this.close();
  }

  public close(): void {
    if (this.isClosed) return;
    this.isClosed = true;
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
    try {
      this.res.end();
    } catch {}
  }
}
