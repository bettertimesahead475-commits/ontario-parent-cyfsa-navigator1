import type { Express, Request, Response } from 'express';
import { verifyFirebaseToken } from './services/firebaseAdmin.js';
import { LifecycleError } from './services/lifecycleErrors.js';
import {
  searchDirectory,
  getPublicProfile,
  claimProfile
} from './services/lawyerDirectory.js';

export function registerLawyerDirectoryRoutes(app: Express) {
  // Public, unauthenticated search
  app.post('/api/directory/search', async (req: Request, res: Response) => {
    try {
      const filters = req.body;
      const results = await searchDirectory(filters);
      res.json(results);
    } catch (e: any) {
      console.error('[LawyerDirectory] Search failure:', e?.message || e);
      res.status(503).json({
        code: 'DIRECTORY_TEMPORARILY_UNAVAILABLE',
        error: 'The directory is temporarily unavailable. Please try again.'
      });
    }
  });

  // Public, unauthenticated profile
  app.get('/api/directory/profiles/:id', async (req: Request, res: Response) => {
    try {
      const profile = await getPublicProfile(req.params.id);
      if (!profile) res.status(404).json({ error: 'Not found' });
      else res.json(profile);
    } catch (e: any) {
      console.error('[LawyerDirectory] Get profile failure:', e?.message || e);
      res.status(503).json({
        code: 'DIRECTORY_TEMPORARILY_UNAVAILABLE',
        error: 'The directory is temporarily unavailable. Please try again.'
      });
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
    } catch (e: any) {
      if (e instanceof LifecycleError) {
        res.status(e.statusCode).json({ code: e.code, error: e.message });
      } else {
        console.error('[LawyerDirectory] Claim profile failure:', e?.message || e);
        res.status(500).json({ error: 'Profile claim request failed.' });
      }
    }
  });
}
