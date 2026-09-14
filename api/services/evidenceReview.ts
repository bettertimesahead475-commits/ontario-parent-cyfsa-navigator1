import {getSupabase} from './access.js';
import {LifecycleError,requireUuid} from './lifecycleErrors.js';
import {EVIDENCE_CLASSIFICATIONS,EVIDENCE_REVIEW_STATES,type EvidencePage} from '../../shared/evidenceReview.js';

const invalid=()=>new LifecycleError(400,'INVALID_REVIEW_REQUEST','Invalid evidence review request.');
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw invalid();return v as Record<string,unknown>;};
const fields=(v:Record<string,unknown>,allowed:string[])=>{if(Object.keys(v).some(k=>!allowed.includes(k)))throw invalid();};
const scalar=(v:unknown)=>{if(typeof v!=='string'||!v||v.length>500)throw invalid();return v;};
function limit(v:unknown){if(v===undefined)return 25;const s=scalar(v);if(!/^\d+$/.test(s)||+s<1||+s>50)throw invalid();return +s;}
function date(v:unknown){const s=scalar(v);if(!/^\d{4}-\d{2}-\d{2}$/.test(s)||!Number.isFinite(Date.parse(s))||new Date(s).toISOString().slice(0,10)!==s)throw invalid();return s;}
function timestamp(v:unknown){const s=scalar(v);if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|\+00:00)$/.test(s)||!Number.isFinite(Date.parse(s)))throw invalid();return s;}
async function call(name:string,args:Record<string,unknown>){
  const {data,error}=await getSupabase().rpc(name,args);
  if(error){
    if(error.code==='P0002')throw new LifecycleError(404,'EVIDENCE_NOT_FOUND','Matter or evidence not found.');
    if(error.code==='40001')throw new LifecycleError(409,'REVIEW_CONFLICT','Evidence changed. Reload before reviewing.');
    if(error.code==='55P03')throw new LifecycleError(409,'REVIEW_BUSY','Review is busy. Retry shortly.');
    if(error.code==='22023')throw invalid();
    throw new LifecycleError(503,'REVIEW_UNAVAILABLE','Evidence review is unavailable.');
  }
  if(!data||typeof data!=='object')throw new LifecycleError(503,'REVIEW_UNAVAILABLE','Evidence review is unavailable.');
  return data;
}
export async function listReviewMatters(uid:string,input:unknown){
  const v=object(input);fields(v,['after']);
  return call('navigator_review_matters',{p_uid:uid,p_after:v.after===undefined?null:requireUuid(v.after,'after')});
}
export async function listEvidence(uid:string,matterId:string,input:unknown):Promise<EvidencePage>{
  matterId=requireUuid(matterId,'matterId');const v=object(input);
  fields(v,['limit','cursor','classification','reviewState','documentId','createdFrom','createdTo','page','runId']);
  const filters:Record<string,unknown>={};
  for(const key of ['documentId','runId'])if(v[key]!==undefined)filters[key]=requireUuid(v[key],key);
  for(const [key,values] of [['classification',EVIDENCE_CLASSIFICATIONS],['reviewState',EVIDENCE_REVIEW_STATES]] as const)
    if(v[key]!==undefined){if(!values.includes(v[key] as never))throw invalid();filters[key]=v[key];}
  for(const key of ['createdFrom','createdTo'])if(v[key]!==undefined)filters[key]=date(v[key]);
  if(filters.createdFrom&&filters.createdTo&&filters.createdFrom>filters.createdTo)throw invalid();
  if(v.page!==undefined){const s=scalar(v.page);if(!/^\d+$/.test(s)||+s<1||+s>20)throw invalid();filters.page=+s;}
  let afterTime=null,afterId=null;
  if(v.cursor!==undefined){try{const raw=scalar(v.cursor);if(!/^[\w-]+$/.test(raw))throw invalid();const cur=object(JSON.parse(Buffer.from(raw,'base64url').toString('utf8')));fields(cur,['time','id']);afterTime=timestamp(cur.time);afterId=requireUuid(cur.id,'cursor');}catch{throw invalid();}}
  const pageLimit=limit(v.limit);
  const data=await call('navigator_review_list',{p_uid:uid,p_matter_id:matterId,p_limit:pageLimit,p_after_time:afterTime,p_after_id:afterId,p_filters:filters});
  if(!Array.isArray(data.items)||data.items.length>pageLimit||data.matter?.id!==matterId||
    data.items.some((item:EvidencePage['items'][number])=>!item||item.matter_id!==matterId))
    throw new LifecycleError(503,'REVIEW_UNAVAILABLE','Evidence review is unavailable.');
  // Keep transport-only cursor metadata out of the public wire contract.
  return {items:data.items,matter:data.matter,nextCursor:data.next?Buffer.from(JSON.stringify(data.next)).toString('base64url'):null};
}
export async function reviewEvidence(uid:string,matterId:string,evidenceId:string,input:unknown){
  const v=object(input);fields(v,['reviewState','expectedUpdatedAt']);
  if(!EVIDENCE_REVIEW_STATES.includes(v.reviewState as never))throw invalid();
  return call('navigator_review_update',{p_uid:uid,p_matter_id:requireUuid(matterId,'matterId'),p_evidence_id:requireUuid(evidenceId,'evidenceId'),p_state:v.reviewState,p_expected_updated_at:timestamp(v.expectedUpdatedAt)});
}
export async function evidenceSource(uid:string,matterId:string,evidenceId:string,input:unknown){
  const v=object(input);fields(v,['documentId','versionId','pageId']);
  return call('navigator_review_source',{p_uid:uid,p_matter_id:requireUuid(matterId,'matterId'),p_evidence_id:requireUuid(evidenceId,'evidenceId'),p_document_id:requireUuid(v.documentId,'documentId'),p_version_id:requireUuid(v.versionId,'versionId'),p_page_id:requireUuid(v.pageId,'pageId')});
}
