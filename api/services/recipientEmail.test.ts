// Stage 10 slice 7: the canonical recipient-email rule (JavaScript copy). Parity with the database
// function is proven on real PostgreSQL in professionalMatterAccessRecipient.pg.test.ts.
import { describe, expect, it } from 'vitest';
import { canonicalRecipientEmail } from './recipientEmail.js';

describe('canonicalRecipientEmail', () => {
  it.each([
    ['pro@example.test', 'pro@example.test'],
    ['  Pro@Example.TEST  ', 'pro@example.test'],
    ['\t\n\v\f\rPro@Example.test\r\n', 'pro@example.test'],
    ['First.Last+Tag@Gmail.COM', 'first.last+tag@gmail.com'],
    ['a@b', 'a@b'],
    ['x'.repeat(250) + '@b.c', 'x'.repeat(250) + '@b.c'],
  ])('%j -> %j (trim + ASCII lower-case only)', (input, out) => {
    expect(canonicalRecipientEmail(input)).toBe(out);
  });

  it('does not rewrite dots, plus-tags, domains or aliases', () => {
    expect(canonicalRecipientEmail('f.i.r.s.t+x@googlemail.com')).toBe('f.i.r.s.t+x@googlemail.com');
    expect(canonicalRecipientEmail('first@gmail.com')).not.toBe(canonicalRecipientEmail('f.irst@gmail.com'));
  });

  it.each([
    ['non-string', 42], ['null', null], ['undefined', undefined], ['object', { email: 'a@b' }],
    ['empty', ''], ['whitespace only', '   '], ['too short', 'a@'], ['too long (255)', 'x'.repeat(251) + '@b.c'],
    ['no @', 'pro.example.test'], ['two @', 'a@b@c'], ['leading @', '@example.test'], ['trailing @', 'pro@'],
    ['non-ASCII letter', 'prö@example.test'], ['non-ASCII domain', 'pro@exämple.test'], ['fullwidth letter', 'Ｐro@example.test'],
    ['Turkish dotted capital I (no locale lower-casing)', 'İnfo@example.test'],
    ['NBSP edge (not trimmed)', ' pro@example.test'], ['NUL', 'pro\u0000@example.test'],
    ['control character', 'pro\u0001@example.test'], ['DEL', 'pro\u007f@example.test'],
  ])('refuses %s', (_l, input) => {
    expect(canonicalRecipientEmail(input)).toBeNull();
  });

  it('counts length in characters after trimming', () => {
    expect(canonicalRecipientEmail('   ' + 'x'.repeat(250) + '@b.c   ')).toBe('x'.repeat(250) + '@b.c');
  });
});

describe('edge-whitespace trim (S8786 linear rewrite)', () => {
  it('trims only space and codes 9-13 at the edges, exactly as the former pattern did', () => {
    const old = (s: string) => s.replace(/^[ \t\n\v\f\r]+|[ \t\n\v\f\r]+$/g, '');
    for (const s of [' \t\n\v\f\rA@b.c\r\n ', ' a@b.c', 'a@b.c ', 'a  @b.c', '\v\va@b.c']) {
      const v = old(s);
      expect(canonicalRecipientEmail(s), JSON.stringify(s)).toBe(canonicalRecipientEmail(v));
    }
    expect(canonicalRecipientEmail(' \t\n\v\f\rA@B.C\r\n ')).toBe('a@b.c');
    expect(canonicalRecipientEmail(' a@b.c')).toBeNull();
  });

  it('is linear on 50,000 internal spaces', () => {
    const t0 = performance.now();
    expect(canonicalRecipientEmail('a' + ' '.repeat(50_000) + '@b.c')).toBeNull();
    expect(performance.now() - t0).toBeLessThan(100);
  });
});
