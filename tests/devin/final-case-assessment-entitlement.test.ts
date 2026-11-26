/** Synthetic fixture adapted from api/cloudflare-final-case-assessment.test.ts with a configurable tier. */
import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { handleAssessment, validateAssessment } from '../../functions/api/final-case-assessment';
const matter = '11111111-1111-4111-8111-111111111111';
const session = '22222222-2222-4222-8222-222222222222';
const sourceText = 'On January 3 the parent requested disclosure. The agency reported it had been supplied.';
const sourceName = 'Synthetic affidavit.txt';
const page = createHash('sha256').update(JSON.stringify([sourceName, sourceText])).digest('hex');
const env = { ANALYZER_ENABLED: 'true', FIREBASE_PROJECT_ID: 'fixture', STAGING_SUPABASE_URL: 'https://fixture.supabase.co', STAGING_SUPABASE_READ_KEY: 'synthetic-read', STAGING_SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service' };
function fixture(tier: string) {
  const store = new Map<string, any>();
  let expired = false, revoked = false, foreign = false, empty = false, failSave = false, failFinalize = false, owner = true, clientOwned = true;
  let balance = 5, charged = 0;
  const ledger = new Map<string, string>();
  const rpc = vi.fn(async (name: string, args: any) => {
    const id = args.p_request;
    if (name === 'paid_reserve_credit') {
      const state = ledger.get(id);
      if (state === 'consumed') return { status: 'consumed' };
      if (state === 'reserved') return { status: 'in_progress' };
      if (!balance) return { status: 'limit' };
      ledger.set(id, 'reserved'); return { status: 'reserved', reservation_id: 'reservation' };
    }
    if (name === 'paid_finalize_credit') {
      if (ledger.get(id) === 'reserved') { balance--; charged++; ledger.set(id, 'consumed'); }
      if (failFinalize) { failFinalize = false; throw new Error('Response lost after commit'); }
      return { status: ledger.get(id) || 'missing' };
    }
    if (ledger.get(id) === 'reserved') ledger.set(id, 'released');
    return { status: ledger.get(id) === 'consumed' ? 'consumed' : 'released' };
  });
  const fetcher = vi.fn(async (input: any, init?: RequestInit) => {
    const url = new URL(String(input));
    const table = url.pathname.split('/').pop()!;
    if (table === 'navigator_parent_matter_setup') { const body = JSON.parse(String(init?.body)); expect(body.p_uid).toBe('parent'); return Response.json({ id: body.p_request, title: body.p_title }); }
    if (url.pathname.endsWith('/object/list/analysis_jobs')) return Response.json(empty ? [] : [{ name: page + '.json' }]);
    if (url.pathname.includes('/storage/')) {
      const key = url.pathname.replace('/authenticated/', '/');
      if (init?.method === 'POST') {
        if (failSave) return new Response('', { status: 503 });
        store.set(key, JSON.parse(String(init.body))); return Response.json({});
      }
      if (store.has(key)) return Response.json(store.get(key));
      if (url.pathname.includes('/assessment_sources/') && url.pathname.endsWith('/' + page + '.json')) return Response.json({ uid: 'parent', matterId: matter, source: { id: page, version: page, document: sourceName, page: 1, text: sourceText } });
      return new Response('', { status: 404 });
    }
    if (table === 'navigator_paid_sessions') return Response.json([{ id: session, firebase_uid: 'parent', tier, issued_at: '2026-01-01T00:00:00Z', expires_at: expired ? '2020-01-01T00:00:00Z' : '2099-01-01T00:00:00Z', revoked_at: revoked ? '2026-01-01T00:00:00Z' : null }]);
    if (table === 'accounts') return Response.json([{ id: 'account', status: 'active' }]);
    if (table === 'navigator_matters') return Response.json(foreign ? [] : [{ id: matter, title: 'Synthetic matter', client_id: 'client' }]);
    if (table === 'navigator_matter_members') return Response.json(owner ? [{ role: 'OWNER' }] : []);
    if (table === 'clients') return Response.json(clientOwned ? [{ id: 'client' }] : []);
    throw new Error('Unexpected URL ' + url);
  }) as unknown as typeof fetch;
  const output = Object.fromEntries(['overview', 'chronology', 'conflicts', 'gaps', 'questions'].map(k => [k, [{ text: 'Synthetic ' + k, sources: [page] }]]));
  const generate = vi.fn(async () => ({ text: JSON.stringify(output), durationMs: 1, usage: null, model: 'synthetic' }));
  const authenticate = vi.fn(async () => ({ status: 'verified' as const, uid: 'parent', email: null, emailVerified: true }));
  const request = (method = 'POST', id = matter) => new Request('https://preview.test/api/final-case-assessment?matterId=' + id, { method, headers: { 'X-PS-Session': session } });
  const call = (method = 'POST') => handleAssessment(request(method), env, { fetcher, rpc, generate, authenticate });
  return { store, rpc, fetcher, generate, authenticate, request, call, get balance() { return balance; }, get charged() { return charged; }, expire() { expired = true; }, revoke() { revoked = true; }, foreign() { foreign = true; }, empty() { empty = true; }, noOwner() { owner = false; }, foreignClient() { clientOwned = false; }, failSave() { failSave = true; }, failFinalize() { failFinalize = true; } };
}
describe('Final Case Assessment entitlement gate (mutation gap M16)', () => {
  it.each(['Basic', 'Premium', 'AnalyzerPremium', 'Community5'])('refuses a verified %s session before any model call or credit reservation', async (tier) => {
    const f = fixture(tier);
    const res = await f.call();
    expect(res.status).toBe(403);
    expect(f.generate).not.toHaveBeenCalled();
    expect(f.rpc).not.toHaveBeenCalled();
    expect(f.charged).toBe(0);
  });
  it('still serves a Pro session', async () => {
    expect((await fixture('Pro').call()).status).toBe(200);
  });
});
