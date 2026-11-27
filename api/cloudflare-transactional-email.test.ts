import { describe, expect, it, vi } from 'vitest';
import { TRANSACTIONAL_KINDS, renderTransactionalEmail } from '../functions/api/_email-templates';
import { MailerError, buildRawMessage, gmailMailer, openPayload, recipientAllowed, sealPayload, type TransactionalMailer } from '../functions/api/_mailer';
import { MAX_ATTEMPTS, enqueueRenewalReminders, enqueueTransactionalEmail, outboxSummary, processOutbox, retryDelayMs } from '../functions/api/_email-outbox';
import { onRequestPost as requestAccess } from '../functions/api/request-access';
import * as authCheck from '../functions/api/_auth-check';

type Row = Record<string, any>;
const KEY = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));
const BASE = { STAGING_SUPABASE_URL: 'https://db.example.supabase.co', STAGING_SUPABASE_SERVICE_ROLE_KEY: 'eyJ' + 'a'.repeat(140) };
const ON = { ...BASE, TRANSACTIONAL_EMAIL_ENABLED: 'true', TRANSACTIONAL_EMAIL_PAYLOAD_KEY: KEY };
const NOW = new Date('2026-11-25T12:00:00Z');

/** In-memory PostgREST for the outbox and paid sessions: eq/lt/lte/gt/is.null filters, upsert ignore-duplicates. */
function fakeDb(seed: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {
    transactional_email_outbox: [], navigator_paid_sessions: [], access_codes: [],
    payments: [{ reference_number: 'PS-1', status: 'approved' }], ...JSON.parse(JSON.stringify(seed)),
  };
  const test = (row: Row, col: string, expr: string) => {
    const [op, ...rest] = expr.split('.'); const v = rest.join('.');
    if (op === 'eq') return String(row[col]) === v;
    if (op === 'lt') return String(row[col]) < v;
    if (op === 'lte') return String(row[col]) <= v;
    if (op === 'gt') return String(row[col]) > v;
    if (expr === 'is.null') return row[col] == null;
    throw new Error('unsupported ' + expr);
  };
  const fetcher = vi.fn(async (input: any, init: any = {}) => {
    const url = new URL(String(input));
    const table = url.pathname.replace('/rest/v1/', '');
    const rows = tables[table];
    if (!rows) return Response.json({ code: '42P01' }, { status: 404 });
    const filters: Array<[string, string]> = [];
    url.searchParams.forEach((v, k) => { if (!['select', 'order', 'limit', 'on_conflict'].includes(k)) filters.push([k, v]); });
    const match = (r: Row) => filters.every(([c, e]) => test(r, c, e));
    const method = (init.method || 'GET').toUpperCase();
    const body = init.body ? JSON.parse(init.body) : undefined;
    if (method === 'GET') return Response.json(rows.filter(match).slice(0, Number(url.searchParams.get('limit') || 1000)));
    if (method === 'PATCH') { const hit = rows.filter(match); hit.forEach((r) => Object.assign(r, body)); return Response.json(hit); }
    if (method === 'POST') {
      if (rows.some((r) => r.kind === body.kind && r.dedupe_key === body.dedupe_key)) return new Response(null, { status: 201 });
      rows.push({ id: crypto.randomUUID(), status: 'pending', attempts: 0, next_attempt_at: NOW.toISOString(), created_at: NOW.toISOString(), ...body });
      return new Response(null, { status: 201 });
    }
    throw new Error('unexpected');
  });
  return { tables, fetcher: fetcher as unknown as typeof fetch, mock: fetcher };
}

