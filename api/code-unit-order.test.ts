import { describe, expect, it } from 'vitest';
import { byCodeUnit } from '../shared/codeUnitOrder';

describe('byCodeUnit (SonarCloud S2871: explicit comparator, unchanged order)', () => {
  it('orders exactly like the default sort, independent of locale', () => {
    const samples = ['b', 'B', 'a', 'A', '_x', '-x', '10', '9', 'é', 'e', 'z', '20261125T101500123Z__a', '20261125T101500124Z__a', ''];
    expect([...samples].sort(byCodeUnit)).toEqual([...samples].sort());
    // localeCompare would interleave case and accents, which would change canonical fingerprints.
    expect([...samples].sort(byCodeUnit)).not.toEqual([...samples].sort((x, y) => x.localeCompare(y)));
  });
});
