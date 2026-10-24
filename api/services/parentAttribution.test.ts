import {describe, expect, it} from 'vitest';
import {
  type Allegation,
  type CaseModel,
  buildDraftingContext,
  buildParentReport,
  normalizeAlias,
  validateCaseModel,
} from './parentAttribution.js';

const locator = (page: number | null = 3, paragraph: string | null = '12') => ({documentId: 'affidavit-1', page, paragraph, quote: null});

function allegation(over: Partial<Allegation> & Pick<Allegation, 'id' | 'proceedingId' | 'subjectPartyIds'>): Allegation {
  return {
    kind: 'ALLEGATION',
    text: 'Child reported unsupervised time.',
    madeBy: 'Applicant (CAS worker)',
    status: 'UNRESOLVED',
    classification: 'HEARSAY',
    source: locator(),
    sourceRecordId: null,
    responses: [],
    ...over,
  };
}

/**
 * Two proceedings with the same two parents, both named in every document.
 * P1: Parent A is the primary subject; Parent B is the proposed caregiver.
 * P2: Parent B is the primary subject; Parent A is the proposed caregiver.
 */
function twoProceedings(): CaseModel {
  return {
    parties: [
      {id: 'A', displayName: 'Parent A', aliases: ['Alex Morgan']},
      {id: 'B', displayName: 'Parent B', aliases: ['Jordan Lee']},
    ],
    proceedings: [
      {id: 'P1', fileNumber: 'FC-24-0001', applicationDate: '2024-03-01', childNames: ['Child C']},
      {id: 'P2', fileNumber: 'FC-25-0042', applicationDate: '2025-06-10', childNames: ['Child C']},
    ],
    roles: [
      {proceedingId: 'P1', partyId: 'A', role: 'RESPONDENT'},
      {proceedingId: 'P1', partyId: 'B', role: 'PROPOSED_CAREGIVER'},
      {proceedingId: 'P2', partyId: 'B', role: 'RESPONDENT'},
      {proceedingId: 'P2', partyId: 'A', role: 'PROPOSED_CAREGIVER'},
    ],
    allegations: [
      allegation({id: 'a1', proceedingId: 'P1', subjectPartyIds: ['A'], sourceRecordId: 'para 12'}),
      allegation({id: 'b1', proceedingId: 'P2', subjectPartyIds: ['B'], sourceRecordId: 'para 4'}),
    ],
    orders: [
      {id: 'o1', proceedingId: 'P1', description: 'Child placed with Parent B', affectsPartyIds: ['A', 'B'], proposedCaregiverPartyId: 'B', source: locator(7, '2')},
      {id: 'o2', proceedingId: 'P2', description: 'Child placed with Parent A', affectsPartyIds: ['A', 'B'], proposedCaregiverPartyId: 'A', source: locator(6, '1')},
    ],
  };
}

const ids = (items: Allegation[]) => items.map(i => i.id);

