/**
 * Parent-specific case attribution.
 *
 * Invariants this module enforces:
 * 1. Every allegation belongs to one proceeding and is matched by its internal `id`, which must be unique
 *    across the model. A repeated `id` excludes every record that uses it and blocks drafting in each
 *    proceeding involved. The identifier as written in a document (`sourceRecordId`) is never used for matching.
 * 2. A party is the subject of an allegation only when the allegation records that party as a subject and the
 *    party has a role in the same proceeding. Subjects are never inferred from text, from who made a statement,
 *    or from another proceeding.
 * 3. An allegation with no attributable subject is shared: it is shown to every party in its proceeding and is
 *    attributed to none.
 * 4. Names are compared only after Unicode compatibility normalization, whitespace collapse and lowercasing.
 *    Two parties with the same name are an unresolved alias collision, and parent-specific drafting is blocked
 *    for the parties involved.
 * 5. Blocking issues prevent parent-specific drafting for the parties they reach. An issue with no party list
 *    reaches every party in its proceeding.
 * 6. Source locators are returned exactly as recorded. Nothing is filled in.
 *
 * This is a deterministic model. It does not extract allegations from documents and it is not legal advice.
 */
import type {AuthoritativeEvidenceClassification} from '../../shared/evidenceReview.js';

export type ProceedingRole =
  | 'APPLICANT'
  | 'RESPONDENT'
  | 'CHILD'
  | 'PROPOSED_CAREGIVER'
  | 'EXTENDED_FAMILY'
  | 'OTHER_PARTY'
  | 'UNKNOWN';

/** An allegation is what someone said; a finding must have documentary support to be shown as one. */
export type AttributionKind = 'ALLEGATION' | 'FINDING';

export type AllegationStatus = 'ADMITTED' | 'DISPUTED' | 'CORROBORATED' | 'UNSUPPORTED' | 'UNRESOLVED';

export interface SourceLocator {
  documentId: string;
  page: number | null;
  paragraph: string | null;
  quote: string | null;
}

export interface Party {
  id: string;
  displayName: string;
  aliases: string[];
}

export interface Proceeding {
  id: string;
  fileNumber: string | null;
  applicationDate: string | null;
  childNames: string[];
}

export interface RoleAssignment {
  proceedingId: string;
  partyId: string;
  role: ProceedingRole;
}

export interface Allegation {
  /** Internal identifier, unique across the model. This is the only identifier used for matching. */
  id: string;
  proceedingId: string;
  kind: AttributionKind;
  text: string;
  /** Who made the statement, for example "Applicant (CAS worker)". Not used for attribution. */
  madeBy: string | null;
  /** Parties the allegation concerns. Empty means no subject is recorded. */
  subjectPartyIds: string[];
  status: AllegationStatus;
  classification: AuthoritativeEvidenceClassification;
  source: SourceLocator | null;
  /** Identifier as written in the source document, kept for citation only. Never used for matching. */
  sourceRecordId: string | null;
  responses: string[];
}

export interface ProposedOrder {
  id: string;
  proceedingId: string;
  description: string;
  affectsPartyIds: string[];
  /** A proposed placement or caregiver, when the order names one. */
  proposedCaregiverPartyId: string | null;
  source: SourceLocator | null;
}

export interface CaseModel {
  parties: Party[];
  proceedings: Proceeding[];
  roles: RoleAssignment[];
  allegations: Allegation[];
  orders: ProposedOrder[];
}

export type IssueCode =
  | 'DUPLICATE_ID'
  | 'DUPLICATE_PROCEEDING_ID'
  | 'UNKNOWN_PROCEEDING'
  | 'UNKNOWN_PARTY'
  | 'SUBJECT_NOT_IN_PROCEEDING'
  | 'NO_SUBJECT_IDENTIFIED'
  | 'DUPLICATE_SUBJECT'
  | 'MISSING_LOCATOR'
  | 'MISSING_SOURCE_OF_STATEMENT'
  | 'UNSUPPORTED_STATUS'
  | 'FINDING_WITHOUT_DOCUMENTARY_SOURCE'
  | 'ALIAS_COLLISION'
  | 'MISSING_FILE_NUMBER';

