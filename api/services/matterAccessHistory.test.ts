import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as events from './matterAccessEvents.js';
import * as accounts from './accounts.js';
import { LifecycleError } from './lifecycleErrors.js';
import {
  decodeHistoryCursor, encodeHistoryCursor, getMatterAccessHistory,
  HISTORY_NOTICE, MAX_HISTORY_PAGE_SIZE,
} from './matterAccessHistory.js';

vi.mock('./matterAccessEvents.js', async importOriginal => ({ ...(await importOriginal<any>()), listMatterAccessEvents: vi.fn() }));
vi.mock('./accounts.js');

const MATTER = '21000000-0000-4000-8000-00000000000a';
const OTHER = '21000000-0000-4000-8000-00000000000b';
const ME = '11000000-0000-4000-8000-000000000003';
const OWNER = '11000000-0000-4000-8000-000000000001';

const ev = (seq: number, over: Partial<events.MatterAccessEvent> = {}): events.MatterAccessEvent => ({
  id: `40000000-0000-4000-8000-${String(seq).padStart(12, '0')}`, sequence: seq, eventType: 'GRANT_CREATED',
  occurredAt: '2026-09-24T12:00:00.000Z', actorKind: 'ACCOUNT', actorAccountId: OWNER, actorMatterRole: 'OWNER',
  subjectAccountId: null, grantId: null, outcome: 'SUCCEEDED', reasonCode: null, ...over,
});

const list = vi.mocked(events.listMatterAccessEvents);
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(accounts.findAccount).mockResolvedValue({ id: ME, primaryRole: 'lawyer', status: 'active' });
});

describe('history cursor', () => {
  it('round-trips and is opaque', () => {
    const c = encodeHistoryCursor(MATTER, 42);
    expect(c.startsWith('h1.')).toBe(true);
    expect(c).not.toContain(MATTER);
    expect(decodeHistoryCursor(c, MATTER)).toBe(42);
  });

  it('is bound to its matter', () => {
    expect(() => decodeHistoryCursor(encodeHistoryCursor(MATTER, 3), OTHER)).toThrow(LifecycleError);
  });

  it.each([[undefined], [null], [42], [{}], [''], ['h1.'], ['h1.@@'], [`h1.${'A'.repeat(250)}`]])('rejects %j', bad => {
    expect(() => decodeHistoryCursor(bad, MATTER)).toThrow(/cursor is not valid/);
  });
});

describe('getMatterAccessHistory', () => {
  it('requests one extra row, trims to the page size and issues a cursor only when more exist', async () => {
    list.mockResolvedValue({ matterId: MATTER, scope: 'MATTER', events: [ev(1), ev(2), ev(3)], nextAfterSequence: null });
    const page = await getMatterAccessHistory('uid', MATTER.toUpperCase(), { pageSize: 2 });
    expect(list).toHaveBeenCalledWith('uid', MATTER, { afterSequence: 0, limit: 3 });
    expect(page.entries.map(e => e.sequence)).toEqual([1, 2]);
    expect(decodeHistoryCursor(page.nextCursor, MATTER)).toBe(2);
    expect(page).toMatchObject({ matterId: MATTER, basis: 'HISTORICAL_EVENTS', notice: HISTORY_NOTICE, scope: 'MATTER', pageSize: 2 });
  });

  it('no cursor on the last page', async () => {
    list.mockResolvedValue({ matterId: MATTER, scope: 'SELF', events: [ev(1), ev(2)], nextAfterSequence: null });
    expect((await getMatterAccessHistory('uid', MATTER, { pageSize: 2 })).nextCursor).toBeNull();
  });

  it('continues from the cursor\'s sequence', async () => {
    list.mockResolvedValue({ matterId: MATTER, scope: 'MATTER', events: [], nextAfterSequence: null });
    await getMatterAccessHistory('uid', MATTER, { cursor: encodeHistoryCursor(MATTER, 17) });
    expect(list).toHaveBeenCalledWith('uid', MATTER, { afterSequence: 17, limit: 26 });
  });

  it('labels every event type and outcome with a fixed past-tense summary that never claims current access', async () => {
    const all = events.MATTER_ACCESS_EVENT_TYPES.flatMap((t, i) => (['SUCCEEDED', 'REFUSED'] as const).map((o, j) =>
      ev(i * 2 + j + 1, { eventType: t, outcome: o, reasonCode: o === 'REFUSED' ? 'X' : null })));
    list.mockResolvedValue({ matterId: MATTER, scope: 'MATTER', events: all, nextAfterSequence: null });
    const page = await getMatterAccessHistory('uid', MATTER, { pageSize: 100 });
    const summaries = page.entries.map(e => e.summary);
    expect(new Set(summaries).size).toBe(summaries.length);
    for (const s of summaries) {
      expect(s).not.toMatch(/\b(has|have|currently|now)\b/i);
      expect(s.length).toBeGreaterThan(0);
    }
    for (const e of page.entries.filter(x => x.outcome === 'REFUSED')) expect(e.summary).toMatch(/refused/);
  });

  it('marks the requester as "you" using the verified account only for labelling', async () => {
    list.mockResolvedValue({ matterId: MATTER, scope: 'SELF', events: [
      ev(1, { eventType: 'GRANT_ACCEPTED', actorAccountId: ME, actorMatterRole: 'REVIEWER', subjectAccountId: ME }),
      ev(2, { eventType: 'GRANT_REVOKED', subjectAccountId: ME }),
    ], nextAfterSequence: null });
    const page = await getMatterAccessHistory('uid', MATTER);
    expect(page.entries[0].actor.isRequester).toBe(true);
    expect(page.entries[0].subject).toEqual({ accountId: ME, isRequester: true });
    expect(page.entries[1].actor.isRequester).toBe(false);
  });

  it('authorization failures propagate unchanged and nothing is returned', async () => {
    list.mockRejectedValue(new LifecycleError(403, 'FORBIDDEN', 'no'));
    await expect(getMatterAccessHistory('uid', MATTER)).rejects.toMatchObject({ statusCode: 403 });
    expect(accounts.findAccount).not.toHaveBeenCalled();
  });

  it('fails closed on database errors from either call', async () => {
    list.mockRejectedValue(new Error('Access event log is unavailable.'));
    await expect(getMatterAccessHistory('uid', MATTER)).rejects.toThrow(/unavailable/);
    list.mockResolvedValue({ matterId: MATTER, scope: 'MATTER', events: [ev(1)], nextAfterSequence: null });
    vi.mocked(accounts.findAccount).mockRejectedValue(new Error('Account lookup failed.'));
    await expect(getMatterAccessHistory('uid', MATTER)).rejects.toThrow(/Account lookup failed/);
  });

  it.each([[0], [MAX_HISTORY_PAGE_SIZE + 1], [-3], [2.5]])('rejects page size %s before any database call', async size => {
    await expect(getMatterAccessHistory('uid', MATTER, { pageSize: size })).rejects.toMatchObject({ statusCode: 400 });
    expect(list).not.toHaveBeenCalled();
  });

  it('rejects a malformed matter id and a foreign cursor before any database call', async () => {
    await expect(getMatterAccessHistory('uid', 'nope')).rejects.toMatchObject({ statusCode: 400 });
    await expect(getMatterAccessHistory('uid', MATTER, { cursor: encodeHistoryCursor(OTHER, 1) })).rejects.toMatchObject({ code: 'INVALID_CURSOR' });
    expect(list).not.toHaveBeenCalled();
  });
});
