import React, { useCallback, useEffect, useId, useRef, useState } from 'react';
import { apiFetch } from '../utils/api';
import { INVITATION_PATH } from '../utils/invitationFragment';

// Stage 10 slice 8: the OWNER's Professional Access panel, inside EvidenceReviewWorkspace (the owner's
// per-matter screen, Stage 10 slice 5) behind a disclosure button, beside Access history.
//
// Reads the mounted OWNER-only current-state report (GET /api/matters/:matterId/access-audit) and
// drives the mounted lifecycle routes (create / revoke). Authorization is entirely server-side: a
// non-owner gets a refusal from the report and this panel shows no data. Nothing here decides who may
// do what; statuses shown are the server's effectiveStatus, never derived here.
//
// The raw invitation token exists in this component only between a successful create and "Done": it
// is turned into <origin>/accept-invitation#t=<token> in the browser (fragment, never query or
// path), shown once for copying, and dropped from state on "Done". It is never logged or stored.

interface GrantDto {
  grantId: string;
  recordedStatus: string;
  effectiveStatus: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED' | string;
  createdAt: string;
  expiresAt: string;
  acceptedAt: string | null;
  revokedAt: string | null;
  recipientEmail: string | null;
}
interface ReportDto {
  matterId: string;
  grants: GrantDto[];
  currentAccess: { role: string; backingGrantIds: string[] }[];
}

type Load = 'loading' | 'loaded' | 'forbidden' | 'error';

export function invitationLink(origin: string, token: string): string {
  return `${origin}${INVITATION_PATH}#t=${token}`;
}

function formatDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
}

export function statusLabel(g: GrantDto, backed: boolean): string {
  switch (g.effectiveStatus) {
    case 'PENDING': return `Pending — not yet accepted (expires ${formatDate(g.expiresAt)})`;
    case 'ACCEPTED': return backed ? 'Accepted — has access' : 'Accepted — no current access';
    case 'REVOKED': return `Revoked${g.revokedAt ? ` on ${formatDate(g.revokedAt)}` : ''}`;
    case 'EXPIRED': return 'Expired — never accepted';
    default: return 'Unknown status';
  }
}

const CREATE_ERRORS: Record<number, string> = {
  400: 'Enter a valid email address (letters, numbers and standard symbols only).',
  401: 'Your sign-in has expired. Sign in again.',
  403: 'Only the matter owner can invite a professional.',
  429: 'Too many invitation actions. Please wait a few minutes and try again.',
};
const REVOKE_ERRORS: Record<number, string> = {
  401: 'Your sign-in has expired. Sign in again.',
  404: 'That invitation could not be found. Reload the list.',
  429: 'Too many invitation actions. Please wait a few minutes and try again.',
  503: 'Revocation could not be confirmed. Access may not have been removed. Reload and check before trying again.',
};

