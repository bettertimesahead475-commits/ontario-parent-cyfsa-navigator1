import React from 'react';
import { Volume2, Pause } from 'lucide-react';
import { useNarration } from '../../hooks/useNarration';
import { extractReportSegments } from '../../utils/narration/reportSegments';

interface FullReportListenButtonProps {
  report: Record<string, any>;
  className?: string;
}

export const FullReportListenButton: React.FC<FullReportListenButtonProps> = ({
  report,
  className = '',
}) => {
  const { status, playFullReport, pause, resume, isSpeechSupported } = useNarration();

  if (!isSpeechSupported || !report) return null;

  const isPlaying = status === 'playing';
  const isPaused = status === 'paused';
  const isActive = status !== 'idle';

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isPlaying) {
      pause();
    } else if (isPaused) {
      resume();
    } else {
      const segments = extractReportSegments(report);
      playFullReport(segments);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title={isPlaying ? 'Pause full report narration' : 'Listen to Full Report Aloud'}
      aria-label={isPlaying ? 'Pause full report narration' : 'Listen to full report aloud from beginning to end'}
      aria-pressed={isPlaying}
      className={`px-3 py-1.5 rounded-lg text-xs font-semibold flex items-center gap-1.5 transition-all cursor-pointer select-none border ${
        isPlaying
          ? 'bg-brand-600 text-white border-brand-600 shadow-sm animate-pulse'
          : isActive
          ? 'bg-brand-50 text-brand-800 border-brand-300'
          : 'bg-white hover:bg-slate-50 text-slate-700 hover:text-slate-900 border-slate-200 shadow-2xs'
      } ${className}`}
    >
      {isPlaying ? (
        <Pause className="w-3.5 h-3.5" />
      ) : (
        <Volume2 className="w-3.5 h-3.5 text-brand-600" />
      )}
      <span>{isPlaying ? 'Pause Full Narration' : isPaused ? 'Resume Full Narration' : 'Listen to Full Report'}</span>
    </button>
  );
};
