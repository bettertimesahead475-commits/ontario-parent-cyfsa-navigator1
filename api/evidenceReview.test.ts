import {beforeEach,describe,expect,it,vi} from 'vitest';
import express from 'express';
import request from 'supertest';
import {readFileSync} from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const mock=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('./services/access.js',()=>({getSupabase:()=>mock}));
vi.mock('./services/firebaseAdmin.js',()=>({verifyFirebaseToken:vi.fn(async(h:string)=>h==='Bearer owner'?{uid:'verified-owner'}:null)}));
vi.mock('../src/utils/api',()=>({apiFetch:vi.fn()}));
import {registerEvidenceReviewRoutes} from './evidenceReviewRoutes.js';
import {EvidenceCard,SourceText} from '../src/components/EvidenceReviewWorkspace';
import {availableReviewStates,evidenceQuery,sourcePath,type EvidenceRow} from '../shared/evidenceReview';
const id=(n:number)=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const matter=id(1),evidence=id(2),doc=id(3),version=id(4),page=id(5),run=id(6);
const time='2026-09-13T14:00:00.123456+00:00';
const row:EvidenceRow={id:evidence,matter_id:matter,document_id:doc,document_version_id:version,page_id:page,page_number:1,extraction_run_id:run,classification:'ALLEGATION',review_state:'UNREVIEWED',normalized_statement:'Attributed claim',exact_quote:'é😀',quote_verification:'EXACT',quote_start_offset:0,quote_end_offset:2,created_at:time,updated_at:time,document_name:'Report <script>',version_number:1,last_review:null};
const app=express();app.use(express.json());registerEvidenceReviewRoutes(app);
const list=`/api/matters/${matter}/evidence`,review=`${list}/${evidence}/review`,source=`${list}/${evidence}/source`;
beforeEach(()=>{mock.rpc.mockReset();mock.rpc.mockResolvedValue({data:{items:[row],next:null,matter:{id:matter,title:'Matter'}}});});
describe('review API uses verified identity and one transactional RPC',()=>{
 it.each([['get',list],['patch',review],['get',source],['get','/api/review-matters']])('denies anonymous %s %s',async(method,path)=>{const r=await (request(app) as any)[method](path);expect(r.status).toBe(401);expect(mock.rpc).not.toHaveBeenCalled();});
 it('lists authorized matter evidence once with no-store',async()=>{const r=await request(app).get(list).set('Authorization','Bearer owner');expect(r.status).toBe(200);expect(r.headers['cache-control']).toBe('no-store');expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('navigator_review_list',expect.objectContaining({p_uid:'verified-owner',p_matter_id:matter,p_limit:25}));});
 it.each(['foreign matter','missing matter','suspended account','inactive account'])('normalizes %s denial from the authorization RPC',async()=>{mock.rpc.mockResolvedValue({error:{code:'P0002',message:'private database detail'}});const r=await request(app).get(list).set('Authorization','Bearer owner');expect(r.status).toBe(404);expect(r.text).not.toContain('private');});
 it('preserves microseconds in a keyset cursor',async()=>{mock.rpc.mockResolvedValueOnce({data:{items:[row],next:{time,id:evidence},matter:{id:matter,title:'Matter'}}});const first=await request(app).get(list).set('Authorization','Bearer owner');const second=await request(app).get(list).query({cursor:first.body.nextCursor}).set('Authorization','Bearer owner');expect(second.status).toBe(200);expect(mock.rpc.mock.calls[1][1]).toMatchObject({p_after_time:time,p_after_id:evidence});});
 it.each([['classification','ALLEGATION'],['reviewState','DISPUTED'],['documentId',doc],['runId',run],['page','2'],['createdFrom','2026-09-01'],['createdTo','2026-09-13']])('forwards bounded %s filter',async(key,value)=>{await request(app).get(list).query({[key]:value}).set('Authorization','Bearer owner');expect(mock.rpc.mock.calls[0][1].p_filters[key]).toEqual(key==='page'?2:value);});
 it.each([{limit:'0'},{limit:'51'},{limit:'1.5'},{cursor:'bad!'},{classification:'invented'},{reviewState:'invented'},{documentId:'bad'},{createdFrom:'2026-02-30'},{createdFrom:'2026-09-14',createdTo:'2026-09-01'},{page:'21'},{owner:'spoofed'},{limit:['1','2']}])('rejects malformed filters %j',async(query)=>{const r=await request(app).get(list).query(query).set('Authorization','Bearer owner');expect(r.status).toBe(400);expect(mock.rpc).not.toHaveBeenCalled();});
 it('lists matters with a bounded cursor contract',async()=>{await request(app).get('/api/review-matters').query({after:matter}).set('Authorization','Bearer owner');expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('navigator_review_matters',{p_uid:'verified-owner',p_after:matter});});
 it('updates only review state with optimistic timestamp',async()=>{mock.rpc.mockResolvedValue({data:{id:evidence,review_state:'REVIEWED',updated_at:time}});const r=await request(app).patch(review).set('Authorization','Bearer owner').send({reviewState:'REVIEWED',expectedUpdatedAt:time});expect(r.status).toBe(200);expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('navigator_review_update',{p_uid:'verified-owner',p_matter_id:matter,p_evidence_id:evidence,p_state:'REVIEWED',p_expected_updated_at:time});});
 it.each(['exact_quote','quote_start_offset','document_id','document_version_id','page_id','classification','actor_account_id'])('rejects provenance/identity field %s',async(field)=>{const r=await request(app).patch(review).set('Authorization','Bearer owner').send({reviewState:'CONFIRMED',expectedUpdatedAt:time,[field]:'spoof'});expect(r.status).toBe(400);expect(mock.rpc).not.toHaveBeenCalled();});
 it.each([{reviewState:'invented',expectedUpdatedAt:time},{reviewState:'REVIEWED'},{reviewState:'REVIEWED',expectedUpdatedAt:'bad'},[]])('rejects invalid review %j',async(body)=>{expect((await request(app).patch(review).set('Authorization','Bearer owner').send(body)).status).toBe(400);expect(mock.rpc).not.toHaveBeenCalled();});
 it.each([['P0002',404],['40001',409],['55P03',409],['22023',400],['PGRST202',503],['XX000',503]])('maps %s review failure safely',async(code,status)=>{mock.rpc.mockResolvedValue({error:{code,message:'secret raw SQL'}});const r=await request(app).patch(review).set('Authorization','Bearer owner').send({reviewState:'REVIEWED',expectedUpdatedAt:time});expect(r.status).toBe(status);expect(r.text).not.toContain('secret');});
 it('retrieves only the selected source hierarchy',async()=>{mock.rpc.mockResolvedValue({data:{evidenceId:evidence,documentId:doc,versionId:version,page:{id:page,text:'é😀'}}});const r=await request(app).get(source).query({documentId:doc,versionId:version,pageId:page}).set('Authorization','Bearer owner');expect(r.status).toBe(200);expect(mock.rpc).toHaveBeenCalledExactlyOnceWith('navigator_review_source',{p_uid:'verified-owner',p_matter_id:matter,p_evidence_id:evidence,p_document_id:doc,p_version_id:version,p_page_id:page});});
 it.each(['matter','document','page'])('preserves SQL wrong-%s source denial',async()=>{mock.rpc.mockResolvedValue({error:{code:'P0002'}});expect((await request(app).get(source).query({documentId:doc,versionId:version,pageId:page}).set('Authorization','Bearer owner')).status).toBe(404);});
 it('rejects missing source coordinates before DB access',async()=>{expect((await request(app).get(source).set('Authorization','Bearer owner')).status).toBe(400);expect(mock.rpc).not.toHaveBeenCalled();});
});
describe('workspace render and interaction contracts (not browser integration)',()=>{
 it('renders classification separately from review state and escapes source names',()=>{const html=renderToStaticMarkup(React.createElement(EvidenceCard,{item:row,selected:false,onSelect:()=>{}}));expect(html).toContain('ALLEGATION');expect(html).toContain('UNREVIEWED');expect(html).toContain('&lt;script&gt;');expect(html).toContain('Page 1');});
 it('highlights original Unicode code points without paraphrasing',()=>{const html=renderToStaticMarkup(React.createElement(SourceText,{item:row,source:{evidenceId:evidence,documentId:doc,versionId:version,page:{id:page,page_number:1,text:'é😀 source',checksum:'hash',extraction_method:'utf8-single-source'}}}));expect(html).toContain('é😀</mark> source');});
 it('does not highlight ambiguous evidence',()=>{const html=renderToStaticMarkup(React.createElement(SourceText,{item:{...row,quote_verification:'AMBIGUOUS',quote_start_offset:null,quote_end_offset:null},source:{evidenceId:evidence,documentId:doc,versionId:version,page:{id:page,page_number:1,text:'same same',checksum:'hash',extraction_method:'utf8-single-source'}}}));expect(html).not.toContain('<mark');expect(html).toContain('same same');});
 it('serializes filters and cursor for the next page',()=>{const q=new URLSearchParams(evidenceQuery({documentId:doc,reviewState:'DISPUTED'},'cursor'));expect(q.get('documentId')).toBe(doc);expect(q.get('reviewState')).toBe('DISPUTED');expect(q.get('cursor')).toBe('cursor');expect(q.get('limit')).toBe('25');});
 it('limits unsupported review controls',()=>{expect(availableReviewStates({...row,quote_verification:'ABSENT'})).toEqual(['REQUIRES_SOURCE']);expect(availableReviewStates(row)).toContain('CONFIRMED');});
 it('source jump carries all original identities',()=>{const url=new URL(sourcePath(matter,row),'https://example.test');expect(url.pathname).toBe(source);expect(url.searchParams.get('pageId')).toBe(page);expect(url.searchParams.get('documentId')).toBe(doc);});
});
describe('pending Stage 5 SQL declarations — no database execution',()=>{
 const sql=readFileSync(new URL('../supabase/migrations_pending_approval/create_navigator_evidence_review.sql',import.meta.url),'utf8');
 it('is a single pending transaction and preserves Stage 4 guards',()=>{expect(sql).toContain('PENDING APPROVAL');expect(sql.trimEnd().endsWith('commit;')).toBe(true);expect(sql).not.toMatch(/disable trigger|drop |security definer|alter table public.navigator_evidence_items/i);});
 it('uses bounded keysets with immutable tie breaker',()=>{expect(sql).toContain('(e.created_at,e.id)<(p_after_time,p_after_id)');expect(sql).toContain('order by e.created_at desc,e.id desc limit p_limit+1');expect(sql).toContain('p_limit not between 1 and 50');});
 it('each sensitive function authorizes in the same body',()=>{for(const name of ['list','source','update']){const body=sql.split(`create function public.navigator_review_${name}`)[1].split('end $$;')[0];expect(body).toContain('read_navigator_owned_matter(p_uid,p_matter_id)');expect(body).toContain("set lock_timeout='5s'");expect(body).toContain('security invoker');expect(body).toContain('set search_path=pg_catalog,public,pg_temp');}});
 it('updates one review field, checks stale timestamp and records actor atomically',()=>{expect(sql).toContain('set review_state=p_state where id=e.id');expect(sql).toContain('e.updated_at is distinct from p_expected_updated_at');expect(sql).toContain('values(e.id,actor,previous,e.review_state,e.updated_at)');expect(sql).toContain("e.quote_verification in ('ABSENT','AMBIGUOUS') and p_state<>'REQUIRES_SOURCE'");});
 it('revokes defaults and restricts audit history',()=>{expect(sql).toContain('enable row level security');expect(sql).toContain('grant select,insert on public.navigator_review_actions to service_role');expect(sql).toContain("raise exception 'Review history is append only'");expect(sql).toContain('from public,anon,authenticated,service_role');});
});

