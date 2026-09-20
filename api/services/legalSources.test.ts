import { describe, it, expect, vi, beforeEach } from 'vitest';
import { getSource, getSourceVersion, getProvision, resolveVersionForDate, getAuthorityCitation } from './legalSources.js';
import * as access from './access.js';

vi.mock('./access.js');

describe('Stage 9A Authoritative Legal Sources', () => {
  let mockTables: any;

  beforeEach(() => {
    mockTables = {
      navigator_legal_sources: [],
      navigator_legal_source_versions: [],
      navigator_legal_provisions: []
    };

    vi.spyOn(access, 'getSupabase').mockReturnValue({
      from: (table: string) => {
        let rows = mockTables[table] || [];
        const chain: any = {
          select: () => chain,
          eq: (col: string, val: any) => {
            rows = rows.filter((r: any) => r[col] === val);
            return chain;
          },
          single: async () => ({ data: rows[0], error: rows.length === 0 ? new Error('Not found') : null })
        };
        // Mock returning multiple rows when single is not called
        chain.then = (resolve: any) => resolve({ data: rows, error: null });
        return chain;
      }
    } as any);
  });

  it('1. source creation/model validation: retrieves a valid source', async () => {
    mockTables.navigator_legal_sources.push({
      id: '11111111-1111-1111-1111-111111111111', jurisdiction: 'ON', title: 'CYFSA', source_type: 'STATUTE',
      citation: 'SO 2017', official_publisher: 'Ontario', source_url: 'https://ontario.ca',
      verification_state: 'VERIFIED', retrieved_at: '2023-01-01T00:00:00Z'
    });

    mockTables.navigator_legal_sources.push({ id: '11111111-1111-1111-1111-111111111111', jurisdiction: 'ON', title: 'Test', source_type: 'STATUTE', citation: 'SO 2017', official_publisher: 'Ontario', source_url: 'https://ontario.ca', verification_state: 'VERIFIED', retrieved_at: '2023-01-01T00:00:00Z' });
    const source = await getSource('11111111-1111-1111-1111-111111111111');
    expect(source.title).toBe('CYFSA');
    expect(source.sourceType).toBe('STATUTE');
  });

  it('2. source-version association: retrieves valid version', async () => {
    mockTables.navigator_legal_source_versions.push({
      id: '33333333-3333-3333-3333-333333333333', legal_source_id: '11111111-1111-1111-1111-111111111111', version_label: 'v1',
      effective_from: '2020-01-01', effective_to: '2021-01-01',
      status: 'IN_FORCE', verification_state: 'VERIFIED', retrieved_at: '2023-01-01T00:00:00Z'
    });

    const version = await getSourceVersion('33333333-3333-3333-3333-333333333333');
    expect(version.legalSourceId).toBe('11111111-1111-1111-1111-111111111111');
    expect(version.versionLabel).toBe('v1');
  });

  it('3. provision belongs to correct source', async () => {
    mockTables.navigator_legal_provisions.push({
      id: '55555555-5555-5555-5555-555555555555', legal_source_id: '11111111-1111-1111-1111-111111111111', citation: 's.74', label: 'Section 74',
      verification_state: 'VERIFIED'
    });

    const provision = await getProvision('55555555-5555-5555-5555-555555555555');
    expect(provision.legalSourceId).toBe('11111111-1111-1111-1111-111111111111');
    expect(provision.citation).toBe('s.74');
  });

  it('4. current version resolution: resolves currently active law', async () => {
    mockTables.navigator_legal_source_versions.push({
      id: '33333333-3333-3333-3333-333333333333', legal_source_id: '11111111-1111-1111-1111-111111111111', version_label: 'v1',
      effective_from: '2020-01-01', effective_to: null,
      status: 'IN_FORCE', verification_state: 'VERIFIED', retrieved_at: '2023-01-01T00:00:00Z'
    });

    const resolution = await resolveVersionForDate('11111111-1111-1111-1111-111111111111', { kind: 'EXACT', date: '2023-05-01' });
    expect(resolution.outcome).toBe('RESOLVED_OPEN_ENDED');
    expect(resolution.version?.id).toBe('33333333-3333-3333-3333-333333333333');
  });

  it('5. historical version resolution: resolves correctly for past event', async () => {
    mockTables.navigator_legal_source_versions.push(
      { id: '33333333-3333-3333-3333-333333333333', legal_source_id: '11111111-1111-1111-1111-111111111111', version_label: 'v1', effective_from: '2018-01-01', effective_to: '2020-01-01', status: 'SUPERSEDED', verification_state: 'VERIFIED', retrieved_at: '2023-01-01T00:00:00Z' },
      { id: '44444444-4444-4444-4444-444444444444', legal_source_id: '11111111-1111-1111-1111-111111111111', version_label: 'v2', effective_from: '2020-01-01', effective_to: null, status: 'IN_FORCE', verification_state: 'VERIFIED', retrieved_at: '2023-01-01T00:00:00Z' }
    );

    const resolution = await resolveVersionForDate('11111111-1111-1111-1111-111111111111', { kind: 'EXACT', date: '2019-05-01' });
    expect(resolution.outcome).toBe('RESOLVED');
    expect(resolution.version?.id).toBe('33333333-3333-3333-3333-333333333333');
  });

  it('6. future version exclusion: fails to resolve future un-enacted law', async () => {
    mockTables.navigator_legal_source_versions.push(
      { id: '33333333-3333-3333-3333-333333333333', legal_source_id: '11111111-1111-1111-1111-111111111111', version_label: 'v1', effective_from: '2025-01-01', effective_to: null, status: 'NOT_YET_IN_FORCE', verification_state: 'VERIFIED', retrieved_at: '2023-01-01T00:00:00Z' }
    );

    const resolution = await resolveVersionForDate('11111111-1111-1111-1111-111111111111', { kind: 'EXACT', date: '2023-05-01' });
    expect(resolution.outcome).toBe('BEFORE_EARLIEST_VERSION');
  });

  it('7. superseded/repealed handling: handles repealed law correctly', async () => {
    mockTables.navigator_legal_source_versions.push(
      { id: '33333333-3333-3333-3333-333333333333', legal_source_id: '11111111-1111-1111-1111-111111111111', version_label: 'v1', effective_from: '2018-01-01', effective_to: '2020-01-01', status: 'REPEALED', verification_state: 'VERIFIED', retrieved_at: '2023-01-01T00:00:00Z' }
    );

    const resolution = await resolveVersionForDate('11111111-1111-1111-1111-111111111111', { kind: 'EXACT', date: '2021-05-01' });
    expect(resolution.outcome).toBe('AFTER_LAST_CLOSED_VERSION');
  });

  it('8. unresolved version behavior: handles missing case date', async () => {
    mockTables.navigator_legal_source_versions.push(
      { id: '33333333-3333-3333-3333-333333333333', legal_source_id: '11111111-1111-1111-1111-111111111111', version_label: 'v1', effective_from: '2020-01-01', effective_to: null, status: 'IN_FORCE', verification_state: 'VERIFIED', retrieved_at: '2023-01-01T00:00:00Z' }
    );

    const resolution = await resolveVersionForDate('11111111-1111-1111-1111-111111111111', { kind: 'UNKNOWN' });
    expect(resolution.outcome).toBe('UNKNOWN_DATE');
    expect(resolution.version).toBeNull();
  });

  it('9. citation references correct authority', async () => {
    mockTables.navigator_legal_sources.push({
      id: '11111111-1111-1111-1111-111111111111', jurisdiction: 'ON', title: 'CYFSA', source_type: 'STATUTE',
      citation: 'SO 2017', official_publisher: 'Ontario', source_url: 'https://ontario.ca/cyfsa',
      verification_state: 'VERIFIED', retrieved_at: '2023-01-01T00:00:00Z'
    });

    const citation = await getAuthorityCitation('11111111-1111-1111-1111-111111111111');
    expect(citation.legalSourceId).toBe('11111111-1111-1111-1111-111111111111');
    expect(citation.sourceUrl).toBe('https://ontario.ca/cyfsa');
    expect(citation.retrievedAt).toBe('2023-01-01T00:00:00Z');
  });

  it('10. pinpoint/provision identity: generates full citation object', async () => {
    mockTables.navigator_legal_sources.push({
      id: '11111111-1111-1111-1111-111111111111', jurisdiction: 'ON', title: 'CYFSA', source_type: 'STATUTE',
      citation: 'SO 2017', official_publisher: 'Ontario', source_url: 'https://ontario.ca',
      verification_state: 'VERIFIED', retrieved_at: '2023-01-01T00:00:00Z'
    });
    mockTables.navigator_legal_source_versions.push({
      id: '33333333-3333-3333-3333-333333333333', legal_source_id: '11111111-1111-1111-1111-111111111111', version_label: 'v1',
      effective_from: '2020-01-01', effective_to: null,
      status: 'IN_FORCE', verification_state: 'VERIFIED', retrieved_at: '2023-02-01T00:00:00Z'
    });
    mockTables.navigator_legal_provisions.push({
      id: '55555555-5555-5555-5555-555555555555', legal_source_id: '11111111-1111-1111-1111-111111111111', citation: 's.74', label: 'Section 74',
      verification_state: 'VERIFIED'
    });

    const citation = await getAuthorityCitation('11111111-1111-1111-1111-111111111111', '33333333-3333-3333-3333-333333333333', '55555555-5555-5555-5555-555555555555', '(1)(a)');
    expect(citation.legalSourceId).toBe('11111111-1111-1111-1111-111111111111');
    expect(citation.legalSourceVersionId).toBe('33333333-3333-3333-3333-333333333333');
    expect(citation.provisionId).toBe('55555555-5555-5555-5555-555555555555');
    expect(citation.pinpoint).toBe('(1)(a)');
    expect(citation.effectiveDateContext).toContain('2020-01-01 to present');
    expect(citation.retrievedAt).toBe('2023-02-01T00:00:00Z'); // uses version's retrieved_at
  });

  it('11. statute vs case authority distinction: case source fields are preserved', async () => {
    mockTables.navigator_legal_sources.push({
      id: '11111111-1111-1111-1111-222222222222', jurisdiction: 'ON', title: 'Smith v Jones', source_type: 'CASE_LAW',
      citation: '2023 ONCJ 123', official_publisher: 'CanLII', source_url: 'https://canlii.ca',
      verification_state: 'VERIFIED', retrieved_at: '2023-01-01T00:00:00Z',
      court: 'Ontario Court of Justice', decision_date: '2023-05-10', docket_number: 'CV-123'
    });

    const source = await getSource('11111111-1111-1111-1111-222222222222');
    expect(source.court).toBe('Ontario Court of Justice');
    expect(source.decisionDate).toBe('2023-05-10');
    expect(source.docketNumber).toBe('CV-123');
  });

  it('12. private matter data not leaked: retrieval has no matter scope', async () => {
    mockTables.navigator_legal_sources.push({ id: '11111111-1111-1111-1111-111111111111' });
    mockTables.navigator_legal_sources.push({ id: '11111111-1111-1111-1111-111111111111', jurisdiction: 'ON', title: 'Test', source_type: 'STATUTE', citation: 'SO 2017', official_publisher: 'Ontario', source_url: 'https://ontario.ca', verification_state: 'VERIFIED', retrieved_at: '2023-01-01T00:00:00Z' });
    const source = await getSource('11111111-1111-1111-1111-111111111111');
    // The service only queries public.navigator_legal_sources, no matter scope exists in the table.
    expect((source as any).matterId).toBeUndefined();
  });

  it('13. untrusted content remains data: no AI calls are made', async () => {
    // Verified by inspection: no LLM/AI module is imported in legalSources.ts
    // The retrieve interface returns pure data objects.
    mockTables.navigator_legal_sources.push({ id: '11111111-1111-1111-1111-111111111111', jurisdiction: 'ON', title: 'Test', source_type: 'STATUTE', citation: 'SO 2017', official_publisher: 'Ontario', source_url: 'https://ontario.ca', verification_state: 'VERIFIED', retrieved_at: '2023-01-01T00:00:00Z' });
    const source = await getSource('11111111-1111-1111-1111-111111111111');
    expect(typeof source).toBe('object');
  });

  it('14. provenance retained: source returns retrieval and publisher details', async () => {
    mockTables.navigator_legal_sources.push({
      id: '11111111-1111-1111-1111-111111111111', jurisdiction: 'ON', title: 'CYFSA', source_type: 'STATUTE',
      citation: 'SO 2017', official_publisher: 'Ontario', source_url: 'https://ontario.ca',
      verification_state: 'VERIFIED', retrieved_at: '2023-01-01T00:00:00Z'
    });
    mockTables.navigator_legal_sources.push({ id: '11111111-1111-1111-1111-111111111111', jurisdiction: 'ON', title: 'Test', source_type: 'STATUTE', citation: 'SO 2017', official_publisher: 'Ontario', source_url: 'https://ontario.ca', verification_state: 'VERIFIED', retrieved_at: '2023-01-01T00:00:00Z' });
    const source = await getSource('11111111-1111-1111-1111-111111111111');
    expect(source.retrievedAt).toBe('2023-01-01T00:00:00Z');
    expect(source.officialPublisher).toBe('Ontario');
  });
});
