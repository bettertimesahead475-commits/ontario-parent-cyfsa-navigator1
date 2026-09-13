import {beforeEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('./access.js',()=>({getSupabase:()=>({rpc:mocks.rpc})}));
import {uploadSource,readSource,analyzeSourcePage} from './documentSources.js';
const matter='00000000-0000-4000-8000-000000000001',version='00000000-0000-4000-8000-000000000002',pageId='00000000-0000-4000-8000-000000000003';
const body={filename:'a.txt',mimeType:'text/plain',base64:Buffer.from('A claimed an event.').toString('base64')};
let state:any;
beforeEach(()=>{
 state={status:'pending',pages:[],run:0};mocks.rpc.mockReset();
 mocks.rpc.mockImplementation(async(name,args)=>{
  expect(name).toBe('navigator_source_operation');
  if(args.p_uid!=='A')return {error:{code:'P0002',message:'internal owner detail'}};
  const p=args.p_payload;
  switch(args.p_operation){
   case 'begin_upload':if(state.status==='completed')return {data:{cached:true,version:{id:version}}};state.status='processing';state.run++;return {data:{versionId:version,runId:'run-'+state.run}};
   case 'complete_upload':state.pages=p.pages.map((x:any)=>({id:pageId,page_number:x.pageNumber,text:x.text}));state.status='completed';return {data:{status:'completed'}};
   case 'read':return {data:{version:{id:version,status:state.status},pages:state.pages}};
   case 'fail':state.failure=p.category;state.status='failed';return {data:{status:'failed'}};
   case 'begin_evidence':return {data:{runId:'evidence-run',page:state.pages[0]}};
   case 'complete_evidence':state.items=p.items;return {data:{status:'completed'}};
   default:throw Error('unexpected operation');
  }
 });
});
describe('source service uses the transactional persistence contract',()=>{
 it('stops before OCR when deduplication revalidation rejects reassignment',async()=>{
  mocks.rpc.mockResolvedValueOnce({error:{code:'P0002',message:'Source not found'}});
  const ocr=vi.fn();await expect(uploadSource('A',matter,{...body,mimeType:'image/png'},ocr)).rejects.toMatchObject({statusCode:404});
  expect(ocr).not.toHaveBeenCalled();expect(mocks.rpc).toHaveBeenCalledTimes(1);
 });
 it('rechecks cached retrieval and does not return stale metadata after revocation',async()=>{
  mocks.rpc.mockResolvedValueOnce({data:{cached:true,version:{id:version}}}).mockResolvedValueOnce({error:{code:'P0002'}});
  await expect(uploadSource('A',matter,body,vi.fn())).rejects.toMatchObject({statusCode:404});
  expect(mocks.rpc.mock.calls.map(([,a])=>a.p_operation)).toEqual(['begin_upload','read']);
 });
 it('stores pages once and reuses unchanged completed versions and page IDs',async()=>{
  const ocr=vi.fn();const first=await uploadSource('A',matter,body,ocr), second=await uploadSource('A',matter,body,ocr);
  expect(second).toEqual(first);expect(first.pages[0].id).toBe(pageId);expect(state.run).toBe(1);expect(ocr).not.toHaveBeenCalled();
 });
 it('does not repeat OCR for a cached image version',async()=>{const ocr=vi.fn(async()=> 'image text');const image={...body,mimeType:'image/png'};await uploadSource('A',matter,image,ocr);await uploadSource('A',matter,image,ocr);expect(ocr).toHaveBeenCalledTimes(1);});
 it('records a failed extraction and retries using the reserved version',async()=>{
  const image={...body,mimeType:'image/png'};
  await expect(uploadSource('A',matter,image,async()=>{throw Error('provider secret');})).rejects.toMatchObject({code:'EXTRACTION_FAILED'});
  expect(state.failure).toBe('PROVIDER_FAILURE');expect(state.pages).toEqual([]);
  const retried=await uploadSource('A',matter,image,async()=> 'recovered');expect(retried.version.id).toBe(version);expect(state.run).toBe(2);
 });
 it('never accepts body ownership as identity',async()=>{await uploadSource('A',matter,{...body,uid:'B',account_id:'B',role:'admin'},vi.fn());expect(mocks.rpc.mock.calls.every(([,a])=>a.p_uid==='A')).toBe(true);expect(mocks.rpc.mock.calls[0][1].p_payload).not.toHaveProperty('account_id');});
 it('denies cross-account reads in the same RPC that retrieves data',async()=>{await expect(readSource('B',matter,version)).rejects.toMatchObject({statusCode:404,code:'SOURCE_NOT_FOUND'});expect(mocks.rpc).toHaveBeenCalledTimes(1);});
 it('denies upload before OCR',async()=>{const ocr=vi.fn();await expect(uploadSource('B',matter,{...body,mimeType:'image/png'},ocr)).rejects.toMatchObject({statusCode:404});expect(ocr).not.toHaveBeenCalled();});
 it('fails closed when pending migration is unavailable',async()=>{mocks.rpc.mockResolvedValue({error:{code:'PGRST202',message:'internal SQL'}});await expect(readSource('A',matter,version)).rejects.toMatchObject({statusCode:503,message:'Source operation unavailable.'});});
 it('returns retryable busy status without reprocessing',async()=>{mocks.rpc.mockResolvedValue({error:{code:'55P03'}});const ocr=vi.fn();await expect(uploadSource('A',matter,body,ocr)).rejects.toMatchObject({statusCode:409});expect(ocr).not.toHaveBeenCalled();});
 it('reanalyzes stored single-page source without OCR and never automatically confirms facts',async()=>{
  await uploadSource('A',matter,body,vi.fn());const provider=vi.fn(async(sourcePage:{id:string;page_number:number;text:string})=>({items:[{page_id:sourcePage.id,page_number:sourcePage.page_number,classification:'FACT',review_state:'CONFIRMED',normalized_statement:'An event was claimed',exact_quote:sourcePage.text}],usage:{input_tokens:10,output_tokens:10}}));
  await analyzeSourcePage('A',matter,version,pageId,provider);expect(provider.mock.calls[0][0].id).toBe(pageId);expect(state.items[0]).toMatchObject({classification:'UNVERIFIED_CLAIM',review_state:'UNREVIEWED'});
  expect(mocks.rpc.mock.calls.filter(([,a])=>a.p_operation==='begin_upload')).toHaveLength(1);
 });
 it('records failed evidence response and preserves source pages',async()=>{await uploadSource('A',matter,body,vi.fn());await expect(analyzeSourcePage('A',matter,version,pageId,async()=>({items:[{classification:'INVALID'}],usage:{}}))).rejects.toMatchObject({code:'EVIDENCE_FAILED'});expect(state.pages).toHaveLength(1);expect(state.failure).toBe('INVALID_OUTPUT');});
});
