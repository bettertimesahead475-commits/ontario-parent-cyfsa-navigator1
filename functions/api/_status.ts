/**
 * Cloudflare Pages Function: GET /api/_status
 *
 * Implements safe health and readiness reporting for the staging environment.
 * Public requests receive minimal non-sensitive operational status.
 * Authorized admin requests (with valid x-admin-secret or Authorization) receive
 * the high-level dependency configuration status matrix and safe preflight probes
 * without exposing secrets.
 */

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
}

const DEFAULT_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

function formatStatus(val?: string): 'configured' | 'missing' {
  if (!val || !val.trim()) return 'missing';
  return 'configured';
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
  const hasSupabaseKey = formatStatus(env.STAGING_SUPABASE_SERVICE_ROLE_KEY);
  const hasAnthropicKey = formatStatus(env.ANTHROPIC_API_KEY);
  const hasGeminiKey = formatStatus(env.GEMINI_API_KEY);
  const hasSessionSecret = formatStatus(env.SESSION_SECRET);
  const isDirectAnalyzerActive = env.DIRECT_ANALYZER_DISABLED !== 'true';

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
    (adminSecretHeader === configuredAdminSecret || bearerToken === configuredAdminSecret);

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
        diagnostics: {
          firebaseAuth: hasFirebase,
          supabaseStaging: hasSupabaseUrl,
          supabaseRpcKey: hasSupabaseKey,
          anthropicApi: hasAnthropicKey,
          directAnalyzer: isDirectAnalyzerActive ? 'active' : 'disabled',
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
    },
    { status: 200, headers: DEFAULT_HEADERS }
  );
};
