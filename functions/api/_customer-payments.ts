/**
 * Shared reads for the customer payment endpoints (/api/my-payments, /api/claim-purchase).
 * Every read is scoped to the verified Firebase uid of the caller; nothing here can change a payment's status.
 */
import { AdminStoreError, rest, safeSegment, type AdminStoreEnv } from './_admin-store';
import { paymentAccountingStates } from './_payment-accounting';

export type CustomerPayment = {
  id?: string; reference_number: string; plan: string; amount: number | string; status: string;
  submitted_at?: string | null; approved_at?: string | null; notes?: string | null; firebase_uid?: string | null;
};
export type CustomerCode = { id?: string; reference_number: string | null; used_at: string | null; expires_at: string | null; redeemed_session_id?: string | null };

export const PAYMENT_REFERENCE = /^PS-[A-Z0-9]{4,12}$/;

export function amountOf(value: unknown): number {
  const n = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''));
  return Number.isFinite(n) ? n : 0;
}

export function notesEmail(notes: unknown): string | null {
  return /^email:([^;]+)/.exec(typeof notes === 'string' ? notes : '')?.[1]?.trim().toLowerCase() || null;
}

/** Payments of this account only (verified uid), newest first. */
export async function paymentsOf(env: AdminStoreEnv, uid: string, fetcher: typeof fetch = fetch): Promise<CustomerPayment[]> {
  return rest<CustomerPayment[]>(env, `payments?select=id,reference_number,plan,amount,status,submitted_at,approved_at,notes,firebase_uid&firebase_uid=eq.${encodeURIComponent(uid)}&order=submitted_at.desc&limit=20`, {}, fetcher);
}

export async function codesOf(env: AdminStoreEnv, references: string[], fetcher: typeof fetch = fetch, columns = 'id,reference_number,used_at,expires_at,redeemed_session_id'): Promise<CustomerCode[]> {
  const safe = references.filter((r) => PAYMENT_REFERENCE.test(r));
  if (!safe.length) return [];
  return rest<CustomerCode[]>(env, `access_codes?select=${columns}&reference_number=in.(${safe.join(',')})&limit=200`, {}, fetcher);
}

/**
 * Like codesOf, but on a database without access_codes.redeemed_session_id (before 20261110004740) it returns the codes
 * without their entitlement link and `linked: false`, so a caller can omit what it cannot know instead of failing.
 */
export async function codesWithLinks(env: AdminStoreEnv, references: string[], fetcher: typeof fetch = fetch): Promise<{ codes: CustomerCode[]; linked: boolean }> {
  try {
    return { codes: await codesOf(env, references, fetcher), linked: true };
  } catch (error) {
    if (!(error instanceof AdminStoreError) || error.pgCode !== '42703') throw error;
    return { codes: await codesOf(env, references, fetcher, 'id,reference_number,used_at,expires_at'), linked: false };
  }
}

/** References with a recorded refund. Throws if the configured accounting source cannot be read. */
export async function refundedReferences(env: AdminStoreEnv, fetcher: typeof fetch = fetch): Promise<Set<string>> {
  const settlements = await paymentAccountingStates(env, fetcher);
  return new Set([...settlements].filter(([, v]) => v.status === 'refunded').map(([k]) => k));
}

export type CustomerPaymentState = 'awaiting_verification' | 'ready_to_activate' | 'activated' | 'refunded' | 'cancelled';

export function paymentState(p: CustomerPayment, codes: CustomerCode[], refunded: Set<string> | null): CustomerPaymentState | 'unknown' {
  if (p.status === 'pending') return 'awaiting_verification';
  // Only a pending (unpaid) order is ever moved to 'rejected', so it was cancelled, not refunded.
  if (p.status === 'rejected') return 'cancelled';
  if (p.status !== 'approved') return 'unknown';
  if (refunded === null) return 'unknown';
  if (refunded.has(safeSegment(p.reference_number))) return 'refunded';
  return codes.some((c) => c.reference_number === p.reference_number && c.used_at) ? 'activated' : 'ready_to_activate';
}
