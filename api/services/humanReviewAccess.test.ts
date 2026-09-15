import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { getHumanReviewSupabase } from './humanReviewAccess.js';
import * as supabaseJs from '@supabase/supabase-js';

describe('Human Review Database Capability Boundary', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('fails closed when missing SUPABASE_HUMAN_REVIEW_KEY, no fallback', async () => {
    // Intentionally remove the key
    delete process.env.SUPABASE_HUMAN_REVIEW_KEY;
    
    // ensure access module was re-imported fresh so the cached client is null
    const { getHumanReviewSupabase: getClient } = await import('./humanReviewAccess.js?t=1');
    expect(() => getClient()).toThrow('Missing SUPABASE_HUMAN_REVIEW_KEY');
  });

  it('uses SUPABASE_HUMAN_REVIEW_KEY to create a dedicated client', async () => {
    process.env.SUPABASE_URL = 'http://localhost';
    process.env.SUPABASE_HUMAN_REVIEW_KEY = 'fake-human-review-key';
    
    const { getHumanReviewSupabase: getClient } = await import('./humanReviewAccess.js?t=2');
    
    const client = getClient();
    expect(client).toBeDefined();
  });
});
