import { createHash } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnalyzerError } from '../../api/services/analyzerErrors';
import * as auth from '../../functions/api/_auth-check';
import { onRequestGet as accessPricing, TIER_PRICES } from '../../functions/api/access-pricing';
import { onRequest as admin } from '../../functions/api/admin/[[path]]';
import { onRequestPost as activateCode } from '../../functions/api/activate-code';
import { handleAnalyzeRequest } from '../../functions/api/analyze';
import { onRequestGet as analyzerUsage } from '../../functions/api/analyzer-usage';
import { onRequestPost as requestAccess } from '../../functions/api/request-access';

const customer = { uid: 'qa-parent', email: 'qa-parent@example.test' };
const administrator = { uid: 'qa-admin', email: 'qa-admin@example.test' };
const otherCustomer = { uid: 'qa-other-parent', email: 'qa-other@example.test' };
const env = {
  FIREBASE_PROJECT_ID: 'synthetic-qa',
  ADMIN_EMAILS: administrator.email,
  ANALYZER_ENABLED: 'true',
  ANTHROPIC_API_KEY: 'local-provider-stub',
  SESSION_SECRET: 'local-session-stub',
  STAGING_SUPABASE_URL: 'https://db.example.test',
  STAGING_SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiJ9.' + 'a'.repeat(120) + '.sig',
};

type Row = Record<string, unknown>;

function filterRows(rows: Row[], params: URLSearchParams): Row[] {
  function matches(row: Row, key: string, value: string): boolean {
    if (value.startsWith('eq.')) return String(row[key]) === value.slice(3);
    if (value === 'is.null') return row[key] == null;
    if (value === 'not.is.null') return row[key] != null;
    throw new Error(`Unexpected mocked PostgREST filter: ${key}=${value}`);
  }

  const filtered = rows.filter((row) => [...params].every(([key, value]) => {
    if (['select', 'limit'].includes(key)) return true;
    if (key === 'or') {
      return value.slice(1, -1).split(',').some((clause) => {
        const split = clause.indexOf('.');
        return matches(row, clause.slice(0, split), clause.slice(split + 1));
      });
    }
    return matches(row, key, value);
  }));
  return params.has('limit') ? filtered.slice(0, Number(params.get('limit'))) : filtered;
}

