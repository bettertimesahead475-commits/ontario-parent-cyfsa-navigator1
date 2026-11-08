import { describe, expect, it } from 'vitest';
import { onRequestGet } from '../functions/api/_entitlement-readiness';
describe('Cloudflare staging entitlement readiness', () => {
  it('never grants entitlement without verified database access', async () => {
    for (const env of [
      {},
      { STAGING_SUPABASE_URL: 'https://nxfhvebzzobegubefcda.supabase.co/' },
      { STAGING_SUPABASE_URL: 'https://nxfhvebzzobegubefcda.supabase.co/', STAGING_SUPABASE_READ_KEY: 'test-placeholder' },
    ]) {
      const response = await onRequestGet({ env });
      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body.entitled).toBe(false);
      expect(body.analyzerReady).toBe(false);
      expect(body.code).toBe('ENTITLEMENT_VERIFICATION_PENDING');
      expect(response.headers.get('Cache-Control')).toBe('no-store');
    }
  });
});
