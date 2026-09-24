// Stage 10 (parallel-safe slice): read-only owner access-audit route over
// api/services/matterAccessAudit.ts.
//
// NOT YET MOUNTED. api/_server.ts is a shared registration file that the in-flight Stage 9
// official-form work may also edit, so the one-line registerMatterAccessAuditRoutes(app) call
// is deferred to the post-Stage-9 integration step to avoid a merge collision. The route is
// fully exercised by matterAccessAuditRoutes.test.ts against an isolated Express app.
//
// Authentication and error handling follow the existing route modules exactly: identity comes
// only from verifyFirebaseToken(); only LifecycleError details reach the caller.

import type { Express, Request, Response } from 'express';
import { verifyFirebaseToken } from './services/firebaseAdmin.js';
import { LifecycleError } from './services/lifecycleErrors.js';
import { getMatterAccessAudit } from './services/matterAccessAudit.js';

export function registerMatterAccessAuditRoutes(app: Express): void {
  app.get('/api/matters/:matterId/access-audit', async (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    try {
      const identity = await verifyFirebaseToken(req.header('authorization'));
      if (!identity) {
        res.status(401).json({ code: 'SIGN_IN_REQUIRED', error: 'Authentication required.' });
        return;
      }
      res.json(await getMatterAccessAudit(identity.uid, req.params.matterId));
    } catch (error: unknown) {
      if (error instanceof LifecycleError) {
        res.status(error.statusCode).json({ code: error.code, error: error.message });
        return;
      }
      console.error('[matterAccessAudit] ACCESS_AUDIT_FAILED');
      res.status(503).json({ code: 'ACCESS_AUDIT_UNAVAILABLE', error: 'Access audit is unavailable.' });
    }
  });
}
