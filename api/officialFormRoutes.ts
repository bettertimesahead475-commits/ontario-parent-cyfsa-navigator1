// Stage 9D-4A — Official Ontario Court Form Registry read API.
// Public, unauthenticated read routes for blank official-form metadata: deliberately
// decoupled from matter access and paid-analyzer/AI usage gating (there is no legitimate
// reason to require either for reading which official forms exist and their public
// version/template metadata). No mutation/admin ingestion routes are exposed here.
import type { Express, Request, Response } from "express";
import { LifecycleError } from "./services/lifecycleErrors.js";
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
}
