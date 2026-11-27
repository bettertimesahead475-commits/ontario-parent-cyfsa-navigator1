/**
 * PR #171 e-Transfer review (S-34): one approved payment must give at most one entitlement, however the customer
 * times POST /api/claim-purchase. The Supabase double below keeps the semantics the claim relies on: PATCH only touches
 * unused codes, and redeem_access_code_atomic (supabase/migrations/20261110004740_preserve_monthly_renewal.sql) refuses
 * used or expired codes and stacks a second code of the same tier onto the live session (+30 days).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import * as authCheck from '../../functions/api/_auth-check';
import { onRequestPost as claim } from '../../functions/api/claim-purchase';

const env = { FIREBASE_PROJECT_ID: 'p', SESSION_SECRET: 'secret', PAYMENT_EMAIL: 'pay@example.test', STAGING_SUPABASE_URL: 'https://db.test', STAGING_SUPABASE_SERVICE_ROLE_KEY: 'k' };
const REF = 'PS-RACE2345';
const DAY = 86400000;

type Code = { id: string; reference_number: string; email: string; tier: string; code_hash: string; used_at: string | null; expires_at: string };
type Session = { id: string; firebase_uid: string; tier: string; expires_at: string };
let codes: Code[]; let sessions: Session[]; let locks: Set<string>; let redemptions: string[];
let onLock: ((name: string) => void) | null; let insertGate: { waiting: number; release: (() => void) | null; size: number };

const sha = async (t: string) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t)))].map((b) => b.toString(16).padStart(2, '0')).join('');
const iso = () => new Date().toISOString();

async function redeem(uid: string, code: string): Promise<Record<string, unknown>> {
  const hash = await sha(code.trim().toUpperCase());
  const c = codes.find((x) => x.code_hash === hash);
  if (!c) return { status: 'invalid', code: 'CODE_NOT_FOUND' };
  if (c.used_at) return { status: 'consumed', code: 'CODE_ALREADY_USED' };
  if (Date.parse(c.expires_at) <= Date.now()) return { status: 'expired', code: 'CODE_EXPIRED' };
  c.used_at = iso(); redemptions.push(c.id);
  const live = sessions.filter((s) => s.firebase_uid === uid && s.tier === c.tier && Date.parse(s.expires_at) > Date.now()).sort((a, b) => b.expires_at.localeCompare(a.expires_at))[0];
  if (live) { live.expires_at = new Date(Date.parse(live.expires_at) + 30 * DAY).toISOString(); return { status: 'activated', session_id: live.id, tier: live.tier, expires_at: live.expires_at }; }
  const s = { id: `sess-${sessions.length + 1}`, firebase_uid: uid, tier: c.tier, expires_at: new Date(Date.now() + 30 * DAY).toISOString() };
  sessions.push(s);
  return { status: 'activated', session_id: s.id, tier: s.tier, expires_at: s.expires_at };
}

function install(uid: string) {
  const payment = { id: '22222222-2222-4222-8222-222222222222', reference_number: REF, plan: 'Premium', amount: 49.99, status: 'approved', notes: `email:${uid}@example.test;uid:${uid}`, firebase_uid: uid };
  vi.stubGlobal('fetch', vi.fn(async (input: string, init?: RequestInit) => {
    const url = new URL(input); const method = init?.method ?? 'GET';
    await Promise.resolve();
    if (url.pathname === '/storage/v1/object/list/analysis_jobs') return Response.json([]);
    if (url.pathname.startsWith('/storage/v1/object/analysis_jobs/admin-locks/')) {
      const name = decodeURIComponent(url.pathname.split('/').pop()!);
      if (locks.has(name)) return Response.json({ statusCode: '409' }, { status: 400 });
      locks.add(name); onLock?.(name);
      return Response.json({});
    }
    if (url.pathname.startsWith('/storage/v1/object/analysis_jobs/')) return Response.json({});
    if (url.pathname === '/rest/v1/payments') return Response.json(url.searchParams.get('reference_number') === `eq.${REF}` ? [payment] : []);
    if (url.pathname === '/rest/v1/access_codes') {
      const mine = codes.filter((c) => c.reference_number === REF);
      if (method === 'PATCH') { mine.filter((c) => !c.used_at).forEach((c) => { c.expires_at = JSON.parse(String(init?.body)).expires_at; }); return new Response(null, { status: 204 }); }
      if (method === 'POST') {
        // Interleaving point: hold each insert until `size` claims have reached it (or 300 ms pass).
        insertGate.waiting++;
        if (insertGate.waiting >= insertGate.size) insertGate.release?.();
        else await new Promise<void>((r) => { insertGate.release = r; setTimeout(r, 300); });
        codes.push({ id: `code-${codes.length + 1}`, used_at: null, ...JSON.parse(String(init?.body)) });
        return new Response(null, { status: 201 });
      }
      return Response.json(mine);
    }
    if (url.pathname === '/rest/v1/rpc/redeem_access_code_atomic') {
      const args = JSON.parse(String(init?.body));
      return Response.json(await redeem(args.p_firebase_uid, args.p_code));
    }
    return new Response('unexpected', { status: 500 });
  }));
  vi.spyOn(authCheck, 'verifyFirebaseRequest').mockResolvedValue({ status: 'verified', uid, email: `${uid}@example.test`, emailVerified: true } as never);
}

const claimReq = (ip: string) => claim({ request: new Request('https://x/api/claim-purchase', { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify({ referenceNumber: REF }) }), env } as never);

beforeEach(() => {
  codes = []; sessions = []; locks = new Set(); redemptions = []; onLock = null; insertGate = { waiting: 0, release: null, size: 2 };
  vi.useFakeTimers({ toFake: ['Date'] });
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('S-34: claim-purchase double activation across a minute boundary', () => {
  it('two claims of one approved payment straddling a minute boundary give at most one entitlement', async () => {
    install('uid-race-a');
    vi.setSystemTime(new Date('2026-11-27T12:00:59.990Z'));
    let second: Promise<Response> | null = null;
    // Isolate B's request arrives 20 ms after isolate A took the 12:00 lock, so it computes the 12:01 lock name.
    onLock = () => { if (!second) { vi.setSystemTime(new Date('2026-11-27T12:01:00.010Z')); second = claimReq('10.9.0.2'); } };
    const first = await claimReq('10.9.0.1');
    const results = [first, await second!];
    const ok = results.filter((r) => r.status === 200).length;
    // Precondition: both isolates got a minute-scoped lock, so only the once-per-order claim lock can stop the race.
    expect([...locks].filter((l) => l.includes('reissue')).length).toBe(2);
    expect(redemptions.length, `codes redeemed for one payment: ${redemptions.length}`).toBeLessThanOrEqual(1);
    expect(ok).toBeLessThanOrEqual(1);
    const days = Math.round((Date.parse(sessions[0]?.expires_at ?? iso()) - Date.now()) / DAY);
    expect(days, 'entitlement days granted for one 30-day payment').toBeLessThanOrEqual(30);
  });

  it('control: two claims inside the same minute give exactly one entitlement', async () => {
    install('uid-race-b');
    vi.setSystemTime(new Date('2026-11-27T12:05:10.000Z'));
    insertGate.size = 1;
    const [a, b] = await Promise.all([claimReq('10.9.1.1'), claimReq('10.9.1.2')]);
    expect([a.status, b.status].sort()).toEqual([200, 409]);
    expect(redemptions).toHaveLength(1);
    expect(sessions).toHaveLength(1);
  });

  it('control: a code the administrator sent cannot be redeemed after the customer claimed', async () => {
    install('uid-race-c');
    vi.setSystemTime(new Date('2026-11-27T12:10:00.000Z'));
    insertGate.size = 1;
    const adminCode = 'ADMN-CODE-0001';
    codes.push({ id: 'code-admin', reference_number: REF, email: 'uid-race-c@example.test', tier: 'Premium', code_hash: await sha(adminCode), used_at: null, expires_at: new Date(Date.now() + 14 * DAY).toISOString() });
    expect((await claimReq('10.9.2.1')).status).toBe(200);
    expect(await redeem('uid-race-c', adminCode)).toMatchObject({ status: 'expired' });
    expect(sessions).toHaveLength(1);
  });
});
