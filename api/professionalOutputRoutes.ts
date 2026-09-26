import type { Express, Request, Response } from 'express';
import { verifyFirebaseToken } from './services/firebaseAdmin.js';
import { LifecycleError } from './services/lifecycleErrors.js';
import {
  getProfessionalCaseBriefOutput,
  getChronologyOutput,
  getEvidenceIssuesPackageOutput
} from './services/professionalOutputs.js';

export function registerProfessionalOutputRoutes(app: Express) {
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
        res.status(503).json({ code: 'OUTPUT_UNAVAILABLE', error: 'Professional Output service is unavailable.' });
      }
    }
  };

  app.get('/api/professional-workspace/matters/:matterId/outputs/case-brief', authenticated((r, u) => getProfessionalCaseBriefOutput(u, r.params.matterId)));
  app.get('/api/professional-workspace/matters/:matterId/outputs/chronology', authenticated((r, u) => getChronologyOutput(u, r.params.matterId)));
  app.get('/api/professional-workspace/matters/:matterId/outputs/evidence-package', authenticated((r, u) => getEvidenceIssuesPackageOutput(u, r.params.matterId)));
}