export interface AttributionIssue {
  code: IssueCode;
  proceedingId: string;
  /** The record the issue is about, when it is about one record. */
  recordId: string | null;
  /** Parties the issue reaches. Empty means every party in the proceeding. */
  partyIds: string[];
  /** Blocking issues prevent parent-specific drafting for the parties they reach. */
  blocking: boolean;
  detail: string;
}

export interface ParentReport {
  proceedingId: string;
  fileNumber: string | null;
  partyId: string;
  partyName: string;
  roles: ProceedingRole[];
  /** Allegations whose only attributable subject is this party. */
  specificAllegations: Allegation[];
  /** Allegations attributable to this party and at least one other party in this proceeding. */
  sharedAllegations: Allegation[];
  /** Allegations with no attributable subject. Shown to every party in the proceeding. */
  unattributedAllegations: Allegation[];
  relatedOrders: ProposedOrder[];
  otherPartyRoles: {partyId: string; partyName: string; roles: ProceedingRole[]}[];
  /** Issues this report is entitled to show. */
  issues: AttributionIssue[];
  /** Other proceedings this party is in, listed by ID only. Their content is not merged. */
  otherProceedingIds: string[];
}

export type DraftingPurpose = 'FORM_33B' | 'PLAN_OF_CARE';

export type DraftingContext =
  | {ok: false; missing: string[]}
  | {
      ok: true;
      purpose: DraftingPurpose;
      report: ParentReport;
      verificationStatus: 'FORM_REQUIREMENTS_NOT_VERIFIED';
      disclaimer: string;
    };