function post(path: string, uid: string, body: object): Request {
  return new Request(`https://app.example.test/api/${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${uid}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function commercialBackend() {
  vi.spyOn(auth, 'verifyFirebaseRequest').mockImplementation(async (request) => {
    const actor = [customer, administrator, otherCustomer].find(({ uid }) => request.headers.get('Authorization') === `Bearer ${uid}`);
    return actor ? { ...actor, status: 'verified', emailVerified: true } : { status: 'denied' };
  });
  const payments: Row[] = [];
  const codes: Row[] = [];
  const sessions: Row[] = [];
  const counters: Row[] = [];
  const tables: Record<string, Row[]> = { payments, access_codes: codes, navigator_paid_sessions: sessions, free_usage: counters };
  const storedObjects = new Map<string, string>();
  const reservationId = crypto.randomUUID();
  let pending: { session: unknown; request: unknown; counter: Row } | undefined;
  const fetcher = vi.fn<typeof fetch>(async (input, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const { pathname, searchParams } = url;
    expect(url.origin).toBe(env.STAGING_SUPABASE_URL);
    const body = init.body ? JSON.parse(String(init.body)) : undefined;
    const table = tables[pathname.replace('/rest/v1/', '')];
    if (table) {
      if (init.method === 'POST') {
        table.push({ id: crypto.randomUUID(), ...body });
        return new Response(null, { status: 201 });
      }
      const rows = filterRows(table, searchParams);
      if (init.method === 'PATCH') rows.forEach((row) => Object.assign(row, body));
      return Response.json(rows);
    }
    if (pathname === '/rest/v1/rpc/redeem_access_code_atomic' && init.method === 'POST') {
      const hash = createHash('sha256').update(body.p_code).digest('hex');
      const code = codes.find((row) => row.code_hash === hash && row.email === body.p_email);
      if (!code) return Response.json({ status: 'invalid' });
      const issued = new Date();
      const linked = sessions.find((row) => row.id === code.redeemed_session_id);
      if (code.used_at) {
        return Response.json(linked && linked.firebase_uid === body.p_firebase_uid && !linked.revoked_at
          ? { status: 'reused', session_id: linked.id, tier: linked.tier, expires_at: linked.expires_at }
          : { status: 'consumed' });
      }
      if (Date.parse(String(code.expires_at)) <= issued.getTime()) return Response.json({ status: 'expired' });
      const session = {
        id: crypto.randomUUID(), tier: code.tier, firebase_uid: body.p_firebase_uid, access_code_id: code.id,
        issued_at: issued.toISOString(), expires_at: new Date(issued.getTime() + 30 * 86400000).toISOString(), revoked_at: null,
      };
      code.used_at = session.issued_at;
      code.redeemed_session_id = session.id;
      sessions.push(session);
      return Response.json({ status: 'activated', session_id: session.id, tier: session.tier, expires_at: session.expires_at });
    }
    if (pathname === '/rest/v1/rpc/paid_reserve_credit' && init.method === 'POST') {
      expect(sessions.some((row) => row.id === body.p_session && !row.revoked_at)).toBe(true);
      expect(pending).toBeUndefined();
      const suffix = body.p_scope === 'total' ? 'total' : `period_${body.p_scope.replace(/^period:/, '')}`;
      const uid = `paid_session_${body.p_session}_${suffix}`;
      const counter = counters.find((row) => row.uid === uid) ?? { uid, analyses_used: 0 };
      if (!counters.includes(counter)) counters.push(counter);
      if (Number(counter.analyses_used) >= body.p_granted) return Response.json({ status: 'limit' });
      counter.analyses_used = Number(counter.analyses_used) + 1;
      pending = { session: body.p_session, request: body.p_request, counter };
      return Response.json({ status: 'reserved', reservation_id: reservationId });
    }
    if (pathname === '/rest/v1/rpc/paid_release_credit' && init.method === 'POST') {
      if (!pending || pending.session !== body.p_session || pending.request !== body.p_request || body.p_reservation_id !== reservationId) {
        return Response.json({ status: 'noop' });
      }
      pending.counter.analyses_used = Number(pending.counter.analyses_used) - 1;
      pending = undefined;
      return Response.json({ status: 'released' });
    }
    if (pathname === '/storage/v1/object/list/analysis_jobs' && init.method === 'POST') {
      const prefix = `${body.prefix}/`;
      const names = [...storedObjects.keys()].filter((key) => key.startsWith(prefix)).sort().reverse();
      return Response.json(names.slice(body.offset, body.offset + body.limit).map((key) => ({ name: key.slice(prefix.length) })));
    }
    const objectPrefix = '/storage/v1/object/analysis_jobs/';
    if (pathname.startsWith(objectPrefix) && init.method === 'POST') {
      const key = decodeURIComponent(pathname.slice(objectPrefix.length));
      if (storedObjects.has(key) && new Headers(init.headers).get('x-upsert') !== 'true') {
        return Response.json({ statusCode: '409' }, { status: 400 });
      }
      storedObjects.set(key, String(init.body));
      return Response.json({ Key: key });
    }
    throw new Error(`Unexpected mocked Supabase request: ${init.method} ${pathname}`);
  });
  vi.stubGlobal('fetch', fetcher);
  return { payments, codes, sessions, storedObjects };
}

async function checkout(tier: string) {
  const backend = commercialBackend();
  const catalog = await (await accessPricing()).json();
  async function submit() {
    return requestAccess({ request: post('request-access', customer.uid, { tier, requestKey: 'test-request-1' }), env });
  }
  const response = await submit();
  expect(response.status).toBe(200);
  expect(backend.payments).toHaveLength(1);
  const { referenceNumber } = await response.json();
  expect(backend.payments[0].reference_number).toBe(referenceNumber);
  return { ...backend, advertised: catalog.prices[tier] as number, amountDue: backend.payments[0].amount, referenceNumber, submit };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function approve(referenceNumber: string, amountReceived: unknown) {
  return admin({ request: post('admin/payments/approve', administrator.uid, { referenceNumber, amountReceived }), env });
}

describe.each(Object.keys(TIER_PRICES))('%s commercial flow', (tier) => {
  let flow: Awaited<ReturnType<typeof checkout>>;
  beforeEach(async () => { flow = await checkout(tier); });

  it('records the advertised price and approves a payment for that amount', async () => {
    const { referenceNumber, advertised, amountDue, codes } = flow;
    const response = await approve(referenceNumber, advertised);
    // COM-1: was a known defect (it.fails) on engineering/integration; fixed by the e-Transfer payments train (#171).
    expect({ amountDue, status: response.status, codesIssued: codes.length }).toEqual({
      amountDue: advertised, status: 200, codesIssued: 1,
    });
  });

  it('activates the recorded quote, restores a failed analysis credit and refunds only once', async () => {
    const { referenceNumber, amountDue, payments, codes, sessions, storedObjects, submit } = flow;
    const approval = await approve(referenceNumber, amountDue);
    expect(approval.status).toBe(200);
    const { accessCode } = await approval.json();
    expect(accessCode).toEqual(expect.any(String));
    expect(codes).toHaveLength(1);

    function redeem(actor: typeof customer) {
      return activateCode({ request: post('activate-code', actor.uid, { code: accessCode, email: customer.email, referenceNumber }), env });
    }
    const activation = await redeem(customer);
    expect(activation.status).toBe(200);
    const { token } = await activation.json();
    expect(sessions).toHaveLength(1);

    const basic = tier === 'Basic' || tier === 'AnalyzerBasic';
    const monthly = tier === 'Pro' || tier.startsWith('Community');
    const allowance = basic ? 3 : 5;
    async function usage(sessionToken = token) {
      const request = new Request('https://app.example.test/api/analyzer-usage', {
        headers: { Authorization: `Bearer ${customer.uid}`, 'x-ps-session': sessionToken },
      });
      const response = await analyzerUsage({ request, env });
      expect(response.status).toBe(200);
      return response.json();
    }
    const initial = await usage();
    expect(initial).toMatchObject({
      type: 'paid', tier, sessionId: sessions[0].id, countsAvailable: true,
      creditsLimit: allowance, creditsRemaining: allowance,
      quickReviewsLimit: monthly ? null : allowance, forensicAnalysesLimit: basic ? 0 : allowance,
    });

    const repeat = await redeem(customer);
    expect(repeat.status).toBe(200);
    const replay = await repeat.json();
    expect(replay).toMatchObject({ success: true, tier, reused: true });
    expect(sessions).toHaveLength(1);
    expect(await usage(replay.token)).toEqual(initial);
    expect((await redeem(otherCustomer)).status).toBe(409);
    expect(sessions).toHaveLength(1);

    const duplicate = await submit();
    expect(duplicate.status).toBe(200);
    expect(await duplicate.json()).toMatchObject({ referenceNumber, amount: amountDue, reused: true });
    expect(payments).toHaveLength(1);

    const observedBalances: number[] = [];
    const generate = vi.fn(async () => {
      observedBalances.push((await usage()).creditsRemaining);
      throw new AnalyzerError('AI_PROVIDER_CONFIGURATION_ERROR', 503, 'Synthetic provider failure', false);
    });
    const failed = await handleAnalyzeRequest(post('analyze', customer.uid, {
      sessionId: token, mode: monthly ? 'full' : 'fast', stream: false,
      documentText: 'Synthetic intake note: the family attended the scheduled meeting and received a copy of the written plan.',
    }), env, { generate });
    expect(failed.status).toBe(503);
    expect(await failed.json()).toMatchObject({ code: 'AI_PROVIDER_CONFIGURATION_ERROR' });
    expect(observedBalances.length).toBeGreaterThan(0);
    expect(new Set(observedBalances)).toEqual(new Set([allowance - 1]));
    expect(await usage()).toEqual(initial);

    function refund() {
      return admin({ request: post('admin/payments/refund', administrator.uid, { referenceNumber, reason: 'Synthetic QA refund' }), env });
    }
    const refunded = await refund();
    expect(refunded.status).toBe(200);
    expect(await refunded.json()).toMatchObject({ sessionsRevoked: 1, auditRecorded: true });
    expect((await usage()).type).not.toBe('paid');
    const afterRefund = structuredClone({ sessions, payments, codes, storedObjects });
    const alreadyRefunded = await refund();
    expect(alreadyRefunded.status).toBe(409);
    expect(await alreadyRefunded.json()).toMatchObject({ code: 'ALREADY_REFUNDED' });
    expect({ sessions, payments, codes, storedObjects }).toEqual(afterRefund);
  });
});
