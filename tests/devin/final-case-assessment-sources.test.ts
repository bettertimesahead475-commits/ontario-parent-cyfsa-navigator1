/** Mutation gap P14: no test sent an assessment point citing a page the server never loaded. Synthetic data only. */
import { describe, expect, it } from 'vitest';
import { validateAssessment, type AssessmentSource } from '../../functions/api/final-case-assessment';

const sources: AssessmentSource[] = [{ id: 'p1', document: 'Affidavit (synthetic)', version: 'v1', page: 1, text: 'The worker attended on March 3.' }];
const point = (ids: string[]) => [{ text: 'The worker attended on March 3.', sources: ids }];
const report = (ids: string[]) => ({ overview: point(['p1']), chronology: point(ids), conflicts: point(['p1']), gaps: point(['p1']), questions: point(['p1']) });

describe('Final Case Assessment source provenance', () => {
  it('accepts points that cite only loaded pages', () => {
    expect(validateAssessment(report(['p1', 'p1']), sources).chronology).toEqual([{ text: 'The worker attended on March 3.', sources: ['p1'] }]);
  });
  it.each([[['p2']], [['p1', 'p9']], [[]]])('rejects a point citing %j', (ids) => {
    expect(() => validateAssessment(report(ids), sources)).toThrow('INVALID_ASSESSMENT');
  });
});
