import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as access from './access.js';
import { LifecycleError } from './lifecycleErrors.js';
import { listMatterAccessEvents, recordMatterAccessEvent, MATTER_ACCESS_EVENT_TYPES } from './matterAccessEvents.js';

vi.mock('./access.js');

const MATTER = '20000000-0000-4000-8000-00000000000a';
const OWNER = '10000000-0000-4000-8000-000000000001';
const GRANT = '30000000-0000-4000-8000-0000000000a1';

let rpc: ReturnType<typeof vi.fn>;
beforeEach(() => {
  rpc = vi.fn();
  vi.mocked(access.getSupabase).mockReturnValue({ rpc } as any);
});

const event = (over: Record<string, unknown> = {}) => ({
  id: '40000000-0000-4000-8000-000000000001', event_sequence: 1, event_type: 'GRANT_CREATED',
  occurred_at: '2026-09-24T12:00:00.000Z', actor_kind: 'ACCOUNT', actor_account_id: OWNER, actor_matter_role: 'OWNER',
  subject_account_id: null, grant_id: GRANT, outcome: 'SUCCEEDED', reason_code: null, ...over,
});

describe('recordMatterAccessEvent -- input validation happens before any database call', () => {
  const ok = { actorFirebaseUid: 'uid-owner', matterId: MATTER, eventType: 'GRANT_CREATED' as const, outcome: 'SUCCEEDED' as const, grantId: GRANT };

  it('sends only the declared, canonicalized fields and never an actor id, role or timestamp', async () => {
    rpc.mockResolvedValue({ data: '40000000-0000-4000-8000-000000000009', error: null });
    await recordMatterAccessEvent({ ...ok, matterId: MATTER.toUpperCase(), grantId: GRANT.toUpperCase(),
      ...({ actorAccountId: 'forged', actorMatterRole: 'OWNER', occurredAt: '2000-01-01' } as any) });
    expect(rpc).toHaveBeenCalledWith('record_matter_access_event', {
      p_actor_firebase_uid: 'uid-owner', p_matter_id: MATTER, p_event_type: 'GRANT_CREATED', p_outcome: 'SUCCEEDED',
      p_subject_account_id: null, p_grant_id: GRANT, p_reason_code: null, p_idempotency_key: null,
    });
  });

  it.each([
    ['unknown event type', { eventType: 'GRANT_DESTROYED' }],
    ['lower-case event type', { eventType: 'grant_created' }],
    ['unknown outcome', { outcome: 'MAYBE' }],
    ['empty actor uid', { actorFirebaseUid: '  ' }],
    ['system actor for a non-expiry event', { actorFirebaseUid: null }],
    ['malformed matter id', { matterId: 'not-a-uuid' }],
    ['malformed grant id', { grantId: 'x' }],
    ['malformed subject id', { subjectAccountId: '123' }],
    ['free-text reason', { reasonCode: 'Owner said the child is at risk' }],
    ['refusal without reason', { outcome: 'REFUSED' }],
    ['bad idempotency key', { idempotencyKey: 'short' }],
  ])('rejects %s', async (_label, over) => {
    await expect(recordMatterAccessEvent({ ...ok, ...(over as any) })).rejects.toBeInstanceOf(LifecycleError);
    expect(rpc).not.toHaveBeenCalled();
  });

  it('allows a system-observed GRANT_EXPIRED', async () => {
    rpc.mockResolvedValue({ data: '40000000-0000-4000-8000-000000000009', error: null });
    await expect(recordMatterAccessEvent({ ...ok, actorFirebaseUid: null, eventType: 'GRANT_EXPIRED' })).resolves.toEqual({ eventId: '40000000-0000-4000-8000-000000000009' });
  });

  it.each([
    [{ data: null, error: { message: 'MATTER_NOT_FOUND' } }, /not recorded \(MATTER_NOT_FOUND\)/],
    [{ data: null, error: { message: 'relation "x" does not exist' } }, /^Access event was not recorded\.$/],
    [{ data: null, error: null }, /not recorded/],
    [{ data: 'not-a-uuid', error: null }, /not recorded/],
  ])('fails closed on database error or unexpected response %#', async (response, msg) => {
    rpc.mockResolvedValue(response);
    await expect(recordMatterAccessEvent(ok)).rejects.toThrow(msg);
  });
});

