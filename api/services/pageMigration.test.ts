import {readFileSync} from 'node:fs';
import {describe,it,expect} from 'vitest';
import {normalizeQuoteWhitespace} from './pageSources.js';

// Offline declaration/contract checks only. Never loads credentials, connects to a
// database, or executes SQL. PostgreSQL enforcement/concurrency is a separate gate.
const sql=readFileSync(new URL('../../supabase/migrations_pending_approval/create_navigator_page_evidence_foundation.sql',import.meta.url),'utf8');
function expectBefore(body:string,a:string,b:string) {
 expect(body,`Missing ordering marker: ${a}`).toContain(a);
 expect(body,`Missing ordering marker: ${b}`).toContain(b);
 expect(body.indexOf(a)).toBeLessThan(body.indexOf(b));
}
describe('pending source SQL correction contracts (not database execution)',()=>{
 it('uses exactly the declared JS whitespace set including FEFF',()=>{
  const body=sql.split('create function public.navigator_quote_normalize')[1].split('$$;')[0];
  const codes=[...body.matchAll(/chr\((\d+)\)/g)].map(m=>Number(m[1]));
  expect(codes).toHaveLength(25);expect(codes).toContain(65279);
  for(let n=0;n<=0xffff;n++)expect(normalizeQuoteWhitespace(`a${String.fromCharCode(n)}b`)==='a b').toBe(codes.includes(n));
  expect(body).toContain("repeat(' ',25)");expect(body).not.toContain('\\s');
 });
 it('rejects nullable offsets in the constraint and validates before substring',()=>{
  expect(sql).toContain('quote_start_offset is not null and quote_end_offset is not null');
  const body=sql.split('create function public.navigator_quote_validate')[1].split('end $$;')[0];
  expectBefore(body,"navigator_json_require(item,'quote_start_offset','integer')",'fragment:=substring');
  expect(body).toContain("not (item ? 'quote_end_offset')");
  expect(body).toContain('end_pos>char_length(source)');
 });
 it('locks and rechecks the dedup document before locking its version',()=>{
  const body=sql.split('-- Candidate discovery is not authorization.')[1].split("if v.id is not null")[0];
  expectBefore(body,'where id=candidate for update','d.matter_id<>p_matter_id');
  expectBefore(body,'d.matter_id<>p_matter_id','select * into v');
  expect(sql).not.toContain('for update of dv');
 });
 it.each([
  ['wrong matter/run','navigator_run_document_scope','document_id,matter_id','navigator_documents','id,matter_id'],
  ['wrong document hierarchy','navigator_run_version_scope','document_version_id,document_id','navigator_document_versions','id,document_id'],
  ['wrong version/current run','navigator_version_current_run_scope','extraction_run_id,id','navigator_extraction_runs','id,document_version_id'],
 ])('declares the composite FK rejecting %s',(_,name,child,parent,target)=>{
  expect(sql).toContain(`constraint ${name} foreign key(${child}) references public.${parent}(${target})`);
 });
 it('connects cross-matter runs through both document and version composite constraints',()=>{
  expect(sql).toContain('document_id uuid not null');
  expect(sql).toContain('navigator_run_document_scope foreign key(document_id,matter_id)');
  expect(sql).toContain('navigator_run_version_scope foreign key(document_version_id,document_id)');
  expect(sql).toContain("values(p_matter_id,v.id,d.id,'extraction'");
  expect(sql).toContain("values(p_matter_id,v.id,d.id,'evidence'");
 });
 it('retains valid same-hierarchy reference keys',()=>{
  for(const key of ['unique(id,matter_id)','unique(id,document_id)','unique(id,document_version_id)'])expect(sql).toContain(key);
 });
 it('guards completed versions, pages, evidence and run identity without an opt-out',()=>{
  expect(sql).toContain("old.extraction_status='completed' then raise exception");
  expect(sql).toContain("TG_OP<>'INSERT' then raise exception 'Extracted pages are immutable'");
  expect(sql).toContain("version_status is distinct from 'processing'");
  expect(sql).toContain('before insert or update or delete on public.navigator_document_pages');
  expect(sql).toContain('before update or delete on public.navigator_document_versions');
  expect(sql).toContain('before insert or update on public.navigator_evidence_items');
  expect(sql).not.toMatch(/disable trigger|session_replication_role|security definer/i);
 });
 it('validates page/evidence array and scalar types explicitly',()=>{
  for(const call of ["p_payload,'pages','array'","p_payload,'items','array'","item,'pageNumber','integer'","item,'text','string'","item,'page_id','uuid'","item,'page_number','integer'"])expect(sql).toContain(`navigator_json_require(${call})`);
  expect(sql).toContain("jsonb_typeof(obj->key) is distinct from 'number'");
 });
 it('constrains terminal state metadata and revokes broader service defaults',()=>{
  expect(sql).toContain("status='completed' and completed_at is not null and failure_category is null");
  expect(sql).toContain("status='failed' and completed_at is not null and failure_category is not null");
  expect(sql).toContain('from public,anon,authenticated,service_role;');
  expect(sql).not.toContain('grant select,insert,update,delete');
  expect(sql).not.toMatch(/from public\.navigator_document_pages[^;]*for share/i);
  expect(sql.trimEnd().endsWith('commit;')).toBe(true);
 });
});
describe('evidence run attribution contract',()=>{
 const helper=sql.split('create function public.navigator_require_evidence_run')[1].split('end $$;')[0];
 it('locks the run before checking its state and validates canonical page metadata',()=>{
  expectBefore(helper,'where id=p_run_id for update',"evidence_run.status is distinct from 'processing'");
  expectBefore(helper,"navigator_json_require(evidence_run.usage_metadata,'pageId','uuid')","(evidence_run.usage_metadata->>'pageId')::uuid");
  for(const predicate of ['matter_id is distinct from p_matter_id','document_id is distinct from p_document_id','document_version_id is distinct from p_version_id',"operation is distinct from 'evidence'","status is distinct from 'processing'","is distinct from p_page_id"])expect(helper).toContain(predicate);
  expect(helper).toContain("if not found then raise exception");
 });
 it('uses one INSERT-only guard shared with complete_evidence, keeping review updates possible',()=>{
  const guard=sql.split("elsif TG_TABLE_NAME='navigator_evidence_items' then")[1].split('new.updated_at:=')[0];
  expectBefore(guard,'where id=new.document_version_id for update',"if TG_OP='INSERT' then");
  expect(guard).toContain("if TG_OP='INSERT' then\n   perform public.navigator_require_evidence_run(new.extraction_run_id,new.matter_id,new.document_id,new.document_version_id,new.page_id);\n  end if;");
  expect(guard).toContain("(to_jsonb(new)-'review_state'-'updated_at') is distinct from (to_jsonb(old)-'review_state'-'updated_at')");
  expect(sql).toContain('r:=public.navigator_require_evidence_run(r.id,p_matter_id,d.id,v.id,pg.id);');
 });
 it.each([['missing first','B','A','B'],['missing second','A','A','B'],['reversed','BA','A','B']])('ordering helper rejects %s',(_,body,a,b)=>expect(()=>expectBefore(body,a,b)).toThrow());

 // Executable reference cases for the intended contract, paired with declaration
 // checks above. These are NOT execution of the PostgreSQL helper or triggers.
 const page='00000000-0000-4000-8000-000000000001';
 const run={matter:'M',document:'D',version:'V',operation:'evidence',status:'processing',page};
 const accepts=(r:typeof run|null)=>!!r && r.matter==='M'&&r.document==='D'&&r.version==='V'&&r.operation==='evidence'&&r.status==='processing'&&typeof r.page==='string'&&/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(r.page)&&r.page.toLowerCase()===page;
 it('accepts the intended active same-page evidence run contract',()=>expect(accepts(run)).toBe(true));
 it.each([
  ['wrong page',{page:'00000000-0000-4000-8000-000000000002'}],
  ['extraction operation',{operation:'extraction'}],['completed',{status:'completed'}],['failed',{status:'failed'}],
  ['wrong version',{version:'other'}],['wrong matter',{matter:'other'}],['wrong document',{document:'other'}],
  ['missing page',{page:undefined}],['null page',{page:null}],['numeric page',{page:1}],['malformed page',{page:'bad'}],
 ])('rejects %s in the reference contract',(_,patch)=>expect(accepts({...run,...patch} as typeof run)).toBe(false));
 it('rejects a missing run',()=>expect(accepts(null)).toBe(false));
 it('allows review-only changes but detects changed provenance',()=>{
  const original={matter_id:'M',document_id:'D',document_version_id:'V',page_id:page,extraction_run_id:'R',quote_start_offset:0,quote_end_offset:4,review_state:'UNREVIEWED',updated_at:'old'};
  const provenance=({review_state,updated_at,...rest}:typeof original)=>rest;
  expect(provenance({...original,review_state:'REVIEWED',updated_at:'new'})).toEqual(provenance(original));
  for(const key of ['matter_id','document_id','document_version_id','page_id','extraction_run_id','quote_start_offset','quote_end_offset'])expect(provenance({...original,[key]:'changed'})).not.toEqual(provenance(original));
 });
});
