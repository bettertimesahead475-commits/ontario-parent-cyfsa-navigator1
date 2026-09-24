// Stage 10 slice 3: application-facing ACCESS HISTORY read model.
//
// Built on the slice 2 append-only event log (matterAccessEvents.ts), unchanged. Authorization
// happens inside list_matter_access_events BEFORE any row leaves the database: OWNER sees the
// matter's history, REVIEWER sees only events it performed or that concern it, everyone else
// (revoked, suspended, unrelated, unknown account, unknown matter) gets the same 403. This module
// never filters records for security; it only shapes what the database already authorized.
//
// HISTORY IS NOT CURRENT STATE. Every page carries basis 'HISTORICAL_EVENTS' and a notice. The
// current-state answer ("who can open this matter now") belongs to matterAccessAudit.ts (slice 1).
//
// Cursor: opaque 'h1.<base64url(JSON {m, s})>' binding the matter id and the last event_sequence
// seen. It confers no authority and caches no authorization -- every page request is
// re-authorized by the database -- so it needs no signature: a tampered sequence can only select
// a different slice of events the caller is already allowed to read. A cursor for another matter,
// or one that is malformed, is rejected before any database call.

import { LifecycleError, requireUuid } from './lifecycleErrors.js';
import { findAccount } from './accounts.js';
import {
  listMatterAccessEvents,
  MAX_EVENT_PAGE_SIZE,
  type ActorMatterRole,
  type EventReadScope,
  type MatterAccessEvent,
  type MatterAccessEventOutcome,
  type MatterAccessEventType,
} from './matterAccessEvents.js';

export const DEFAULT_HISTORY_PAGE_SIZE = 25;
export const MAX_HISTORY_PAGE_SIZE = 100;
// One extra row is requested to learn whether another page exists without a second query.
if (MAX_HISTORY_PAGE_SIZE + 1 > MAX_EVENT_PAGE_SIZE) throw new Error('History page size exceeds the event log page bound.');

export const HISTORY_NOTICE =
  'This is a record of past access events. It does not show who can open this matter now; the current access report answers that.';

const CURSOR_PREFIX = 'h1.';
const MAX_CURSOR_LENGTH = 200;

const SUMMARIES: Record<MatterAccessEventType, Record<MatterAccessEventOutcome, string>> = {
  GRANT_CREATED: { SUCCEEDED: 'Access invitation created', REFUSED: 'Attempt to create an access invitation was refused' },
  GRANT_ACCEPTED: { SUCCEEDED: 'Access invitation accepted', REFUSED: 'Attempt to accept an access invitation was refused' },
  GRANT_EXPIRED: { SUCCEEDED: 'Access invitation expired before it was accepted', REFUSED: 'Attempt to use an expired access invitation was refused' },
  GRANT_REVOKED: { SUCCEEDED: 'Access invitation revoked', REFUSED: 'Attempt to revoke an access invitation was refused' },
  REVIEWER_ACCESS_ADDED: { SUCCEEDED: 'Reviewer access added', REFUSED: 'Attempt to add reviewer access was refused' },
  REVIEWER_ACCESS_REMOVED: { SUCCEEDED: 'Reviewer access removed', REFUSED: 'Attempt to remove reviewer access was refused' },
  ACCESS_AUDIT_VIEWED: { SUCCEEDED: 'Access report viewed', REFUSED: 'Attempt to view the access report was refused' },
};

export interface AccessHistoryEntry {
  id: string;
  sequence: number;
  occurredAt: string;
  eventType: MatterAccessEventType;
  outcome: MatterAccessEventOutcome;
  reasonCode: string | null;
  summary: string;
  actor: { kind: 'ACCOUNT' | 'SYSTEM'; accountId: string | null; roleAtEvent: ActorMatterRole; isRequester: boolean };
  subject: { accountId: string; isRequester: boolean } | null;
  grantId: string | null;
}

