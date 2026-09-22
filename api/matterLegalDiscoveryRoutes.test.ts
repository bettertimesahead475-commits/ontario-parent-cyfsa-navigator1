import { describe, it, expect, vi, beforeEach } from 'vitest';
import { randomUUID } from 'crypto';
import express from 'express';
import request from 'supertest';
import * as access from './services/access.js';
import * as accounts from './services/accounts.js';
import { computeLegalContentHash } from './services/legalSources.js';

vi.mock('./services/access.js');
vi.mock('./services/accounts.js');
vi.mock('./services/firebaseAdmin.js', () => ({
  verifyFirebaseToken: vi.fn(async (header: string | undefined) => {
    if (!header) return null;
    if (header === 'Bearer throws') throw new Error('credential secret');
    const match = /^Bearer (.+)$/.exec(header);
    if (!match) return null;
    // Only these literal tokens resolve to a real identity — anything else (including a
    // spoofed uid string) fails closed.
    const known = ['uid-A', 'uid-B', 'uid-professional-only', 'uid-lawyer-only'];
    if (known.includes(match[1])) {
      return { uid: match[1], email: `${match[1]}@example.test` };
    }
    return null;
  })
}));

import { registerMatterLegalDiscoveryRoutes } from './matterLegalDiscoveryRoutes.js';

