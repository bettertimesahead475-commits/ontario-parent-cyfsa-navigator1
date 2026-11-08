/**
 * Cloudflare Pages Functions - Request Access & Payment Reference API.
 *
 * POST /api/request-access
 * Creates an e-transfer payment request and human-typeable reference code.
 */
import { verifyFirebaseRequest } from './_auth-check';

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

const TIER_PRICES: Record<string, number> = {
  Basic: 49,
  AnalyzerBasic: 29,
  Premium: 89,
  AnalyzerPremium: 59,
  Pro: 129,
  Community5: 5,
  Community10: 10,
  Community25: 25,
};

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateReferenceNumber(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  let code = '';
  for (let i = 0; i < bytes.length; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return `PS-${code}`;
}

function getInstructions(referenceNumber: string, amount: number, paymentEmail: string): string {
  return `Send an Interac e-transfer for $${amount} CAD to ${paymentEmail}. Put "${referenceNumber}" in the message/memo field so your payment can be matched. Once it's confirmed, you'll receive an access code.`;
}

interface Env {
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
  const amount = TIER_PRICES[tier] || 129;
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

  // Check for existing keyed request (idempotency)
  if (keyed) {
    try {
      const checkUrl = new URL('/rest/v1/payments', env.STAGING_SUPABASE_URL);
      checkUrl.searchParams.set('firebase_uid', `eq.${uid}`);
      checkUrl.searchParams.set('request_key', `eq.${requestKey}`);
      checkUrl.searchParams.set('select', 'reference_number,amount,plan');
      checkUrl.searchParams.set('limit', '1');

      const existingRes = await fetch(checkUrl.toString(), {
        headers: {
          apikey: env.STAGING_SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.STAGING_SUPABASE_SERVICE_ROLE_KEY}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(5000),
      });

      if (existingRes.ok) {
        const rows = (await existingRes.json()) as any[];
        if (Array.isArray(rows) && rows.length > 0) {
          const row = rows[0];
          const existingAmount = typeof row.amount === 'number' ? row.amount : parseFloat(row.amount);
          return Response.json(
            {
              referenceNumber: row.reference_number,
              amount: isNaN(existingAmount) ? amount : existingAmount,
              payTo: paymentEmail,
              instructions: getInstructions(row.reference_number, isNaN(existingAmount) ? amount : existingAmount, paymentEmail),
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

  const referenceNumber = generateReferenceNumber();
  const clientIp = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || null;
  const userAgent = request.headers.get('user-agent') || null;

  let notes = `email:${normalizedEmail};uid:${uid}`;
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
        apikey: env.STAGING_SUPABASE_SERVICE_ROLE_KEY,
        Authorization: `Bearer ${env.STAGING_SUPABASE_SERVICE_ROLE_KEY}`,
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
        checkUrl.searchParams.set('select', 'reference_number,amount,plan');
        checkUrl.searchParams.set('limit', '1');

        const raceRes = await fetch(checkUrl.toString(), {
          headers: {
            apikey: env.STAGING_SUPABASE_SERVICE_ROLE_KEY,
            Authorization: `Bearer ${env.STAGING_SUPABASE_SERVICE_ROLE_KEY}`,
            Accept: 'application/json',
          },
        });
        if (raceRes.ok) {
          const rows = (await raceRes.json()) as any[];
          if (Array.isArray(rows) && rows.length > 0) {
            const row = rows[0];
            const existingAmount = typeof row.amount === 'number' ? row.amount : parseFloat(row.amount);
            return Response.json(
              {
                referenceNumber: row.reference_number,
                amount: isNaN(existingAmount) ? amount : existingAmount,
                payTo: paymentEmail,
                instructions: getInstructions(row.reference_number, isNaN(existingAmount) ? amount : existingAmount, paymentEmail),
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

      // Retry with minimal columns if schema has optional columns omitted
      const fallbackPayload = {
        plan: tier,
        user_role: 'parent',
        amount,
        payment_method: 'interac_etransfer',
        payment_email: paymentEmail,
        reference_number: referenceNumber,
        status: 'pending',
        notes,
      };

      const fallbackRes = await fetch(insertUrl.toString(), {
        method: 'POST',
        headers: {
          apikey: env.STAGING_SUPABASE_SERVICE_ROLE_KEY,
          Authorization: `Bearer ${env.STAGING_SUPABASE_SERVICE_ROLE_KEY}`,
          'Content-Type': 'application/json',
          Prefer: 'return=minimal',
        },
        body: JSON.stringify(fallbackPayload),
        signal: AbortSignal.timeout(5000),
      });

      if (!fallbackRes.ok) {
        return Response.json(
          { error: 'Failed to record payment request.', code: 'PAYMENT_INSERT_FAILED' },
          { status: 500, headers: DEFAULT_HEADERS }
        );
      }
    }

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
