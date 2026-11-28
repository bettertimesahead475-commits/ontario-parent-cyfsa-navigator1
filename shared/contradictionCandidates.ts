/**
 * Contradiction candidates between statements in the same case. Deterministic, no model call.
 *
 * A pair is reported only when both statements have the same core wording and one denies what the other asserts, and
 * their dates do not place them on different days. Such a pair is a candidate for human review, never a proven
 * contradiction. Each candidate records the factors checked (who said it, whether the dates agree, whether the context
 * is known) and the alternative explanations that remain open.
 *
 * Pairs on different days are not reported: a statement on one day and its denial on another may both be true.
 * Relationship classification uses the corrected M2-D helper (`evaluateDeterministicRelationship`).
 */
import { evaluateDeterministicRelationship, coreProposition } from './m2d-relationships';

export interface StatementRecord {
  id: string;
  /** Who made the statement, as written in the source. Null when the source does not say. */
  speaker: string | null;
  statement: string;
  /** Calendar day (YYYY-MM-DD) the statement refers to, or null when undated. */
  date: string | null;
  /** Where in the source the statement appears. */
  locator: string;
  /** Surrounding context the source provides, or null when none was supplied. */
  context: string | null;
}

export interface ContradictionCandidate {
  id: string;
  kind: 'DIRECT_CONFLICT_CANDIDATE';
  statementIds: [string, string];
  /** Always this value. A candidate is never a finding of fact. */
  status: 'CANDIDATE_REQUIRES_REVIEW';
  considered: {
    sameSpeaker: boolean | null;
    dateAlignment: 'SAME_DAY' | 'UNKNOWN';
    contextKnown: boolean;
  };
  alternativeExplanations: string[];
}

/** Explanations that stay open whatever the pair looks like. */
const ALWAYS_OPEN = [
  'The statements may be recorded or summarised inaccurately.',
  'The speaker may have been describing a different occasion or a different part of the same event.',
];

export function findContradictionCandidates(statements: StatementRecord[]): ContradictionCandidate[] {
  const out: ContradictionCandidate[] = [];
  const sorted = [...statements].sort((x, y) => x.id.localeCompare(y.id));
  for (let i = 0; i < sorted.length; i += 1) {
    for (let j = i + 1; j < sorted.length; j += 1) {
      const a = sorted[i];
      const b = sorted[j];

      // Only statements about the same core event are compared.
      const core = coreProposition(a.statement);
      if (!core || core !== coreProposition(b.statement)) continue;

      // Different days: a statement and its denial on different days may both be true. Not a candidate.
      if (a.date && b.date && a.date !== b.date) continue;
      const dateAlignment: 'SAME_DAY' | 'UNKNOWN' = a.date && b.date ? 'SAME_DAY' : 'UNKNOWN';

      const rel = evaluateDeterministicRelationship(
        { proposition: a.statement, classification: 'FACT', dateContext: null } as any,
        { proposition: b.statement, classification: 'FACT', dateContext: null } as any,
        undefined,
        { eventDependency: { isSameEvent: true } } as any
      );
      if (!(rel.type === 'DIRECT_CONTRADICTION' && rel.dims.includes('AFFIRMATION_DENIAL'))) continue;

      const sameSpeaker = a.speaker && b.speaker ? a.speaker.trim().toLowerCase() === b.speaker.trim().toLowerCase() : null;
      const contextKnown = Boolean(a.context && b.context);
      const alternatives = [...ALWAYS_OPEN];
      if (sameSpeaker === false) alternatives.push('The statements come from different people, so they may not be inconsistent.');
      if (sameSpeaker === null) alternatives.push('The source does not say who made one or both statements.');
      if (dateAlignment === 'UNKNOWN') alternatives.push('One or both statements are undated, so their order cannot be checked.');
      if (!contextKnown) alternatives.push('The surrounding context of one or both statements is not in the record.');

      out.push({
        id: `CC-${[a.id, b.id].sort().join('|')}`,
        kind: 'DIRECT_CONFLICT_CANDIDATE',
        statementIds: [a.id, b.id],
        status: 'CANDIDATE_REQUIRES_REVIEW',
        considered: { sameSpeaker, dateAlignment, contextKnown },
        alternativeExplanations: alternatives,
      });
    }
  }
  return out;
}
