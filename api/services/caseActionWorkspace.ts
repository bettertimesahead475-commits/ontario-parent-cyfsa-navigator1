/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Post-Launch Case-Action Workspace Service (Batch 1)
 * Backend foundation for Requirement -> Action -> Evidence -> Progress tracking.
 */

import { getSupabase } from './access.js';
import { findAccount } from './accounts.js';
import { LifecycleError, requireUuid } from './lifecycleErrors.js';

export type AuthorityType =
  | 'COURT_ORDERED'
  | 'STATUTORY_REGULATORY'
  | 'CAS_REQUESTED'
  | 'SERVICE_PROVIDER_REQUESTED'
  | 'AGREED_CONSENTED'
  | 'LAWYER_REQUESTED'
  | 'NAVIGATOR_SUGGESTED'
  | 'PARENT_CREATED';

export type ReviewState = 'PROPOSED' | 'CONFIRMED' | 'REJECTED' | 'ARCHIVED';

export type CompletionState =
  | 'NOT_STARTED'
  | 'IN_PROGRESS'
  | 'COMPLETED'
  | 'NOT_APPLICABLE'
  | 'SUPERSEDED';

export type DisputeState = 'NOT_DISPUTED' | 'DISPUTED' | 'RESOLVED';

export type DisputeType =
  | 'NO_LEGAL_AUTHORITY'
  | 'FACTUALLY_INACCURATE'
  | 'UNREASONABLE_CONDITION'
  | 'IMPOSSIBLE_DEADLINE'
  | 'OTHER';

export type ProvenanceType =
  | 'DOCUMENT_ANALYZER_EXTRACTED'
  | 'COURT_ORDER_PARSED'
  | 'CAS_CORRESPONDENCE'
  | 'PROFESSIONAL_RECOMMENDED'
  | 'PARENT_MANUAL_ENTRY';

export type EvidenceType =
  | 'COMPLETION_CERTIFICATE'
  | 'ATTENDANCE_RECORD'
  | 'SCREENING_RESULT'
  | 'RECEIPT_PROOF'
  | 'CORRESPONDENCE_EMAIL_TEXT'
  | 'COURT_FILING_STAMP'
  | 'PARENT_JOURNAL_LOG'
  | 'PHOTO_EVIDENCE';

export interface CaseRequirementInput {
  title: string;
  description?: string | null;
  authorityType: AuthorityType;
  reviewState?: ReviewState;
  completionState?: CompletionState;
  dueAt?: string | null;
  provenanceType?: ProvenanceType | null;
  sourceDocumentId?: string | null;
  sourceDocumentVersionId?: string | null;
  sourcePageNumber?: number | null;
  sourceExactQuote?: string | null;
  sourceAuthorOrSpeaker?: string | null;
  sourceEventDate?: string | null;
  linkedLegalProvisionId?: string | null;
  lawyerNotes?: string | null;
}

export interface CaseActionInput {
  title: string;
  description?: string | null;
  dueAt?: string | null;
  sortOrder?: number;
}

export interface EvidenceLinkInput {
  actionId?: string | null;
  evidenceItemId?: string | null;
  documentId?: string | null;
  documentVersionId?: string | null;
  evidenceType: EvidenceType;
  title: string;
  notes?: string | null;
}

/**
 * Authorizes that the account belongs to the matter either as OWNER or REVIEWER.
 * Throws LifecycleError 403 if unapproved or unrelated.
 */
export async function requireMatterAccess(db: any, accountId: string, matterId: string) {
  const { data: member, error } = await db
    .from('navigator_matter_members')
    .select('role')
    .eq('matter_id', matterId)
    .eq('account_id', accountId)
    .single();

  if (error || !member) {
    throw new LifecycleError(403, 'UNAUTHORIZED', 'You do not have access to this matter.');
  }

  return {
    role: member.role,
    isOwner: member.role === 'OWNER',
    isReviewer: member.role === 'REVIEWER',
  };
}

/**
 * Derives overdue status dynamically based on current time and completion state.
 */
export function calculateIsOverdue(dueAt: string | null | undefined, completionState: CompletionState): boolean {
  if (!dueAt) return false;
  if (completionState === 'COMPLETED' || completionState === 'SUPERSEDED' || completionState === 'NOT_APPLICABLE') {
    return false;
  }
  return new Date(dueAt).getTime() < Date.now();
}

/**
 * Logs safe audit events into navigator_events.
 */
