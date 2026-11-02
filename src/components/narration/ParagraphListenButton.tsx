import React from 'react';
import { Volume2, Pause, VolumeX } from 'lucide-react';
import { useNarration } from '../../hooks/useNarration';
import { NarrationSegment } from '../../utils/narration/types';

interface ParagraphListenButtonProps {
  segment: NarrationSegment;
  size?: 'sm' | 'md';
  className?: string;
  label?: string;
}

export const ParagraphListenButton: React.FC<ParagraphListenButtonProps> = ({
  segment,
  size = 'sm',
  className = '',
  label,
}) => {
  const { isSegmentPlaying, isSegmentActive, toggleSegment, isSpeechSupported } = useNarration();

  if (!isSpeechSupported) return null;

  const isPlaying = isSegmentPlaying(segment.id);
  const isActive = isSegmentActive(segment.id);
  const accessibleLabel = label || `Listen to ${segment.label || 'this item'}`;

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        toggleSegment(segment);
      }}
      title={isPlaying ? 'Pause reading' : accessibleLabel}
      aria-label={isPlaying ? 'Pause reading' : accessibleLabel}
      aria-pressed={isPlaying}
      className={`inline-flex items-center justify-center rounded-lg transition-all cursor-pointer select-none focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-1 ${
        size === 'sm' ? 'w-6 h-6 p-1 text-xs' : 'w-7 h-7 p-1.5 text-sm'
      } ${
        isPlaying
          ? 'bg-brand-600 text-white shadow-xs animate-pulse ring-1 ring-brand-500'
          : isActive
          ? 'bg-brand-100 text-brand-800 border border-brand-300'
          : 'bg-slate-100 hover:bg-slate-200 text-slate-600 hover:text-slate-900 border border-slate-200/80'
      } ${className}`}
    >
      {isPlaying ? (
        <Pause className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
      ) : (
        <Volume2 className={size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
      )}
    </button>
  );
};
