import { describe, it, expect } from 'vitest';
import { 
  compareDates, 
  validateStructuredDate, 
  computeFingerprint, 
  validateProvenanceType,
  StructuredDate
} from '../../shared/m2a-deterministic.js';

describe('m2a-deterministic case intelligence logic', () => {

  describe('Dates and Temporal Comparison', () => {
    it('validates EXACT_DATETIME correctly', () => {
      expect(() => validateStructuredDate({
        precision: 'EXACT_DATETIME',
        lowerBound: '2025-09-01T12:00:00Z',
        upperBound: '2025-09-01T12:00:00Z',
        timezoneName: 'America/Toronto',
        originalText: 'Sep 1 noon'
      })).not.toThrow();

      expect(() => validateStructuredDate({
        precision: 'EXACT_DATETIME',
        lowerBound: '2025-09-01T12:00:00Z',
        upperBound: '2025-09-01T12:00:00Z',
        timezoneName: null,
        originalText: 'Sep 1 noon'
      })).toThrow('requires an explicit timezoneName');
    });

    it('rejects fabricated dates for UNKNOWN', () => {
      expect(() => validateStructuredDate({
        precision: 'UNKNOWN',
        lowerBound: '2025-09-01T12:00:00Z',
        upperBound: null,
        timezoneName: null,
        originalText: 'Unknown'
      })).toThrow('must not have bounds');
    });

    it('validates BEFORE/AFTER with single bounds', () => {
      expect(() => validateStructuredDate({
        precision: 'BEFORE',
        lowerBound: null,
        upperBound: '2025-09-01T00:00:00Z',
        timezoneName: null,
        originalText: 'Before Sep 2025'
      })).not.toThrow();

      expect(() => validateStructuredDate({
        precision: 'BEFORE',
        lowerBound: '2025-01-01T00:00:00Z',
        upperBound: '2025-09-01T00:00:00Z',
        timezoneName: null,
        originalText: 'Before Sep 2025'
      })).toThrow();
    });

    it('validates interval relationships safely (BEFORE, AFTER, OVERLAPS)', () => {
      const a: StructuredDate = { precision: 'MONTH_ONLY', lowerBound: '2025-09-01T00:00:00Z', upperBound: '2025-09-30T23:59:59Z', timezoneName: null, originalText: null };
      const b: StructuredDate = { precision: 'MONTH_ONLY', lowerBound: '2025-10-01T00:00:00Z', upperBound: '2025-10-31T23:59:59Z', timezoneName: null, originalText: null };
      const c: StructuredDate = { precision: 'MONTH_ONLY', lowerBound: '2025-09-15T00:00:00Z', upperBound: '2025-10-15T23:59:59Z', timezoneName: null, originalText: null };
      const d: StructuredDate = { precision: 'UNKNOWN', lowerBound: null, upperBound: null, timezoneName: null, originalText: null };

      expect(compareDates(a, b)).toBe('BEFORE');
      expect(compareDates(b, a)).toBe('AFTER');
      expect(compareDates(a, c)).toBe('OVERLAPS');
      expect(compareDates(a, a)).toBe('SAME_KNOWN_DATE');
      expect(compareDates(a, d)).toBe('INDETERMINATE_ORDER');
    });

    it('resolves SAME_KNOWN_DATE only when precisions match exactly', () => {
      const a: StructuredDate = { precision: 'EXACT_DATE', lowerBound: '2025-09-01T00:00:00Z', upperBound: '2025-09-01T23:59:59Z', timezoneName: null, originalText: null };
      const b: StructuredDate = { precision: 'EXACT_DATE', lowerBound: '2025-09-01T00:00:00Z', upperBound: '2025-09-01T23:59:59Z', timezoneName: null, originalText: null };
      expect(compareDates(a, b)).toBe('SAME_KNOWN_DATE');
    });
  });

  describe('Fingerprint Freshness', () => {
    it('is deterministic regardless of dependency array order', () => {
      const deps1 = [{id: 'b', version: 1}, {id: 'a', version: 2}];
      const deps2 = [{id: 'a', version: 2}, {id: 'b', version: 1}];
      const data = { role: 'ACTOR' };
      
      expect(computeFingerprint(deps1, data)).toEqual(computeFingerprint(deps2, data));
    });

    it('changes when a dependency version changes', () => {
      const deps1 = [{id: 'a', version: 1}];
      const deps2 = [{id: 'a', version: 2}];
      expect(computeFingerprint(deps1, {})).not.toEqual(computeFingerprint(deps2, {}));
    });
  });

  describe('Provenance Types', () => {
    it('validates strictly', () => {
      expect(() => validateProvenanceType('ASSERTS')).not.toThrow();
      expect(() => validateProvenanceType('SUPPORTS')).not.toThrow();
      expect(() => validateProvenanceType('UNKNOWN')).toThrow();
    });
  });
});
