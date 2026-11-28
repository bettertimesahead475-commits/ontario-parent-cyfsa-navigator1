/**
 * Deterministic case-intelligence pass over a Forensic report's chronology (M2B projection, M2A date rules).
 * No model call. It orders the rows whose date is a valid calendar day, records the rows it cannot order, and
 * reports any conflicts the projection finds. It never edits the AI's rows.
 */
import { buildChronologyProjection, type ChronologyConflict, type EventTiming } from './m2b-chronology';
import type { DateGrounding } from './chronologyGrounding';

export const CHRONOLOGY_INTELLIGENCE_VERSION = 1;

/** Limit enforced by the M2B projection. Larger chronologies are ordered in full only up to this many rows. */
const PROJECTION_EVENT_LIMIT = 1000;

export interface ChronologyIntelligenceRow {
  date?: unknown;
  event?: unknown;
  dateGrounding?: DateGrounding;
}

export interface DeterministicChronology {
  version: number;
  datedRowIndexes: number[];
  undatedRowIndexes: number[];
  /** Pairs of dated rows whose order is fixed by their calendar dates. */
  orderedPairCount: number;
  conflicts: ChronologyConflict[];
  truncated: boolean;
  notes: string[];
}

/**
 * Orders dated rows and records what the projection can and cannot establish. Rows with an invalid or
 * ungroundable date are not ordered. Rows are referred to by their index in the input array.
 */
export function buildDeterministicChronology(
  matterId: string,
  rows: ChronologyIntelligenceRow[]
): DeterministicChronology {
  const datedRowIndexes: number[] = [];
  const undatedRowIndexes: number[] = [];
  const events: EventTiming[] = [];
  const notes: string[] = [];

  rows.forEach((row, index) => {
    const iso = row.dateGrounding?.isoDate ?? null;
    if (!iso) {
      undatedRowIndexes.push(index);
      return;
    }
    datedRowIndexes.push(index);
    if (events.length < PROJECTION_EVENT_LIMIT) {
      events.push({
        id: `row-${index}`,
        matter_id: matterId,
        date_precision: 'EXACT_DATE',
        date_lower_bound: `${iso}T00:00:00.000Z`,
        date_upper_bound: `${iso}T23:59:59.999Z`,
      });
    }
  });

  const truncated = datedRowIndexes.length > PROJECTION_EVENT_LIMIT;
  if (truncated) notes.push(`Only the first ${PROJECTION_EVENT_LIMIT} dated rows were ordered by the projection.`);
  if (undatedRowIndexes.length) notes.push(`${undatedRowIndexes.length} row(s) have no valid calendar date and were not ordered.`);
  // No explicit relationships are derived from the report, so conflicts here can only come from date bounds.
  notes.push('No explicit ordering constraints were supplied; conflicts reflect calendar dates only.');

  const projection = buildChronologyProjection(matterId, events, []);
  const orderedPairCount = projection.edges.length;
  return {
    version: CHRONOLOGY_INTELLIGENCE_VERSION,
    datedRowIndexes,
    undatedRowIndexes,
    orderedPairCount,
    conflicts: projection.conflicts,
    truncated,
    notes,
  };
}
