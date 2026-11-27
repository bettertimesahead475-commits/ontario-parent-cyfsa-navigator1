/**
 * Cloudflare Pages Functions - GET /api/analyzer-usage.
 *
 * Reports the caller's allowance from the same counters and limits the reservation code uses, so the number a
 * customer sees is the number that will be enforced:
 * - Signed-in free account: the free-trial counters of ./_free-trial.ts (one Quick and one Forensic, lifetime).
 * - Paid session, one-time tiers: free_usage row paid_session_<id>_total, shared by Quick and Forensic.
 * - Paid session, monthly tiers: Quick Reviews are not counted; Forensic uses paid_session_<id>_period_<start>.
 * When a counter cannot be read, the counts are reported as null (unknown) rather than as a full allowance.
 */

import { verifyFirebaseRequest } from './_auth-check';
import { normalizeApiKey } from './_supabase-key';
import { FREE_TRIAL_LIMITS, readCounter, readFreeTrialBalance } from './_free-trial';
import { monthlyCreditScope } from './_monthly-credit-scope';
import { LIMITS } from './_paid-credit-reservation';
import { readVerifiedPaidSession } from './_supabase-paid-session';
import { extractSessionId } from './analyze';

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

export { readCounter };

const TRIAL_TOTAL = FREE_TRIAL_LIMITS.quick + FREE_TRIAL_LIMITS.forensic;
const left = (limit: number, used: number | null) => (used === null ? null : Math.max(0, limit - used));

export const onRequestGet = async ({ request, env }: { request: Request; env: UsageEnv }): Promise<Response> => {
  const identity = await verifyFirebaseRequest(request, env);

  if (identity.status !== 'verified') {
    // Not signed in: analysis needs sign-in, so this only describes the free allowance.
    return Response.json(
      {
        type: 'free', tier: 'Free', signedIn: false, freeTrial: true, allowsForensic: true,
        limit: TRIAL_TOTAL, remaining: TRIAL_TOTAL, creditsLimit: TRIAL_TOTAL, creditsRemaining: TRIAL_TOTAL,
        quickReviewsUsed: 0, quickReviewsLimit: FREE_TRIAL_LIMITS.quick, quickReviewsRemaining: FREE_TRIAL_LIMITS.quick,
        forensicAnalysesUsed: 0, forensicAnalysesLimit: FREE_TRIAL_LIMITS.forensic, forensicAnalysesRemaining: FREE_TRIAL_LIMITS.forensic,
      },
      { status: 200, headers: DEFAULT_HEADERS }
    );
  }

  // Owner access is determined solely from the verified Firebase token.
  if (identity.emailVerified && identity.email?.trim().toLowerCase() === 'mr.pelkie@gmail.com') {
    return Response.json({ type: 'owner', tier: 'Owner/Admin', signedIn: true, unlimited: true, allowsForensic: true, countsAvailable: true, limit: null, remaining: null, creditsLimit: null, creditsRemaining: null, quickReviewsLimit: null, quickReviewsRemaining: null, forensicAnalysesLimit: null, forensicAnalysesRemaining: null }, { status: 200, headers: DEFAULT_HEADERS });
  }

  const url = new URL(request.url);
  const rawSession = request.headers.get('x-ps-session') || url.searchParams.get('sessionId');
  const sessionId = extractSessionId(rawSession);

  if (sessionId) {
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

  // Free trial: the same counters reserveFreeTrial enforces (one Quick and one Forensic per verified email; an account
  // that started under the earlier 3-Quick offer keeps that allowance).
  const balance = await readFreeTrialBalance(env, identity.uid, identity.email ?? null, identity.emailVerified);
  const quickUsed = balance.quickUsed;
  const forensicUsed = balance.forensicUsed;
  const quickLeft = left(balance.quickLimit, quickUsed);
  const forensicLeft = left(FREE_TRIAL_LIMITS.forensic, forensicUsed);
  const totalLimit = balance.quickLimit + FREE_TRIAL_LIMITS.forensic;
  const used = quickUsed === null || forensicUsed === null ? null : quickUsed + forensicUsed;
  const remaining = quickLeft === null || forensicLeft === null ? null : quickLeft + forensicLeft;
  const email = balance.emailVerified;
  return Response.json(
    {
      type: 'free', tier: 'Free', signedIn: true, freeTrial: true, emailVerificationRequired: !email, countsAvailable: used !== null,
      allowsForensic: forensicLeft === null || forensicLeft > 0,
      limit: totalLimit, remaining, creditsLimit: totalLimit, creditsRemaining: remaining, creditsUsed: used,
      quickReviewsUsed: quickUsed, quickReviewsLimit: balance.quickLimit, quickReviewsRemaining: quickLeft,
      forensicAnalysesUsed: forensicUsed, forensicAnalysesLimit: FREE_TRIAL_LIMITS.forensic, forensicAnalysesRemaining: forensicLeft,
    },
    { status: 200, headers: DEFAULT_HEADERS }
  );
};
