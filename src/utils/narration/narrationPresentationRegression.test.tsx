// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, fireEvent, cleanup } from '@testing-library/react';
import { narrationController } from './narrationController';
import { ParagraphListenButton } from '../../components/narration/ParagraphListenButton';
import { SectionListenButton } from '../../components/narration/SectionListenButton';
import { FindingPresentationCard } from '../../components/FindingPresentationCard';
import { TtsProvider, NarrationSegment } from './types';

class MockTtsProvider implements TtsProvider {
  name = 'MockTtsProvider';
  lastSpokenText: string | null = null;
  lastOptions: any = null;
  isPaused = false;
  isStopped = false;

  isSupported() { return true; }
  getVoices() {
    return [
      { name: 'Microsoft Linda', lang: 'en-CA', isCanadian: true, isNaturalOrNeural: true, isDefault: true }
    ];
  }

  speak(text: string, options: any) {
    this.lastSpokenText = text;
    this.lastOptions = options;
    this.isPaused = false;
    this.isStopped = false;
    options.onStart?.();
  }

  pause() { this.isPaused = true; }
  resume() { this.isPaused = false; }
  stop() { 
    this.isStopped = true;
    this.lastOptions = null;
  }
}

describe('Narration Presentation & Prop Mismatch Regression Suite', () => {
  let mockProvider: MockTtsProvider;

  beforeEach(() => {
    mockProvider = new MockTtsProvider();
    narrationController.setProvider(mockProvider);
    narrationController.stop();
  });

  afterEach(() => {
    cleanup();
    narrationController.stop();
  });

  // =========================================================================
  // 1. REGRESSION: Undefined segment prop must NEVER throw runtime exception
  // =========================================================================
  it('safely handles missing or undefined segment in ParagraphListenButton without throwing', () => {
    expect(() => {
      const { container } = render(<ParagraphListenButton segment={undefined} />);
      expect(container.firstChild).toBeNull();
    }).not.toThrow();
  });

  it('renders and triggers playback with a valid NarrationSegment', () => {
    const validSegment: NarrationSegment = {
      id: 'test-seg-1',
      sectionId: 'overview',
      label: 'Document Identification',
      text: 'Document Under Review: Form 14A Affidavit.',
    };

    const { getByRole } = render(<ParagraphListenButton segment={validSegment} />);
    const button = getByRole('button');
    expect(button).toBeDefined();

    fireEvent.click(button);

    expect(narrationController.getState().status).toBe('playing');
    expect(narrationController.getState().currentSegmentId).toBe('test-seg-1');
    expect(mockProvider.lastSpokenText).toBe('Document Under Review: Form 14A Affidavit.');
  });

  // =========================================================================
  // 2. REGRESSION: SectionListenButton accepts segments array prop cleanly
  // =========================================================================
  it('correctly handles SectionListenButton with segments array', () => {
    const segments: NarrationSegment[] = [
      { id: 's1', sectionId: 'guidance', label: 'Action 1', text: 'First action step.' },
      { id: 's2', sectionId: 'guidance', label: 'Action 2', text: 'Second action step.' },
      { id: 's3', sectionId: 'other', label: 'Other', text: 'Unrelated item.' },
    ];

    const { getByRole } = render(
      <SectionListenButton 
        sectionId="guidance" 
        segments={segments} 
        sectionTitle="Preparation Guidance" 
        label="Listen to Guidance" 
      />
    );

    const button = getByRole('button', { name: /Listen to entire section: Preparation Guidance/i });
    fireEvent.click(button);

    expect(narrationController.getState().status).toBe('playing');
    expect(narrationController.getState().currentSegmentId).toBe('s1');
    expect(narrationController.getState().totalSegments).toBe(2);
    expect(mockProvider.lastSpokenText).toBe('First action step.');
  });

  // =========================================================================
  // 3. REGRESSION: FindingPresentationCard dynamic narration modes
  // =========================================================================
  it('narrates Educational Legal Analysis when educational tab is active', () => {
    const mockFlag = {
      id: 'finding-101',
      severity: 'CRITICAL EVISTAT DEFECT',
      category: 'Procedural Defect',
      phraseDetected: 'We did not inform the court that 5 days had elapsed.',
      locationInDocument: 'Page 3, Paragraph 14',
      explanation: 'Admission that statutory 5-day hearing deadline was missed.',
      parentActionStep: 'Instruct counsel to move for dismissal or review under s. 88.',
    };

    const { getByRole, getByText } = render(
      <FindingPresentationCard 
        flag={mockFlag} 
        idx={0} 
        openLegislativeReference={vi.fn()} 
        setSearchQuery={vi.fn()} 
      />
    );

    // Default tab is Educational Legal Analysis
    expect(getByText('Educational Legal Analysis')).toBeDefined();

    // Find the finding's listen button
    const listenBtn = getByRole('button', { name: /Listen to Educational Analysis/i });
    expect(listenBtn).toBeDefined();

    fireEvent.click(listenBtn);

    expect(narrationController.getState().status).toBe('playing');
    expect(narrationController.getState().currentSegmentId).toBe('rf-finding-101-educational');
    expect(mockProvider.lastSpokenText).toContain('Educational Legal Analysis for Finding 1');
    expect(mockProvider.lastSpokenText).toContain('We did not inform the court that 5 days had elapsed');
  });

  it('narrates Courtroom-Style Legal Presentation when courtroom tab is active', () => {
    const mockFlag = {
      id: 'finding-101',
      severity: 'CRITICAL EVISTAT DEFECT',
      category: 'Procedural Defect',
      phraseDetected: 'We did not inform the court that 5 days had elapsed.',
      locationInDocument: 'Page 3, Paragraph 14',
      explanation: 'Admission that statutory 5-day hearing deadline was missed.',
      parentActionStep: 'Instruct counsel to move for dismissal or review under s. 88.',
    };

    const { getByRole } = render(
      <FindingPresentationCard 
        flag={mockFlag} 
        idx={0} 
        openLegislativeReference={vi.fn()} 
        setSearchQuery={vi.fn()} 
      />
    );

    // Switch to Courtroom-Style Legal Presentation tab
    const courtroomTabBtn = getByRole('tab', { name: /Courtroom-Style Legal Presentation/i });
    fireEvent.click(courtroomTabBtn);

    // Listen button label must update to Courtroom Presentation
    const listenBtn = getByRole('button', { name: /Listen to Courtroom Presentation/i });
    expect(listenBtn).toBeDefined();

    fireEvent.click(listenBtn);

    expect(narrationController.getState().status).toBe('playing');
    expect(narrationController.getState().currentSegmentId).toBe('rf-finding-101-courtroom');
    expect(mockProvider.lastSpokenText).toContain('Courtroom-Style Legal Presentation for Finding 1');
  });

  it('cancels active narration when the user toggles presentation mode', () => {
    const mockFlag = {
      id: 'finding-102',
      severity: 'Worth Raising With Counsel',
      category: 'Hearsay',
      phraseDetected: 'Third party stated that the child missed school.',
      locationInDocument: 'Page 5',
      explanation: 'Uncorroborated third-party hearsay.',
      parentActionStep: 'Request direct worker affidavit.',
    };

    const { getByRole } = render(
      <FindingPresentationCard 
        flag={mockFlag} 
        idx={1} 
        openLegislativeReference={vi.fn()} 
        setSearchQuery={vi.fn()} 
      />
    );

    // Start educational narration
    const listenBtn = getByRole('button', { name: /Listen to Educational Analysis/i });
    fireEvent.click(listenBtn);
    expect(narrationController.getState().status).toBe('playing');

    // Toggle tab to Courtroom Presentation
    const courtroomTabBtn = getByRole('tab', { name: /Courtroom-Style Legal Presentation/i });
    fireEvent.click(courtroomTabBtn);

    // Active narration must be immediately cancelled / stopped
    expect(narrationController.getState().status).toBe('idle');
    expect(mockProvider.isStopped).toBe(true);
  });
});
