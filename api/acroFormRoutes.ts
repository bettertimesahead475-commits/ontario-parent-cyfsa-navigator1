/**
 * AcroForm field ingestion route. Behind the ACROFORM_FIELD_INGESTION flag, which defaults OFF.
 *
 * POST /api/acroform/ingest  { filename, mimeType: "application/pdf", base64 }
 *
 * When the flag is off the route answers 404 and does nothing else (no auth check, no parsing).
 * When on, it reads the PDF in memory and returns field facts passed through applyReportGuards. It stores nothing,
 * calls no paid model, and touches no billing or credit function. The route is read-only by design.
 */
import type { Express, Request, Response } from "express";
import { verifyFirebaseToken } from "./services/firebaseAdmin.js";
import { acroFormFieldIngestionEnabled } from "./services/featureFlags.js";
import { AcroFormError, ACROFORM_MAX_BYTES } from "./services/acroFormExtractor.js";
import { ingestAcroFormPdf } from "./services/acroFormIngestion.js";
import { applyReportGuards } from "./services/analyzerSections.js";

const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

const ERROR_STATUS: Record<string, number> = {
  NOT_A_PDF: 415,
  PDF_TOO_LARGE: 413,
  MALFORMED_OR_PROTECTED_PDF: 422,
  UNSUPPORTED_PAGE_COUNT: 422,
  TOO_MANY_WIDGETS: 422
};

export function registerAcroFormRoutes(app: Express) {
  app.post("/api/acroform/ingest", async (req: Request, res: Response) => {
    if (!acroFormFieldIngestionEnabled()) {
      res.status(404).json({ code: "NOT_FOUND", error: "Not found." });
      return;
    }
    try {
      const identity = await verifyFirebaseToken(req.header("authorization"));
      if (!identity) {
        res.status(401).json({ code: "SIGN_IN_REQUIRED", error: "Authentication required." });
        return;
      }
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
      if (!encoded || !BASE64.test(encoded)) {
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
    } catch (e) {
      if (e instanceof AcroFormError) {
        res.status(ERROR_STATUS[e.code] ?? 422).json({ code: e.code, error: e.message });
      } else {
        res.status(500).json({ code: "INTERNAL_ERROR", error: "An unexpected error occurred." });
      }
    }
  });
}
