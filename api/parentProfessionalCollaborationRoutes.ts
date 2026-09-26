import type { Express, Request, Response } from 'express';
import { verifyFirebaseToken } from './services/firebaseAdmin.js';
import { LifecycleError } from './services/lifecycleErrors.js';
import { getParentCollaborationSummary } from './services/parentProfessionalCollaboration.js';

export function registerParentProfessionalCollaborationRoutes(app: Express) {
  const authenticated = (action: (req: Request, uid: string) => Promise<unknown>) => async (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    try {
      const authHeader = req.header('authorization');
      const identity = await verifyFirebaseToken(authHeader);
      if (!identity) {
        res.status(401).json({ code: 'SIGN_IN_REQUIRED', error: 'Authentication required.' });
        return;
      }
      res.json(await action(req, identity.uid));
    } catch (e) {
      if (e instanceof LifecycleError) {
        res.status(e.statusCode).json({ code: e.code, error: e.message });
      } else {
        res.status(503).json({ code: 'COLLABORATION_UNAVAILABLE', error: 'Collaboration service is unavailable.' });
      }
    }
  };

  app.get('/api/matters/:matterId/collaboration', authenticated((r, u) => getParentCollaborationSummary(u, r.params.matterId)));
}
