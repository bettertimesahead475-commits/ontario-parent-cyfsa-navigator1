import { describe, it, expect, vi, beforeEach } from 'vitest';
import express from 'express';
import request from 'supertest';
import * as history from './services/matterAccessHistory.js';
import { LifecycleError } from './services/lifecycleErrors.js';

vi.mock('./services/matterAccessHistory.js', async importOriginal => ({ ...(await importOriginal<any>()), getMatterAccessHistory: vi.fn() }));
vi.mock('./services/firebaseAdmin.js', () => ({
  verifyFirebaseToken: vi.fn(async (header: string | undefined) => {
    const match = header ? /^Bearer (.+)$/.exec(header) : null;
    return match && match[1] === 'uid-owner' ? { uid: 'uid-owner', email: null } : null;
  }),
}));

import { registerMatterAccessHistoryRoutes } from './matterAccessHistoryRoutes.js';

const MATTER = '21000000-0000-4000-8000-00000000000a';
const get = vi.mocked(history.getMatterAccessHistory);
const app = () => { const a = express(); registerMatterAccessHistoryRoutes(a); return a; };

beforeEach(() => {
  vi.clearAllMocks();
  get.mockResolvedValue({ matterId: MATTER, basis: 'HISTORICAL_EVENTS', notice: 'n', scope: 'MATTER', pageSize: 25, entries: [], nextCursor: null });
});

describe('Stage 10 -- GET /api/matters/:matterId/access-history', () => {
  it('requires authentication; identity never comes from query parameters', async () => {
    const res = await request(app()).get(`/api/matters/${MATTER}/access-history?uid=uid-owner`);
    expect(res.status).toBe(401);
    expect(res.headers['cache-control']).toBe('no-store');
    expect(get).not.toHaveBeenCalled();
  });

  it('passes the verified uid, the cursor and the parsed page size', async () => {
    const res = await request(app()).get(`/api/matters/${MATTER}/access-history?cursor=h1.abc&pageSize=10`).set('Authorization', 'Bearer uid-owner');
    expect(res.status).toBe(200);
    expect(get).toHaveBeenCalledWith('uid-owner', MATTER, { cursor: 'h1.abc', pageSize: 10 });
  });

  it.each([['pageSize=abc'], ['pageSize=-1'], ['pageSize=1.5'], ['pageSize=99999'], ['cursor=a&cursor=b']])('rejects %s with 400', async q => {
    const res = await request(app()).get(`/api/matters/${MATTER}/access-history?${q}`).set('Authorization', 'Bearer uid-owner');
    expect(res.status).toBe(400);
    expect(get).not.toHaveBeenCalled();
  });

  it('maps service refusals (403, INVALID_CURSOR) to their status and code', async () => {
    get.mockRejectedValueOnce(new LifecycleError(403, 'FORBIDDEN', 'no'));
    expect((await request(app()).get(`/api/matters/${MATTER}/access-history`).set('Authorization', 'Bearer uid-owner')).status).toBe(403);
    get.mockRejectedValueOnce(new LifecycleError(400, 'INVALID_CURSOR', 'bad'));
    const res = await request(app()).get(`/api/matters/${MATTER}/access-history?cursor=x`).set('Authorization', 'Bearer uid-owner');
    expect(res.body.code).toBe('INVALID_CURSOR');
  });

  it('fails closed with a generic 503 and no internal text', async () => {
    get.mockRejectedValueOnce(new Error('relation "navigator_matter_access_events" does not exist'));
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await request(app()).get(`/api/matters/${MATTER}/access-history`).set('Authorization', 'Bearer uid-owner');
    spy.mockRestore();
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ code: 'ACCESS_HISTORY_UNAVAILABLE', error: 'Access history is unavailable.' });
  });

  it('exposes no write method', async () => {
    for (const m of ['post', 'put', 'patch', 'delete'] as const) {
      expect((await request(app())[m](`/api/matters/${MATTER}/access-history`).set('Authorization', 'Bearer uid-owner')).status).toBe(404);
    }
  });
});
