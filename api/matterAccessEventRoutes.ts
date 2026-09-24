// Stage 10: read-only route over the append-only matter access event log
// (api/services/matterAccessEvents.ts).
//
// NOT YET MOUNTED, for the same reason as api/matterAccessAuditRoutes.ts: api/_server.ts is a
// shared registration file that in-flight Stage 9 work may also edit. The one-line
// registerMatterAccessEventRoutes(app) call is deferred to post-Stage-9 integration.
//
// There is deliberately NO write route: events are recorded only by trusted server paths.

import type { Express, Request, Response } from 'express';
import { verifyFirebaseToken } from './services/firebaseAdmin.js';
import { LifecycleError } from './services/lifecycleErrors.js';
import { listMatterAccessEvents } from './services/matterAccessEvents.js';

function parseNonNegativeInt(value: unknown, field: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (typeof value !== 'string' || !/^\d{1,15}$/.test(value)) {
    throw new LifecycleError(400, 'INVALID_REQUEST', `${field} must be a non-negative integer.`);
  }
  return Number(value);
}

export function registerMatterAccessEventRoutes(app: Express): void {
  app.get('/api/matters/:matterId/access-events', async (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    try {
      const identity = await verifyFirebaseToken(req.header('authorization'));
      if (!identity) {
        res.status(401).json({ code: 'SIGN_IN_REQUIRED', error: 'Authentication required.' });
        return;
      }
      const afterSequence = parseNonNegativeInt(req.query.after, 'after', 0);
      const limit = parseNonNegativeInt(req.query.limit, 'limit', 100);
      res.json(await listMatterAccessEvents(identity.uid, req.params.matterId, { afterSequence, limit }));
    } catch (error: unknown) {
      if (error instanceof LifecycleError) {
        res.status(error.statusCode).json({ code: error.code, error: error.message });
        return;
      }
      console.error('[matterAccessEvents] ACCESS_EVENTS_FAILED');
      res.status(503).json({ code: 'ACCESS_EVENTS_UNAVAILABLE', error: 'Access history is unavailable.' });
    }
  });
}
