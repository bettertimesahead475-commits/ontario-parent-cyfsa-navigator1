import {describe, expect, it} from 'vitest';
import {
  type Allegation,
  type CaseModel,
  buildDraftingContext,
  buildParentReport,
  effectiveStatus,
  normalizeName,
  validateCaseModel,
} from './parentAttribution.js';

const src = (page: number | null = 3, paragraph: string | null = '12') => ({documentId: 'doc-1', page, paragraph, quote: null});

const A = {id: 'A', displayName: 'Parent A', aliases: ['Alex Morgan']};
const B = {id: 'B', displayName: 'Parent B', aliases: ['Jordan Lee']};

function allegation(over: Partial<Allegation> & Pick<Allegation, 'id' | 'subjectPartyIds'>): Allegation {
  return {
    proceedingId: 'P1',
    kind: 'ALLEGATION',
    text: 'Child reported unsupervised time.',
    madeBy: 'Applicant (CAS worker)',
    status: 'UNRESOLVED',
    classification: 'HEARSAY',
    source: src(),
    responses: [],
    ...over,
  };
}

/** Two parents named in one application, with Parent A as subject and Parent B as proposed caregiver. */
function proceeding1(): CaseModel {
  return {
    parties: [A, B],
    proceedings: [{id: 'P1', fileNumber: 'FC-24-0001', applicationDate: '2024-03-01', childNames: ['C']}],
    roles: [
      {proceedingId: 'P1', partyId: 'A', role: 'RESPONDENT'},
      {proceedingId: 'P1', partyId: 'B', role: 'PROPOSED_CAREGIVER'},
    ],
    allegations: [allegation({id: 'a1', subjectPartyIds: ['A']})],
    orders: [
      {
        id: 'o1',
        proceedingId: 'P1',
        description: 'Child placed with Parent B',
        affectsPartyIds: ['A', 'B'],
        proposedCaregiverPartyId: 'B',
        source: src(5, '2'),
      },
    ],
  };
}

/** Same two parents in a later proceeding where the allegations now concern Parent B. */
function withProceeding2(base: CaseModel): CaseModel {
  return {
    ...base,
    proceedings: [...base.proceedings, {id: 'P2', fileNumber: 'FC-25-0042', applicationDate: '2025-06-10', childNames: ['C']}],
    roles: [
      ...base.roles,
      {proceedingId: 'P2', partyId: 'B', role: 'RESPONDENT'},
      {proceedingId: 'P2', partyId: 'A', role: 'PROPOSED_CAREGIVER'},
    ],
    allegations: [...base.allegations, allegation({id: 'b1', proceedingId: 'P2', subjectPartyIds: ['B'], text: 'Parent B failed to attend appointments.'})],
  };
}

describe('specific and shared attribution', () => {
  it('attributes allegations only to the recorded subject even when both parents are named', () => {
    const m = proceeding1();
    const a = buildParentReport(m, 'P1', 'A');
    const b = buildParentReport(m, 'P1', 'B');
    expect(a.specificAllegations.map(x => x.id)).toEqual(['a1']);
    expect(b.specificAllegations).toEqual([]);
    expect(b.sharedAllegations).toEqual([]);
    expect(b.roles).toEqual(['PROPOSED_CAREGIVER']);
    expect(a.otherPartyRoles.map(r => r.partyId)).toEqual(['B']);
  });

  it('keeps an allegation that names two parties as shared in both reports', () => {
    const m = proceeding1();
    m.allegations = [allegation({id: 'shared', subjectPartyIds: ['A', 'B'], text: 'Both parents absent from school meetings.'})];
    const a = buildParentReport(m, 'P1', 'A');
    const b = buildParentReport(m, 'P1', 'B');
    expect(a.sharedAllegations.map(x => x.id)).toEqual(['shared']);
    expect(a.specificAllegations).toEqual([]);
    expect(b.sharedAllegations.map(x => x.id)).toEqual(['shared']);
  });

  it('does not attribute an allegation to a party because the text mentions that party', () => {
    const m = proceeding1();
    m.allegations = [allegation({id: 'a2', subjectPartyIds: ['A'], text: 'Parent B was not present, and Parent A was alone with the child.'})];
    expect(buildParentReport(m, 'P1', 'B').specificAllegations).toEqual([]);
    expect(buildParentReport(m, 'P1', 'B').sharedAllegations).toEqual([]);
    expect(buildParentReport(m, 'P1', 'A').specificAllegations.map(x => x.id)).toEqual(['a2']);
  });

  it('does not attribute an allegation to the maker of a statement', () => {
    const m = proceeding1();
    // Parent B's affidavit quotes a worker's allegation about Parent A.
    m.allegations = [allegation({id: 'q1', subjectPartyIds: ['A'], madeBy: 'Parent B (affidavit quoting worker)'})];
    expect(buildParentReport(m, 'P1', 'B').specificAllegations).toEqual([]);
    expect(buildParentReport(m, 'P1', 'A').specificAllegations.map(x => x.id)).toEqual(['q1']);
  });
});

