// Stage 9D-4A — Official Ontario Court Form Registry read API.
// Public, unauthenticated read routes for blank official-form metadata: deliberately
// decoupled from matter access and paid-analyzer/AI usage gating (there is no legitimate
// reason to require either for reading which official forms exist and their public
// version/template metadata). No mutation/admin ingestion routes are exposed here.
import express from "express";
import type { Express, Request, Response } from "express";
import { LifecycleError } from "./services/lifecycleErrors.js";
import { verifyFirebaseToken } from "./services/firebaseAdmin.js";
import { prepareOfficialFormExport } from "./services/officialFormExport.js";
import type { ReviewedFormDraft, ReviewedField } from "./services/officialFormReviewedDraft.js";
import {
  listActiveForms,
  getForm,
  listFormSources,
  listFormVersions,
  getFormVersion,
  resolveCurrentVersion,
  listTemplatesForVersion,
  getTemplatePublic,
  listFieldMapsForTemplate,
  resolveFieldMapForTemplate
} from "./services/officialFormRegistry.js";

function handleError(e: any, res: Response) {
  if (e instanceof LifecycleError) {
    res.status(e.statusCode).json({ code: e.code, error: e.message });
  } else {
    // Never leak internal error detail (storage paths, stack traces, etc).
    res.status(500).json({ code: "INTERNAL_ERROR", error: "An unexpected error occurred." });
  }
}

export function registerOfficialFormRoutes(app: Express) {
  app.get("/api/official-forms", async (req: Request, res: Response) => {
    try {
      const cyfsaRelevantParam = req.query.cyfsaRelevant;
      const filter =
        cyfsaRelevantParam === "true" || cyfsaRelevantParam === "false"
          ? { cyfsaRelevant: cyfsaRelevantParam === "true" }
          : undefined;
      const forms = await listActiveForms(filter);
      res.json(forms);
    } catch (e: any) {
      handleError(e, res);
    }
  });

  app.get("/api/official-forms/:formId", async (req: Request, res: Response) => {
    try {
      const form = await getForm(req.params.formId);
      res.json(form);
    } catch (e: any) {
      handleError(e, res);
    }
  });

  app.get("/api/official-forms/:formId/sources", async (req: Request, res: Response) => {
    try {
      const sources = await listFormSources(req.params.formId);
      res.json(sources);
    } catch (e: any) {
      handleError(e, res);
    }
  });

  app.get("/api/official-forms/:formId/versions", async (req: Request, res: Response) => {
    try {
      const versions = await listFormVersions(req.params.formId);
      res.json(versions);
    } catch (e: any) {
      handleError(e, res);
    }
  });

  app.get("/api/official-forms/:formId/current-version", async (req: Request, res: Response) => {
    try {
      const version = await resolveCurrentVersion(req.params.formId);
      if (!version) {
        res.status(404).json({ code: "NO_VERIFIED_CURRENT_VERSION", error: "No explicitly verified current version is available for this form." });
        return;
      }
      res.json(version);
    } catch (e: any) {
      handleError(e, res);
    }
  });

  app.get("/api/official-form-versions/:versionId", async (req: Request, res: Response) => {
    try {
      const version = await getFormVersion(req.params.versionId);
      res.json(version);
    } catch (e: any) {
      handleError(e, res);
    }
  });

  app.get("/api/official-form-versions/:versionId/templates", async (req: Request, res: Response) => {
    try {
      const templates = await listTemplatesForVersion(req.params.versionId);
      res.json(templates);
    } catch (e: any) {
      handleError(e, res);
    }
  });

  app.get("/api/official-form-templates/:templateId", async (req: Request, res: Response) => {
    try {
      const template = await getTemplatePublic(req.params.templateId);
      res.json(template);
    } catch (e: any) {
      handleError(e, res);
    }
  });

  app.get("/api/official-form-templates/:templateId/field-maps", async (req: Request, res: Response) => {
    try {
      const fieldMaps = await listFieldMapsForTemplate(req.params.templateId);
      res.json(fieldMaps);
    } catch (e: any) {
      handleError(e, res);
    }
  });

  app.get("/api/official-form-templates/:templateId/field-maps/:fieldMapId/resolve", async (req: Request, res: Response) => {
    try {
      const fieldMap = await resolveFieldMapForTemplate(req.params.fieldMapId, req.params.templateId);
      res.json(fieldMap);
    } catch (e: any) {
      handleError(e, res);
    }
  });

  // Export readiness for a reviewed draft. Authenticated, read-only, and not persisted: it returns
  // the filing-safety verdict and blockers. It never generates a document, because no verified
  // template is stored server-side yet, so the gate always reports the template as missing here.
  app.post("/api/official-forms/:formNumber/export-readiness", express.json({ limit: "256kb" }), async (req: Request, res: Response) => {
    try {
      const identity = await verifyFirebaseToken(req.header("authorization"));
      if (!identity) {
        return res.status(401).json({ code: "SIGN_IN_REQUIRED", error: "Please sign in to check export readiness." });
      }
      const formNumber = req.params.formNumber;
      if (!KNOWN_FORM_NUMBERS.has(formNumber)) {
        return res.status(404).json({ code: "UNKNOWN_FORM", error: "Unknown official form." });
      }
      const body = req.body ?? {};
      const format = body.format;
      if (format !== "DOCX" && format !== "PDF") {
        return res.status(400).json({ code: "INVALID_FORMAT", error: "format must be DOCX or PDF." });
      }
      const draft = parseReviewedDraft(body.draft);
      if (!draft || draft.formNumber !== formNumber) {
        return res.status(400).json({ code: "INVALID_DRAFT", error: "A reviewed draft for this form is required." });
      }
      const result = prepareOfficialFormExport({
        formNumber,
        format,
        templateBytes: null,
        draft,
        fieldMapValidated: false
      });
      res.json({
        canExportAsOfficial: result.preflight.canExportAsOfficial,
        canDescribeAsFilingReady: result.preflight.canDescribeAsFilingReady,
        blockers: result.preflight.blockers,
        warnings: result.preflight.warnings,
        missingFields: result.missingFields
      });
    } catch (e: any) {
      handleError(e, res);
    }
  });
}