export interface AccessHistoryPage {
  matterId: string;
  basis: 'HISTORICAL_EVENTS';
  notice: string;
  scope: EventReadScope;
  pageSize: number;
  entries: AccessHistoryEntry[];
  nextCursor: string | null;
}

const invalidCursor = () => new LifecycleError(400, 'INVALID_CURSOR', 'The history cursor is not valid for this matter.');

export function encodeHistoryCursor(matterId: string, afterSequence: number): string {
  const payload = Buffer.from(JSON.stringify({ m: matterId, s: afterSequence }), 'utf8').toString('base64url');
  return `${CURSOR_PREFIX}${payload}`;
}

/** Returns the last-seen event_sequence, or throws INVALID_CURSOR. Never touches the database. */
export function decodeHistoryCursor(cursor: unknown, canonicalMatterId: string): number {
  if (typeof cursor !== 'string' || cursor.length > MAX_CURSOR_LENGTH || !cursor.startsWith(CURSOR_PREFIX)) throw invalidCursor();
  const body = cursor.slice(CURSOR_PREFIX.length);
  if (!/^[A-Za-z0-9_-]+$/.test(body)) throw invalidCursor();
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    throw invalidCursor();
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw invalidCursor();
  const keys = Object.keys(parsed).sort();
  if (keys.length !== 2 || keys[0] !== 'm' || keys[1] !== 's') throw invalidCursor();
  const { m, s } = parsed as { m: unknown; s: unknown };
  if (typeof m !== 'string' || m !== canonicalMatterId) throw invalidCursor();
  if (typeof s !== 'number' || !Number.isSafeInteger(s) || s < 1) throw invalidCursor();
  return s;
}

function toEntry(e: MatterAccessEvent, requesterAccountId: string | null): AccessHistoryEntry {
  return {
    id: e.id,
    sequence: e.sequence,
    occurredAt: e.occurredAt,
    eventType: e.eventType,
    outcome: e.outcome,
    reasonCode: e.reasonCode,
    summary: SUMMARIES[e.eventType][e.outcome],
    actor: {
      kind: e.actorKind,
      accountId: e.actorAccountId,
      roleAtEvent: e.actorMatterRole,
      isRequester: requesterAccountId !== null && e.actorAccountId === requesterAccountId,
    },
    subject: e.subjectAccountId === null ? null : {
      accountId: e.subjectAccountId,
      isRequester: requesterAccountId !== null && e.subjectAccountId === requesterAccountId,
    },
    grantId: e.grantId,
  };
}

export async function getMatterAccessHistory(
  firebaseUid: string,
  matterId: string,
  options?: { cursor?: string | null; pageSize?: number },
): Promise<AccessHistoryPage> {
  const canonicalMatterId = requireUuid(matterId, 'matterId').toLowerCase();
  const pageSize = options?.pageSize ?? DEFAULT_HISTORY_PAGE_SIZE;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > MAX_HISTORY_PAGE_SIZE) {
    throw new LifecycleError(400, 'INVALID_REQUEST', `pageSize must be an integer from 1 to ${MAX_HISTORY_PAGE_SIZE}.`);
  }
  const afterSequence = options?.cursor == null ? 0 : decodeHistoryCursor(options.cursor, canonicalMatterId);

  // Authorization (and the matter/visibility filter) happens here, in the database, on every page.
  const page = await listMatterAccessEvents(firebaseUid, canonicalMatterId, { afterSequence, limit: pageSize + 1 });

  // Labelling only ("You"); never used to decide what is shown.
  const requester = await findAccount(firebaseUid);
  const requesterId = requester?.id ?? null;

  const hasMore = page.events.length > pageSize;
  const events = page.events.slice(0, pageSize);
  return {
    matterId: canonicalMatterId,
    basis: 'HISTORICAL_EVENTS',
    notice: HISTORY_NOTICE,
    scope: page.scope,
    pageSize,
    entries: events.map(e => toEntry(e, requesterId)),
    nextCursor: hasMore ? encodeHistoryCursor(canonicalMatterId, events[events.length - 1].sequence) : null,
  };
}
