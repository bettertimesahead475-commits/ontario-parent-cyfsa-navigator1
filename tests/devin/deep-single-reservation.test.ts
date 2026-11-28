import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// Guard: a request reserves credit exactly once, and a direct Deep Scan does not also reserve a Basic (quick) credit.
// Basic-to-Deep reuse never adds a reservation, because reuse happens inside one request after one reservation.
const SRC = readFileSync(new URL('../../functions/api/analyze.ts', import.meta.url), 'utf8');

describe('credit reservation for a direct Deep Scan', () => {
  it('has exactly one reservation call site in the analyze handler', () => {
    const calls = SRC.match(/reserveVerifiedPaidCredit\(/g) ?? [];
    // One call plus the import line is not a call; the import is written with a trailing comma or brace.
    expect(calls).toHaveLength(1);
  });

  it('chooses the forensic type only from the requested mode', () => {
    expect(SRC).toMatch(/reserveVerifiedPaidCredit\(sessionRead\.session, isForensic \? 'forensic' : 'quick', requestId, rpc\)/);
    expect(SRC).toMatch(/const isForensic = mode === 'full';/);
  });

  it('no reuse or foundation path issues a credit reservation', () => {
    for (const name of ['planForensicReuse', 'loadFoundationBlock', 'persistFoundation', 'planAnalysisReuse']) {
      const body = SRC.slice(SRC.indexOf(`function ${name}`), SRC.indexOf(`function ${name}`) + 1200);
      expect(body).not.toMatch(/reserveVerifiedPaidCredit|paid_reserve_credit|free_reserve_scan/);
    }
  });
});
