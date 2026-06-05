'use client';

/**
 * useNextStepSuggestions
 *
 * Hook that watches chat messages and triggers a single next-step
 * suggestions fetch when a turn appears to be fully complete.
 *
 * Trigger conditions (all must hold):
 *  - At least one assistant message exists.
 *  - The last message is an assistant message.
 *  - `isStreaming` and `isLoading` are both false (turn finished).
 *  - `error` is null/undefined.
 *  - The last message is NOT currently awaiting more chunks
 *    (i.e., content length > 0 OR it has been finalized).
 *  - No `auto-continue` marker is present in the last message.
 *
 * Caching: suggestions are stored per assistant message ID. When a
 * new assistant message arrives, prior suggestions are kept (so
 * chips remain visible as the user scrolls up) but marked as
 * non-interactive.
 */

import { useEffect, useRef, useState } from 'react';
import type { Message } from '@/types';
import { buildApiHeaders } from '@/lib/utils/utils';

export interface NextStepSuggestionItem {
  label: string;
  fullText: string;
}

interface SuggestionsByMessage {
  [messageId: string]: NextStepSuggestionItem[] | undefined;
}

interface UseNextStepSuggestionsOptions {
  messages: Message[];
  isLoading: boolean;
  isStreaming: boolean;
  error: Error | undefined;
}

const MAX_RECENT_PROMPTS = 2;

function hasAutoContinueMarker(message: Message | undefined): boolean {
  if (!message) return false;
  const content = typeof message.content === 'string' ? message.content : '';
  // Common autocontinue markers used elsewhere in the codebase
  return /\[AUTO_CONTINUE\]|\[ROLE_SELECT\]|auto-continue/i.test(content);
}

function extractText(message: Message | undefined): string {
  if (!message) return '';
  const content: any = message.content;
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((c: any) => (typeof c === 'string' ? c : c?.text || ''))
      .join('');
  }
  return '';
}

export function useNextStepSuggestions({
  messages,
  isLoading,
  isStreaming,
  error,
}: UseNextStepSuggestionsOptions) {
  const [byMessageId, setByMessageId] = useState<SuggestionsByMessage>({});
  const [loadingForMessageId, setLoadingForMessageId] = useState<string | null>(
    null,
  );
  const fetchedRef = useRef<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Find the last assistant message
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    if (!lastAssistant) return;

    // Don't re-fetch for the same message
    if (fetchedRef.current.has(lastAssistant.id)) return;

    // Must be a non-streaming, non-error, no-autocontinue, non-empty turn
    if (isLoading || isStreaming) return;
    if (error) return;
    if (hasAutoContinueMarker(lastAssistant)) return;

    const lastText = extractText(lastAssistant).trim();
    if (!lastText) return;

    // Debounce to avoid rapid fetches on small UI state changes
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (fetchedRef.current.has(lastAssistant.id)) return;
      fetchedRef.current.add(lastAssistant.id);

      const recentUserMessages = messages
        .filter((m) => m.role === 'user')
        .slice(-MAX_RECENT_PROMPTS)
        .map(extractText);

      setLoadingForMessageId(lastAssistant.id);
      try {
        const res = await fetch('/api/chat/next-step-suggestions', {
          method: 'POST',
          headers: buildApiHeaders({ json: true }),
          credentials: 'include',
          body: JSON.stringify({
            recentPrompts: recentUserMessages,
            lastResponse: lastText,
            messageId: lastAssistant.id,
          }),
        });

        const payload = await res.json().catch(() => null);
        if (res.ok && payload?.success) {
          const suggestions = Array.isArray(payload?.data?.suggestions)
            ? payload.data.suggestions
            : [];
          setByMessageId((prev) => ({
            ...prev,
            [lastAssistant.id]: suggestions,
          }));
        }
      } catch {
        // Silent: suggestions are non-essential
      } finally {
        setLoadingForMessageId((cur) => (cur === lastAssistant.id ? null : cur));
      }
    }, 600);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [messages, isLoading, isStreaming, error]);

  return {
    byMessageId,
    loadingForMessageId,
  };
}
