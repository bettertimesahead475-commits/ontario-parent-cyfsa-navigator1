import { findAccount } from './accounts.js';
import { getSupabase } from './access.js';
import { LifecycleError, requireUuid } from './lifecycleErrors.js';
import { requireMatterAccess, logAuditEvent } from './caseActionWorkspace.js';

// Explicit public fields: professional/private notes never enter this snapshot,
// even when the exporting caller has permission to read them in the workspace.
const requirementFields = 'id,title,description,authority_type,review_state,completion_state,dispute_state,dispute_type,dispute_note,due_at,source_document_id,source_document_version_id,source_page_number,source_exact_quote,source_event_date';
export async function exportRequirements(uid: string, matterId: string) {
  matterId = requireUuid(matterId, 'matterId');
  const account = await findAccount(uid);
  if (!account) throw new LifecycleError(401, 'UNAUTHORIZED', 'Account not found');
  const db = getSupabase();
  await requireMatterAccess(db, account.id, matterId);
  async function load(table: string, fields: string) {
    const rows: any[] = [];
    let expectedCount: number | null = null;
    while (true) {
      const { data, error, count } = await db.from(table).select(fields, { count: 'exact' })
        .eq('matter_id', matterId).order('id', { ascending: true }).range(rows.length, rows.length + 499);
      if (error || !Array.isArray(data) || typeof count !== 'number' || (expectedCount !== null && count !== expectedCount)) {
        throw new LifecycleError(503, 'EXPORT_UNAVAILABLE', 'The case report could not be loaded consistently. Please retry.');
      }
      expectedCount = count;
      rows.push(...data);
      if (rows.length === count) return rows;
      if (!data.length || rows.length > count || rows.length >= 20000) {
        throw new LifecycleError(503, 'EXPORT_UNAVAILABLE', 'The complete case report could not be loaded. Please retry.');
      }
    }
  }
  const [requirements, actions, links, documents] = await Promise.all([
    load('navigator_case_requirements', requirementFields),
    load('navigator_case_actions', 'id,requirement_id,title,description,status,due_at,completed_at'),
    load('navigator_action_evidence_links', 'id,requirement_id,action_id,evidence_item_id,document_id,document_version_id,title,evidence_type'),
    load('navigator_documents', 'id,display_name'),
  ]);
  // Recheck access after fetching; a revoked membership must not receive a snapshot.
  await requireMatterAccess(db, account.id, matterId);
  return {
    filename: `casework-requirements-${matterId}.txt`,
    text: formatRequirementsReport(matterId, requirements, actions, links, documents),
    historyRecorded: await logAuditEvent(db, matterId, account.id, 'CASEWORK_EXPORT_GENERATED', {requirementCount: requirements.length, evidenceLinkCount: links.length}),
    requirementCount: requirements.length,
    evidenceLinkCount: links.length,
  };
}

const value = (v: unknown) => typeof v === 'string' && v.trim() ? v : 'Not recorded';
const date = (v: unknown) => typeof v === 'string' && Number.isFinite(Date.parse(v)) ? v : 'Uncertain / not recorded';
export function formatRequirementsReport(matterId: string, requirements: any[], actions: any[], links: any[], documents: any[]) {
  const lines = [
    'CYFSA Navigator — Requirements and Compliance Report',
    'Draft case-preparation material. Review with your lawyer. This is not a certified court document.',
    'PROPOSED items have not been confirmed. A quotation supports attribution, not the truth of an allegation.',
    `Matter: ${matterId}`, '',
  ];
  const documentName = (id: string) => documents.find(d => d.id === id)?.display_name || 'Document name unavailable';
  for (const req of requirements) {
    lines.push(`Requirement: ${value(req.title)} [${req.id}]`,
      `Authority: ${value(req.authority_type)} | Review: ${value(req.review_state)}`,
      `Completion: ${value(req.completion_state)} | Dispute: ${value(req.dispute_state)}`,
      `Due date: ${date(req.due_at)} | Alleged event date: ${date(req.source_event_date)}`,
      `Description: ${value(req.description)}`,
      `Dispute: ${value(req.dispute_type)} — ${value(req.dispute_note)}`,
      `Source: ${req.source_document_id ? documentName(req.source_document_id) : 'No document linked'}`,
      `Document ID: ${value(req.source_document_id)} | Version: ${value(req.source_document_version_id)} | Page: ${Number.isSafeInteger(req.source_page_number) && req.source_page_number > 0 ? req.source_page_number : 'Not recorded'}`,
      'Supporting quotation (retained source text; verification is not inferred for legacy records):',
      value(req.source_exact_quote));
    for (const action of actions.filter(a => a.requirement_id === req.id)) {
      lines.push(`Action [${action.id}]: ${value(action.title)} | ${value(action.status)} | Due: ${date(action.due_at)}`);
    }
    for (const link of links.filter(e => e.requirement_id === req.id)) {
      lines.push(`Evidence link [${link.id}]: ${value(link.title)} | ${value(link.evidence_type)}`,
        `Evidence ID: ${value(link.evidence_item_id)} | Document: ${value(link.document_id)} | Version: ${value(link.document_version_id)} | Action: ${value(link.action_id)}`);
    }
    lines.push('');
  }
  if (!requirements.length) lines.push('No requirements are recorded in this matter.');
  return lines.join('\n');
}
