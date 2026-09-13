import { getSupabase } from './access.js';
import { LifecycleError,requireText,requireUuid } from './lifecycleErrors.js';
import { decodeSource,extractPages,validateEvidence,SOURCE_SCHEMA,type OCR } from './pageSources.js';

export type EvidenceProvider=(page:{id:string;page_number:number;text:string})=>Promise<{items:unknown;usage:Record<string,number>}>;
export async function sourceOperation(uid:string,matterId:string,operation:string,payload:Record<string,unknown>) {
  const {data,error}=await getSupabase().rpc('navigator_source_operation',{p_uid:uid,p_matter_id:requireUuid(matterId,'matterId'),p_operation:operation,p_payload:payload});
  if(error) {
    if(error.code==='P0002')throw new LifecycleError(404,'SOURCE_NOT_FOUND','Source not found.');
    if(error.code==='55P03')throw new LifecycleError(409,'SOURCE_BUSY','Source is busy. Retry later.');
    throw new LifecycleError(503,'SOURCE_UNAVAILABLE','Source operation unavailable.');
  }
  if(!data||typeof data!=='object')throw new LifecycleError(503,'SOURCE_UNAVAILABLE','Source operation unavailable.');
  return data;
}
export async function readSource(uid:string,matterId:string,versionId:string) {
  return sourceOperation(uid,matterId,'read',{versionId:requireUuid(versionId,'versionId')});
}
async function fail(uid:string,matter:string,versionId:string,runId:string,category:string) {
  // A revoked owner must not regain write access merely to record a failure.
  // If this fails, the processing run remains visible; upload leases recover on retry.
  try {await sourceOperation(uid,matter,'fail',{versionId,runId,category});}catch {console.error('[sources] failure status could not be recorded');}
}
export async function uploadSource(uid:string,matterId:string,body:any,ocr:OCR) {
  const filename=requireText(body?.filename,'filename',255);
  const source=decodeSource(body?.base64,body?.mimeType);
  const documentId=body?.documentId==null?null:requireUuid(body.documentId,'documentId');
  const begin=await sourceOperation(uid,matterId,'begin_upload',{filename,mime:source.mime,size:source.bytes.length,checksum:source.checksum,documentId,
    provider:source.mime==='text/plain'?'local':'google',model:source.mime==='text/plain'?'utf8':'gemini-3.1-pro-preview|gemini-3.6-flash'});
  if(begin.cached)return readSource(uid,matterId,begin.version.id);
  try {
    const pages=await extractPages(source.bytes,source.mime,ocr);
    await sourceOperation(uid,matterId,'complete_upload',{versionId:begin.versionId,runId:begin.runId,pages});
  }catch(error){await fail(uid,matterId,begin.versionId,begin.runId,error instanceof LifecycleError?'INVALID_OUTPUT':'PROVIDER_FAILURE');throw new LifecycleError(422,'EXTRACTION_FAILED','Extraction failed. Re-upload this version to retry.');}
  return readSource(uid,matterId,begin.versionId);
}
export async function analyzeSourcePage(uid:string,matterId:string,versionId:string,pageId:string,provider:EvidenceProvider) {
  versionId=requireUuid(versionId,'versionId');pageId=requireUuid(pageId,'pageId');
  const run=await sourceOperation(uid,matterId,'begin_evidence',{versionId,pageId,model:'claude-sonnet-5',schema:SOURCE_SCHEMA});
  try {
    if(run.page.text.length>30000)throw new LifecycleError(422,'PAGE_TOO_LARGE','Page requires chunking before evidence extraction.');
    const result=await provider(run.page);
    const items=validateEvidence(result.items,run.page);
    await sourceOperation(uid,matterId,'complete_evidence',{versionId,runId:run.runId,items,usage:result.usage});
    return {runId:run.runId,itemCount:items.length};
  } catch(error) {await fail(uid,matterId,versionId,run.runId,error instanceof LifecycleError?'INVALID_OUTPUT':'PROVIDER_FAILURE');throw new LifecycleError(422,'EVIDENCE_FAILED','Evidence extraction failed. Source pages are preserved.');}
}