describe('review response and combined-filter regression checks',()=>{
 it.each([
  {items:[{...row,matter_id:id(99)}],next:null,matter:{id:matter,title:'Matter'}},
  {items:[row],next:null,matter:{id:id(99),title:'Other matter'}},
  {items:[row,row],next:null,matter:{id:matter,title:'Matter'}},
 ])('fails closed on wrong-scope or oversized RPC output',async(data)=>{
  mock.rpc.mockResolvedValue({data});
  const r=await request(app).get(list).query({limit:'1'}).set('Authorization','Bearer owner');
  expect(r.status).toBe(503);expect(r.body).toEqual({code:'REVIEW_UNAVAILABLE',error:'Evidence review is unavailable.'});
 });
 it('returns only the documented page envelope',async()=>{
  const r=await request(app).get(list).set('Authorization','Bearer owner');
  expect(Object.keys(r.body).sort()).toEqual(['items','matter','nextCursor']);
 });
 it('keeps all filters on a subsequent keyset request',async()=>{
  const cursor=Buffer.from(JSON.stringify({time,id:evidence})).toString('base64url');
  const filters={classification:'ALLEGATION',reviewState:'DISPUTED',documentId:doc,runId:run,page:'2',createdFrom:'2026-09-01',createdTo:'2026-09-14'};
  const r=await request(app).get(list).query({...filters,cursor}).set('Authorization','Bearer owner');
  expect(r.status).toBe(200);expect(mock.rpc.mock.calls[0][1]).toMatchObject({p_after_time:time,p_after_id:evidence,p_filters:{...filters,page:2}});
 });
 it.each([['get','/api/matters/not-a-uuid/evidence'],['patch',`${list}/not-a-uuid/review`]])('rejects malformed route identities',async(method,path)=>{
  const r=await (request(app) as any)[method](path).set('Authorization','Bearer owner').send({reviewState:'REVIEWED',expectedUpdatedAt:time});
  expect(r.status).toBe(400);expect(mock.rpc).not.toHaveBeenCalled();
 });
 it('pins RPC timestamp serialization to UTC',()=>{
  const sql=readFileSync(new URL('../supabase/migrations_pending_approval/create_navigator_evidence_review.sql',import.meta.url),'utf8');
  expect(sql.match(/set timezone='UTC'/g)).toHaveLength(4);
 });
});