describe('role reversal across proceedings', () => {
  it('reports each proceeding separately and never carries allegations across', () => {
    const m = withProceeding2(proceeding1());
    const a1 = buildParentReport(m, 'P1', 'A');
    const a2 = buildParentReport(m, 'P2', 'A');
    const b2 = buildParentReport(m, 'P2', 'B');
    expect(a1.roles).toEqual(['RESPONDENT']);
    expect(a2.roles).toEqual(['PROPOSED_CAREGIVER']);
    expect(a2.specificAllegations).toEqual([]);
    expect(b2.specificAllegations.map(x => x.id)).toEqual(['b1']);
    expect(a1.otherProceedingIds).toEqual(['P2']);
    expect(b2.otherProceedingIds).toEqual(['P1']);
  });

  it('does not treat a proposed-caregiver role in one proceeding as a role in another', () => {
    const m = withProceeding2(proceeding1());
    expect(buildParentReport(m, 'P2', 'B').roles).toEqual(['RESPONDENT']);
  });
});

describe('similar names and aliases', () => {
  it('normalizes accents, case, and punctuation when comparing names', () => {
    expect(normalizeName("  José  O'Brien ")).toBe('jose o brien');
  });

  it('flags an alias that two parties share instead of guessing', () => {
    const m = proceeding1();
    m.parties = [A, {id: 'B', displayName: 'Parent B', aliases: ['Alex Morgan']}];
    const issues = validateCaseModel(m).filter(i => i.code === 'ALIAS_COLLISION');
    expect(issues.map(i => i.itemId)).toEqual(['alex morgan']);
  });

  it('does not merge different names that only share a surname', () => {
    const m = proceeding1();
    m.parties = [A, {id: 'C', displayName: 'Parent Morgan', aliases: []}];
    expect(validateCaseModel(m).some(i => i.code === 'ALIAS_COLLISION')).toBe(false);
  });
});

describe('unclear and missing attribution', () => {
  it('keeps an allegation with no identified subject out of every parent report', () => {
    const m = proceeding1();
    m.allegations = [allegation({id: 'u1', subjectPartyIds: []})];
    const a = buildParentReport(m, 'P1', 'A');
    const b = buildParentReport(m, 'P1', 'B');
    expect(a.specificAllegations).toEqual([]);
    expect(b.sharedAllegations).toEqual([]);
    expect(a.unresolved.map(i => i.code)).toContain('NO_SUBJECT_IDENTIFIED');
  });

  it('flags a subject who has no role in the proceeding', () => {
    const m = proceeding1();
    m.parties = [A, B, {id: 'C', displayName: 'Other Adult', aliases: []}];
    m.allegations = [allegation({id: 'x1', subjectPartyIds: ['C']})];
    expect(validateCaseModel(m).map(i => i.code)).toContain('SUBJECT_NOT_IN_PROCEEDING');
  });

  it('flags a missing page or paragraph locator without dropping the item', () => {
    const m = proceeding1();
    m.allegations = [allegation({id: 'l1', subjectPartyIds: ['A'], source: src(null, null)})];
    const a = buildParentReport(m, 'P1', 'A');
    expect(a.specificAllegations.map(x => x.id)).toEqual(['l1']);
    expect(a.unresolved.map(i => i.code)).toContain('MISSING_LOCATOR');
  });

  it('flags a missing source of the statement', () => {
    const m = proceeding1();
    m.allegations = [allegation({id: 'm1', subjectPartyIds: ['A'], madeBy: null})];
    expect(validateCaseModel(m).map(i => i.code)).toContain('MISSING_SOURCE_OF_STATEMENT');
  });
});

