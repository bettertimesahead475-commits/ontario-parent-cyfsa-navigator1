import { describe, expect, it } from 'vitest';
import { onRequestGet, type StatusEnv } from '../functions/api/_status';

describe('Cloudflare Staging Health & Readiness Endpoint (/api/_status)', () => {
  it('returns minimal public status without leaking infrastructure details', async () => {
    const request = new Request('https://staging.example/api/_status', { method: 'GET' });
    const env: StatusEnv = {
      ANALYZER_ENABLED: 'false',
      STAGING_SUPABASE_URL: 'https://nxfhvebzzobegubefcda.supabase.co',
      STAGING_SUPABASE_SERVICE_ROLE_KEY: 'secret-key-123',
      ANTHROPIC_API_KEY: 'anthropic-secret-456',
    };

    const response = await onRequestGet({ request, env });
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json).toEqual({
      status: 'ok',
      service: 'cyfsa-navigator-cloudflare-staging',
      runtime: 'cloudflare-pages-functions',
      environment: 'staging',
      analyzerReady: false,
    });
    // Never leaks keys or diagnostics to public
    expect(json.diagnostics).toBeUndefined();
    expect(JSON.stringify(json)).not.toContain('secret');
  });

  it('returns structured diagnostic matrix for authorized admin requests', async () => {
    const adminSecret = 'admin-secret-token-xyz';
    const request = new Request('https://staging.example/api/_status', {
      method: 'GET',
      headers: {
        'x-admin-secret': adminSecret,
      },
    });

    const env: StatusEnv = {
      ADMIN_SECRET: adminSecret,
      ANALYZER_ENABLED: 'true',
      FIREBASE_PROJECT_ID: 'gen-lang-client-0105737183',
      STAGING_SUPABASE_URL: 'https://nxfhvebzzobegubefcda.supabase.co',
      STAGING_SUPABASE_SERVICE_ROLE_KEY: 'key-present',
      ANTHROPIC_API_KEY: 'key-present',
    };

    const response = await onRequestGet({ request, env });
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.analyzerEnabled).toBe(true);
    expect(json.liveAnalysisReady).toBe(true);
    expect(json.diagnostics).toEqual({
      firebaseAuth: 'configured',
      supabaseStaging: 'configured',
      supabaseRpcKey: 'configured',
      anthropicApi: 'configured',
      directAnalyzer: 'active',
    });
    // Ensure no secret values are returned in response
    expect(JSON.stringify(json)).not.toContain('admin-secret-token-xyz');
    expect(JSON.stringify(json)).not.toContain('key-present');
  });

  it('reports missing dependencies cleanly when some keys are unconfigured', async () => {
    const adminSecret = 'admin-secret-token-xyz';
    const request = new Request('https://staging.example/api/_status', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${adminSecret}`,
      },
    });

    const env: StatusEnv = {
      ADMIN_SECRET: adminSecret,
      ANALYZER_ENABLED: 'true',
      FIREBASE_PROJECT_ID: 'gen-lang-client-0105737183',
      STAGING_SUPABASE_URL: 'https://nxfhvebzzobegubefcda.supabase.co',
      // Missing STAGING_SUPABASE_SERVICE_ROLE_KEY and ANTHROPIC_API_KEY
    };

    const response = await onRequestGet({ request, env });
    expect(response.status).toBe(200);
    const json = await response.json();

    expect(json.analyzerEnabled).toBe(true);
    expect(json.liveAnalysisReady).toBe(false);
    expect(json.diagnostics).toEqual({
      firebaseAuth: 'configured',
      supabaseStaging: 'configured',
      supabaseRpcKey: 'missing',
      anthropicApi: 'missing',
      directAnalyzer: 'active',
    });
  });
});
