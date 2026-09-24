// Stage 10 slice 3: read-only access-history route over api/services/matterAccessHistory.ts.
//
// Mounted in api/_server.ts (Stage 10 slice 5).

import type { Express, Request, Response } from 'express';
import { verifyFirebaseToken } from './services/firebaseAdmin.js';
import { LifecycleError } from './services/lifecycleErrors.js';
import { getMatterAccessHistory } from './services/matterAccessHistory.js';

export function registerMatterAccessHistoryRoutes(app: Express): void {
  app.get('/api/matters/:matterId/access-history', async (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    try {
      const identity = await verifyFirebaseToken(req.header('authorization'));
      if (!identity) {
        res.status(401).json({ code: 'SIGN_IN_REQUIRED', error: 'Authentication required.' });
        return;
      }
      const { cursor, pageSize } = req.query;
      if (cursor !== undefined && typeof cursor !== 'string') {
        throw new LifecycleError(400, 'INVALID_CURSOR', 'The history cursor is not valid for this matter.');
      }
      const cursorParam: string | null = typeof cursor === 'string' ? cursor : null;
      let size: number | undefined;
      if (pageSize !== undefined) {
        if (typeof pageSize !== 'string' || !/^\d{1,4}$/.test(pageSize)) {
          throw new LifecycleError(400, 'INVALID_REQUEST', 'pageSize must be a positive integer.');
        }
        size = Number(pageSize);
      }
      res.json(await getMatterAccessHistory(identity.uid, req.params.matterId, { cursor: cursorParam, pageSize: size }));
    } catch (error: unknown) {
      if (error instanceof LifecycleError) {
        res.status(error.statusCode).json({ code: error.code, error: error.message });
        return;
      }
      console.error('[matterAccessHistory] ACCESS_HISTORY_FAILED');
      res.status(503).json({ code: 'ACCESS_HISTORY_UNAVAILABLE', error: 'Access history is unavailable.' });
    }
  });
}
