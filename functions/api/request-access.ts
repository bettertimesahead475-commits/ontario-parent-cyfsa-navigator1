/**
 * Cloudflare Pages Functions - Request Access & Payment Reference API.
 *
 * POST /api/request-access
 * Creates an e-transfer payment request and human-typeable reference code.
 */
import { verifyFirebaseRequest } from './_auth-check';
import { normalizeApiKey } from './_supabase-key';
import { RATE_LIMITS, rateLimitRetryAfter, rateLimitSubject, rateLimitedResponse } from './_rate-limit';
import { canQueueEmail, checkoutEmailItem, CHECKOUT_EMAIL_INTENT, enqueueTransactionalEmail } from './_email-outbox';
import type { TransactionalEmailEnv } from './_mailer';
import { TIER_PRICES } from './access-pricing';

const DEFAULT_HEADERS = {
  'Cache-Control': 'no-store',
  'X-Content-Type-Options': 'nosniff',
};

const VALID_TIERS = [
  'Basic',
  'AnalyzerBasic',
  'Premium',
  'AnalyzerPremium',
  'Pro',
  'Community5',
  'Community10',
  'Community25',
] as const;

// Prices come from the authoritative pricing API, the same table the pricing page shows, so the recorded amount
// (which administrators approve against) always matches what the customer was told to send.


