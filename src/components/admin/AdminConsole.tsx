/**
 * Administrator console. Authorization is the signed-in Firebase account: the server (functions/api/admin) accepts
 * only verified, allow-listed administrator accounts. No administrator secret is entered, stored, or sent by the
 * browser. Every change asks for confirmation and a reason, and is recorded in the server-side audit log.
 */
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { apiFetch } from "../../utils/api";

type Section = "overview" | "payments" | "customers" | "codes" | "jobs" | "audit";
const SECTIONS: Array<[Section, string]> = [
  ["overview", "Overview"], ["payments", "Payments"], ["customers", "Customers"],
  ["codes", "Access codes"], ["jobs", "Analysis jobs"], ["audit", "Audit log"],
];

type Gate = "checking" | "ok" | "signed_out" | "forbidden" | "error";

async function adminGet<T = any>(path: string): Promise<T> {
  const res = await apiFetch(`/api/admin/${path}`);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(body?.error || `HTTP ${res.status}`), { status: res.status });
  return body as T;
}

async function adminPost<T = any>(path: string, payload: Record<string, unknown>): Promise<T> {
  const res = await apiFetch(`/api/admin/${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
  return body as T;
}

// null = the server could not establish this figure (shown as unavailable, never as $0.00).
const money = (n: unknown) => typeof n === "number" ? `$${n.toFixed(2)}` : n === null ? "unavailable" : "—";

/** Server-reported reporting gaps. Financial figures are never presented as complete while any warning exists. */
function ReportingWarnings({ warnings }: { warnings?: string[] }) {
  if (!warnings?.length) return null;
  return <div role="alert" className="mb-2 rounded border border-amber-300 bg-amber-50 p-2 text-xs text-amber-900">
    <strong>Figures incomplete.</strong>
    <ul className="list-disc pl-4">{warnings.map((w) => <li key={w}>{w}</li>)}</ul>
  </div>;
}
const when = (s: unknown) => typeof s === "string" && s ? new Date(s).toLocaleString() : "—";

function Card({ title, children }: { title: string; children: ReactNode }) {
  return <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
    <h2 className="mb-3 text-sm font-bold uppercase tracking-wide text-slate-600">{title}</h2>
    {children}
  </section>;
}

function Table({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  if (!rows.length) return <p className="text-sm text-slate-500">Nothing to show.</p>;
  return <div className="max-w-full overflow-x-auto">
    <table className="min-w-full text-left text-xs">
      <thead><tr>{head.map((h) => <th key={h} className="border-b border-slate-200 px-2 py-1 font-semibold text-slate-600">{h}</th>)}</tr></thead>
      <tbody>{rows.map((r, i) => <tr key={i} className="odd:bg-slate-50">{r.map((c, j) => <td key={j} className="whitespace-nowrap px-2 py-1 align-top">{c}</td>)}</tr>)}</tbody>
    </table>
  </div>;
}

function ActionButton({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return <button type="button" onClick={onClick}
    className={`mr-1 rounded px-2 py-0.5 text-[11px] font-semibold ${danger ? "bg-rose-100 text-rose-800 hover:bg-rose-200" : "bg-slate-100 text-slate-800 hover:bg-slate-200"}`}>{label}</button>;
}

export default function AdminConsole({ initialSection = "overview" }: { initialSection?: Section }) {
  const [gate, setGate] = useState<Gate>("checking");
  const [adminEmail, setAdminEmail] = useState("");
  const [section, setSection] = useState<Section>(initialSection);
  const [data, setData] = useState<Record<string, any>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "error"; text: string } | null>(null);
  const [query, setQuery] = useState("");
  const [customer, setCustomer] = useState<any>(null);
  const [jobStatus, setJobStatus] = useState("failed");

  useEffect(() => {
    adminGet("session").then((s) => { setAdminEmail(s.email); setGate("ok"); })
      .catch((e) => setGate(e.status === 401 ? "signed_out" : e.status === 403 ? "forbidden" : "error"));
  }, []);

  const load = useCallback(async (which: Section) => {
    setBusy(true);
    setMessage(null);
    try {
      if (which === "overview") {
        const [monitoring, usage, revenue] = await Promise.all([adminGet("monitoring/status"), adminGet("usage"), adminGet("revenue")]);
        setData((d) => ({ ...d, monitoring, usage, revenue }));
      } else {
        const path = which === "payments" ? "payments/overview" : which === "codes" ? "access-codes" : which === "jobs" ? `jobs?status=${jobStatus}` : "audit";
        const result = await adminGet(path);
        setData((d) => ({ ...d, [which]: result }));
      }
    } catch (e: any) {
      setMessage({ kind: "error", text: e.message || "Could not load." });
    } finally {
      setBusy(false);
    }
  }, [jobStatus]);

  useEffect(() => { if (gate === "ok" && section !== "customers") void load(section); }, [gate, section, load]);

  async function searchCustomer(q = query) {
    if (!q.trim()) return;
    setBusy(true);
    setMessage(null);
    try { setCustomer(await adminGet(`customers?q=${encodeURIComponent(q.trim())}`)); }
    catch (e: any) { setCustomer(null); setMessage({ kind: "error", text: e.message }); }
    finally { setBusy(false); }
  }

  /** Confirms, asks for a reason when needed, runs the change, then reloads the current view. */
  async function act(confirmText: string, path: string, payload: Record<string, unknown>, opts: { reason?: boolean; after?: (r: any) => string } = {}) {
    if (!window.confirm(confirmText)) return;
    let reason: string | null = null;
    if (opts.reason) {
      reason = window.prompt("Reason (kept in the audit log):", "");
      if (!reason || reason.trim().length < 3) { setMessage({ kind: "error", text: "A reason of at least 3 characters is required." }); return; }
    }
    setBusy(true);
    try {
      const result = await adminPost(path, reason ? { ...payload, reason } : payload);
      setMessage({ kind: "ok", text: opts.after ? opts.after(result) : "Done." });
      if (section === "customers") await searchCustomer(); else await load(section);
    } catch (e: any) {
      setMessage({ kind: "error", text: e.message });
    } finally {
      setBusy(false);
    }
  }

  function approve(p: any) {
    const raw = window.prompt(`Amount received by Interac e-Transfer for ${p.referenceNumber} (${money(p.amount)} due):`, String(p.amount ?? ""));
    if (raw === null) return;
    const amountReceived = Number(raw);
    if (!Number.isFinite(amountReceived) || amountReceived <= 0) { setMessage({ kind: "error", text: "Enter the amount received." }); return; }
    void act(`Approve ${p.referenceNumber} and issue an access code to ${p.customerEmail}?`, "payments/approve", { referenceNumber: p.referenceNumber, amountReceived }, {
      after: (r) => `Access code for ${r.customerEmail}: ${r.accessCode} (expires ${when(r.expiresAt)}). Send it now: it is shown only once.`,
    });
  }

  const sessionActions = (s: any) => <>
    {s.accessStatus === "active" && <ActionButton danger label="Suspend" onClick={() => act(`Suspend entitlement ${s.sessionId}? The customer loses access until restored.`, "payments/suspend", { sessionId: s.sessionId }, { reason: true })} />}
    {s.accessStatus === "suspended_or_revoked" && <ActionButton label="Restore" onClick={() => act(`Restore entitlement ${s.sessionId}?`, "payments/restore", { sessionId: s.sessionId })} />}
    {(s.creditsConsumed ?? 0) > 0 && <ActionButton label="Restore credit" onClick={() => {
      const n = Number(window.prompt(`Credits to restore (1-${s.creditsConsumed}):`, "1"));
      if (Number.isInteger(n) && n > 0) void act(`Restore ${n} credit(s) to ${s.sessionId}?`, "credits/restore", { sessionId: s.sessionId, credits: n }, { reason: true, after: (r) => `Restored ${r.creditsRestored}; ${r.creditsRemaining} remaining.` });
    }} />}
  </>;

  const paymentActions = (p: any) => <>
    {p.status === "pending" && <ActionButton label="Approve" onClick={() => approve(p)} />}
    {p.status === "approved" && p.accessStatus === "code_issued" && p.bankSettlementStatus !== "refunded" &&
      <ActionButton label="Reissue code" onClick={() => act(`Issue a new access code for ${p.referenceNumber}? Any unused earlier code stops working.`, "payments/reissue-code", { referenceNumber: p.referenceNumber }, {
        reason: true, after: (r) => `New access code for ${r.customerEmail}: ${r.accessCode} (expires ${when(r.expiresAt)}). Send it now: it is shown only once.`,
      })} />}
    {p.status === "approved" && p.bankSettlementStatus !== "bank_confirmed" && p.bankSettlementStatus !== "refunded" &&
      <ActionButton label="Bank confirmed" onClick={() => act(`Mark ${p.referenceNumber} as received in the bank account?`, "payments/confirm-bank", { referenceNumber: p.referenceNumber })} />}
    {p.bankSettlementStatus !== "missing_or_disputed" && p.bankSettlementStatus !== "refunded" &&
      <ActionButton danger label="Dispute" onClick={() => act(`Mark ${p.referenceNumber} as missing or disputed?`, "payments/dispute", { referenceNumber: p.referenceNumber }, { reason: true })} />}
    {p.bankSettlementStatus !== "refunded" &&
      <ActionButton danger label="Record refund" onClick={() => act(`Record a refund of ${money(p.amount)} for ${p.referenceNumber}? Unused codes expire and the linked access is revoked. Send the money back by Interac e-Transfer yourself: this does not move funds.`, "payments/refund", { referenceNumber: p.referenceNumber, revokeAccess: true }, { reason: true, after: (r) => `Refund recorded (${r.codesExpired} code(s) expired, ${r.sessionsRevoked} entitlement(s) revoked). ${r.note}` })} />}
  </>;

  if (gate === "checking") return <p className="p-6 text-sm">Checking administrator access…</p>;
  if (gate === "signed_out") return <p className="p-6 text-sm">Sign in with your administrator Google account to open the console.</p>;
  if (gate === "forbidden") return <p className="p-6 text-sm">This account is not an administrator.</p>;
  if (gate === "error") return <p className="p-6 text-sm">The administrator service is unavailable. Try again shortly.</p>;

  const m = data.monitoring; const u = data.usage; const rv = data.revenue;
  return <div className="mx-auto max-w-6xl space-y-4 p-4">
    <header className="flex flex-wrap items-center justify-between gap-2">
      <h1 className="text-xl font-bold text-slate-900">Administrator console</h1>
      <span className="text-xs text-slate-500">Signed in as {adminEmail}</span>
    </header>
    <nav className="flex flex-wrap gap-2" aria-label="Administrator sections">
      {SECTIONS.map(([key, label]) => <button key={key} type="button" aria-current={section === key ? "page" : undefined}
        onClick={() => setSection(key)}
        className={`rounded-full px-3 py-1 text-xs font-semibold ${section === key ? "bg-brand-900 text-white" : "bg-slate-100 text-slate-800"}`}>{label}</button>)}
      <button type="button" className="ml-auto text-xs underline" disabled={busy} onClick={() => section === "customers" ? searchCustomer() : load(section)}>{busy ? "Loading…" : "Refresh"}</button>
    </nav>
    {message && <p role={message.kind === "error" ? "alert" : "status"} className={`whitespace-pre-wrap break-words rounded p-3 text-sm ${message.kind === "error" ? "bg-rose-50 text-rose-900" : "bg-emerald-50 text-emerald-900"}`}>{message.text}</p>}

    {section === "overview" && <div className="grid gap-4 md:grid-cols-2">
      <Card title="System health">{m ? <ul className="space-y-1 text-sm">
        <li>Overall: <strong>{m.healthy ? "Healthy" : "Needs attention"}</strong> (checked {when(m.checkedAt)})</li>
        <li>Live analysis ready: {String(m.status?.liveAnalysisReady)}; Forensic queue: {String(m.status?.forensicQueueReady)}</li>
        <li>Database: {m.database.reachable ? `reachable (${m.database.latencyMs} ms)` : "UNREACHABLE"}</li>
        <li>Stuck jobs: {m.stuckJobs.length}; recent failures: {m.recentFailures.length}</li>
        {m.status?.diagnostics && <li className="text-xs text-slate-600">{Object.entries(m.status.diagnostics).map(([k, v]) => `${k}: ${v}`).join(" · ")}</li>}
      </ul> : <p className="text-sm">Loading…</p>}</Card>
      <Card title="Revenue (CAD)">{rv ? <><ReportingWarnings warnings={rv.reporting?.warnings} /><ul className="space-y-1 text-sm">
        <li>Approved: {money(rv.totals.approvedAmount)} · Refunded: {money(rv.totals.refundedAmount)} · Net: <strong>{money(rv.totals.netAmount)}</strong></li>
        <li>Bank confirmed: {money(rv.totals.bankConfirmedAmount)} · Disputed: {money(rv.totals.disputedAmount)} · Pending requests: {money(rv.totals.pendingAmount)}</li>
        <li className="pt-2"><Table head={["Month", "Approved", "Amount", "Refunded"]} rows={rv.byMonth.slice(0, 12).map((r: any) => [r.month, r.approved, money(r.approvedAmount), money(r.refundedAmount)])} /></li>
      </ul></> : <p className="text-sm">Loading…</p>}</Card>
      <Card title="Usage (last 7 days)">{u ? <>
        <p className="mb-2 text-sm">Jobs in the last 24 hours: {u.jobsLast24h}</p>
        <Table head={["Mode", "Total", "Completed", "Failed", "Running", "Queued", "Avg s", "Owner runs"]} rows={Object.entries(u.byMode).map(([k, v]: [string, any]) => [k, v.total, v.completed, v.failed, v.running, v.queued, v.avgSeconds ?? "—", v.ownerRuns])} />
        <p className="mt-2 text-xs text-slate-600">Failures by code: {Object.entries(u.failuresByCode).map(([k, v]) => `${k} ${v}`).join(", ") || "none"}</p>
      </> : <p className="text-sm">Loading…</p>}</Card>
      <Card title="Packages">{rv?.byPlan ? <Table head={["Package", "Approved", "Amount", "Pending"]} rows={rv.byPlan.map((r: any) => [r.plan, r.approved, money(r.approvedAmount), r.pending])} /> : <p className="text-sm">Loading…</p>}</Card>
    </div>}

    {section === "payments" && <Card title="Payments and entitlements">{data.payments ? <><ReportingWarnings warnings={data.payments.reporting?.warnings} /><Table
      head={["Reference", "Customer", "Package", "Amount", "Submitted", "Status", "Bank", "Access", "Credits", "Actions"]}
      rows={data.payments.payments.map((p: any) => [p.referenceNumber, p.customerEmail ?? "—", p.package, money(p.amount), when(p.submittedAt), p.status, p.bankSettlementStatus, p.accessStatus,
        p.creditsGranted != null ? `${p.creditsConsumed}/${p.creditsGranted}` : "—",
        <span key="a">{paymentActions(p)}{p.sessionId && sessionActions({ sessionId: p.sessionId, accessStatus: p.accessStatus, creditsConsumed: p.creditsConsumed })}</span>])} /></> : <p className="text-sm">Loading…</p>}</Card>}

    {section === "customers" && <Card title="Customer lookup">
      <form className="mb-3 flex flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); void searchCustomer(); }}>
        <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Exact email, Firebase uid, or PS- reference"
          className="min-w-0 flex-1 rounded border border-slate-300 p-2 text-sm" aria-label="Customer search" />
        <button type="submit" className="rounded bg-brand-900 px-3 py-2 text-sm font-semibold text-white" disabled={busy}>Search</button>
      </form>
      {customer && <div className="space-y-3 text-sm">
        <p>Email: <strong>{customer.identity.email ?? "—"}</strong> · Firebase uid: <code className="text-xs">{customer.identity.firebaseUid ?? "—"}</code>
          {customer.freeUsage && <> · Free analyses used: {customer.freeUsage.analysesUsed}</>}</p>
        <h3 className="font-semibold">Entitlements</h3>
        <Table head={["Session", "Package", "Status", "Credits used", "Remaining", "Issued", "Expires", "Actions"]}
          rows={customer.sessions.map((s: any) => [<code key="s" className="text-[10px]">{s.sessionId}</code>, s.tier, s.accessStatus, s.creditsConsumed, s.creditsRemaining ?? "unlimited", when(s.issuedAt), when(s.expiresAt), <span key="a">{sessionActions(s)}</span>])} />
        <h3 className="font-semibold">Payments</h3>
        <Table head={["Reference", "Package", "Amount", "Status", "Bank", "Actions"]} rows={customer.payments.map((p: any) => [p.referenceNumber, p.package, money(p.amount), p.status, p.bankSettlementStatus, <span key="a">{paymentActions(p)}</span>])} />
        <h3 className="font-semibold">Access codes</h3>
        <Table head={["Package", "Reference", "State", "Used", "Expires"]} rows={customer.accessCodes.map((c: any) => [c.tier, c.referenceNumber, c.state, when(c.usedAt), when(c.expiresAt)])} />
        <h3 className="font-semibold">Analyses</h3>
        <Table head={["Job", "Mode", "Status", "Stage", "Error", "Created"]} rows={customer.jobs.map((j: any) => [j.job_id, j.mode, j.status, j.stage ?? "—", j.error_code ?? "—", when(j.created_at)])} />
        <h3 className="font-semibold">Audit trail</h3>
        <Table head={["When", "Action", "Target"]} rows={customer.auditTrail.map((a: any) => [when(a.at), a.action, a.target])} />
      </div>}
    </Card>}

    {section === "codes" && <Card title="Access codes">{data.codes ? <Table head={["Email", "Package", "Reference", "State", "Used", "Expires", "Actions"]}
      rows={data.codes.accessCodes.map((c: any) => [c.email ?? "—", c.tier, c.referenceNumber ?? "—", c.state, when(c.usedAt), when(c.expiresAt),
        c.state === "unused" && c.id ? <ActionButton danger label="Revoke" onClick={() => act(`Revoke the unused ${c.tier} code for ${c.email}?`, "access-codes/revoke", { codeId: c.id }, { reason: true })} /> : ""])} /> : <p className="text-sm">Loading…</p>}</Card>}

    {section === "jobs" && <Card title="Analysis jobs">
      <label className="mb-2 block text-xs">Status{" "}
        <select value={jobStatus} onChange={(e) => setJobStatus(e.target.value)} className="rounded border border-slate-300 p-1">
          {["failed", "running", "queued", "completed"].map((s) => <option key={s}>{s}</option>)}
        </select>
      </label>
      {data.jobs ? <Table head={["Job", "Owner uid", "Mode", "Status", "Stage", "Error", "Retryable", "Attempts", "Updated"]}
        rows={data.jobs.jobs.map((j: any) => [j.job_id, <button key="o" type="button" className="underline" onClick={() => { setQuery(j.owner_uid); setSection("customers"); void searchCustomer(j.owner_uid); }}>{j.owner_uid}</button>,
          j.mode, j.status, j.stage ?? "—", j.error_code ? `${j.error_code}${j.error_message ? `: ${j.error_message}` : ""}` : "—", String(j.retryable ?? "—"), j.attempt_count, when(j.updated_at)])} /> : <p className="text-sm">Loading…</p>}
    </Card>}

    {section === "audit" && <Card title={`Administrator audit log${data.audit ? ` (${data.audit.total} entries, newest ${data.audit.events.length} shown)` : ""}`}>{data.audit ? <Table head={["When", "Administrator", "Action", "Target", "Reason", "Details"]}
      rows={data.audit.events.map((e: any) => [when(e.at), e.admin, e.action, e.target, e.reason ?? "—", <code key="d" className="whitespace-pre-wrap text-[10px]">{JSON.stringify(e.details)}</code>])} /> : <p className="text-sm">Loading…</p>}</Card>}
  </div>;
}
