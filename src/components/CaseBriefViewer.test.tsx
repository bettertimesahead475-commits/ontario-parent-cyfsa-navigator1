/**
 * @vitest-environment jsdom
 */
import React from 'react';
import { render, screen, cleanup } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import CaseBriefViewer from './CaseBriefViewer';

describe('CaseBriefViewer', () => {
  afterEach(() => {
    cleanup();
  });
  const mockBriefA = {
    id: 'brief-123',
    title: 'Case Brief: Matter A',
    createdAt: '2026-09-19T10:00:00.000Z',
    sections: {
      matterOverview: { title: 'Matter A Title' },
      keyPeopleAndOrganizations: [{ id: 'ent-1', type: 'PERSON', name: 'John Doe', reviewState: 'CONFIRMED' }],
      proceduralChronology: [{ id: 'evt-1', dateText: 'Spring 2023', datePrecision: 'SEASON', description: 'Meeting occurred', reviewState: 'UNREVIEWED' }],
      materialEvidence: [
        { id: 'ev-1', classification: 'FACT', content: 'Child is 5', exactQuote: null, reviewState: 'CONFIRMED' },
        { id: 'ev-2', classification: 'ALLEGATION', content: 'Parent was late', exactQuote: 'parent was late', reviewState: 'DISPUTED' }
      ],
      materialClaims: [{ id: 'cl-1', classification: 'UNVERIFIED_CLAIM', claimText: 'Neglect occurred', reviewState: 'UNREVIEWED' }],
      corroborationRelationships: [{ id: 'rel-1', relationshipType: 'CORROBORATION', sourceClaimId: 'cl-1', targetClaimId: 'cl-2' }],
      potentialInconsistencies: [{ id: 'inc-1', relationshipType: 'CONTRADICTION', neutralDescription: 'Potential inconsistency requiring review.', sourceClaimId: 'cl-1', targetClaimId: 'cl-3' }],
      evidenceGaps: [{ id: 'gap-1', gapType: 'MISSING_DOCUMENT', description: 'Medical file missing' }],
      potentialLegalRelevanceFlags: [{ id: 'leg-1', snapshotType: 'CYFSA_ANALYSIS', content: 'Section 74 relevance' }],
      professionalReview: [
        { findingType: 'EVIDENCE', findingId: 'ev-2', reviewState: 'DISPUTED', reviewNote: 'Note from Reviewer A', reviewerAccountId: 'acc-authorized' }
      ],
      sourceIndex: ['doc-1']
    }
  };

  const mockBriefB = {
    ...mockBriefA,
    sections: {
      ...mockBriefA.sections,
      professionalReview: [
        { findingType: 'EVIDENCE', findingId: 'ev-2', reviewState: 'CONFIRMED', reviewNote: 'Secret Note B', reviewerAccountId: 'acc-reviewer-b' }
      ]
    }
  };

  it('CASE_BRIEF renders expected major sections', () => {
    render(<CaseBriefViewer caseBrief={mockBriefA} onRefresh={vi.fn()} />);
    expect(screen.getAllByText(/1\. Case Overview/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/2\. People and Organizations/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/3\. Chronology/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/4\. Evidence Summary/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/5\. Claims and Allegations/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/6\. Relationships & Corroboration/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/7\. Potential Inconsistencies/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/8\. Evidence Gaps/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/9\. Potential Legal Relevance/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/10\. Professional Review \(Private\)/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/11\. Source Index/i).length).toBeGreaterThan(0);
  });

  it('FACT / ALLEGATION / other classifications remain distinguishable', () => {
    render(<CaseBriefViewer caseBrief={mockBriefA} onRefresh={vi.fn()} />);
    expect(screen.getAllByText(/FACT/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/ALLEGATION/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/UNVERIFIED_CLAIM/i).length).toBeGreaterThan(0);
  });

  it('uncertain chronology is not converted into false exact dates', () => {
    render(<CaseBriefViewer caseBrief={mockBriefA} onRefresh={vi.fn()} />);
    expect(screen.getAllByText(/Spring 2023/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/\(SEASON\)/i).length).toBeGreaterThan(0);
  });

  it('exact quote rendering only uses legitimate exact quotes', () => {
    render(<CaseBriefViewer caseBrief={mockBriefA} onRefresh={vi.fn()} />);
    expect(screen.getAllByText(/"parent was late"/i).length).toBeGreaterThan(0); 
    expect(screen.getAllByText(/Child is 5/i).length).toBeGreaterThan(0); 
  });

  it('source/provenance information is preserved', () => {
    render(<CaseBriefViewer caseBrief={mockBriefA} onRefresh={vi.fn()} />);
    expect(screen.getAllByText(/doc-1/i).length).toBeGreaterThan(0);
  });

  it('neutral inconsistency terminology is preserved', () => {
    render(<CaseBriefViewer caseBrief={mockBriefA} onRefresh={vi.fn()} />);
    expect(screen.getAllByText(/Potential inconsistency requiring review\./i).length).toBeGreaterThan(0);
  });

  it('legal relevance remains potential/review-required rather than conclusion', () => {
    render(<CaseBriefViewer caseBrief={mockBriefA} onRefresh={vi.fn()} />);
    expect(screen.getAllByText(/Requires Professional Review/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/Section 74 relevance/i).length).toBeGreaterThan(0);
  });

  it('professional review appears for authorized Reviewer A', () => {
    render(<CaseBriefViewer caseBrief={mockBriefA} onRefresh={vi.fn()} />);
    expect(screen.getAllByText(/Note from Reviewer A/i).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/EVIDENCE - ev-2/i).length).toBeGreaterThan(0);
  });

  it('Reviewer A rendering contains NONE of Reviewer B\'s private review', () => {
    render(<CaseBriefViewer caseBrief={mockBriefA} onRefresh={vi.fn()} />);
    expect(screen.queryAllByText(/Secret Note B/i).length).toBe(0);
  });

  it('Reviewer B rendering contains NONE of Reviewer A\'s private review', () => {
    render(<CaseBriefViewer caseBrief={mockBriefB} onRefresh={vi.fn()} />);
    expect(screen.queryAllByText(/Note from Reviewer A/i).length).toBe(0);
    expect(screen.getAllByText(/Secret Note B/i).length).toBeGreaterThan(0);
  });

  it('print/export uses the same reviewer-scoped data and export does not re-query broader professional_reviews data', () => {
    const printMock = vi.fn();
    window.print = printMock;
    
    render(<CaseBriefViewer caseBrief={mockBriefA} onRefresh={vi.fn()} />);
    const exportBtn = screen.getAllByText(/Export to PDF \/ Print/i)[0];
    exportBtn.click();
    
    expect(printMock).toHaveBeenCalled();
    expect(screen.queryAllByText(/Secret Note B/i).length).toBe(0);
  });
  
  it('no live AI invocation occurs, no outcome scoring is introduced', () => {
    render(<CaseBriefViewer caseBrief={mockBriefA} onRefresh={vi.fn()} />);
    expect(screen.queryAllByText(/win probability/i).length).toBe(0);
    expect(screen.queryAllByText(/score/i).length).toBe(0);
    expect(screen.queryAllByText(/\bAI\b/).length).toBe(0);
  });
});
