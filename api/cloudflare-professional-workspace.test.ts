import { describe, it, expect, vi } from 'vitest';
import { handleProfessionalWorkspace } from '../functions/api/professional-workspace/[[path]]';
const matter = '11111111-1111-4111-8111-111111111111';
const env = { FIREBASE_PROJECT_ID: 'fixture', STAGING_SUPABASE_URL: 'https://fixture.supabase.co', STAGING_SUPABASE_SERVICE_ROLE_KEY: 'synthetic' };
function fixture(reviewer = true) {
  const authenticate = vi.fn(async () => ({ status: 'verified' as const, uid: 'reviewer', email: null, emailVerified: true }));
  const fetcher = vi.fn(async (input: any, init?: RequestInit) => {
    const url = new URL(String(input)), table = url.pathname.split('/').pop();
    if (table === 'accounts') { expect(url.searchParams.get('firebase_uid')).toBe('eq.reviewer'); return Response.json([{ id: 'account', status: 'active' }]); }
    if (table === 'navigator_matter_members') {
      expect(url.searchParams.get('account_id')).toBe('eq.account'); expect(url.searchParams.get('role')).toBe('eq.REVIEWER');
      return Response.json(reviewer ? [{ role: 'REVIEWER', matter_id: matter, navigator_matters: { title: 'Synthetic matter' } }] : []);
    }
    expect(url.searchParams.get('matter_id')).toBe('eq.' + matter);
    if (init?.method === 'HEAD') return new Response(null, { headers: { 'Content-Range': '0-0/2' } });
    if (table === 'professional_reviews') expect(url.searchParams.get('reviewer_account_id')).toBe('eq.account');
    return Response.json([]);
  }) as unknown as typeof fetch;
  const call = (path = 'matters', method = 'GET') => handleProfessionalWorkspace(new Request('https://preview.test/api/professional-workspace/' + path, { method }), env, { fetcher, authenticate });
  return { call, fetcher };
}
describe('native Cloudflare professional read runtime', () => {
  it('lists only the verified account reviewer matters without the API bridge', async () => { const f = fixture(); const r = await f.call(); expect(r.status).toBe(200); expect(await r.json()).toEqual([{ id: matter, title: 'Synthetic matter', role: 'REVIEWER' }]); });
  it('denies missing identity before database reads', async () => { const f = fixture(); expect((await handleProfessionalWorkspace(new Request('https://preview.test/api/professional-workspace/matters'), env, { fetcher: f.fetcher })).status).toBe(401); expect(f.fetcher).not.toHaveBeenCalled(); });
  it('denies non-reviewers before reading matter contents', async () => { const f = fixture(false); expect((await f.call('matters/' + matter + '/overview')).status).toBe(403); expect(f.fetcher).toHaveBeenCalledTimes(2); });
  it('reads exact overview counts from the database rather than treating failures as zero', async () => { const f = fixture(); const r = await f.call('matters/' + matter + '/overview'); expect(r.status).toBe(200); expect(await r.json()).toMatchObject({ documents: 2, reviewedItems: 2, caseRequirements: 2 }); });
  it('scopes intelligence and reviews to the authorized matter and reviewer', async () => { const f = fixture(); const r = await f.call('matters/' + matter + '/intelligence/EVIDENCE'); expect(r.status).toBe(200); expect(await r.json()).toEqual({ items: [], reviews: [] }); });
  it('fails closed on database outages', async () => { const fetcher = vi.fn(async () => new Response('', { status: 503 })); const authenticate = async () => ({ status: 'verified' as const, uid: 'reviewer', email: null, emailVerified: true }); expect((await handleProfessionalWorkspace(new Request('https://preview.test/api/professional-workspace/matters'), env, { fetcher, authenticate })).status).toBe(503); });
  it('does not accept writes through the read runtime', async () => { const f = fixture(); expect((await f.call('matters/' + matter + '/review', 'POST')).status).toBe(405); expect(f.fetcher).not.toHaveBeenCalled(); });
});
