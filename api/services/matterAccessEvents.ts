// Stage 10: append-only matter ACCESS event log -- server service.
//
// Backed by supabase/migrations_pending_approval/create_navigator_matter_access_event_log.sql.
// This is the HISTORICAL trail. It is deliberately separate from matterAccessAudit.ts, which
// reconstructs the CURRENT access state and its integrity from live grant/membership rows.
//
// Trust boundary: both operations go through SECURITY DEFINER RPCs. The database derives the
// actor account, the actor's matter role and the timestamp itself; this module never sends
// them, and nothing here accepts them from a request. recordMatterAccessEvent is server-internal
// (no route calls it): the only acceptable actorFirebaseUid is one obtained from
// verifyFirebaseToken() in the same request, or null for a system-observed grant expiry.
//
// Privacy: events carry identifiers and fixed vocabularies only. There is no free-text field.

import { getSupabase } from './access.js';
import { LifecycleError, requireUuid } from './lifecycleErrors.js';

export const MATTER_ACCESS_EVENT_TYPES = [
  'GRANT_CREATED',
  'GRANT_ACCEPTED',
  'GRANT_EXPIRED',
  'GRANT_REVOKED',
  'REVIEWER_ACCESS_ADDED',
  'REVIEWER_ACCESS_REMOVED',
  'ACCESS_AUDIT_VIEWED',
] as const;
export type MatterAccessEventType = (typeof MATTER_ACCESS_EVENT_TYPES)[number];

export const MATTER_ACCESS_EVENT_OUTCOMES = ['SUCCEEDED', 'REFUSED'] as const;
export type MatterAccessEventOutcome = (typeof MATTER_ACCESS_EVENT_OUTCOMES)[number];

export type ActorKind = 'ACCOUNT' | 'SYSTEM';
export type ActorMatterRole = 'OWNER' | 'REVIEWER' | 'NONE' | 'SYSTEM';
export type EventReadScope = 'MATTER' | 'SELF';

export interface MatterAccessEvent {
  id: string;
  sequence: number;
  eventType: MatterAccessEventType;
  occurredAt: string;
  actorKind: ActorKind;
  actorAccountId: string | null;
  actorMatterRole: ActorMatterRole;
  subjectAccountId: string | null;
  grantId: string | null;
  outcome: MatterAccessEventOutcome;
  reasonCode: string | null;
}

export interface MatterAccessEventPage {
  matterId: string;
  scope: EventReadScope;
  events: MatterAccessEvent[];
  nextAfterSequence: number | null;
}

export const MAX_EVENT_PAGE_SIZE = 200;
const REASON_CODE = /^[A-Z][A-Z0-9_]{0,63}$/;
const IDEMPOTENCY_KEY = /^[A-Za-z0-9._:-]{8,128}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const invalid = (message: string) => new LifecycleError(400, 'INVALID_REQUEST', message);
const isOneOf = <T extends string>(values: readonly T[], v: unknown): v is T =>
  typeof v === 'string' && (values as readonly string[]).includes(v);

export interface RecordMatterAccessEventInput {
  actorFirebaseUid: string | null;
  matterId: string;
  eventType: MatterAccessEventType;
  outcome: MatterAccessEventOutcome;
  subjectAccountId?: string | null;
  grantId?: string | null;
  reasonCode?: string | null;
  idempotencyKey?: string | null;
}

/**
 * Server-internal recorder. Validates the event shape before touching the database and fails
 * closed: any database error or unexpected response throws, so a caller that must not proceed
 * without an audit record can rely on the exception.
 */
export async function recordMatterAccessEvent(input: RecordMatterAccessEventInput): Promise<{ eventId: string }> {
  if (!isOneOf(MATTER_ACCESS_EVENT_TYPES, input.eventType)) throw invalid('eventType is not a recognized access event type.');
  if (!isOneOf(MATTER_ACCESS_EVENT_OUTCOMES, input.outcome)) throw invalid('outcome must be SUCCEEDED or REFUSED.');
  if (input.actorFirebaseUid !== null && (typeof input.actorFirebaseUid !== 'string' || !input.actorFirebaseUid.trim())) {
    throw invalid('actorFirebaseUid must be a verified uid or null for a system event.');
  }
  if (input.actorFirebaseUid === null && input.eventType !== 'GRANT_EXPIRED') {
    throw invalid('Only GRANT_EXPIRED may be recorded without an acting account.');
  }
  const opt = (v: string | null | undefined, field: string) => (v == null ? null : requireUuid(v, field).toLowerCase());
  const matterId = requireUuid(input.matterId, 'matterId').toLowerCase();
  const subjectAccountId = opt(input.subjectAccountId, 'subjectAccountId');
  const grantId = opt(input.grantId, 'grantId');
  const reasonCode = input.reasonCode ?? null;
  if (reasonCode !== null && (typeof reasonCode !== 'string' || !REASON_CODE.test(reasonCode))) {
    throw invalid('reasonCode must be an UPPER_SNAKE code, not free text.');
  }
  if (input.outcome === 'REFUSED' && reasonCode === null) throw invalid('A REFUSED event requires a reasonCode.');
  const idempotencyKey = input.idempotencyKey ?? null;
  if (idempotencyKey !== null && (typeof idempotencyKey !== 'string' || !IDEMPOTENCY_KEY.test(idempotencyKey))) {
    throw invalid('idempotencyKey must be 8-128 characters of [A-Za-z0-9._:-].');
  }

  const { data, error } = await getSupabase().rpc('record_matter_access_event', {
    p_actor_firebase_uid: input.actorFirebaseUid,
    p_matter_id: matterId,
    p_event_type: input.eventType,
    p_outcome: input.outcome,
    p_subject_account_id: subjectAccountId,
    p_grant_id: grantId,
    p_reason_code: reasonCode,
    p_idempotency_key: idempotencyKey,
  });
  if (error) {
    const message = String(error.message || '');
    const known = ['MATTER_NOT_FOUND', 'ACTOR_NOT_FOUND', 'SUBJECT_NOT_FOUND', 'GRANT_NOT_IN_MATTER', 'IDEMPOTENCY_CONFLICT',
      'INVALID_EVENT_TYPE', 'INVALID_OUTCOME'].find(code => message.includes(code));
    throw new Error(`Access event was not recorded${known ? ` (${known})` : ''}.`);
  }
  if (typeof data !== 'string' || !UUID.test(data)) throw new Error('Access event was not recorded.');
  return { eventId: data };
}

