// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { narrationController } from './narrationController';
import { TtsProvider, NarrationSegment } from './types';

class MockTtsProvider implements TtsProvider {
  name = 'MockProvider';
  lastSpokenText: string | null = null;
  lastOptions: any = null;
  isPaused = false;
  isStopped = false;

  isSupported() { return true; }
  getVoices() {
    return [
      { name: 'Microsoft Linda', lang: 'en-CA', isCanadian: true, isNaturalOrNeural: true, isDefault: true },
      { name: 'Google US English', lang: 'en-US', isCanadian: false, isNaturalOrNeural: true, isDefault: false },
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
  stop() { this.isStopped = true; }
}

describe('Narration Controller', () => {
  let mockProvider: MockTtsProvider;

  const seg1: NarrationSegment = {
    id: 'seg-1',
    sectionId: 'sec-a',
    label: 'Summary',
    text: 'This is the case summary under CYFSA s. 88.',
  };

  beforeEach(() => {
    mockProvider = new MockTtsProvider();
    narrationController.setProvider(mockProvider);
  });

  it('plays a single segment and updates state to playing', () => {
    narrationController.playSingleSegment(seg1);
    const state = narrationController.getState();

    expect(state.status).toBe('playing');
    expect(state.currentSegmentId).toBe('seg-1');
    expect(state.currentSectionId).toBe('sec-a');
  });

  it('pauses, resumes, and stops narration cleanly', () => {
    narrationController.playSingleSegment(seg1);
    expect(narrationController.getState().status).toBe('playing');

    narrationController.pause();
    expect(narrationController.getState().status).toBe('paused');

    narrationController.resume();
    expect(narrationController.getState().status).toBe('playing');

    narrationController.stop();
    const finalState = narrationController.getState();
    expect(finalState.status).toBe('idle');
    expect(finalState.currentSegmentId).toBeNull();
  });

  it('updates playback rate within valid bounds', () => {
    narrationController.setRate(1.25);
    expect(narrationController.getState().playbackRate).toBe(1.25);

    narrationController.setRate(3.5); // Should clamp to 2.0
    expect(narrationController.getState().playbackRate).toBe(2.0);
  });

  it('automatically stops narration on document switch event', () => {
    narrationController.playSingleSegment(seg1);
    expect(narrationController.getState().status).toBe('playing');

    // Dispatch document change event
    window.dispatchEvent(new CustomEvent('opa-doc-analyzer-file-changed'));
    expect(narrationController.getState().status).toBe('idle');
  });

  it('automatically stops narration on user signout or profile change event', () => {
    narrationController.playSingleSegment(seg1);
    expect(narrationController.getState().status).toBe('playing');

    // Dispatch profile update/signout event
    window.dispatchEvent(new CustomEvent('opa-user-profile-updated'));
    expect(narrationController.getState().status).toBe('idle');
  });
});