const hex = async (text: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const liveCode = async (code: string, extra: Row = {}) => ({ id: 'c1', reference_number: 'PS-1', code_hash: await hex(code), used_at: null, expires_at: '2026-12-09T00:00:00.000Z', ...extra });

const fakeMailer = (impl?: (m: any) => Promise<{ id: string }>) => {
  const sent: any[] = [];
  const mailer: TransactionalMailer = { send: vi.fn(async (m) => { sent.push(m); return impl ? impl(m) : { id: `gm-${sent.length}` }; }) };
  return { mailer, sent };
};

describe('transactional email templates', () => {
  it('covers exactly the six transactional kinds and contains no marketing content', () => {
    expect([...TRANSACTIONAL_KINDS].sort()).toEqual(['access_code', 'payment_confirmation', 'payment_instructions', 'purchase_receipt', 'refund_confirmation', 'renewal_reminder']);
    for (const kind of TRANSACTIONAL_KINDS) {
      const { subject, text } = renderTransactionalEmail(kind, { reference: 'PS-TEST0001', plan: 'Premium', amount: 49.99, payTo: 'pay@example.test', approvedAt: NOW.toISOString(), expiresAt: '2026-12-09T00:00:00Z' }, 'ABCD-EFGH-JKMN');
      expect(subject).not.toMatch(/[\r\n]/);
      expect(text).toContain('not legal advice');
      expect(`${subject}\n${text}`).not.toMatch(/discount|offer|sale|newsletter|limited time|unsubscribe here|testimonial/i);
      expect(text.match(/https?:\/\/[^\s]+/g)!.every((u) => u.startsWith('https://cyfsanavigator.com'))).toBe(true);
    }
  });

  it('shows real values or "Not recorded", never invented ones', () => {
    const { text } = renderTransactionalEmail('purchase_receipt', { reference: 'PS-TEST0001' });
    expect(text).toContain('Package: Not recorded');
    expect(text).toContain('Amount paid: Not recorded');
    expect(renderTransactionalEmail('payment_instructions', { reference: 'PS-X', plan: 'Basic', amount: 19.99, payTo: 'p@example.test' }).text).toContain('$19.99 CAD');
  });

  it('the access-code email needs the code', () => {
    expect(() => renderTransactionalEmail('access_code', { reference: 'PS-X' })).toThrow();
    expect(renderTransactionalEmail('access_code', { reference: 'PS-X' }, 'ABCD-EFGH-JKMN').text).toContain('ABCD-EFGH-JKMN');
  });
});

describe('Gmail API mailer', () => {
  const gmailEnv = { GMAIL_SENDER_ADDRESS: 'sender@example.test', GMAIL_OAUTH_CLIENT_ID: 'cid', GMAIL_OAUTH_CLIENT_SECRET: 'csecret', GMAIL_OAUTH_REFRESH_TOKEN: 'rtoken', TRANSACTIONAL_EMAIL_REPLY_TO: 'reply@example.test' };

  it('exchanges the refresh token and sends a plain-text RFC 2822 message through users.messages.send', async () => {
    const calls: any[] = [];
    const fetcher = vi.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), init });
      return String(url).includes('oauth2') ? Response.json({ access_token: 'at-1' }) : Response.json({ id: 'msg-1' });
    });
    const result = await gmailMailer(gmailEnv, fetcher as any).send({ to: 'parent@example.test', subject: 'Receipt for order PS-X', text: 'Bonjour é' });
    expect(result.id).toBe('msg-1');
    expect(calls[0].url).toBe('https://oauth2.googleapis.com/token');
    expect(String(calls[0].init.body)).toContain('grant_type=refresh_token');
    expect(calls[1].url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send');
    expect(calls[1].init.headers.Authorization).toBe('Bearer at-1');
    const raw = JSON.parse(calls[1].init.body).raw.replaceAll('-', '+').replaceAll('_', '/');
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(raw + '='.repeat((4 - raw.length % 4) % 4)), (c) => c.charCodeAt(0)));
    expect(decoded).toContain('From: CYFSA Navigator <sender@example.test>\r\nTo: parent@example.test\r\nReply-To: reply@example.test');
    expect(decoded).toContain('Content-Type: text/plain; charset=UTF-8');
  });

  it('refuses header injection and unconfigured sending; classifies retryable errors', async () => {
    expect(() => buildRawMessage('s@example.test', { to: 'a@example.test\r\nBcc: x@example.test', subject: 's', text: 't' })).toThrow(MailerError);
    expect(() => buildRawMessage('s@example.test', { to: 'a@example.test', subject: 's\r\nBcc: x@example.test', text: 't' })).toThrow(MailerError);
    await expect(gmailMailer({}, vi.fn() as any).send({ to: 'a@example.test', subject: 's', text: 't' })).rejects.toMatchObject({ code: 'MAILER_NOT_CONFIGURED', retryable: false });
    const busy = vi.fn(async (url: any) => (String(url).includes('oauth2') ? Response.json({ access_token: 'x' }) : new Response('', { status: 503 })));
    await expect(gmailMailer(gmailEnv, busy as any).send({ to: 'a@example.test', subject: 's', text: 't' })).rejects.toMatchObject({ code: 'GMAIL_503', retryable: true });
    const revoked = vi.fn(async () => new Response('', { status: 400 }));
    await expect(gmailMailer(gmailEnv, revoked as any).send({ to: 'a@example.test', subject: 's', text: 't' })).rejects.toMatchObject({ code: 'OAUTH_400', retryable: false });
  });

  it('allowlist limits recipients to synthetic test addresses', () => {
    const env = { TRANSACTIONAL_EMAIL_ALLOWLIST: '@example.test, owner@cyfsanavigator.com' };
    expect(recipientAllowed(env, 'Parent@Example.test')).toBe(true);
    expect(recipientAllowed(env, 'owner@cyfsanavigator.com')).toBe(true);
    expect(recipientAllowed(env, 'real.customer@gmail.com')).toBe(false);
    expect(recipientAllowed({}, 'anyone@example.test')).toBe(true);
  });

  it('seals access codes with AES-GCM bound to the outbox row', async () => {
    const sealed = (await sealPayload({ TRANSACTIONAL_EMAIL_PAYLOAD_KEY: KEY }, 'ABCD-EFGH-JKMN', 'access_code:PS-1'))!;
    expect(sealed).not.toContain('ABCD');
    expect(await openPayload({ TRANSACTIONAL_EMAIL_PAYLOAD_KEY: KEY }, sealed, 'access_code:PS-1')).toBe('ABCD-EFGH-JKMN');
    expect(await openPayload({ TRANSACTIONAL_EMAIL_PAYLOAD_KEY: KEY }, sealed, 'access_code:PS-2')).toBeNull();
    expect(await sealPayload({}, 'x', 'c')).toBeNull();
  });
});

