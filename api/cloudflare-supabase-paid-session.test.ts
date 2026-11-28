import { describe, expect, it, vi } from 'vitest';
import { readVerifiedPaidSession } from '../functions/api/_supabase-paid-session';

const env = { STAGING_SUPABASE_URL: 'https://staging.example.supabase.co', STAGING_SUPABASE_READ_KEY: 'test-server-secret' };
const sid = '11111111-1111-4111-8111-111111111111';
const row = { id: sid, firebase_uid: 'u1', tier: 'Basic', issued_at: '2026-01-01T00:00:00Z', expires_at: null, revoked_at: null };
describe('staging paid session read adapter', () => {
  it('denies missing identity and rejects absent credentials', async () => {
    expect((await readVerifiedPaidSession(env, '', sid)).status).toBe('denied');
    expect((await readVerifiedPaidSession({}, 'u1', sid)).status).toBe('unavailable');
  });
  it('rejects malformed session identifiers before making a database request', async () => {
    const fetcher = vi.fn(async () => Response.json([row]));
    const malformed = [
      '111111111111411181111111111111111111',
      '11111111-1111-4111-8111-11111111111-',
      '11111111-1111-4111-8111-1111111111--',
      '11111111-1111-4111-8111-11111111111g',
    ];
    for (const candidate of malformed) {
      expect((await readVerifiedPaidSession(env, 'u1', candidate, fetcher as typeof fetch)).status).toBe('denied');
    }
    expect(fetcher).not.toHaveBeenCalled();
  });
  it('uses the existing server-only service binding when a separate read key is absent', async () => {
    const mock = vi.fn(async (_url: string, init: RequestInit) => { expect((init.headers as any).apikey).toBe('synthetic-service'); expect(init.redirect).toBe('manual'); return Response.json([row]); });
    expect((await readVerifiedPaidSession({ STAGING_SUPABASE_URL: env.STAGING_SUPABASE_URL, STAGING_SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service' }, 'u1', sid, mock as typeof fetch)).status).toBe('verified');
  });
  it('prefers the service-role key over a separate read key, because only service_role may read paid sessions', async () => {
    // Regression: a configured non-service read key was tried first. The table grants SELECT only to
    // service_role, so every paid Forensic request failed as SESSION_INVALID before reserving credit.
    const mock = vi.fn(async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      expect(headers.apikey).toBe('synthetic-service');
      expect(headers.Authorization).toBe('Bearer synthetic-service');
      return Response.json([row]);
    });
    const both = { ...env, STAGING_SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service' };
    expect((await readVerifiedPaidSession(both, 'u1', sid, mock as typeof fetch)).status).toBe('verified');
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it('sends the service-role key with the same apikey and Bearer pair as the credit RPC, even when opaque', async () => {
    const mock = vi.fn(async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      expect(headers.apikey).toBe('sb_secret_synthetic');
      expect(headers.Authorization).toBe('Bearer sb_secret_synthetic');
      return Response.json([row]);
    });
    const opaqueService = { STAGING_SUPABASE_URL: env.STAGING_SUPABASE_URL, STAGING_SUPABASE_SERVICE_ROLE_KEY: '  sb_secret_synthetic  ' };
    expect((await readVerifiedPaidSession(opaqueService, 'u1', sid, mock as typeof fetch)).status).toBe('verified');
  });
  it('keeps omitting Bearer for an opaque read key when no service-role key is configured', async () => {
    const mock = vi.fn(async (_url: string, init: RequestInit) => {
      const headers = init.headers as Record<string, string>;
      expect(headers.apikey).toBe('sb_secret_readonly');
      expect(headers.Authorization).toBeUndefined();
      return Response.json([row]);
    });
    const readOnly = { STAGING_SUPABASE_URL: env.STAGING_SUPABASE_URL, STAGING_SUPABASE_READ_KEY: 'sb_secret_readonly' };
    expect((await readVerifiedPaidSession(readOnly, 'u1', sid, mock as typeof fetch)).status).toBe('verified');
  });
  it('reports a rejected lookup as unavailable (503), never as a denied session', async () => {
    const both = { ...env, STAGING_SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service' };
    const rejected = vi.fn(async () => Response.json({ code: '42501', message: 'permission denied' }, { status: 401 }));
    expect((await readVerifiedPaidSession(both, 'u1', sid, rejected as typeof fetch)).status).toBe('unavailable');
  });
  it('filters by both session ID and Firebase UID and verifies row', async () => {
    const mock = vi.fn(async (url: string) => {
      const u = new URL(url);
      expect(u.searchParams.get('firebase_uid')).toBe('eq.u1');
      expect(u.searchParams.get('id')).toBe('eq.' + sid);
      return Response.json([row]);
    });
    expect((await readVerifiedPaidSession(env, 'u1', sid, mock as typeof fetch)).status).toBe('verified');
    expect(mock).toHaveBeenCalledTimes(1);
  });
  it('reads stacked allowances on E and retries with the old projection only for missing columns', async () => {
    const options = { includeGrantedCredits: true };
    const upgraded = vi.fn(async (url: string) => {
      expect(new URL(url).searchParams.get('select')).toContain('granted_credits');
      return Response.json([{ ...row, granted_credits: 6 }]);
    });
    expect(await readVerifiedPaidSession(env, 'u1', sid, upgraded, options)).toMatchObject({ status: 'verified', session: { grantedCredits: 6 } });
    const preE = vi.fn(async (url: string) => {
      const search = new URL(url).searchParams;
      expect(search.get('id')).toBe('eq.' + sid);
      expect(search.get('firebase_uid')).toBe('eq.u1');
      return search.get('select')?.includes('granted_credits')
        ? Response.json({ code: '42703' }, { status: 400 }) : Response.json([row]);
    });
    const result = await readVerifiedPaidSession(env, 'u1', sid, preE, options);
    expect(result.status).toBe('verified');
    expect(result.status === 'verified' && result.session).not.toHaveProperty('grantedCredits');
    expect(preE).toHaveBeenCalledTimes(2);
    const denied = vi.fn(async () => Response.json({ code: '42501' }, { status: 403 }));
    expect(await readVerifiedPaidSession(env, 'u1', sid, denied, options)).toEqual({ status: 'unavailable' });
    expect(denied).toHaveBeenCalledTimes(1);
  });
  it('denies revoked, expired, future-issued and unauthorized paid sessions', async () => {
    const fetcher = (value: unknown) => vi.fn(async () => Response.json([value]));
    const invalid = [
      { ...row, revoked_at: '2026-02-01T00:00:00Z' },
      { ...row, expires_at: '2026-02-01T00:00:00Z' },
      { ...row, issued_at: '2999-01-01T00:00:00Z' },
      { ...row, tier: 'Administrator' },
      { ...row, id: '22222222-2222-4222-8222-222222222222' },
    ];
    for (const candidate of invalid) {
      expect((await readVerifiedPaidSession(env, 'u1', sid, fetcher(candidate) as typeof fetch)).status).toBe('denied');
    }
  });
  it('fails closed on forged row, missing row, HTTP error and network failure', async () => {
    const fetcher = (value: unknown) => vi.fn(async () => Response.json(value));
    expect((await readVerifiedPaidSession(env, 'u1', sid, fetcher([{ ...row, firebase_uid: 'u2' }]) as typeof fetch)).status).toBe('denied');
    expect((await readVerifiedPaidSession(env, 'u1', sid, fetcher([]) as typeof fetch)).status).toBe('denied');
    expect((await readVerifiedPaidSession(env, 'u1', sid, vi.fn(async () => new Response('', { status: 503 })) as typeof fetch)).status).toBe('unavailable');
    expect((await readVerifiedPaidSession(env, 'u1', sid, vi.fn(async () => { throw new Error('network'); }) as typeof fetch)).status).toBe('unavailable');
  });
});