describe('protection against unsupported findings and fabricated citations', () => {
  it('shows a finding with no documentary source as unresolved', () => {
    const m = proceeding1();
    m.allegations = [allegation({id: 'f1', kind: 'FINDING', subjectPartyIds: ['A'], status: 'ADMITTED', classification: 'HEARSAY'})];
    const a = buildParentReport(m, 'P1', 'A');
    expect(a.specificAllegations[0].status).toBe('UNRESOLVED');
    expect(a.unresolved.map(i => i.code)).toContain('FINDING_WITHOUT_DOCUMENTARY_SOURCE');
  });

  it('keeps a finding that has a documentary source and states its recorded status', () => {
    const f = allegation({id: 'f2', kind: 'FINDING', subjectPartyIds: ['A'], status: 'CORROBORATED', classification: 'DOCUMENTARY'});
    expect(effectiveStatus(f)).toBe('CORROBORATED');
    expect(validateCaseModel({...proceeding1(), allegations: [f]}).map(i => i.code)).not.toContain('FINDING_WITHOUT_DOCUMENTARY_SOURCE');
  });

  it('returns the source exactly as recorded and invents no page or paragraph', () => {
    const m = proceeding1();
    m.allegations = [allegation({id: 'c1', subjectPartyIds: ['A'], source: src(null, '7')})];
    const [item] = buildParentReport(m, 'P1', 'A').specificAllegations;
    expect(item.source).toEqual({documentId: 'doc-1', page: null, paragraph: '7', quote: null});
  });

  it('throws for an unknown party or a party with no role in the proceeding', () => {
    const m = withProceeding2(proceeding1());
    expect(() => buildParentReport(m, 'P9', 'A')).toThrow();
    expect(() => buildParentReport({...m, roles: m.roles.filter(r => !(r.partyId === 'B' && r.proceedingId === 'P1'))}, 'P1', 'B')).toThrow();
  });
});

describe('Form 33B and Plan of Care drafting contexts', () => {
  it('builds a context for one parent with the other party kept as context', () => {
    const ctx = buildDraftingContext(proceeding1(), 'P1', 'A', 'FORM_33B');
    expect(ctx.ok).toBe(true);
    if (!ctx.ok) return;
    expect(ctx.report.specificAllegations.map(x => x.id)).toEqual(['a1']);
    expect(ctx.report.otherPartyRoles.map(r => r.partyName)).toEqual(['Parent B']);
    expect(ctx.verificationStatus).toBe('FORM_REQUIREMENTS_NOT_VERIFIED');
    expect(ctx.disclaimer).toMatch(/not legal advice/);
  });

  it('keeps Form 33B and Plan of Care contexts separate for the same parent', () => {
    const f33b = buildDraftingContext(proceeding1(), 'P1', 'B', 'FORM_33B');
    const poc = buildDraftingContext(proceeding1(), 'P1', 'B', 'PLAN_OF_CARE');
    expect(f33b.ok && poc.ok).toBe(true);
    if (!f33b.ok || !poc.ok) return;
    expect(f33b.purpose).toBe('FORM_33B');
    expect(poc.purpose).toBe('PLAN_OF_CARE');
    expect(poc.report).toEqual(f33b.report);
  });

  it('refuses to draft without a file number, a role, or a proposal', () => {
    const noFile = proceeding1();
    noFile.proceedings[0].fileNumber = null;
    const ctx = buildDraftingContext(noFile, 'P1', 'A', 'FORM_33B');
    expect(ctx).toEqual({ok: false, missing: ['court file number']});

    const noProposal = proceeding1();
    noProposal.orders = [];
    const ctx2 = buildDraftingContext(noProposal, 'P1', 'A', 'PLAN_OF_CARE');
    expect(ctx2).toEqual({ok: false, missing: ['proposed arrangement or requested order for this party']});
  });

  it('refuses to draft for a party with no role in that proceeding', () => {
    const m = proceeding1();
    m.roles = m.roles.filter(r => !(r.partyId === 'B' && r.proceedingId === 'P1'));
    const ctx = buildDraftingContext(m, 'P1', 'B', 'FORM_33B');
    expect(ctx).toEqual({ok: false, missing: ['party role in this proceeding']});
  });
});
