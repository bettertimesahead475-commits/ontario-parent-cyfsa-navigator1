import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { forensicSectionConcurrency } from '../functions/api/analyze';

describe('FORENSIC_SECTION_CONCURRENCY', () => {
  it('defaults to 3 when unset, empty or invalid', () => {
    for (const raw of [undefined, '', 'abc', '0', '-1', '7', '2.5', 'Infinity']) {
      expect(forensicSectionConcurrency(raw)).toBe(3);
    }
  });

  it('accepts integers 1-6', () => {
    for (const n of [1, 2, 3, 4, 5, 6]) expect(forensicSectionConcurrency(String(n))).toBe(n);
  });

  it('is passed to the Forensic runner (sectioned and consolidated share the call)', () => {
    const src = readFileSync('functions/api/analyze.ts', 'utf8');
    const call = src.slice(src.indexOf('run = await forensicRunner({'));
    expect(call.slice(0, 200)).toContain('maxConcurrency: forensicSectionConcurrency(env.FORENSIC_SECTION_CONCURRENCY)');
  });
});
