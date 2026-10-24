/**
 * Parent-specific case attribution.
 *
 * Deterministic model and checks for who a proceeding's allegations, roles, and proposed orders
 * concern. Nothing here infers a subject from name proximity: an allegation is attributed only to
 * the parties recorded in its `subjectPartyIds`, and a party's role never carries into another
 * proceeding. The model is an input to the analyzer and to counsel-facing drafting context; it is
 * not legal advice and does not establish any finding.
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

/** A recorded allegation is what someone said; a finding needs documentary support to be shown as one. */
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
  id: string;
  proceedingId: string;
  kind: AttributionKind;
  text: string;
  /** Who made the statement, e.g. "Applicant (CAS worker)" or "Parent B (affidavit)". */
  madeBy: string | null;
  /** Every party the allegation concerns. Empty means the subject was not identified. */
  subjectPartyIds: string[];
  status: AllegationStatus;
  classification: AuthoritativeEvidenceClassification;
  source: SourceLocator | null;
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

export type AttributionIssueCode =
  | 'NO_SUBJECT_IDENTIFIED'
  | 'SUBJECT_NOT_IN_PROCEEDING'
  | 'UNKNOWN_PARTY'
  | 'UNKNOWN_PROCEEDING'
  | 'MISSING_LOCATOR'
  | 'MISSING_SOURCE_OF_STATEMENT'
  | 'FINDING_WITHOUT_DOCUMENTARY_SOURCE'
  | 'ALIAS_COLLISION'
  | 'MISSING_FILE_NUMBER';

export interface AttributionIssue {
  code: AttributionIssueCode;
  itemId: string;
  detail: string;
}

/** Normalizes a name for comparison: case, accents, punctuation and spacing are ignored. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Reports aliases shared by more than one party, and parties or items that point at missing records. */
export function validateCaseModel(model: CaseModel): AttributionIssue[] {
  const issues: AttributionIssue[] = [];
  const partyIds = new Set(model.parties.map(p => p.id));
  const proceedingIds = new Set(model.proceedings.map(p => p.id));
  const rolesByProceeding = new Map<string, Set<string>>();
  for (const r of model.roles) {
    if (!partyIds.has(r.partyId)) issues.push({code: 'UNKNOWN_PARTY', itemId: r.partyId, detail: 'Role refers to an unknown party.'});
    if (!proceedingIds.has(r.proceedingId)) issues.push({code: 'UNKNOWN_PROCEEDING', itemId: r.proceedingId, detail: 'Role refers to an unknown proceeding.'});
    if (!rolesByProceeding.has(r.proceedingId)) rolesByProceeding.set(r.proceedingId, new Set());
    rolesByProceeding.get(r.proceedingId)!.add(r.partyId);
  }

  const claimants = new Map<string, Set<string>>();
  for (const party of model.parties) {
    for (const name of [party.displayName, ...party.aliases]) {
      const key = normalizeName(name);
      if (!key) continue;
      if (!claimants.has(key)) claimants.set(key, new Set());
      claimants.get(key)!.add(party.id);
    }
  }
  for (const [key, ids] of claimants) {
    if (ids.size > 1) {
      issues.push({code: 'ALIAS_COLLISION', itemId: key, detail: `Name "${key}" matches ${ids.size} parties; mentions cannot be attributed by name.`});
    }
  }

  for (const proceeding of model.proceedings) {
    if (!proceeding.fileNumber) {
      issues.push({code: 'MISSING_FILE_NUMBER', itemId: proceeding.id, detail: 'Proceeding has no court file number.'});
    }
  }

  for (const a of model.allegations) {
    if (!proceedingIds.has(a.proceedingId)) {
      issues.push({code: 'UNKNOWN_PROCEEDING', itemId: a.id, detail: 'Allegation refers to an unknown proceeding.'});
      continue;
    }
    const roster = rolesByProceeding.get(a.proceedingId) ?? new Set<string>();
    if (a.subjectPartyIds.length === 0) {
      issues.push({code: 'NO_SUBJECT_IDENTIFIED', itemId: a.id, detail: 'No party is recorded as the subject of this allegation.'});
    }
    for (const pid of a.subjectPartyIds) {
      if (!partyIds.has(pid)) issues.push({code: 'UNKNOWN_PARTY', itemId: a.id, detail: `Subject ${pid} is not a known party.`});
      else if (!roster.has(pid)) issues.push({code: 'SUBJECT_NOT_IN_PROCEEDING', itemId: a.id, detail: `Subject ${pid} has no role in this proceeding.`});
    }
    if (!a.madeBy) issues.push({code: 'MISSING_SOURCE_OF_STATEMENT', itemId: a.id, detail: 'The person or document making the statement is not recorded.'});
    if (!a.source || a.source.page === null || !a.source.paragraph) {
      issues.push({code: 'MISSING_LOCATOR', itemId: a.id, detail: 'Page or paragraph locator is missing.'});
    }
    if (a.kind === 'FINDING' && (!a.source || a.classification !== 'DOCUMENTARY')) {
      issues.push({code: 'FINDING_WITHOUT_DOCUMENTARY_SOURCE', itemId: a.id, detail: 'Recorded as a finding without a documentary source; shown as unresolved.'});
    }
  }
  return issues;
}

