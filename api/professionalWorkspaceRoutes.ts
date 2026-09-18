import type { Express, Request, Response } from 'express';
import { verifyFirebaseToken } from './services/firebaseAdmin.js';
import { LifecycleError } from './services/lifecycleErrors.js';
import {
  getProfessionalMatters,
  getMatterOverview,
  getIntelligenceCategory,
  saveProfessionalReview
} from './services/professionalWorkspace.js';

export function registerProfessionalWorkspaceRoutes(app: Express) {
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
        res.status(503).json({ code: 'REVIEW_UNAVAILABLE', error: 'Professional Workspace is unavailable.' });
      }
    }
  };

  app.get('/api/professional-workspace/matters', authenticated((r, u) => getProfessionalMatters(u)));
  app.get('/api/professional-workspace/matters/:matterId/overview', authenticated((r, u) => getMatterOverview(u, r.params.matterId)));
  app.get('/api/professional-workspace/matters/:matterId/intelligence/:category', authenticated((r, u) => getIntelligenceCategory(u, r.params.matterId, r.params.category)));
  app.post('/api/professional-workspace/matters/:matterId/review', authenticated((r, u) => {
    const { findingType, findingId, reviewState, reviewNote } = r.body;
    return saveProfessionalReview(u, r.params.matterId, findingType, findingId, reviewState, reviewNote || null);
  }));
}
