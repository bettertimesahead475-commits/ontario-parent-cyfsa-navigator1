import { AdminStoreError, listAllAuditNames, rest, restPage, safeSegment, settlementByReference, type AdminStoreEnv, type AuditEvent } from './_admin-store';

const SETTLEMENT_READ_LIMIT = 20_000;
type Settlement = { status: string; at: string };
type Event = 'refund' | 'refund-applied' | 'confirm-bank' | 'dispute' | 'reset-settlement';
type AppendResult = 'appended' | 'unchanged' | 'not_found' | 'already_recorded' | 'already_applied' | 'missing_refund' | 'refunded';

export const paymentLedgerEnabled = (env: AdminStoreEnv) => env.PAYMENT_ACCOUNTING_LEDGER_ENABLED === 'true';
export const isPaymentAccountingEvent = (action: string) =>
  ['refund', 'refund-applied', 'confirm-bank', 'dispute', 'reset-settlement'].includes(action);

export async function paymentAccountingStates(env: AdminStoreEnv, fetcher: typeof fetch, reference?: string) {
  if (!paymentLedgerEnabled(env)) return settlementByReference(await listAllAuditNames(env, SETTLEMENT_READ_LIMIT, fetcher));
  const rows = await rest<(Settlement & { reference_number: string })[]>(env, 'rpc/read_payment_accounting_state',
    { method: 'POST', body: { p_reference: reference ?? null } }, fetcher);
  return new Map(rows.map(({ reference_number, status, at }) => [safeSegment(reference_number), { status, at }]));
}

export function appendPaymentAccountingEvent(
  env: AdminStoreEnv, payment: unknown, event: Event, key: string, actor: string, reason: string | null,
  details: Record<string, unknown>, fetcher: typeof fetch,
) {
  if (typeof payment !== 'string') throw new AdminStoreError('PAYMENT_LEDGER_UNAVAILABLE', 503, 'The payment has no ledger identifier.');
  return rest<AppendResult>(env, 'rpc/append_payment_accounting_event', {
    method: 'POST', body: { p_payment: payment, p_event: event, p_key: key, p_actor: actor, p_reason: reason, p_details: details },
  }, fetcher);
}

export async function ledgerRefundBlocksRestore(env: AdminStoreEnv, sessionId: string, since: string, fetcher: typeof fetch) {
  const date = encodeURIComponent(since);
  const details = encodeURIComponent(JSON.stringify({ revokedSessionIds: [sessionId] }));
  const [applied, incomplete] = await Promise.all([
    rest<unknown[]>(env, `payment_accounting_events?select=id&event=eq.refund-applied&occurred_at=gte.${date}&details=cs.${details}&limit=1`, {}, fetcher),
    rest<unknown[]>(env, 'payment_accounting_state?select=payment_id&refund_incomplete=is.true&limit=1', {}, fetcher),
  ]);
  return applied.length > 0 || incomplete.length > 0;
}

export async function paymentAccountingAudit(env: AdminStoreEnv, fetcher: typeof fetch, limit: number, paymentIds?: string[]) {
  if (paymentIds?.length === 0) return { events: [], total: 0 };
  const filter = paymentIds ? `&payment_id=in.(${paymentIds.map(encodeURIComponent).join(',')})` : '';
  const { rows, total } = await restPage<{
    occurred_at: string; event: Event; actor: string; reason: string | null; details: AuditEvent['details'];
    payments: { reference_number: string };
  }>(env, `payment_accounting_events?select=occurred_at,event,actor,reason,details,payments!inner(reference_number)&order=occurred_at.desc,id.desc&limit=${limit}${filter}`, fetcher);
  return {
    total: total ?? rows.length,
    events: rows.map((r): AuditEvent => ({
      at: new Date(r.occurred_at).toISOString(), action: r.event, target: safeSegment(r.payments.reference_number),
      admin: r.actor, reason: r.reason, details: r.details,
    })),
  };
}
