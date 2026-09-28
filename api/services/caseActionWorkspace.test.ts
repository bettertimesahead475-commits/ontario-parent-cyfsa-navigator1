/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Test Suite for Post-Launch Case-Action Workspace (Batch 1)
 * Covers requirements, actions, evidence links, state transitions, authorization, matter isolation, and audit events.
 */

import { describe, expect, it, beforeEach, vi } from 'vitest';
import {
  createRequirement,
  getRequirement,
  listRequirements,
  updateRequirement,
  confirmRequirement,
  rejectRequirement,
  archiveRequirement,
  setRequirementDispute,
  resolveRequirementDispute,
  createAction,
  listActions,
  completeAction,
  reopenAction,
  attachEvidenceLink,
  unlinkEvidenceLink,
  calculateIsOverdue,
} from './caseActionWorkspace.js';

// Valid UUID constants for test fixtures
const MATTER_A_ID = '11111111-1111-4111-a111-111111111111';
const MATTER_B_ID = '22222222-2222-4222-a222-222222222222';

const DOC_A1_ID = '33333333-3333-4333-a333-333333333333';
const DOC_B1_ID = '44444444-4444-4444-a444-444444444444';

const EV_A1_ID = '55555555-5555-4555-a555-555555555555';
const EV_B1_ID = '66666666-6666-4666-a666-666666666666';

// In-memory mock database store for isolated unit/integration tests
let mockDb: any;
let mockAccounts: Record<string, any>;
let mockMatterMembers: any[];
let mockRequirements: any[];
let mockActions: any[];
let mockEvidenceLinks: any[];
let mockDocuments: any[];
let mockEvidenceItems: any[];
let mockEvents: any[];

