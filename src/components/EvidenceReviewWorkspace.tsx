import React,{useEffect,useRef,useState} from 'react';
import {apiFetch} from '../utils/api';
import AccessHistoryPanel from './AccessHistoryPanel';
import ProfessionalAccessPanel from './ProfessionalAccessPanel';
import {EVIDENCE_CLASSIFICATIONS,EVIDENCE_REVIEW_STATES,availableReviewStates,evidenceQuery,sourcePath,
 type EvidenceFilters,type EvidencePage,type EvidenceRow,type EvidenceSource,type ReviewState} from '../../shared/evidenceReview';

async function request<T>(path:string,init?:RequestInit):Promise<T>{
  const response=await apiFetch(path,init);
  if(!response.ok){
    // Do not render arbitrary response bodies or reverse proxy error content.
    const messages:Record<number,string>={400:'Check the filters or review selection.',401:'Sign in again to review evidence.',404:'Matter or evidence is no longer available.',409:'Evidence changed or is busy. Reload before reviewing.',503:'Evidence review is unavailable. Its database migration may still be pending approval.'};
    throw new Error(messages[response.status]||'Evidence review could not be completed.');
  }
  return response.json();
}
export function SourceText({item,source}:{item:EvidenceRow;source:EvidenceSource}){
  const text=Array.from(source.page.text),start=item.quote_start_offset,end=item.quote_end_offset;
  const anchored=start!==null&&end!==null&&start>=0&&end<=text.length&&end>start&&['EXACT','NORMALIZED_WHITESPACE'].includes(item.quote_verification);
  return <pre className="whitespace-pre-wrap break-words text-sm leading-7 font-sans bg-white border p-4 rounded-lg max-h-96 overflow-auto" aria-label="Original extracted page text">
    {anchored?<>{text.slice(0,start).join('')}<mark className="bg-amber-200">{text.slice(start,end).join('')}</mark>{text.slice(end).join('')}</>:source.page.text}
  </pre>;
}
export function EvidenceCard({item,selected,onSelect}:{item:EvidenceRow;selected:boolean;onSelect:()=>void}){
  return <button type="button" onClick={onSelect} aria-pressed={selected} className={`w-full text-left p-4 rounded-xl border mb-3 ${selected?'border-indigo-600 bg-indigo-50':'border-slate-200 bg-white hover:border-indigo-300'}`}>
    <span className="flex flex-wrap gap-2 text-xs font-semibold"><span>{item.classification.replaceAll('_',' ')}</span><span className="text-indigo-800">{item.review_state.replaceAll('_',' ')}</span></span>
    <span className="block mt-2 font-medium">{item.normalized_statement}</span>
    <span className="block mt-2 text-sm text-slate-600">{item.document_name} · Version {item.version_number} · Page {item.page_number}</span>
    <span className="block text-xs mt-1">Quote: {item.quote_verification.replaceAll('_',' ')}</span>
  </button>;
}
export default function EvidenceReviewWorkspace(){
  const [matters,setMatters]=useState<{id:string;title:string}[]>([]),[matterNext,setMatterNext]=useState<string|null>(null);
  const [matterId,setMatterId]=useState(''),[filters,setFilters]=useState<EvidenceFilters>({}),[draft,setDraft]=useState<EvidenceFilters>({});
  const [data,setData]=useState<EvidencePage|null>(null),[cursor,setCursor]=useState<string|null>(null),[previous,setPrevious]=useState<(string|null)[]>([]);
  const [selected,setSelected]=useState<EvidenceRow|null>(null),[source,setSource]=useState<EvidenceSource|null>(null);
  const [state,setState]=useState<ReviewState>('UNREVIEWED'),[busy,setBusy]=useState(false),[saving,setSaving]=useState(false),[sourceBusy,setSourceBusy]=useState(false),[matterBusy,setMatterBusy]=useState(false);
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[refresh,setRefresh]=useState(0),[showAccessHistory,setShowAccessHistory]=useState(false),[showProfessionalAccess,setShowProfessionalAccess]=useState(false);
  const generation=useRef(0),sourceGeneration=useRef(0),mounted=useRef(true);
  useEffect(()=>()=>{mounted.current=false;},[]);
  async function loadMatters(after?:string){
    setMatterBusy(true);setError('');
    try{const result=await request<{items:{id:string;title:string}[];next:string|null}>(`/api/review-matters${after?'?after='+encodeURIComponent(after):''}`);
      if(mounted.current){setMatters(result.items);setMatterNext(result.next);}
    }catch(e){if(mounted.current)setError((e as Error).message);}finally{if(mounted.current)setMatterBusy(false);}
  }
  useEffect(()=>{mounted.current=true;void loadMatters();},[]);
  useEffect(()=>{
    const current=++generation.current;sourceGeneration.current++;setSelected(null);setSource(null);setSourceBusy(false);setData(null);setError('');
    if(!matterId){setBusy(false);return;}
    const controller=new AbortController();setBusy(true);
    request<EvidencePage>(`/api/matters/${encodeURIComponent(matterId)}/evidence?${evidenceQuery(filters,cursor)}`,{signal:controller.signal})
      .then(result=>{if(current===generation.current)setData(result);})
      .catch(e=>{if(current===generation.current&&!controller.signal.aborted)setError(e.message);})
      .finally(()=>{if(current===generation.current)setBusy(false);});
    return ()=>controller.abort();
  },[matterId,filters,cursor,refresh]);
  function choose(item:EvidenceRow){sourceGeneration.current++;setSelected(item);setState(item.review_state);setSource(null);setSourceBusy(false);setError('');setNotice('');}
  async function viewSource(){
    if(!selected)return;const item=selected,token=++sourceGeneration.current;setSourceBusy(true);setError('');
    try{const result=await request<EvidenceSource>(sourcePath(matterId,item));if(token===sourceGeneration.current&&mounted.current){
      if(result.evidenceId!==item.id||result.documentId!==item.document_id||result.versionId!==item.document_version_id||result.page.id!==item.page_id||result.page.page_number!==item.page_number)throw new Error('Source identity did not match the selected evidence.');
      setSource(result);
    }}catch(e){if(token===sourceGeneration.current&&mounted.current)setError((e as Error).message);}finally{if(token===sourceGeneration.current&&mounted.current)setSourceBusy(false);}
  }
  async function saveReview(){
    if(!selected)return;const item=selected,token=generation.current;setSaving(true);setError('');setNotice('');
    try{await request(`/api/matters/${encodeURIComponent(matterId)}/evidence/${encodeURIComponent(item.id)}/review`,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({reviewState:state,expectedUpdatedAt:item.updated_at})});
      if(mounted.current&&token===generation.current){setNotice('Review saved. Classification and source attribution were preserved.');setCursor(null);setPrevious([]);setRefresh(x=>x+1);}
    }catch(e){if(mounted.current&&token===generation.current)setError((e as Error).message);}finally{if(mounted.current)setSaving(false);}
  }
  const inputClass='block w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm mt-1';
  return <main className="max-w-7xl mx-auto px-4 py-8">
    <h1 className="text-3xl font-bold">Evidence Review</h1>
    <p className="text-slate-600 mt-2">Review extracted claims against their sources. A verified quote establishes attribution, not legal truth.</p>
    {error&&<div role="alert" className="my-4 p-3 bg-red-50 text-red-900 rounded">{error} <button type="button" className="underline" onClick={()=>{if(matterId)setRefresh(x=>x+1);else void loadMatters();}}>Reload</button></div>}
    {notice&&<p role="status" className="my-4 text-emerald-800">{notice}</p>}
    <section className="my-6 rounded-xl border bg-white p-4" aria-label="Matter selection">
      <label className="font-semibold">Open matter<select className={inputClass} value={matterId} disabled={saving||matterBusy} onChange={e=>{setMatterId(e.target.value);setShowAccessHistory(false);setShowProfessionalAccess(false);setCursor(null);setPrevious([]);setFilters({});setDraft({});setNotice('');}}>
        <option value="">{matterBusy?'Loading matters…':'Select an owned matter'}</option>
        {matterId&&!matters.some(m=>m.id===matterId)&&<option value={matterId}>{data?.matter.title||'Current matter'}</option>}
        {matters.map(m=><option key={m.id} value={m.id}>{m.title}</option>)}
      </select></label>
      {!matterBusy&&matters.length===0&&<p className="text-sm mt-2">No owned matters are available on this page.</p>}
      <div className="flex gap-4 mt-2"><button disabled={matterBusy||saving} onClick={()=>void loadMatters()} className="text-sm underline">First matters</button>{matterNext&&<button disabled={matterBusy||saving} onClick={()=>void loadMatters(matterNext)} className="text-sm underline">Next matters</button>}</div>
    </section>
    {matterId&&<>
      <h2 className="text-xl font-semibold mb-3">{data?.matter.title||'Matter evidence'}</h2>
      <form aria-label="Evidence filters" className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 bg-slate-100 p-4 rounded-xl mb-5" onSubmit={e=>{e.preventDefault();setCursor(null);setPrevious([]);setFilters({...draft});}}>
        <label>Classification<select className={inputClass} value={draft.classification||''} onChange={e=>setDraft({...draft,classification:e.target.value})}><option value="">All classifications</option>{EVIDENCE_CLASSIFICATIONS.map(s=><option key={s}>{s}</option>)}</select></label>
        <label>Review state<select className={inputClass} value={draft.reviewState||''} onChange={e=>setDraft({...draft,reviewState:e.target.value})}><option value="">All review states</option>{EVIDENCE_REVIEW_STATES.map(s=><option key={s}>{s}</option>)}</select></label>
        <label>Document ID<input className={inputClass} value={draft.documentId||''} onChange={e=>setDraft({...draft,documentId:e.target.value})} placeholder="All documents" /></label>
        <label>Page number<input type="number" min="1" max="20" className={inputClass} value={draft.page||''} onChange={e=>setDraft({...draft,page:e.target.value})}/></label>
        <label>Extracted from (UTC)<input type="date" className={inputClass} value={draft.createdFrom||''} onChange={e=>setDraft({...draft,createdFrom:e.target.value})}/></label>
        <label>Extracted through (UTC)<input type="date" className={inputClass} value={draft.createdTo||''} onChange={e=>setDraft({...draft,createdTo:e.target.value})}/></label>
        <label>Analysis run ID<input className={inputClass} value={draft.runId||''} onChange={e=>setDraft({...draft,runId:e.target.value})} placeholder="All runs"/></label>
        <div className="flex items-end gap-2"><button disabled={saving} className="bg-indigo-700 text-white px-4 py-2 rounded">Apply filters</button><button type="button" disabled={saving} onClick={()=>{setDraft({});setFilters({});setCursor(null);setPrevious([]);}} className="border px-3 py-2 rounded">Clear</button></div>
        <p className="text-xs text-slate-600 col-span-full">Dates filter evidence creation, not alleged event dates. Structured person/entity filtering is not yet available.</p>
      </form>
      {busy&&<p role="status">Loading evidence…</p>}
      <div className="grid lg:grid-cols-2 gap-6">
        <section aria-label="Matter evidence list" aria-busy={busy}>
          {!busy&&data?.items.length===0&&<p className="border rounded-xl p-8 bg-white">No evidence matches these filters. Evidence extraction is a separate workflow.</p>}
          {data?.items.map(item=><div key={item.id}><EvidenceCard item={item} selected={selected?.id===item.id} onSelect={()=>{if(!saving)choose(item);}}/></div>)}
          {data&&<div className="flex items-center gap-4 my-4"><button disabled={busy||saving||previous.length===0} onClick={()=>{setCursor(previous[previous.length-1]);setPrevious(p=>p.slice(0,-1));}} className="border px-3 py-2 rounded disabled:opacity-40">Previous</button><span className="text-sm">Page {previous.length+1} · {data.items.length} items</span><button disabled={busy||saving||!data.nextCursor} onClick={()=>{setPrevious(p=>[...p,cursor]);setCursor(data.nextCursor);}} className="border px-3 py-2 rounded disabled:opacity-40">Next</button></div>}
        </section>
        <aside aria-label="Evidence details" className="min-w-0">
          {!selected?<p className="border rounded-xl p-8 text-slate-500">Select evidence to inspect its quote, attribution and review state.</p>:<div className="bg-white border rounded-xl p-5 space-y-4">
            <h3 className="font-bold text-lg">Source and review</h3><p>{selected.normalized_statement}</p>
            <dl className="text-sm space-y-2 break-words"><div><dt className="font-semibold">Classification</dt><dd>{selected.classification}</dd></div><div><dt className="font-semibold">Quote verification</dt><dd>{selected.quote_verification}</dd></div>
            <div><dt className="font-semibold">Document / version / page</dt><dd>{selected.document_name} · v{selected.version_number} · page {selected.page_number}</dd><dd className="font-mono text-xs">{selected.document_id}<br/>{selected.document_version_id}<br/>{selected.page_id}</dd></div>
            <div><dt className="font-semibold">Analysis run</dt><dd className="font-mono text-xs">{selected.extraction_run_id}</dd></div><div><dt className="font-semibold">Created</dt><dd>{selected.created_at}</dd></div>
            <div><dt className="font-semibold">Last recorded reviewer / time</dt><dd>{selected.last_review?`${selected.last_review.actor_account_id} · ${selected.last_review.created_at}`:'No recorded review action. Earlier review states may predate audit history.'}</dd></div></dl>
            <blockquote className="border-l-4 border-indigo-300 pl-3 whitespace-pre-wrap break-words">{selected.exact_quote||'(No source quote supplied)'}</blockquote>
            {['ABSENT','AMBIGUOUS'].includes(selected.quote_verification)&&<p className="text-amber-900 bg-amber-50 p-3">Requires source resolution. This quote has no unique verified anchor and cannot be confirmed through this workflow.</p>}
            <button disabled={sourceBusy} onClick={()=>void viewSource()} className="border border-indigo-700 text-indigo-800 px-4 py-2 rounded">{sourceBusy?'Loading source…':'View source page'}</button>
            {source&&<><p className="text-xs">Preserved extracted page text; highlighted coordinates use Unicode code points. This is not the original PDF image.</p><SourceText item={selected} source={source}/></>}
            <label className="block font-semibold">Human review state<select className={inputClass} value={state} disabled={saving} onChange={e=>setState(e.target.value as ReviewState)}>{availableReviewStates(selected).map(s=><option key={s}>{s}</option>)}</select></label>
            <p className="text-xs text-slate-600">Confirmation records your review; it does not change classification or establish a legal finding.</p>
            <button disabled={saving||state===selected.review_state} onClick={()=>void saveReview()} className="bg-indigo-700 text-white px-4 py-2 rounded disabled:opacity-40">{saving?'Saving…':'Save review'}</button>
            <button disabled={saving} onClick={()=>{const next={...filters,documentId:selected.document_id};setDraft(next);setFilters(next);setCursor(null);setPrevious([]);}} className="ml-3 text-sm underline">Filter this document</button>
          </div>}
        </aside>
      </div>
      {/* Stage 10: past access events for this matter, loaded only on request. History is evidence of
          what happened, not current access; the server decides what (if anything) this user may see. */}
      <section className="my-6 rounded-xl border bg-white p-4" aria-label="Matter access history">
        <button type="button" aria-expanded={showAccessHistory} aria-controls="matter-access-history" onClick={()=>setShowAccessHistory(v=>!v)} className="border px-3 py-2 rounded">{showAccessHistory?'Hide access history':'Show access history'}</button>
        <div id="matter-access-history" className={showAccessHistory?'mt-4':undefined}>{showAccessHistory&&<AccessHistoryPanel matterId={matterId}/>}</div>
      </section>
      {/* Stage 10 slice 8: invite, list and revoke professionals (owner only; the server decides). */}
      <section className="my-6 rounded-xl border bg-white p-4" aria-label="Professional access management">
        <button type="button" aria-expanded={showProfessionalAccess} aria-controls="matter-professional-access" onClick={()=>setShowProfessionalAccess(v=>!v)} className="border px-3 py-2 rounded">{showProfessionalAccess?'Hide professional access':'Manage professional access'}</button>
        <div id="matter-professional-access">{showProfessionalAccess&&<ProfessionalAccessPanel matterId={matterId}/>}</div>
      </section>
    </>}
  </main>;
}
