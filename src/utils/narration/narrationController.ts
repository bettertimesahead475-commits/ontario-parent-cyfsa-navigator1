/**
 * CYFSA Navigator — Narration Controller & Queue Coordinator
 *
 * Coordinates playback of report segments, section queues, and full reports.
 * Manages active highlighting, document switching auto-stop, and state subscriptions.
 */

import { NarrationSegment, NarrationState, TtsProvider } from './types';
import { WebSpeechTtsProvider } from './ttsProvider';

type Listener = (state: NarrationState) => void;

export class NarrationController {
  private provider: TtsProvider;
  private queue: NarrationSegment[] = [];
  private activeIndex: number = -1;
  private currentSegment: NarrationSegment | null = null;
  private listeners: Set<Listener> = new Set();

  private state: NarrationState = {
    status: 'idle',
    currentSegmentId: null,
    currentSectionId: null,
    currentSegmentIndex: -1,
    totalSegments: 0,
    playbackRate: 1.0,
    selectedVoiceName: null,
    availableVoices: [],
    isSpeechSupported: false,
    error: null,
  };

  constructor(provider?: TtsProvider) {
    this.provider = provider || new WebSpeechTtsProvider();
    this.state.isSpeechSupported = this.provider.isSupported();
    this.state.availableVoices = this.provider.getVoices();

    // Auto-stop listeners for document changes, auth sign-out, and page navigation
    if (typeof window !== 'undefined') {
      window.addEventListener('opa-doc-analyzer-file-changed', () => this.stop());
      window.addEventListener('opa-user-profile-updated', () => this.stop());
      window.addEventListener('beforeunload', () => this.stop());
      window.addEventListener('keydown', (e) => {
        // Global accessible shortcut: Escape stops active narration
        if (e.key === 'Escape' && this.state.status === 'playing') {
          this.stop();
        }
      });
    }
  }

  setProvider(provider: TtsProvider): void {
    this.stop();
    this.provider = provider;
    this.updateState({
      isSpeechSupported: this.provider.isSupported(),
      availableVoices: this.provider.getVoices(),
    });
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    listener(this.state);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private notify(): void {
    for (const l of this.listeners) {
      try {
        l(this.state);
      } catch (e) {
        console.warn('[Narration] Listener error:', e);
      }
    }
  }

  private updateState(partial: Partial<NarrationState>): void {
    this.state = { ...this.state, ...partial };
    this.notify();
  }

  getState(): NarrationState {
    return this.state;
  }

  setRate(rate: number): void {
    const clamped = Math.max(0.5, Math.min(2.0, rate));
    this.updateState({ playbackRate: clamped });
    // If playing, restart the current segment with the new rate
    if (this.state.status === 'playing' && this.currentSegment) {
      const seg = this.currentSegment;
      this.provider.stop();
      this.playSegmentInternal(seg);
    }
  }

  setVoice(voiceName: string): void {
    this.updateState({ selectedVoiceName: voiceName });
    if (this.state.status === 'playing' && this.currentSegment) {
      const seg = this.currentSegment;
      this.provider.stop();
      this.playSegmentInternal(seg);
    }
  }

  playSingleSegment(segment: NarrationSegment): void {
    this.queue = [segment];
    this.activeIndex = 0;
    this.playSegmentInternal(segment);
  }

  playSection(sectionId: string, segments: NarrationSegment[]): void {
    const sectionSegments = segments.filter(s => s.sectionId === sectionId);
    if (sectionSegments.length === 0) return;
    this.queue = sectionSegments;
    this.activeIndex = 0;
    this.playSegmentInternal(this.queue[0]);
  }

  playFullReport(segments: NarrationSegment[]): void {
    if (!segments || segments.length === 0) return;
    this.queue = segments;
    this.activeIndex = 0;
    this.playSegmentInternal(this.queue[0]);
  }

  private playSegmentInternal(segment: NarrationSegment): void {
    this.currentSegment = segment;
    this.updateState({
      status: 'playing',
      currentSegmentId: segment.id,
      currentSectionId: segment.sectionId,
      currentSegmentIndex: this.activeIndex,
      totalSegments: this.queue.length,
      error: null,
    });

    // Auto-scroll the reading target into view smoothly
    if (typeof document !== 'undefined' && segment.domId) {
      const el = document.getElementById(segment.domId);
      if (el && typeof el.scrollIntoView === 'function') {
        el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }

    this.provider.speak(segment.text, {
      voiceName: this.state.selectedVoiceName,
      rate: this.state.playbackRate,
      onStart: () => {
        this.updateState({ status: 'playing' });
      },
      onEnd: () => {
        this.advanceQueue();
      },
      onError: (err) => {
        console.warn('[Narration] Playback error:', err);
        this.updateState({ error: String(err?.message || err) });
        this.advanceQueue();
      },
    });
  }

  private advanceQueue(): void {
    this.activeIndex++;
    if (this.activeIndex < this.queue.length) {
      const nextSeg = this.queue[this.activeIndex];
      this.playSegmentInternal(nextSeg);
    } else {
      // Completed full queue
      this.stop();
    }
  }

  next(): void {
    if (this.activeIndex + 1 < this.queue.length) {
      this.activeIndex++;
      this.playSegmentInternal(this.queue[this.activeIndex]);
    }
  }

  previous(): void {
    if (this.activeIndex > 0) {
      this.activeIndex--;
      this.playSegmentInternal(this.queue[this.activeIndex]);
    }
  }

  pause(): void {
    if (this.state.status === 'playing') {
      this.provider.pause();
      this.updateState({ status: 'paused' });
    }
  }

  resume(): void {
    if (this.state.status === 'paused') {
      this.provider.resume();
      this.updateState({ status: 'playing' });
    } else if (this.state.status === 'idle' && this.queue.length > 0) {
      this.playSegmentInternal(this.queue[Math.max(0, this.activeIndex)]);
    }
  }

  stop(): void {
    this.provider.stop();
    this.currentSegment = null;
    this.activeIndex = -1;
    this.queue = [];
    this.updateState({
      status: 'idle',
      currentSegmentId: null,
      currentSectionId: null,
      currentSegmentIndex: -1,
      totalSegments: 0,
      error: null,
    });
  }

  togglePlayPause(segment?: NarrationSegment): void {
    if (this.state.status === 'playing') {
      if (segment && segment.id !== this.state.currentSegmentId) {
        this.playSingleSegment(segment);
      } else {
        this.pause();
      }
    } else if (this.state.status === 'paused') {
      if (segment && segment.id !== this.state.currentSegmentId) {
        this.playSingleSegment(segment);
      } else {
        this.resume();
      }
    } else {
      if (segment) {
        this.playSingleSegment(segment);
      } else if (this.queue.length > 0) {
        this.resume();
      }
    }
  }
}

// Global singleton instance for application-wide coordination
export const narrationController = new NarrationController();