describe('Stage 9D-2b — authenticated matter legal discovery API', () => {
  let mockTables: any;

  const matterA = randomUUID();
  const matterB = randomUUID();
  const sourceId = randomUUID();
  const provisionId = randomUUID();
  const verifiedVersionId = randomUUID();
  const malformedId = 'not-a-uuid';
  const nonexistentId = randomUUID();

  const VALID_TEXT = 'This is the verified canonical text of the provision.';

  function freshTables() {
    return {
      // account-A ("test-account-A") is an OWNER of matterA only.
      // account-B ("test-account-B") is an OWNER of matterB only.
      navigator_matter_members: [
        { matter_id: matterA, account_id: 'test-account-A', role: 'OWNER' },
        { matter_id: matterB, account_id: 'test-account-B', role: 'OWNER' }
      ],
      navigator_claims: [
        { id: randomUUID(), matter_id: matterA, proposition: 'protection hearing custody apprehension occurred', classification: 'ALLEGATION' }
      ],
      navigator_events: [],
      navigator_evidence_items: [],
      navigator_legal_sources: [
        {
          id: sourceId, jurisdiction: 'ON', title: 'Child, Youth and Family Services Act, 2017',
          source_type: 'STATUTE', citation: 'S.O. 2017, c. 14, Sched. 1', official_publisher: 'Ontario e-Laws',
          source_url: 'https://example.com/cyfsa', verification_state: 'VERIFIED', retrieved_at: '2025-01-01T00:00:00Z'
        }
      ],
      navigator_legal_source_versions: [
        {
          id: verifiedVersionId, legal_source_id: sourceId, version_label: '2020-01-01 to Present',
          effective_from: '2020-01-01', effective_to: null, status: 'IN_FORCE',
          verification_state: 'VERIFIED', retrieved_at: '2025-01-01T00:00:00Z'
        }
      ],
      navigator_legal_provisions: [
        { id: provisionId, legal_source_id: sourceId, citation: 's. 74', label: 'Protection hearings custody apprehension', verification_state: 'VERIFIED' }
      ],
      navigator_legal_provision_versions: [
        {
          id: randomUUID(), provision_id: provisionId, legal_source_id: sourceId,
          legal_source_version_id: verifiedVersionId, effective_from: '2020-01-01', effective_to: null,
          exact_text: VALID_TEXT, text_sha256: computeLegalContentHash(VALID_TEXT)
        }
      ],
      navigator_matter_legal_research_candidates: [],
      navigator_matter_research_runs: [],
      navigator_matter_research_run_results: []
    };
  }

  function installFakeDb() {
    vi.spyOn(access, 'getSupabase').mockReturnValue({
      from: (table: string) => {
        let rows = mockTables[table] || [];
        let pendingUpdate: any = null;
        const chain: any = {
          select: () => chain,
          update: (obj: any) => { pendingUpdate = obj; return chain; },
          upsert: (obj: any) => {
            const existing = rows.find((r: any) =>
              r.matter_id === obj.matter_id && r.evidence_item_id === obj.evidence_item_id &&
              r.event_id === obj.event_id && r.legal_source_id === obj.legal_source_id &&
              r.provision_id === obj.provision_id && r.retrieval_basis === obj.retrieval_basis);
            if (existing) { Object.assign(existing, obj); rows = [existing]; return chain; }
            const newRow = { ...obj, id: randomUUID(), created_at: new Date().toISOString() };
            mockTables[table].push(newRow); rows = [newRow];
            return chain;
          },
          insert: (obj: any) => {
            const newRow = { ...obj, id: randomUUID(), created_at: new Date().toISOString(), discovered_at: new Date().toISOString() };
            mockTables[table].push(newRow); rows = [newRow];
            return chain;
          },
          eq: (col: string, val: any) => { rows = rows.filter((r: any) => r[col] === val); return chain; },
          single: async () => {
            if (pendingUpdate && rows.length > 0) Object.assign(rows[0], pendingUpdate);
            return { data: rows[0], error: rows.length === 0 ? new Error('Not found') : null };
          },
          maybeSingle: async () => ({ data: rows.length > 0 ? rows[0] : null, error: null })
        };
        chain.then = (resolve: any) => resolve({ data: rows, error: null });
        return chain;
      }
    } as any);
  }

  beforeEach(() => {
    mockTables = freshTables();
    installFakeDb();
    vi.spyOn(accounts, 'findAccount').mockImplementation(async (uid: string) => {
      if (uid === 'uid-A') return { id: 'test-account-A', email: 'uid-A@example.test' } as any;
      if (uid === 'uid-B') return { id: 'test-account-B', email: 'uid-B@example.test' } as any;
      if (uid === 'uid-professional-only') return { id: 'test-account-professional', email: 'p@example.test' } as any;
      if (uid === 'uid-lawyer-only') return { id: 'test-account-lawyer', email: 'l@example.test' } as any;
      return null;
    });
  });

  const app = express();
  app.use(express.json());
  registerMatterLegalDiscoveryRoutes(app);

  const start = (matterId: string, body: any = {}, uid = 'uid-A') =>
    request(app).post(`/api/matters/${matterId}/legal-discovery/runs`).set('Authorization', `Bearer ${uid}`).send(body);
  const listRuns = (matterId: string, uid = 'uid-A') =>
    request(app).get(`/api/matters/${matterId}/legal-discovery/runs`).set('Authorization', `Bearer ${uid}`);
  const results = (matterId: string, runId: string, uid = 'uid-A') =>
    request(app).get(`/api/matters/${matterId}/legal-discovery/runs/${runId}/results`).set('Authorization', `Bearer ${uid}`);

  // -------------------------------------------------------------------
  // Core positive paths
  // -------------------------------------------------------------------
  it('authorized start succeeds and returns the server-derived run/results', async () => {
    const response = await start(matterA);
    expect(response.status).toBe(201);
    expect(response.body.run.matterId).toBe(matterA);
    expect(response.body.run.status).toBe('COMPLETED');
    expect(response.body.resultCount).toBe(1);
    expect(response.body.results[0].rankingFactors.algorithmVersion).toBe('stage9d-discovery-v1');
  });

  it('lists runs and retrieves results for an authorized matter, exposing real fields', async () => {
    await start(matterA);
    const runsResponse = await listRuns(matterA);
    expect(runsResponse.status).toBe(200);
    expect(runsResponse.body.runs).toHaveLength(1);
    const runId = runsResponse.body.runs[0].id;

    const resultsResponse = await results(matterA, runId);
    expect(resultsResponse.status).toBe(200);
    expect(resultsResponse.body.run.status).toBe('COMPLETED');
    expect(resultsResponse.body.results).toHaveLength(1);
    const r = resultsResponse.body.results[0];
    expect(r).toHaveProperty('rankingScore');
    expect(r).toHaveProperty('rankingFactors');
    expect(r.rankingFactors).toHaveProperty('legalSourceVerificationState');
    expect(r.rankingFactors).toHaveProperty('contextMatches');
  });

  // -------------------------------------------------------------------
  // IDOR matrix
  // -------------------------------------------------------------------
  it('denies an unauthenticated start request', async () => {
    const response = await request(app).post(`/api/matters/${matterA}/legal-discovery/runs`).send({});
    expect(response.status).toBe(401);
  });

  it('denies an unauthenticated runs-list request', async () => {
    expect((await request(app).get(`/api/matters/${matterA}/legal-discovery/runs`)).status).toBe(401);
  });

  it('denies an unauthenticated results request', async () => {
    expect((await request(app).get(`/api/matters/${matterA}/legal-discovery/runs/${randomUUID()}/results`)).status).toBe(401);
  });

  it('denies an authenticated user with no membership on the target matter', async () => {
    const response = await start(matterA, {}, 'uid-B');
    expect(response.status).toBe(403);
  });

  it('denies a professional-profile-only account (no matter membership) from starting discovery', async () => {
    const response = await start(matterA, {}, 'uid-professional-only');
    expect(response.status).toBe(403);
  });

  it('denies a verified-lawyer-only account (no matter membership) from starting discovery', async () => {
    const response = await start(matterA, {}, 'uid-lawyer-only');
    expect(response.status).toBe(403);
  });

  it('denies Matter-A-authorized user requesting Matter-B discovery start', async () => {
    expect((await start(matterB, {}, 'uid-A')).status).toBe(403);
  });

  it('denies Matter-A user listing Matter-B runs', async () => {
    expect((await listRuns(matterB, 'uid-A')).status).toBe(403);
  });

  it('denies/not-found-safely when Matter-A user supplies a Matter-B run ID while claiming Matter A', async () => {
    await start(matterB, {}, 'uid-B');
    const bRuns = await listRuns(matterB, 'uid-B');
    const bRunId = bRuns.body.runs[0].id;

    const response = await results(matterA, bRunId, 'uid-A');
    expect(response.status).toBe(404);
    expect(response.body.code).toBe('RESEARCH_RUN_NOT_FOUND');
  });

  it('denies/not-found-safely when mixing a valid Matter-A run ID with cross-matter access as Matter-B user', async () => {
    await start(matterA, {}, 'uid-A');
    const aRuns = await listRuns(matterA, 'uid-A');
    const aRunId = aRuns.body.runs[0].id;

    const response = await results(matterB, aRunId, 'uid-B');
    expect(response.status).toBe(404);
  });

  it('denies a valid run ID request without matter access on that run\'s matter', async () => {
    await start(matterA, {}, 'uid-A');
    const aRuns = await listRuns(matterA, 'uid-A');
    const aRunId = aRuns.body.runs[0].id;
    // uid-B has no membership on matterA at all.
    const response = await results(matterA, aRunId, 'uid-B');
    expect(response.status).toBe(403);
  });

  it('grants nothing from candidate/result ID knowledge alone — a random run id under an authorized matter 404s safely', async () => {
    const response = await results(matterA, nonexistentId, 'uid-A');
    expect(response.status).toBe(404);
  });

  it('fails safely for a nonexistent matter id', async () => {
    expect((await listRuns(nonexistentId, 'uid-A')).status).toBe(403);
  });

  it('rejects a malformed matter id before any DB access', async () => {
    expect((await listRuns(malformedId, 'uid-A')).status).toBe(400);
  });

  it('rejects a malformed run id before any DB access', async () => {
    const response = await request(app)
      .get(`/api/matters/${matterA}/legal-discovery/runs/${malformedId}/results`)
      .set('Authorization', 'Bearer uid-A');
    expect(response.status).toBe(400);
  });

  // -------------------------------------------------------------------
  // Trust-input adversarial test
  // -------------------------------------------------------------------
  it('ignores caller-supplied trust/verification/version override fields entirely', async () => {
    const response = await start(matterA, {
      verificationState: 'VERIFIED',
      contentIntegrityStatus: 'VERIFIED',
      approved: true,
      validated: true,
      sourceVersionId: 'attacker-supplied-version-id',
      provisionVersionId: 'attacker-supplied-provision-version-id',
      rankingScore: 999,
      rankingFactors: { algorithmVersion: 'attacker-version' },
      candidateId: randomUUID(),
      legalSourceId: randomUUID()
    }, 'uid-A');

    expect(response.status).toBe(201);
    // The only real provision in the fixture is server-resolved; the injected legalSourceId is
    // never consulted, and the persisted ranking factors are the service's own, not the
    // attacker's injected values.
    expect(response.body.results[0].rankingFactors.algorithmVersion).toBe('stage9d-discovery-v1');
    expect(response.body.results[0].rankingScore).not.toBe(999);
    expect(response.body.run.matterId).toBe(matterA);
  });

  it('rejects invalid triggerType/maxResults rather than silently accepting them', async () => {
    expect((await start(matterA, { triggerType: 'HACKED' })).status).toBe(400);
    expect((await start(matterA, { maxResults: -1 })).status).toBe(400);
    expect((await start(matterA, { maxResults: 'lots' })).status).toBe(400);
  });

  // -------------------------------------------------------------------
  // FAILED / partial-run semantics
  // -------------------------------------------------------------------
  it('honestly reports COMPLETED with zero results when nothing is eligible for discovery (not silently FAILED)', async () => {
    // Force the candidate save step to fail after the run row is created, by making the
    // candidates table insert throw via a corrupt legal source row (candidate build re-verifies
    // the source live and will reject).
    mockTables.navigator_legal_sources[0].verification_state = 'REVOKED';

    // With no eligible provisions there is nothing to discover, but the run should still
    // complete honestly (COMPLETED, zero results) -- this exercises the honest-status contract
    // end-to-end through the route rather than assuming it.
    const response = await start(matterA, {}, 'uid-A');
    expect(response.status).toBe(201);
    expect(response.body.run.status).toBe('COMPLETED');
    expect(response.body.resultCount).toBe(0);

    const runsResponse = await listRuns(matterA, 'uid-A');
    expect(runsResponse.body.runs[0].status).toBe('COMPLETED');
  });

  it('surfaces a genuinely FAILED run (never silently as COMPLETED) when persistence fails mid-run', async () => {
    const originalFrom = (access.getSupabase as any)();
    // Make the run-result insert fail after the run row + candidate are created, by breaking the
    // run_results table's insert so the underlying service throws and marks the run FAILED.
    vi.spyOn(access, 'getSupabase').mockReturnValue({
      from: (table: string) => {
        if (table === 'navigator_matter_research_run_results') {
          return {
            select: () => ({ eq: () => ({ eq: () => ({ then: (resolve: any) => resolve({ data: [], error: null }) }) }) }),
            insert: () => { throw new Error('simulated DB failure'); }
          } as any;
        }
        return originalFrom.from(table);
      }
    } as any);

    const response = await start(matterA, {}, 'uid-A');
    expect(response.status).toBe(500);

    // Reinstall the working fake DB to read back the run's honest status.
    installFakeDb();
    const runsResponse = await listRuns(matterA, 'uid-A');
    expect(runsResponse.body.runs.some((r: any) => r.status === 'FAILED')).toBe(true);
  });

  // -------------------------------------------------------------------
  // Idempotence through the API layer
  // -------------------------------------------------------------------
  it('repeated discovery-start requests reuse (not duplicate) the same candidate', async () => {
    await start(matterA, {}, 'uid-A');
    await start(matterA, {}, 'uid-A');
    expect(mockTables.navigator_matter_legal_research_candidates).toHaveLength(1);
    expect(mockTables.navigator_matter_research_runs).toHaveLength(2);
  });

  // -------------------------------------------------------------------
  // Response shaping
  // -------------------------------------------------------------------
  it('never leaks raw DB errors, stack traces or internal secrets on failure', async () => {
    vi.spyOn(access, 'getSupabase').mockReturnValue({
      from: () => ({
        select: () => ({ eq: () => ({ eq: () => ({
          single: async () => ({ data: null, error: { message: 'raw SQL secret internal_table service_role_key' } }),
          then: (resolve: any) => resolve({ data: null, error: { message: 'raw SQL secret internal_table service_role_key' } })
        }) }) })
      })
    } as any);
    const response = await listRuns(matterA, 'uid-A');
    expect(response.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(response.body)).not.toMatch(/SQL|secret|internal_table|service_role_key/);
  });

  it('handles a verifier rejection without leaking detail', async () => {
    const response = await start(matterA, {}, 'throws');
    expect(response.status).toBe(500);
    expect(JSON.stringify(response.body)).not.toContain('secret');
  });
});