/**
 * The status an allegation may be shown with. A finding without documentary support, or an
 * allegation whose subject is not identified, is shown as UNRESOLVED regardless of what was recorded.
 */
export function effectiveStatus(a: Allegation): AllegationStatus {
  if (a.subjectPartyIds.length === 0) return 'UNRESOLVED';
  if (a.kind === 'FINDING' && (!a.source || a.classification !== 'DOCUMENTARY')) return 'UNRESOLVED';
  return a.status;
}

export interface ParentReport {
  proceedingId: string;
  fileNumber: string | null;
  partyId: string;
  partyName: string;
  roles: ProceedingRole[];
  /** Allegations whose only recorded subject is this parent. */
  specificAllegations: Allegation[];
  /** Allegations that name this parent and at least one other party. */
  sharedAllegations: Allegation[];
  /** Orders that affect this parent, including orders proposing this parent as caregiver. */
  relatedOrders: ProposedOrder[];
  /** The other parties' roles in this proceeding, so the context is not removed. */
  otherPartyRoles: {partyId: string; partyName: string; roles: ProceedingRole[]}[];
  /** Items whose attribution has a problem, with the reason. */
  unresolved: AttributionIssue[];
  /** Other proceedings involving this party, listed only as references; their content is not merged. */
  otherProceedingIds: string[];
}

export function buildParentReport(model: CaseModel, proceedingId: string, partyId: string): ParentReport {
  const party = model.parties.find(p => p.id === partyId);
  const proceeding = model.proceedings.find(p => p.id === proceedingId);
  if (!party || !proceeding) throw new Error('Unknown party or proceeding.');
  const roleIn = (pid: string) => model.roles.filter(r => r.partyId === pid && r.proceedingId === proceedingId).map(r => r.role);
  if (roleIn(partyId).length === 0) throw new Error('Party has no role in this proceeding.');

  const inProceeding = model.allegations.filter(a => a.proceedingId === proceedingId);
  const scopedIds = new Set([proceedingId, ...inProceeding.map(a => a.id)]);
  const issues = validateCaseModel(model).filter(i => scopedIds.has(i.itemId));

  const involving = inProceeding.filter(a => a.subjectPartyIds.includes(partyId));
  const specific = involving.filter(a => a.subjectPartyIds.length === 1);
  const shared = involving.filter(a => a.subjectPartyIds.length > 1);

  return {
    proceedingId,
    fileNumber: proceeding.fileNumber,
    partyId,
    partyName: party.displayName,
    roles: roleIn(partyId),
    specificAllegations: specific.map(a => ({...a, status: effectiveStatus(a)})),
    sharedAllegations: shared.map(a => ({...a, status: effectiveStatus(a)})),
    relatedOrders: model.orders.filter(o => o.proceedingId === proceedingId && (o.affectsPartyIds.includes(partyId) || o.proposedCaregiverPartyId === partyId)),
    otherPartyRoles: model.parties
      .filter(p => p.id !== partyId && roleIn(p.id).length > 0)
      .map(p => ({partyId: p.id, partyName: p.displayName, roles: roleIn(p.id)})),
    unresolved: issues,
    otherProceedingIds: [...new Set(model.roles.filter(r => r.partyId === partyId && r.proceedingId !== proceedingId).map(r => r.proceedingId))],
  };
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

const DRAFT_DISCLAIMER =
  'AI-generated drafting context for a parent-specific document. It is not legal advice, has not been reviewed by counsel, and is not a court-approved document. Confirm the applicable court form and its requirements before use.';

/**
 * Builds a parent-specific drafting context only after the party, proceeding, file number, and a
 * proposed arrangement have been confirmed in the model. Otherwise it returns what is missing.
 */
export function buildDraftingContext(model: CaseModel, proceedingId: string, partyId: string, purpose: DraftingPurpose): DraftingContext {
  const missing: string[] = [];
  const proceeding = model.proceedings.find(p => p.id === proceedingId);
  if (!proceeding) missing.push('proceeding');
  else if (!proceeding.fileNumber) missing.push('court file number');
  if (!model.parties.some(p => p.id === partyId)) missing.push('party');
  else if (!model.roles.some(r => r.partyId === partyId && r.proceedingId === proceedingId)) missing.push('party role in this proceeding');
  const hasProposal = model.orders.some(o => o.proceedingId === proceedingId && (o.affectsPartyIds.includes(partyId) || o.proposedCaregiverPartyId === partyId));
  if (!hasProposal) missing.push('proposed arrangement or requested order for this party');
  if (missing.length > 0) return {ok: false, missing};
  return {
    ok: true,
    purpose,
    report: buildParentReport(model, proceedingId, partyId),
    verificationStatus: 'FORM_REQUIREMENTS_NOT_VERIFIED',
    disclaimer: DRAFT_DISCLAIMER,
  };
}
