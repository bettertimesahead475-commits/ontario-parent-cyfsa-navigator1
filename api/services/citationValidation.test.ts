import { describe, it, expect, vi, beforeEach } from 'vitest';
import { validateCandidateCitation } from './citationValidation.js';
import * as access from './access.js';
import * as accounts from './accounts.js';
import { randomUUID } from 'crypto';

vi.mock('./access.js');
vi.mock('./accounts.js');

describe('Stage 9C Citation & Authority Validation', () => {
  let mockTables: any;
  const matterId = randomUUID();
  const candidateId = randomUUID();
  const sourceId = randomUUID();
  const versionId = randomUUID();
  const provisionId = randomUUID();
  const accountId = 'test-account-id';

  beforeEach(async () => {
    mockTables = {
      navigator_legal_sources: [],
      navigator_legal_source_versions: [],
      navigator_legal_provisions: [],
      navigator_legal_provision_versions: [],
      navigator_matters: [],
      navigator_matter_members: [{ matter_id: matterId, account_id: accountId, role: 'OWNER' }],
      navigator_matter_legal_research_candidates: []
    };

    vi.spyOn(accounts, 'findAccount').mockResolvedValue({ id: accountId, email: 'test@example.com' } as any);

    vi.spyOn(access, 'getSupabase').mockReturnValue({
      from: (table: string) => {
        let rows = mockTables[table] || [];
        const chain: any = {
          select: () => chain,
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

    const { computeLegalContentHash } = await import('./legalSources.js');
    mockTables.navigator_legal_provision_versions.push({
      id: randomUUID(),
      provision_id: provisionId,
      legal_source_version_id: versionId,
      text_sha256: computeLegalContentHash('This is the authoritative law text.'),
      exact_text: 'This is the authoritative law text.'
    });

    mockTables.navigator_matter_legal_research_candidates.push({
      id: candidateId,
      matter_id: matterId,
      legal_source_id: sourceId,
      legal_source_version_id: versionId,
      provision_id: provisionId,
      content_integrity_status: 'VERIFIED',
      effective_date_context: 'Effective: 2024-01-01 to present'
    });
  });

  it('valid source, version, provision resolves to VALIDATED', async () => {
    const res = await validateCandidateCitation('test-uid', { matterId, candidateId });
    expect(res.authorityValidationStatus).toBe('VALIDATED');
    expect(res.exactQuoteStatus).toBe('NOT_CHECKED');
    expect(res.pinpointStatus).toBe('NOT_APPLICABLE');
  });

  it('validates exact quote correctly', async () => {
    const res = await validateCandidateCitation('test-uid', { 
      matterId, candidateId, exactQuoteToVerify: 'authoritative law text' 
    });
    expect(res.exactQuoteStatus).toBe('VERIFIED');
    expect(res.authorityValidationStatus).toBe('VALIDATED');
  });

  it('rejects altered quote', async () => {
    const res = await validateCandidateCitation('test-uid', { 
      matterId, candidateId, exactQuoteToVerify: 'altered law text' 
    });
    expect(res.exactQuoteStatus).toBe('ALTERED');
    expect(res.authorityValidationStatus).toBe('INVALID');
  });

  it('caller pinpoint remains UNVERIFIED', async () => {
    const res = await validateCandidateCitation('test-uid', { 
      matterId, candidateId, callerPinpoint: 'para 2' 
    });
    expect(res.pinpointStatus).toBe('UNVERIFIED');
    expect(res.authorityValidationStatus).toBe('REQUIRES_RESEARCH');
  });

  it('denies access if revoked membership', async () => {
    mockTables.navigator_matter_members = []; // Revoke access
    await expect(validateCandidateCitation('test-uid', { matterId, candidateId }))
      .rejects.toThrow('Access denied to this matter');
  });

  it('denies direct-ID cross-matter attempt', async () => {
    const otherMatterId = randomUUID();
    // Use candidateId but with another matterId
    await expect(validateCandidateCitation('test-uid', { matterId: otherMatterId, candidateId }))
      .rejects.toThrow('Access denied to this matter');
  });

  it('rejects missing source', async () => {
    mockTables.navigator_legal_sources = [];
    await expect(validateCandidateCitation('test-uid', { matterId, candidateId }))
      .rejects.toThrow('Authoritative legal source record not found');
  });

  it('rejects source/version mismatch', async () => {
    mockTables.navigator_legal_source_versions[0].legal_source_id = randomUUID(); // Mismatch
    await expect(validateCandidateCitation('test-uid', { matterId, candidateId }))
      .rejects.toThrow('Version does not belong to the specified legal source');
  });
});
