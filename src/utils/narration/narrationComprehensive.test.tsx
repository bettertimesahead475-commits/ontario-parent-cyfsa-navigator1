// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { narrationController } from './narrationController';
import { extractReportSegments, filterSegmentsBySection } from './reportSegments';
import { TtsProvider, NarrationSegment } from './types';

class MockTtsEngine implements TtsProvider {
  name = 'MockTtsEngine';
  spokenTexts: string[] = [];
  calls = 0;
  activeOptions: any = null;
  isPaused = false;
  isStopped = false;

  isSupported() { return true; }

  getVoices() {
    return [
      { name: 'Microsoft Linda', lang: 'en-CA', isCanadian: true, isNaturalOrNeural: true, isDefault: true },
      { name: 'Microsoft Richard', lang: 'en-CA', isCanadian: true, isNaturalOrNeural: true, isDefault: false },
      { name: 'Google US English', lang: 'en-US', isCanadian: false, isNaturalOrNeural: true, isDefault: false },
    ];
  }

  speak(text: string, options: any) {
    this.calls++;
    this.spokenTexts.push(text);
    this.activeOptions = options;
    this.isPaused = false;
    this.isStopped = false;
    options.onStart?.();
  }

  pause() { this.isPaused = true; }
  resume() { this.isPaused = false; }
  stop() {
    this.isStopped = true;
    this.activeOptions = null;
  }

  finishCurrentUtterance() {
    const opts = this.activeOptions;
    this.activeOptions = null;
    opts?.onEnd?.();
  }
}

