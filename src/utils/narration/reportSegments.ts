/**
 * CYFSA Navigator — Report Segment Extraction for Narration
 *
 * Traverses a Quick Review or Deep Scan report and extracts discrete,
 * navigable narration segments with clean labels and text.
 */

import { NarrationSegment } from './types';

export function extractReportSegments(report: Record<string, any>): NarrationSegment[] {
  if (!report || typeof report !== 'object') return [];

  const segments: NarrationSegment[] = [];

  // 1. Title & Header
  if (report.documentTitle) {
    segments.push({
      id: 'header-title',
      sectionId: 'overview',
      label: 'Document Identification',
      text: `Document Under Review: ${report.documentTitle}. Classification: ${report.documentType || 'Ontario Court Record'}. Court file number: ${report.metadata?.fileNumber || 'Not specified'}.`,
      domId: 'report-overview-card',
    });
  }

  // 2. Executive Case Overview & File Summary
  if (report.fileSummary) {
    segments.push({
      id: 'summary-main',
      sectionId: 'overview',
      label: 'Case Overview & File Summary',
      text: String(report.fileSummary),
      domId: 'report-file-summary-block',
    });
  }

  // 3. Evidence Strength Index (ESI) & Completeness
  if (report.evidenceStrengthIndex?.score !== undefined) {
    const esi = report.evidenceStrengthIndex;
    let esiText = `Evidence Strength Index: ${esi.score} out of 100. Information Completeness Score: ${report.completenessScore ?? 'Not scored'} out of 100. `;
    if (esi.components && typeof esi.components === 'object') {
      const parts = Object.entries(esi.components).map(([k, comp]: [string, any]) => {
        const readableName = k.replace(/([A-Z])/g, ' $1').toLowerCase();
        return `${readableName}: score ${comp.score} of ${comp.max}. ${comp.explanation || ''}`;
      });
      esiText += parts.join(' ');
    }
    segments.push({
      id: 'esi-card',
      sectionId: 'overview',
      label: 'Evidence Strength Scorecard',
      text: esiText,
      domId: 'report-esi-card',
    });
  }

  // 4. Red Flags & Evidentiary Findings
  if (Array.isArray(report.redFlags) && report.redFlags.length > 0) {
    report.redFlags.forEach((rf: any, idx: number) => {
      const rfId = rf.id || `rf-${idx + 1}`;
      let rfText = `Evidence Finding ${idx + 1}: Severity: ${rf.severity || 'Unspecified'}. Category: ${rf.category || 'Evidence issue'}. `;
      if (rf.phraseDetected) {
        rfText += `Quoted text from document: "${rf.phraseDetected}". `;
      }
      if (rf.locationInDocument) {
        rfText += `Location: ${rf.locationInDocument}. `;
      }
      if (rf.explanation) {
        rfText += `Analysis: ${rf.explanation}. `;
      }
      if (rf.parentActionStep) {
        rfText += `Recommended Action: ${rf.parentActionStep}. `;
      }

      segments.push({
        id: `rf-${rfId}`,
        sectionId: 'redFlags',
        label: `Evidence Finding ${idx + 1}: ${rf.category || 'Red Flag'}`,
        text: rfText,
        domId: `red-flag-card-${rfId}`,
      });
    });
  }

  // 5. Chronology Events
  if (Array.isArray(report.chronology) && report.chronology.length > 0) {
    report.chronology.forEach((item: any, idx: number) => {
      const eventText = `Date: ${item.date || 'Undated'}. Event: ${item.event || ''}. Location: ${item.locationInDocument || 'In document'}. Evidence type: ${item.evidenceClassification || 'Documentary'}.`;
      segments.push({
        id: `chrono-${idx}`,
        sectionId: 'chronology',
        label: `Chronology: ${item.date || `Event ${idx + 1}`}`,
        text: eventText,
        domId: `chronology-row-${idx}`,
      });
    });
  }

  // 6. Contradictions
  if (Array.isArray(report.contradictions) && report.contradictions.length > 0) {
    report.contradictions.forEach((item: any, idx: number) => {
      const text = `Document Contradiction ${idx + 1}: ${item.description || ''}. Significance: ${item.significance || ''}.`;
      segments.push({
        id: `contra-${idx}`,
        sectionId: 'chronology',
        label: `Contradiction ${idx + 1}`,
        text,
        domId: `contradiction-item-${idx}`,
      });
    });
  }

  // 7. Statutory Thresholds
  if (Array.isArray(report.thresholdAnalysis) && report.thresholdAnalysis.length > 0) {
    report.thresholdAnalysis.forEach((th: any, idx: number) => {
      const text = `CYFSA Threshold Check: ${th.thresholdChecked || `Threshold ${idx + 1}`}. Status: ${th.isMet || 'Inconclusive'}. Evaluation: ${th.evaluationStatus || 'Evaluated'}. Reasoning: ${th.reasoning || ''}. Statutory Authority: ${th.primarySourceLaw || ''}.`;
      segments.push({
        id: `threshold-${idx}`,
        sectionId: 'thresholds',
        label: `Threshold: ${th.thresholdChecked || `Rule ${idx + 1}`}`,
        text,
        domId: `threshold-card-${idx}`,
      });
    });
  }

  // 8. Procedural Timelines
  if (Array.isArray(report.proceduralTimelineViolations) && report.proceduralTimelineViolations.length > 0) {
    report.proceduralTimelineViolations.forEach((tl: any, idx: number) => {
      const text = `Procedural Timeline: ${tl.timelineRule || `Timeline ${idx + 1}`}. Document Assertion: ${tl.documentAssertion || ''}. Legal Analysis: ${tl.evaluation || ''}. Citation: ${tl.citation || ''}. Action: ${tl.parentActionStep || ''}.`;
      segments.push({
        id: `timeline-${idx}`,
        sectionId: 'timelines',
        label: `Timeline: ${tl.timelineRule || `Timeline ${idx + 1}`}`,
        text,
        domId: `timeline-card-${idx}`,
      });
    });
  }

  // 9. Charter and Human Rights Issues
  if (Array.isArray(report.charterAndHumanRightsIssues) && report.charterAndHumanRightsIssues.length > 0) {
    report.charterAndHumanRightsIssues.forEach((ch: any, idx: number) => {
      const text = typeof ch === 'string'
        ? `Constitutional Protection ${idx + 1}: ${ch}`
        : `Constitutional Protection: ${ch.checkpoint || `Issue ${idx + 1}`}. Assessment: ${ch.analysis || ''}. Legal Citation: ${ch.citation || ''}.`;
      segments.push({
        id: `charter-${idx}`,
        sectionId: 'charter',
        label: `Charter: ${typeof ch === 'string' ? `Issue ${idx + 1}` : (ch.checkpoint || `Issue ${idx + 1}`)}`,
        text,
        domId: `charter-card-${idx}`,
      });
    });
  }

  // 10. Lawyer Case Brief & Examination Strategy
  if (Array.isArray(report.lawyerCaseBrief) && report.lawyerCaseBrief.length > 0) {
    report.lawyerCaseBrief.forEach((bullet: string, idx: number) => {
      const cleanBullet = bullet.replace(/\*\*/g, '');
      segments.push({
        id: `brief-bullet-${idx}`,
        sectionId: 'guidance',
        label: `Case Brief: Point ${idx + 1}`,
        text: cleanBullet,
        domId: `lawyer-brief-bullet-${idx}`,
      });
    });
  } else if (report.caseBrief && typeof report.caseBrief === 'object') {
    const cb = report.caseBrief;
    let cbText = `Lawyer Case Brief. Factual Matrix: ${cb.factualMatrix || ''}. Evidentiary Weaknesses: ${cb.evidentiaryWeaknesses || ''}. Statutory Framework: ${cb.statutoryFramework || ''}. `;
    if (Array.isArray(cb.proposedExaminationQuestions) && cb.proposedExaminationQuestions.length > 0) {
      cbText += `Proposed Examination Questions: ${cb.proposedExaminationQuestions.join('. ')}`;
    }
    segments.push({
      id: 'case-brief-main',
      sectionId: 'guidance',
      label: 'Lawyer Case Brief & Strategy',
      text: cbText,
      domId: 'case-brief-block',
    });
  }

  // 11. Checklist items: Verify, Missing, Ask Lawyer
  if (Array.isArray(report.whatToVerify) && report.whatToVerify.length > 0) {
    report.whatToVerify.forEach((item: string, idx: number) => {
      segments.push({
        id: `verify-${idx}`,
        sectionId: 'guidance',
        label: `Verification Check ${idx + 1}`,
        text: `Item to verify: ${item}`,
        domId: `verify-item-${idx}`,
      });
    });
  }

  if (Array.isArray(report.whatIsMissing) && report.whatIsMissing.length > 0) {
    report.whatIsMissing.forEach((item: string, idx: number) => {
      segments.push({
        id: `missing-${idx}`,
        sectionId: 'guidance',
        label: `Missing Element ${idx + 1}`,
        text: `Missing evidentiary element: ${item}`,
        domId: `missing-item-${idx}`,
      });
    });
  }

  if (Array.isArray(report.whatToAskALawyer) && report.whatToAskALawyer.length > 0) {
    report.whatToAskALawyer.forEach((item: string, idx: number) => {
      segments.push({
        id: `ask-${idx}`,
        sectionId: 'guidance',
        label: `Question for Counsel ${idx + 1}`,
        text: `Question for counsel: ${item}`,
        domId: `ask-item-${idx}`,
      });
    });
  }

  return segments;
}

export function filterSegmentsBySection(segments: NarrationSegment[], sectionId: string): NarrationSegment[] {
  return segments.filter(s => s.sectionId === sectionId);
}
