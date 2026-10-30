/**
 * Cloudflare Pages Functions - GET /api/analyzer-usage.
 *
 * Reports the caller's allowance from the same counters and limits the reservation code uses, so the number a
 * customer sees is the number that will be enforced:
 * - Signed-in free account: free_usage row keyed by the Firebase uid, limit FREE_SCAN_LIMIT (free_reserve_scan).
 * - Paid session, one-time tiers: free_usage row paid_session_<id>_total, shared by Quick and Forensic.
 * - Paid session, monthly tiers: Quick Reviews are not counted; Forensic uses paid_session_<id>_period_<start>.
 * When a counter cannot be read, the counts are reported as null (unknown) rather than as a full allowance.
 */

import { verifyFirebaseRequest } from './_auth-check';
import { FREE_SCAN_LIMIT } from './_free-credit-reservation';
import { monthlyCreditScope } from './_monthly-credit-scope';
import { LIMITS } from './_paid-credit-reservation';
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

/** analyses_used for one counter row, 0 when the row does not exist yet, null when it cannot be read. */
export async function readCounter(env: UsageEnv, key: string, fetcher: typeof fetch = fetch): Promise<number | null> {
  if (!env.STAGING_SUPABASE_URL || !env.STAGING_SUPABASE_SERVICE_ROLE_KEY) return null;
  try {
    const url = new URL('/rest/v1/free_usage', env.STAGING_SUPABASE_URL);
    url.searchParams.set('uid', `eq.${key}`);
    url.searchParams.set('select', 'analyses_used');
    const res = await fetcher(url.toString(), {
      headers: { apikey: env.STAGING_SUPABASE_SERVICE_ROLE_KEY, Authorization: `Bearer ${env.STAGING_SUPABASE_SERVICE_ROLE_KEY}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ analyses_used?: number }>;
    if (!Array.isArray(rows)) return null;
    const used = rows[0]?.analyses_used ?? 0;
    return typeof used === 'number' && Number.isFinite(used) ? used : null;
  } catch {
    return null;
  }
}

const left = (limit: number, used: number | null) => (used === null ? null : Math.max(0, limit - used));

export const onRequestGet = async ({ request, env }: { request: Request; env: UsageEnv }): Promise<Response> => {
  const identity = await verifyFirebaseRequest(request, env);

  if (identity.status !== 'verified') {
    // Not signed in: analysis needs sign-in, so this only describes the free allowance.
    return Response.json(
      {
        type: 'free', tier: 'Free', signedIn: false,
        limit: FREE_SCAN_LIMIT, remaining: FREE_SCAN_LIMIT, creditsLimit: FREE_SCAN_LIMIT, creditsRemaining: FREE_SCAN_LIMIT,
        quickReviewsUsed: 0, quickReviewsLimit: FREE_SCAN_LIMIT, quickReviewsRemaining: FREE_SCAN_LIMIT,
        forensicAnalysesUsed: 0, forensicAnalysesLimit: 0, forensicAnalysesRemaining: 0,
      },
      { status: 200, headers: DEFAULT_HEADERS }
    );
  }

  const url = new URL(request.url);
  const sessionId = request.headers.get('x-ps-session') || url.searchParams.get('sessionId');

  if (sessionId && /^[0-9a-f-]{36}$/i.test(sessionId)) {
    const sessionRead = await readVerifiedPaidSession(env, identity.uid, sessionId);
    if (sessionRead.status === 'verified') {
      const s = sessionRead.session;
      const tier = LIMITS[s.tier];
      if (tier) {
        if (!tier.monthly) {
          const used = await readCounter(env, `paid_session_${s.sessionId}_total`);
          const remaining = left(tier.limit, used);
          return Response.json(
            {
              type: 'paid', tier: s.tier, sessionId: s.sessionId, isMonthly: false, allowsForensic: tier.forensic, countsAvailable: used !== null,
              limit: tier.limit, remaining, creditsLimit: tier.limit, creditsRemaining: remaining, creditsUsed: used,
              quickReviewsLimit: tier.limit, quickReviewsRemaining: remaining, quickReviewsUsed: used,
              forensicAnalysesLimit: tier.forensic ? tier.limit : 0, forensicAnalysesRemaining: tier.forensic ? remaining : 0, forensicAnalysesUsed: tier.forensic ? used : 0,
            },
            { status: 200, headers: DEFAULT_HEADERS }
          );
        }
        let period: string | null = null;
        try { period = monthlyCreditScope(s.issuedAt || '', new Date()).replace(/^period:/, ''); } catch { period = null; }
        const used = period ? await readCounter(env, `paid_session_${s.sessionId}_period_${period}`) : null;
        const remaining = left(tier.limit, used);
        return Response.json(
          {
            type: 'paid', tier: s.tier, sessionId: s.sessionId, isMonthly: true, allowsForensic: tier.forensic, countsAvailable: used !== null,
            // Quick Reviews are not counted on monthly plans; the credit pill shows the Forensic allowance.
            limit: tier.limit, remaining, creditsLimit: tier.limit, creditsRemaining: remaining, creditsUsed: used,
            quickReviewsLimit: null, quickReviewsRemaining: null, quickReviewsUsed: null,
            forensicAnalysesLimit: tier.limit, forensicAnalysesRemaining: remaining, forensicAnalysesUsed: used,
          },
          { status: 200, headers: DEFAULT_HEADERS }
        );
      }
    }
  }

  const used = await readCounter(env, identity.uid);
  const remaining = left(FREE_SCAN_LIMIT, used);
  return Response.json(
    {
      type: 'free', tier: 'Free', signedIn: true, countsAvailable: used !== null,
      limit: FREE_SCAN_LIMIT, remaining, creditsLimit: FREE_SCAN_LIMIT, creditsRemaining: remaining, creditsUsed: used,
      quickReviewsUsed: used, quickReviewsLimit: FREE_SCAN_LIMIT, quickReviewsRemaining: remaining,
      forensicAnalysesUsed: 0, forensicAnalysesLimit: 0, forensicAnalysesRemaining: 0,
    },
    { status: 200, headers: DEFAULT_HEADERS }
  );
};
