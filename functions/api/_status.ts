/**
 * Cloudflare Pages Function: GET /api/_status
 *
 * Implements safe health and readiness reporting for the staging environment.
 * Public requests receive minimal non-sensitive operational status.
 * Authorized admin requests (with valid x-admin-secret or Authorization) receive
 * the high-level dependency configuration status matrix and safe preflight probes
 * without exposing secrets.
 */

import { normalizeApiKey } from './_supabase-key';

export interface StatusEnv {
  ANALYZER_ENABLED?: string;
  ADMIN_SECRET?: string;
  FIREBASE_PROJECT_ID?: string;
  STAGING_SUPABASE_URL?: string;
  STAGING_SUPABASE_SERVICE_ROLE_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  SESSION_SECRET?: string;
  PAYMENT_EMAIL?: string;
  DIRECT_ANALYZER_DISABLED?: string;
  ANALYZER_JOBS_QUEUE?: { send(message: unknown): Promise<unknown> };
}

const DEFAULT_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

/** Compares without stopping at the first differing character, so response time does not reveal the secret. */
function constantTimeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

function formatStatus(val?: string): 'configured' | 'missing' {
  if (!val || !val.trim()) return 'missing';
  return 'configured';
}

/**
 * A provider key that is present but cannot work (for example a one-character placeholder) used to
 * be reported as "configured", so a broken environment advertised analyzerReady:true. Check only the
 * documented public format of each key after removing paste damage; never the value itself.
 */
type KeyStatus = 'configured' | 'missing' | 'unusable';
function providerKeyStatus(raw: string | undefined, kind: 'supabase' | 'anthropic' | 'gemini'): KeyStatus {
  if (!raw || !raw.trim()) return 'missing';
  const key = normalizeApiKey(raw) ?? '';
  const usable = kind === 'anthropic' ? /^sk-ant-[A-Za-z0-9_-]{20,}$/.test(key)
    : kind === 'gemini' ? /^AIza[A-Za-z0-9_-]{35}$/.test(key)
    : /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(key) && key.length > 100 || /^sb_secret_[A-Za-z0-9_-]{20,}$/.test(key);
  return usable ? 'configured' : 'unusable';
}

export const onRequestGet = async ({
  request,
  env,
}: {
  request: Request;
  env: StatusEnv;
}): Promise<Response> => {
  const isAnalyzerEnabled = env.ANALYZER_ENABLED === 'true';
  const hasFirebase = formatStatus(env.FIREBASE_PROJECT_ID);
  const hasSupabaseUrl = formatStatus(env.STAGING_SUPABASE_URL);
  const hasSupabaseKey = providerKeyStatus(env.STAGING_SUPABASE_SERVICE_ROLE_KEY, 'supabase');
  const hasAnthropicKey = providerKeyStatus(env.ANTHROPIC_API_KEY, 'anthropic');
  const hasGeminiKey = providerKeyStatus(env.GEMINI_API_KEY, 'gemini');
  const unusable = ([['STAGING_SUPABASE_SERVICE_ROLE_KEY', hasSupabaseKey], ['ANTHROPIC_API_KEY', hasAnthropicKey], ['GEMINI_API_KEY', hasGeminiKey]] as const)
    .filter(([, status]) => status === 'unusable').map(([name]) => name);
  // Secret NAMES only, server-side. The public response stays minimal.
  if (unusable.length) console.warn('[CONFIG_SECRET_UNUSABLE]', JSON.stringify({ secrets: unusable }));
  const hasSessionSecret = formatStatus(env.SESSION_SECRET);
  const isDirectAnalyzerActive = env.DIRECT_ANALYZER_DISABLED !== 'true';
  const hasQueueProducer = typeof env.ANALYZER_JOBS_QUEUE?.send === 'function';

  const isLiveReady =
    isAnalyzerEnabled &&
    hasFirebase === 'configured' &&
    hasSupabaseUrl === 'configured' &&
    hasSupabaseKey === 'configured' &&
    hasAnthropicKey === 'configured';

  // Check admin authorization
  const authHeader = request.headers.get('Authorization') || '';
  const adminSecretHeader = request.headers.get('x-admin-secret') || '';
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';

  const configuredAdminSecret = env.ADMIN_SECRET?.trim();
  const isAdmin =
    Boolean(configuredAdminSecret) &&
    (constantTimeEqual(adminSecretHeader, configuredAdminSecret!) || constantTimeEqual(bearerToken, configuredAdminSecret!));

  // Authorized Admin Diagnostic Response
  if (isAdmin) {
    return Response.json(
      {
        status: 'ok',
        service: 'cyfsa-navigator-cloudflare-staging',
        runtime: 'cloudflare-pages-functions',
        environment: 'staging',
        analyzerEnabled: isAnalyzerEnabled,
        liveAnalysisReady: isLiveReady,
        forensicQueueReady: isLiveReady && hasQueueProducer,
        diagnostics: {
          firebaseAuth: hasFirebase,
          supabaseStaging: hasSupabaseUrl,
          supabaseRpcKey: hasSupabaseKey,
          anthropicApi: hasAnthropicKey,
          directAnalyzer: isDirectAnalyzerActive ? 'active' : 'disabled',
          analyzerJobQueue: hasQueueProducer ? 'configured' : 'missing',
        },
        extendedDetails: {
          geminiOcrApi: hasGeminiKey,
          sessionSecret: hasSessionSecret,
        },
      },
      { status: 200, headers: DEFAULT_HEADERS }
    );
  }

  // Public Minimal Health Response
  return Response.json(
    {
      status: 'ok',
      service: 'cyfsa-navigator-cloudflare-staging',
      runtime: 'cloudflare-pages-functions',
      environment: 'staging',
      analyzerReady: isLiveReady,
      forensicQueueReady: isLiveReady && hasQueueProducer,
    },
    { status: 200, headers: DEFAULT_HEADERS }
  );
};