describe('two proceedings with the same parents (acceptance)', () => {
  it('attributes each proceeding\'s allegations only to the parent who is its subject', () => {
    const m = twoProceedings();
    const a1 = buildParentReport(m, 'P1', 'A');
    const b1 = buildParentReport(m, 'P1', 'B');
    const a2 = buildParentReport(m, 'P2', 'A');
    const b2 = buildParentReport(m, 'P2', 'B');
    expect(ids(a1.specificAllegations)).toEqual(['a1']);
    expect(ids(b1.specificAllegations)).toEqual([]);
    expect(ids(a2.specificAllegations)).toEqual([]);
    expect(ids(b2.specificAllegations)).toEqual(['b1']);
  });

  it('never carries an allegation from one proceeding into the other parent\'s report', () => {
    const m = twoProceedings();
    const everything = [
      ...buildParentReport(m, 'P1', 'B').sharedAllegations,
      ...buildParentReport(m, 'P1', 'B').unattributedAllegations,
      ...buildParentReport(m, 'P2', 'A').sharedAllegations,
      ...buildParentReport(m, 'P2', 'A').unattributedAllegations,
    ];
    expect(ids(everything)).not.toContain('a1');
    expect(ids(everything)).not.toContain('b1');
  });

  it('keeps each parent\'s role separate per proceeding', () => {
    const m = twoProceedings();
    expect(buildParentReport(m, 'P1', 'A').roles).toEqual(['RESPONDENT']);
    expect(buildParentReport(m, 'P2', 'A').roles).toEqual(['PROPOSED_CAREGIVER']);
    expect(buildParentReport(m, 'P1', 'A').otherProceedingIds).toEqual(['P2']);
  });

  it('lists the orders for each proceeding under each parent it affects, and the other parent\'s role as context', () => {
    const m = twoProceedings();
    expect(buildParentReport(m, 'P1', 'B').relatedOrders.map(o => o.id)).toEqual(['o1']);
    expect(buildParentReport(m, 'P1', 'A').otherPartyRoles).toEqual([{partyId: 'B', partyName: 'Parent B', roles: ['PROPOSED_CAREGIVER']}]);
  });

  it('shows a shared allegation to every party it names and to no other', () => {
    const m = twoProceedings();
    m.allegations = [allegation({id: 's1', proceedingId: 'P1', subjectPartyIds: ['A', 'B']})];
    expect(ids(buildParentReport(m, 'P1', 'A').sharedAllegations)).toEqual(['s1']);
    expect(ids(buildParentReport(m, 'P1', 'B').sharedAllegations)).toEqual(['s1']);
    expect(buildParentReport(m, 'P1', 'A').specificAllegations).toEqual([]);
  });

  it('gives each parent a drafting context for their own proceeding only', () => {
    const m = twoProceedings();
    expect(buildDraftingContext(m, 'P1', 'B', 'FORM_33B').ok).toBe(true);
    expect(buildDraftingContext(m, 'P2', 'A', 'PLAN_OF_CARE').ok).toBe(true);
    expect(buildDraftingContext(m, 'P1', 'A', 'FORM_33B').ok).toBe(true);
  });
});

describe('source citations', () => {
  it('returns the source locator and document reference exactly as recorded', () => {
    const m = twoProceedings();
    const [item] = buildParentReport(m, 'P1', 'A').specificAllegations;
    expect(item.source).toEqual({documentId: 'affidavit-1', page: 3, paragraph: '12', quote: null});
    expect(item.sourceRecordId).toBe('para 12');
  });

  it('shows a missing page or paragraph as an issue and invents neither', () => {
    const m = twoProceedings();
    m.allegations = [allegation({id: 'l1', proceedingId: 'P1', subjectPartyIds: ['A'], source: locator(null, null)})];
    const report = buildParentReport(m, 'P1', 'A');
    expect(report.specificAllegations[0].source).toEqual({documentId: 'affidavit-1', page: null, paragraph: null, quote: null});
    expect(report.issues.map(i => i.code)).toContain('MISSING_LOCATOR');
    expect(buildDraftingContext(m, 'P1', 'A', 'FORM_33B').ok).toBe(true);
  });

  it('shows a finding with no documentary source as unresolved', () => {
    const m = twoProceedings();
    m.allegations = [allegation({id: 'f1', proceedingId: 'P1', subjectPartyIds: ['A'], kind: 'FINDING', status: 'ADMITTED', classification: 'HEARSAY'})];
    expect(buildParentReport(m, 'P1', 'A').specificAllegations[0].status).toBe('UNRESOLVED');
  });

  it('shows an admitted or corroborated allegation with no source as unresolved', () => {
    const m = twoProceedings();
    m.allegations = [allegation({id: 'c1', proceedingId: 'P1', subjectPartyIds: ['A'], status: 'CORROBORATED', source: null})];
    expect(buildParentReport(m, 'P1', 'A').specificAllegations[0].status).toBe('UNRESOLVED');
  });
});

