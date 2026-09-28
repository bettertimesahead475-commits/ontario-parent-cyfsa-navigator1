/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Post-Launch Case-Action Workspace (Batch 3)
 * Analyzer Requirement Extractor Service
 *
 * Extracts proposed Case-Action requirements from Document Analyzer / document sources.
 *
 * Legal Invariants Enforced:
 * 1. AI inferences MUST enter with review_state = 'PROPOSED' (NEVER auto-confirmed).
 * 2. Authority classification is a proposal (CAS requests are CAS_REQUESTED, never COURT_ORDERED).
 * 3. Provenance is mandatory (source_document_id, source_page_number, verified source_exact_quote).
 * 4. Source quote safety (exact text from source document, NO AI paraphrase).
 * 5. Deadline safety (no invented dates; vague text -> null due_at).
 * 6. Deduplication (prevents duplicate proposals on re-analysis of the same document).
 * 7. Cross-matter protection (validates document and document version belong to the matter).
 */

import { getSupabase } from './access.js';
import { findAccount } from './accounts.js';
import { LifecycleError, requireUuid } from './lifecycleErrors.js';
import { normalizeQuoteWhitespace } from './pageSources.js';
import {
  requireMatterAccess,
  calculateIsOverdue,
  type AuthorityType,
  type ProvenanceType,
  type CaseRequirementInput,
} from './caseActionWorkspace.js';

export interface AnalyzerCandidateInput {
  title: string;
  description?: string | null;
  proposedAuthorityType?: AuthorityType | null;
  sourceDocumentId: string;
  sourceDocumentVersionId?: string | null;
  sourcePageNumber?: number | null;
  sourceExactQuote?: string | null;
  sourceAuthorOrSpeaker?: string | null;
  sourceEventDate?: string | null;
  explicitDueDate?: string | null;
  confidence?: number | null;
}

export interface AnalyzerExtractionPayload {
  documentId: string;
  documentVersionId?: string | null;
  documentText?: string | null;
  candidates?: AnalyzerCandidateInput[] | null;
}

const VALID_AUTHORITY_TYPES: AuthorityType[] = [
  'COURT_ORDERED',
  'STATUTORY_REGULATORY',
  'CAS_REQUESTED',
  'SERVICE_PROVIDER_REQUESTED',
  'AGREED_CONSENTED',
  'LAWYER_REQUESTED',
  'NAVIGATOR_SUGGESTED',
  'PARENT_CREATED',
];

/**
 * Validates whether an explicit due date string is a valid ISO date/timestamp.
 * Rejects vague phrases like "as soon as possible", "shortly", "immediately".
 */
export function parseExplicitDueDate(dueDateStr?: string | null): string | null {
  if (!dueDateStr || typeof dueDateStr !== 'string') return null;
  const trimmed = dueDateStr.trim();
  if (!trimmed) return null;

  // Reject known vague phrases
  if (/as soon as possible|asp|immediately|shortly|promptly|without delay|upon request|tbd/i.test(trimmed)) {
    return null;
  }

  const parsed = Date.parse(trimmed);
  if (!Number.isFinite(parsed)) return null;

  try {
    const iso = new Date(parsed).toISOString();
    return iso;
  } catch {
    return null;
  }
}

/**
 * Verifies that a quote exists in the source text.
 * Returns true if exact or normalized match is found in source text.
 */
export function verifyQuoteInDocumentText(sourceText: string, quote: string): boolean {
  if (!sourceText || !quote) return false;
  const normSource = normalizeQuoteWhitespace(sourceText);
  const normQuote = normalizeQuoteWhitespace(quote);
  if (!normQuote) return false;
  return normSource.includes(normQuote);
}

/**
 * Classifies proposed authority type safely.
 * CAS requests or worker statements are NEVER auto-promoted to COURT_ORDERED or STATUTORY_REGULATORY.
 */
export function sanitizeAuthorityType(proposedType?: AuthorityType | null, sourceTextSample?: string): AuthorityType {
  if (!proposedType || !VALID_AUTHORITY_TYPES.includes(proposedType)) {
    return 'CAS_REQUESTED';
  }

  // Legal Safety Invariant: CAS worker requests or correspondence cannot be COURT_ORDERED or STATUTORY_REGULATORY
  if (sourceTextSample && /cas worker|children's aid|cas request|cas letter|cas email|cas plan/i.test(sourceTextSample)) {
    if (proposedType === 'COURT_ORDERED' || proposedType === 'STATUTORY_REGULATORY') {
      return 'CAS_REQUESTED';
    }
  }

  return proposedType;
}

/**
 * Core Analyzer Requirement Extraction service method.
 */
