import { describe, expect, it, vi } from 'vitest';
import { onRequestGet, type StatusEnv } from '../functions/api/_status';

describe('Cloudflare Staging Health & Readiness Endpoint (/api/_status)', () => {
  it('returns minimal public status without leaking infrastructure details', async () => {
    const request = new Request('https://staging.example/api/_status', { method: 'GET' });
    const env: StatusEnv = {
      ANALYZER_ENABLED: 'false',
      STAGING_SUPABASE_URL: 'https://nxfhvebzzobegubefcda.supabase.co',
      STAGING_SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwic3ludGhldGljIjp0cnVlfQ.c3ludGhldGljLXNpZ25hdHVyZS1mb3ItdGVzdHM',
      ANTHROPIC_API_KEY: 'sk-ant-synthetic0000000000000000000000',
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
      forensicQueueReady: false,
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
      STAGING_SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwic3ludGhldGljIjp0cnVlfQ.c3ludGhldGljLXNpZ25hdHVyZS1mb3ItdGVzdHM',
      ANTHROPIC_API_KEY: 'sk-ant-synthetic0000000000000000000000',
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
      analyzerJobQueue: 'missing',
    });
    // Ensure no secret values are returned in response
    expect(JSON.stringify(json)).not.toContain('admin-secret-token-xyz');
    expect(JSON.stringify(json)).not.toContain('key-present');
  });

  it('reports Forensic Queue readiness only when the Pages producer binding exists', async () => {
    const env: StatusEnv = {
      ANALYZER_ENABLED: 'true',
      FIREBASE_PROJECT_ID: 'gen-lang-client-0105737183',
      STAGING_SUPABASE_URL: 'https://nxfhvebzzobegubefcda.supabase.co',
      STAGING_SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIiwic3ludGhldGljIjp0cnVlfQ.c3ludGhldGljLXNpZ25hdHVyZS1mb3ItdGVzdHM',
      ANTHROPIC_API_KEY: 'sk-ant-synthetic0000000000000000000000',
      ANALYZER_JOBS_QUEUE: { send: async () => undefined },
    };
    const request = new Request('https://preview.example/api/status');
    const response = await onRequestGet({ request, env });
    expect(await response.json()).toMatchObject({ analyzerReady: true, forensicQueueReady: true });
    const unbound = await onRequestGet({ request, env: { ...env, ANALYZER_JOBS_QUEUE: undefined } });
    expect(await unbound.json()).toMatchObject({ analyzerReady: true, forensicQueueReady: false });
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
      analyzerJobQueue: 'missing',
    });
  });
});

describe('GET /api/status route', () => {
  it('is a real Pages route that serves the status handler', async () => {
    const route = await import('../functions/api/status');
    const helper = await import('../functions/api/_status');
    expect(route.onRequestGet).toBe(helper.onRequestGet);
  });

  it('gives the binding matrix only to the admin secret, and never secret values', async () => {
    const { onRequestGet } = await import('../functions/api/_status');
    const env = { ADMIN_SECRET: 'admin-secret-value', ANTHROPIC_API_KEY: 'sk-ant-synthetic0000000000000000000000', FIREBASE_PROJECT_ID: 'p' } as any;
    const pub = await onRequestGet({ request: new Request('https://s/api/status'), env });
    const pubText = await pub.text();
    expect(pubText).not.toMatch(/diagnostics|sk-real-key|admin-secret-value/);
    const wrong = await onRequestGet({ request: new Request('https://s/api/status', { headers: { 'x-admin-secret': 'admin-secret-valuX' } }), env });
    expect(await wrong.text()).not.toMatch(/diagnostics/);
    const admin = await onRequestGet({ request: new Request('https://s/api/status', { headers: { 'x-admin-secret': 'admin-secret-value' } }), env });
    const adminText = await admin.text();
    expect(adminText).toMatch(/"anthropicApi":"configured"/);
    expect(adminText).not.toMatch(/sk-real-key|admin-secret-value/);
  });
});

describe('status readiness rejects unusable provider keys', () => {
  it('does not report analyzerReady when a secret is a placeholder, and logs only the secret name', async () => {
    // Regression: the preview environment held a one-character service-role key and a short Gemini key,
    // yet /api/status reported analyzerReady:true.
    const { onRequestGet } = await import('../functions/api/_status');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const placeholder = String.fromCharCode(0x2022);
    const env = {
      ANALYZER_ENABLED: 'true', FIREBASE_PROJECT_ID: 'p', STAGING_SUPABASE_URL: 'https://synthetic.supabase.co',
      STAGING_SUPABASE_SERVICE_ROLE_KEY: placeholder, ANTHROPIC_API_KEY: 'sk-ant-synthetic0000000000000000000000', GEMINI_API_KEY: 'short',
    } as any;
    const res = await onRequestGet({ request: new Request('https://x.pages.dev/api/status'), env });
    const body = await res.json() as any;
    expect(body.analyzerReady).toBe(false);
    expect(JSON.stringify(body)).not.toMatch(/SERVICE_ROLE|GEMINI|ANTHROPIC/);
    const logged = warn.mock.calls.map((c) => c.join(' ')).join('\n');
    expect(logged).toContain('STAGING_SUPABASE_SERVICE_ROLE_KEY');
    expect(logged).toContain('GEMINI_API_KEY');
    expect(logged).not.toContain('ANTHROPIC_API_KEY');
    expect(logged).not.toContain(placeholder);
    warn.mockRestore();
  });
});
