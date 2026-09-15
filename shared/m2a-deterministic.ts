import { createHash } from 'crypto';

export type DatePrecision =
  | 'EXACT_DATETIME'
  | 'EXACT_DATE'
  | 'MONTH_ONLY'
  | 'YEAR_ONLY'
  | 'APPROXIMATE'
  | 'DATE_RANGE'
  | 'BEFORE'
  | 'AFTER'
  | 'UNKNOWN';

export interface StructuredDate {
  precision: DatePrecision;
  lowerBound: string | null; // ISO8601 UTC (inclusive)
  upperBound: string | null; // ISO8601 UTC (inclusive)
  timezoneName: string | null;
  originalText: string | null;
}

export type TemporalComparison =
  | 'BEFORE'
  | 'AFTER'
  | 'OVERLAPS'
  | 'SAME_KNOWN_DATE'
  | 'INDETERMINATE_ORDER';

export function compareDates(a: StructuredDate, b: StructuredDate): TemporalComparison {
  if (a.precision === 'UNKNOWN' || b.precision === 'UNKNOWN') return 'INDETERMINATE_ORDER';

  const aLower = a.lowerBound ? new Date(a.lowerBound).getTime() : -Infinity;
  const aUpper = a.upperBound ? new Date(a.upperBound).getTime() : Infinity;
  const bLower = b.lowerBound ? new Date(b.lowerBound).getTime() : -Infinity;
  const bUpper = b.upperBound ? new Date(b.upperBound).getTime() : Infinity;

  // SAME_KNOWN_DATE
  if (aLower === bLower && aUpper === bUpper && aLower !== -Infinity && aUpper !== Infinity) {
    if (a.precision === b.precision && ['EXACT_DATETIME', 'EXACT_DATE', 'MONTH_ONLY', 'YEAR_ONLY'].includes(a.precision)) {
      return 'SAME_KNOWN_DATE';
    }
  }

  // INDETERMINATE_ORDER due to total unbounded overlaps or missing info
  if (aLower === -Infinity && aUpper === Infinity) return 'INDETERMINATE_ORDER';
  if (bLower === -Infinity && bUpper === Infinity) return 'INDETERMINATE_ORDER';

  // BEFORE
  if (aUpper < bLower) {
    return 'BEFORE';
  }

  // AFTER
  if (aLower > bUpper) {
    return 'AFTER';
  }

  // OVERLAPS
  if (aLower <= bUpper && aUpper >= bLower) {
    return 'OVERLAPS';
  }

  return 'INDETERMINATE_ORDER';
}

export function validateStructuredDate(date: StructuredDate): void {
  if (date.precision === 'UNKNOWN') {
    if (date.lowerBound !== null || date.upperBound !== null) {
      throw new Error('UNKNOWN precision must not have bounds');
    }
  } else if (date.precision === 'BEFORE') {
    if (date.lowerBound !== null || date.upperBound === null) {
      throw new Error('BEFORE precision must have only upper bound');
    }
  } else if (date.precision === 'AFTER') {
    if (date.lowerBound === null || date.upperBound !== null) {
      throw new Error('AFTER precision must have only lower bound');
    }
  } else {
    // Exact, Month, Year, Approximate, Range all need both bounds
    if (date.lowerBound === null || date.upperBound === null) {
      throw new Error(`Precision ${date.precision} requires both bounds`);
    }
    const l = new Date(date.lowerBound).getTime();
    const u = new Date(date.upperBound).getTime();
    if (isNaN(l) || isNaN(u)) {
      throw new Error('Bounds must be valid ISO strings');
    }
    if (l > u) {
      throw new Error('lowerBound cannot be strictly greater than upperBound');
    }
  }

  if (date.precision === 'EXACT_DATETIME' && !date.timezoneName) {
    throw new Error('EXACT_DATETIME requires an explicit timezoneName');
  }
}

// Helper for deep stable serialization
function stableStringify(obj: any): string {
  if (obj === null || typeof obj !== 'object') {
    return JSON.stringify(obj);
  }
  if (Array.isArray(obj)) {
    return '[' + obj.map(stableStringify).join(',') + ']';
  }
  const keys = Object.keys(obj).sort();
  const parts = keys.map(k => JSON.stringify(k) + ':' + stableStringify(obj[k]));
  return '{' + parts.join(',') + '}';
}

export function computeFingerprint(dependencies: { id: string; version: number | string }[], data: object): string {
  // Sort dependencies for deterministic order
  const sortedDeps = [...dependencies].sort((a, b) => a.id.localeCompare(b.id));
  const payload = stableStringify({ dependencies: sortedDeps, data });
  return createHash('sha256').update(payload).digest('hex');
}

export type ProvenanceType = 'ASSERTS' | 'SUPPORTS' | 'DISPUTES' | 'MENTIONS' | 'DATES' | 'IDENTIFIES' | 'ATTRIBUTES' | 'DERIVED_FROM';

export function validateProvenanceType(type: string): void {
  const allowed: ProvenanceType[] = ['ASSERTS', 'SUPPORTS', 'DISPUTES', 'MENTIONS', 'DATES', 'IDENTIFIES', 'ATTRIBUTES', 'DERIVED_FROM'];
  if (!allowed.includes(type as ProvenanceType)) {
    throw new Error('Invalid provenance type: ' + type);
  }
}
