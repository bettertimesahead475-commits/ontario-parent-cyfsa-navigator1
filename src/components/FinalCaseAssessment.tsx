import React, { useState } from 'react';
import { apiFetch } from '../utils/api';
import type { AssessmentReport } from '../../functions/api/final-case-assessment';

const labels = { overview: 'Case overview', chronology: 'Chronology', conflicts: 'Conflicting accounts', gaps: 'Evidence gaps', questions: 'Questions for counsel' };
export default function FinalCaseAssessment() {
  const [open, setOpen] = useState(false);
  const [matters, setMatters] = useState<{ id: string; title: string }[]>([]);
  const [matterId, setMatterId] = useState('');
  const [report, setReport] = useState<AssessmentReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [newTitle, setNewTitle] = useState('');
  const [creationId, setCreationId] = useState(() => crypto.randomUUID());
  const [notice, setNotice] = useState('');
  async function createMatter() {
    setBusy(true); setError(''); setNotice('');
    try {
      const res = await apiFetch('/api/final-case-assessment?action=create-matter', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title: newTitle, requestId: creationId }) });
      const body = await res.json(); if (!res.ok) throw new Error(body.error || 'Matter could not be created');
      setMatters(previous => [...previous.filter(m => m.id !== body.matter.id), body.matter]); setMatterId(body.matter.id); setReport(null); setNewTitle(''); setCreationId(crypto.randomUUID()); setNotice('Matter saved. Add your source documents below.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Matter could not be created'); }
    finally { setBusy(false); }
  }
  async function load(id?: string, generate = false) {
    setBusy(true); setError('');
    try {
      const res = await apiFetch('/api/final-case-assessment' + (id ? '?matterId=' + encodeURIComponent(id) : ''), { method: generate ? 'POST' : 'GET' });
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || 'Assessment unavailable');
      if (body.matters) { setMatters(body.matters); setMatterId(''); setReport(null); }
      else setReport(body.report);
    } catch (e) { setError(e instanceof Error ? e.message : 'Assessment unavailable'); }
    finally { setBusy(false); }
  }
  async function upload(file: File) {
    if (!matterId || file.size > 150000) { setError('Choose a matter and a text file under 150 KB'); return; }
    setBusy(true); setError('');
    try {
      const res = await apiFetch('/api/final-case-assessment?matterId=' + encodeURIComponent(matterId) + '&action=source', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename: file.name, text: await file.text() }) });
      const body = await res.json(); if (!res.ok) throw new Error(body.error || 'Source could not be saved');
      setReport(null); setNotice(body.reused ? 'This source document is already saved.' : 'Source document saved. Add another document or generate the assessment.');
    } catch (e) { setError(e instanceof Error ? e.message : 'Source could not be saved'); }
    finally { setBusy(false); }
  }
  return <section className="rounded-xl border border-indigo-200 bg-white p-4 space-y-3" aria-label="Final Case Assessment">
    <button type="button" className="font-bold text-indigo-900" aria-expanded={open} onClick={() => { setOpen(!open); if (!open) void load(); }}>Final Case Assessment</button>
    {open && <>
      <p className="text-sm">Review the documents you add to this matter’s assessment. Requires active Individual Case Access. A new source set uses one of your five shared Deep Scan credits per paid month; reopening and retries add no charge.</p>
      <p className="text-sm">Educational preparation for counsel. Findings remain preliminary and require source review.</p>
      <label className="block">Your matter <select aria-label="Assessment matter" disabled={busy} value={matterId} onChange={e => { const id = e.target.value; setMatterId(id); setReport(null); if (id) void load(id); }} className="border rounded p-2 ml-2">
        <option value="">Choose a saved matter</option>{matters.map(m => <option key={m.id} value={m.id}>{m.title}</option>)}
      </select></label>
      <div className="flex flex-wrap gap-2"><label>New matter title <input className="border rounded p-2" maxLength={200} value={newTitle} disabled={busy} onChange={e => setNewTitle(e.target.value)} /></label><button type="button" className="border rounded px-3 py-2" disabled={busy || !newTitle.trim()} onClick={() => void createMatter()}>Create matter</button></div>
      {!busy && !matters.length && !error && <p>Create a matter above to start your assessment.</p>}
      {notice && <p role="status">{notice}</p>}
      <label className="block text-sm">Add a text document to this matter <input type="file" accept=".txt,text/plain" disabled={busy || !matterId} onChange={e => { const file = e.target.files?.[0]; if (file) void upload(file); e.target.value = ''; }} /></label>
      <p className="text-sm">Add every document you want assessed. Text documents are shown as one source page. The saved report lists exactly which sources were reviewed.</p>
      <div className="flex gap-3"><button type="button" disabled={busy || !matterId} onClick={() => void load(matterId, true)} className="rounded bg-indigo-900 text-white px-4 py-2 disabled:opacity-50">{busy ? 'Loading assessment…' : 'Generate assessment / retry'}</button>
      <button type="button" disabled={busy || !matterId} onClick={() => void load(matterId)} className="border rounded px-4 py-2">Reopen saved report</button></div>
      {error && <p role="alert">{error}. Your saved documents remain available.</p>}
      {report && <article className="space-y-4"><h2 className="font-bold text-xl">Final Case Assessment — {report.title}</h2><p className="text-sm">Saved {new Date(report.createdAt).toLocaleString()}</p>
        {Object.entries(labels).map(([key, label]) => <section key={key}><h3 className="font-bold">{label}</h3><ul className="list-disc pl-5">{report.sections[key as keyof typeof labels].map((p, i) => <li key={i}>{p.text} <span className="text-sm">{p.sources.map(id => { const source = report.sources.find(s => s.id === id); return <a className="underline mr-2" key={id} href={'#assessment-source-' + id}>{source?.document}, p. {source?.page}</a>; })}</span></li>)}</ul></section>)}
        <section><h3 className="font-bold">Source pages reviewed</h3>{report.sources.map(s => <details key={s.id} id={'assessment-source-' + s.id}><summary>{s.document}, page {s.page}</summary><p className="whitespace-pre-wrap">{s.text}</p></details>)}</section>
      </article>}
    </>}
  </section>;
}
