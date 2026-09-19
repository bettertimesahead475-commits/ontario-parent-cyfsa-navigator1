import React from 'react';

interface CaseBriefViewerProps {
  caseBrief: any;
  onRefresh: () => void;
  isFinalized?: boolean;
  versionNumber?: number;
  finalizedAt?: string;
  onFinalize?: () => void;
}

export default function CaseBriefViewer({ caseBrief, onRefresh, isFinalized, versionNumber, finalizedAt, onFinalize }: CaseBriefViewerProps) {
  if (!caseBrief) return null;

  const sections = caseBrief.sections;

  const getReviewForFinding = (findingType: string, findingId: string) => {
    return sections.professionalReview?.find((r: any) => r.findingType === findingType && r.findingId === findingId);
  };

  const renderReviewState = (state: string) => {
    if (!state || state === 'UNREVIEWED') return null;
    return (
      <span className="ml-2 inline-block px-2 py-0.5 text-xs font-medium bg-indigo-100 text-indigo-800 rounded">
        {state.replace('_', ' ')}
      </span>
    );
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="case-brief-viewer bg-white text-slate-900 print:bg-white print:text-black">
      {/* Header Controls - Hidden in Print */}
      <div className="flex justify-between items-center mb-6 print:hidden">
        <h2 className="text-2xl font-bold">
          {isFinalized ? `FINALIZED CASE BRIEF (Version ${versionNumber})` : 'CURRENT CASE BRIEF'}
        </h2>
        <div className="flex gap-2">
          {!isFinalized && onFinalize && (
            <button 
              className="bg-green-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-green-700" 
              onClick={() => {
                if(window.confirm('Are you sure you want to finalize this case brief? This will create a preserved immutable work-product version.')) {
                  onFinalize();
                }
              }}
            >
              Finalize Case Brief
            </button>
          )}
          <button 
            className="bg-slate-200 text-slate-800 px-3 py-1.5 rounded text-sm font-medium hover:bg-slate-300" 
            onClick={handlePrint}
          >
            Export to PDF / Print
          </button>
          {!isFinalized && (
            <button 
              className="bg-indigo-600 text-white px-3 py-1.5 rounded text-sm font-medium hover:bg-indigo-700" 
              onClick={onRefresh}
            >
              Refresh Brief
            </button>
          )}
        </div>
      </div>

      {/* Print Header */}
      <div className="mb-8 pb-4 border-b-2 border-slate-800">
        <h1 className="text-3xl font-bold mb-2">
          {isFinalized ? `FINALIZED CASE BRIEF - Version ${versionNumber}` : 'CYFSA Navigator: Case Brief'}
        </h1>
        <p className="text-lg mb-1">{caseBrief.title}</p>
        <p className="text-sm text-slate-500 mb-4">
          {isFinalized ? `Finalized: ${new Date(finalizedAt || caseBrief.createdAt).toLocaleString()}` : `Generated: ${new Date(caseBrief.createdAt).toLocaleString()}`}
        </p>
        <div className="p-4 bg-slate-100 border-l-4 border-slate-500 text-sm italic">
          {isFinalized ? 
            'Preserved work-product version. This document represents the case intelligence and professional review exactly as it was at the time of finalization.' :
            'Decision-support work product generated from the records available to CYFSA Navigator. Potential issues and legal relevance require professional verification against the source record and current law. Not an official court document.'
          }
        </div>
      </div>

      <div className="space-y-10">
        
        {/* 1. CASE OVERVIEW */}
        <section>
          <h2 className="text-xl font-bold border-b pb-2 mb-4">1. Case Overview</h2>
          <div className="p-4 bg-slate-50 rounded">
            <p><strong>Matter:</strong> {sections.matterOverview?.title || 'Unknown'}</p>
            {sections.matterOverview?.createdAt && (
              <p><strong>Created:</strong> {new Date(sections.matterOverview.createdAt).toLocaleDateString()}</p>
            )}
          </div>
        </section>

        {/* 2. PEOPLE AND ORGANIZATIONS */}
        <section>
          <h2 className="text-xl font-bold border-b pb-2 mb-4">2. People and Organizations</h2>
          {sections.keyPeopleAndOrganizations?.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {sections.keyPeopleAndOrganizations.map((e: any) => {
                const review = getReviewForFinding('ENTITIES', e.id);
                return (
                  <div key={e.id} className="p-3 border rounded shadow-sm">
                    <p className="font-semibold">{e.name}</p>
                    <p className="text-sm text-slate-600">Type: {e.type}</p>
                    {renderReviewState(review?.reviewState || e.reviewState)}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-slate-500 italic">No canonical entities available.</p>
          )}
        </section>

        {/* 3. CHRONOLOGY */}
        <section>
          <h2 className="text-xl font-bold border-b pb-2 mb-4">3. Chronology</h2>
          {sections.proceduralChronology?.length > 0 ? (
            <div className="space-y-3">
              {sections.proceduralChronology.map((evt: any) => {
                const review = getReviewForFinding('EVENTS', evt.id);
                return (
                  <div key={evt.id} className="p-3 border-l-4 border-indigo-200 bg-slate-50">
                    <p className="font-semibold">{evt.dateText || 'Unknown Date'} <span className="text-xs font-normal text-slate-500 ml-2">({evt.datePrecision})</span></p>
                    <p className="mt-1">{evt.description}</p>
                    {renderReviewState(review?.reviewState || evt.reviewState)}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-slate-500 italic">No chronology available.</p>
          )}
        </section>

        {/* 4. EVIDENCE SUMMARY */}
        <section>
          <h2 className="text-xl font-bold border-b pb-2 mb-4">4. Evidence Summary</h2>
          {sections.materialEvidence?.length > 0 ? (
            <div className="space-y-4">
              {sections.materialEvidence.map((ev: any) => {
                const review = getReviewForFinding('EVIDENCE', ev.id);
                return (
                  <div key={ev.id} className="p-4 border rounded">
                    <div className="flex justify-between items-start mb-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-slate-500 bg-slate-100 px-2 py-1 rounded">
                        {ev.classification || 'UNKNOWN'}
                      </span>
                      {ev.pageNumber && (
                        <span className="text-xs text-slate-500">Page {ev.pageNumber}</span>
                      )}
                    </div>
                    {ev.exactQuote ? (
                      <blockquote className="border-l-4 border-slate-300 pl-4 py-1 mb-2 italic text-slate-700">
                        "{ev.exactQuote}"
                      </blockquote>
                    ) : (
                      <p className="mb-2 text-slate-800">{ev.content}</p>
                    )}
                    {renderReviewState(review?.reviewState || ev.reviewState)}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-slate-500 italic">No evidence items available.</p>
          )}
        </section>

        {/* 5. CLAIMS / ALLEGATIONS */}
        <section>
          <h2 className="text-xl font-bold border-b pb-2 mb-4">5. Claims and Allegations</h2>
          {sections.materialClaims?.length > 0 ? (
            <ul className="list-disc pl-5 space-y-2">
              {sections.materialClaims.map((claim: any) => {
                const review = getReviewForFinding('CLAIMS', claim.id);
                return (
                  <li key={claim.id} className="pl-1">
                    <span className="text-slate-800">{claim.claimText}</span>
                    <span className="text-xs text-slate-500 ml-2">({claim.classification})</span>
                    {renderReviewState(review?.reviewState || claim.reviewState)}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-slate-500 italic">No claims available.</p>
          )}
        </section>

        {/* 6. RELATIONSHIPS / CORROBORATION */}
        <section>
          <h2 className="text-xl font-bold border-b pb-2 mb-4">6. Relationships & Corroboration</h2>
          {sections.corroborationRelationships?.length > 0 ? (
            <ul className="list-disc pl-5 space-y-2">
              {sections.corroborationRelationships.map((rel: any) => {
                const review = getReviewForFinding('RELATIONSHIPS', rel.id);
                return (
                  <li key={rel.id}>
                    <span className="font-medium text-slate-700">{rel.relationshipType}:</span> Claim {rel.sourceClaimId} relates to {rel.targetClaimId}
                    {renderReviewState(review?.reviewState)}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-slate-500 italic">No corroboration relationships found.</p>
          )}
        </section>

        {/* 7. POTENTIAL INCONSISTENCIES */}
        <section>
          <h2 className="text-xl font-bold border-b pb-2 mb-4">7. Potential Inconsistencies</h2>
          {sections.potentialInconsistencies?.length > 0 ? (
            <div className="space-y-3">
              {sections.potentialInconsistencies.map((inc: any) => {
                const review = getReviewForFinding('RELATIONSHIPS', inc.id);
                return (
                  <div key={inc.id} className="p-3 bg-amber-50 border border-amber-200 rounded">
                    <p className="text-amber-800 font-medium mb-1">{inc.neutralDescription || 'Potential inconsistency requiring review.'}</p>
                    <p className="text-sm text-amber-700">Type: {inc.relationshipType} | Claims: {inc.sourceClaimId} ↔ {inc.targetClaimId}</p>
                    {renderReviewState(review?.reviewState)}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-slate-500 italic">No potential inconsistencies flagged.</p>
          )}
        </section>

        {/* 8. EVIDENCE GAPS */}
        <section>
          <h2 className="text-xl font-bold border-b pb-2 mb-4">8. Evidence Gaps</h2>
          {sections.evidenceGaps?.length > 0 ? (
            <ul className="list-disc pl-5 space-y-2">
              {sections.evidenceGaps.map((gap: any) => {
                const review = getReviewForFinding('GAPS', gap.id);
                return (
                  <li key={gap.id}>
                    <strong>{gap.gapType.replace('_', ' ')}:</strong> {gap.description}
                    {renderReviewState(review?.reviewState)}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-slate-500 italic">No evidence gaps identified.</p>
          )}
        </section>

        {/* 9. POTENTIAL LEGAL RELEVANCE */}
        <section>
          <h2 className="text-xl font-bold border-b pb-2 mb-4">9. Potential Legal Relevance</h2>
          {sections.potentialLegalRelevanceFlags?.length > 0 ? (
            <div className="space-y-4">
              {sections.potentialLegalRelevanceFlags.map((leg: any) => {
                const review = getReviewForFinding('LEGAL', leg.id);
                return (
                  <div key={leg.id} className="p-4 bg-slate-50 border rounded">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-xs font-bold bg-slate-200 px-2 py-1 rounded">Requires Professional Review</span>
                      <span className="text-xs text-slate-600">{leg.snapshotType}</span>
                    </div>
                    <p className="text-slate-800 text-sm whitespace-pre-wrap">{leg.content}</p>
                    {renderReviewState(review?.reviewState)}
                  </div>
                );
              })}
            </div>
          ) : (
            <p className="text-slate-500 italic">No legal relevance flags.</p>
          )}
        </section>

        {/* 10. PROFESSIONAL REVIEW */}
        <section>
          <h2 className="text-xl font-bold border-b pb-2 mb-4">10. Professional Review (Private)</h2>
          <div className="p-4 bg-indigo-50 border border-indigo-100 rounded mb-4 text-sm text-indigo-800">
            <strong>Privacy Notice:</strong> The notes below are private to your authenticated reviewer session.
          </div>
          {sections.professionalReview?.length > 0 ? (
            <div className="space-y-4">
              {sections.professionalReview.map((rev: any) => (
                <div key={rev.id} className="p-4 bg-white border rounded shadow-sm">
                  <div className="flex justify-between items-start mb-2">
                    <span className="font-semibold text-slate-800">{rev.findingType} - {rev.findingId}</span>
                    <span className="text-xs px-2 py-1 rounded bg-slate-100 font-medium">{rev.reviewState}</span>
                  </div>
                  {rev.reviewNote ? (
                    <p className="text-sm text-slate-600 bg-slate-50 p-3 rounded">{rev.reviewNote}</p>
                  ) : (
                    <p className="text-sm text-slate-400 italic">No note provided.</p>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-slate-500 italic">No professional annotations recorded.</p>
          )}
        </section>

        {/* 11. SOURCE INDEX */}
        <section>
          <h2 className="text-xl font-bold border-b pb-2 mb-4">11. Source Index</h2>
          {sections.sourceIndex?.length > 0 ? (
            <ul className="list-disc pl-5 space-y-1">
              {sections.sourceIndex.map((docId: string, idx: number) => (
                <li key={idx} className="text-sm text-slate-700">
                  Document ID: <code className="bg-slate-100 px-1 rounded">{docId}</code>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-slate-500 italic">No sources referenced.</p>
          )}
        </section>

      </div>
    </div>
  );
}
