/**
 * Cloudflare Pages Functions - customer payment status.
 *
 * GET /api/my-payments
 * The signed-in customer's own Interac e-Transfer orders (pending, ready to activate, activated, refunded), payment
 * instructions for orders still awaiting verification, and active entitlements with renewal dates. Read-only.
 */
import { verifyFirebaseRequest } from './_auth-check';
import { RATE_LIMITS, rateLimitRetryAfter, rateLimitSubject, rateLimitedResponse } from './_rate-limit';
import { rest, type AdminStoreEnv } from './_admin-store';
import { amountOf, codesWithLinks, paymentState, paymentsOf, refundedReferences } from './_customer-payments';
import { getInstructions } from './request-access';
import { TIER_PRICES } from './access-pricing';

const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
export const RENEWAL_REMINDER_DAYS = 7;

interface Env extends AdminStoreEnv { FIREBASE_PROJECT_ID?: string; PAYMENT_EMAIL?: string }
type SessionRow = { id?: string; tier: string; issued_at: string | null; expires_at: string | null };

export const onRequestGet = async ({ request, env }: { request: Request; env: Env }): Promise<Response> => {
  const identity = await verifyFirebaseRequest(request, env);
  if (identity.status !== 'verified' || !identity.uid) {
    return Response.json({ error: 'Sign in to see your payments.', code: 'SIGN_IN_REQUIRED' }, { status: 401, headers: HEADERS });
  }
  const retryAfter = rateLimitRetryAfter('myPayments', rateLimitSubject(request, identity.uid), RATE_LIMITS.myPayments);
  if (retryAfter) return rateLimitedResponse(retryAfter);
  if (!env.STAGING_SUPABASE_URL || !env.STAGING_SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json({ error: 'Payment records are not available right now.', code: 'PAYMENT_STORAGE_NOT_READY' }, { status: 503, headers: HEADERS });
  }
  const payTo = (env.PAYMENT_EMAIL || 'chris@cyfsanavigator.com').trim().toLowerCase();
  const now = Date.now();
  try {
    const payments = await paymentsOf(env, identity.uid);
    const [{ codes, linked }, sessions] = await Promise.all([
      codesWithLinks(env, payments.map((p) => p.reference_number)),
      rest<SessionRow[]>(env, `navigator_paid_sessions?select=id,tier,issued_at,expires_at&firebase_uid=eq.${encodeURIComponent(identity.uid)}&revoked_at=is.null&expires_at=gt.${encodeURIComponent(new Date(now).toISOString())}&order=expires_at.desc&limit=20`),
    ]);
    // A refund is recorded in the audit trail. If it cannot be read, approved orders show "unknown" rather than a guess.
    const refunded = payments.some((p) => p.status !== 'pending') ? await refundedReferences(env).catch(() => null) : new Set<string>();
    const activeSessionIds = new Set(sessions.map((s) => s.id).filter(Boolean));
    return Response.json({
      payTo,
      orders: payments.map((p) => {
        const amount = amountOf(p.amount);
        const state = paymentState(p, codes, refunded);
        // Orders recorded before prices were unified may hold an amount that differs from the advertised price;
        // they get no payment instructions, so nobody is told to send a different amount than checkout showed.
        const priceOutdated = state === 'awaiting_verification' && !(Math.abs(amount - (TIER_PRICES[p.plan] ?? Number.NaN)) < 0.005);
        // Whether this order's own entitlement is still active (so it can be restored on another browser). Omitted when
        // the database cannot link codes to entitlements yet (before 20261110004740): unknown, never guessed.
        const accessActive = linked && state === 'activated' && codes.some((c) => c.reference_number === p.reference_number && c.redeemed_session_id && activeSessionIds.has(c.redeemed_session_id));
        return {
          referenceNumber: p.reference_number, plan: p.plan, amount, currency: 'CAD', state,
          ...(accessActive ? { accessActive: true } : {}),
          submittedAt: p.submitted_at ?? null, approvedAt: p.approved_at ?? null,
          ...(priceOutdated ? { priceOutdated: true } : {}),
          ...(state === 'awaiting_verification' && !priceOutdated ? { instructions: getInstructions(p.reference_number, amount, payTo) } : {}),
        };
      }),
      entitlements: sessions.map((s) => {
        const daysLeft = s.expires_at ? Math.max(0, Math.ceil((Date.parse(s.expires_at) - now) / 86400000)) : null;
        return { tier: s.tier, startedAt: s.issued_at, expiresAt: s.expires_at, daysLeft, renewalDue: daysLeft !== null && daysLeft <= RENEWAL_REMINDER_DAYS };
      }),
    }, { status: 200, headers: HEADERS });
  } catch {
    return Response.json({ error: 'Your payments could not be loaded. Please try again.', code: 'PAYMENT_STATUS_UNAVAILABLE' }, { status: 503, headers: HEADERS });
  }
};
