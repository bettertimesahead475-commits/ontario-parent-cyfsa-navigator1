/**
 * Shared reads for the customer payment endpoints (/api/my-payments, /api/claim-purchase).
 * Every read is scoped to the verified Firebase uid of the caller; nothing here can change a payment's status.
 */
import { listAllAuditNames, rest, safeSegment, settlementByReference, type AdminStoreEnv } from './_admin-store';

export type CustomerPayment = {
  id?: string; reference_number: string; plan: string; amount: number | string; status: string;
  submitted_at?: string | null; approved_at?: string | null; notes?: string | null; firebase_uid?: string | null;
};
export type CustomerCode = { id?: string; reference_number: string | null; used_at: string | null; expires_at: string | null };

export const PAYMENT_REFERENCE = /^PS-[A-Z0-9]{4,12}$/;
const SETTLEMENT_READ_LIMIT = 20_000;

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

export async function codesOf(env: AdminStoreEnv, references: string[], fetcher: typeof fetch = fetch): Promise<CustomerCode[]> {
  const safe = references.filter((r) => PAYMENT_REFERENCE.test(r));
  if (!safe.length) return [];
  return rest<CustomerCode[]>(env, `access_codes?select=id,reference_number,used_at,expires_at&reference_number=in.(${safe.join(',')})&limit=200`, {}, fetcher);
}

/** References whose latest settlement is a recorded refund. Throws when the audit trail cannot be read completely. */
export async function refundedReferences(env: AdminStoreEnv, fetcher: typeof fetch = fetch): Promise<Set<string>> {
  const settlements = settlementByReference(await listAllAuditNames(env, SETTLEMENT_READ_LIMIT, fetcher));
  return new Set([...settlements].filter(([, v]) => v.status === 'refunded').map(([k]) => k));
}

export type CustomerPaymentState = 'awaiting_verification' | 'ready_to_activate' | 'activated' | 'refunded' | 'cancelled';

export function paymentState(p: CustomerPayment, codes: CustomerCode[], refunded: Set<string> | null): CustomerPaymentState | 'unknown' {
  if (p.status === 'pending') return 'awaiting_verification';
  if (p.status === 'rejected') return refunded?.has(safeSegment(p.reference_number)) ? 'refunded' : 'cancelled';
  if (p.status !== 'approved') return 'unknown';
  if (refunded === null) return 'unknown';
  if (refunded.has(safeSegment(p.reference_number))) return 'refunded';
  return codes.some((c) => c.reference_number === p.reference_number && c.used_at) ? 'activated' : 'ready_to_activate';
}
