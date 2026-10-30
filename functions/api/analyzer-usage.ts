/**
 * Cloudflare Pages Functions - Analyzer Usage & Entitlement Status API.
 *
 * GET /api/analyzer-usage
 * Returns the calling user's tier, credit allowances, and remaining scans.
 * Supports anonymous visitors, authenticated free users, and paid sessions.
 */

import { verifyFirebaseRequest } from './_auth-check';
import { readVerifiedPaidSession } from './_supabase-paid-session';

export interface UsageEnv {
  FIREBASE_PROJECT_ID?: string;
  STAGING_SUPABASE_URL?: string;
  STAGING_SUPABASE_READ_KEY?: string;
  STAGING_SUPABASE_SERVICE_ROLE_KEY?: string;
}

const DEFAULT_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

const PAID_TIER_LIMITS: Record<string, { quickLimit: number; forensicLimit: number }> = {
  Basic: { quickLimit: 3, forensicLimit: 0 },
  AnalyzerBasic: { quickLimit: 3, forensicLimit: 0 },
  Premium: { quickLimit: 5, forensicLimit: 5 },
  AnalyzerPremium: { quickLimit: 5, forensicLimit: 5 },
  Pro: { quickLimit: 999, forensicLimit: 5 },
  Community5: { quickLimit: 5, forensicLimit: 5 },
  Community10: { quickLimit: 10, forensicLimit: 10 },
  Community25: { quickLimit: 25, forensicLimit: 25 },
};

export const onRequestGet = async ({
  request,
  env,
}: {
  request: Request;
  env: UsageEnv;
}): Promise<Response> => {
  // Check if authenticated
  const identity = await verifyFirebaseRequest(request, env);

  if (identity.status !== 'verified') {
    // Anonymous unauthenticated allowance representation
    return Response.json(
      {
        type: 'free',
        tier: 'Free',
        limit: 3,
        remaining: 3,
        quickReviewsUsed: 0,
        quickReviewsLimit: 3,
        quickReviewsRemaining: 3,
        forensicAnalysesUsed: 0,
        forensicAnalysesLimit: 0,
        forensicAnalysesRemaining: 0,
      },
      { status: 200, headers: DEFAULT_HEADERS }
    );
  }

  const url = new URL(request.url);
  const sessionId = request.headers.get('x-ps-session') || url.searchParams.get('sessionId');

  // Paid Session Lookup
  if (sessionId && /^[0-9a-f-]{36}$/i.test(sessionId)) {
    const sessionRead = await readVerifiedPaidSession(env, identity.uid, sessionId);
    if (sessionRead.status === 'verified') {
      const tierInfo = PAID_TIER_LIMITS[sessionRead.session.tier] || { quickLimit: 3, forensicLimit: 0 };
      return Response.json(
        {
          type: 'paid',
          tier: sessionRead.session.tier,
          sessionId: sessionRead.session.sessionId,
          limit: tierInfo.quickLimit,
          remaining: tierInfo.quickLimit,
          quickReviewsLimit: tierInfo.quickLimit,
          quickReviewsRemaining: tierInfo.quickLimit,
          quickReviewsUsed: 0,
          forensicAnalysesLimit: tierInfo.forensicLimit,
          forensicAnalysesRemaining: tierInfo.forensicLimit,
          forensicAnalysesUsed: 0,
        },
        { status: 200, headers: DEFAULT_HEADERS }
      );
    }
  }

  // Authenticated Free User
  return Response.json(
    {
      type: 'free',
      tier: 'Free',
      limit: 3,
      remaining: 3,
      quickReviewsUsed: 0,
      quickReviewsLimit: 3,
      quickReviewsRemaining: 3,
      forensicAnalysesUsed: 0,
      forensicAnalysesLimit: 0,
      forensicAnalysesRemaining: 0,
    },
    { status: 200, headers: DEFAULT_HEADERS }
  );
};
