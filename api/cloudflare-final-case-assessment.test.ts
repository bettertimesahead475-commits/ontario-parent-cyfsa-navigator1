import { describe, it, expect, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { handleAssessment, validateAssessment } from '../functions/api/final-case-assessment';
const matter = '11111111-1111-4111-8111-111111111111';
const session = '22222222-2222-4222-8222-222222222222';
const sourceText = 'On January 3 the parent requested disclosure. The agency reported it had been supplied.';
const sourceName = 'Synthetic affidavit.txt';
const page = createHash('sha256').update(JSON.stringify([sourceName, sourceText])).digest('hex');
const env = { ANALYZER_ENABLED: 'true', FIREBASE_PROJECT_ID: 'fixture', STAGING_SUPABASE_URL: 'https://fixture.supabase.co', STAGING_SUPABASE_READ_KEY: 'synthetic-read', STAGING_SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service' };
function fixture() {
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
    if (table === 'navigator_paid_sessions') return Response.json([{ id: session, firebase_uid: 'parent', tier: 'Pro', issued_at: '2026-01-01T00:00:00Z', expires_at: expired ? '2020-01-01T00:00:00Z' : '2099-01-01T00:00:00Z', revoked_at: revoked ? '2026-01-01T00:00:00Z' : null }]);
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
describe('parent Final Case Assessment Cloudflare route', () => {
  it('generates, persists, reopens after a new request and charges exactly once', async () => {
    const f = fixture(); const generated = await f.call(); expect(generated.status).toBe(200);
    const body = await generated.json(); expect(body.report.sections.conflicts[0].sources).toEqual([page]);
    expect(f.balance).toBe(4); expect(f.charged).toBe(1);
    expect((await (await f.call('GET')).json()).report).toEqual(body.report);
    expect((await f.call()).status).toBe(200); expect(f.generate).toHaveBeenCalledTimes(1); expect(f.charged).toBe(1);
  });
  it('rejects unauthenticated requests using the real verifier', async () => {
    const f = fixture(); expect((await handleAssessment(f.request(), env, { fetcher: f.fetcher })).status).toBe(401); expect(f.fetcher).not.toHaveBeenCalled();
  });
  it('denies another matter owner before loading sources or invoking the provider', async () => {
    const f = fixture(); f.foreign(); expect((await f.call()).status).toBe(404); expect(f.generate).not.toHaveBeenCalled(); expect(f.rpc).not.toHaveBeenCalled();
  });
  it.each(['expire', 'revoke'] as const)('denies %s access including saved reports', async action => {
    const f = fixture(); await f.call(); f[action](); expect((await f.call()).status).toBe(403); expect((await f.call('GET')).status).toBe(403); expect(f.charged).toBe(1);
  });
  it('denies foreign paid sessions even if an adapter returns a mismatched UID', async () => {
    const f = fixture(); f.authenticate.mockResolvedValue({ status: 'verified', uid: 'intruder', email: null, emailVerified: true }); expect((await f.call()).status).toBe(403); expect(f.rpc).not.toHaveBeenCalled();
  });
  it('rejects missing sources before reserving a credit', async () => {
    const f = fixture(); f.empty(); expect((await f.call()).status).toBe(422); expect(f.rpc).not.toHaveBeenCalled();
  });
  it('releases a failed provider attempt and retry consumes only one unit', async () => {
    const f = fixture(); f.generate.mockRejectedValueOnce(new Error('synthetic provider failure'));
    expect((await f.call()).status).toBe(503); expect(f.balance).toBe(5); expect(f.charged).toBe(0);
    expect(f.rpc.mock.calls.some(c => c[0] === 'paid_release_credit')).toBe(true);
    expect((await f.call()).status).toBe(200); expect(f.balance).toBe(4); expect(f.charged).toBe(1);
  });
  it('rejects ungrounded provider references and preserves allowance', async () => {
    const f = fixture(); f.generate.mockResolvedValueOnce({ text: JSON.stringify({ overview: [{ text: 'Invented', sources: ['foreign-page'] }] }), durationMs: 1, usage: null, model: 'synthetic' });
    expect((await f.call()).status).toBe(502); expect(f.balance).toBe(5);
  });
  it('does not charge when report persistence fails', async () => {
    const f = fixture(); f.failSave(); expect((await f.call()).status).toBe(503); expect(f.balance).toBe(5);
  });
  it('recovers a committed credit with lost response without regenerating or charging twice', async () => {
    const f = fixture(); f.failFinalize(); expect((await f.call()).status).toBe(503); expect(f.charged).toBe(1);
    expect((await f.call()).status).toBe(200); expect(f.charged).toBe(1); expect(f.generate).toHaveBeenCalledTimes(1);
  });
  it('blocks simultaneous duplicates while the first provider is pending', async () => {
    const f = fixture(); const original = f.generate.getMockImplementation()!; let resolve!: () => void;
    const started = new Promise<void>(r => { resolve = r; }); let finish!: () => void;
    const wait = new Promise<void>(r => { finish = r; }); f.generate.mockImplementationOnce(async () => { resolve(); await wait; return original(); });
    const first = f.call(); await started; expect((await f.call()).status).toBe(409); finish(); expect((await first).status).toBe(200); expect(f.charged).toBe(1);
  });
  it('rechecks expiry after provider work and releases the reserved unit', async () => {
    const f = fixture(); const original = f.generate.getMockImplementation()!;
    f.generate.mockImplementationOnce(async () => { const result = await original(); f.expire(); return result; });
    expect((await f.call()).status).toBe(403); expect(f.charged).toBe(0); expect(f.balance).toBe(5);
  });
  it('saves a synthetic text source to private owned storage without reserving credits', async () => {
    const f = fixture(); const request = new Request(f.request().url + '&action=source', { method: 'POST', headers: f.request().headers, body: JSON.stringify({ filename: 'synthetic.txt', text: 'Fictional source document.' }) });
    const response = await handleAssessment(request, env, { fetcher: f.fetcher, rpc: f.rpc, generate: f.generate, authenticate: f.authenticate });
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ saved: true }); expect(f.rpc).not.toHaveBeenCalled(); expect(f.generate).not.toHaveBeenCalled();
    expect([...f.store.values()].some(v => v.uid === 'parent' && v.matterId === matter && v.source?.document === 'synthetic.txt')).toBe(true);
  });
  it('denies a source write to another account matter', async () => {
    const f = fixture(); f.foreign(); const request = new Request(f.request().url + '&action=source', { method: 'POST', headers: f.request().headers, body: JSON.stringify({ filename: 'synthetic.txt', text: 'Fictional source.' }) });
    expect((await handleAssessment(request, env, { fetcher: f.fetcher, authenticate: f.authenticate })).status).toBe(404);
    expect((f.fetcher as any).mock.calls.some((c: any) => String(c[0]).includes('/storage/'))).toBe(false);
  });
  it('validates every required report section', () => { expect(() => validateAssessment({}, [])).toThrow(); });
  it.each(['noOwner', 'foreignClient'] as const)('denies %s before reserving credits', async action => { const f = fixture(); f[action](); expect((await f.call()).status).toBe(404); expect(f.rpc).not.toHaveBeenCalled(); });
  it('creates a matter with the verified identity and a stable retry key', async () => {
    const f = fixture();
    const create = () => handleAssessment(new Request('https://preview.test/api/final-case-assessment?action=create-matter', { method: 'POST', headers: f.request().headers, body: JSON.stringify({ title: ' Synthetic new matter ', requestId: matter, uid: 'forged-account' }) }), env, { fetcher: f.fetcher, authenticate: f.authenticate, rpc: f.rpc });
    expect(await (await create()).json()).toEqual({ matter: { id: matter, title: 'Synthetic new matter' } });
    expect(await (await create()).json()).toEqual({ matter: { id: matter, title: 'Synthetic new matter' } }); expect(f.rpc).not.toHaveBeenCalled();
  });
});