async function logAuditEvent(db: any, matterId: string, accountId: string, eventType: string, payload: Record<string, any>) {
  try {
    await db.from('navigator_events').insert({
      matter_id: matterId,
      actor_account_id: accountId,
      event_type: eventType,
      payload,
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    console.warn(`[CaseActionWorkspace] Audit event warning (${eventType}):`, e);
  }
}

// ---------------------------------------------------------------------------
// REQUIREMENT SERVICES
// ---------------------------------------------------------------------------

export async function listRequirements(
  firebaseUid: string,
  matterId: string,
  filters: { reviewState?: ReviewState; completionState?: CompletionState; disputeState?: DisputeState; authorityType?: AuthorityType } = {}
) {
  matterId = requireUuid(matterId, 'matterId');
  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const db = getSupabase();
  await requireMatterAccess(db, account.id, matterId);

  let query = db
    .from('navigator_case_requirements')
    .select('*')
    .eq('matter_id', matterId);

  if (filters.reviewState) query = query.eq('review_state', filters.reviewState);
  if (filters.completionState) query = query.eq('completion_state', filters.completionState);
  if (filters.disputeState) query = query.eq('dispute_state', filters.disputeState);
  if (filters.authorityType) query = query.eq('authority_type', filters.authorityType);

  const { data, error } = await query.order('created_at', { ascending: false });
  if (error) throw new LifecycleError(500, 'DB_ERROR', `Failed to list requirements: ${error.message}`);

  return (data || []).map((row: any) => ({
    ...row,
    isOverdue: calculateIsOverdue(row.due_at, row.completion_state),
  }));
}

export async function getRequirement(firebaseUid: string, matterId: string, requirementId: string) {
  matterId = requireUuid(matterId, 'matterId');
  requirementId = requireUuid(requirementId, 'requirementId');

  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const db = getSupabase();
  await requireMatterAccess(db, account.id, matterId);

  const [reqRes, actionsRes, evidenceRes] = await Promise.all([
    db.from('navigator_case_requirements').select('*').eq('id', requirementId).eq('matter_id', matterId).single(),
    db.from('navigator_case_actions').select('*').eq('requirement_id', requirementId).eq('matter_id', matterId).order('sort_order', { ascending: true }),
    db.from('navigator_action_evidence_links').select('*').eq('requirement_id', requirementId).eq('matter_id', matterId),
  ]);

  if (reqRes.error || !reqRes.data) throw new LifecycleError(404, 'NOT_FOUND', 'Requirement not found');

  return {
    ...reqRes.data,
    isOverdue: calculateIsOverdue(reqRes.data.due_at, reqRes.data.completion_state),
    actions: actionsRes.data || [],
    evidenceLinks: evidenceRes.data || [],
  };
}

export async function createRequirement(firebaseUid: string, matterId: string, input: CaseRequirementInput) {
  matterId = requireUuid(matterId, 'matterId');
  if (!input.title || !input.title.trim()) throw new LifecycleError(400, 'INVALID_INPUT', 'Requirement title is required');
  if (!input.authorityType) throw new LifecycleError(400, 'INVALID_INPUT', 'Requirement authorityType is required');

  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const db = getSupabase();
  const access = await requireMatterAccess(db, account.id, matterId);

  // Validate cross-matter source document if supplied
  if (input.sourceDocumentId) {
    const { data: doc } = await db.from('navigator_documents').select('matter_id').eq('id', input.sourceDocumentId).single();
    if (!doc || doc.matter_id !== matterId) {
      throw new LifecycleError(400, 'INVALID_REFERENCE', 'Source document does not belong to this matter');
    }
  }

  const newRow = {
    matter_id: matterId,
    title: input.title.trim(),
    description: input.description ?? null,
    authority_type: input.authorityType,
    review_state: input.reviewState ?? 'CONFIRMED',
    completion_state: input.completionState ?? 'NOT_STARTED',
    dispute_state: 'NOT_DISPUTED',
    due_at: input.dueAt ?? null,
    provenance_type: input.provenanceType ?? 'PARENT_MANUAL_ENTRY',
    source_document_id: input.sourceDocumentId ?? null,
    source_document_version_id: input.sourceDocumentVersionId ?? null,
    source_page_number: input.sourcePageNumber ?? null,
    source_exact_quote: input.sourceExactQuote ? input.sourceExactQuote.slice(0, 2000) : null,
    source_author_or_speaker: input.sourceAuthorOrSpeaker ?? null,
    source_event_date: input.sourceEventDate ?? null,
    linked_legal_provision_id: input.linkedLegalProvisionId ?? null,
    lawyer_notes: access.isReviewer ? (input.lawyerNotes ?? null) : null,
    verified_by_lawyer_at: access.isReviewer && input.lawyerNotes ? new Date().toISOString() : null,
    created_by_account_id: account.id,
    updated_by_account_id: account.id,
  };

  const { data, error } = await db.from('navigator_case_requirements').insert(newRow).select().single();
  if (error) throw new LifecycleError(500, 'DB_ERROR', `Failed to create requirement: ${error.message}`);

  await logAuditEvent(db, matterId, account.id, 'CASE_REQUIREMENT_CREATED', {
    requirementId: data.id,
    authorityType: data.authority_type,
    reviewState: data.review_state,
  });

  return data;
}

export async function updateRequirement(firebaseUid: string, matterId: string, requirementId: string, updates: Partial<CaseRequirementInput> & { completionState?: CompletionState; disputeState?: DisputeState }) {
  matterId = requireUuid(matterId, 'matterId');
  requirementId = requireUuid(requirementId, 'requirementId');

  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const db = getSupabase();
  const access = await requireMatterAccess(db, account.id, matterId);

  const existing = await getRequirement(firebaseUid, matterId, requirementId);

  const patch: Record<string, any> = {
    updated_by_account_id: account.id,
    updated_at: new Date().toISOString(),
  };

  if (updates.title !== undefined) patch.title = updates.title.trim();
  if (updates.description !== undefined) patch.description = updates.description;
  if (updates.authorityType !== undefined && updates.authorityType !== existing.authority_type) {
    patch.authority_type = updates.authorityType;
  }
  if (updates.reviewState !== undefined) patch.review_state = updates.reviewState;
  if (updates.completionState !== undefined) {
    patch.completion_state = updates.completionState;
    if (updates.completionState === 'COMPLETED' && !existing.completed_at) {
      patch.completed_at = new Date().toISOString();
    }
  }
  if (updates.dueAt !== undefined) patch.due_at = updates.dueAt;

  // Lawyer/Professional specific notes
  if (updates.lawyerNotes !== undefined) {
    if (!access.isReviewer && !access.isOwner) {
      throw new LifecycleError(403, 'UNAUTHORIZED', 'Only authorized reviewers or matter owners can add professional notes');
    }
    patch.lawyer_notes = updates.lawyerNotes;
    if (access.isReviewer) patch.verified_by_lawyer_at = new Date().toISOString();
  }

  const { data, error } = await db
    .from('navigator_case_requirements')
    .update(patch)
    .eq('id', requirementId)
    .eq('matter_id', matterId)
    .select()
    .single();

  if (error) throw new LifecycleError(500, 'DB_ERROR', `Failed to update requirement: ${error.message}`);

  if (updates.authorityType && updates.authorityType !== existing.authority_type) {
    await logAuditEvent(db, matterId, account.id, 'CASE_REQUIREMENT_AUTHORITY_CHANGED', {
      requirementId,
      priorAuthorityType: existing.authority_type,
      newAuthorityType: updates.authorityType,
    });
  }

  return data;
}

export async function confirmRequirement(firebaseUid: string, matterId: string, requirementId: string) {
  return updateRequirement(firebaseUid, matterId, requirementId, { reviewState: 'CONFIRMED' });
}

export async function rejectRequirement(firebaseUid: string, matterId: string, requirementId: string) {
  return updateRequirement(firebaseUid, matterId, requirementId, { reviewState: 'REJECTED' });
}

export async function archiveRequirement(firebaseUid: string, matterId: string, requirementId: string) {
  return updateRequirement(firebaseUid, matterId, requirementId, { reviewState: 'ARCHIVED' });
}

export async function setRequirementDispute(firebaseUid: string, matterId: string, requirementId: string, disputeType: DisputeType, disputeNote?: string | null) {
  matterId = requireUuid(matterId, 'matterId');
  requirementId = requireUuid(requirementId, 'requirementId');

  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const db = getSupabase();
  await requireMatterAccess(db, account.id, matterId);

  const patch = {
    dispute_state: 'DISPUTED' as DisputeState,
    dispute_type: disputeType,
    dispute_note: disputeNote ?? null,
    updated_by_account_id: account.id,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await db
    .from('navigator_case_requirements')
    .update(patch)
    .eq('id', requirementId)
    .eq('matter_id', matterId)
    .select()
    .single();

  if (error) throw new LifecycleError(500, 'DB_ERROR', `Failed to set requirement dispute: ${error.message}`);

  await logAuditEvent(db, matterId, account.id, 'CASE_REQUIREMENT_DISPUTED', {
    requirementId,
    disputeType,
  });

  return data;
}

export async function resolveRequirementDispute(firebaseUid: string, matterId: string, requirementId: string, resolutionNote?: string | null) {
  matterId = requireUuid(matterId, 'matterId');
  requirementId = requireUuid(requirementId, 'requirementId');

  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const db = getSupabase();
  await requireMatterAccess(db, account.id, matterId);

  const patch = {
    dispute_state: 'RESOLVED' as DisputeState,
    dispute_note: resolutionNote ?? null,
    updated_by_account_id: account.id,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await db
    .from('navigator_case_requirements')
    .update(patch)
    .eq('id', requirementId)
    .eq('matter_id', matterId)
    .select()
    .single();

  if (error) throw new LifecycleError(500, 'DB_ERROR', `Failed to resolve dispute: ${error.message}`);

  await logAuditEvent(db, matterId, account.id, 'CASE_REQUIREMENT_DISPUTE_RESOLVED', { requirementId });

  return data;
}

// ---------------------------------------------------------------------------
// ACTION / TASK SERVICES
// ---------------------------------------------------------------------------

export async function listActions(firebaseUid: string, matterId: string, requirementId: string) {
  matterId = requireUuid(matterId, 'matterId');
  requirementId = requireUuid(requirementId, 'requirementId');

  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const db = getSupabase();
  await requireMatterAccess(db, account.id, matterId);

  const { data, error } = await db
    .from('navigator_case_actions')
    .select('*')
    .eq('requirement_id', requirementId)
    .eq('matter_id', matterId)
    .order('sort_order', { ascending: true });

  if (error) throw new LifecycleError(500, 'DB_ERROR', `Failed to list actions: ${error.message}`);
  return data || [];
}

export async function createAction(firebaseUid: string, matterId: string, requirementId: string, input: CaseActionInput) {
  matterId = requireUuid(matterId, 'matterId');
  requirementId = requireUuid(requirementId, 'requirementId');

  if (!input.title || !input.title.trim()) throw new LifecycleError(400, 'INVALID_INPUT', 'Action title is required');

  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const db = getSupabase();
  await requireMatterAccess(db, account.id, matterId);

  // Validate requirement belongs to matterId
  const { data: req } = await db.from('navigator_case_requirements').select('id, matter_id').eq('id', requirementId).single();
  if (!req || req.matter_id !== matterId) {
    throw new LifecycleError(400, 'INVALID_REFERENCE', 'Requirement does not belong to this matter');
  }

  const newRow = {
    matter_id: matterId,
    requirement_id: requirementId,
    title: input.title.trim(),
    description: input.description ?? null,
    status: 'PENDING',
    due_at: input.dueAt ?? null,
    sort_order: input.sortOrder ?? 0,
    created_by_account_id: account.id,
    updated_by_account_id: account.id,
  };

  const { data, error } = await db.from('navigator_case_actions').insert(newRow).select().single();
  if (error) throw new LifecycleError(500, 'DB_ERROR', `Failed to create action: ${error.message}`);

  await logAuditEvent(db, matterId, account.id, 'CASE_ACTION_CREATED', { actionId: data.id, requirementId });

  return data;
}

export async function completeAction(firebaseUid: string, matterId: string, actionId: string) {
  matterId = requireUuid(matterId, 'matterId');
  actionId = requireUuid(actionId, 'actionId');

  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const db = getSupabase();
  await requireMatterAccess(db, account.id, matterId);

  const { data, error } = await db
    .from('navigator_case_actions')
    .update({
      status: 'COMPLETED',
      completed_at: new Date().toISOString(),
      updated_by_account_id: account.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', actionId)
    .eq('matter_id', matterId)
    .select()
    .single();

  if (error) throw new LifecycleError(500, 'DB_ERROR', `Failed to complete action: ${error.message}`);

  await logAuditEvent(db, matterId, account.id, 'CASE_ACTION_COMPLETED', { actionId });

  return data;
}

export async function reopenAction(firebaseUid: string, matterId: string, actionId: string) {
  matterId = requireUuid(matterId, 'matterId');
  actionId = requireUuid(actionId, 'actionId');

  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const db = getSupabase();
  await requireMatterAccess(db, account.id, matterId);

  const { data, error } = await db
    .from('navigator_case_actions')
    .update({
      status: 'IN_PROGRESS',
      completed_at: null,
      updated_by_account_id: account.id,
      updated_at: new Date().toISOString(),
    })
    .eq('id', actionId)
    .eq('matter_id', matterId)
    .select()
    .single();

  if (error) throw new LifecycleError(500, 'DB_ERROR', `Failed to reopen action: ${error.message}`);

  await logAuditEvent(db, matterId, account.id, 'CASE_ACTION_REOPENED', { actionId });

  return data;
}

// ---------------------------------------------------------------------------
// EVIDENCE LINK SERVICES
// ---------------------------------------------------------------------------

export async function attachEvidenceLink(firebaseUid: string, matterId: string, requirementId: string, input: EvidenceLinkInput) {
  matterId = requireUuid(matterId, 'matterId');
  requirementId = requireUuid(requirementId, 'requirementId');

  if (!input.title || !input.title.trim()) throw new LifecycleError(400, 'INVALID_INPUT', 'Evidence title is required');
  if (!input.evidenceType) throw new LifecycleError(400, 'INVALID_INPUT', 'evidenceType is required');

  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const db = getSupabase();
  await requireMatterAccess(db, account.id, matterId);

  // Validate requirement belongs to matter
  const { data: req } = await db.from('navigator_case_requirements').select('id, matter_id, completion_state').eq('id', requirementId).single();
  if (!req || req.matter_id !== matterId) {
    throw new LifecycleError(400, 'INVALID_REFERENCE', 'Requirement does not belong to this matter');
  }

  // Validate cross-matter evidence item if supplied
  if (input.evidenceItemId) {
    const { data: item } = await db.from('navigator_evidence_items').select('matter_id').eq('id', input.evidenceItemId).single();
    if (!item || item.matter_id !== matterId) {
      throw new LifecycleError(400, 'INVALID_REFERENCE', 'Evidence item does not belong to this matter');
    }
  }

  // Validate cross-matter document if supplied
  if (input.documentId) {
    const { data: doc } = await db.from('navigator_documents').select('matter_id').eq('id', input.documentId).single();
    if (!doc || doc.matter_id !== matterId) {
      throw new LifecycleError(400, 'INVALID_REFERENCE', 'Document does not belong to this matter');
    }
  }

  const newLink = {
    matter_id: matterId,
    requirement_id: requirementId,
    action_id: input.actionId ?? null,
    evidence_item_id: input.evidenceItemId ?? null,
    document_id: input.documentId ?? null,
    document_version_id: input.documentVersionId ?? null,
    evidence_type: input.evidenceType,
    title: input.title.trim(),
    notes: input.notes ?? null,
    attached_by_account_id: account.id,
  };

  const { data, error } = await db.from('navigator_action_evidence_links').insert(newLink).select().single();
  if (error) throw new LifecycleError(500, 'DB_ERROR', `Failed to attach evidence link: ${error.message}`);

  // Automatically promote completion_state to IN_PROGRESS if currently NOT_STARTED
  if (req.completion_state === 'NOT_STARTED') {
    await db.from('navigator_case_requirements').update({ completion_state: 'IN_PROGRESS' }).eq('id', requirementId);
  }

  await logAuditEvent(db, matterId, account.id, 'CASE_EVIDENCE_LINKED', { linkId: data.id, requirementId });

  return data;
}

export async function unlinkEvidenceLink(firebaseUid: string, matterId: string, linkId: string) {
  matterId = requireUuid(matterId, 'matterId');
  linkId = requireUuid(linkId, 'linkId');

  const account = await findAccount(firebaseUid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');

  const db = getSupabase();
  await requireMatterAccess(db, account.id, matterId);

  const { data: existing } = await db.from('navigator_action_evidence_links').select('id, matter_id, requirement_id').eq('id', linkId).single();
  if (!existing || existing.matter_id !== matterId) {
    throw new LifecycleError(404, 'NOT_FOUND', 'Evidence link not found');
  }

  const { error } = await db.from('navigator_action_evidence_links').delete().eq('id', linkId).eq('matter_id', matterId);
  if (error) throw new LifecycleError(500, 'DB_ERROR', `Failed to unlink evidence: ${error.message}`);

  await logAuditEvent(db, matterId, account.id, 'CASE_EVIDENCE_UNLINKED', { linkId, requirementId: existing.requirement_id });

  return { success: true };
}
