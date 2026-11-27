/**
 * Transactional email outbox (table public.transactional_email_outbox, migration pending approval). Payment actions
 * only enqueue; a separate processing run sends. Enqueueing never throws and never blocks a payment action for more
 * than a few seconds. One row per (kind, dedupe_key), so a retried or resumed action cannot queue a second email.
 *
 * Delivery is at most once: a row whose send outcome is unknown (the run stopped mid-send, or Gmail did not answer)
 * becomes 'unknown' for an administrator to check in the Sent folder, never an automatic resend.
 */
import { rest, AdminStoreError, type AdminStoreEnv } from './_admin-store';
import { renderTransactionalEmail, type TemplateData, type TransactionalKind } from './_email-templates';
import {
  MailerError, isValidRecipient, openPayload, recipientAllowed, sealPayload, transactionalEmailEnabled,
  type TransactionalEmailEnv, type TransactionalMailer,
} from './_mailer';

export type OutboxEnv = AdminStoreEnv & TransactionalEmailEnv;
export const OUTBOX_TABLE = 'transactional_email_outbox';
export const MAX_ATTEMPTS = 5;
const STALE_SENDING_MS = 15 * 60 * 1000;
const enc = encodeURIComponent;

export type OutboxRow = {
  id: string; kind: TransactionalKind; dedupe_key: string; payment_reference: string | null; recipient_email: string;
  template_data: TemplateData; secret_payload: string | null; status: string; attempts: number; next_attempt_at: string;
};

export type EnqueueItem = { kind: TransactionalKind; dedupeKey: string; reference?: string | null; email: string; data: TemplateData; accessCode?: string };

/** Backoff after the n-th failed attempt: 5, 10, 20, 40 minutes, capped at 24 hours. */
export const retryDelayMs = (attempts: number) => Math.min(5 * 60 * 1000 * 2 ** Math.max(0, attempts - 1), 24 * 3600 * 1000);

const withTimeout = (fetcher: typeof fetch, ms: number): typeof fetch =>
  ((input: RequestInfo | URL, init?: RequestInit) => fetcher(input, { ...init, signal: AbortSignal.timeout(ms) })) as typeof fetch;

export async function enqueueTransactionalEmail(env: OutboxEnv, item: EnqueueItem, fetcher: typeof fetch = fetch): Promise<boolean> {
  if (!transactionalEmailEnabled(env)) return false;
  try {
    const email = item.email.trim().toLowerCase();
    if (!isValidRecipient(email)) return false;
    let secret: string | null = null;
    if (item.kind === 'access_code') {
      if (!item.accessCode) return false;
      secret = await sealPayload(env, item.accessCode, `${item.kind}:${item.dedupeKey}`);
      if (!secret) return false;
    }
    await rest(env, `${OUTBOX_TABLE}?on_conflict=kind,dedupe_key`, {
      method: 'POST',
      body: {
        kind: item.kind, dedupe_key: item.dedupeKey, payment_reference: item.reference ?? null, recipient_email: email,
        template_data: { ...item.data, reference: item.reference ?? item.data.reference }, secret_payload: secret,
      },
      prefer: 'resolution=ignore-duplicates,return=minimal',
    }, withTimeout(fetcher, 3000));
    return true;
  } catch {
    console.error('[EMAIL_ENQUEUE_FAILED]', JSON.stringify({ kind: item.kind }));
    return false;
  }
}

/** Queues one reminder per entitlement and end date for active paid access ending within 7 days. */
export async function enqueueRenewalReminders(env: OutboxEnv, fetcher: typeof fetch, now: Date): Promise<number> {
  const until = new Date(now.getTime() + 7 * 86400000).toISOString();
  const sessions = await rest<Array<{ id: string; email?: string | null; tier?: string; expires_at?: string }>>(env,
    `navigator_paid_sessions?select=id,email,tier,expires_at&revoked_at=is.null&expires_at=gt.${enc(now.toISOString())}&expires_at=lte.${enc(until)}&limit=200`, {}, fetcher);
  let queued = 0;
  for (const s of sessions) {
    if (!s.email || !s.expires_at) continue;
    if (await enqueueTransactionalEmail(env, { kind: 'renewal_reminder', dedupeKey: `${s.id}:${s.expires_at.slice(0, 10)}`, email: s.email, data: { plan: s.tier, expiresAt: s.expires_at } }, fetcher)) queued++;
  }
  return queued;
}

const patch = (env: OutboxEnv, filter: string, body: Record<string, unknown>, fetcher: typeof fetch) =>
  rest<OutboxRow[]>(env, `${OUTBOX_TABLE}?${filter}`, { method: 'PATCH', body, prefer: 'return=representation' }, fetcher);

