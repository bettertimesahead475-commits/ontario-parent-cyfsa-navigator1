/**
 * AcroForm field ingestion route. Behind the ACROFORM_FIELD_INGESTION flag, which defaults OFF.
 *
 * POST /api/acroform/ingest  { filename, mimeType: "application/pdf", base64 }
 *
 * Order of checks (each step runs only if the one before it passed):
 *   1. Flag. When off, answer 404 without reading the request body or touching anything else.
 *   2. Body. Parsed by this route's own JSON parser, capped at ACROFORM_JSON_LIMIT. The app-wide 100 MB parser skips
 *      this path (api/_server.ts), so an oversized body is refused before it is held in memory.
 *   3. Identity. A verified Firebase identity is required.
 *   4. Concurrency. At most ACROFORM_MAX_CONCURRENT reads run at once; extra requests get 429.
 *   5. Read. The PDF is read in memory and returned as guarded field facts.
 *
 * The route stores nothing, calls no paid model, touches no billing or credit function, and writes no document
 * content or field values to logs.
 */
import express from "express";
import type { Express, NextFunction, Request, Response } from "express";
import { verifyFirebaseToken } from "./services/firebaseAdmin.js";
import { acroFormFieldIngestionEnabled } from "./services/featureFlags.js";
import { AcroFormError, ACROFORM_MAX_BYTES } from "./services/acroFormExtractor.js";
import { ingestAcroFormPdf } from "./services/acroFormIngestion.js";
import { applyReportGuards } from "./services/analyzerSections.js";
import { isBase64Text } from "./services/pdfResourceLimits.js";

/** Large enough for a 10 MB PDF in base64 with its JSON envelope, and no larger. */
export const ACROFORM_JSON_LIMIT = "14mb";
export const ACROFORM_MAX_CONCURRENT = 2;


const ERROR_STATUS: Record<string, number> = {
  NOT_A_PDF: 415,
  PDF_TOO_LARGE: 413,
  MALFORMED_OR_PROTECTED_PDF: 422,
  UNSUPPORTED_PAGE_COUNT: 422,
  TOO_MANY_WIDGETS: 422,
  EXPANDED_CONTENT_TOO_LARGE: 413
};

let inFlight = 0;

/** Reads allowed per verified user in a sliding window. Per process, so each serverless instance keeps its own count. */
export const ACROFORM_READS_PER_USER = 20;
export const ACROFORM_USER_WINDOW_MS = 15 * 60 * 1000;
const READS_TRACKED_MAX = 50_000;
const readsByUser = new Map<string, number[]>();

export function allowAcroFormRead(uid: string, now: number = Date.now()): boolean {
  const recent = (readsByUser.get(uid) ?? []).filter(t => now - t < ACROFORM_USER_WINDOW_MS);
  if (recent.length >= ACROFORM_READS_PER_USER) {
    readsByUser.set(uid, recent);
    return false;
  }
  recent.push(now);
  readsByUser.set(uid, recent);
  if (readsByUser.size > READS_TRACKED_MAX) {
    // Drop the users whose reads have all aged out, then the oldest, so memory stays bounded.
    for (const [key, times] of readsByUser) if (times.every(t => now - t >= ACROFORM_USER_WINDOW_MS)) readsByUser.delete(key);
    while (readsByUser.size > READS_TRACKED_MAX) readsByUser.delete(readsByUser.keys().next().value as string);
  }
  return true;
}

/** Test helper: clears the per-user counters. */
export function resetAcroFormReadLimits(): void {
  readsByUser.clear();
}

const acroFormJson = express.json({ limit: ACROFORM_JSON_LIMIT });

/** The flag gate. Runs before any body is read. */
function requireFlag(_req: Request, res: Response, next: NextFunction) {
  if (!acroFormFieldIngestionEnabled()) {
    res.status(404).json({ code: "NOT_FOUND", error: "Not found." });
    return;
  }
  next();
}

/** This route's own body parser, with JSON errors instead of framework HTML. */
function parseBody(req: Request, res: Response, next: NextFunction) {
  acroFormJson(req, res, (err: any) => {
    if (!err) return next();
    if (err.type === "entity.too.large") {
      res.status(413).json({ code: "PDF_TOO_LARGE", error: "The PDF is larger than the supported size." });
    } else {
      res.status(400).json({ code: "INVALID_INPUT", error: "The request body is not valid JSON." });
    }
  });
}

export function registerAcroFormRoutes(app: Express) {
  app.post("/api/acroform/ingest", requireFlag, parseBody, async (req: Request, res: Response) => {
    try {
      const identity = await verifyFirebaseToken(req.header("authorization"));
      if (!identity) {
        res.status(401).json({ code: "SIGN_IN_REQUIRED", error: "Authentication required." });
        return;
      }
      if (!allowAcroFormRead(identity.uid)) {
        res.status(429).json({ code: "RATE_LIMITED", error: "Too many form reads. Try again later." });
        return;
      }
      if (inFlight >= ACROFORM_MAX_CONCURRENT) {
        res.status(429).json({ code: "BUSY", error: "Too many form reads are running. Try again shortly." });
        return;
      }
      inFlight++;
      try {
        await readAndRespond(req, res);
      } finally {
        inFlight--;
      }
    } catch (e) {
      if (e instanceof AcroFormError) {
        res.status(ERROR_STATUS[e.code] ?? 422).json({ code: e.code, error: e.message });
      } else {
        // Never reveal internal detail or any document content in an error.
        res.status(500).json({ code: "INTERNAL_ERROR", error: "An unexpected error occurred." });
      }
    }
  });
}

async function readAndRespond(req: Request, res: Response) {
  const body = req.body ?? {};
  if (body.mimeType !== "application/pdf") {
    res.status(415).json({ code: "UNSUPPORTED_TYPE", error: "Only PDF files can be read for form fields." });
    return;
  }
  const encoded = typeof body.base64 === "string" ? body.base64.replace(/^data:[^,]*;base64,/, "").replace(/\s/g, "") : "";
  if (encoded.length > Math.ceil((ACROFORM_MAX_BYTES * 4) / 3) + 4) {
    res.status(413).json({ code: "PDF_TOO_LARGE", error: "The PDF is larger than the supported size." });
    return;
  }
  if (!isBase64Text(encoded)) {
    res.status(400).json({ code: "INVALID_INPUT", error: "The file data is not valid base64." });
    return;
  }
  const bytes = Buffer.from(encoded, "base64");
  const result = await ingestAcroFormPdf(bytes);
  // Pages are the server-extracted text the analyzer already authenticates, so provenance is "authenticated_pages".
  const hasText = [...result.pageText.values()].some(t => t.trim() !== "");
  const report = applyReportGuards(
    { formFieldFacts: result.facts, redFlags: [], thresholdAnalysis: [], proceduralTimelineViolations: [] },
    hasText ? result.pageText : null,
    ""
  );
  res.json({
    sourceSha256: result.sourceSha256,
    formNumber: result.formNumber,
    identity: result.identity,
    pageCount: result.pageCount,
    summary: result.summary,
    rejected: result.rejected,
    // No extractable text means the file was read but nothing could be quoted from it. Never call that "pasted_text".
    sourceProvenance: hasText ? report.sourceProvenance : "uploaded_file_no_text",
    formFieldFacts: report.formFieldFacts
  });
}
