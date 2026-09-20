import { describe, it, expect, vi, beforeEach } from 'vitest';
import { buildMatterLegalResearchCandidate, listMatterLegalResearchCandidates } from './matterLegalResearch.js';
import * as access from './access.js';
import * as accounts from './accounts.js';
import { randomUUID } from 'crypto';

vi.mock('./access.js');
vi.mock('./accounts.js');

describe('Stage 9B Matter Legal Research Candidates', () => {
  let mockTables: any;

  beforeEach(() => {
    mockTables = {
      navigator_legal_sources: [],
      navigator_legal_source_versions: [],
      navigator_legal_provisions: [],
      navigator_legal_provision_versions: [],
      navigator_matters: [],
      navigator_matter_members: [],
      navigator_matter_legal_research_candidates: []
    };

    vi.spyOn(accounts, 'findAccount').mockResolvedValue({ id: 'test-account-id', email: 'test@example.com' } as any);

    vi.spyOn(access, 'getSupabase').mockReturnValue({
      from: (table: string) => {
        let rows = mockTables[table] || [];
        const chain: any = {
          select: () => chain,
          insert: (obj: any) => { rows.push({...obj, id: randomUUID(), created_at: new Date().toISOString()}); return chain; },
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

  const matterId = randomUUID();
  const sourceId = randomUUID();
  const versionId = randomUUID();
  const provisionId = randomUUID();

  beforeEach(() => {
    mockTables.navigator_legal_sources.push({
      id: sourceId,
      jurisdiction: 'ON',
      title: 'Child, Youth and Family Services Act, 2017',
      source_type: 'STATUTE',
      citation: 'S.O. 2017, c. 14, Sched. 1',
      official_publisher: 'Ontario e-Laws',
      source_url: 'https://example.com/cyfsa',
      verification_state: 'VERIFIED',
      retrieved_at: '2025-01-01T00:00:00Z'
    });

    mockTables.navigator_legal_source_versions.push({
      id: versionId,
      legal_source_id: sourceId,
      version_label: '2024-01-01 to Present',
      effective_from: '2024-01-01',
      effective_to: null,
      status: 'IN_FORCE',
      verification_state: 'VERIFIED',
      retrieved_at: '2025-01-01T00:00:00Z'
    });

    mockTables.navigator_legal_provisions.push({
      id: provisionId,
      legal_source_id: sourceId,
      citation: 's. 74',
      label: 'Protection hearings',
      verification_state: 'VERIFIED'
    });
    
    mockTables.navigator_legal_provision_versions.push({
      id: randomUUID(),
      provision_id: provisionId,
      legal_source_version_id: versionId
    });
  });

  it('fact -> potentially relevant provision (preserves FACT classification)', async () => {
    const res = await buildMatterLegalResearchCandidate({
      matterId,
      evidenceClassification: 'FACT',
      legalSourceId: sourceId,
      legalSourceVersionId: versionId,
      provisionId,
      reasonForRelevance: 'The timeline of events is potentially relevant to this provision.',
      retrievalBasis: 'Keyword match'
    });
    
    expect(res.evidenceClassification).toBe('FACT');
    expect(res.reviewState).toBe('UNREVIEWED');
  });

  it('allegation -> candidate while preserving ALLEGATION', async () => {
    const res = await buildMatterLegalResearchCandidate({
      matterId,
      evidenceClassification: 'ALLEGATION',
      legalSourceId: sourceId,
      legalSourceVersionId: versionId,
      provisionId,
      reasonForRelevance: 'This allegation may engage the protection hearing requirement.',
      retrievalBasis: 'AI extraction'
    });
    
    expect(res.evidenceClassification).toBe('ALLEGATION');
  });

  it('opinion -> candidate while preserving OPINION', async () => {
    const res = await buildMatterLegalResearchCandidate({
      matterId,
      evidenceClassification: 'OPINION',
      legalSourceId: sourceId,
      legalSourceVersionId: versionId,
      provisionId,
      reasonForRelevance: 'The professional assessment identified this potential legal issue.',
      retrievalBasis: 'Professional context'
    });
    
    expect(res.evidenceClassification).toBe('OPINION');
  });

  it('missing version (historical event unknown) -> unresolved', async () => {
    const res = await buildMatterLegalResearchCandidate({
      matterId,
      legalSourceId: sourceId,
      provisionId,
      reasonForRelevance: 'Needs legal review.',
      retrievalBasis: 'Search'
    });
    
    expect(res.legalSourceVersionId).toBeNull();
    expect(res.reviewState).toBe('REQUIRES_RESEARCH');
  });

  it('invalid provision-version relationship rejected', async () => {
    const wrongVersion = randomUUID();
    mockTables.navigator_legal_source_versions.push({
      id: wrongVersion,
      legal_source_id: sourceId,
      version_label: 'Wrong',
      effective_from: '2020-01-01',
      effective_to: '2021-01-01'
    });
    
    await expect(buildMatterLegalResearchCandidate({
      matterId,
      legalSourceId: sourceId,
      legalSourceVersionId: wrongVersion,
      provisionId,
      reasonForRelevance: 'Checking bad link.',
      retrievalBasis: 'Search'
    })).rejects.toThrow('Requested provision does not exist in the requested source version');
  });

  it('content-integrity verified state', async () => {
    const content = 'This is the law.';
    const { computeLegalContentHash } = await import('./legalSources.js');
    const hash = computeLegalContentHash(content);
    
    const res = await buildMatterLegalResearchCandidate({
      matterId,
      legalSourceId: sourceId,
      legalSourceVersionId: versionId,
      provisionId,
      reasonForRelevance: 'Checking integrity.',
      retrievalBasis: 'Search',
      expectedContentHash: hash,
      actualContent: content
    });
    
    expect(res.contentIntegrityStatus).toBe('VERIFIED');
  });
  
  it('content-integrity mismatch fail closed', async () => {
    const res = await buildMatterLegalResearchCandidate({
      matterId,
      legalSourceId: sourceId,
      legalSourceVersionId: versionId,
      provisionId,
      reasonForRelevance: 'Checking integrity.',
      retrievalBasis: 'Search',
      expectedContentHash: 'expectedhash123',
      actualContent: 'Altered text.'
    });
    
    expect(res.contentIntegrityStatus).toBe('FAILED');
    expect(res.reviewState).toBe('REQUIRES_RESEARCH');
  });

  it('content-integrity unavailable state (hash persistence limitation)', async () => {
    const res = await buildMatterLegalResearchCandidate({
      matterId,
      legalSourceId: sourceId,
      legalSourceVersionId: versionId,
      provisionId,
      reasonForRelevance: 'Checking integrity.',
      retrievalBasis: 'Search'
    });
    
    expect(res.contentIntegrityStatus).toBe('NOT_CHECKED');
  });

  it('deterministic retrieval basis exposed', async () => {
    const res = await buildMatterLegalResearchCandidate({
      matterId,
      legalSourceId: sourceId,
      legalSourceVersionId: versionId,
      provisionId,
      reasonForRelevance: 'Checking basis.',
      retrievalBasis: 'Structured statutory mapping'
    });
    
    expect(res.retrievalBasis).toBe('Structured statutory mapping');
  });
  
  it('legal source provenance preserved', async () => {
    const res = await buildMatterLegalResearchCandidate({
      matterId,
      legalSourceId: sourceId,
      legalSourceVersionId: versionId,
      provisionId,
      reasonForRelevance: 'Checking provenance.',
      retrievalBasis: 'Search'
    });
    
    expect(res.sourceProvenance).toBe('https://example.com/cyfsa');
  });

  it('case authority metadata preservation', async () => {
    const caseSourceId = randomUUID();
    mockTables.navigator_legal_sources.push({
      id: caseSourceId,
      jurisdiction: 'ON',
      title: 'CAS v. Parent',
      source_type: 'CASE_LAW',
      citation: '2024 ONSC 123',
      official_publisher: 'CanLII',
      source_url: 'https://canlii.ca/123',
      verification_state: 'VERIFIED',
      retrieved_at: '2025-01-01T00:00:00Z',
      court: 'ONSC',
      decision_date: '2024-05-01'
    });

    const res = await buildMatterLegalResearchCandidate({
      matterId,
      legalSourceId: caseSourceId,
      reasonForRelevance: 'Potentially relevant case.',
      retrievalBasis: 'Citation match'
    });
    
    expect(res.sourceProvenance).toBe('https://canlii.ca/123');
  });

  it('rejects conclusionary language in reasonForRelevance', async () => {
    await expect(buildMatterLegalResearchCandidate({
      matterId,
      legalSourceId: sourceId,
      legalSourceVersionId: versionId,
      provisionId,
      reasonForRelevance: 'This proves the CAS violated the law.',
      retrievalBasis: 'AI'
    })).rejects.toThrow('Legal-relevance reasoning must state potential relevance, not a legal conclusion.');
  });

  // Security tests
  it('requires authorized matter access (test fails if matter authorization filter is removed)', async () => {
    // Member list is EMPTY for this matter
    await expect(listMatterLegalResearchCandidates('fake-uid', matterId))
      .rejects.toThrow('Access denied to this matter.');
  });

  it('allows access for authorized member', async () => {
    mockTables.navigator_matter_members.push({
      matter_id: matterId,
      account_id: 'test-account-id',
      role: 'REVIEWER'
    });

    const result = await listMatterLegalResearchCandidates('fake-uid', matterId);
    expect(result).toEqual([]);
  });
});
