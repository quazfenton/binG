"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { enhancedBufferManager, type StreamState } from '@/lib/streaming/enhanced-buffer-manager';

export interface StreamingDisplayState {
  isStreaming: boolean;
  displayContent: string;
  isAnimating: boolean;
  showLoadingIndicator: boolean;
  progress: number;
  error?: Error;
  sessionId?: string;
}

export interface UseEnhancedStreamingDisplayOptions {
  messageId: string;
  content: string;
  isStreaming: boolean;
  onStreamingComplete?: () => void;
  onError?: (error: Error) => void;
  animationSpeed?: number; // characters per frame
  enableProgressIndicator?: boolean;
}

/**
 * Enhanced streaming display hook that provides smooth progressive rendering
 * with proper loading states and error handling
 */
export function useEnhancedStreamingDisplay({
  messageId,
  content,
  isStreaming,
  onStreamingComplete,
  onError,
  animationSpeed = 2,
  enableProgressIndicator = true
}: UseEnhancedStreamingDisplayOptions) {
  const [state, setState] = useState<StreamingDisplayState>({
    isStreaming: false,
    displayContent: '',
    isAnimating: false,
    showLoadingIndicator: false,
    progress: 0
  });

  const sessionIdRef = useRef<string | null>(null);
  const animationFrameRef = useRef<number>();
  const lastContentRef = useRef<string>('');
  const displayIndexRef = useRef<number>(0);

  // Initialize streaming session when streaming starts
  useEffect(() => {
    if (isStreaming && !sessionIdRef.current) {
      const sessionId = `display-${messageId}-${Date.now()}`;
      sessionIdRef.current = sessionId;
      
      enhancedBufferManager.createSession(sessionId);
      
      setState(prev => ({
        ...prev,
        isStreaming: true,
        sessionId,
        showLoadingIndicator: content.length === 0
      }));
    } else if (!isStreaming && sessionIdRef.current) {
      // Complete the session
      enhancedBufferManager.completeSession(sessionIdRef.current);
      sessionIdRef.current = null;
      
      setState(prev => ({
        ...prev,
        isStreaming: false,
        isAnimating: false,
        showLoadingIndicator: false,
        displayContent: content,
        progress: 100
      }));
    }
  }, [isStreaming, messageId, content]);

  // Process content changes during streaming
  useEffect(() => {
    if (isStreaming && sessionIdRef.current && content !== lastContentRef.current) {
      const newContent = content.slice(lastContentRef.current.length);
      
      if (newContent && enhancedBufferManager.getSessionState(sessionIdRef.current)) {
        // Process the new content chunk
        enhancedBufferManager.processChunk(sessionIdRef.current, newContent, {
          chunkType: 'text',
          isPartial: true
        });
        
        lastContentRef.current = content;
        
        // Hide loading indicator once we have content
        if (state.showLoadingIndicator && content.length > 0) {
          setState(prev => ({ ...prev, showLoadingIndicator: false }));
        }
      }
    }
  }, [content, isStreaming, state.showLoadingIndicator]);

  // Set up buffer manager event listeners
  useEffect(() => {
    const handleRender = ({ sessionId, content: renderContent, isComplete }: any) => {
      if (sessionId === sessionIdRef.current) {
        startProgressiveAnimation(renderContent, isComplete);
      }
    };

    const handleSessionError = ({ sessionId, error }: any) => {
      if (sessionId === sessionIdRef.current) {
        setState(prev => ({ ...prev, error, isStreaming: false, isAnimating: false }));
        onError?.(error);
      }
    };

    const handleSessionCompleted = ({ sessionId }: any) => {
      if (sessionId === sessionIdRef.current) {
        setState(prev => ({ 
          ...prev, 
          isStreaming: false, 
          isAnimating: false,
          progress: 100,
          displayContent: content
        }));
        onStreamingComplete?.();
      }
    };

    enhancedBufferManager.on('render', handleRender);
    enhancedBufferManager.on('session-error', handleSessionError);
    enhancedBufferManager.on('session-completed', handleSessionCompleted);

    return () => {
      enhancedBufferManager.off('render', handleRender);
      enhancedBufferManager.off('session-error', handleSessionError);
      enhancedBufferManager.off('session-completed', handleSessionCompleted);
    };
  }, [content, onError, onStreamingComplete]);

  // Progressive animation function
  const startProgressiveAnimation = useCallback((targetContent: string, isComplete: boolean) => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }

    setState(prev => ({ ...prev, isAnimating: true }));

    const animate = () => {
      const currentIndex = displayIndexRef.current;
      const targetLength = targetContent.length;

      if (currentIndex < targetLength) {
        // Calculate next index based on animation speed
        const nextIndex = Math.min(currentIndex + animationSpeed, targetLength);
        
        // Try to break at word boundaries for better readability
        let adjustedIndex = nextIndex;
        if (nextIndex < targetLength && nextIndex > currentIndex) {
          const char = targetContent[nextIndex];
          const prevChar = targetContent[nextIndex - 1];
          
          // If we're in the middle of a word, continue to the end
          if (char && char !== ' ' && char !== '\n' && prevChar !== ' ') {
            const nextSpace = targetContent.indexOf(' ', nextIndex);
            const nextNewline = targetContent.indexOf('\n', nextIndex);
            const nextBoundary = Math.min(
              nextSpace === -1 ? targetLength : nextSpace,
              nextNewline === -1 ? targetLength : nextNewline
            );
            
            // Don't jump too far ahead
            if (nextBoundary - currentIndex <= animationSpeed * 3) {
              adjustedIndex = nextBoundary;
            }
          }
        }

        displayIndexRef.current = adjustedIndex;
        const displayContent = targetContent.slice(0, adjustedIndex);
        const progress = enableProgressIndicator ? (adjustedIndex / targetLength) * 100 : 0;

        setState(prev => ({
          ...prev,
          displayContent,
          progress
        }));

        animationFrameRef.current = requestAnimationFrame(animate);
      } else {
        // Animation complete
        setState(prev => ({
          ...prev,
          isAnimating: false,
          displayContent: targetContent,
          progress: 100
        }));

        if (isComplete) {
          onStreamingComplete?.();
        }
      }
    };

    animationFrameRef.current = requestAnimationFrame(animate);
  }, [animationSpeed, enableProgressIndicator, onStreamingComplete]);

  // Reset when message changes
  useEffect(() => {
    displayIndexRef.current = 0;
    lastContentRef.current = '';
    
    setState(prev => ({
      ...prev,
      displayContent: isStreaming ? '' : content,
      progress: isStreaming ? 0 : 100,
      isAnimating: false,
      showLoadingIndicator: isStreaming && content.length === 0
    }));
  }, [messageId]);

  // Cleanup on unmount
  useEffect(() => {
    const sessionToDestroy = sessionIdRef.current;
    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (sessionToDestroy && !isStreaming) {
        enhancedBufferManager.destroySession(sessionToDestroy);
      }
    };
  }, [isStreaming]);

  // Manual control functions
  const pauseAnimation = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    setState(prev => ({ ...prev, isAnimating: false }));
  }, []);

  const resumeAnimation = useCallback(() => {
    if (state.displayContent.length < content.length) {
      startProgressiveAnimation(content, !isStreaming);
    }
  }, [state.displayContent.length, content, isStreaming, startProgressiveAnimation]);

  const skipToEnd = useCallback(() => {
    if (animationFrameRef.current) {
      cancelAnimationFrame(animationFrameRef.current);
    }
    
    displayIndexRef.current = content.length;
    setState(prev => ({
      ...prev,
      displayContent: content,
      progress: 100,
      isAnimating: false
    }));
    
    onStreamingComplete?.();
  }, [content, onStreamingComplete]);

  return {
    ...state,
    pauseAnimation,
    resumeAnimation,
    skipToEnd
  };
}