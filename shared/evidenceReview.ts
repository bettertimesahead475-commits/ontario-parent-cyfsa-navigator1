/** Wire contracts shared by the API and review workspace; no server dependencies. */
export const EVIDENCE_CLASSIFICATIONS = ['FACT','ALLEGATION','OPINION','PROFESSIONAL_ASSESSMENT','INFERENCE','UNVERIFIED_CLAIM','UNKNOWN'] as const;
export const EVIDENCE_REVIEW_STATES = ['UNREVIEWED','REVIEWED','CONFIRMED','DISPUTED','REQUIRES_SOURCE','NOT_RELEVANT'] as const;
export type ReviewState = typeof EVIDENCE_REVIEW_STATES[number];
export interface EvidenceRow {
  id: string; matter_id: string; document_id: string; document_version_id: string;
  page_id: string; page_number: number; extraction_run_id: string;
  classification: typeof EVIDENCE_CLASSIFICATIONS[number]; review_state: ReviewState;
  normalized_statement: string; exact_quote: string;
  quote_verification: 'EXACT'|'NORMALIZED_WHITESPACE'|'ABSENT'|'AMBIGUOUS';
  quote_start_offset: number|null; quote_end_offset: number|null;
  created_at: string; updated_at: string; document_name: string; version_number: number;
  last_review: {actor_account_id:string; created_at:string; from_state:ReviewState; to_state:ReviewState}|null;
}
export interface EvidencePage { items:EvidenceRow[]; nextCursor:string|null; matter:{id:string;title:string} }
export interface EvidenceFilters {
  documentId?:string; classification?:string; reviewState?:string;
  createdFrom?:string; createdTo?:string; page?:string; runId?:string;
}
export interface EvidenceSource {
  evidenceId:string; documentId:string; versionId:string;
  page:{id:string;page_number:number;text:string;checksum:string;extraction_method:string};
}
export function evidenceQuery(filters:EvidenceFilters,cursor?:string|null) {
  const query=new URLSearchParams({limit:'25'});
  for(const [key,value] of Object.entries(filters))if(value)query.set(key,value);
  if(cursor)query.set('cursor',cursor);
  return query.toString();
}
export function availableReviewStates(item:Pick<EvidenceRow,'quote_verification'>):readonly ReviewState[] {
  return ['ABSENT','AMBIGUOUS'].includes(item.quote_verification)?['REQUIRES_SOURCE']:EVIDENCE_REVIEW_STATES;
}
export function sourcePath(matterId:string,item:Pick<EvidenceRow,'id'|'document_id'|'document_version_id'|'page_id'>) {
  return `/api/matters/${encodeURIComponent(matterId)}/evidence/${encodeURIComponent(item.id)}/source?`+
    new URLSearchParams({documentId:item.document_id,versionId:item.document_version_id,pageId:item.page_id});
}
