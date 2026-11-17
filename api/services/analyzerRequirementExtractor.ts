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

import { createHash } from 'node:crypto';
import { getSupabase } from './access.js';
import { findAccount } from './accounts.js';
import { LifecycleError, requireUuid } from './lifecycleErrors.js';
import { normalizeQuoteWhitespace } from './pageSources.js';
import {
  requireMatterAccess,
  calculateIsOverdue,
  type AuthorityType,
  type ProvenanceType,
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

  // Accept only unambiguous ISO dates. Date.parse accepts vague English dates,
  // which could silently turn a model guess into a court deadline.
  if (!/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2}))?$/.test(trimmed)) return null;
  const calendarDate = trimmed.slice(0, 10);
  const calendarTime = Date.parse(calendarDate + 'T00:00:00.000Z');
  if (!Number.isFinite(calendarTime) || new Date(calendarTime).toISOString().slice(0, 10) !== calendarDate) return null;
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(trimmed);
  if (!dateOnly && (+trimmed.slice(11, 13) > 23 || +trimmed.slice(14, 16) > 59 || +trimmed.slice(17, 19) > 59)) return null;
  const parsed = Date.parse(dateOnly ? trimmed + 'T00:00:00.000Z' : trimmed);
  if (!Number.isFinite(parsed)) return null;
  const iso = new Date(parsed).toISOString();
  if (dateOnly && iso.slice(0, 10) !== trimmed) return null;
  return iso;
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
    return 'NAVIGATOR_SUGGESTED';
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
  const documentVersionId = requireUuid(payload.documentVersionId, 'documentVersionId');

  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const db = getSupabase();
  const access = await requireMatterAccess(db, account.id, matterId);

  // 1. Cross-matter document protection
  const { data: doc, error: docErr } = await db
    .from('navigator_documents')
    .select('id, matter_id, display_name')
    .eq('id', documentId)
    .single();

  if (docErr || !doc || doc.matter_id !== matterId) {
    throw new LifecycleError(400, 'INVALID_REFERENCE', 'Document does not belong to this matter');
  }

  // 2. Cross-matter document version protection
  if (documentVersionId) {
    const { data: ver, error: verErr } = await db
      .from('navigator_document_versions')
      .select('id, document_id')
      .eq('id', documentVersionId)
      .single();

    if (verErr || !ver || ver.document_id !== documentId) {
      throw new LifecycleError(400, 'INVALID_REFERENCE', 'Document version does not belong to this document/matter');
    }
  }

  const candidatesInput = payload.candidates;
  if (!Array.isArray(candidatesInput) || candidatesInput.length === 0) {
    return { extractedCount: 0, items: [], skippedDuplicates: 0, rejectedCandidates: 0, auditRecorded: true, notice: 'No actionable candidates found in document payload.' };
  }
  if (candidatesInput.length > 500) {
    throw new LifecycleError(400, 'INVALID_INPUT', 'Import at most 500 findings at a time.');
  }

  // Browser-supplied documentText is never authoritative. Page text is immutable
  // for the exact stored version already validated through its parent document.
  const { data: pages, error: pagesError } = await db
    .from('navigator_document_pages')
    .select('page_number, text')
    .eq('document_version_id', documentVersionId);
  if (pagesError || !Array.isArray(pages) || pages.length === 0) {
    throw new LifecycleError(503, 'SOURCE_UNAVAILABLE', 'Stored source pages are unavailable. Save the source version before retrying this import. No new analysis is needed.');
  }

  const { data: existingReqs, error: existingError } = await db
    .from('navigator_case_requirements')
    .select('id, title, source_document_id, source_document_version_id, source_page_number, source_exact_quote')
    .eq('matter_id', matterId);
  if (existingError) throw new LifecycleError(503, 'IMPORT_UNAVAILABLE', 'Could not check previous imports. Retry without analyzing again.');
  const existingList = existingReqs || [];

  const insertedItems: any[] = [];
  let skippedDuplicates = 0;
  let rejectedCandidates = 0;

  for (const candidate of candidatesInput) {
    // Validate required title
    if (!candidate || typeof candidate.title !== 'string' || !candidate.title.trim() || candidate.title.length > 500) {
      rejectedCandidates++;
      continue; // Reject malformed candidates
    }

    // Provenance requirement: Must have document reference and valid quote/page
    const exactQuote = typeof candidate.sourceExactQuote === 'string' ? candidate.sourceExactQuote.trim() : null;
    const pageNum = Number.isSafeInteger(candidate.sourcePageNumber) && candidate.sourcePageNumber! > 0 ? candidate.sourcePageNumber! : null;
    const sourcePage = pages.find((page: any) => page.page_number === pageNum);
    if (candidate.sourceDocumentId !== documentId ||
        (candidate.sourceDocumentVersionId && candidate.sourceDocumentVersionId !== documentVersionId) ||
        !exactQuote || exactQuote.length > 2000 || !sourcePage ||
        !verifyQuoteInDocumentText(sourcePage.text, exactQuote)) {
      rejectedCandidates++;
      continue;
    }

    // Check confidence threshold if provided
    if (candidate.confidence != null && (typeof candidate.confidence !== 'number' || !Number.isFinite(candidate.confidence) || candidate.confidence < 0.5 || candidate.confidence > 1)) {
      rejectedCandidates++;
      continue; // Omit invalid or low confidence candidate
    }

    const titleTrimmed = candidate.title.trim();
    const authorityType = sanitizeAuthorityType(candidate.proposedAuthorityType, `${doc.display_name || ''} ${exactQuote}`);
    // A syntactically valid model date is still a guess unless its ISO date
    // appears in the verified quotation. Human review can set other deadlines.
    const parsedDueAt = parseExplicitDueDate(candidate.explicitDueDate);
    const dueAt = parsedDueAt && exactQuote.includes(candidate.explicitDueDate!.trim()) ? parsedDueAt : null;

    // Deduplication Check
    const normQuoteCandidate = exactQuote ? normalizeQuoteWhitespace(exactQuote) : '';
    const normTitleCandidate = normalizeQuoteWhitespace(titleTrimmed).toLowerCase();

    const isDuplicate = existingList.some((ex: any) =>
      ex.source_document_id === documentId &&
      ex.source_document_version_id === documentVersionId &&
      ex.source_page_number === pageNum &&
      normalizeQuoteWhitespace(ex.source_exact_quote || '') === normQuoteCandidate &&
      normalizeQuoteWhitespace(ex.title || '').toLowerCase() === normTitleCandidate
    );

    if (isDuplicate) {
      skippedDuplicates++;
      continue;
    }

    const newRow = {
      // The primary key provides atomic retry/concurrent-import deduplication.
      // Never upsert: a retry must not overwrite a parent's review or correction.
      id: analyzerRequirementId(matterId, documentId, documentVersionId, pageNum!, exactQuote, titleTrimmed),
      matter_id: matterId,
      title: titleTrimmed,
      description: typeof candidate.description === 'string' ? candidate.description.trim().slice(0, 2000) : null,
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
      source_author_or_speaker: typeof candidate.sourceAuthorOrSpeaker === 'string' && verifyQuoteInDocumentText(sourcePage.text, candidate.sourceAuthorOrSpeaker) ? candidate.sourceAuthorOrSpeaker.trim().slice(0, 500) : null,
      source_event_date: parseExplicitDueDate(candidate.sourceEventDate)?.slice(0, 10) && exactQuote.includes(candidate.sourceEventDate!.trim().slice(0, 10)) ? candidate.sourceEventDate!.trim().slice(0, 10) : null,
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
      if (insertErr.code === '23505') {
        skippedDuplicates++;
        continue;
      }
      // Earlier inserts are durable. Stable IDs make a partial retry safe.
      throw new LifecycleError(503, 'IMPORT_INCOMPLETE', 'Some findings could not be saved. Retry this import without analyzing again.');
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

  let auditRecorded = insertedItems.length === 0;
  // Audit event logging
  if (insertedItems.length > 0) {
    try {
      const { error: auditError } = await db.from('navigator_events').insert({
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
      if (auditError) throw new Error('Audit unavailable');
      auditRecorded = true;
    } catch {
      console.warn('[AnalyzerExtractor] Audit event could not be recorded');
    }
  }

  return {
    extractedCount: insertedItems.length,
    items: insertedItems,
    skippedDuplicates,
    rejectedCandidates,
    auditRecorded,
    ...(!auditRecorded ? { notice: 'Findings were saved, but case history could not be recorded.' } : {}),
  };
}

/** Version and location are part of identity; similarly titled claims stay separate. */
export function analyzerRequirementId(matterId: string, documentId: string, versionId: string, page: number, quote: string, title: string): string {
  const digest = createHash('sha256').update(JSON.stringify([
    'casework-requirement-v1', matterId, documentId, versionId, page,
    normalizeQuoteWhitespace(quote), normalizeQuoteWhitespace(title).toLowerCase(),
  ])).digest('hex');
  return `${digest.slice(0, 8)}-${digest.slice(8, 12)}-5${digest.slice(13, 16)}-a${digest.slice(17, 20)}-${digest.slice(20, 32)}`;
}
