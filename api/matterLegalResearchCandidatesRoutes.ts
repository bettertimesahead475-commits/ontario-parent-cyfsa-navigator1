// Stage 9D-3 support route: read-only exposure of Stage 9B legal research candidates
// (api/services/matterLegalResearch.ts), UNMODIFIED, so the Stage 9D-3 professional research
// workspace UI can display authority/provenance detail (citation identifier, source provenance
// URL, content-integrity status) for a discovery result, which the frozen Stage 9D-2b
// results endpoint intentionally does not embed (it returns only candidateId).
//
// This file does not modify api/services/matterLegalDiscovery.ts, api/matterLegalDiscoveryRoutes.ts,
// or api/services/matterLegalResearch.ts. It calls the existing, already-frozen
// listMatterLegalResearchCandidates export exactly as written, with no new authorization path:
// that function independently re-verifies navigator_matter_members before returning any row.

import type { Express, Request, Response } from 'express';
import { verifyFirebaseToken } from './services/firebaseAdmin.js';
import { LifecycleError, requireUuid } from './services/lifecycleErrors.js';
import { listMatterLegalResearchCandidates } from './services/matterLegalResearch.js';

export function registerMatterLegalResearchCandidatesRoutes(app: Express): void {
  app.get('/api/matters/:matterId/legal-research/candidates', async (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    try {
      const identity = await verifyFirebaseToken(req.header('authorization'));
      if (!identity) {
        res.status(401).json({ code: 'SIGN_IN_REQUIRED', error: 'Authentication required.' });
        return;
      }
      const matterId = requireUuid(req.params.matterId, 'matterId');
      const candidates = await listMatterLegalResearchCandidates(identity.uid, matterId);
      res.json({ candidates });
    } catch (error: unknown) {
      if (error instanceof LifecycleError) {
        res.status(error.statusCode).json({ code: error.code, error: error.message });
        return;
      }
      console.error('[matterLegalResearchCandidates] LIST_CANDIDATES_FAILED');
      res.status(500).json({ code: 'LIST_CANDIDATES_FAILED', error: 'Failed to load research candidates.' });
    }
  });
}
