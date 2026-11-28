import { describe, expect, it } from 'vitest';
import { evaluateDeterministicRelationship, coreProposition, isNegated } from '../../shared/m2d-relationships';

const same = { eventDependency: { isSameEvent: true } };
const claim = (proposition: string, lowerBound: string | null = null) =>
  ({ proposition, classification: 'FACT', dateContext: lowerBound ? { lowerBound } : null }) as any;

describe('M2-D relationship helper after correction', () => {
  it('no longer hard-codes Monday/Tuesday: a Monday/Tuesday wording alone is not a date conflict', () => {
    const res = evaluateDeterministicRelationship(claim('monday visit'), claim('tuesday visit'), undefined, same);
    expect(res.type).not.toBe('DATE_INCONSISTENCY');
  });

  it('flags the same event given two different calendar days', () => {
    const res = evaluateDeterministicRelationship(
      claim('the visit', '2026-01-05T00:00:00Z'),
      claim('the visit', '2026-01-06T00:00:00Z'),
      undefined,
      same
    );
    expect(res.type).toBe('DATE_INCONSISTENCY');
    expect(res.dims).toContain('DATE');
  });

  it('does not flag two dates that are the same day', () => {
    const res = evaluateDeterministicRelationship(
      claim('the visit', '2026-01-05T00:00:00Z'),
      claim('the visit', '2026-01-05T18:30:00Z'),
      undefined,
      same
    );
    expect(res.dims).not.toContain('DATE');
  });

  it('a date conflict is not reported without knowing the claims are about the same event', () => {
    const res = evaluateDeterministicRelationship(
      claim('the visit', '2026-01-05T00:00:00Z'),
      claim('the visit', '2026-01-06T00:00:00Z')
    );
    expect(res.type).toBe('UNKNOWN_RELATIONSHIP');
  });

  it('does not treat the word "notice" as a negation', () => {
    expect(isNegated('the notice was served')).toBe(false);
    expect(isNegated('the notice was not served')).toBe(true);
    expect(isNegated("the notice wasn't served")).toBe(true);
  });

  it('matches an affirmation with its denial whatever the tense or article', () => {
    expect(coreProposition('The visit occurred.')).toBe(coreProposition('the visit did not occur'));
    const res = evaluateDeterministicRelationship(claim('the notice was served'), claim('the notice was not served'), undefined, same);
    expect(res.type).toBe('DIRECT_CONTRADICTION');
  });

  it('two unrelated statements with no negation difference are not a contradiction', () => {
    const res = evaluateDeterministicRelationship(claim('the child was at school'), claim('the parent was at work'), undefined, same);
    expect(res.dims).not.toContain('AFFIRMATION_DENIAL');
  });
});