describe('outbox enqueue', () => {
  it('does nothing while email is off', async () => {
    const db = fakeDb();
    expect(await enqueueTransactionalEmail(BASE, { kind: 'payment_instructions', dedupeKey: 'PS-1', reference: 'PS-1', email: 'p@example.test', data: {} }, db.fetcher)).toBe(false);
    expect(db.mock).not.toHaveBeenCalled();
  });

  it('queues one row per kind and order, whatever the number of retries', async () => {
    const db = fakeDb();
    const item = { kind: 'payment_instructions' as const, dedupeKey: 'PS-1', reference: 'PS-1', email: 'P@Example.test', data: { plan: 'Basic', amount: 19.99 } };
    expect(await enqueueTransactionalEmail(ON, item, db.fetcher)).toBe(true);
    expect(await enqueueTransactionalEmail(ON, item, db.fetcher)).toBe(true);
    expect(db.tables.transactional_email_outbox).toHaveLength(1);
    expect(db.tables.transactional_email_outbox[0]).toMatchObject({ recipient_email: 'p@example.test', payment_reference: 'PS-1', secret_payload: null });
    const [url, init] = db.mock.mock.calls[0] as any;
    expect(String(url)).toContain('on_conflict=kind,dedupe_key');
    expect(init.headers.Prefer).toContain('resolution=ignore-duplicates');
  });

  it('never throws: a database failure or a missing key only returns false', async () => {
    const down = vi.fn(async () => { throw new Error('network'); });
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(await enqueueTransactionalEmail(ON, { kind: 'refund_confirmation', dedupeKey: 'PS-1', email: 'p@example.test', data: {} }, down as any)).toBe(false);
    expect(errors.mock.calls.flat().join(' ')).not.toContain('p@example.test');
    errors.mockRestore();
    const db = fakeDb();
    expect(await enqueueTransactionalEmail({ ...ON, TRANSACTIONAL_EMAIL_PAYLOAD_KEY: '' }, { kind: 'access_code', dedupeKey: 'PS-1', email: 'p@example.test', data: {}, accessCode: 'ABCD-EFGH-JKMN' }, db.fetcher)).toBe(false);
    expect(db.tables.transactional_email_outbox).toHaveLength(0);
  });

  it('queues one renewal reminder per entitlement and end date, only within 7 days', async () => {
    const db = fakeDb({ navigator_paid_sessions: [
      { id: 's1', email: 'a@example.test', tier: 'Pro', expires_at: '2026-11-30T00:00:00.000Z', revoked_at: null },
      { id: 's2', email: 'b@example.test', tier: 'Pro', expires_at: '2026-12-20T00:00:00.000Z', revoked_at: null },
      { id: 's3', email: 'c@example.test', tier: 'Pro', expires_at: '2026-11-28T00:00:00.000Z', revoked_at: '2026-11-20T00:00:00Z' },
    ] });
    expect(await enqueueRenewalReminders(ON, db.fetcher, NOW)).toBe(1);
    await enqueueRenewalReminders(ON, db.fetcher, NOW);
    expect(db.tables.transactional_email_outbox).toMatchObject([{ kind: 'renewal_reminder', dedupe_key: 's1:2026-11-30', recipient_email: 'a@example.test' }]);
  });
});

