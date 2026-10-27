import type { Express, Request, Response } from 'express';
import { verifyFirebaseToken } from './services/firebaseAdmin.js';
import { LifecycleError } from './services/lifecycleErrors.js';
import {
  searchDirectory,
  getPublicProfile,
  claimProfile
} from './services/lawyerDirectory.js';

// Expected failures keep their customer message. Anything else is logged in full and answered generically, so raw
// database or configuration text never reaches a parent's screen.
function sendDirectoryError(res: Response, e: unknown, context: string) {
  if (e instanceof LifecycleError) {
    res.status(e.statusCode).json({ code: e.code, error: e.message });
    return;
  }
  console.error(`[lawyer directory] ${context} failed:`, e);
  res.status(503).json({
    code: 'DIRECTORY_UNAVAILABLE',
    error: 'The lawyer directory is unavailable right now. Please try again shortly.',
    retryable: true,
  });
}

export function registerLawyerDirectoryRoutes(app: Express) {
  // Public, unauthenticated search
  app.post('/api/directory/search', async (req: Request, res: Response) => {
    try {
      const filters = req.body;
      const results = await searchDirectory(filters);
      res.json(results);
    } catch (e: unknown) {
      sendDirectoryError(res, e, 'search');
    }
  });

  // Public, unauthenticated profile
  app.get('/api/directory/profiles/:id', async (req: Request, res: Response) => {
    try {
      const profile = await getPublicProfile(req.params.id);
      if (!profile) res.status(404).json({ error: 'Not found' });
      else res.json(profile);
    } catch (e: unknown) {
      sendDirectoryError(res, e, 'profile');
    }
  });

  // Authenticated claim
  app.post('/api/directory/profiles/:id/claim', async (req: Request, res: Response) => {
    try {
      const authHeader = req.header('authorization');
      const identity = await verifyFirebaseToken(authHeader);
      if (!identity) {
        res.status(401).json({ code: 'SIGN_IN_REQUIRED', error: 'Authentication required.' });
        return;
      }
      const result = await claimProfile(identity.uid, req.params.id);
      res.json(result);
    } catch (e: unknown) {
      sendDirectoryError(res, e, 'claim');
    }
  });
}
