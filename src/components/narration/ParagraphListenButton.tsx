import React from 'react';
import { Volume2, Pause } from 'lucide-react';
import { useNarration } from '../../hooks/useNarration';
import { NarrationSegment } from '../../utils/narration/types';

export interface ParagraphListenButtonProps {
  segment?: NarrationSegment | null;
  /** Fallback properties if segment object is not passed directly */
  segmentId?: string;
  text?: string;
  label?: string;
  sectionId?: string;
  domId?: string;
  iconOnly?: boolean;
  size?: 'sm' | 'md';
  className?: string;
}

export const ParagraphListenButton: React.FC<ParagraphListenButtonProps> = ({
  segment,
  segmentId,
  text,
  label,
  sectionId,
  domId,
  iconOnly = false,
  size = 'sm',
  className = '',
}) => {
  const { isSegmentPlaying, isSegmentActive, toggleSegment, isSpeechSupported } = useNarration();

  if (!isSpeechSupported) return null;

  // Resolve segment: use segment if provided, else construct from fallback props if sufficient
  const resolvedSegment: NarrationSegment | null = segment ?? (segmentId && text ? {
    id: segmentId,
    sectionId: sectionId || 'general',
    label: label || segmentId,
    text,
    domId,
  } : null);

  // If no valid segment with an id can be resolved, return null to prevent runtime exceptions
  if (!resolvedSegment || !resolvedSegment.id) return null;

  const isPlaying = isSegmentPlaying(resolvedSegment.id);
  const isActive = isSegmentActive(resolvedSegment.id);
  const accessibleLabel = label || resolvedSegment.label || 'Listen to this item';

  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        toggleSegment(resolvedSegment);
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
      {!iconOnly && label && <span className="ml-1.5">{label}</span>}
    </button>
  );
};