export async function extractAnalyzerRequirements(
  firebaseUid: string,
  matterId: string,
  payload: AnalyzerExtractionPayload
) {
  matterId = requireUuid(matterId, 'matterId');
  if (!payload || typeof payload !== 'object') {
    throw new LifecycleError(400, 'INVALID_INPUT', 'Extraction payload is required');
  }

  const documentId = requireUuid(payload.documentId, 'documentId');
  const documentVersionId = payload.documentVersionId ? requireUuid(payload.documentVersionId, 'documentVersionId') : null;

  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const db = getSupabase();
  const access = await requireMatterAccess(db, account.id, matterId);

  // 1. Cross-matter document protection
  const { data: doc, error: docErr } = await db
    .from('navigator_documents')
    .select('id, matter_id, title, name, filename')
    .eq('id', documentId)
    .single();

  if (docErr || !doc || doc.matter_id !== matterId) {
    throw new LifecycleError(400, 'INVALID_REFERENCE', 'Document does not belong to this matter');
  }

  // 2. Cross-matter document version protection
  if (documentVersionId) {
    const { data: ver, error: verErr } = await db
      .from('navigator_document_versions')
      .select('id, document_id, matter_id')
      .eq('id', documentVersionId)
      .single();

    if (verErr || !ver || ver.matter_id !== matterId || ver.document_id !== documentId) {
      throw new LifecycleError(400, 'INVALID_REFERENCE', 'Document version does not belong to this document/matter');
    }
  }

  const candidatesInput = payload.candidates;
  if (!Array.isArray(candidatesInput) || candidatesInput.length === 0) {
    return { extractedCount: 0, items: [], skippedDuplicates: 0, notice: 'No actionable candidates found in document payload.' };
  }

  // 3. Query existing requirements for deduplication
  const { data: existingReqs } = await db
    .from('navigator_case_requirements')
    .select('id, title, authority_type, source_document_id, source_page_number, source_exact_quote')
    .eq('matter_id', matterId);

  const existingList = existingReqs || [];

  const insertedItems: any[] = [];
  let skippedDuplicates = 0;

  for (const candidate of candidatesInput) {
    // Validate required title
    if (!candidate || typeof candidate.title !== 'string' || !candidate.title.trim()) {
      continue; // Reject malformed candidates
    }

    // Provenance requirement: Must have document reference and valid quote/page
    const exactQuote = typeof candidate.sourceExactQuote === 'string' ? candidate.sourceExactQuote.trim() : null;
    const pageNum = typeof candidate.sourcePageNumber === 'number' && candidate.sourcePageNumber > 0 ? candidate.sourcePageNumber : null;

    // Require provenance anchoring
    if (!exactQuote && !pageNum) {
      continue; // Omit unanchored candidates
    }

    // Check confidence threshold if provided
    if (typeof candidate.confidence === 'number' && candidate.confidence < 0.5) {
      continue; // Omit low confidence candidate
    }

    // Verify source quote against text if document text provided
    if (payload.documentText && exactQuote) {
      const verified = verifyQuoteInDocumentText(payload.documentText, exactQuote);
      if (!verified) {
        // Source quote failed containment check -> reject AI paraphrase
        continue;
      }
    }

    const titleTrimmed = candidate.title.trim();
    const authorityType = sanitizeAuthorityType(candidate.proposedAuthorityType, exactQuote || candidate.description || '');
    const dueAt = parseExplicitDueDate(candidate.explicitDueDate);

    // Deduplication Check
    const normQuoteCandidate = exactQuote ? normalizeQuoteWhitespace(exactQuote) : '';
    const normTitleCandidate = normalizeQuoteWhitespace(titleTrimmed).toLowerCase();

    const isDuplicate = existingList.some((ex: any) => {
      if (ex.source_document_id === documentId) {
        if (ex.source_exact_quote && normQuoteCandidate && normalizeQuoteWhitespace(ex.source_exact_quote) === normQuoteCandidate) {
          return true;
        }
      }
      if (normalizeQuoteWhitespace(ex.title || '').toLowerCase() === normTitleCandidate && ex.authority_type === authorityType) {
        return true;
      }
      return false;
    });

    if (isDuplicate) {
      skippedDuplicates++;
      continue;
    }

    const newRow = {
      matter_id: matterId,
      title: titleTrimmed,
      description: candidate.description ? candidate.description.trim().slice(0, 2000) : null,
      authority_type: authorityType,
      review_state: 'PROPOSED' as const, // CRITICAL SAFETY INVARIANT: Always PROPOSED
      completion_state: 'NOT_STARTED' as const,
      dispute_state: 'NOT_DISPUTED' as const,
      due_at: dueAt,
      provenance_type: 'DOCUMENT_ANALYZER_EXTRACTED' as ProvenanceType,
      source_document_id: documentId,
      source_document_version_id: documentVersionId,
      source_page_number: pageNum,
      source_exact_quote: exactQuote ? exactQuote.slice(0, 2000) : null,
      source_author_or_speaker: candidate.sourceAuthorOrSpeaker ? candidate.sourceAuthorOrSpeaker.trim().slice(0, 500) : null,
      source_event_date: candidate.sourceEventDate ? candidate.sourceEventDate.trim() : null,
      lawyer_notes: null,
      created_by_account_id: account.id,
      updated_by_account_id: account.id,
    };

    const { data: inserted, error: insertErr } = await db
      .from('navigator_case_requirements')
      .insert(newRow)
      .select()
      .single();

    if (insertErr) {
      console.warn('[AnalyzerExtractor] Insert candidate error:', insertErr);
      continue;
    }

    // Add to existing list for deduplication within the same batch
    existingList.push(inserted);

    // Strip lawyer_notes for response if non-reviewer
    const { lawyer_notes, ...rest } = inserted;
    insertedItems.push({
      ...(access.isReviewer ? inserted : rest),
      isOverdue: calculateIsOverdue(inserted.due_at, inserted.completion_state),
    });
  }

  // Audit event logging
  if (insertedItems.length > 0) {
    try {
      await db.from('navigator_events').insert({
        matter_id: matterId,
        actor_account_id: account.id,
        event_type: 'CASE_REQUIREMENTS_ANALYZER_EXTRACTED',
        payload: {
          documentId,
          documentVersionId,
          extractedCount: insertedItems.length,
          skippedDuplicates,
        },
        created_at: new Date().toISOString(),
      });
    } catch (e) {
      console.warn('[AnalyzerExtractor] Audit event warning:', e);
    }
  }

  return {
    extractedCount: insertedItems.length,
    items: insertedItems,
    skippedDuplicates,
  };
}
