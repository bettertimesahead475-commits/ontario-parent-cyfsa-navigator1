/**
 * CYFSA Navigator — Report Narration Types & Provider Interfaces
 *
 * Designed to provide accessible, natural speech playback for legal reports.
 * Provider-independent architecture: defaults to browser-native SpeechSynthesis
 * (100% on-device / zero network transmission) with hooks ready for optional neural TTS providers.
 */

export type NarrationStatus = 'idle' | 'playing' | 'paused' | 'stopped';

export interface NarrationSegment {
  /** Unique ID for the segment (e.g. "summary-para-1", "rf-rf1", "th-0") */
  id: string;
  /** Section grouping (e.g. "overview", "redFlags", "chronology", "thresholds", "guidance") */
  sectionId: string;
  /** Human-readable accessible label for screen readers and UI status */
  label: string;
  /** The actual displayed report text to read faithfully */
  text: string;
  /** Optional DOM element ID or selector for auto-scroll and visual focus */
  domId?: string;
}

export interface NarrationVoice {
  name: string;
  lang: string;
  isCanadian: boolean;
  isNaturalOrNeural: boolean;
  isDefault: boolean;
}

export interface NarrationState {
  status: NarrationStatus;
  currentSegmentId: string | null;
  currentSectionId: string | null;
  currentSegmentIndex: number;
  totalSegments: number;
  playbackRate: number; // 0.75, 1.0, 1.25, 1.5
  selectedVoiceName: string | null;
  availableVoices: NarrationVoice[];
  isSpeechSupported: boolean;
  error: string | null;
}

export interface TtsSpeakOptions {
  voiceName?: string | null;
  rate?: number;
  onStart?: () => void;
  onEnd?: () => void;
  onPause?: () => void;
  onResume?: () => void;
  onError?: (error: any) => void;
  onBoundary?: (charIndex: number) => void;
}

/**
 * Provider-agnostic text-to-speech engine interface.
 * All implementations must never transmit documents to third parties without consent.
 */
export interface TtsProvider {
  name: string;
  isSupported(): boolean;
  getVoices(): NarrationVoice[];
  speak(text: string, options: TtsSpeakOptions): Promise<void> | void;
  pause(): void;
  resume(): void;
  stop(): void;
}
