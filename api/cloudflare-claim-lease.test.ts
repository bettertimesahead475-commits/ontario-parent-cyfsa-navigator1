// Regression: the consumer does not renew a job's lease. The lease must outlast the longest analysis,
// otherwise a second worker reclaims a running job and the analysis (and its charge) runs twice.
import { describe, expect, it } from 'vitest';
import { CLAIM_LEASE_SECONDS, MAX_ANALYSIS_BUDGET_SECONDS } from '../functions/api/_analyzer-queue-contract';

describe('queue claim lease', () => {
  it('outlasts the largest permitted Forensic budget with a safety margin', () => {
    expect(CLAIM_LEASE_SECONDS).toBeGreaterThanOrEqual(MAX_ANALYSIS_BUDGET_SECONDS + 120);
  });

  it('stays within the database cap, so the lease is never silently shortened', () => {
    expect(CLAIM_LEASE_SECONDS).toBeLessThanOrEqual(600);
  });

  it('is the lease the consumer actually claims with', async () => {
    const fs = await import('node:fs');
    const src = fs.readFileSync(new URL('../workers/analyzer-queue-consumer.ts', import.meta.url), 'utf8');
    expect(src).toMatch(/claimDurableJob\(env, parsed\.jobId, token, CLAIM_LEASE_SECONDS\)/);
    expect(src).not.toMatch(/claimDurableJob\(env, parsed\.jobId, token, 240\)/);
  });
});
