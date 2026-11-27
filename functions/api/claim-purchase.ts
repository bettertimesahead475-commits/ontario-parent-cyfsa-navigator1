/**
 * Cloudflare Pages Functions - activate an administrator-approved purchase from the customer's own account.
 *
 * POST /api/claim-purchase  { referenceNumber }
 * Only a payment an administrator approved after verifying the funds (status 'approved', set only by
 * /api/admin/payments/approve) can be activated, and only by the account that created the order (verified Firebase uid
 * and email). The customer's reference or email alone never activates anything. Activation retires unused codes of the
 * order, creates the order's one deterministic code and redeems it through the same atomic RPC as /api/activate-code;
 * an interrupted activation is finished by retrying.
 */
import { verifyFirebaseRequest } from './_auth-check';
import { RATE_LIMITS, rateLimitRetryAfter, rateLimitSubject, rateLimitedResponse } from './_rate-limit';
import { acquireOnce, appendAudit, rest, safeSegment, type AdminStoreEnv } from './_admin-store';
import { amountOf, codesOf, notesEmail, PAYMENT_REFERENCE, refundedReferences, type CustomerPayment } from './_customer-payments';
import { signSessionToken } from './activate-code';

const HEADERS = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_TTL_DAYS = 14;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Env extends AdminStoreEnv { FIREBASE_PROJECT_ID?: string; SESSION_SECRET?: string }

const fail = (status: number, code: string, error: string) => Response.json({ error, code }, { status, headers: HEADERS });

function generateCode(): string {
  const out: string[] = [];
  while (out.length < 12) {
    for (const b of crypto.getRandomValues(new Uint8Array(24))) if (b < 248 && out.length < 12) out.push(CODE_ALPHABET[b % CODE_ALPHABET.length]);
  }
  return out.join('').match(/.{4}/g)!.join('-');
}

/** The order's activation code, derived from the reference with the server secret; never shown to anyone. */
async function orderCode(reference: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(`claim-purchase:${reference}`)));
  return [...mac.slice(0, 12)].map((b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('').match(/.{4}/g)!.join('-');
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

    const restore = async () => {
      // Already redeemed: return this account's still-active entitlement (another browser), never a new one.
      const sessionId = (await codesOf(env, [reference])).find((c) => c.used_at && c.redeemed_session_id && UUID.test(c.redeemed_session_id))?.redeemed_session_id;
      const session = sessionId ? (await rest<Array<{ id: string; tier: string; expires_at: string }>>(env,
        `navigator_paid_sessions?select=id,tier,expires_at&id=eq.${sessionId}&firebase_uid=eq.${encodeURIComponent(identity.uid!)}&revoked_at=is.null&expires_at=gt.${encodeURIComponent(new Date().toISOString())}&limit=1`))[0] : undefined;
      if (!session) return fail(409, 'ALREADY_ACTIVATED', 'This purchase was already activated and its access is no longer active.');
      const expiresAt = Date.parse(session.expires_at);
      const token = await signSessionToken(session.id, expiresAt, env.SESSION_SECRET!);
      return Response.json({ success: true, restored: true, tier: session.tier, token, email, expiresAt: new Date(expiresAt).toISOString(), referenceNumber: reference }, { status: 200, headers: HEADERS });
    };
    if ((await codesOf(env, [reference])).some((c) => c.used_at)) return await restore();
    const inProgress = () => fail(409, 'ACTIVATION_IN_PROGRESS', 'Activation for this order is already in progress. Refresh in a minute.');
    // Shares the administrator reissue lock, so a reissue in the same minute cannot issue a second code.
    if (!(await acquireOnce(env, `reissue__${reference}__${new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '')}`))) return inProgress();

    const now = new Date();
    // One deterministic code per order: a retry after an interrupted activation finds and redeems the same code, and the
    // atomic RPC answers a repeat redemption by the same account with the existing entitlement ('reused').
    const code = await orderCode(reference, env.SESSION_SECRET!);
    const codeHash = await sha256Hex(code);
    const ref = encodeURIComponent(reference);
    const expire = (filter: string) => rest(env, `access_codes?reference_number=eq.${ref}&used_at=is.null&${filter}`, { method: 'PATCH', body: { expires_at: new Date().toISOString() }, prefer: 'return=minimal' });
    const expireOthers = () => expire(`code_hash=neq.${codeHash}`);
    const expireOwn = () => expire(`code_hash=eq.${codeHash}`);
    const own = (await rest<Array<{ used_at: string | null; expires_at: string | null }>>(env, `access_codes?select=used_at,expires_at&reference_number=eq.${ref}&code_hash=eq.${codeHash}&limit=1`))[0];
    if (own?.used_at) return await restore();
    if (own && own.expires_at && !(Date.parse(own.expires_at) > now.getTime())) {
      return fail(409, 'CODE_REISSUED', 'A new access code was issued for this order. Use the code we sent you, or contact support with your reference number.');
    }
    if (!own) {
      // Only one request may create the order's code (no time window, so two isolates cannot both insert it).
      if (!(await acquireOnce(env, `claim__${reference}`))) return inProgress();
      await expireOthers();
      if ((await codesOf(env, [reference])).some((c) => c.used_at)) return await restore();
      await rest(env, 'access_codes', { method: 'POST', prefer: 'return=minimal', body: {
        email, tier: payment.plan, reference_number: reference, amount: amountOf(payment.amount), code_hash: codeHash,
        expires_at: new Date(now.getTime() + CODE_TTL_DAYS * 86400000).toISOString(),
      } });
    }
    // A refund writes its audit record before it expires unused codes, so checking after the code exists closes the
    // race: a refund recorded later expires this code before redemption, or revokes the entitlement after it.
    // Unreadable refund history fails closed but keeps the code, so a retry can finish once it is readable.
    if ((await refundedReferences(env)).has(safeSegment(reference))) { await expireOwn(); return fail(409, 'ORDER_CLOSED', 'This order was cancelled or refunded.'); }
    const result = await rest<{ status?: string; session_id?: string; tier?: string; expires_at?: string }>(env, 'rpc/redeem_access_code_atomic', {
      method: 'POST', body: { p_firebase_uid: identity.uid, p_code: code, p_email: email },
    });
    if (result?.status !== 'activated' && result?.status !== 'reused') {
      // Redeemed by a concurrent request of this account (or blocked by the one-redemption-per-order constraint).
      if ((await codesOf(env, [reference])).some((c) => c.used_at)) return await restore();
      if (result?.status === 'denied') return fail(400, 'ACTIVATION_FAILED', 'Activation could not be completed. Contact support with your reference number.');
      return fail(503, 'ACTIVATION_UNAVAILABLE', 'Activation is temporarily unavailable. Please try again.');
    }
    // A code reissued concurrently (across a lock-minute boundary) must not stay usable for a second entitlement.
    await expireOthers().catch(() => undefined);
    const expiresAt = result.expires_at ? Date.parse(result.expires_at) : now.getTime() + 30 * 86400000;
    const token = await signSessionToken(String(result.session_id), expiresAt, env.SESSION_SECRET!);
    await appendAudit(env, { action: 'customer-activate', target: safeSegment(reference), admin: `customer:${safeSegment(identity.uid)}`, reason: null, details: { plan: payment.plan } }).catch(() => undefined);
    return Response.json({ success: true, tier: result.tier, token, email, expiresAt: new Date(expiresAt).toISOString(), referenceNumber: reference }, { status: 200, headers: HEADERS });
  } catch {
    return fail(503, 'ACTIVATION_UNAVAILABLE', 'Activation is temporarily unavailable. Please try again.');
  }
};
