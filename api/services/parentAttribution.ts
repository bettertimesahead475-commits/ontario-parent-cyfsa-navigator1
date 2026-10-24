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
  | 'DUPLICATE_SUBJECT'
  | 'SUBJECT_NOT_IN_PROCEEDING'
  | 'UNKNOWN_PARTY'
  | 'UNKNOWN_PROCEEDING'
  | 'MISSING_LOCATOR'
  | 'MISSING_SOURCE_OF_STATEMENT'
  | 'UNSUPPORTED_STATUS'
  | 'FINDING_WITHOUT_DOCUMENTARY_SOURCE'
  | 'ALIAS_COLLISION'
  | 'MISSING_FILE_NUMBER';

export interface AttributionIssue {
  code: AttributionIssueCode;
  /** The record the issue is about: an allegation, order, role party, proceeding, or a normalized name. */
  itemId: string;
  /** The proceeding the issue belongs to. Null for issues across proceedings, such as alias collisions. */
  proceedingId: string | null;
  /** Parties the issue touches, so cross-proceeding issues can be scoped to the proceedings they affect. */
  partyIds: string[];
  detail: string;
}

/**
 * Normalizes a name for comparison: case, accents, punctuation and spacing are ignored. Letters and
 * digits in any script are kept, so non-Latin names are not reduced to an empty key.
 */
export function normalizeName(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();
}

/** Subjects with duplicates removed, so a repeated ID cannot make an allegation look shared. */
function subjectsOf(a: Allegation): string[] {
  return [...new Set(a.subjectPartyIds)];
}

/** Reports aliases shared by more than one party, and parties or items that point at missing records. */
export function validateCaseModel(model: CaseModel): AttributionIssue[] {
  const issues: AttributionIssue[] = [];
  const partyIds = new Set(model.parties.map(p => p.id));
  const proceedingIds = new Set(model.proceedings.map(p => p.id));
  const rolesByProceeding = new Map<string, Set<string>>();
  for (const r of model.roles) {
    if (!partyIds.has(r.partyId)) issues.push({code: 'UNKNOWN_PARTY', itemId: r.partyId, proceedingId: r.proceedingId, partyIds: [r.partyId], detail: 'Role refers to an unknown party.'});
    if (!proceedingIds.has(r.proceedingId)) issues.push({code: 'UNKNOWN_PROCEEDING', itemId: r.proceedingId, proceedingId: r.proceedingId, partyIds: [r.partyId], detail: 'Role refers to an unknown proceeding.'});
    if (!rolesByProceeding.has(r.proceedingId)) rolesByProceeding.set(r.proceedingId, new Set());
    rolesByProceeding.get(r.proceedingId)!.add(r.partyId);
  }
  for (const o of model.orders) {
    const named = [...o.affectsPartyIds, ...(o.proposedCaregiverPartyId ? [o.proposedCaregiverPartyId] : [])];
    if (!proceedingIds.has(o.proceedingId)) issues.push({code: 'UNKNOWN_PROCEEDING', itemId: o.id, proceedingId: o.proceedingId, partyIds: named, detail: 'Order refers to an unknown proceeding.'});
    for (const pid of named) {
      if (!partyIds.has(pid)) issues.push({code: 'UNKNOWN_PARTY', itemId: o.id, proceedingId: o.proceedingId, partyIds: [pid], detail: `Order names unknown party ${pid}.`});
    }
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
      issues.push({code: 'ALIAS_COLLISION', itemId: key, proceedingId: null, partyIds: [...ids], detail: `Name "${key}" matches ${ids.size} parties; mentions cannot be attributed by name.`});
    }
  }

  for (const proceeding of model.proceedings) {
    if (!proceeding.fileNumber) {
      issues.push({code: 'MISSING_FILE_NUMBER', itemId: proceeding.id, proceedingId: proceeding.id, partyIds: [], detail: 'Proceeding has no court file number.'});
    }
  }

  for (const a of model.allegations) {
    const subjects = subjectsOf(a);
    const base = {itemId: a.id, proceedingId: a.proceedingId, partyIds: subjects};
    if (!proceedingIds.has(a.proceedingId)) {
      issues.push({...base, code: 'UNKNOWN_PROCEEDING', detail: 'Allegation refers to an unknown proceeding.'});
      continue;
    }
    const roster = rolesByProceeding.get(a.proceedingId) ?? new Set<string>();
    if (subjects.length === 0) {
      issues.push({...base, code: 'NO_SUBJECT_IDENTIFIED', detail: 'No party is recorded as the subject of this allegation.'});
    }
    if (subjects.length !== a.subjectPartyIds.length) {
      issues.push({...base, code: 'DUPLICATE_SUBJECT', detail: 'A subject is recorded more than once; each party is counted once.'});
    }
    for (const pid of subjects) {
      if (!partyIds.has(pid)) issues.push({...base, code: 'UNKNOWN_PARTY', detail: `Subject ${pid} is not a known party.`});
      else if (!roster.has(pid)) issues.push({...base, code: 'SUBJECT_NOT_IN_PROCEEDING', detail: `Subject ${pid} has no role in this proceeding.`});
    }
    if (!a.madeBy) issues.push({...base, code: 'MISSING_SOURCE_OF_STATEMENT', detail: 'The person or document making the statement is not recorded.'});
    if (!a.source || a.source.page === null || !a.source.paragraph) {
      issues.push({...base, code: 'MISSING_LOCATOR', detail: 'Page or paragraph locator is missing.'});
    }
    if (a.kind === 'FINDING' && (!a.source || a.classification !== 'DOCUMENTARY')) {
      issues.push({...base, code: 'FINDING_WITHOUT_DOCUMENTARY_SOURCE', detail: 'Recorded as a finding without a documentary source; shown as unresolved.'});
    }
    if ((a.status === 'ADMITTED' || a.status === 'CORROBORATED') && !a.source) {
      issues.push({...base, code: 'UNSUPPORTED_STATUS', detail: `Recorded as ${a.status} without a source; shown as unresolved.`});
    }
  }
  return issues;
}