function resetMockStore() {
  mockAccounts = {
    'uid-owner-a': { id: 'acc-owner-a', firebase_uid: 'uid-owner-a', status: 'active' },
    'uid-owner-b': { id: 'acc-owner-b', firebase_uid: 'uid-owner-b', status: 'active' },
    'uid-reviewer-a': { id: 'acc-reviewer-a', firebase_uid: 'uid-reviewer-a', status: 'active' },
    'uid-unrelated': { id: 'acc-unrelated', firebase_uid: 'uid-unrelated', status: 'active' },
  };

  mockMatterMembers = [
    { matter_id: MATTER_A_ID, account_id: 'acc-owner-a', role: 'OWNER' },
    { matter_id: MATTER_A_ID, account_id: 'acc-reviewer-a', role: 'REVIEWER' },
    { matter_id: MATTER_B_ID, account_id: 'acc-owner-b', role: 'OWNER' },
  ];

  mockRequirements = [];
  mockActions = [];
  mockEvidenceLinks = [];
  mockEvents = [];

  mockDocuments = [
    { id: DOC_A1_ID, matter_id: MATTER_A_ID, title: 'CAS Report Matter A' },
    { id: DOC_B1_ID, matter_id: MATTER_B_ID, title: 'Court Order Matter B' },
  ];

  mockEvidenceItems = [
    { id: EV_A1_ID, matter_id: MATTER_A_ID, title: 'Parenting Certificate Matter A' },
    { id: EV_B1_ID, matter_id: MATTER_B_ID, title: 'Drug Screen Matter B' },
  ];

  function getStore(table: string) {
    if (table === 'navigator_matter_members') return mockMatterMembers;
    if (table === 'navigator_case_requirements') return mockRequirements;
    if (table === 'navigator_case_actions') return mockActions;
    if (table === 'navigator_action_evidence_links') return mockEvidenceLinks;
    if (table === 'navigator_documents') return mockDocuments;
    if (table === 'navigator_evidence_items') return mockEvidenceItems;
    if (table === 'navigator_events') return mockEvents;
    return [];
  }

  mockDb = {
    from: (table: string) => {
      const filters: { col: string; val: any }[] = [];
      let sortCol: string | null = null;
      let sortAsc = true;

      const queryBuilder: any = {
        select: () => queryBuilder,
        eq: (col: string, val: any) => {
          filters.push({ col, val });
          return queryBuilder;
        },
        order: (col: string, opts: any = {}) => {
          sortCol = col;
          sortAsc = opts.ascending !== false;
          return queryBuilder;
        },
        single: async () => {
          let store: any[] = [];
          if (table === 'navigator_matter_members') store = mockMatterMembers;
          if (table === 'navigator_case_requirements') store = mockRequirements;
          if (table === 'navigator_case_actions') store = mockActions;
          if (table === 'navigator_action_evidence_links') store = mockEvidenceLinks;
          if (table === 'navigator_documents') store = mockDocuments;
          if (table === 'navigator_evidence_items') store = mockEvidenceItems;

          const match = store.find((r) => filters.every((f) => r[f.col] === f.val));
          if (!match) return { data: null, error: { message: 'Row not found' } };
          return { data: { ...match }, error: null };
        },
        insert: (rowOrRows: any) => {
          const rows = Array.isArray(rowOrRows) ? rowOrRows : [rowOrRows];
          const inserted: any[] = [];
          for (const r of rows) {
            const randomUuid = `${Math.floor(Math.random()*89999999+10000000)}-0000-4000-a000-${Math.floor(Math.random()*899999999999+100000000000)}`;
            const newRow = { id: r.id || randomUuid, created_at: new Date().toISOString(), ...r };
            if (table === 'navigator_case_requirements') mockRequirements.push(newRow);
            if (table === 'navigator_case_actions') mockActions.push(newRow);
            if (table === 'navigator_action_evidence_links') mockEvidenceLinks.push(newRow);
            if (table === 'navigator_events') mockEvents.push(newRow);
            inserted.push(newRow);
          }
          const resultData = Array.isArray(rowOrRows) ? inserted : inserted[0];
          return {
            data: resultData,
            error: null,
            select: () => ({
              single: async () => ({ data: resultData, error: null }),
            }),
            then: (resolve: any) => resolve({ data: resultData, error: null }),
          };
        },
        update: (patch: any) => {
          const updateFilters = [...filters];
          const uBuilder: any = {
            eq: (col: string, val: any) => {
              updateFilters.push({ col, val });
              return uBuilder;
            },
            select: () => uBuilder,
            single: async () => {
              let store: any[] = [];
              if (table === 'navigator_case_requirements') store = mockRequirements;
              if (table === 'navigator_case_actions') store = mockActions;

              const target = store.find((r) => updateFilters.every((f) => r[f.col] === f.val));
              if (!target) return { data: null, error: { message: 'Row not found for update' } };

              Object.assign(target, patch);
              return { data: { ...target }, error: null };
            },
            then: (resolve: any) => uBuilder.single().then((res: any) => resolve(res)),
          };
          return uBuilder;
        },
        delete: () => {
          const delFilters = [...filters];
          const dBuilder: any = {
            eq: (col: string, val: any) => {
              delFilters.push({ col, val });
              return dBuilder;
            },
            then: (resolve: any) => {
              let store: any[] = [];
              if (table === 'navigator_action_evidence_links') store = mockEvidenceLinks;
              const idx = store.findIndex((r) => delFilters.every((f) => r[f.col] === f.val));
              if (idx >= 0) store.splice(idx, 1);
              resolve({ data: null, error: null });
            },
          };
          return dBuilder;
        },
        then: (resolve: any) => {
          let store: any[] = [];
          if (table === 'navigator_matter_members') store = mockMatterMembers;
          if (table === 'navigator_case_requirements') store = mockRequirements;
          if (table === 'navigator_case_actions') store = mockActions;
          if (table === 'navigator_action_evidence_links') store = mockEvidenceLinks;
          if (table === 'navigator_documents') store = mockDocuments;
          if (table === 'navigator_evidence_items') store = mockEvidenceItems;
          if (table === 'navigator_events') store = mockEvents;

          let res = store.filter((r) => filters.every((f) => r[f.col] === f.val));
          if (sortCol) {
            res.sort((a, b) => (sortAsc ? (a[sortCol!] > b[sortCol!] ? 1 : -1) : (a[sortCol!] < b[sortCol!] ? 1 : -1)));
          }
          resolve({ data: res.map((x) => ({ ...x })), error: null });
        },
      };
      return queryBuilder;
    },
  };
}

vi.mock('./access.js', () => ({
  getSupabase: () => mockDb,
}));

vi.mock('./accounts.js', () => ({
  findAccount: async (uid: string) => mockAccounts[uid] || null,
}));

