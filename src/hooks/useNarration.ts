/**
 * CYFSA Navigator — React Hook for Report Narration
 *
 * Subscribes to the global narration controller and exposes accessible
 * narration controls to any report view component.
 */

import { useState, useEffect, useCallback } from 'react';
import { narrationController } from '../utils/narration/narrationController';
import { NarrationSegment, NarrationState } from '../utils/narration/types';

export function useNarration() {
  const [state, setState] = useState<NarrationState>(narrationController.getState());

  useEffect(() => {
    const unsubscribe = narrationController.subscribe((updated) => {
      setState({ ...updated });
    });
    return unsubscribe;
  }, []);

  const playSegment = useCallback((segment: NarrationSegment) => {
    narrationController.playSingleSegment(segment);
  }, []);

  const playSection = useCallback((sectionId: string, segments: NarrationSegment[]) => {
    narrationController.playSection(sectionId, segments);
  }, []);

  const playFullReport = useCallback((segments: NarrationSegment[]) => {
    narrationController.playFullReport(segments);
  }, []);

  const pause = useCallback(() => {
    narrationController.pause();
  }, []);

  const resume = useCallback(() => {
    narrationController.resume();
  }, []);

  const stop = useCallback(() => {
    narrationController.stop();
  }, []);

  const next = useCallback(() => {
    narrationController.next();
  }, []);

  const previous = useCallback(() => {
    narrationController.previous();
  }, []);

  const setRate = useCallback((rate: number) => {
    narrationController.setRate(rate);
  }, []);

  const setVoice = useCallback((voiceName: string) => {
    narrationController.setVoice(voiceName);
  }, []);

  const toggleSegment = useCallback((segment: NarrationSegment) => {
    narrationController.togglePlayPause(segment);
  }, []);

  const isSegmentPlaying = useCallback((segmentId: string) => {
    return state.status === 'playing' && state.currentSegmentId === segmentId;
  }, [state.status, state.currentSegmentId]);

  const isSegmentActive = useCallback((segmentId: string) => {
    return state.currentSegmentId === segmentId;
  }, [state.currentSegmentId]);

  return {
    ...state,
    playSegment,
    playSection,
    playFullReport,
    pause,
    resume,
    stop,
    next,
    previous,
    setRate,
    setVoice,
    toggleSegment,
    isSegmentPlaying,
    isSegmentActive,
  };
}
