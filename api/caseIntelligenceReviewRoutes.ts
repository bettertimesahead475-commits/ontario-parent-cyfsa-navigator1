import type { Express, Request, Response } from 'express';
import { verifyFirebaseToken } from './services/firebaseAdmin.js';
import { LifecycleError } from './services/lifecycleErrors.js';
import { reviewIntelligence } from './services/caseIntelligenceReview.js';

export function registerCaseIntelligenceReviewRoutes(app: Express) {
  const authenticated = (action: (req: Request, uid: string) => Promise<unknown>) => async (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    try {
      const identity = await verifyFirebaseToken(req.header('authorization'));
      if (!identity) { res.status(401).json({ code: 'SIGN_IN_REQUIRED', error: 'Authentication required.' }); return; }
      res.json(await action(req, identity.uid));
    } catch (e) {
      if (e instanceof LifecycleError) res.status(e.statusCode).json({ code: e.code, error: e.message });
      else res.status(503).json({ code: 'REVIEW_UNAVAILABLE', error: 'Intelligence review is unavailable.' });
    }
  };

  app.patch('/api/matters/:matterId/intelligence/review', authenticated((r, u) => reviewIntelligence(u, r.params.matterId, r.body)));
}