describe('Post-Launch Case-Action Workspace Services (Batch 1)', () => {
  beforeEach(() => {
    resetMockStore();
  });

  describe('Overdue Calculation Helper', () => {
    it('correctly identifies overdue dates for active items', () => {
      const past = new Date(Date.now() - 86400000).toISOString();
      const future = new Date(Date.now() + 86400000).toISOString();

      expect(calculateIsOverdue(past, 'NOT_STARTED')).toBe(true);
      expect(calculateIsOverdue(past, 'IN_PROGRESS')).toBe(true);
      expect(calculateIsOverdue(future, 'NOT_STARTED')).toBe(false);
      expect(calculateIsOverdue(past, 'COMPLETED')).toBe(false);
      expect(calculateIsOverdue(past, 'SUPERSEDED')).toBe(false);
      expect(calculateIsOverdue(past, 'NOT_APPLICABLE')).toBe(false);
      expect(calculateIsOverdue(null, 'NOT_STARTED')).toBe(false);
    });
  });

  describe('Requirement Lifecycle', () => {
    it('allows a matter owner to create a requirement with explicit authority and provenance', async () => {
      const req = await createRequirement('uid-owner-a', MATTER_A_ID, {
        title: 'Complete Triple P Parenting Course',
        description: 'CAS requested 8-week parenting program',
        authorityType: 'CAS_REQUESTED',
        dueAt: new Date(Date.now() + 7 * 86400000).toISOString(),
        provenanceType: 'CAS_CORRESPONDENCE',
        sourceAuthorOrSpeaker: 'Caseworker Smith',
      });

      expect(req.id).toBeDefined();
      expect(req.title).toBe('Complete Triple P Parenting Course');
      expect(req.authority_type).toBe('CAS_REQUESTED');
      expect(req.review_state).toBe('CONFIRMED');
      expect(req.completion_state).toBe('NOT_STARTED');
      expect(req.dispute_state).toBe('NOT_DISPUTED');

      // Audit event verified
      expect(mockEvents.some((e) => e.event_type === 'CASE_REQUIREMENT_CREATED')).toBe(true);
    });

    it('denies requirement creation for an unrelated user', async () => {
      await expect(
        createRequirement('uid-unrelated', MATTER_A_ID, {
          title: 'Unauthorized Requirement',
          authorityType: 'CAS_REQUESTED',
        })
      ).rejects.toThrow('You do not have access to this matter.');
    });

    it('allows authority reclassification and logs prior and new authority', async () => {
      const req = await createRequirement('uid-owner-a', MATTER_A_ID, {
        title: 'Attend Counselling',
        authorityType: 'CAS_REQUESTED',
      });

      const updated = await updateRequirement('uid-owner-a', MATTER_A_ID, req.id, {
        authorityType: 'COURT_ORDERED',
      });

      expect(updated.authority_type).toBe('COURT_ORDERED');
      const changeEvent = mockEvents.find((e) => e.event_type === 'CASE_REQUIREMENT_AUTHORITY_CHANGED');
      expect(changeEvent).toBeDefined();
      expect(changeEvent.payload.priorAuthorityType).toBe('CAS_REQUESTED');
      expect(changeEvent.payload.newAuthorityType).toBe('COURT_ORDERED');
    });

    it('handles review state transitions (confirm, reject, archive)', async () => {
      const req = await createRequirement('uid-owner-a', MATTER_A_ID, {
        title: 'Drug Test Proposal',
        authorityType: 'CAS_REQUESTED',
        reviewState: 'PROPOSED',
      });

      const confirmed = await confirmRequirement('uid-owner-a', MATTER_A_ID, req.id);
      expect(confirmed.review_state).toBe('CONFIRMED');

      const rejected = await rejectRequirement('uid-owner-a', MATTER_A_ID, req.id);
      expect(rejected.review_state).toBe('REJECTED');

      const archived = await archiveRequirement('uid-owner-a', MATTER_A_ID, req.id);
      expect(archived.review_state).toBe('ARCHIVED');
    });

    it('handles dispute workflow (set dispute, resolve dispute)', async () => {
      const req = await createRequirement('uid-owner-a', MATTER_A_ID, {
        title: 'Unreasonable Daily Screening Requirement',
        authorityType: 'CAS_REQUESTED',
      });

      const disputed = await setRequirementDispute('uid-owner-a', MATTER_A_ID, req.id, 'UNREASONABLE_CONDITION', 'Daily testing is geographically impossible');
      expect(disputed.dispute_state).toBe('DISPUTED');
      expect(disputed.dispute_type).toBe('UNREASONABLE_CONDITION');
      expect(disputed.dispute_note).toBe('Daily testing is geographically impossible');

      const resolved = await resolveRequirementDispute('uid-owner-a', MATTER_A_ID, req.id, 'Agreed to weekly testing instead');
      expect(resolved.dispute_state).toBe('RESOLVED');
      expect(resolved.dispute_note).toBe('Agreed to weekly testing instead');
    });
  });

  describe('Action / Task Lifecycle', () => {
    it('creates, lists, completes, and reopens actions linked to a requirement', async () => {
      const req = await createRequirement('uid-owner-a', MATTER_A_ID, {
        title: 'Obtain Housing Verification Letter',
        authorityType: 'CAS_REQUESTED',
      });

      const act1 = await createAction('uid-owner-a', MATTER_A_ID, req.id, {
        title: 'Call landlord for letter',
      });

      expect(act1.id).toBeDefined();
      expect(act1.status).toBe('PENDING');

      const actions = await listActions('uid-owner-a', MATTER_A_ID, req.id);
      expect(actions.length).toBe(1);

      const completed = await completeAction('uid-owner-a', MATTER_A_ID, act1.id);
      expect(completed.status).toBe('COMPLETED');
      expect(completed.completed_at).toBeDefined();

      const reopened = await reopenAction('uid-owner-a', MATTER_A_ID, act1.id);
      expect(reopened.status).toBe('IN_PROGRESS');
      expect(reopened.completed_at).toBeNull();
    });

    it('rejects action creation if requirement belongs to another matter (cross-matter integrity)', async () => {
      const reqB = await createRequirement('uid-owner-b', MATTER_B_ID, {
        title: 'Matter B Requirement',
        authorityType: 'COURT_ORDERED',
      });

      await expect(
        createAction('uid-owner-a', MATTER_A_ID, reqB.id, {
          title: 'Cross-matter action attempt',
        })
      ).rejects.toThrow('Requirement does not belong to this matter');
    });
  });

  describe('Evidence Link Management & Cross-Matter Security', () => {
    it('attaches evidence link to a requirement and promotes completion_state to IN_PROGRESS', async () => {
      const req = await createRequirement('uid-owner-a', MATTER_A_ID, {
        title: 'Parenting Class Certificate',
        authorityType: 'CAS_REQUESTED',
        completionState: 'NOT_STARTED',
      });

      const link = await attachEvidenceLink('uid-owner-a', MATTER_A_ID, req.id, {
        evidenceItemId: EV_A1_ID,
        documentId: DOC_A1_ID,
        evidenceType: 'COMPLETION_CERTIFICATE',
        title: 'Official Diploma Copy',
      });

      expect(link.id).toBeDefined();
      expect(link.evidence_type).toBe('COMPLETION_CERTIFICATE');

      // Verify requirement completion state promoted
      const updatedReq = await getRequirement('uid-owner-a', MATTER_A_ID, req.id);
      expect(updatedReq.completion_state).toBe('IN_PROGRESS');
      expect(updatedReq.evidenceLinks.length).toBe(1);
    });

    it('rejects cross-matter evidence attachment (Matter A cannot link Matter B document)', async () => {
      const reqA = await createRequirement('uid-owner-a', MATTER_A_ID, {
        title: 'Matter A Requirement',
        authorityType: 'CAS_REQUESTED',
      });

      await expect(
        attachEvidenceLink('uid-owner-a', MATTER_A_ID, reqA.id, {
          documentId: DOC_B1_ID, // Belongs to Matter B!
          evidenceType: 'COMPLETION_CERTIFICATE',
          title: 'Tampered Document Link',
        })
      ).rejects.toThrow('Document does not belong to this matter');
    });

    it('unlinks evidence without deleting underlying document or evidence item', async () => {
      const req = await createRequirement('uid-owner-a', MATTER_A_ID, {
        title: 'Substance Screening',
        authorityType: 'CAS_REQUESTED',
      });

      const link = await attachEvidenceLink('uid-owner-a', MATTER_A_ID, req.id, {
        evidenceItemId: EV_A1_ID,
        evidenceType: 'SCREENING_RESULT',
        title: 'Lab Screening Result',
      });

      const res = await unlinkEvidenceLink('uid-owner-a', MATTER_A_ID, link.id);
      expect(res.success).toBe(true);

      // Verify underlying evidence item still exists in mock store
      expect(mockEvidenceItems.some((e) => e.id === EV_A1_ID)).toBe(true);
    });
  });

  describe('Professional Collaboration & Lawyer Notes', () => {
    it('allows an authorized professional reviewer to update lawyer_notes and sets verified_by_lawyer_at', async () => {
      const req = await createRequirement('uid-owner-a', MATTER_A_ID, {
        title: 'Supervised Access Log Requirement',
        authorityType: 'COURT_ORDERED',
      });

      const updated = await updateRequirement('uid-reviewer-a', MATTER_A_ID, req.id, {
        lawyerNotes: 'Reviewed court order condition. Parent is fully compliant.',
      });

      expect(updated.lawyer_notes).toBe('Reviewed court order condition. Parent is fully compliant.');
      expect(updated.verified_by_lawyer_at).toBeDefined();
    });
  });
});
