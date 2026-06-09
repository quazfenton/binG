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
 * Caching: suggestions are stored per assistant message ID + content
 * hash. When a new assistant message arrives, prior suggestions are
 * kept (so chips remain visible as the user scrolls up) but marked
 * as non-interactive. We also evict stale entries to bound memory.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
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
const MAX_CACHED_MESSAGES = 50;
const DEBOUNCE_MS = 600;

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

/**
 * Cheap stable 32-bit hash for the dedupe key. Not cryptographic;
 * the goal is only to detect "same content" without re-fetching.
 */
function djb2(str: string): string {
  let h = 5381;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  }
  return (h >>> 0).toString(36);
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
  // Track (id|hash) pairs we've already fetched. This guards against
  // re-fetching when a message id is reused with different content
  // (e.g., the assistant finalised streaming and replaced the
  // placeholder content).
  const fetchedRef = useRef<Set<string>>(new Set());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef<boolean>(true);

  // Pre-compute the last assistant message so the effect's dep array
  // can be a stable primitive (the id + content hash) instead of the
  // full `messages` array. Re-running the effect on every parent render
  // is what caused the original debounce reset / fetch thrash.
  const lastAssistant = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      if (messages[i].role === 'assistant') return messages[i];
    }
    return null;
  }, [messages]);

  const lastText = useMemo(
    () => extractText(lastAssistant).trim(),
    [lastAssistant],
  );
  const lastContentHash = useMemo(() => djb2(lastText), [lastText]);
  const lastAssistantKey = lastAssistant
    ? `${lastAssistant.id}|${lastContentHash}`
    : null;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // Evict stale cache entries. Keep only the N most recent assistant
  // message ids that still appear in `messages`. This bounds memory
  // for very long sessions.
  useEffect(() => {
    setByMessageId((prev) => {
      const knownIds = new Set(
        messages.filter((m) => m.role === 'assistant').map((m) => m.id),
      );
      // Keep entries still present + the most recent N (to avoid
      // dropping the chip the user is currently looking at).
      const entries = Object.entries(prev).sort((a, b) => {
        // Order by position in `messages` (most recent last)
        const ai = messages.findIndex((m) => m.id === a[0]);
        const bi = messages.findIndex((m) => m.id === b[0]);
        return bi - ai;
      });
      const trimmed = entries.slice(0, MAX_CACHED_MESSAGES);
      const next: SuggestionsByMessage = {};
      for (const [id, value] of trimmed) {
        if (knownIds.has(id) || value) next[id] = value;
      }
      // Avoid a re-render if nothing actually changed
      const prevKeys = Object.keys(prev);
      const nextKeys = Object.keys(next);
      if (
        prevKeys.length === nextKeys.length &&
        nextKeys.every((k) => prev[k] === next[k])
      ) {
        return prev;
      }
      return next;
    });
  }, [messages]);

  useEffect(() => {
    if (!lastAssistant || !lastAssistantKey) return;
    if (isLoading || isStreaming) return;
    if (error) return;
    if (hasAutoContinueMarker(lastAssistant)) return;
    if (!lastText) return;
    // Skip if response looks like an error or is suspiciously short (likely incomplete).
    // This prevents wasting a ~100s API call on a failure that returned no useful content.
    const isErrorResponse = /timeout|timed out|error|500|failed|unavailable|rate.limit|quota.exceeded/i.test(lastText);
    const isIncompleteResponse = lastText.length < 20;
    if (isErrorResponse || isIncompleteResponse) return;
    if (fetchedRef.current.has(lastAssistantKey)) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      if (!mountedRef.current) return;
      if (fetchedRef.current.has(lastAssistantKey)) return;
      fetchedRef.current.add(lastAssistantKey);

      const recentUserMessages = messages
        .filter((m) => m.role === 'user')
        .slice(-MAX_RECENT_PROMPTS)
        .map(extractText);

      // Only call suggestions when prior turns produced file edits.
      // Without edits the LLM has nothing to build on and suggestions
      // are generic chitchat waste.
      const hadFileEdits = messages
        .filter((m) => m.role === 'assistant')
        .slice(-3) // check last few turns
        .some((m) => {
          const toolCalls = (m as any).tool_calls as Array<{ name: string }> | undefined;
          if (!toolCalls?.length) return false;
          const EDIT_TOOLS = new Set([
            'write', 'edit', 'create', 'str_replace_edit',
            'notebook_edit', 'file_write', 'filesystem_write',
          ]);
          return toolCalls.some((tc) => EDIT_TOOLS.has(tc.name));
        });

      if (!hadFileEdits) return;

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
            hasFileEdits: hadFileEdits,
          }),
        });

        const payload = await res.json().catch(() => null);
        if (res.ok && payload?.success) {
          const suggestions = Array.isArray(payload?.data?.suggestions)
            ? payload.data.suggestions
            : [];
          if (!mountedRef.current) return;
          setByMessageId((prev) => ({
            ...prev,
            [lastAssistant.id]: suggestions,
          }));
        } else {
          // Allow one retry on transient failure (5xx / network)
          if (!res.ok && res.status >= 500) {
            fetchedRef.current.delete(lastAssistantKey);
          }
        }
      } catch {
        // Network error — allow retry next time the effect fires
        fetchedRef.current.delete(lastAssistantKey);
      } finally {
        if (mountedRef.current) {
          setLoadingForMessageId((cur) => (cur === lastAssistant.id ? null : cur));
        }
      }
    }, DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [lastAssistantKey, isLoading, isStreaming, error]);

  return {
    byMessageId,
    loadingForMessageId,
  };
}