function toEvent(row: any): MatterAccessEvent {
  const nullableUuid = (v: unknown) => (v === null ? null : typeof v === 'string' && UUID.test(v) ? v : undefined);
  const e: MatterAccessEvent = {
    id: row?.id,
    sequence: row?.event_sequence,
    eventType: row?.event_type,
    occurredAt: row?.occurred_at,
    actorKind: row?.actor_kind,
    actorAccountId: nullableUuid(row?.actor_account_id) as any,
    actorMatterRole: row?.actor_matter_role,
    subjectAccountId: nullableUuid(row?.subject_account_id) as any,
    grantId: nullableUuid(row?.grant_id) as any,
    outcome: row?.outcome,
    reasonCode: row?.reason_code ?? null,
  };
  const valid =
    typeof e.id === 'string' && UUID.test(e.id) &&
    Number.isSafeInteger(e.sequence) && e.sequence > 0 &&
    isOneOf(MATTER_ACCESS_EVENT_TYPES, e.eventType) &&
    typeof e.occurredAt === 'string' && Number.isFinite(Date.parse(e.occurredAt)) &&
    isOneOf(['ACCOUNT', 'SYSTEM'] as const, e.actorKind) &&
    isOneOf(['OWNER', 'REVIEWER', 'NONE', 'SYSTEM'] as const, e.actorMatterRole) &&
    e.actorAccountId !== undefined && e.subjectAccountId !== undefined && e.grantId !== undefined &&
    (e.actorKind === 'SYSTEM') === (e.actorAccountId === null) &&
    isOneOf(MATTER_ACCESS_EVENT_OUTCOMES, e.outcome) &&
    (e.reasonCode === null || (typeof e.reasonCode === 'string' && REASON_CODE.test(e.reasonCode)));
  if (!valid) throw new Error('Access event log returned an unrecognized event.');
  return e;
}

/**
 * Least-privilege read. Authorization is decided inside the database (OWNER: whole matter;
 * REVIEWER: only its own events; anyone else -- including a revoked professional, a suspended
 * account or a nonexistent matter -- gets the same 403).
 */
export async function listMatterAccessEvents(
  firebaseUid: string,
  matterId: string,
  options?: { afterSequence?: number; limit?: number },
): Promise<MatterAccessEventPage> {
  const canonicalMatterId = requireUuid(matterId, 'matterId').toLowerCase();
  const afterSequence = options?.afterSequence ?? 0;
  const limit = options?.limit ?? 100;
  if (!Number.isSafeInteger(afterSequence) || afterSequence < 0) throw invalid('after must be a non-negative integer.');
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_EVENT_PAGE_SIZE) {
    throw invalid(`limit must be an integer from 1 to ${MAX_EVENT_PAGE_SIZE}.`);
  }

  const { data, error } = await getSupabase().rpc('list_matter_access_events', {
    p_firebase_uid: firebaseUid,
    p_matter_id: canonicalMatterId,
    p_after_sequence: afterSequence,
    p_limit: limit,
  });
  if (error) {
    const message = String(error.message || '');
    if (message.includes('NOT_AUTHORIZED')) {
      throw new LifecycleError(403, 'FORBIDDEN', 'You are not authorized to view this matter\'s access history.');
    }
    if (message.includes('INVALID_REQUEST')) throw invalid('Invalid paging parameters.');
    throw new Error('Access event log is unavailable.');
  }
  if (!data || !isOneOf(['MATTER', 'SELF'] as const, data.scope) || !Array.isArray(data.events) || data.events.length > limit) {
    throw new Error('Access event log returned an unrecognized response.');
  }
  const events = data.events.map(toEvent);
  for (let i = 1; i < events.length; i++) {
    if (events[i].sequence <= events[i - 1].sequence) throw new Error('Access event log returned an unrecognized response.');
  }
  if (events.length && events[0].sequence <= afterSequence) throw new Error('Access event log returned an unrecognized response.');
  return {
    matterId: canonicalMatterId,
    scope: data.scope,
    events,
    nextAfterSequence: events.length === limit ? events[events.length - 1].sequence : null,
  };
}
