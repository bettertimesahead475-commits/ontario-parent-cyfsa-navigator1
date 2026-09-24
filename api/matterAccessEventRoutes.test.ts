import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import * as access from './services/access.js';

vi.mock('./services/access.js');
vi.mock('./services/firebaseAdmin.js', () => ({
  verifyFirebaseToken: vi.fn(async (header: string | undefined) => {
    const match = header ? /^Bearer (.+)$/.exec(header) : null;
    return match && ['uid-owner', 'uid-reviewer'].includes(match[1]) ? { uid: match[1], email: null } : null;
  }),
}));

import { registerMatterAccessEventRoutes } from './matterAccessEventRoutes.js';

const MATTER = '20000000-0000-4000-8000-00000000000a';
let rpc: ReturnType<typeof vi.fn>;

function app() {
  const a = express();
  a.use(express.json());
  registerMatterAccessEventRoutes(a);
  return a;
}

beforeEach(() => {
  rpc = vi.fn(async (_fn: string, args: any) => {
    if (args.p_firebase_uid === 'uid-owner') return { data: { scope: 'MATTER', events: [] }, error: null };
    return { data: null, error: { message: 'NOT_AUTHORIZED' } };
  });
  vi.mocked(access.getSupabase).mockReturnValue({ rpc } as any);
});

describe('Stage 10 -- GET /api/matters/:matterId/access-events', () => {
  it('requires authentication and never trusts identity from query or body', async () => {
    const res = await request(app()).get(`/api/matters/${MATTER}/access-events?uid=uid-owner`).set('Authorization', 'Bearer forged').send({ uid: 'uid-owner' });
    expect(res.status).toBe(401);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(rpc).not.toHaveBeenCalled();
  });

  it('passes only the verified uid, canonical matter id and parsed paging to the database', async () => {
    const res = await request(app()).get(`/api/matters/${MATTER.toUpperCase()}/access-events?after=7&limit=25&uid=uid-reviewer`).set('Authorization', 'Bearer uid-owner');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ matterId: MATTER, scope: 'MATTER', events: [], nextAfterSequence: null });
    expect(rpc).toHaveBeenCalledWith('list_matter_access_events', { p_firebase_uid: 'uid-owner', p_matter_id: MATTER, p_after_sequence: 7, p_limit: 25 });
  });

  it('returns 403 when the database refuses the reader', async () => {
    const res = await request(app()).get(`/api/matters/${MATTER}/access-events`).set('Authorization', 'Bearer uid-reviewer');
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('FORBIDDEN');
  });

  it.each([['after=-1'], ['after=abc'], ['limit=1.5'], ['limit=0'], ['limit=500'], ['after=1e3']])('rejects bad paging %s with 400', async q => {
    const res = await request(app()).get(`/api/matters/${MATTER}/access-events?${q}`).set('Authorization', 'Bearer uid-owner');
    expect(res.status).toBe(400);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects a malformed matter id with 400', async () => {
    const res = await request(app()).get('/api/matters/not-a-uuid/access-events').set('Authorization', 'Bearer uid-owner');
    expect(res.status).toBe(400);
  });

  it('fails closed with a generic 503 that leaks no database text', async () => {
    rpc.mockResolvedValue({ data: null, error: { message: 'relation "navigator_matter_access_events" does not exist' } });
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app()).get(`/api/matters/${MATTER}/access-events`).set('Authorization', 'Bearer uid-owner');
    spy.mockRestore();
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ code: 'ACCESS_EVENTS_UNAVAILABLE', error: 'Access history is unavailable.' });
  });

  it('exposes no write method: events can only be recorded by trusted server paths', async () => {
    for (const method of ['post', 'put', 'patch', 'delete'] as const) {
      const res = await request(app())[method](`/api/matters/${MATTER}/access-events`).set('Authorization', 'Bearer uid-owner').send({ event_type: 'GRANT_CREATED' });
      expect(res.status).toBe(404);
    }
    expect(rpc).not.toHaveBeenCalled();
  });
});
