/**
 * Cloudflare Pages Functions - activate an administrator-approved purchase from the customer's own account.
 *
 * POST /api/claim-purchase  { referenceNumber }
 * Only a payment an administrator approved after verifying the funds (status 'approved', set only by
 * /api/admin/payments/approve) can be activated, and only by the account that created the order (verified Firebase uid
 * and email). The customer's reference or email alone never activates anything. Activation retires unused codes of the
 * order, issues one fresh code and redeems it at once through the same atomic RPC as /api/activate-code.
 */
import { verifyFirebaseRequest } from './_auth-check';
import { RATE_LIMITS, rateLimitRetryAfter, rateLimitSubject, rateLimitedResponse } from './_rate-limit';
import { acquireOnce, appendAudit, rest, safeSegment, type AdminStoreEnv } from './_admin-store';
import { amountOf, codesOf, notesEmail, PAYMENT_REFERENCE, refundedReferences, type CustomerPayment } from './_customer-payments';
import { signSessionToken } from './activate-code';

const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_TTL_DAYS = 14;

interface Env extends AdminStoreEnv { FIREBASE_PROJECT_ID?: string; SESSION_SECRET?: string }

const fail = (status: number, code: string, error: string) => Response.json({ error, code }, { status, headers: HEADERS });

function generateCode(): string {
  const out: string[] = [];
  while (out.length < 12) {
    for (const b of crypto.getRandomValues(new Uint8Array(24))) if (b < 248 && out.length < 12) out.push(CODE_ALPHABET[b % CODE_ALPHABET.length]);
  }
  return out.join('').match(/.{4}/g)!.join('-');
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const onRequestPost = async ({ request, env }: { request: Request; env: Env }): Promise<Response> => {
  const body = await request.json().catch(() => ({})) as { referenceNumber?: unknown };
  const reference = typeof body?.referenceNumber === 'string' ? body.referenceNumber.trim().toUpperCase() : '';
  if (!PAYMENT_REFERENCE.test(reference)) return fail(400, 'INVALID_REFERENCE', 'A payment reference (PS-…) is required.');

  const identity = await verifyFirebaseRequest(request, env);
  if (identity.status !== 'verified' || !identity.uid) return fail(401, 'SIGN_IN_REQUIRED', 'Sign in to activate your purchase.');
  const retryAfter = rateLimitRetryAfter('claimPurchase', rateLimitSubject(request, identity.uid), RATE_LIMITS.claimPurchase);
  if (retryAfter) return rateLimitedResponse(retryAfter);
  const email = identity.emailVerified ? identity.email?.trim().toLowerCase() : '';
  if (!email) return fail(403, 'EMAIL_NOT_VERIFIED', 'Verify your email address before activating a purchase.');
  if (!env.SESSION_SECRET || !env.STAGING_SUPABASE_URL || !env.STAGING_SUPABASE_SERVICE_ROLE_KEY) {
    return fail(503, 'ACTIVATION_NOT_READY', 'Activation is not available right now.');
  }

  try {
    const rows = await rest<CustomerPayment[]>(env, `payments?select=id,reference_number,plan,amount,status,notes,firebase_uid&reference_number=eq.${encodeURIComponent(reference)}&limit=2`);
    const payment = rows.length === 1 ? rows[0] : null;
    // Another account's order, an unknown reference and a duplicated reference all get the same answer.
    if (!payment || payment.firebase_uid !== identity.uid || notesEmail(payment.notes) !== email) {
      return fail(404, 'ORDER_NOT_FOUND', 'No order with that reference belongs to this account.');
    }
    if (payment.status === 'pending') return fail(409, 'PAYMENT_NOT_VERIFIED', 'Your payment has not been verified yet. Access is activated after we confirm the e-Transfer was received.');
    if (payment.status !== 'approved') return fail(409, 'ORDER_CLOSED', 'This order was cancelled or refunded.');
    // Fail closed: an unreadable audit trail must not let a refunded order be activated.
    if ((await refundedReferences(env)).has(safeSegment(reference))) return fail(409, 'ORDER_CLOSED', 'This order was cancelled or refunded.');

    const used = (await codesOf(env, [reference])).some((c) => c.used_at);
    if (used) return fail(409, 'ALREADY_ACTIVATED', 'This purchase is already activated.');
    if (!(await acquireOnce(env, `claim__${reference}__${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`))) {
      return fail(409, 'ACTIVATION_IN_PROGRESS', 'Activation is already in progress. Wait a minute and refresh.');
    }

    const now = new Date();
    await rest(env, `access_codes?reference_number=eq.${encodeURIComponent(reference)}&used_at=is.null`, { method: 'PATCH', body: { expires_at: now.toISOString() }, prefer: 'return=minimal' });
    if ((await codesOf(env, [reference])).some((c) => c.used_at)) return fail(409, 'ALREADY_ACTIVATED', 'This purchase is already activated.');
    const code = generateCode();
    await rest(env, 'access_codes', { method: 'POST', prefer: 'return=minimal', body: {
      email, tier: payment.plan, reference_number: reference, amount: amountOf(payment.amount), code_hash: await sha256Hex(code),
      expires_at: new Date(now.getTime() + CODE_TTL_DAYS * 86400000).toISOString(),
    } });
    const result = await rest<{ status?: string; session_id?: string; tier?: string; expires_at?: string }>(env, 'rpc/redeem_access_code_atomic', {
      method: 'POST', body: { p_firebase_uid: identity.uid, p_code: code, p_email: email },
    });
    if (result?.status !== 'activated' && result?.status !== 'reused') {
      return fail(result?.status === 'denied' ? 400 : 500, 'ACTIVATION_FAILED', 'Activation could not be completed. Contact support with your reference number.');
    }
    const expiresAt = result.expires_at ? Date.parse(result.expires_at) : now.getTime() + 30 * 86400000;
    const token = await signSessionToken(String(result.session_id), expiresAt, env.SESSION_SECRET);
    await appendAudit(env, { action: 'customer-activate', target: safeSegment(reference), admin: `customer:${safeSegment(identity.uid)}`, reason: null, details: { plan: payment.plan } }).catch(() => undefined);
    return Response.json({ success: true, tier: result.tier, token, email, expiresAt: new Date(expiresAt).toISOString(), referenceNumber: reference }, { status: 200, headers: HEADERS });
  } catch {
    return fail(503, 'ACTIVATION_UNAVAILABLE', 'Activation is temporarily unavailable. Please try again.');
  }
};
