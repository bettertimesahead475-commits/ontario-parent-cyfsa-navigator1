import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import {
  createMatterResearchRun,
  listMatterResearchRuns,
  recordMatterResearchRunResult,
  listMatterResearchRunResults
} from './matterResearchRuns.js';
import * as access from './access.js';
import * as accounts from './accounts.js';

vi.mock('./access.js');
vi.mock('./accounts.js');

describe('Stage 9D-1 Matter Research Runs — persistence foundation', () => {
  let mockTables: any;
  const matterId = randomUUID();
  const otherMatterId = randomUUID();
  const inaccessibleMatterId = randomUUID();
  const sourceId = randomUUID();
  const candidateId = randomUUID();
  const foreignCandidateId = randomUUID();

  beforeEach(() => {
    mockTables = {
      navigator_matter_members: [
        { matter_id: matterId, account_id: 'test-account-id', role: 'OWNER' },
        { matter_id: otherMatterId, account_id: 'other-account-id', role: 'OWNER' },
        // test-account-id also has legitimate access to otherMatterId, so the cross-matter
        // rejection tests below prove the FK/query-scoping boundary, not merely membership.
        { matter_id: otherMatterId, account_id: 'test-account-id', role: 'OWNER' }
      ],
      navigator_matter_legal_research_candidates: [
        { id: candidateId, matter_id: matterId, legal_source_id: sourceId },
        { id: foreignCandidateId, matter_id: otherMatterId, legal_source_id: sourceId }
      ],
      navigator_matter_research_runs: [],
      navigator_matter_research_run_results: []
    };

    vi.spyOn(accounts, 'findAccount').mockResolvedValue({ id: 'test-account-id', email: 'test@example.com' } as any);

    vi.spyOn(access, 'getSupabase').mockReturnValue({
      from: (table: string) => {
        let rows = mockTables[table] || [];
        const chain: any = {
          select: () => chain,
          insert: (obj: any) => {
            const newRow = { ...obj, id: randomUUID(), created_at: new Date().toISOString(), discovered_at: new Date().toISOString() };
            mockTables[table].push(newRow);
            rows = [newRow];
            return chain;
          },
          eq: (col: string, val: any) => {
            rows = rows.filter((r: any) => r[col] === val);
            return chain;
          },
          single: async () => ({ data: rows[0], error: rows.length === 0 ? new Error('Not found') : null }),
          maybeSingle: async () => ({ data: rows.length > 0 ? rows[0] : null, error: null })
        };
        chain.then = (resolve: any) => resolve({ data: rows, error: null });
        return chain;
      }
    } as any);
  });

  describe('1. Research run is matter-bound', () => {
    it('creates a run scoped to the caller-authorized matter', async () => {
      const run = await createMatterResearchRun('uid', { matterId, triggerType: 'MANUAL' });
      expect(run.matterId).toBe(matterId);
      expect(run.triggeredByAccountId).toBe('test-account-id');
      expect(run.status).toBe('PENDING');
    });

    it('rejects a run for a matter the caller has no membership row for', async () => {
      await expect(createMatterResearchRun('uid', { matterId: inaccessibleMatterId, triggerType: 'MANUAL' }))
        .rejects.toMatchObject({ statusCode: 403 });
    });

    it('never persists a triggering account for a SCHEDULED/SYSTEM run, even implicitly', async () => {
      const run = await createMatterResearchRun('uid', { matterId, triggerType: 'SYSTEM' });
      expect(run.triggeredByAccountId).toBeNull();
      expect(run.triggerType).toBe('SYSTEM');
    });

    it('rejects an unknown trigger type', async () => {
      await expect(createMatterResearchRun('uid', { matterId, triggerType: 'HACKED' as any }))
        .rejects.toMatchObject({ statusCode: 400 });
    });
  });

  describe('2. Discovery result cannot accidentally reference the wrong matter', () => {
    it('rejects a result referencing a run from a different matter than the authorized one', async () => {
      const foreignRun = await createMatterResearchRun('other-uid', { matterId: otherMatterId, triggerType: 'MANUAL' });
      vi.spyOn(accounts, 'findAccount').mockResolvedValue({ id: 'test-account-id' } as any);

      await expect(recordMatterResearchRunResult('uid', {
        matterId,
        researchRunId: foreignRun.id,
        candidateId
      })).rejects.toMatchObject({ statusCode: 404 });
    });

    it('rejects a result referencing a candidate from a different matter than the run', async () => {
      const run = await createMatterResearchRun('uid', { matterId, triggerType: 'MANUAL' });

      await expect(recordMatterResearchRunResult('uid', {
        matterId,
        researchRunId: run.id,
        candidateId: foreignCandidateId
      })).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('3. Authority identity uses the canonical candidate structure, not a free-form copy', () => {
    it('a recorded result carries only candidateId, never a duplicated citation/source field', async () => {
      const run = await createMatterResearchRun('uid', { matterId, triggerType: 'MANUAL' });
      const result = await recordMatterResearchRunResult('uid', {
        matterId,
        researchRunId: run.id,
        candidateId
      });
      expect(result.candidateId).toBe(candidateId);
      expect(result).not.toHaveProperty('legalSourceId');
      expect(result).not.toHaveProperty('citation');
      expect(result).not.toHaveProperty('verificationState');
    });
  });

  describe('4. Machine discovery and professional review are structurally distinct', () => {
    it('a discovered result carries only discoveryStatus, never a review_state/reviewed_by field', async () => {
      const run = await createMatterResearchRun('uid', { matterId, triggerType: 'MANUAL' });
      const result = await recordMatterResearchRunResult('uid', {
        matterId,
        researchRunId: run.id,
        candidateId
      });
      expect(result.discoveryStatus).toBe('CANDIDATE_DISCOVERED');
      expect(result).not.toHaveProperty('reviewState');
      expect(result).not.toHaveProperty('reviewedBy');
    });

    it('supplying a ranking method advances discoveryStatus to RANKED, not a review state', async () => {
      const run = await createMatterResearchRun('uid', { matterId, triggerType: 'MANUAL' });
      const result = await recordMatterResearchRunResult('uid', {
        matterId,
        researchRunId: run.id,
        candidateId,
        rankingMethod: 'keyword-overlap-v1',
        rankingScore: 0.75,
        rankingFactors: { matchedTerms: ['section 74'] }
      });
      expect(result.discoveryStatus).toBe('RANKED');
      expect(result.rankingScore).toBe(0.75);
    });
  });

  describe('5. Ranking/provenance metadata cannot redefine authority verification', () => {
    it('rejects an out-of-range ranking score', async () => {
      const run = await createMatterResearchRun('uid', { matterId, triggerType: 'MANUAL' });
      await expect(recordMatterResearchRunResult('uid', {
        matterId,
        researchRunId: run.id,
        candidateId,
        rankingMethod: 'keyword-overlap-v1',
        rankingScore: 4.2
      })).rejects.toMatchObject({ statusCode: 400 });
    });

    it('rejects ranking score/factors supplied without a ranking method', async () => {
      const run = await createMatterResearchRun('uid', { matterId, triggerType: 'MANUAL' });
      await expect(recordMatterResearchRunResult('uid', {
        matterId,
        researchRunId: run.id,
        candidateId,
        rankingScore: 0.5
      })).rejects.toMatchObject({ statusCode: 400 });
    });

    it('the result type exposes no field that could override or assert a verification_state', async () => {
      const run = await createMatterResearchRun('uid', { matterId, triggerType: 'MANUAL' });
      const result = await recordMatterResearchRunResult('uid', {
        matterId,
        researchRunId: run.id,
        candidateId,
        rankingMethod: 'keyword-overlap-v1',
        rankingFactors: { verificationState: 'VERIFIED', trust: 'ABSOLUTE' } as any
      });
      // rankingFactors is opaque explainability data; it is never read back as authority trust
      // by this service, and no top-level field on the mapped result claims a trust state.
      expect(result).not.toHaveProperty('verificationState');
      expect(result).not.toHaveProperty('trustState');
    });
  });

  describe('6. Required linkage cannot orphan silently', () => {
    it('rejects a result for a nonexistent research run', async () => {
      await expect(recordMatterResearchRunResult('uid', {
        matterId,
        researchRunId: randomUUID(),
        candidateId
      })).rejects.toMatchObject({ statusCode: 404 });
    });

    it('rejects a result for a nonexistent candidate', async () => {
      const run = await createMatterResearchRun('uid', { matterId, triggerType: 'MANUAL' });
      await expect(recordMatterResearchRunResult('uid', {
        matterId,
        researchRunId: run.id,
        candidateId: randomUUID()
      })).rejects.toMatchObject({ statusCode: 404 });
    });
  });

  describe('Listing is matter-scoped', () => {
    it('lists only runs and results belonging to the authorized matter', async () => {
      const run = await createMatterResearchRun('uid', { matterId, triggerType: 'MANUAL' });
      await recordMatterResearchRunResult('uid', { matterId, researchRunId: run.id, candidateId });

      const runs = await listMatterResearchRuns('uid', matterId);
      expect(runs).toHaveLength(1);
      expect(runs[0].matterId).toBe(matterId);

      const results = await listMatterResearchRunResults('uid', matterId);
      expect(results).toHaveLength(1);
      expect(results[0].matterId).toBe(matterId);
    });

    it('rejects listing for a matter the caller has no membership row for', async () => {
      await expect(listMatterResearchRuns('uid', inaccessibleMatterId)).rejects.toMatchObject({ statusCode: 403 });
      await expect(listMatterResearchRunResults('uid', inaccessibleMatterId)).rejects.toMatchObject({ statusCode: 403 });
    });
  });
});
