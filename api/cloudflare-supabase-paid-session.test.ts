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
  it('fails closed on forged row, missing row, HTTP error and network failure', async () => {
    const fetcher = (value: unknown) => vi.fn(async () => Response.json(value));
    expect((await readVerifiedPaidSession(env, 'u1', sid, fetcher([{ ...row, firebase_uid: 'u2' }]) as typeof fetch)).status).toBe('denied');
    expect((await readVerifiedPaidSession(env, 'u1', sid, fetcher([]) as typeof fetch)).status).toBe('denied');
    expect((await readVerifiedPaidSession(env, 'u1', sid, vi.fn(async () => new Response('', { status: 503 })) as typeof fetch)).status).toBe('unavailable');
    expect((await readVerifiedPaidSession(env, 'u1', sid, vi.fn(async () => { throw new Error('network'); }) as typeof fetch)).status).toBe('unavailable');
  });
});
