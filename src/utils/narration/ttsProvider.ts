/**
 * CYFSA Navigator — Browser SpeechSynthesis TTS Provider
 *
 * Implements TtsProvider using the browser's native Web Speech API.
 * Guarantees zero network transmission of confidential document text.
 * Includes Chrome keepalive workaround for long paragraphs.
 */

import { TtsProvider, NarrationVoice, TtsSpeakOptions } from './types';
import { rankAndFilterVoices } from './voiceSelector';
import { prepareLegalTextForSpeech } from './legalPronunciation';

export class WebSpeechTtsProvider implements TtsProvider {
  readonly name = 'WebSpeech (On-Device / Browser-Native)';
  private cachedVoices: NarrationVoice[] = [];
  private currentUtterance: SpeechSynthesisUtterance | null = null;
  private keepAliveInterval: any = null;

  constructor() {
    this.refreshVoices();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = () => {
        this.refreshVoices();
      };
    }
  }

  isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      'speechSynthesis' in window &&
      'SpeechSynthesisUtterance' in window
    );
  }

  private refreshVoices(): void {
    if (!this.isSupported()) return;
    try {
      const raw = window.speechSynthesis.getVoices();
      if (raw && raw.length > 0) {
        this.cachedVoices = rankAndFilterVoices(raw);
      }
    } catch (e) {
      console.warn('[Narration] Failed to retrieve system voices:', e);
    }
  }

  getVoices(): NarrationVoice[] {
    if (this.cachedVoices.length === 0) {
      this.refreshVoices();
    }
    return this.cachedVoices;
  }

  speak(rawText: string, options: TtsSpeakOptions = {}): void {
    if (!this.isSupported()) {
      options.onError?.(new Error('Speech synthesis is not supported in this browser.'));
      return;
    }

    this.stop(); // Stop any active speech

    const spokenText = prepareLegalTextForSpeech(rawText);
    if (!spokenText.trim()) {
      options.onEnd?.();
      return;
    }

    try {
      const utterance = new SpeechSynthesisUtterance(spokenText);
      this.currentUtterance = utterance;

      // Set playback speed (clamped between 0.5 and 2.0)
      const rate = options.rate ?? 1.0;
      utterance.rate = Math.max(0.5, Math.min(2.0, rate));

      // Resolve voice
      const rawVoices = window.speechSynthesis.getVoices();
      if (options.voiceName) {
        const matching = rawVoices.find(v => v.name === options.voiceName);
        if (matching) utterance.voice = matching;
      } else {
        // Default to highest-ranked Canadian voice
        const ranked = rankAndFilterVoices(rawVoices);
        if (ranked.length > 0) {
          const topVoice = rawVoices.find(v => v.name === ranked[0].name);
          if (topVoice) utterance.voice = topVoice;
        }
      }

      utterance.onstart = () => {
        this.startKeepAlive();
        options.onStart?.();
      };

      utterance.onend = () => {
        this.clearKeepAlive();
        this.currentUtterance = null;
        options.onEnd?.();
      };

      utterance.onerror = (event) => {
        this.clearKeepAlive();
        this.currentUtterance = null;
        // Canceled errors are intentional when stopping or switching
        if (event.error !== 'canceled' && event.error !== 'interrupted') {
          console.warn('[Narration] Utterance error:', event.error);
          options.onError?.(new Error(`Speech synthesis error: ${event.error}`));
        } else {
          options.onEnd?.();
        }
      };

      utterance.onboundary = (event) => {
        options.onBoundary?.(event.charIndex);
      };

      window.speechSynthesis.speak(utterance);
    } catch (err) {
      this.clearKeepAlive();
      this.currentUtterance = null;
      options.onError?.(err);
    }
  }

  pause(): void {
    if (!this.isSupported()) return;
    try {
      window.speechSynthesis.pause();
    } catch (e) {
      console.warn('[Narration] Pause failed:', e);
    }
  }

  resume(): void {
    if (!this.isSupported()) return;
    try {
      window.speechSynthesis.resume();
    } catch (e) {
      console.warn('[Narration] Resume failed:', e);
    }
  }

  stop(): void {
    this.clearKeepAlive();
    if (!this.isSupported()) return;
    try {
      window.speechSynthesis.cancel();
    } catch (e) {
      console.warn('[Narration] Stop failed:', e);
    }
    this.currentUtterance = null;
  }

  /**
   * Workaround for Chrome bug where long speech utterances freeze after ~15s.
   * Periodically pings pause/resume to keep the audio subsystem responsive.
   */
  private startKeepAlive(): void {
    this.clearKeepAlive();
    this.keepAliveInterval = setInterval(() => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window && window.speechSynthesis.speaking) {
        window.speechSynthesis.pause();
        window.speechSynthesis.resume();
      }
    }, 10000);
  }

  private clearKeepAlive(): void {
    if (this.keepAliveInterval) {
      clearInterval(this.keepAliveInterval);
      this.keepAliveInterval = null;
    }
  }
}
