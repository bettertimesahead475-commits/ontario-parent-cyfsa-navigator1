import React from 'react';
import { 
  Play, 
  Pause, 
  Square, 
  SkipBack, 
  SkipForward, 
  Volume2, 
  Gauge, 
  X,
  Sparkles
} from 'lucide-react';
import { useNarration } from '../../hooks/useNarration';

export const NarrationBar: React.FC = () => {
  const {
    status,
    currentSegmentId,
    currentSegmentIndex,
    totalSegments,
    playbackRate,
    selectedVoiceName,
    availableVoices,
    pause,
    resume,
    stop,
    next,
    previous,
    setRate,
    setVoice,
    isSpeechSupported,
  } = useNarration();

  if (!isSpeechSupported || status === 'idle') return null;

  const isPlaying = status === 'playing';
  const isPaused = status === 'paused';

  const rates = [0.75, 1.0, 1.25, 1.5];

  return (
    <div
      role="region"
      aria-label="Report Narration Player"
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] w-[94%] max-w-2xl bg-slate-900/95 backdrop-blur-md text-white rounded-2xl shadow-2xl border border-slate-700/80 p-3 sm:p-4 transition-all duration-300 animate-in fade-in slide-in-from-bottom-5 font-sans"
    >
      <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        {/* Left: Indicator & Current Segment Info */}
        <div className="flex items-center gap-3 w-full sm:w-auto min-w-0">
          <div className="w-8 h-8 rounded-xl bg-brand-500/20 text-brand-400 border border-brand-500/30 flex items-center justify-center shrink-0">
            <Volume2 className={`w-4 h-4 ${isPlaying ? 'animate-pulse text-brand-300' : 'text-slate-400'}`} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-wider text-brand-400 flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${isPlaying ? 'bg-emerald-400 animate-ping' : 'bg-amber-400'}`} />
                {isPlaying ? 'Reading Report Aloud' : 'Narration Paused'}
              </span>
              {totalSegments > 1 && (
                <span className="text-[10px] text-slate-400 font-mono">
                  ({currentSegmentIndex + 1} of {totalSegments})
                </span>
              )}
            </div>
            <p 
              className="text-xs font-semibold text-slate-200 truncate mt-0.5" 
              aria-live="polite"
              id="active-narration-label"
            >
              {currentSegmentId ? `Segment: ${currentSegmentId}` : 'Report Content'}
            </p>
          </div>
        </div>

        {/* Center: Playback Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {totalSegments > 1 && (
            <button
              type="button"
              onClick={previous}
              disabled={currentSegmentIndex <= 0}
              title="Previous segment"
              aria-label="Previous segment"
              className="p-1.5 text-slate-300 hover:text-white disabled:text-slate-600 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              <SkipBack className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            onClick={isPlaying ? pause : resume}
            title={isPlaying ? 'Pause narration (Space)' : 'Resume narration (Space)'}
            aria-label={isPlaying ? 'Pause narration' : 'Resume narration'}
            className="px-3.5 py-1.5 bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs rounded-xl transition-all shadow-sm flex items-center gap-1.5 cursor-pointer select-none"
          >
            {isPlaying ? (
              <>
                <Pause className="w-4 h-4" />
                <span>Pause</span>
              </>
            ) : (
              <>
                <Play className="w-4 h-4" />
                <span>Resume</span>
              </>
            )}
          </button>

          {totalSegments > 1 && (
            <button
              type="button"
              onClick={next}
              disabled={currentSegmentIndex >= totalSegments - 1}
              title="Next segment"
              aria-label="Next segment"
              className="p-1.5 text-slate-300 hover:text-white disabled:text-slate-600 hover:bg-slate-800 rounded-lg transition-colors cursor-pointer disabled:cursor-not-allowed"
            >
              <SkipForward className="w-4 h-4" />
            </button>
          )}

          <button
            type="button"
            onClick={stop}
            title="Stop narration (Esc)"
            aria-label="Stop narration"
            className="p-1.5 bg-slate-800 hover:bg-rose-900/50 text-slate-300 hover:text-rose-300 rounded-lg transition-colors cursor-pointer"
          >
            <Square className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Right: Speed & Voice Selectors */}
        <div className="flex items-center gap-2.5 w-full sm:w-auto justify-end border-t sm:border-t-0 border-slate-800 pt-2 sm:pt-0">
          {/* Rate Selector */}
          <div className="flex items-center gap-1 bg-slate-800/80 p-1 rounded-xl border border-slate-700">
            <Gauge className="w-3 h-3 text-slate-400 ml-1" />
            {rates.map(r => (
              <button
                key={r}
                type="button"
                onClick={() => setRate(r)}
                aria-label={`Playback speed ${r} times`}
                className={`px-1.5 py-0.5 text-[10px] font-bold rounded-lg transition-colors ${
                  playbackRate === r
                    ? 'bg-brand-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {r}x
              </button>
            ))}
          </div>

          {/* Voice Selector */}
          {availableVoices.length > 0 && (
            <select
              value={selectedVoiceName || ''}
              onChange={(e) => setVoice(e.target.value)}
              title="Voice selection (Prefers natural Canadian English)"
              aria-label="Voice selection"
              className="bg-slate-800 text-slate-200 text-[10px] rounded-lg px-2 py-1.5 border border-slate-700 outline-none focus:ring-1 focus:ring-brand-500 max-w-[130px] truncate cursor-pointer"
            >
              {availableVoices.slice(0, 8).map(v => (
                <option key={v.name} value={v.name}>
                  {v.isCanadian ? '🇨🇦 ' : ''}{v.name}
                </option>
              ))}
            </select>
          )}

          <button
            type="button"
            onClick={stop}
            title="Close narration bar (Esc)"
            aria-label="Close narration bar"
            className="p-1 text-slate-400 hover:text-white rounded-lg cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