describe('listMatterAccessEvents -- fail-closed response handling', () => {
  it('maps a valid page to camelCase and canonicalizes the matter id', async () => {
    rpc.mockResolvedValue({ data: { scope: 'MATTER', events: [event(), event({ id: '40000000-0000-4000-8000-000000000002', event_sequence: 5 })] }, error: null });
    const page = await listMatterAccessEvents('uid-owner', MATTER.toUpperCase(), { limit: 2 });
    expect(rpc).toHaveBeenCalledWith('list_matter_access_events', { p_firebase_uid: 'uid-owner', p_matter_id: MATTER, p_after_sequence: 0, p_limit: 2 });
    expect(page).toMatchObject({ matterId: MATTER, scope: 'MATTER', nextAfterSequence: 5 });
    expect(page.events[0]).toEqual({ id: '40000000-0000-4000-8000-000000000001', sequence: 1, eventType: 'GRANT_CREATED',
      occurredAt: '2026-09-24T12:00:00.000Z', actorKind: 'ACCOUNT', actorAccountId: OWNER, actorMatterRole: 'OWNER',
      subjectAccountId: null, grantId: GRANT, outcome: 'SUCCEEDED', reasonCode: null });
  });

  it('nextAfterSequence is null when the page is not full', async () => {
    rpc.mockResolvedValue({ data: { scope: 'SELF', events: [event()] }, error: null });
    expect((await listMatterAccessEvents('uid-owner', MATTER, { limit: 10 })).nextAfterSequence).toBeNull();
  });

  it.each([
    ['NOT_AUTHORIZED', { statusCode: 403, code: 'FORBIDDEN' }],
    ['INVALID_REQUEST', { statusCode: 400, code: 'INVALID_REQUEST' }],
  ])('maps %s', async (msg, expected) => {
    rpc.mockResolvedValue({ data: null, error: { message: msg } });
    await expect(listMatterAccessEvents('uid-owner', MATTER)).rejects.toMatchObject(expected);
  });

  it.each([
    ['unknown scope', { scope: 'EVERYTHING', events: [] }],
    ['events not an array', { scope: 'MATTER', events: {} }],
    ['unknown event type', { scope: 'MATTER', events: [event({ event_type: 'GRANT_DESTROYED' })] }],
    ['unknown outcome', { scope: 'MATTER', events: [event({ outcome: 'MAYBE' })] }],
    ['system actor with an account id', { scope: 'MATTER', events: [event({ actor_kind: 'SYSTEM' })] }],
    ['account actor without an id', { scope: 'MATTER', events: [event({ actor_account_id: null })] }],
    ['non-uuid subject', { scope: 'MATTER', events: [event({ subject_account_id: 'x' })] }],
    ['free-text reason', { scope: 'MATTER', events: [event({ reason_code: 'some text' })] }],
    ['out-of-order sequence', { scope: 'MATTER', events: [event({ event_sequence: 5 }), event({ event_sequence: 3 })] }],
    ['sequence not after the cursor', { scope: 'MATTER', events: [event({ event_sequence: 1 })] }, { afterSequence: 1 }],
    ['more events than requested', { scope: 'MATTER', events: [event(), event({ event_sequence: 2 })] }, { limit: 1 }],
    ['no data', null],
  ])('fails closed on %s', async (_label, data, opts?: any) => {
    rpc.mockResolvedValue({ data, error: null });
    await expect(listMatterAccessEvents('uid-owner', MATTER, opts)).rejects.toThrow(/unrecognized|unavailable/);
  });

  it.each([
    [{ afterSequence: -1 }], [{ afterSequence: 1.5 }], [{ limit: 0 }], [{ limit: 201 }],
  ])('rejects bad paging %j before any database call', async opts => {
    await expect(listMatterAccessEvents('uid-owner', MATTER, opts)).rejects.toMatchObject({ statusCode: 400 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects a malformed matter id before any database call', async () => {
    await expect(listMatterAccessEvents('uid-owner', 'nope')).rejects.toMatchObject({ statusCode: 400 });
    expect(rpc).not.toHaveBeenCalled();
  });

  it('keeps the event catalog identical to the migration CHECK constraint', async () => {
    const fs = await import('fs');
    const sql = fs.readFileSync(new URL('../../supabase/migrations_pending_approval/create_navigator_matter_access_event_log.sql', import.meta.url), 'utf8');
    const check = /event_type text not null check \(event_type in \(([\s\S]*?)\)\)/.exec(sql)![1];
    expect(check.match(/'([A-Z_]+)'/g)!.map(s => s.slice(1, -1))).toEqual([...MATTER_ACCESS_EVENT_TYPES]);
  });
});
