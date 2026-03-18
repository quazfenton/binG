'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { sandboxEvents } from '@/lib/sandbox/sandbox-events';

export interface ReasoningChunk {
  id: string;
  content: string;
  timestamp: number;
  isComplete: boolean;
  type: 'thought' | 'reasoning' | 'plan' | 'reflection';
}

export interface UseReasoningStreamOptions {
  sandboxId?: string;
  messageId?: string;
  autoExpand?: boolean;
  maxDisplayedChunks?: number;
}

/**
 * Hook for streaming agent reasoning/thoughts before the main response
 * Captures the agent's inner monologue, planning, and self-reflection
 */
export function useReasoningStream({
  sandboxId,
  messageId,
  autoExpand = false,
  maxDisplayedChunks = 50,
}: UseReasoningStreamOptions = {}) {
  const [reasoningChunks, setReasoningChunks] = useState<ReasoningChunk[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [isExpanded, setIsExpanded] = useState(autoExpand);
  const [hasAdditionalThoughts, setHasAdditionalThoughts] = useState(false);
  const accumulatedReasoningRef = useRef('');
  const chunkIdCounter = useRef(0);

  // Generate unique chunk ID
  const generateChunkId = useCallback(() => {
    return `reasoning_${messageId || sandboxId}_${chunkIdCounter.current++}`;
  }, [messageId, sandboxId]);

  // Process incoming reasoning content
  const processReasoningChunk = useCallback((chunk: string, type: ReasoningChunk['type'] = 'thought') => {
    accumulatedReasoningRef.current += chunk;

    setReasoningChunks(prev => {
      const lastChunk = prev[prev.length - 1];
      
      // If last chunk is not complete, append to it
      if (lastChunk && !lastChunk.isComplete) {
        return [
          ...prev.slice(0, -1),
          {
            ...lastChunk,
            content: lastChunk.content + chunk,
            timestamp: Date.now(),
          },
        ];
      }

      // Create new chunk
      const newChunk: ReasoningChunk = {
        id: generateChunkId(),
        content: chunk,
        timestamp: Date.now(),
        isComplete: false,
        type,
      };

      const newChunks = [...prev, newChunk];
      
      // Limit displayed chunks to prevent memory issues
      if (newChunks.length > maxDisplayedChunks) {
        return newChunks.slice(newChunks.length - maxDisplayedChunks);
      }
      
      return newChunks;
    });

    // Mark that we have additional thoughts to display
    setHasAdditionalThoughts(true);
    setIsStreaming(true);
  }, [generateChunkId, maxDisplayedChunks]);

  // Mark reasoning as complete
  const completeReasoning = useCallback(() => {
    setReasoningChunks(prev => {
      if (prev.length === 0) return prev;
      
      const lastChunk = prev[prev.length - 1];
      if (lastChunk.isComplete) return prev;

      return [
        ...prev.slice(0, -1),
        {
          ...lastChunk,
          isComplete: true,
          timestamp: Date.now(),
        },
      ];
    });
    
    setIsStreaming(false);
  }, []);

  // Clear all reasoning
  const clearReasoning = useCallback(() => {
    setReasoningChunks([]);
    accumulatedReasoningRef.current = '';
    setIsStreaming(false);
    setHasAdditionalThoughts(false);
    chunkIdCounter.current = 0;
  }, []);

  // Listen to sandbox events for reasoning streams
  useEffect(() => {
    if (!sandboxId) return;

    const handleEvent = (event: any) => {
      if (event.type === 'agent:reasoning_start') {
        setIsStreaming(true);
        setHasAdditionalThoughts(true);
      } else if (event.type === 'agent:reasoning_chunk') {
        const { text, type } = event.data || {};
        processReasoningChunk(text, type || 'thought');
      } else if (event.type === 'agent:reasoning_complete') {
        completeReasoning();
      }
    };

    const unsubscribe = sandboxEvents.subscribe(sandboxId, handleEvent);

    return () => {
      unsubscribe();
    };
  }, [sandboxId, processReasoningChunk, completeReasoning]);

  // Get full accumulated reasoning text
  const fullReasoning = accumulatedReasoningRef.current;

  // Get reasoning by type
  const getReasoningByType = useCallback((type: ReasoningChunk['type']) => {
    return reasoningChunks
      .filter(chunk => chunk.type === type)
      .map(chunk => chunk.content)
      .join('');
  }, [reasoningChunks]);

  return {
    reasoningChunks,
    isStreaming,
    isExpanded,
    hasAdditionalThoughts,
    fullReasoning,
    setIsExpanded,
    processReasoningChunk,
    completeReasoning,
    clearReasoning,
    getReasoningByType,
  };
}