describe('duplicate identifiers', () => {
  it('excludes records that share an ID within one proceeding and blocks drafting there only', () => {
    const m = twoProceedings();
    m.allegations = [
      allegation({id: 'x', proceedingId: 'P1', subjectPartyIds: ['A']}),
      allegation({id: 'x', proceedingId: 'P1', subjectPartyIds: ['B']}),
      allegation({id: 'b1', proceedingId: 'P2', subjectPartyIds: ['B']}),
    ];
    const a = buildParentReport(m, 'P1', 'A');
    expect(a.specificAllegations).toEqual([]);
    expect(a.sharedAllegations).toEqual([]);
    expect(a.issues.map(i => i.code)).toContain('DUPLICATE_ID');
    expect(buildDraftingContext(m, 'P1', 'A', 'FORM_33B').ok).toBe(false);
    expect(ids(buildParentReport(m, 'P2', 'B').specificAllegations)).toEqual(['b1']);
    expect(buildDraftingContext(m, 'P2', 'B', 'FORM_33B').ok).toBe(true);
  });

  it('excludes records that share an ID across proceedings, and never matches them by ID alone', () => {
    const m = twoProceedings();
    m.allegations = [
      allegation({id: 'x', proceedingId: 'P1', subjectPartyIds: ['A']}),
      allegation({id: 'x', proceedingId: 'P2', subjectPartyIds: ['B']}),
    ];
    expect(buildParentReport(m, 'P1', 'A').specificAllegations).toEqual([]);
    expect(buildParentReport(m, 'P2', 'B').specificAllegations).toEqual([]);
    expect(buildParentReport(m, 'P1', 'A').issues.map(i => i.code)).toContain('DUPLICATE_ID');
    expect(buildParentReport(m, 'P2', 'B').issues.map(i => i.code)).toContain('DUPLICATE_ID');
    expect(buildDraftingContext(m, 'P1', 'A', 'FORM_33B').ok).toBe(false);
    expect(buildDraftingContext(m, 'P2', 'B', 'FORM_33B').ok).toBe(false);
  });

  it('keeps a repeated-ID record\'s issue within its own proceeding', () => {
    const m = twoProceedings();
    m.allegations = [
      allegation({id: 'x', proceedingId: 'P2', subjectPartyIds: ['A']}),
      allegation({id: 'x', proceedingId: 'P2', subjectPartyIds: ['B']}),
    ];
    expect(buildParentReport(m, 'P1', 'A').issues.some(i => i.code === 'DUPLICATE_ID')).toBe(false);
  });
});

describe('conflicting aliases', () => {
  it('treats two parties sharing a name as ambiguous and blocks drafting for both', () => {
    const m = twoProceedings();
    m.parties = [
      {id: 'A', displayName: 'Sam', aliases: []},
      {id: 'B', displayName: 'Parent B', aliases: ['Sam']},
    ];
    expect(validateCaseModel(m).some(i => i.code === 'ALIAS_COLLISION')).toBe(true);
    expect(buildDraftingContext(m, 'P1', 'A', 'FORM_33B').ok).toBe(false);
    expect(buildDraftingContext(m, 'P1', 'B', 'FORM_33B').ok).toBe(false);
  });

  it('does not block a party whose name is not shared', () => {
    const m = twoProceedings();
    m.parties = [
      {id: 'A', displayName: 'Sam', aliases: []},
      {id: 'B', displayName: 'Sam', aliases: []},
      {id: 'C', displayName: 'Parent C', aliases: []},
    ];
    m.roles.push({proceedingId: 'P1', partyId: 'C', role: 'OTHER_PARTY'});
    expect(buildDraftingContext(m, 'P1', 'C', 'FORM_33B').ok).toBe(false);
    expect(buildParentReport(m, 'P1', 'C').issues.some(i => i.code === 'ALIAS_COLLISION')).toBe(false);
  });

  it('blocks a party in one proceeding when its name collides with a party who has a role only in another', () => {
    const m = twoProceedings();
    m.parties = [
      {id: 'A', displayName: 'Parent A', aliases: []},
      {id: 'B', displayName: 'Parent B', aliases: []},
      {id: 'C', displayName: 'Parent A', aliases: []},
    ];
    m.roles.push({proceedingId: 'P2', partyId: 'C', role: 'OTHER_PARTY'});
    expect(buildDraftingContext(m, 'P1', 'A', 'FORM_33B').ok).toBe(false);
    expect(buildDraftingContext(m, 'P1', 'B', 'FORM_33B').ok).toBe(true);
  });

  it('is conservative: accented and unaccented spellings are not treated as the same name', () => {
    expect(normalizeAlias('José')).not.toBe(normalizeAlias('Jose'));
    expect(normalizeAlias('Ｓａｍ')).toBe(normalizeAlias('Sam'));
  });
});

