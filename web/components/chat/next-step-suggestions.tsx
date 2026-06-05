'use client';

/**
 * NextStepSuggestions
 *
 * Renders 3 small, semitransparent "next step" chips under a chat
 * message bubble. When clicked, a chip sends its full suggestion
 * text as a new user prompt.
 *
 * Behavior:
 *  - Appears only on the LAST assistant message that meets the
 *    "complete sequence" criteria (see chat-panel wiring).
 *  - Chips remain visible as the user scrolls up, but lose
 *    clickability once any new superseding assistant message
 *    appears below them.
 *  - Hovering a chip reveals the full suggestion text.
 *  - If suggestions fail to load, the component renders nothing.
 */

import { useCallback } from 'react';
import { ArrowRight, Loader2 } from 'lucide-react';

export interface NextStepSuggestionItem {
  label: string;
  fullText: string;
}

interface NextStepSuggestionsProps {
  suggestions: NextStepSuggestionItem[];
  loading?: boolean;
  /** When false, chips are visible but not clickable (e.g., a newer message superseded them). */
  interactive?: boolean;
  /** Called with the full suggestion text when a chip is clicked. */
  onSelect: (fullText: string) => void;
}

export default function NextStepSuggestions({
  suggestions,
  loading = false,
  interactive = true,
  onSelect,
}: NextStepSuggestionsProps) {
  const handleClick = useCallback(
    (item: NextStepSuggestionItem) => {
      if (!interactive) return;
      onSelect(item.fullText);
    },
    [interactive, onSelect],
  );

  if (loading) {
    return (
      <div
        className="flex items-center gap-2 mt-2 ml-1 text-xs text-white/40"
        data-testid="next-step-suggestions-loading"
      >
        <Loader2 className="w-3 h-3 animate-spin" />
        <span>Thinking of next steps…</span>
      </div>
    );
  }

  if (!suggestions || suggestions.length === 0) return null;

  return (
    <div
      className="flex flex-wrap gap-2 mt-3 ml-1"
      data-testid="next-step-suggestions"
    >
      {suggestions.slice(0, 3).map((item, idx) => (
        <button
          key={`${item.label}-${idx}`}
          type="button"
          onClick={() => handleClick(item)}
          disabled={!interactive}
          title={item.fullText}
          className={[
            'group inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full',
            'text-xs text-white/80 border border-white/10',
            'bg-white/5 hover:bg-white/10 hover:border-white/20',
            'transition-all duration-150 ease-out',
            'max-w-[16rem] truncate',
            interactive
              ? 'cursor-pointer'
              : 'cursor-default opacity-50',
          ].join(' ')}
        >
          <span className="truncate">{item.label}</span>
          {interactive && (
            <ArrowRight className="w-3 h-3 opacity-50 group-hover:opacity-100 transition-opacity" />
          )}
        </button>
      ))}
    </div>
  );
}
