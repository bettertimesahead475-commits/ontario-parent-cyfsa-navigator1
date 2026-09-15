import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import express from 'express';
import { registerCaseIntelligenceReviewRoutes } from '../caseIntelligenceReviewRoutes.js';
import * as access from './access.js';
import * as firebaseAdmin from './firebaseAdmin.js';

describe('Case Intelligence Review API & Service Boundary', () => {
  let app: express.Express;
  let mockRpc: any;

  beforeEach(() => {
    vi.clearAllMocks();
    app = express();
    app.use(express.json());
    registerCaseIntelligenceReviewRoutes(app);

    mockRpc = vi.fn().mockResolvedValue({ data: { id: 'obj-123', review_state: 'CONFIRMED', changed: true } });
    vi.spyOn(access, 'getSupabase').mockReturnValue({ rpc: mockRpc } as any);
  });

  describe('Authentication & Capability Boundary', () => {
    it('fails if missing Firebase token', async () => {
      const res = await request(app).patch('/api/matters/m-123/intelligence/review').send({});
      expect(res.status).toBe(401);
      expect(res.body.code).toBe('SIGN_IN_REQUIRED');
    });

    it('fails if invalid Firebase token', async () => {
      vi.spyOn(firebaseAdmin, 'verifyFirebaseToken').mockResolvedValue(null);
      const res = await request(app)
        .patch('/api/matters/m-123/intelligence/review')
        .set('Authorization', 'Bearer bad-token')
        .send({});
      expect(res.status).toBe(401);
    });

    it('rejects payload if it tries to inject spoofable fields (uid/actor)', async () => {
      vi.spyOn(firebaseAdmin, 'verifyFirebaseToken').mockResolvedValue({ uid: 'real-user-123' } as any);
      
      const res = await request(app)
        .patch('/api/matters/52c502fb-bd1c-43a4-b9b5-4122d2ee015a/intelligence/review')
        .set('Authorization', 'Bearer valid-token')
        .send({
          uid: 'spoofed-uid',
          objectType: 'ENTITY',
          objectId: '52c502fb-bd1c-43a4-b9b5-4122d2ee015a',
          reviewState: 'CONFIRMED',
          expectedUpdatedAt: '2025-01-01T12:00:00Z'
        });

      expect(res.status).toBe(400);
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('derives UID strictly from verified token', async () => {
      vi.spyOn(firebaseAdmin, 'verifyFirebaseToken').mockResolvedValue({ uid: 'real-user-123' } as any);
      
      await request(app)
        .patch('/api/matters/52c502fb-bd1c-43a4-b9b5-4122d2ee015a/intelligence/review')
        .set('Authorization', 'Bearer valid-token')
        .send({
          objectType: 'ENTITY',
          objectId: '52c502fb-bd1c-43a4-b9b5-4122d2ee015a',
          reviewState: 'CONFIRMED',
          expectedUpdatedAt: '2025-01-01T12:00:00Z'
        });

      expect(mockRpc).toHaveBeenCalledWith('navigator_intelligence_review_update', expect.objectContaining({
        p_uid: 'real-user-123'
      }));
    });
  });

  describe('Authorization & Input Validation', () => {
    beforeEach(() => {
      vi.spyOn(firebaseAdmin, 'verifyFirebaseToken').mockResolvedValue({ uid: 'user-1' } as any);
    });

    it('rejects invalid object types', async () => {
      const res = await request(app)
        .patch('/api/matters/m-123/intelligence/review')
        .set('Authorization', 'Bearer valid-token')
        .send({
          objectType: 'INVALID_TYPE',
          objectId: '52c502fb-bd1c-43a4-b9b5-4122d2ee015a',
          reviewState: 'CONFIRMED',
          expectedUpdatedAt: '2025-01-01T12:00:00Z'
        });
      expect(res.status).toBe(400);
      expect(res.body.code).toBe('INVALID_REVIEW_REQUEST');
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('rejects invalid state transitions', async () => {
      const res = await request(app)
        .patch('/api/matters/m-123/intelligence/review')
        .set('Authorization', 'Bearer valid-token')
        .send({
          objectType: 'ENTITY',
          objectId: '52c502fb-bd1c-43a4-b9b5-4122d2ee015a',
          reviewState: 'INVALID_STATE',
          expectedUpdatedAt: '2025-01-01T12:00:00Z'
        });
      expect(res.status).toBe(400);
      expect(mockRpc).not.toHaveBeenCalled();
    });

    it('translates P0002 to 404 (cross-matter fails or not found)', async () => {
      mockRpc.mockResolvedValue({ error: { code: 'P0002' } });
      const res = await request(app)
        .patch('/api/matters/52c502fb-bd1c-43a4-b9b5-4122d2ee015a/intelligence/review')
        .set('Authorization', 'Bearer valid-token')
        .send({
          objectType: 'ENTITY',
          objectId: '52c502fb-bd1c-43a4-b9b5-4122d2ee015a',
          reviewState: 'CONFIRMED',
          expectedUpdatedAt: '2025-01-01T12:00:00Z'
        });
      expect(res.status).toBe(404);
    });

    it('translates 40001 to 409 (concurrency token conflict)', async () => {
      mockRpc.mockResolvedValue({ error: { code: '40001' } });
      const res = await request(app)
        .patch('/api/matters/52c502fb-bd1c-43a4-b9b5-4122d2ee015a/intelligence/review')
        .set('Authorization', 'Bearer valid-token')
        .send({
          objectType: 'ENTITY',
          objectId: '52c502fb-bd1c-43a4-b9b5-4122d2ee015a',
          reviewState: 'CONFIRMED',
          expectedUpdatedAt: '2025-01-01T12:00:00Z'
        });
      expect(res.status).toBe(409);
      expect(res.body.code).toBe('REVIEW_CONFLICT');
    });
  });
});