export default function ProfessionalAccessPanel({ matterId }: { matterId: string }) {
  const [load, setLoad] = useState<Load>('loading');
  const [report, setReport] = useState<ReportDto | null>(null);
  const [email, setEmail] = useState('');
  const [formError, setFormError] = useState('');
  const [creating, setCreating] = useState(false);
  const [created, setCreated] = useState<{ link: string; recipient: string } | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [announce, setAnnounce] = useState('');
  const [actionError, setActionError] = useState('');
  const ids = useId();
  const linkRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const generation = useRef(0);

  const [collaboration, setCollaboration] = useState<{
    reviewProgressSummary?: {
      totalReviewed: number;
      confirmedRelevant: number;
      possiblyRelevant: number;
      requiresResearch: number;
      notRelevant: number;
    };
    finalizedWorkProducts?: Array<{
      id: string;
      versionNumber: number;
      workProductType: string;
      finalizedAt: string;
    }>;
  } | null>(null);

  const refresh = useCallback(async () => {
    const current = ++generation.current;
    setLoad('loading');
    try {
      const res = await apiFetch(`/api/matters/${encodeURIComponent(matterId)}/access-audit`);
      if (current !== generation.current) return;
      if (res.status === 403 || res.status === 404) { setReport(null); setLoad('forbidden'); return; }
      if (!res.ok) { setReport(null); setLoad('error'); return; }
      const data = await res.json();
      if (current !== generation.current) return;
      if (!data || !Array.isArray(data.grants) || !Array.isArray(data.currentAccess)) { setLoad('error'); return; }
      setReport(data);

      // Fetch collaboration review progress & finalized snapshots
      try {
        const collabRes = await apiFetch(`/api/matters/${encodeURIComponent(matterId)}/collaboration`);
        if (collabRes.ok) {
          const collabData = await collabRes.json();
          setCollaboration(collabData);
        }
      } catch {
        // Non-blocking fallback
      }

      setLoad('loaded');
    } catch {
      if (current === generation.current) { setReport(null); setLoad('error'); }
    }
  }, [matterId]);

  useEffect(() => {
    setCreated(null); setConfirming(null); setAnnounce(''); setActionError(''); setFormError('');
    void refresh();
    return () => { generation.current++; };
  }, [refresh]);

  useEffect(() => { if (created) linkRef.current?.focus(); }, [created]);
  useEffect(() => { if (confirming) confirmRef.current?.focus(); }, [confirming]);

  async function createInvitation(e: React.FormEvent) {
    e.preventDefault();
    setFormError(''); setAnnounce(''); setActionError('');
    const recipient = email.trim();
    if (!recipient || !emailRef.current?.checkValidity()) {
      setFormError('Enter the email address the professional signs in with.');
      emailRef.current?.focus();
      return;
    }
    setCreating(true);
    try {
      const res = await apiFetch(`/api/matters/${encodeURIComponent(matterId)}/access-grants`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ recipientEmail: recipient }),
      });
      if (res.status !== 201) {
        setFormError(CREATE_ERRORS[res.status] ?? 'The invitation could not be created. Please try again later.');
        emailRef.current?.focus();
        return;
      }
      const data = await res.json();
      if (typeof data?.invitationToken !== 'string' || typeof data?.grant?.recipientEmail !== 'string') {
        setFormError('The invitation could not be created. Please try again later.');
        return;
      }
      setCreated({ link: invitationLink(window.location.origin, data.invitationToken), recipient: data.grant.recipientEmail });
      setEmail('');
      void refresh();
    } catch {
      setFormError('The invitation could not be created. Please try again later.');
    } finally {
      setCreating(false);
    }
  }

  async function copyLink() {
    if (!created) return;
    try {
      await navigator.clipboard.writeText(created.link);
      setCopyStatus('Invitation link copied.');
    } catch {
      linkRef.current?.select();
      setCopyStatus('Copying was blocked. The link is selected: press Ctrl+C (or ⌘C) to copy it.');
    }
  }

  function dismissLink() {
    setCreated(null);
    setCopyStatus('');
    emailRef.current?.focus();
  }

  async function revoke(grant: GrantDto) {
    setRevoking(true); setActionError(''); setAnnounce('');
    try {
      const res = await apiFetch(`/api/access-grants/${encodeURIComponent(grant.grantId)}/revoke`, { method: 'POST' });
      if (!res.ok) {
        setActionError(REVOKE_ERRORS[res.status] ?? 'Revocation could not be confirmed. Reload and check before trying again.');
        return;
      }
      const data = await res.json().catch(() => null);
      const who = grant.recipientEmail ?? 'this professional';
      setAnnounce(grant.effectiveStatus === 'PENDING'
        ? `Invitation for ${who} revoked. The link no longer works.`
        : data?.accessRemovedByThisRequest === true
          ? `Access for ${who} revoked.`
          : `Invitation revoked. ${who} still has access through another accepted invitation.`);
      setConfirming(null);
      await refresh();
    } catch {
      setActionError('Revocation could not be confirmed. Reload and check before trying again.');
    } finally {
      setRevoking(false);
    }
  }

  const backedIds = new Set((report?.currentAccess ?? []).flatMap(a => a.backingGrantIds ?? []));
  const grants = report?.grants ?? [];
  const helpId = `${ids}-help`, errId = `${ids}-err`, emailId = `${ids}-email`;

  return (
    <section aria-labelledby={`${ids}-heading`} className="mt-4 p-4 border rounded-lg bg-white">
      <h3 id={`${ids}-heading`} className="font-semibold text-lg">Professional access</h3>
      <div role="status" aria-live="polite" className="sr-only">{load === 'loading' ? 'Loading professional access…' : ''}</div>
      {announce && <p role="status" className="my-2 p-2 rounded bg-emerald-50 text-emerald-900">{announce}</p>}
      {actionError && <p role="alert" className="my-2 p-2 rounded bg-red-50 text-red-900">{actionError}</p>}

      {load === 'forbidden' && <p role="alert" className="my-2">Only the matter owner can manage professional access.</p>}
      {load === 'error' && <p role="alert" className="my-2">Professional access is unavailable right now. <button type="button" className="underline" onClick={() => void refresh()}>Try again</button></p>}

      {load === 'loaded' && <>
        <form onSubmit={createInvitation} noValidate className="my-3">
          <label htmlFor={emailId} className="block font-medium">Professional's email address</label>
          <p id={helpId} className="text-sm text-slate-600">
            Use the exact email address the professional signs in with. Only someone signed in with that verified email can
            accept, and they will be able to review this matter.
          </p>
          <div className="flex flex-wrap gap-2 mt-1">
            <input ref={emailRef} id={emailId} type="email" required autoComplete="off" value={email} disabled={creating}
              onChange={e => setEmail(e.target.value)} aria-describedby={formError ? `${helpId} ${errId}` : helpId}
              aria-invalid={formError ? true : undefined} className="border rounded px-3 py-2 min-w-[16rem]" />
            <button type="submit" disabled={creating} className="px-4 py-2 rounded bg-indigo-700 text-white font-semibold disabled:opacity-60">
              {creating ? 'Creating invitation…' : 'Create invitation'}
            </button>
          </div>
          {formError && <p id={errId} role="alert" className="text-sm text-red-800 mt-1">{formError}</p>}
        </form>

        {created && (
          <div className="my-3 p-3 border rounded bg-indigo-50" role="group" aria-labelledby={`${ids}-created`}>
            <p id={`${ids}-created`} className="font-medium">Invitation created for {created.recipient}</p>
            <p className="text-sm">
              Send this link to the professional yourself. It is shown only once. It works only for {created.recipient} after
              signing in with that verified email.
            </p>
            <label htmlFor={`${ids}-link`} className="block text-sm font-medium mt-2">Invitation link</label>
            <input ref={linkRef} id={`${ids}-link`} readOnly value={created.link} onFocus={e => e.currentTarget.select()}
              className="w-full border rounded px-2 py-1 font-mono text-xs" />
            <div className="flex gap-2 mt-2">
              <button type="button" onClick={() => void copyLink()} className="px-3 py-1 rounded border bg-white">Copy invitation link</button>
              <button type="button" onClick={dismissLink} className="px-3 py-1 rounded border bg-white">Done</button>
            </div>
            <p role="status" aria-live="polite" className="text-sm mt-1">{copyStatus}</p>
          </div>
        )}

        {grants.length === 0
          ? <p className="text-sm my-2">No professionals have been invited to this matter.</p>
          : <ul aria-label="Professional invitations" className="divide-y">
            {grants.map(g => {
              const who = g.recipientEmail ?? 'Invitation created before recipient binding';
              const revocable = g.effectiveStatus === 'PENDING' || g.effectiveStatus === 'ACCEPTED';
              const action = g.effectiveStatus === 'PENDING' ? 'Revoke invitation' : 'Revoke access';
              return (
                <li key={g.grantId} className="py-2">
                  <p className="font-medium break-all">{who}</p>
                  <p className="text-sm">Status: {statusLabel(g, backedIds.has(g.grantId))}</p>
                  <p className="text-xs text-slate-600">Invited {formatDate(g.createdAt)}</p>
                  {revocable && confirming !== g.grantId && (
                    <button type="button" onClick={() => { setConfirming(g.grantId); setActionError(''); }} className="mt-1 px-3 py-1 rounded border text-sm">
                      {action} for {who}
                    </button>
                  )}
                  {revocable && confirming === g.grantId && (
                    <div role="group" aria-label={`Confirm: ${action.toLowerCase()} for ${who}`} className="mt-1 p-2 border rounded bg-red-50">
                      <p className="text-sm">
                        {g.effectiveStatus === 'PENDING'
                          ? `The invitation link for ${who} will stop working.`
                          : `${who} will lose review access to this matter unless another accepted invitation still covers them.`}
                      </p>
                      <div className="flex gap-2 mt-1">
                        <button ref={confirmRef} type="button" disabled={revoking} onClick={() => void revoke(g)} className="px-3 py-1 rounded bg-red-700 text-white text-sm">
                          {revoking ? 'Revoking…' : `Confirm: ${action.toLowerCase()}`}
                        </button>
                        <button type="button" disabled={revoking} onClick={() => setConfirming(null)} className="px-3 py-1 rounded border text-sm">Cancel</button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>}

        {collaboration?.reviewProgressSummary && (
          <div className="mt-6 pt-4 border-t">
            <h4 className="font-semibold text-sm text-slate-900 mb-2">Professional Review Progress Summary</h4>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs">
              <div className="bg-slate-50 p-2 rounded border">
                <span className="font-bold text-slate-800 text-sm block">{collaboration.reviewProgressSummary.totalReviewed}</span>
                <span className="text-slate-600">Total Items Reviewed</span>
              </div>
              <div className="bg-emerald-50 p-2 rounded border border-emerald-200">
                <span className="font-bold text-emerald-800 text-sm block">{collaboration.reviewProgressSummary.confirmedRelevant}</span>
                <span className="text-emerald-700">Confirmed Relevant</span>
              </div>
              <div className="bg-indigo-50 p-2 rounded border border-indigo-200">
                <span className="font-bold text-indigo-800 text-sm block">{collaboration.reviewProgressSummary.possiblyRelevant}</span>
                <span className="text-indigo-700">Possibly Relevant</span>
              </div>
              <div className="bg-amber-50 p-2 rounded border border-amber-200">
                <span className="font-bold text-amber-800 text-sm block">{collaboration.reviewProgressSummary.requiresResearch}</span>
                <span className="text-amber-700">Requires Research</span>
              </div>
            </div>
          </div>
        )}

        {collaboration?.finalizedWorkProducts && collaboration.finalizedWorkProducts.length > 0 && (
          <div className="mt-4 pt-4 border-t">
            <h4 className="font-semibold text-sm text-slate-900 mb-2">Shared Work Product Snapshots</h4>
            <ul className="space-y-2 text-xs">
              {collaboration.finalizedWorkProducts.map(wp => (
                <li key={wp.id} className="p-2.5 bg-slate-50 rounded border flex justify-between items-center">
                  <div>
                    <span className="font-semibold text-slate-900">Case Brief Version {wp.versionNumber}</span>
                    <span className="text-slate-500 block text-[11px]">Finalized: {formatDate(wp.finalizedAt)}</span>
                  </div>
                  <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 font-medium rounded text-[10px]">
                    FINALIZED
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </>}
    </section>
  );
}