describe('outbox processing', () => {
  const queue = async (db: ReturnType<typeof fakeDb>, extra: Partial<Parameters<typeof enqueueTransactionalEmail>[1]> = {}) =>
    enqueueTransactionalEmail(ON, { kind: 'purchase_receipt', dedupeKey: 'PS-1', reference: 'PS-1', email: 'p@example.test', data: { plan: 'Basic', amount: 19.99 }, ...extra } as any, db.fetcher);

  it('sends a due row once and records the provider id; the access code is decrypted only to send and then removed', async () => {
    const db = fakeDb({ access_codes: [await liveCode('ABCD-EFGH-JKMN')] });
    await queue(db);
    await queue(db, { kind: 'access_code', accessCode: 'ABCD-EFGH-JKMN' });
    const { mailer, sent } = fakeMailer();
    expect(await processOutbox(ON, mailer, db.fetcher, NOW)).toMatchObject({ sent: 2 });
    expect(sent.find((m) => m.subject.startsWith('Your access code')).text).toContain('ABCD-EFGH-JKMN');
    expect(db.tables.transactional_email_outbox.every((r) => r.status === 'sent' && r.secret_payload === null && r.provider_message_id)).toBe(true);
    expect(await processOutbox(ON, mailer, db.fetcher, NOW)).toMatchObject({ sent: 0 });
    expect(sent).toHaveLength(2);
  });

  it('retries temporary failures with backoff, then marks the row failed', async () => {
    const db = fakeDb();
    await queue(db);
    const { mailer } = fakeMailer(async () => { throw new MailerError('GMAIL_503', true); });
    let now = NOW;
    for (let attempt = 1; attempt < MAX_ATTEMPTS; attempt++) {
      expect(await processOutbox(ON, mailer, db.fetcher, now)).toMatchObject({ retrying: 1 });
      const row = db.tables.transactional_email_outbox[0];
      expect(row).toMatchObject({ status: 'pending', attempts: attempt, last_error: 'GMAIL_503' });
      expect(Date.parse(row.next_attempt_at) - now.getTime()).toBe(retryDelayMs(attempt));
      expect(await processOutbox(ON, mailer, db.fetcher, now)).toMatchObject({ retrying: 0 });
      now = new Date(row.next_attempt_at);
    }
    expect(await processOutbox(ON, mailer, db.fetcher, now)).toMatchObject({ failed: 1 });
    expect(db.tables.transactional_email_outbox[0]).toMatchObject({ status: 'failed', attempts: MAX_ATTEMPTS });
  });

  it('never resends when the outcome is unknown (no Gmail answer, or a run interrupted mid-send)', async () => {
    const db = fakeDb();
    await queue(db);
    const { mailer } = fakeMailer(async () => { throw new MailerError('GMAIL_NO_RESPONSE', false); });
    expect(await processOutbox(ON, mailer, db.fetcher, NOW)).toMatchObject({ unknown: 1 });
    expect(db.tables.transactional_email_outbox[0].status).toBe('unknown');

    const db2 = fakeDb();
    await queue(db2, { kind: 'access_code', accessCode: 'ABCD-EFGH-JKMN' });
    Object.assign(db2.tables.transactional_email_outbox[0], { status: 'sending', locked_at: '2026-11-25T11:00:00.000Z', attempts: 1 });
    const second = fakeMailer();
    expect(await processOutbox(ON, second.mailer, db2.fetcher, NOW)).toMatchObject({ unknown: 1, sent: 0 });
    expect(db2.tables.transactional_email_outbox[0]).toMatchObject({ status: 'unknown', secret_payload: null });
    expect(second.sent).toHaveLength(0);
  });

  it('a row claimed by a concurrent run is not sent twice', async () => {
    const db = fakeDb();
    await queue(db);
    const original = db.mock.getMockImplementation()!;
    db.mock.mockImplementation(async (input: any, init: any = {}) => {
      if (init.method === 'PATCH' && String(input).includes('status=eq.pending')) db.tables.transactional_email_outbox[0].attempts = 1;
      return original(input, init);
    });
    const { mailer, sent } = fakeMailer();
    await processOutbox(ON, mailer, db.fetcher, NOW);
    expect(sent).toHaveLength(0);
  });

  it('skips recipients outside the allowlist and sends nothing while email is off', async () => {
    const db = fakeDb();
    await queue(db);
    const { mailer, sent } = fakeMailer();
    expect(await processOutbox({ ...BASE }, mailer, db.fetcher, NOW)).toMatchObject({ sent: 0, skipped: 0 });
    expect(await processOutbox({ ...ON, TRANSACTIONAL_EMAIL_ALLOWLIST: '@synthetic.test' }, mailer, db.fetcher, NOW)).toMatchObject({ skipped: 1 });
    expect(sent).toHaveLength(0);
    expect(db.tables.transactional_email_outbox[0]).toMatchObject({ status: 'skipped', last_error: 'RECIPIENT_NOT_ALLOWLISTED' });
  });

  it('skips emails that no longer match the customer\'s state at send time', async () => {
    const db = fakeDb({
      payments: [{ reference_number: 'PS-1', status: 'rejected' }],
      access_codes: [await liveCode('OLD1-OLD1-OLD1', { expires_at: '2026-11-25T11:00:00.000Z' }), await liveCode('USED-USED-USED', { id: 'c2', used_at: '2026-11-25T10:00:00Z' })],
      navigator_paid_sessions: [{ id: 's1', email: 'a@example.test', tier: 'Pro', expires_at: '2026-12-30T00:00:00.000Z', revoked_at: null }],
    });
    const item = (kind: string, dedupeKey = 'PS-1', extra: Row = {}) => enqueueTransactionalEmail(ON, { kind, dedupeKey, reference: 'PS-1', email: 'p@example.test', data: {}, ...extra } as any, db.fetcher);
    await item('payment_instructions');                       // order rejected since checkout
    await item('purchase_receipt');                           // not approved
    await item('access_code', 'PS-1', { accessCode: 'OLD1-OLD1-OLD1' }); // replaced/expired code
    await enqueueTransactionalEmail(ON, { kind: 'access_code', dedupeKey: 'PS-2', reference: 'PS-1', email: 'p@example.test', data: {}, accessCode: 'USED-USED-USED' }, db.fetcher); // already redeemed
    await enqueueTransactionalEmail(ON, { kind: 'renewal_reminder', dedupeKey: 's1:2026-11-30', email: 'a@example.test', data: { plan: 'Pro', expiresAt: '2026-11-30T00:00:00.000Z' } }, db.fetcher); // renewed since
    await item('refund_confirmation');
    const { mailer, sent } = fakeMailer();
    expect(await processOutbox(ON, mailer, db.fetcher, NOW)).toMatchObject({ sent: 1, skipped: 5 });
    expect(sent.map((m) => m.subject)).toEqual(['Refund recorded for order PS-1']);
    expect(db.tables.transactional_email_outbox.filter((r) => r.status === 'skipped').every((r) => r.last_error === 'NO_LONGER_APPLICABLE' && r.secret_payload === null)).toBe(true);
  });

  it('a failed state check is retried later, not sent', async () => {
    const db = fakeDb();
    await queue(db);
    const original = db.mock.getMockImplementation()!;
    db.mock.mockImplementation(async (input: any, init: any = {}) => (String(input).includes('/payments?') ? new Response('', { status: 503 }) : original(input, init)));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { mailer, sent } = fakeMailer();
    expect(await processOutbox(ON, mailer, db.fetcher, NOW)).toMatchObject({ retrying: 1, sent: 0 });
    expect(db.tables.transactional_email_outbox[0]).toMatchObject({ status: 'pending', last_error: 'STATE_CHECK_FAILED' });
    expect(sent).toHaveLength(0);
    warn.mockRestore();
  });

  it('the administrator summary masks recipient addresses', async () => {
    const db = fakeDb();
    await queue(db);
    const summary = await outboxSummary(ON, db.fetcher);
    expect(summary.counts).toEqual({ pending: 1 });
    expect(summary.latest[0].recipient_email).toBe('p***@example.test');
  });
});

describe('request-access payment instructions hook', () => {
  it('queues the instructions email for a new order, and an outbox failure does not affect the order', async () => {
    vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue({ status: 'verified', uid: 'uid-test-1', email: 'parent@example.test', emailVerified: true } as any);
    const posted: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: any, init: any = {}) => {
      const u = String(url);
      if (u.includes('transactional_email_outbox')) { posted.push(init.body); return new Response('{}', { status: 500 }); }
      if ((init.method || 'GET') === 'GET') return Response.json([]);
      return new Response(null, { status: 201 });
    }));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await requestAccess({ request: new Request('http://localhost/api/request-access', { method: 'POST', body: JSON.stringify({ tier: 'Basic' }) }), env: { ...ON, FIREBASE_PROJECT_ID: 'p', PAYMENT_EMAIL: 'pay@example.test' } as any });
    expect(res.status).toBe(200);
    const body = await res.json() as any;
    expect(JSON.parse(posted[0])).toMatchObject({ kind: 'payment_instructions', dedupe_key: body.referenceNumber, recipient_email: 'parent@example.test', template_data: { plan: 'Basic', payTo: 'pay@example.test' } });
    errors.mockRestore();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });
});