const OPEN_ORDER_DAYS = 30;

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// 8 characters from a 32-character alphabet (no modulo bias: 256 % 32 == 0), about 1.1e12 values. The former
// 5 characters (33.5M values) made duplicate references likely at a few thousand payments; there is no unique index.
function generateReferenceNumber(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  let code = '';
  for (let i = 0; i < bytes.length; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return `PS-${code}`;
}

function formatAmount(amount: number): string {
  return Number.isInteger(amount) ? amount.toLocaleString('en-CA') : amount.toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function getInstructions(referenceNumber: string, amount: number, paymentEmail: string): string {
  return `Send an Interac e-transfer for $${formatAmount(amount)} CAD to ${paymentEmail}. Put "${referenceNumber}" in the message/memo field so your payment can be matched. Once it's confirmed, you'll receive an access code.`;
}

interface Env extends TransactionalEmailEnv {
  FIREBASE_PROJECT_ID?: string;
  PAYMENT_EMAIL?: string;
  STAGING_SUPABASE_URL?: string;
  STAGING_SUPABASE_SERVICE_ROLE_KEY?: string;
}

export const onRequestPost = async ({
  request,
  env,
}: {
  request: Request;
  env: Env;
}): Promise<Response> => {
  let body: any;
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const { email, tier, requestKey } = body || {};

  // Validate requestKey if present
  if (requestKey !== undefined && (typeof requestKey !== 'string' || !/^[A-Za-z0-9-]{8,64}$/.test(requestKey))) {
    return Response.json(
      { error: 'requestKey is not valid.', code: 'INVALID_REQUEST_KEY' },
      { status: 400, headers: DEFAULT_HEADERS }
    );
  }

  // Validate tier
  if (!tier || !VALID_TIERS.includes(tier)) {
    return Response.json(
      { error: 'tier must be a valid plan tier ("Basic", "Premium", "Pro", "Community5", "Community10", or "Community25").' },
      { status: 400, headers: DEFAULT_HEADERS }
    );
  }

  // Cryptographically verify identity via Firebase ID token
  const identity = await verifyFirebaseRequest(request, env);
  if (identity.status !== 'verified' || !identity.uid) {
    return Response.json(
      { error: 'Sign in to request access.', code: 'SIGN_IN_REQUIRED' },
      { status: 401, headers: DEFAULT_HEADERS }
    );
  }
  {
    const retryAfter = rateLimitRetryAfter('requestAccess', rateLimitSubject(request, identity.uid), RATE_LIMITS.requestAccess);
    if (retryAfter) return rateLimitedResponse(retryAfter);
  }

  if (!identity.emailVerified || !identity.email) {
    return Response.json(
      { error: 'Verify your email address before requesting access.', code: 'EMAIL_NOT_VERIFIED' },
      { status: 403, headers: DEFAULT_HEADERS }
    );
  }

  if (email !== undefined && String(email).trim().toLowerCase() !== identity.email.toLowerCase()) {
    return Response.json(
      { error: 'The email must match your signed-in account.', code: 'EMAIL_MISMATCH' },
      { status: 400, headers: DEFAULT_HEADERS }
    );
  }

  const paymentEmail = (env.PAYMENT_EMAIL || 'chris@cyfsanavigator.com').trim().toLowerCase();
  const amount = TIER_PRICES[tier];
  const normalizedEmail = identity.email.trim().toLowerCase();

  // If Supabase credentials are not configured, fail-closed
  if (!env.STAGING_SUPABASE_URL || !env.STAGING_SUPABASE_SERVICE_ROLE_KEY) {
    return Response.json(
      { error: 'Payment request storage is not ready. Please try again later.', code: 'PAYMENT_STORAGE_NOT_READY' },
      { status: 503, headers: DEFAULT_HEADERS }
    );
  }

  const uid = identity.uid;
  const keyed = Boolean(requestKey);
  const checkoutColumns = 'reference_number,amount,plan,status,notes,payment_email';
  const recoverInstructions = async (row: Parameters<typeof checkoutEmailItem>[0]) => {
    const intent = checkoutEmailItem(row, normalizedEmail);
    if (intent) await enqueueTransactionalEmail(env, intent);
  };

  // Check for existing keyed request (idempotency)
  if (keyed) {
    try {
      const checkUrl = new URL('/rest/v1/payments', env.STAGING_SUPABASE_URL);
      checkUrl.searchParams.set('firebase_uid', `eq.${uid}`);
      checkUrl.searchParams.set('request_key', `eq.${requestKey}`);
      checkUrl.searchParams.set('select', checkoutColumns);
      checkUrl.searchParams.set('limit', '1');

      const existingRes = await fetch(checkUrl.toString(), {
        headers: {
          apikey: (normalizeApiKey(env.STAGING_SUPABASE_SERVICE_ROLE_KEY) ?? ''),
          Authorization: `Bearer ${(normalizeApiKey(env.STAGING_SUPABASE_SERVICE_ROLE_KEY) ?? '')}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(5000),
      });

      if (existingRes.ok) {
        const rows = (await existingRes.json()) as any[];
        if (Array.isArray(rows) && rows.length > 0) {
          const row = rows[0];
          const existingAmount = typeof row.amount === 'number' ? row.amount : Number.parseFloat(row.amount);
          await recoverInstructions(row);
          return Response.json(
            {
              referenceNumber: row.reference_number,
              amount: Number.isNaN(existingAmount) ? amount : existingAmount,
              payTo: paymentEmail,
              instructions: getInstructions(row.reference_number, Number.isNaN(existingAmount) ? amount : existingAmount, paymentEmail),
              reused: true,
            },
            { status: 200, headers: DEFAULT_HEADERS }
          );
        }
      }
    } catch {
      // Proceed to insert attempt
    }
  }

  // One open order per account and package: a second checkout for the same package returns the pending order instead of
  // creating another reference, so a customer cannot be led to pay twice. Orders recorded at a different price are not reused.
  try {
    const openUrl = new URL('/rest/v1/payments', env.STAGING_SUPABASE_URL);
    openUrl.searchParams.set('firebase_uid', `eq.${uid}`);
    openUrl.searchParams.set('plan', `eq.${tier}`);
    openUrl.searchParams.set('status', 'eq.pending');
    openUrl.searchParams.set('submitted_at', `gte.${new Date(Date.now() - OPEN_ORDER_DAYS * 86400000).toISOString()}`);
    openUrl.searchParams.set('select', checkoutColumns);
    openUrl.searchParams.set('order', 'submitted_at.desc');
    openUrl.searchParams.set('limit', '1');
    const openRes = await fetch(openUrl.toString(), {
      headers: {
        apikey: (normalizeApiKey(env.STAGING_SUPABASE_SERVICE_ROLE_KEY) ?? ''),
        Authorization: `Bearer ${(normalizeApiKey(env.STAGING_SUPABASE_SERVICE_ROLE_KEY) ?? '')}`,
        Accept: 'application/json',
      },
      signal: AbortSignal.timeout(5000),
    });
    if (openRes.ok) {
      const rows = (await openRes.json()) as any[];
      const row = Array.isArray(rows) ? rows[0] : null;
      const openAmount = row ? (typeof row.amount === 'number' ? row.amount : Number.parseFloat(row.amount)) : Number.NaN;
      if (row?.reference_number && Math.abs(openAmount - amount) < 0.005) {
        await recoverInstructions(row);
        return Response.json(
          {
            referenceNumber: row.reference_number,
            amount,
            payTo: paymentEmail,
            instructions: getInstructions(row.reference_number, amount, paymentEmail),
            reused: true,
            openOrder: true,
          },
          { status: 200, headers: DEFAULT_HEADERS }
        );
      }
    }
  } catch {
    // Lookup failure only loses the reuse; a new order is still a valid pending request.
  }

  const referenceNumber = generateReferenceNumber();
  const clientIp = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  const userAgent = request.headers.get('user-agent') || null;

  let notes = `email:${normalizedEmail};uid:${uid}`;
  if (canQueueEmail(env, normalizedEmail)) notes += `;${CHECKOUT_EMAIL_INTENT}`;
  if (requestKey) notes += `;key:${requestKey}`;
  if (clientIp) notes += `;ip:${clientIp}`;
  if (userAgent) notes += `;ua:${encodeURIComponent(userAgent.slice(0, 100))}`;

  const rowPayload: Record<string, unknown> = {
    plan: tier,
    user_role: 'parent',
    amount,
    payment_method: 'interac_etransfer',
    payment_email: paymentEmail,
    reference_number: referenceNumber,
    status: 'pending',
    notes,
    firebase_uid: uid,
  };
  if (requestKey) rowPayload.request_key = requestKey;
  if (clientIp) rowPayload.client_ip = clientIp;
  if (userAgent) rowPayload.user_agent = userAgent;

  try {
    const insertUrl = new URL('/rest/v1/payments', env.STAGING_SUPABASE_URL);
    const insertRes = await fetch(insertUrl.toString(), {
      method: 'POST',
      headers: {
        apikey: (normalizeApiKey(env.STAGING_SUPABASE_SERVICE_ROLE_KEY) ?? ''),
        Authorization: `Bearer ${(normalizeApiKey(env.STAGING_SUPABASE_SERVICE_ROLE_KEY) ?? '')}`,
        'Content-Type': 'application/json',
        Prefer: 'return=minimal',
      },
      body: JSON.stringify(rowPayload),
      signal: AbortSignal.timeout(5000),
    });

    if (!insertRes.ok) {
      // 409 unique constraint race condition for request_key
      if (keyed && insertRes.status === 409) {
        const checkUrl = new URL('/rest/v1/payments', env.STAGING_SUPABASE_URL);
        checkUrl.searchParams.set('firebase_uid', `eq.${uid}`);
        checkUrl.searchParams.set('request_key', `eq.${requestKey}`);
        checkUrl.searchParams.set('select', checkoutColumns);
        checkUrl.searchParams.set('limit', '1');

        const raceRes = await fetch(checkUrl.toString(), {
          headers: {
            apikey: (normalizeApiKey(env.STAGING_SUPABASE_SERVICE_ROLE_KEY) ?? ''),
            Authorization: `Bearer ${(normalizeApiKey(env.STAGING_SUPABASE_SERVICE_ROLE_KEY) ?? '')}`,
            Accept: 'application/json',
          },
          signal: AbortSignal.timeout(5000),
        });
        if (raceRes.ok) {
          const rows = (await raceRes.json()) as any[];
          if (Array.isArray(rows) && rows.length > 0) {
            const row = rows[0];
            const existingAmount = typeof row.amount === 'number' ? row.amount : Number.parseFloat(row.amount);
            await recoverInstructions(row);
            return Response.json(
              {
                referenceNumber: row.reference_number,
                amount: Number.isNaN(existingAmount) ? amount : existingAmount,
                payTo: paymentEmail,
                instructions: getInstructions(row.reference_number, Number.isNaN(existingAmount) ? amount : existingAmount, paymentEmail),
                reused: true,
              },
              { status: 200, headers: DEFAULT_HEADERS }
            );
          }
        }
        return Response.json(
          { error: 'This checkout attempt was already used. Start a new checkout to get a payment reference.', code: 'REQUEST_KEY_USED' },
          { status: 409, headers: DEFAULT_HEADERS }
        );
      }

      return Response.json(
        { error: 'Failed to record payment request.', code: 'PAYMENT_INSERT_FAILED' },
        { status: 500, headers: DEFAULT_HEADERS }
      );
    }

    // Enqueue only (no-op unless TRANSACTIONAL_EMAIL_ENABLED); a failure is logged and never affects the order.
    await enqueueTransactionalEmail(env, {
      kind: 'payment_instructions', dedupeKey: referenceNumber, reference: referenceNumber, email: normalizedEmail,
      data: { plan: tier, amount, payTo: paymentEmail },
    });

    return Response.json(
      {
        referenceNumber,
        amount,
        payTo: paymentEmail,
        instructions: getInstructions(referenceNumber, amount, paymentEmail),
        reused: false,
      },
      { status: 200, headers: DEFAULT_HEADERS }
    );
  } catch (err: any) {
    return Response.json(
      { error: 'We could not create the access request. Please try again.', code: 'INTERNAL_ERROR' },
      { status: 500, headers: DEFAULT_HEADERS }
    );
  }
};
