import { getSupabase } from './access.js';
import { findAccount } from './accounts.js';
import { LifecycleError, requireUuid } from './lifecycleErrors.js';
import { requireProfessionalAccess } from './professionalWorkspace.js';
import { generateCaseBrief } from './litigationWorkProduct.js';

export const LEGAL_DISCLAIMER = 
  'Decision-support review output generated from records available to CYFSA Navigator. ' +
  'Potential issues, evidence, and legal relevance require professional verification against the source record and current law. ' +
  'Not an official court document or legal advice.';

/**
 * Output A: Full Professional Case Brief
 */
export async function getProfessionalCaseBriefOutput(firebaseUid: string, matterId: string) {
  const brief = await generateCaseBrief(firebaseUid, matterId);
  return {
    ...brief,
    disclaimer: LEGAL_DISCLAIMER
  };
}

/**
 * Output B: Chronology Output
 */
export async function getChronologyOutput(firebaseUid: string, matterId: string) {
  matterId = requireUuid(matterId, 'matterId');
  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const db = getSupabase();
  await requireProfessionalAccess(db, account.id, matterId);

  const [{ data: matter }, { data: events }, { data: reviews }] = await Promise.all([
    db.from('navigator_matters').select('title, created_at').eq('id', matterId).maybeSingle(),
    db.from('navigator_events').select('*').eq('matter_id', matterId).order('date_lower_bound', { ascending: true }),
    db.from('professional_reviews').select('*').eq('matter_id', matterId).eq('reviewer_account_id', account.id).eq('finding_type', 'CHRONOLOGY')
  ]);

  const timestamp = new Date().toISOString();

  return {
    outputType: 'CHRONOLOGY',
    matterId,
    matterTitle: matter?.title || 'Untitled Matter',
    generatedAt: timestamp,
    disclaimer: LEGAL_DISCLAIMER,
    events: (events || []).map((evt: any) => {
      const review = (reviews || []).find((r: any) => r.finding_id === evt.id);
      return {
        id: evt.id,
        dateText: evt.date_original_text || 'Unknown Date',
        datePrecision: evt.date_precision || 'UNKNOWN',
        dateLowerBound: evt.date_lower_bound,
        dateUpperBound: evt.date_upper_bound,
        description: evt.description,
        provenance: {
          matterId,
          canonicalId: evt.id,
          sourceDocumentId: evt.document_id || null,
          pageNumber: evt.page_number || null,
          hasSourceProvenance: Boolean(evt.document_id || evt.page_id)
        },
        aiClassification: 'AI-ASSISTED CHRONOLOGY (DRAFT)',
        professionalReview: review ? {
          reviewState: review.review_state,
          reviewNote: review.review_note,
          updatedAt: review.updated_at
        } : null
      };
    })
  };
}

/**
 * Output C: Evidence & Issues Package Output
 */
export async function getEvidenceIssuesPackageOutput(firebaseUid: string, matterId: string) {
  matterId = requireUuid(matterId, 'matterId');
  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const db = getSupabase();
  await requireProfessionalAccess(db, account.id, matterId);

  const [{ data: matter }, { data: evidence }, { data: claims }, { data: gaps }, { data: reviews }] = await Promise.all([
    db.from('navigator_matters').select('title, created_at').eq('id', matterId).maybeSingle(),
    db.from('navigator_evidence_items').select('*').eq('matter_id', matterId),
    db.from('navigator_claims').select('*').eq('matter_id', matterId),
    db.from('navigator_evidence_gap_findings').select('*').eq('matter_id', matterId),
    db.from('professional_reviews').select('*').eq('matter_id', matterId).eq('reviewer_account_id', account.id)
  ]);

  const timestamp = new Date().toISOString();

  return {
    outputType: 'EVIDENCE_ISSUES_PACKAGE',
    matterId,
    matterTitle: matter?.title || 'Untitled Matter',
    generatedAt: timestamp,
    disclaimer: LEGAL_DISCLAIMER,
    evidenceItems: (evidence || []).map((ev: any) => {
      const review = (reviews || []).find((r: any) => r.finding_type === 'EVIDENCE' && r.finding_id === ev.id);
      const isExactQuoteVerified = ev.quote_verification === 'EXACT' || ev.quote_verification === 'NORMALIZED_WHITESPACE';
      
      return {
        id: ev.id,
        classification: ev.classification || 'UNKNOWN',
        normalizedStatement: ev.normalized_statement,
        exactQuote: isExactQuoteVerified ? ev.exact_quote : null,
        quoteVerificationStatus: ev.quote_verification || 'SOURCE_REVIEW_REQUIRED',
        provenance: {
          matterId,
          documentId: ev.document_id || null,
          versionId: ev.document_version_id || null,
          pageNumber: ev.page_number || null
        },
        aiLabel: 'AI-GENERATED EXTRACTION',
        professionalReview: review ? {
          reviewState: review.review_state,
          reviewNote: review.review_note
        } : null
      };
    }),
    materialClaims: (claims || []).map((c: any) => {
      const review = (reviews || []).find((r: any) => r.finding_type === 'CLAIMS' && r.finding_id === c.id);
      return {
        id: c.id,
        claimText: c.claim_text,
        classification: c.classification || 'UNVERIFIED_CLAIM',
        aiLabel: 'AI-GENERATED CLAIM',
        professionalReview: review ? {
          reviewState: review.review_state,
          reviewNote: review.review_note
        } : null
      };
    }),
    evidenceGaps: (gaps || []).map((g: any) => {
      const review = (reviews || []).find((r: any) => r.finding_type === 'GAPS' && r.finding_id === g.id);
      return {
        id: g.id,
        gapType: g.gap_type,
        description: g.description,
        aiLabel: 'AI-IDENTIFIED GAP',
        professionalReview: review ? {
          reviewState: review.review_state,
          reviewNote: review.review_note
        } : null
      };
    })
  };
}
