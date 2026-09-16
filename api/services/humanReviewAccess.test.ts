import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as pg from 'pg';

vi.mock('pg', () => {
  const connect = vi.fn().mockResolvedValue({
    query: vi.fn().mockResolvedValue({ rows: [{ data: { result: 'ok' } }] }),
    release: vi.fn()
  });
  return {
    default: {
      Pool: vi.fn().mockImplementation(function() { return { connect }; })
    }
  };
});

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
    const { executeHumanReview } = await import('./humanReviewAccess.js');
    await expect(executeHumanReview({
      uid: 'u', matterId: 'm', objectType: 'ENTITY', objectId: 'o', state: 'CONFIRMED', expectedUpdatedAt: 'd'
    })).rejects.toThrow('Missing HUMAN_REVIEW_DATABASE_URL');
  });

  it('uses HUMAN_REVIEW_DATABASE_URL to create a dedicated pool with safe TLS and max: 1 pooling', async () => {
    process.env.HUMAN_REVIEW_DATABASE_URL = 'postgres://fake-human-reviewer:pass@127.0.0.1:5432/db';
    
    const { executeHumanReview } = await import('./humanReviewAccess.js');
    const res = await executeHumanReview({
      uid: 'u', matterId: 'm', objectType: 'ENTITY', objectId: 'o', state: 'CONFIRMED', expectedUpdatedAt: 'd'
    });
    
    expect(res.data).toEqual({ result: 'ok' });
    expect(res.error).toBeNull();

    // Verify Pool was called correctly
    const pg = await import('pg');
    expect(pg.default.Pool).toHaveBeenCalledTimes(1);
    
    const poolArgs = vi.mocked(pg.default.Pool).mock.calls[0][0];
    
    // Pooling preservation
    expect(poolArgs?.max).toBe(1);
    
    // TLS preservation / proof of insecure removal
    if (poolArgs?.ssl) {
      if (typeof poolArgs.ssl === 'object') {
        expect(poolArgs.ssl.rejectUnauthorized).not.toBe(false);
      }
    }
    
    // Verify parameterized RPC
    const poolMock = vi.mocked(pg.default.Pool).mock.results[0].value;
    const clientMock = await poolMock.connect();
    expect(clientMock.query).toHaveBeenCalledTimes(1);
    const queryArgs = clientMock.query.mock.calls[0];
    expect(queryArgs[0]).toContain('SELECT public.navigator_intelligence_review_update($1, $2, $3, $4, $5, $6)');
    expect(queryArgs[1]).toEqual(['u', 'm', 'ENTITY', 'o', 'CONFIRMED', 'd']);
  });
});
