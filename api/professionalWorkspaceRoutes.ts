import type { Express, Request, Response } from 'express';
import { verifyFirebaseToken } from './services/firebaseAdmin.js';
import { LifecycleError } from './services/lifecycleErrors.js';
import {
  getProfessionalMatters,
  getMatterOverview,
  getIntelligenceCategory,
  saveProfessionalReview,
  listProfessionalReviewsForFindingType,
  getProfessionalSourcePage
} from './services/professionalWorkspace.js';
import { generateCaseBrief, finalizeCaseBrief, getWorkProductVersions, getWorkProductVersion } from './services/litigationWorkProduct.js';

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
  app.get('/api/professional-workspace/matters/:matterId/evidence/:evidenceId/source', authenticated((r, u) => getProfessionalSourcePage(u, r.params.matterId, r.params.evidenceId)));
  app.post('/api/professional-workspace/matters/:matterId/review', authenticated((r, u) => {
    const { findingType, findingId, reviewState, reviewNote } = r.body;
    return saveProfessionalReview(u, r.params.matterId, findingType, findingId, reviewState, reviewNote || null);
  }));
  app.get('/api/professional-workspace/matters/:matterId/reviews/:findingType', authenticated((r, u) => listProfessionalReviewsForFindingType(u, r.params.matterId, r.params.findingType)));
  app.get('/api/professional-workspace/matters/:matterId/work-product/case-brief', authenticated((r, u) => generateCaseBrief(u, r.params.matterId)));
  app.post('/api/professional-workspace/matters/:matterId/work-product/case-brief/finalize', authenticated((r, u) => finalizeCaseBrief(u, r.params.matterId)));
  app.get('/api/professional-workspace/matters/:matterId/work-product/case-brief/versions', authenticated((r, u) => getWorkProductVersions(u, r.params.matterId)));
  app.get('/api/professional-workspace/matters/:matterId/work-product/case-brief/versions/:versionId', authenticated((r, u) => getWorkProductVersion(u, r.params.matterId, r.params.versionId)));
}