/**
 * The status an allegation may be shown with. A finding without documentary support, an allegation
 * whose subject is not identified, and an admitted or corroborated status without a source are all
 * shown as UNRESOLVED regardless of what was recorded.
 */
export function effectiveStatus(a: Allegation): AllegationStatus {
  if (subjectsOf(a).length === 0) return 'UNRESOLVED';
  if (a.kind === 'FINDING' && (!a.source || a.classification !== 'DOCUMENTARY')) return 'UNRESOLVED';
  if ((a.status === 'ADMITTED' || a.status === 'CORROBORATED') && !a.source) return 'UNRESOLVED';
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
  const roster = new Set(model.roles.filter(r => r.proceedingId === proceedingId).map(r => r.partyId));
  const involving = inProceeding.filter(a => subjectsOf(a).includes(partyId));
  const specific = involving.filter(a => subjectsOf(a).length === 1);
  const shared = involving.filter(a => subjectsOf(a).length > 1);

  // An allegation-level issue is shown only to the parties the allegation concerns. An allegation with
  // no identified subject concerns no one in particular, so its issues are shown to every party in the
  // proceeding. Proceeding-level issues and cross-proceeding issues (such as an alias collision) are
  // shown only when they touch a party in this proceeding, and name only those parties.
  const involvingIds = new Set(involving.map(a => a.id));
  const allegationIds = new Set(inProceeding.map(a => a.id));
  const unsubjectedIds = new Set(inProceeding.filter(a => subjectsOf(a).length === 0).map(a => a.id));
  const issues = validateCaseModel(model)
    .filter(i => {
      if (allegationIds.has(i.itemId)) return involvingIds.has(i.itemId) || unsubjectedIds.has(i.itemId);
      if (i.proceedingId === proceedingId) return true;
      return i.proceedingId === null && i.partyIds.some(pid => roster.has(pid));
    })
    .map(i => (i.proceedingId === null ? {...i, partyIds: i.partyIds.filter(pid => roster.has(pid))} : i));

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

const CONFLICT_CODES: AttributionIssueCode[] = [
  'UNKNOWN_PARTY',
  'UNKNOWN_PROCEEDING',
  'SUBJECT_NOT_IN_PROCEEDING',
  'DUPLICATE_SUBJECT',
  'ALIAS_COLLISION',
];

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
  // Attribution conflicts that change who a document is about block drafting. Gaps such as a missing
  // locator do not block it; they are shown in the report's unresolved list.
  const conflict = validateCaseModel(model).some(i =>
    CONFLICT_CODES.includes(i.code) && (i.proceedingId === proceedingId || i.proceedingId === null) && i.partyIds.includes(partyId),
  );
  if (conflict) missing.push('resolve attribution conflicts involving this party');
  if (missing.length > 0) return {ok: false, missing};
  return {
    ok: true,
    purpose,
    report: buildParentReport(model, proceedingId, partyId),
    verificationStatus: 'FORM_REQUIREMENTS_NOT_VERIFIED',
    disclaimer: DRAFT_DISCLAIMER,
  };
}
