import type { Express, Request, Response } from "express";
import { verifyFirebaseToken } from "./services/firebaseAdmin.js";
import { resolveAccount } from "./services/accounts.js";
import { createClient } from "./services/clients.js";
import { createMatter, getOwnedMatter } from "./services/matters.js";
import { LifecycleError, requireUuid } from "./services/lifecycleErrors.js";

type Identity = { uid: string; email: string | null };

function bodyOf(req: Request): Record<string, unknown> {
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)) {
    throw new LifecycleError(400, "INVALID_REQUEST", "A JSON request body is required.");
  }
  return req.body;
}

function authenticated(failureCode: string, failureMessage: string,
  action: (req: Request, res: Response, identity: Identity) => Promise<void>) {
  return async (req: Request, res: Response) => {
    try {
      const identity = await verifyFirebaseToken(req.header("authorization"));
      if (!identity) {
        res.status(401).json({ code: "SIGN_IN_REQUIRED", error: "Authentication required." });
        return;
      }
      await action(req, res, identity);
    } catch (error: unknown) {
      if (error instanceof LifecycleError) {
        res.status(error.statusCode).json({ code: error.code, error: error.message });
        return;
      }
      // Do not serialize database errors, credentials, request bodies or bearer tokens.
      console.error(`[lifecycle] ${failureCode}`);
      res.status(500).json({ code: failureCode, error: failureMessage });
    }
  };
}

// Mounted on the existing app, after its shared CORS, rate and payload middleware.
export function registerLifecycleRoutes(app: Express): void {
  app.post("/api/account", authenticated("ACCOUNT_PROVISIONING_FAILED", "Account provisioning failed.",
    async (_req, res, identity) => {
      // No request fields are used for account identity, role or profile claims.
      res.json({ account: await resolveAccount(identity.uid, identity.email) });
    }));

  app.post("/api/clients", authenticated("CLIENT_CREATION_FAILED", "Client creation failed.",
    async (req, res, identity) => {
      const { name } = bodyOf(req);
      res.status(201).json({ client: await createClient(identity.uid, identity.email, name) });
    }));

  app.post("/api/matters", authenticated("MATTER_CREATION_FAILED", "Matter creation failed.",
    async (req, res, identity) => {
      const { clientId, title, description } = bodyOf(req);
      if (typeof title !== "string" || (description !== undefined && description !== null && typeof description !== "string")) {
        throw new LifecycleError(400, "INVALID_REQUEST", "title and description must be text.");
      }
      const matter = await createMatter(identity.uid, requireUuid(clientId, "clientId"), title,
        description == null ? null : description as string, identity.email);
      res.status(201).json({ matter });
    }));

  app.get("/api/matters/:matterId", authenticated("MATTER_LOOKUP_FAILED", "Matter lookup failed.",
    async (req, res, identity) => {
      res.json({ matter: await getOwnedMatter(identity.uid, requireUuid(req.params.matterId, "matterId")) });
    }));
}