describe('unknown subjects and cross-proceeding references', () => {
  it('shows an allegation with no subject to every party in its proceeding, attributed to none', () => {
    const m = twoProceedings();
    m.allegations = [allegation({id: 'u1', proceedingId: 'P1', subjectPartyIds: []})];
    for (const pid of ['A', 'B']) {
      const r = buildParentReport(m, 'P1', pid);
      expect(ids(r.unattributedAllegations)).toEqual(['u1']);
      expect(r.specificAllegations).toEqual([]);
      expect(r.sharedAllegations).toEqual([]);
    }
  });

  it('does not attribute a subject from another proceeding and keeps the rest of the record for the parent it does concern', () => {
    const m = twoProceedings();
    m.roles = m.roles.filter(r => !(r.partyId === 'B' && r.proceedingId === 'P1'));
    m.allegations = [allegation({id: 'mix', proceedingId: 'P1', subjectPartyIds: ['A', 'B']})];
    const a = buildParentReport(m, 'P1', 'A');
    expect(ids(a.specificAllegations)).toEqual(['mix']);
    expect(a.issues.map(i => i.code)).toContain('SUBJECT_NOT_IN_PROCEEDING');
  });

  it('does not show a P1-only party in a P2 report, and does not attribute a P2 record to a P1 party', () => {
    const m = twoProceedings();
    m.roles = m.roles.filter(r => !(r.partyId === 'B' && r.proceedingId === 'P2'));
    m.allegations = [allegation({id: 'x2', proceedingId: 'P2', subjectPartyIds: ['B']})];
    expect(buildParentReport(m, 'P2', 'A').specificAllegations).toEqual([]);
    expect(ids(buildParentReport(m, 'P2', 'A').unattributedAllegations)).toEqual(['x2']);
    expect(buildParentReport(m, 'P1', 'B').specificAllegations).toEqual([]);
  });

  it('shows an unknown-party subject without assigning the allegation to a known party', () => {
    const m = twoProceedings();
    m.allegations = [allegation({id: 'z1', proceedingId: 'P1', subjectPartyIds: ['Z']})];
    expect(validateCaseModel(m).some(i => i.code === 'UNKNOWN_PARTY' || i.code === 'SUBJECT_NOT_IN_PROCEEDING')).toBe(true);
    expect(buildParentReport(m, 'P1', 'A').specificAllegations).toEqual([]);
    expect(ids(buildParentReport(m, 'P1', 'A').unattributedAllegations)).toEqual(['z1']);
  });
});

describe('drafting gate', () => {
  it('refuses without a file number, a role, or a proposal, and lists what is missing', () => {
    const noFile = twoProceedings();
    noFile.proceedings[0].fileNumber = null;
    expect(buildDraftingContext(noFile, 'P1', 'A', 'FORM_33B')).toEqual({ok: false, missing: ['court file number']});

    const noProposal = twoProceedings();
    noProposal.orders = [];
    expect(buildDraftingContext(noProposal, 'P1', 'A', 'PLAN_OF_CARE')).toEqual({ok: false, missing: ['proposed arrangement or requested order for this party']});

    const noRole = twoProceedings();
    noRole.roles = noRole.roles.filter(r => !(r.partyId === 'B' && r.proceedingId === 'P1'));
    expect(buildDraftingContext(noRole, 'P1', 'B', 'FORM_33B')).toEqual({ok: false, missing: ['party role in this proceeding']});
  });

  it('builds separate Form 33B and Plan of Care contexts that carry the same report', () => {
    const m = twoProceedings();
    const f = buildDraftingContext(m, 'P1', 'A', 'FORM_33B');
    const p = buildDraftingContext(m, 'P1', 'A', 'PLAN_OF_CARE');
    expect(f.ok && p.ok).toBe(true);
    if (!f.ok || !p.ok) return;
    expect(f.purpose).toBe('FORM_33B');
    expect(p.purpose).toBe('PLAN_OF_CARE');
    expect(p.report).toEqual(f.report);
    expect(f.verificationStatus).toBe('FORM_REQUIREMENTS_NOT_VERIFIED');
    expect(f.disclaimer).toMatch(/not legal advice/);
  });

  it('refuses an order that names an unknown party', () => {
    const m = twoProceedings();
    m.orders = [{...m.orders[0], proposedCaregiverPartyId: 'Z'}];
    expect(buildDraftingContext(m, 'P1', 'A', 'FORM_33B').ok).toBe(false);
  });
});

describe('invalid requests', () => {
  it('throws for an unknown proceeding, an unknown party, or a party with no role in the proceeding', () => {
    const m = twoProceedings();
    expect(() => buildParentReport(m, 'P9', 'A')).toThrow();
    expect(() => buildParentReport(m, 'P1', 'Z')).toThrow();
    m.roles = m.roles.filter(r => !(r.partyId === 'B' && r.proceedingId === 'P1'));
    expect(() => buildParentReport(m, 'P1', 'B')).toThrow();
  });
});
