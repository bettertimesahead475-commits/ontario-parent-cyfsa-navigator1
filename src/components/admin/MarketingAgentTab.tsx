/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Marketing Agent — admin console.
 *
 * This is an ADMIN tool, not a parent-facing feature. It is gated by the
 * server-side ADMIN_SECRET (the same secret used by /api/admin/*), which the
 * admin enters once and which is held in sessionStorage and sent as the
 * `x-admin-secret` header. It never uses the parent Firebase sign-in gate.
 *
 * Everything it shows is the honest server state: channels that aren't
 * connected show WAITING_FOR_CREDENTIALS / WAITING_FOR_PLATFORM_APPROVAL, and a
 * publish that can't happen is reported as "waiting", never as a fake success.
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  Megaphone, Sparkles, Clock, CheckCircle2, XCircle, Send, Loader2, RefreshCw,
  AlertTriangle, Plug, BarChart3, ListChecks, Trash2, Calendar, KeyRound, ShieldAlert,
} from "lucide-react";

const ADMIN_SECRET_KEY = "cyfsa_admin_secret";

const PLATFORMS = ["facebook", "instagram", "linkedin", "x", "tiktok"] as const;
type Platform = (typeof PLATFORMS)[number];

type ChannelStatus =
  | "connected" | "waiting_for_credentials" | "waiting_for_platform_approval" | "error" | "disconnected";

interface ChannelState {
  platform: Platform;
  displayName: string;
  status: ChannelStatus;
  accountName?: string | null;
  credentialsPresent: boolean;
  detail: string;
  missingEnv: string[];
  lastError?: string | null;
}

type PostStatus =
  | "draft" | "pending_approval" | "approved" | "scheduled" | "publishing"
  | "published" | "failed" | "rejected" | "canceled";

interface Post {
  id: string;
  platform: Platform;
  status: PostStatus;
  content: string;
  hashtags: string[] | null;
  link_url: string | null;
  media_url: string | null;
  scheduled_for: string | null;
  published_at: string | null;
  external_url: string | null;
  ai_generated: boolean;
  ai_model: string | null;
  approved_by: string | null;
  rejection_reason: string | null;
  last_error: string | null;
  metrics: Record<string, number> | null;
  created_at: string;
}

// --- Admin API client -------------------------------------------------------

function getSecret(): string {
  try { return sessionStorage.getItem(ADMIN_SECRET_KEY) || ""; } catch { return ""; }
}

async function adminApi(path: string, init: RequestInit = {}): Promise<any> {
  const headers = new Headers(init.headers);
  headers.set("x-admin-secret", getSecret());
  if (init.body) headers.set("Content-Type", "application/json");
  const resp = await fetch(`/api/admin/marketing${path}`, { ...init, headers });
  const text = await resp.text();
  let data: any = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = { error: text?.slice(0, 200) }; }
  if (resp.status === 401) { const e: any = new Error("Unauthorized — check the admin secret."); e.status = 401; throw e; }
  if (!resp.ok) throw new Error(data?.error || `Request failed (${resp.status})`);
  return data;
}

// --- Small presentational helpers ------------------------------------------

const STATUS_STYLES: Record<ChannelStatus, { label: string; cls: string }> = {
  connected: { label: "Connected", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  waiting_for_credentials: { label: "Waiting for credentials", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  waiting_for_platform_approval: { label: "Waiting for platform approval", cls: "bg-orange-50 text-orange-700 border-orange-200" },
  error: { label: "Error", cls: "bg-red-50 text-red-700 border-red-200" },
  disconnected: { label: "Disconnected", cls: "bg-slate-100 text-slate-600 border-slate-200" },
};

const POST_STATUS_STYLES: Record<PostStatus, string> = {
  draft: "bg-slate-100 text-slate-700",
  pending_approval: "bg-amber-100 text-amber-800",
  approved: "bg-blue-100 text-blue-800",
  scheduled: "bg-indigo-100 text-indigo-800",
  publishing: "bg-purple-100 text-purple-800",
  published: "bg-emerald-100 text-emerald-800",
  failed: "bg-red-100 text-red-800",
  rejected: "bg-rose-100 text-rose-800",
  canceled: "bg-slate-200 text-slate-600",
};

function Badge({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-semibold border ${className}`}>{children}</span>;
}

// --- Gate: enter admin secret ----------------------------------------------

function SecretGate({ onUnlock }: { onUnlock: () => void }) {
  const [value, setValue] = useState("");
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setChecking(true); setError(null);
    try {
      sessionStorage.setItem(ADMIN_SECRET_KEY, value.trim());
      await adminApi("/channels"); // validates the secret
      onUnlock();
    } catch (e: any) {
      sessionStorage.removeItem(ADMIN_SECRET_KEY);
      setError(e?.status === 401 ? "That admin secret was not accepted." : e?.message || "Could not verify the secret.");
    } finally {
      setChecking(false);
    }
  };

  return (
    <div className="max-w-md mx-auto mt-16 bg-white border border-slate-200 rounded-2xl p-8 shadow-sm">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-xl bg-brand-50 flex items-center justify-center"><KeyRound className="w-5 h-5 text-brand-600" /></div>
        <div>
          <h2 className="font-display font-bold text-slate-900">Marketing Agent</h2>
          <p className="text-xs text-slate-500">Admin access required</p>
        </div>
      </div>
      <p className="text-sm text-slate-600 mb-4">Enter the admin secret (the same <code className="text-xs bg-slate-100 px-1 rounded">ADMIN_SECRET</code> used for payment approvals).</p>
      <input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && value.trim() && submit()}
        placeholder="Admin secret"
        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-400"
      />
      {error && <p className="text-xs text-red-600 mt-2 flex items-center gap-1"><ShieldAlert className="w-3.5 h-3.5" />{error}</p>}
      <button
        onClick={submit}
        disabled={!value.trim() || checking}
        className="mt-4 w-full px-4 py-2 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-semibold text-sm rounded-lg flex items-center justify-center gap-2"
      >
        {checking ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
        Unlock
      </button>
      <p className="text-[11px] text-slate-400 mt-4">The secret is held only in this tab's session storage and sent as the <code>x-admin-secret</code> header. It is cleared when you close the tab.</p>
    </div>
  );
}

// --- Main console -----------------------------------------------------------

type View = "channels" | "generate" | "queue" | "schedule" | "analytics" | "log";

export default function MarketingAgentTab() {
  const [unlocked, setUnlocked] = useState<boolean>(() => Boolean(getSecret()));
  const [view, setView] = useState<View>("channels");

  if (!unlocked) return <SecretGate onUnlock={() => setUnlocked(true)} />;

  const tabs: { id: View; label: string; icon: React.ReactNode }[] = [
    { id: "channels", label: "Channels", icon: <Plug className="w-4 h-4" /> },
    { id: "generate", label: "Generate", icon: <Sparkles className="w-4 h-4" /> },
    { id: "queue", label: "Approval Queue", icon: <ListChecks className="w-4 h-4" /> },
    { id: "schedule", label: "Scheduled", icon: <Calendar className="w-4 h-4" /> },
    { id: "analytics", label: "Analytics", icon: <BarChart3 className="w-4 h-4" /> },
    { id: "log", label: "Activity Log", icon: <Clock className="w-4 h-4" /> },
  ];

  return (
    <div className="max-w-6xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-11 h-11 rounded-2xl bg-gradient-to-br from-brand-400 to-brand-700 flex items-center justify-center shadow-sm">
          <Megaphone className="w-5 h-5 text-white" />
        </div>
        <div>
          <h1 className="font-display font-black text-xl text-slate-900 tracking-tight">Marketing Agent</h1>
          <p className="text-xs text-slate-500">AI drafts → human approval → schedule → publish. Nothing posts without your approval.</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <a
            href="/admin/system-health"
            className="text-xs text-indigo-600 hover:text-indigo-800 border border-indigo-200 bg-indigo-50 rounded-lg px-3 py-1.5 font-medium transition"
          >System Health</a>
          <button
            onClick={() => { sessionStorage.removeItem(ADMIN_SECRET_KEY); setUnlocked(false); }}
            className="text-xs text-slate-500 hover:text-slate-800 border border-slate-200 rounded-lg px-3 py-1.5"
          >Lock</button>
        </div>
      </div>

      <div className="flex gap-1.5 flex-wrap mb-6 border-b border-slate-200 pb-3">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setView(t.id)}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 rounded-full text-xs font-semibold transition ${
              view === t.id ? "bg-brand-600 text-white" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"
            }`}
          >{t.icon}{t.label}</button>
        ))}
      </div>

      {view === "channels" && <ChannelsPanel />}
      {view === "generate" && <GeneratePanel onGenerated={() => setView("queue")} />}
      {view === "queue" && <QueuePanel />}
      {view === "schedule" && <SchedulePanel />}
      {view === "analytics" && <AnalyticsPanel />}
      {view === "log" && <LogPanel />}
    </div>
  );
}

// --- Channels ---------------------------------------------------------------

function ChannelsPanel() {
  const [channels, setChannels] = useState<ChannelState[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try { const d = await adminApi("/channels"); setChannels(d.channels); }
    catch (e: any) { setError(e.message); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const refresh = async () => {
    setRefreshing(true);
    try { const d = await adminApi("/channels/refresh", { method: "POST" }); setChannels(d.channels); }
    catch (e: any) { setError(e.message); }
    finally { setRefreshing(false); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-600">Connection status for each social platform. Credentials live only in environment variables — never in the database.</p>
        <button onClick={refresh} disabled={refreshing} className="flex items-center gap-1.5 text-xs font-semibold text-slate-600 border border-slate-200 rounded-lg px-3 py-1.5 hover:bg-slate-50">
          {refreshing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />} Re-check
        </button>
      </div>
      {error && <ErrorBox msg={error} />}
      {!channels ? <Loading /> : (
        <div className="grid sm:grid-cols-2 gap-4">
          {channels.map((c) => {
            const s = STATUS_STYLES[c.status];
            return (
              <div key={c.platform} className="bg-white border border-slate-200 rounded-xl p-4">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-bold text-slate-900 capitalize">{c.displayName}</span>
                  <Badge className={s.cls}>{s.label}</Badge>
                </div>
                <p className="text-xs text-slate-600">{c.detail}</p>
                {c.accountName && <p className="text-xs text-slate-500 mt-1">Account: <span className="font-medium">{c.accountName}</span></p>}
                {c.missingEnv?.length > 0 && (
                  <div className="mt-2 text-[11px] text-slate-500">
                    <span className="font-semibold">Needs env:</span> {c.missingEnv.map((e) => <code key={e} className="bg-slate-100 px-1 rounded mr-1">{e}</code>)}
                  </div>
                )}
                {c.lastError && <p className="text-[11px] text-red-600 mt-2">{c.lastError}</p>}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// --- Generate ---------------------------------------------------------------

function GeneratePanel({ onGenerated }: { onGenerated: () => void }) {
  const [topic, setTopic] = useState("");
  const [objective, setObjective] = useState("");
  const [callToAction, setCallToAction] = useState("");
  const [linkUrl, setLinkUrl] = useState("https://cyfsanavigator.com");
  const [selected, setSelected] = useState<Platform[]>(["facebook", "linkedin"]);
  const [variants, setVariants] = useState(1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);

  const toggle = (p: Platform) => setSelected((cur) => cur.includes(p) ? cur.filter((x) => x !== p) : [...cur, p]);

  const generate = async () => {
    setBusy(true); setError(null); setResult(null);
    try {
      const d = await adminApi("/generate", {
        method: "POST",
        body: JSON.stringify({ platforms: selected, topic, objective, callToAction, linkUrl, variantsPerPlatform: variants }),
      });
      setResult(`Generated ${d.created?.length ?? 0} draft(s) with ${d.model}. They're in the Approval Queue for review.`);
      setTopic("");
    } catch (e: any) { setError(e.message); }
    finally { setBusy(false); }
  };

  return (
    <div className="max-w-2xl">
      <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 mb-4 text-xs text-amber-800 flex gap-2">
        <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
        <span>AI drafts are educational copy only — no legal advice, no guarantees, no invented statistics or testimonials. Every draft still requires your review and approval before it can be scheduled or published.</span>
      </div>
      <label className="block text-xs font-semibold text-slate-700 mb-1">Topic / theme *</label>
      <textarea value={topic} onChange={(e) => setTopic(e.target.value)} rows={2} placeholder="e.g. Awareness of the free plain-language CYFSA guide for parents facing a CAS investigation" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-3" />
      <div className="grid sm:grid-cols-2 gap-3 mb-3">
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Objective (optional)</label>
          <input value={objective} onChange={(e) => setObjective(e.target.value)} placeholder="e.g. drive guide readership" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
        </div>
        <div>
          <label className="block text-xs font-semibold text-slate-700 mb-1">Call to action (optional)</label>
          <input value={callToAction} onChange={(e) => setCallToAction(e.target.value)} placeholder="e.g. Read the free guide" className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm" />
        </div>
      </div>
      <label className="block text-xs font-semibold text-slate-700 mb-1">Link (optional)</label>
      <input value={linkUrl} onChange={(e) => setLinkUrl(e.target.value)} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-3" />
      <label className="block text-xs font-semibold text-slate-700 mb-1">Platforms</label>
      <div className="flex flex-wrap gap-2 mb-3">
        {PLATFORMS.map((p) => (
          <button key={p} onClick={() => toggle(p)} className={`px-3 py-1.5 rounded-full text-xs font-semibold capitalize border ${selected.includes(p) ? "bg-brand-600 text-white border-brand-600" : "bg-white text-slate-600 border-slate-200"}`}>{p}</button>
        ))}
      </div>
      <label className="block text-xs font-semibold text-slate-700 mb-1">Variants per platform</label>
      <select value={variants} onChange={(e) => setVariants(Number(e.target.value))} className="px-3 py-2 border border-slate-300 rounded-lg text-sm mb-4">
        <option value={1}>1</option><option value={2}>2</option><option value={3}>3</option>
      </select>
      {error && <ErrorBox msg={error} />}
      {result && <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-3 mb-3 text-sm text-emerald-800 flex items-center gap-2"><CheckCircle2 className="w-4 h-4" />{result} <button className="underline ml-1" onClick={onGenerated}>Review now</button></div>}
      <button onClick={generate} disabled={busy || !topic.trim() || !selected.length} className="px-5 py-2.5 bg-brand-600 hover:bg-brand-700 disabled:opacity-50 text-white font-semibold text-sm rounded-lg flex items-center gap-2">
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />} Generate drafts
      </button>
    </div>
  );
}

// --- Approval Queue ---------------------------------------------------------

function QueuePanel() {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try { const d = await adminApi("/posts"); setPosts(d.posts); }
    catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const act = async (path: string, body?: any) => {
    try { await adminApi(path, { method: body ? "POST" : "POST", body: body ? JSON.stringify(body) : undefined }); await load(); }
    catch (e: any) { setError(e.message); }
  };

  const queue = useMemo<Post[]>(() => (posts || []).filter((p) => ["draft", "pending_approval", "approved", "failed", "rejected"].includes(p.status)), [posts]);

  return (
    <div>
      {error && <ErrorBox msg={error} />}
      {!posts ? <Loading /> : queue.length === 0 ? <Empty msg="No posts awaiting review. Generate some drafts to get started." /> : (
        <div className="space-y-3">
          {queue.map((p) => (
            // key is placed on the wrapper (an intrinsic element handles `key`
            // natively) rather than on the custom component — this project's
            // non-strict @types/react setup doesn't strip `key` from a locally
            // defined component's inline prop type.
            <div key={p.id}>
              <PostCard post={p} onReload={load} onError={setError} />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PostCard({ post, onReload, onError }: { post: Post; onReload: () => void; onError: (m: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const [content, setContent] = useState(post.content);
  const [scheduleAt, setScheduleAt] = useState("");

  const call = async (fn: () => Promise<any>) => {
    setBusy(true);
    try { await fn(); onReload(); } catch (e: any) { onError(e.message); } finally { setBusy(false); }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-4">
      <div className="flex items-center gap-2 mb-2 flex-wrap">
        <Badge className="bg-slate-100 text-slate-700 border-slate-200 capitalize">{post.platform}</Badge>
        <Badge className={`border-transparent ${POST_STATUS_STYLES[post.status]}`}>{post.status.replace(/_/g, " ")}</Badge>
        {post.ai_generated && <Badge className="bg-brand-50 text-brand-700 border-brand-200"><Sparkles className="w-3 h-3" />AI</Badge>}
        <span className="text-[11px] text-slate-400 ml-auto">{new Date(post.created_at).toLocaleString()}</span>
      </div>

      {editing ? (
        <textarea value={content} onChange={(e) => setContent(e.target.value)} rows={4} className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm mb-2" />
      ) : (
        <p className="text-sm text-slate-800 whitespace-pre-wrap mb-2">{post.content}</p>
      )}
      {post.hashtags?.length ? <p className="text-xs text-blue-600 mb-2">{post.hashtags.map((h) => `#${h}`).join(" ")}</p> : null}
      {post.link_url ? <p className="text-[11px] text-slate-500 mb-2 break-all">🔗 <span className="font-mono">{post.link_url}</span></p> : null}
      {post.rejection_reason && <p className="text-xs text-rose-600 mb-2">Rejected: {post.rejection_reason}</p>}
      {post.last_error && <p className="text-xs text-red-600 mb-2">Last error: {post.last_error}</p>}

      <div className="flex items-center gap-2 flex-wrap pt-2 border-t border-slate-100">
        {editing ? (
          <>
            <ActBtn onClick={() => call(async () => { await adminApi(`/posts/${post.id}`, { method: "PATCH", body: JSON.stringify({ content }) }); setEditing(false); })} busy={busy} icon={<CheckCircle2 className="w-3.5 h-3.5" />} label="Save" primary />
            <ActBtn onClick={() => { setEditing(false); setContent(post.content); }} busy={false} icon={<XCircle className="w-3.5 h-3.5" />} label="Cancel" />
          </>
        ) : (
          <>
            {post.status === "draft" && <ActBtn onClick={() => call(() => adminApi(`/posts/${post.id}/submit`, { method: "POST" }))} busy={busy} icon={<Send className="w-3.5 h-3.5" />} label="Submit for approval" />}
            {post.status === "pending_approval" && (
              <>
                <div className="flex items-center gap-1">
                  <input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} className="text-xs border border-slate-200 rounded px-2 py-1" />
                  <ActBtn onClick={() => call(() => adminApi(`/posts/${post.id}/approve`, { method: "POST", body: JSON.stringify(scheduleAt ? { scheduledFor: new Date(scheduleAt).toISOString() } : {}) }))} busy={busy} icon={<CheckCircle2 className="w-3.5 h-3.5" />} label={scheduleAt ? "Approve + schedule" : "Approve"} primary />
                </div>
                <ActBtn onClick={() => { const reason = prompt("Rejection reason?") || "Rejected by admin."; call(() => adminApi(`/posts/${post.id}/reject`, { method: "POST", body: JSON.stringify({ reason }) })); }} busy={busy} icon={<XCircle className="w-3.5 h-3.5" />} label="Reject" />
              </>
            )}
            {(post.status === "approved" || post.status === "failed") && (
              <>
                <div className="flex items-center gap-1">
                  <input type="datetime-local" value={scheduleAt} onChange={(e) => setScheduleAt(e.target.value)} className="text-xs border border-slate-200 rounded px-2 py-1" />
                  <ActBtn onClick={() => call(() => adminApi(`/posts/${post.id}/schedule`, { method: "POST", body: JSON.stringify({ scheduledFor: new Date(scheduleAt).toISOString() }) }))} busy={busy || !scheduleAt} icon={<Calendar className="w-3.5 h-3.5" />} label="Schedule" />
                </div>
                <ActBtn onClick={() => call(() => adminApi(`/posts/${post.id}/publish`, { method: "POST" }))} busy={busy} icon={<Send className="w-3.5 h-3.5" />} label="Publish now" primary />
              </>
            )}
            {post.status === "rejected" && <ActBtn onClick={() => call(() => adminApi(`/posts/${post.id}/submit`, { method: "POST" }).catch(async () => { await adminApi(`/posts/${post.id}`, { method: "PATCH", body: JSON.stringify({}) }); }))} busy={busy} icon={<RefreshCw className="w-3.5 h-3.5" />} label="Back to draft" />}
            {post.status !== "published" && <ActBtn onClick={() => setEditing(true)} busy={busy} icon={<ListChecks className="w-3.5 h-3.5" />} label="Edit" />}
            {post.status !== "published" && post.status !== "canceled" && <ActBtn onClick={() => call(() => adminApi(`/posts/${post.id}/cancel`, { method: "POST" }))} busy={busy} icon={<Trash2 className="w-3.5 h-3.5" />} label="Cancel" />}
          </>
        )}
      </div>
    </div>
  );
}

function ActBtn({ onClick, busy, icon, label, primary }: { onClick: () => void; busy: boolean; icon: React.ReactNode; label: string; primary?: boolean }) {
  return (
    <button onClick={onClick} disabled={busy} className={`flex items-center gap-1 text-xs font-semibold rounded-lg px-2.5 py-1.5 disabled:opacity-50 ${primary ? "bg-brand-600 text-white hover:bg-brand-700" : "bg-white border border-slate-200 text-slate-600 hover:bg-slate-50"}`}>
      {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : icon}{label}
    </button>
  );
}

// --- Scheduled --------------------------------------------------------------

function SchedulePanel() {
  const [posts, setPosts] = useState<Post[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);
  const [runResult, setRunResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try { const d = await adminApi("/posts?status=scheduled"); setPosts(d.posts); }
    catch (e: any) { setError(e.message); }
  }, []);
  useEffect(() => { load(); }, [load]);

  const runNow = async () => {
    setRunning(true); setRunResult(null);
    try {
      const r = await adminApi("/run-scheduler", { method: "POST" });
      setRunResult(`Ran scheduler: ${r.published.length} published, ${r.waiting.length} waiting, ${r.failed.length} failed.`);
      await load();
    } catch (e: any) { setError(e.message); }
    finally { setRunning(false); }
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <p className="text-sm text-slate-600">Approved posts scheduled for a future time. A Vercel Cron runs the scheduler every 5 minutes; you can also run it now.</p>
        <button onClick={runNow} disabled={running} className="flex items-center gap-1.5 text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 rounded-lg px-3 py-1.5">
          {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />} Run scheduler now
        </button>
      </div>
      {runResult && <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 mb-3 text-sm text-slate-700">{runResult}</div>}
      {error && <ErrorBox msg={error} />}
      {!posts ? <Loading /> : posts.length === 0 ? <Empty msg="Nothing scheduled right now." /> : (
        <div className="space-y-3">
          {posts.map((p) => (
            <div key={p.id} className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-1">
                <Badge className="bg-slate-100 text-slate-700 border-slate-200 capitalize">{p.platform}</Badge>
                <Badge className="bg-indigo-100 text-indigo-800 border-transparent"><Clock className="w-3 h-3" />{p.scheduled_for ? new Date(p.scheduled_for).toLocaleString() : "—"}</Badge>
              </div>
              <p className="text-sm text-slate-800 whitespace-pre-wrap">{p.content}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Analytics --------------------------------------------------------------

function AnalyticsPanel() {
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { (async () => { try { setData(await adminApi("/analytics")); } catch (e: any) { setError(e.message); } })(); }, []);

  const metrics = ["impressions", "reach", "likes", "comments", "shares", "clicks"];
  return (
    <div>
      {error && <ErrorBox msg={error} />}
      {!data ? <Loading /> : (
        <>
          <p className="text-sm text-slate-600 mb-4">Aggregated from the latest metrics snapshot of each published post ({data.publishedCount} published). Only real numbers returned by each platform are shown — no estimates.</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
            {metrics.map((m) => (
              <div key={m} className="bg-white border border-slate-200 rounded-xl p-4 text-center">
                <div className="text-2xl font-black text-slate-900">{data.totals?.[m] ?? 0}</div>
                <div className="text-[11px] uppercase tracking-wide text-slate-500 mt-1">{m}</div>
              </div>
            ))}
          </div>
          <h3 className="text-sm font-bold text-slate-900 mb-2">By platform</h3>
          <div className="space-y-2">
            {Object.keys(data.perPlatform || {}).length === 0 ? <Empty msg="No published posts yet." /> :
              Object.entries(data.perPlatform).map(([plat, m]: any) => (
                <div key={plat} className="bg-white border border-slate-200 rounded-lg p-3 flex items-center gap-4 text-sm">
                  <span className="font-semibold capitalize w-24">{plat}</span>
                  <span className="text-slate-500 text-xs">impr {m.impressions ?? 0} · likes {m.likes ?? 0} · comments {m.comments ?? 0} · shares {m.shares ?? 0}</span>
                </div>
              ))}
          </div>
        </>
      )}
    </div>
  );
}

// --- Activity Log -----------------------------------------------------------

function LogPanel() {
  const [log, setLog] = useState<any[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => { (async () => { try { const d = await adminApi("/log"); setLog(d.log); } catch (e: any) { setError(e.message); } })(); }, []);

  const statusColor: Record<string, string> = { success: "text-emerald-600", error: "text-red-600", waiting: "text-amber-600", skipped: "text-slate-400", info: "text-slate-500" };
  return (
    <div>
      {error && <ErrorBox msg={error} />}
      {!log ? <Loading /> : log.length === 0 ? <Empty msg="No activity yet." /> : (
        <div className="bg-white border border-slate-200 rounded-xl divide-y divide-slate-100">
          {log.map((l) => (
            <div key={l.id} className="p-3 flex items-start gap-3 text-sm">
              <span className={`font-mono text-[11px] font-bold uppercase w-16 shrink-0 ${statusColor[l.status] || "text-slate-500"}`}>{l.status}</span>
              <div className="min-w-0">
                <span className="font-semibold text-slate-800">{l.action}</span>
                {l.platform && <span className="text-slate-500"> · {l.platform}</span>}
                {l.detail && <p className="text-xs text-slate-600 break-words">{l.detail}</p>}
              </div>
              <span className="text-[11px] text-slate-400 ml-auto shrink-0">{new Date(l.created_at).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// --- Shared bits ------------------------------------------------------------

function Loading() { return <div className="flex items-center gap-2 text-slate-400 text-sm py-8"><Loader2 className="w-4 h-4 animate-spin" /> Loading…</div>; }
function Empty({ msg }: { msg: string }) { return <div className="text-center text-slate-400 text-sm py-12 border border-dashed border-slate-200 rounded-xl">{msg}</div>; }
function ErrorBox({ msg }: { msg: string }) { return <div className="bg-red-50 border border-red-200 rounded-lg p-3 mb-3 text-sm text-red-700 flex items-center gap-2"><AlertTriangle className="w-4 h-4 shrink-0" />{msg}</div>; }
