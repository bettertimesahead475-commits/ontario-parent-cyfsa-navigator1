import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as pg from 'pg';

describe('Human Review Database Capability Boundary', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('fails closed when missing HUMAN_REVIEW_DATABASE_URL, no fallback', async () => {
    delete process.env.HUMAN_REVIEW_DATABASE_URL;
    const { executeHumanReview } = await import('./humanReviewAccess.js?t=' + Date.now());
    await expect(executeHumanReview({
      uid: 'u', matterId: 'm', objectType: 'ENTITY', objectId: 'o', state: 'CONFIRMED', expectedUpdatedAt: 'd'
    })).rejects.toThrow('Missing HUMAN_REVIEW_DATABASE_URL');
  });

  it('uses HUMAN_REVIEW_DATABASE_URL to create a dedicated pool', async () => {
    process.env.HUMAN_REVIEW_DATABASE_URL = 'postgres://fake-human-reviewer:pass@localhost:5432/db';
    
    vi.mock('pg', () => {
      const connect = vi.fn().mockResolvedValue({
        query: vi.fn().mockResolvedValue({ rows: [{ data: { result: 'ok' } }] }),
        release: vi.fn()
      });
      return {
        default: {
          Pool: vi.fn().mockImplementation(() => ({ connect }))
        }
      };
    });

    const { executeHumanReview } = await import('./humanReviewAccess.js?t=' + Date.now());
    const res = await executeHumanReview({
      uid: 'u', matterId: 'm', objectType: 'ENTITY', objectId: 'o', state: 'CONFIRMED', expectedUpdatedAt: 'd'
    });
    
    expect(res.data).toEqual({ result: 'ok' });
    expect(res.error).toBeNull();
    
    vi.unmock('pg');
  });
});
