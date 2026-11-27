import { describe, it, expect } from 'vitest';
import { extractReportSegments, filterSegmentsBySection } from './reportSegments';

describe('Report Segments Extraction', () => {
  const sampleReport = {
    documentTitle: "Michelle Clark Affidavit",
    documentType: "Form 14A",
    metadata: { fileNumber: "FC-25-00000240-0000" },
    fileSummary: "This document is a procedural scheduling affidavit.",
    evidenceStrengthIndex: {
      score: 62,
      components: {
        firsthandKnowledge: { score: 12, max: 20, explanation: "Personal knowledge of scheduling." },
      },
    },
    redFlags: [
      {
        id: "rf1",
        severity: "Worth Raising With Counsel",
        category: "Procedural Defect",
        phraseDetected: "We did not inform the court the 5 days had elapsed.",
        explanation: "Direct admission of omitted notification.",
        parentActionStep: "Discuss s. 88 timeline with counsel.",
      },
    ],
    chronology: [
      {
        date: "September 11, 2025",
        event: "Manager indicated urgent motion may be needed.",
        locationInDocument: "Page 1, Paragraph 5",
        evidenceClassification: "HEARSAY",
      },
    ],
    thresholdAnalysis: [
      {
        thresholdChecked: "CYFSA s. 88",
        isMet: "Inconclusive",
        evaluationStatus: "EVALUATED_CONCERN",
        reasoning: "Post-apprehension 5-day rule triggered.",
        primarySourceLaw: "CYFSA s. 88",
      },
    ],
  };

  it('extracts all expected sections into discrete narration segments', () => {
    const segments = extractReportSegments(sampleReport);
    expect(segments.length).toBeGreaterThanOrEqual(5);

    const sectionIds = segments.map(s => s.sectionId);
    expect(sectionIds).toContain('overview');
    expect(sectionIds).toContain('redFlags');
    expect(sectionIds).toContain('chronology');
    expect(sectionIds).toContain('thresholds');
  });

  it('filters segments by sectionId correctly', () => {
    const segments = extractReportSegments(sampleReport);
    const rfSegments = filterSegmentsBySection(segments, 'redFlags');
    expect(rfSegments.length).toBe(1);
    expect(rfSegments[0].id).toBe('rf-rf1');
    expect(rfSegments[0].text).toContain('We did not inform the court the 5 days had elapsed');
  });

  it('handles empty or malformed report payloads gracefully', () => {
    expect(extractReportSegments({})).toEqual([]);
    expect(extractReportSegments(null as any)).toEqual([]);
  });
});
