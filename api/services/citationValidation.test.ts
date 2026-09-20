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
    const { computeLegalContentHash } = await import('./legalSources.js');
    const validHash = computeLegalContentHash('This is the authoritative law text.');
    const res = await validateCandidateCitation('test-uid', { matterId, candidateId, callerExpectedHash: validHash });
    expect(res.authorityValidationStatus).toBe('VALIDATED');
    expect(res.exactQuoteStatus).toBe('NOT_CHECKED');
    expect(res.pinpointStatus).toBe('NOT_APPLICABLE');
  });

  it('validates exact quote correctly', async () => {
    const { computeLegalContentHash } = await import('./legalSources.js');
    const validHash = computeLegalContentHash('This is the authoritative law text.');
    const res = await validateCandidateCitation('test-uid', { 
      matterId, candidateId, exactQuoteToVerify: 'authoritative law text', callerExpectedHash: validHash 
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

  it('verifies stored text against its hash without relying on a caller hash', async () => {
    const res = await validateCandidateCitation('test-uid', { matterId, candidateId });
    expect(res.authorityValidationStatus).toBe('VALIDATED');
    expect(res.contentIntegrityStatus).toBe('VERIFIED');
  });

  it('rejects tampered or stale candidate (hash mismatch)', async () => {
    const res = await validateCandidateCitation('test-uid', { matterId, candidateId, callerExpectedHash: 'badhash' });
    expect(res.authorityValidationStatus).toBe('INVALID');
    expect(res.contentIntegrityStatus).toBe('VERIFIED');
    expect(res.validationFindings).toContain('Caller expected hash does not match the authoritative stored hash.');
  });

  it('rejects changed authoritative text even when the caller repeats the stored hash', async () => {
    const storedHash = mockTables.navigator_legal_provision_versions[0].text_sha256;
    mockTables.navigator_legal_provision_versions[0].exact_text = 'Tampered authoritative text.';
    const res = await validateCandidateCitation('test-uid', { matterId, candidateId, callerExpectedHash: storedHash });
    expect(res.contentIntegrityStatus).toBe('FAILED');
    expect(res.authorityValidationStatus).toBe('INVALID');
  });

  it('supports historical versions properly if valid', async () => {
    // Setup historical version
    const histVersionId = randomUUID();
    mockTables.navigator_legal_source_versions.push({
      id: histVersionId,
      legal_source_id: sourceId,
      version_label: '2020-01-01 to 2023-12-31',
      effective_from: '2020-01-01',
      effective_to: '2023-12-31',
      status: 'SUPERSEDED'
    });
    const histCandId = randomUUID();
    mockTables.navigator_matter_legal_research_candidates.push({
      id: histCandId, matter_id: matterId, legal_source_id: sourceId,
      legal_source_version_id: histVersionId, provision_id: provisionId, content_integrity_status: 'VERIFIED'
    });
    const { computeLegalContentHash } = await import('./legalSources.js');
    const oldHash = computeLegalContentHash('Old historical text');
    mockTables.navigator_legal_provision_versions.push({
      id: randomUUID(), provision_id: provisionId, legal_source_version_id: histVersionId, text_sha256: oldHash, exact_text: 'Old historical text'
    });

    const res = await validateCandidateCitation('test-uid', { matterId, candidateId: histCandId, callerExpectedHash: oldHash });
    expect(res.authorityValidationStatus).toBe('VALIDATED');
    expect(res.effectiveDateContext).toBe('Effective: 2020-01-01 to 2023-12-31');
  });

  it('fails if caller provides wrong-version hash or quote', async () => {
    const { computeLegalContentHash } = await import('./legalSources.js');
    const wrongHash = computeLegalContentHash('Wrong version text');
    const res = await validateCandidateCitation('test-uid', { matterId, candidateId, callerExpectedHash: wrongHash, exactQuoteToVerify: 'Wrong version text' });
    expect(res.authorityValidationStatus).toBe('INVALID');
    expect(res.contentIntegrityStatus).toBe('VERIFIED');
    expect(res.exactQuoteStatus).toBe('ALTERED');
  });

  it('preserves provenance (sourceUrl)', async () => {
    const res = await validateCandidateCitation('test-uid', { matterId, candidateId });
    expect(res.sourceProvenance).toBe('https://example.com/cyfsa');
  });

  it.each(['source', 'version', 'provision'])('audit: unverified %s cannot validate authority', async (kind) => {
    const table = kind === 'source' ? 'navigator_legal_sources' : kind === 'version' ? 'navigator_legal_source_versions' : 'navigator_legal_provisions';
    mockTables[table][0].verification_state = 'UNVERIFIED';
    const res = await validateCandidateCitation('test-uid', { matterId, candidateId });
    expect(res.authorityValidationStatus).not.toBe('VALIDATED');
  });

  it.each(['exact_text', 'text_sha256'])('audit: missing %s cannot validate authority', async (field) => {
    mockTables.navigator_legal_provision_versions[0][field] = null;
    const res = await validateCandidateCitation('test-uid', { matterId, candidateId });
    expect(res.authorityValidationStatus).not.toBe('VALIDATED');
  });

  it('audit: malformed input is rejected', async () => {
    await expect(validateCandidateCitation('test-uid', null as any)).rejects.toThrow('Input must be an object');
  });

  it('audit: repeat verification has the same substantive result', async () => {
    const a = await validateCandidateCitation('test-uid', { matterId, candidateId });
    const b = await validateCandidateCitation('test-uid', { matterId, candidateId });
    expect({ ...a, validatedAt: null }).toEqual({ ...b, validatedAt: null });
  });
});