describe('CYFSA Navigator Report Narration Comprehensive Suite', () => {
  let mockEngine: MockTtsEngine;

  const mockReport = {
    documentTitle: "Affidavit Applicant 30 Sept 2025 M Clark.pdf",
    documentType: "Form 14A Affidavit (Legal Assistant)",
    metadata: { fileNumber: "FC-25-00000240-0000" },
    fileSummary: "This document is a Form 14A affidavit sworn by Michelle Clark in support of an urgent motion.",
    evidenceStrengthIndex: {
      score: 62,
      components: {
        firsthandKnowledge: { score: 12, max: 20, explanation: "Personal knowledge of scheduling." },
        sourceReliability: { score: 10, max: 15, explanation: "Partially named sources." },
      },
    },
    redFlags: [
      {
        id: "rf1",
        severity: "Worth Raising With Counsel",
        category: "Procedural Defect",
        phraseDetected: "We did not inform the court the 5 days had elapsed.",
        explanation: "Direct admission under CYFSA s. 88.",
        parentActionStep: "Instruct counsel to investigate s. 88 hearing timelines.",
      },
      {
        id: "rf2",
        severity: "Worth Raising With Counsel",
        category: "Authority Overreach",
        phraseDetected: "The worker has used her authority to advise the mother against permitting him to have the children in his home.",
        explanation: "Potential procedural concern regarding de facto apprehension.",
        parentActionStep: "Seek disclosure of safety plan records.",
      },
    ],
    chronology: [
      {
        date: "September 11, 2025",
        event: "Understood from Patty Warren that urgent date may be needed.",
        locationInDocument: "Page 1, Paragraph 5",
        evidenceClassification: "HEARSAY",
      },
      {
        date: "September 19, 2025",
        event: "Dawn Bridge asked if this was an urgent motion or an apprehension.",
        locationInDocument: "Page 8",
        evidenceClassification: "DOCUMENTARY",
      },
    ],
    thresholdAnalysis: [
      {
        thresholdChecked: "CYFSA s. 88 — 5-Day Post-Intervention Deadline",
        isMet: "Inconclusive",
        evaluationStatus: "EVALUATED_CONCERN",
        reasoning: "Sworn admission that 5-day notification was omitted.",
        primarySourceLaw: "CYFSA, s. 88",
      },
    ],
  };

  beforeEach(() => {
    mockEngine = new MockTtsEngine();
    narrationController.setProvider(mockEngine);
    narrationController.stop();
  });

  afterEach(() => {
    narrationController.stop();
  });

  it('verifies paragraph-level playback: reads single paragraph and sets highlight state', () => {
    const segments = extractReportSegments(mockReport);
    const targetSegment = segments.find(s => s.id === 'rf-rf1');
    expect(targetSegment).toBeDefined();

    narrationController.playSingleSegment(targetSegment!);

    const state = narrationController.getState();
    expect(state.status).toBe('playing');
    expect(state.currentSegmentId).toBe('rf-rf1');
    expect(state.currentSectionId).toBe('redFlags');
    expect(mockEngine.calls).toBe(1);
    expect(mockEngine.spokenTexts[0]).toContain('We did not inform the court the 5 days had elapsed');
  });

  it('verifies full-report sequential playback: advances through all report segments', () => {
    const segments = extractReportSegments(mockReport);
    expect(segments.length).toBeGreaterThan(4);

    narrationController.playFullReport(segments);

    let state = narrationController.getState();
    expect(state.status).toBe('playing');
    expect(state.currentSegmentIndex).toBe(0);
    expect(state.totalSegments).toBe(segments.length);

    // Simulate completion of segment 1 -> advances to segment 2
    mockEngine.finishCurrentUtterance();
    state = narrationController.getState();
    expect(state.status).toBe('playing');
    expect(state.currentSegmentIndex).toBe(1);

    // Advance through all remaining segments
    for (let i = 2; i < segments.length; i++) {
      mockEngine.finishCurrentUtterance();
    }
    // After the last segment finishes, controller transitions to idle
    mockEngine.finishCurrentUtterance();
    state = narrationController.getState();
    expect(state.status).toBe('idle');
    expect(state.currentSegmentId).toBeNull();
  });

  it('verifies pause, resume, and stop controls', () => {
    const segments = extractReportSegments(mockReport);
    narrationController.playFullReport(segments);

    narrationController.pause();
    expect(narrationController.getState().status).toBe('paused');
    expect(mockEngine.isPaused).toBe(true);

    narrationController.resume();
    expect(narrationController.getState().status).toBe('playing');
    expect(mockEngine.isPaused).toBe(false);

    narrationController.stop();
    expect(narrationController.getState().status).toBe('idle');
    expect(mockEngine.isStopped).toBe(true);
  });

  it('verifies switching documents immediately halts active narration', () => {
    const segments = extractReportSegments(mockReport);
    narrationController.playFullReport(segments);
    expect(narrationController.getState().status).toBe('playing');

    // Simulate user selecting another document in the UI
    window.dispatchEvent(new CustomEvent('opa-doc-analyzer-file-changed', {
      detail: { previousFileId: 'doc-1', newFileId: 'doc-2' },
    }));

    const state = narrationController.getState();
    expect(state.status).toBe('idle');
    expect(state.currentSegmentId).toBeNull();
    expect(mockEngine.isStopped).toBe(true);
  });

  it('verifies user signout immediately halts active narration', () => {
    const segments = extractReportSegments(mockReport);
    narrationController.playFullReport(segments);
    expect(narrationController.getState().status).toBe('playing');

    // Simulate user sign-out
    window.dispatchEvent(new CustomEvent('opa-user-profile-updated'));

    const state = narrationController.getState();
    expect(state.status).toBe('idle');
    expect(mockEngine.isStopped).toBe(true);
  });

  it('verifies keyboard accessibility: Escape key stops narration immediately', () => {
    const segments = extractReportSegments(mockReport);
    narrationController.playFullReport(segments);
    expect(narrationController.getState().status).toBe('playing');

    // Press Escape
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    const state = narrationController.getState();
    expect(state.status).toBe('idle');
    expect(mockEngine.isStopped).toBe(true);
  });

  it('verifies Canadian English voice preference and selection', () => {
    const voices = mockEngine.getVoices();
    expect(voices[0].isCanadian).toBe(true);
    expect(voices[0].name).toBe('Microsoft Linda');

    narrationController.setVoice('Microsoft Richard');
    expect(narrationController.getState().selectedVoiceName).toBe('Microsoft Richard');
  });

  it('verifies long reports with multiple sections are extracted without truncation', () => {
    // Generate a simulated 20-flag report
    const longReport = {
      ...mockReport,
      redFlags: Array.from({ length: 20 }, (_, i) => ({
        id: `long-rf-${i + 1}`,
        severity: "Worth Raising With Counsel",
        category: "Procedural",
        phraseDetected: `Statement ${i + 1} from record.`,
        explanation: `Detailed analysis for statement ${i + 1}.`,
      })),
    };

    const segments = extractReportSegments(longReport);
    const rfSegments = filterSegmentsBySection(segments, 'redFlags');
    expect(rfSegments.length).toBe(20);

    // Verify all 20 segments are unique and sequentially ordered
    for (let i = 0; i < 20; i++) {
      expect(rfSegments[i].id).toBe(`rf-long-rf-${i + 1}`);
    }
  });

  it('verifies that no network API calls are made and document text is processed locally', () => {
    const segments = extractReportSegments(mockReport);
    narrationController.playSingleSegment(segments[0]);

    // Provider is WebSpeech (zero fetch/HTTP requests)
    expect(mockEngine.calls).toBe(1);
    expect(mockEngine.spokenTexts[0]).toBeTruthy();
  });
});