const errorText = (error: unknown) => (error instanceof MailerError ? error.code : error instanceof Error ? error.name : 'unknown').slice(0, 200);

export type ProcessResult = { sent: number; retrying: number; failed: number; skipped: number; unknown: number };

export async function processOutbox(env: OutboxEnv, mailer: TransactionalMailer, fetcher: typeof fetch, now: Date, limit = 10): Promise<ProcessResult> {
  const result: ProcessResult = { sent: 0, retrying: 0, failed: 0, skipped: 0, unknown: 0 };
  if (!transactionalEmailEnabled(env)) return result;
  const stamp = now.toISOString();

  // A row left in 'sending' by an interrupted run may or may not have been delivered: never resend it automatically.
  const stale = await patch(env, `status=eq.sending&locked_at=lt.${enc(new Date(now.getTime() - STALE_SENDING_MS).toISOString())}`,
    { status: 'unknown', secret_payload: null, locked_at: null, last_error: 'INTERRUPTED_DURING_SEND' }, fetcher);
  result.unknown += stale.length;

  const due = await rest<OutboxRow[]>(env,
    `${OUTBOX_TABLE}?select=*&status=eq.pending&next_attempt_at=lte.${enc(stamp)}&order=next_attempt_at.asc&limit=${limit}`, {}, fetcher);
  for (const row of due) {
    const attempts = row.attempts + 1;
    // Compare-and-set claim: a concurrent run that claims the same row first wins; this run skips it.
    const claimed = await patch(env, `id=eq.${enc(row.id)}&status=eq.pending&attempts=eq.${row.attempts}`, { status: 'sending', locked_at: stamp, attempts }, fetcher);
    if (!claimed.length) continue;
    const id = `id=eq.${enc(row.id)}&status=eq.sending`;
    if (!recipientAllowed(env, row.recipient_email)) {
      await patch(env, id, { status: 'skipped', secret_payload: null, locked_at: null, last_error: 'RECIPIENT_NOT_ALLOWLISTED' }, fetcher);
      result.skipped++;
      continue;
    }
    let message: { subject: string; text: string };
    try {
      const code = row.kind === 'access_code' && row.secret_payload ? await openPayload(env, row.secret_payload, `${row.kind}:${row.dedupe_key}`) : undefined;
      message = renderTransactionalEmail(row.kind, row.template_data || {}, code ?? undefined);
    } catch {
      await patch(env, id, { status: 'failed', secret_payload: null, locked_at: null, last_error: 'RENDER_FAILED' }, fetcher);
      result.failed++;
      continue;
    }
    try {
      const sent = await mailer.send({ to: row.recipient_email, ...message });
      await patch(env, id, { status: 'sent', sent_at: new Date().toISOString(), provider_message_id: sent.id || null, secret_payload: null, locked_at: null, last_error: null }, fetcher);
      result.sent++;
    } catch (error) {
      if (error instanceof AdminStoreError) throw error;
      const retryable = error instanceof MailerError && error.retryable;
      if (!retryable && error instanceof MailerError && error.code === 'GMAIL_NO_RESPONSE') {
        await patch(env, id, { status: 'unknown', secret_payload: null, locked_at: null, last_error: errorText(error) }, fetcher);
        result.unknown++;
      } else if (retryable && attempts < MAX_ATTEMPTS) {
        await patch(env, id, { status: 'pending', locked_at: null, last_error: errorText(error), next_attempt_at: new Date(now.getTime() + retryDelayMs(attempts)).toISOString() }, fetcher);
        result.retrying++;
      } else {
        await patch(env, id, { status: 'failed', secret_payload: null, locked_at: null, last_error: errorText(error) }, fetcher);
        result.failed++;
      }
    }
  }
  return result;
}

/** Counts per status and the latest rows, with recipient addresses masked, for the administrator console. */
export async function outboxSummary(env: OutboxEnv, fetcher: typeof fetch) {
  const rows = await rest<Array<Pick<OutboxRow, 'kind' | 'payment_reference' | 'recipient_email' | 'status' | 'attempts'> & { last_error: string | null; created_at: string; sent_at: string | null }>>(env,
    `${OUTBOX_TABLE}?select=kind,payment_reference,recipient_email,status,attempts,last_error,created_at,sent_at&order=created_at.desc&limit=50`, {}, fetcher);
  const counts: Record<string, number> = {};
  for (const r of rows) counts[r.status] = (counts[r.status] || 0) + 1;
  const mask = (email: string) => { const at = email.indexOf('@'); return at > 0 ? `${email[0]}***${email.slice(at)}` : '***'; };
  return { enabled: transactionalEmailEnabled(env), counts, latest: rows.map((r) => ({ ...r, recipient_email: mask(r.recipient_email) })) };
}