/** Conservative name comparison: compatibility form, case and spacing only. Accents are not folded. */
export function normalizeAlias(name: string): string {
  return name
    .normalize('NFKC')
    .replace(/[\u00ad\u200b\u2060\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * A court file number counts only if it has visible text. Whitespace and every format character (for
 * example zero-width and directional marks) are not visible text.
 */
function hasFileNumber(fileNumber: string | null): boolean {
  return fileNumber !== null && fileNumber.normalize('NFKC').replace(/[\s\p{Cf}]/gu, '').length > 0;
}

/** Roles held by known parties in known proceedings, keyed by proceeding. */
function rosterByProceeding(model: CaseModel): Map<string, Set<string>> {
  const parties = new Set(model.parties.map(p => p.id));
  const proceedings = new Set(model.proceedings.map(p => p.id));
  const roster = new Map<string, Set<string>>();
  for (const r of model.roles) {
    if (!parties.has(r.partyId) || !proceedings.has(r.proceedingId)) continue;
    if (!roster.has(r.proceedingId)) roster.set(r.proceedingId, new Set());
    roster.get(r.proceedingId)!.add(r.partyId);
  }
  return roster;
}

/** Allegation IDs that more than one record uses. */
function repeatedIds(model: CaseModel): Set<string> {
  const counts = new Map<string, number>();
  for (const a of model.allegations) counts.set(a.id, (counts.get(a.id) ?? 0) + 1);
  return new Set([...counts].filter(([, n]) => n > 1).map(([id]) => id));
}

/** Recorded subjects with repeats removed, in recorded order. */
function uniqueSubjects(a: Allegation): string[] {
  return [...new Set(a.subjectPartyIds)];
}

/** Subjects that hold a role in the allegation's own proceeding. Any other subject is not attributed. */
function attributableSubjects(a: Allegation, roster: Map<string, Set<string>>): string[] {
  const inProceeding = roster.get(a.proceedingId) ?? new Set<string>();
  return uniqueSubjects(a).filter(pid => inProceeding.has(pid));
}

/** A finding needs a documentary source; an admitted or corroborated status needs a source; no attributable subject means unresolved. */
export function effectiveStatus(a: Allegation, attributed: boolean): AllegationStatus {
  if (!attributed) return 'UNRESOLVED';
  if (a.kind === 'FINDING' && (!a.source || a.classification !== 'DOCUMENTARY')) return 'UNRESOLVED';
  if ((a.status === 'ADMITTED' || a.status === 'CORROBORATED') && !a.source) return 'UNRESOLVED';
  return a.status;
}

/** Allegations this report may use: records in the proceeding whose IDs are not repeated anywhere in the model. */
function usableRecords(model: CaseModel, proceedingId: string): Allegation[] {
  const repeated = repeatedIds(model);
  return model.allegations.filter(a => a.proceedingId === proceedingId && !repeated.has(a.id));
}

/** Every structural and attribution issue in the model, each tagged with its proceeding. */
export function validateCaseModel(model: CaseModel): AttributionIssue[] {
  const issues: AttributionIssue[] = [];
  const parties = new Set(model.parties.map(p => p.id));
  const proceedings = new Set(model.proceedings.map(p => p.id));
  const roster = rosterByProceeding(model);
  const repeated = repeatedIds(model);

  const proceedingCounts = new Map<string, number>();
  for (const p of model.proceedings) proceedingCounts.set(p.id, (proceedingCounts.get(p.id) ?? 0) + 1);
  for (const [id, n] of proceedingCounts) {
    if (n > 1) {
      issues.push({code: 'DUPLICATE_PROCEEDING_ID', proceedingId: id, recordId: null, partyIds: [], blocking: true, detail: 'This proceeding identifier is used by more than one proceeding. Reports and drafting are refused until it is corrected.'});
    }
  }
  for (const p of model.proceedings) {
    if (!hasFileNumber(p.fileNumber)) {
      issues.push({code: 'MISSING_FILE_NUMBER', proceedingId: p.id, recordId: null, partyIds: [], blocking: true, detail: 'The proceeding has no court file number.'});
    }
  }

  for (const r of model.roles) {
    if (!parties.has(r.partyId)) {
      issues.push({code: 'UNKNOWN_PARTY', proceedingId: r.proceedingId, recordId: null, partyIds: [], blocking: true, detail: 'A role refers to a party that is not in the model.'});
    }
    if (!proceedings.has(r.proceedingId)) {
      issues.push({code: 'UNKNOWN_PROCEEDING', proceedingId: r.proceedingId, recordId: null, partyIds: [], blocking: false, detail: 'A role refers to a proceeding that is not in the model.'});
    }
  }

  for (const o of model.orders) {
    if (!proceedings.has(o.proceedingId)) {
      issues.push({code: 'UNKNOWN_PROCEEDING', proceedingId: o.proceedingId, recordId: o.id, partyIds: [], blocking: false, detail: 'An order refers to a proceeding that is not in the model and is not shown in any report.'});
      continue;
    }
    const named = [...o.affectsPartyIds, ...(o.proposedCaregiverPartyId ? [o.proposedCaregiverPartyId] : [])];
    if (named.some(pid => !parties.has(pid))) {
      issues.push({code: 'UNKNOWN_PARTY', proceedingId: o.proceedingId, recordId: o.id, partyIds: [], blocking: true, detail: 'An order names a party that is not in the model.'});
    }
  }

  for (const a of model.allegations) {
    if (!proceedings.has(a.proceedingId)) {
      issues.push({code: 'UNKNOWN_PROCEEDING', proceedingId: a.proceedingId, recordId: a.id, partyIds: [], blocking: false, detail: 'An allegation refers to a proceeding that is not in the model and is not shown in any report.'});
      continue;
    }
    if (repeated.has(a.id)) {
      issues.push({code: 'DUPLICATE_ID', proceedingId: a.proceedingId, recordId: a.id, partyIds: [], blocking: true, detail: 'This allegation identifier is used by more than one record. Those records are excluded from reports until the identifiers are corrected.'});
      continue;
    }

    const subjects = uniqueSubjects(a);
    const attributable = attributableSubjects(a, roster);
    if (subjects.length !== a.subjectPartyIds.length) {
      issues.push({code: 'DUPLICATE_SUBJECT', proceedingId: a.proceedingId, recordId: a.id, partyIds: attributable, blocking: false, detail: 'A subject is recorded more than once. Each party is counted once.'});
    }
    if (subjects.some(s => !attributable.includes(s))) {
      issues.push({code: 'SUBJECT_NOT_IN_PROCEEDING', proceedingId: a.proceedingId, recordId: a.id, partyIds: attributable, blocking: false, detail: 'A recorded subject has no role in this proceeding, so the allegation is not attributed to that subject.'});
    }
    if (subjects.length === 0) {
      issues.push({code: 'NO_SUBJECT_IDENTIFIED', proceedingId: a.proceedingId, recordId: a.id, partyIds: [], blocking: false, detail: 'No subject is recorded. The allegation is shown to every party in the proceeding and attributed to none.'});
    }
    if (!a.madeBy) {
      issues.push({code: 'MISSING_SOURCE_OF_STATEMENT', proceedingId: a.proceedingId, recordId: a.id, partyIds: attributable, blocking: false, detail: 'The person or document making the statement is not recorded.'});
    }
    if (!a.source || a.source.page === null || !a.source.paragraph) {
      issues.push({code: 'MISSING_LOCATOR', proceedingId: a.proceedingId, recordId: a.id, partyIds: attributable, blocking: false, detail: 'The page or paragraph locator is missing.'});
    }
    if (a.kind === 'FINDING' && (!a.source || a.classification !== 'DOCUMENTARY')) {
      issues.push({code: 'FINDING_WITHOUT_DOCUMENTARY_SOURCE', proceedingId: a.proceedingId, recordId: a.id, partyIds: attributable, blocking: false, detail: 'Recorded as a finding without a documentary source. It is shown as unresolved.'});
    }
    if ((a.status === 'ADMITTED' || a.status === 'CORROBORATED') && !a.source) {
      issues.push({code: 'UNSUPPORTED_STATUS', proceedingId: a.proceedingId, recordId: a.id, partyIds: attributable, blocking: false, detail: `Recorded as ${a.status} without a source. It is shown as unresolved.`});
    }
  }

  // Alias collisions: a name held by more than one party is ambiguous in each proceeding where one of them has a role.
  const owners = new Map<string, Set<string>>();
  for (const p of model.parties) {
    for (const name of [p.displayName, ...p.aliases]) {
      const key = normalizeAlias(name);
      if (!key) continue;
      if (!owners.has(key)) owners.set(key, new Set());
      owners.get(key)!.add(p.id);
    }
  }
  for (const [key, ids] of owners) {
    if (ids.size < 2) continue;
    for (const p of model.proceedings) {
      const inProceeding = roster.get(p.id) ?? new Set<string>();
      const colliders = [...ids].filter(pid => inProceeding.has(pid));
      if (colliders.length > 0) {
        issues.push({code: 'ALIAS_COLLISION', proceedingId: p.id, recordId: null, partyIds: colliders, blocking: true, detail: 'A name used by this party is shared with another party. Parent-specific drafting is blocked for the affected parties until the names are distinguished.'});
      }
    }
  }

  return issues;
}

/** An issue reaches a party when it is in the same proceeding and names the party, or names no party. */
function reaches(issue: AttributionIssue, proceedingId: string, partyId: string): boolean {
  return issue.proceedingId === proceedingId && (issue.partyIds.length === 0 || issue.partyIds.includes(partyId));
}

export function buildParentReport(model: CaseModel, proceedingId: string, partyId: string): ParentReport {
  const party = model.parties.find(p => p.id === partyId);
  const proceeding = model.proceedings.find(p => p.id === proceedingId);
  if (!party || !proceeding) throw new Error('Unknown party or proceeding.');
  if (model.proceedings.filter(p => p.id === proceedingId).length !== 1) throw new Error('Proceeding identifier is not unique.');
  const roster = rosterByProceeding(model);
  if (!roster.get(proceedingId)?.has(partyId)) throw new Error('Party has no role in this proceeding.');
  // Party IDs from other proceedings are not shown in this report.
  const partiesInProceeding = roster.get(proceedingId) ?? new Set<string>();
  const inThisProceeding = (pid: string | null) => (pid !== null && partiesInProceeding.has(pid) ? pid : null);
  const rolesIn = (pid: string, inProceedingId: string) =>
    model.roles.filter(r => r.partyId === pid && r.proceedingId === inProceedingId).map(r => r.role);

  const specificAllegations: Allegation[] = [];
  const sharedAllegations: Allegation[] = [];
  const unattributedAllegations: Allegation[] = [];
  for (const a of usableRecords(model, proceedingId)) {
    const attributed = attributableSubjects(a, roster);
    const item: Allegation = {
      ...a,
      subjectPartyIds: uniqueSubjects(a).filter(pid => partiesInProceeding.has(pid)),
      status: effectiveStatus(a, attributed.length > 0),
    };
    if (attributed.length === 0) unattributedAllegations.push(item);
    else if (!attributed.includes(partyId)) continue;
    else if (attributed.length === 1) specificAllegations.push(item);
    else sharedAllegations.push(item);
  }

  return {
    proceedingId,
    fileNumber: proceeding.fileNumber,
    partyId,
    partyName: party.displayName,
    roles: rolesIn(partyId, proceedingId),
    specificAllegations,
    sharedAllegations,
    unattributedAllegations,
    relatedOrders: model.orders
      .filter(o => o.proceedingId === proceedingId && (o.affectsPartyIds.includes(partyId) || o.proposedCaregiverPartyId === partyId))
      .map(o => ({...o, affectsPartyIds: o.affectsPartyIds.filter(pid => partiesInProceeding.has(pid)), proposedCaregiverPartyId: inThisProceeding(o.proposedCaregiverPartyId)})),
    otherPartyRoles: model.parties
      .filter(p => p.id !== partyId && partiesInProceeding.has(p.id))
      .map(p => ({partyId: p.id, partyName: p.displayName, roles: rolesIn(p.id, proceedingId)})),
    issues: validateCaseModel(model).filter(i => reaches(i, proceedingId, partyId)),
    otherProceedingIds: [...new Set(model.roles.filter(r => r.partyId === partyId && r.proceedingId !== proceedingId).map(r => r.proceedingId))],
  };
}

const DRAFT_DISCLAIMER =
  'AI-generated drafting context for a parent-specific document. It is not legal advice, has not been reviewed by counsel, and is not a court-approved document. Confirm the applicable court form and its requirements before use.';

/**
 * Builds a parent-specific drafting context only when the party, file number, role and a proposal are recorded,
 * and no blocking issue reaches the party. Otherwise it lists what is missing.
 */
export function buildDraftingContext(model: CaseModel, proceedingId: string, partyId: string, purpose: DraftingPurpose): DraftingContext {
  const missing: string[] = [];
  const proceeding = model.proceedings.find(p => p.id === proceedingId);
  if (model.proceedings.filter(p => p.id === proceedingId).length > 1) missing.push('unique proceeding identifier');
  else if (!proceeding) missing.push('proceeding');
  else if (!hasFileNumber(proceeding.fileNumber)) missing.push('court file number');
  if (!model.parties.some(p => p.id === partyId)) missing.push('party');
  else if (!rosterByProceeding(model).get(proceedingId)?.has(partyId)) missing.push('party role in this proceeding');
  if (proceeding) {
    const hasProposal = model.orders.some(
      o => o.proceedingId === proceedingId && (o.affectsPartyIds.includes(partyId) || o.proposedCaregiverPartyId === partyId),
    );
    if (!hasProposal) missing.push('proposed arrangement or requested order for this party');
  }
  if (missing.length > 0) return {ok: false, missing};

  const report = buildParentReport(model, proceedingId, partyId);
  const blocking = report.issues.filter(i => i.blocking);
  if (blocking.length > 0) {
    return {ok: false, missing: blocking.map(i => `resolve ${i.code}${i.recordId ? ` for record ${i.recordId}` : ''}`)};
  }
  return {ok: true, purpose, report, verificationStatus: 'FORM_REQUIREMENTS_NOT_VERIFIED', disclaimer: DRAFT_DISCLAIMER};
}
