import React from 'react';
import { Volume2, Pause } from 'lucide-react';
import { useNarration } from '../../hooks/useNarration';
import { NarrationSegment } from '../../utils/narration/types';
import { extractReportSegments } from '../../utils/narration/reportSegments';

export interface SectionListenButtonProps {
  sectionId: string;
  segments?: NarrationSegment[];
  report?: Record<string, any>;
  sectionTitle?: string;
  label?: string;
  className?: string;
}

export const SectionListenButton: React.FC<SectionListenButtonProps> = ({
  sectionId,
  segments,
  report,
  sectionTitle,
  label,
  className = '',
}) => {
  const { status, currentSectionId, playSection, pause, resume, isSpeechSupported } = useNarration();

  if (!isSpeechSupported) return null;

  // Resolve segments either from segments prop or from report prop
  const allSegments: NarrationSegment[] = Array.isArray(segments) && segments.length > 0
    ? segments
    : report
    ? extractReportSegments(report)
    : [];

  const sectionSegments = allSegments.filter(s => s.sectionId === sectionId);
  if (sectionSegments.length === 0) return null;

  const titleText = sectionTitle || label || 'Section';
  const isCurrentSectionActive = currentSectionId === sectionId && status !== 'idle';
  const isPlaying = isCurrentSectionActive && status === 'playing';

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (isPlaying) {
      pause();
    } else if (isCurrentSectionActive && status === 'paused') {
      resume();
    } else {
      playSection(sectionId, allSegments);
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      title={isPlaying ? `Pause narration of ${titleText}` : `Listen to ${titleText}`}
      aria-label={isPlaying ? `Pause narration of ${titleText}` : `Listen to entire section: ${titleText}`}
      aria-pressed={isPlaying}
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-semibold rounded-lg border transition-all cursor-pointer select-none focus:outline-none focus:ring-2 focus:ring-brand-500 ${
        isPlaying
          ? 'bg-brand-600 border-brand-600 text-white shadow-xs'
          : isCurrentSectionActive
          ? 'bg-brand-50 border-brand-300 text-brand-800'
          : 'bg-white hover:bg-slate-50 border-slate-200 text-slate-700 hover:text-slate-900 shadow-2xs'
      } ${className}`}
    >
      {isPlaying ? (
        <Pause className="w-3.5 h-3.5 animate-pulse" />
      ) : (
        <Volume2 className="w-3.5 h-3.5 text-brand-600" />
      )}
      <span>{isPlaying ? 'Pause Section' : label || 'Listen to Section'}</span>
    </button>
  );
};
