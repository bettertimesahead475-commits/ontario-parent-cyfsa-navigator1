import React, { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../utils/api';

// Stage 10 slice 3: isolated, read-only ACCESS HISTORY panel.
//
// Not mounted anywhere yet: src/App.tsx is a shared integration surface, and the backing route
// (GET /api/matters/:matterId/access-history) is itself not yet registered in api/_server.ts.
//
// Security: the panel renders exactly what the server returned. Authorization happens on the
// server/database before any record is sent; nothing here filters for security. Raw server
// error text is never shown.
//
// History is not current state: every page carries a notice to that effect, and no entry is
// phrased as "has access" -- only as something that happened at a time.

export interface AccessHistoryEntryDto {
  id: string;
  sequence: number;
  occurredAt: string;
  eventType: string;
  outcome: string;
  reasonCode: string | null;
  summary: string;
  actor: { kind: string; accountId: string | null; roleAtEvent: string; isRequester: boolean };
  subject: { accountId: string; isRequester: boolean } | null;
  grantId: string | null;
}

interface PageDto {
  matterId: string;
  basis: string;
  notice: string;
  scope: string;
  entries: AccessHistoryEntryDto[];
  nextCursor: string | null;
}

type LoadState = 'idle' | 'loading' | 'loaded' | 'forbidden' | 'error';

const KNOWN_EVENT_TYPES = new Set([
  'GRANT_CREATED', 'GRANT_ACCEPTED', 'GRANT_EXPIRED', 'GRANT_REVOKED',
  'REVIEWER_ACCESS_ADDED', 'REVIEWER_ACCESS_REMOVED', 'ACCESS_AUDIT_VIEWED',
]);

const shortId = (id: string) => id.slice(0, 8);

function actorLabel(actor: AccessHistoryEntryDto['actor']): string {
  if (actor.kind === 'SYSTEM') return 'System';
  if (actor.isRequester) return 'You';
  const role =
    actor.roleAtEvent === 'OWNER' ? 'Matter owner'
      : actor.roleAtEvent === 'REVIEWER' ? 'Reviewer'
      : 'An account that was not a member of this matter';
  return actor.accountId ? `${role} (account ${shortId(actor.accountId)})` : role;
}

function subjectLabel(subject: AccessHistoryEntryDto['subject']): string | null {
  if (!subject) return null;
  return subject.isRequester ? 'you' : `account ${shortId(subject.accountId)}`;
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Unknown time';
  // Explicit and unambiguous: date, 24-hour time and zone name.
  return d.toLocaleString('en-CA', {
    year: 'numeric', month: 'long', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false, timeZoneName: 'short',
  });
}

function isValidPage(data: any, matterId: string): data is PageDto {
  return !!data && data.basis === 'HISTORICAL_EVENTS' && data.matterId === matterId.toLowerCase()
    && Array.isArray(data.entries) && (data.nextCursor === null || typeof data.nextCursor === 'string');
}

export default function AccessHistoryPanel({ matterId }: { matterId: string }) {
  const [state, setState] = useState<LoadState>('idle');
  const [entries, setEntries] = useState<AccessHistoryEntryDto[]>([]);
  const [notice, setNotice] = useState<string>('');
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState(false);
  // Stale-response guard: a response is applied only if its generation is still current, which
  // covers both a matter switch mid-request and overlapping requests for the same matter.
  const generation = useRef(0);

  const fetchPage = useCallback(async (cursor: string | null) => {
    const params = new URLSearchParams({ pageSize: '25' });
    if (cursor) params.set('cursor', cursor);
    const res = await apiFetch(`/api/matters/${encodeURIComponent(matterId)}/access-history?${params.toString()}`);
    if (res.status === 403) return { kind: 'forbidden' as const };
    if (!res.ok) return { kind: 'error' as const };
    let data: unknown;
    try {
      data = await res.json();
    } catch {
      return { kind: 'error' as const };
    }
    return isValidPage(data, matterId) ? { kind: 'page' as const, data } : { kind: 'error' as const };
  }, [matterId]);

  useEffect(() => {
    if (!matterId) return;
    const gen = ++generation.current;
    setState('loading');
    setEntries([]);
    setNextCursor(null);
    setMoreError(false);
    fetchPage(null).then(result => {
      if (gen !== generation.current) return;
      if (result.kind === 'page') {
        setEntries(result.data.entries);
        setNotice(result.data.notice);
        setNextCursor(result.data.nextCursor);
        setState('loaded');
      } else {
        setState(result.kind);
      }
    }, () => {
      if (gen === generation.current) setState('error');
    });
  }, [matterId, fetchPage]);

  const loadMore = async () => {
    if (!nextCursor || loadingMore) return;
    const gen = generation.current;
    setLoadingMore(true);
    setMoreError(false);
    try {
      const result = await fetchPage(nextCursor);
      if (gen !== generation.current) return;
      if (result.kind === 'page') {
        setEntries(prev => [...prev, ...result.data.entries]);
        setNextCursor(result.data.nextCursor);
      } else if (result.kind === 'forbidden') {
        // Access can be removed between pages; stop showing history immediately.
        setEntries([]);
        setNextCursor(null);
        setState('forbidden');
      } else {
        setMoreError(true);
      }
    } catch {
      if (gen === generation.current) setMoreError(true);
    } finally {
      if (gen === generation.current) setLoadingMore(false);
    }
  };

  if (!matterId) return null;

  return (
    <section data-testid="access-history-panel" aria-labelledby="access-history-heading" className="space-y-3">
      <h2 id="access-history-heading" className="text-lg font-semibold">Access history</h2>

      {state === 'loading' && (
        <p role="status" aria-live="polite">Loading access history…</p>
      )}

      {state === 'forbidden' && (
        <p role="alert">You do not have access to this matter's access history.</p>
      )}

      {state === 'error' && (
        <p role="alert">Access history is unavailable right now. Please try again later.</p>
      )}

      {state === 'loaded' && (
        <>
          <p className="text-sm">{notice}</p>
          {entries.length === 0 ? (
            <p role="status">No access events have been recorded for this matter.</p>
          ) : (
            <ol aria-label="Access history, oldest first" className="space-y-2">
              {entries.map(entry => {
                const known = KNOWN_EVENT_TYPES.has(entry.eventType);
                const subject = subjectLabel(entry.subject);
                return (
                  <li key={entry.id} data-testid="access-history-entry">
                    <article aria-label={known ? entry.summary : 'Unrecognized access event'} className="border rounded p-2">
                      <p className="font-medium">
                        {known ? entry.summary : 'Unrecognized access event'}
                        {entry.outcome === 'REFUSED' && <span> — Outcome: refused</span>}
                      </p>
                      <p className="text-sm">
                        <time dateTime={entry.occurredAt}>{formatTime(entry.occurredAt)}</time>
                        {' · '}By: {actorLabel(entry.actor)}
                        {subject && <> · Concerning: {subject}</>}
                      </p>
                      {entry.outcome === 'REFUSED' && entry.reasonCode && (
                        <p className="text-sm">Reason code: <code>{entry.reasonCode}</code></p>
                      )}
                    </article>
                  </li>
                );
              })}
            </ol>
          )}
          {nextCursor && (
            <button type="button" onClick={loadMore} disabled={loadingMore} aria-busy={loadingMore}
              className="px-3 py-1 border rounded">
              {loadingMore ? 'Loading more history…' : 'Load more history'}
            </button>
          )}
          {moreError && <p role="alert">Could not load more history. Please try again.</p>}
        </>
      )}
    </section>
  );
}
