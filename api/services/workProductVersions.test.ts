import { describe, it, expect, vi, beforeEach } from 'vitest';
import { finalizeCaseBrief, getWorkProductVersions, getWorkProductVersion } from './litigationWorkProduct';
import * as accounts from './accounts';
import * as access from './access';
import * as professionalWorkspace from './professionalWorkspace';

const mockTables: Record<string, any[]> = {
  navigator_matters: [],
  professional_work_product_versions: []
};

vi.mock('./accounts');
vi.mock('./access');
vi.mock('./professionalWorkspace');

describe('Stage 8C: Professional Work Product Finalization', () => {
  const matter1 = '11111111-1111-1111-1111-111111111111';
  const matter2 = '22222222-2222-2222-2222-222222222222';
  const versionId2 = '33333333-3333-3333-3333-333333333333';

  beforeEach(() => {
    mockTables.navigator_matters = [{ id: matter1 }, { id: matter2 }];
    mockTables.professional_work_product_versions = [];

    vi.spyOn(accounts, 'findAccount').mockImplementation(async (uid) => {
      if (uid === 'reviewer-a') return { id: 'acc-a' } as any;
      if (uid === 'reviewer-b') return { id: 'acc-b' } as any;
      if (uid === 'revoked-reviewer') return { id: 'acc-revoked' } as any;
      return null;
    });

    vi.spyOn(professionalWorkspace, 'requireProfessionalAccess').mockImplementation(async (db, accountId, matterId) => {
      if (accountId === 'acc-revoked') throw new Error('Professional access revoked');
      if (accountId === 'acc-a' && matterId !== matter1) throw new Error('Not authorized for matter');
      return true as any;
    });

    vi.spyOn(access, 'getSupabase').mockImplementation(() => {
      return {
        from: (table: string) => {
          let query: any = {
            select: () => query,
            eq: (col: string, val: any) => {
              query._filters = query._filters || [];
              query._filters.push((r: any) => r[col] === val);
              return query;
            },
            order: () => query,
            limit: () => query,
            maybeSingle: async () => {
              let rows = mockTables[table] || [];
              if (query._filters) rows = rows.filter(r => query._filters.every((f: any) => f(r)));
              return { data: rows.length > 0 ? rows[0] : null };
            },
            single: async () => {
              let rows = mockTables[table] || [];
              if (query._filters) rows = rows.filter(r => query._filters.every((f: any) => f(r)));
              if (rows.length === 0) return { error: { message: 'Not found' } };
              return { data: rows[0] };
            },
            then: (resolve: any) => {
              let rows = mockTables[table] || [];
              if (query._filters) rows = rows.filter(r => query._filters.every((f: any) => f(r)));
              return resolve({ data: rows });
            },
            insert: (obj: any) => {
              mockTables[table].unshift(obj); // prepend to simulate order desc
              return { select: () => ({ single: async () => ({ data: obj, error: null }) }) };
            }
          };
          return query;
        }
      } as any;
    });
  });

  it('1. authorized reviewer can finalize current CASE_BRIEF', async () => {
    const version = await finalizeCaseBrief('reviewer-a', matter1);
    expect(version.version_number).toBe(1);
    expect(version.status).toBe('FINALIZED');
    expect(version.snapshot).toBeDefined();
    expect(mockTables.professional_work_product_versions.length).toBe(1);
  });

  it('2. finalization creates Version 1', async () => {
    const version = await finalizeCaseBrief('reviewer-a', matter1);
    expect(version.version_number).toBe(1);
  });

  it('3. subsequent finalization creates Version 2', async () => {
    await finalizeCaseBrief('reviewer-a', matter1);
    const version2 = await finalizeCaseBrief('reviewer-a', matter1);
    expect(version2.version_number).toBe(2);
    expect(mockTables.professional_work_product_versions.length).toBe(2);
  });

  it('4. Version 1 remains unchanged after Version 2', async () => {
    await finalizeCaseBrief('reviewer-a', matter1);
    const v1 = mockTables.professional_work_product_versions.find(v => v.version_number === 1);
    const snap1 = JSON.stringify(v1.snapshot);
    
    await finalizeCaseBrief('reviewer-a', matter1);
    const v1After = mockTables.professional_work_product_versions.find(v => v.version_number === 1);
    expect(JSON.stringify(v1After.snapshot)).toBe(snap1);
  });

  it('8. Reviewer A cannot list Reviewer B versions', async () => {
    mockTables.professional_work_product_versions.push(
      { id: 'v1', matter_id: matter1, reviewer_account_id: 'acc-a', work_product_type: 'CASE_BRIEF', version_number: 1 },
      { id: 'v2', matter_id: matter1, reviewer_account_id: 'acc-b', work_product_type: 'CASE_BRIEF', version_number: 1 }
    );
    const versions = await getWorkProductVersions('reviewer-a', matter1);
    expect(versions.length).toBe(1);
    expect(versions[0].reviewer_account_id).toBe('acc-a');
  });

  it('9. Reviewer A cannot view Reviewer B version by guessed ID', async () => {
    mockTables.professional_work_product_versions.push(
      { id: versionId2, matter_id: matter1, reviewer_account_id: 'acc-b', work_product_type: 'CASE_BRIEF', version_number: 1 }
    );
    await expect(getWorkProductVersion('reviewer-a', matter1, versionId2))
      .rejects.toThrow(/Not found|Work product version not found/);
  });

  it('12. cross-matter list isolation', async () => {
    await expect(getWorkProductVersions('reviewer-a', matter2))
      .rejects.toThrow(/Not authorized for matter/);
  });

  it('14. unauthenticated finalization denied', async () => {
    await expect(finalizeCaseBrief('unknown-uid', matter1))
      .rejects.toThrow(/Account not found/);
  });

  it('16. revoked professional cannot finalize', async () => {
    await expect(finalizeCaseBrief('revoked-reviewer', matter1))
      .rejects.toThrow(/Professional access revoked/);
  });
});