const KNOWN_FORM_NUMBERS = new Set(["8B", "14A", "33B.1", "33C", "35.1A"]);
const PROVENANCES = new Set(["USER_ENTERED", "MATTER_DERIVED", "MACHINE_SUGGESTED"]);
const REVIEWS = new Set(["PENDING", "ACCEPTED", "REJECTED"]);

/** Strict shape check for a client-submitted draft. Returns null for anything malformed. */
function parseReviewedDraft(input: unknown): ReviewedFormDraft | null {
  if (!input || typeof input !== "object") return null;
  const d = input as Record<string, unknown>;
  if (typeof d.formNumber !== "string" || typeof d.templateSha256Hex !== "string" || !Array.isArray(d.fields)) return null;
  if (d.fields.length > 300) return null;
  const fields: ReviewedField[] = [];
  for (const raw of d.fields) {
    if (!raw || typeof raw !== "object") return null;
    const f = raw as Record<string, unknown>;
    if (typeof f.fieldKey !== "string" || typeof f.value !== "string" || f.value.length > 4000) return null;
    if (typeof f.provenance !== "string" || !PROVENANCES.has(f.provenance)) return null;
    if (typeof f.review !== "string" || !REVIEWS.has(f.review)) return null;
    if (typeof f.reviewedByUser !== "boolean") return null;
    if (f.sourceReference !== undefined && typeof f.sourceReference !== "string") return null;
    fields.push({
      fieldKey: f.fieldKey,
      value: f.value,
      provenance: f.provenance as ReviewedField["provenance"],
      sourceReference: f.sourceReference as string | undefined,
      review: f.review as ReviewedField["review"],
      reviewedByUser: f.reviewedByUser
    });
  }
  return { formNumber: d.formNumber, templateSha256Hex: d.templateSha256Hex, fields };
}
