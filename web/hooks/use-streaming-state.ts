"use client";

import { useState, useEffect, useCallback, useRef } from 'react';
import { enhancedBufferManager, type StreamState } from '@/lib/streaming/enhanced-buffer-manager';

export interface GlobalStreamingState {
  activeSessions: string[];
  sessionStates: Map<string, StreamState>;
  totalActiveStreams: number;
  hasBackpressure: boolean;
  globalError?: Error;
}

export interface UseStreamingStateOptions {
  onSessionComplete?: (sessionId: string) => void;
  onSessionError?: (sessionId: string, error: Error) => void;
  onBackpressureChange?: (active: boolean) => void;
}

/**
 * Global streaming state management hook
 * Provides centralized state management for all streaming sessions
 */
export function useStreamingState(options: UseStreamingStateOptions = {}) {
  const [state, setState] = useState<GlobalStreamingState>({
    activeSessions: [],
    sessionStates: new Map(),
    totalActiveStreams: 0,
    hasBackpressure: false
  });

  const optionsRef = useRef(options);
  optionsRef.current = options;

  // Update global state from buffer manager events
  useEffect(() => {
    const updateGlobalState = () => {
      const activeSessions = enhancedBufferManager.getActiveSessions();
      const sessionStates = new Map<string, StreamState>();
      
      activeSessions.forEach(sessionId => {
        const sessionState = enhancedBufferManager.getSessionState(sessionId);
        if (sessionState) {
          sessionStates.set(sessionId, sessionState);
        }
      });

      const hasBackpressure = Array.from(sessionStates.values())
        .some(state => state.backpressureActive);

      setState(prev => ({
        ...prev,
        activeSessions,
        sessionStates,
        totalActiveStreams: activeSessions.length,
        hasBackpressure
      }));
    };

    const handleSessionCreated = ({ sessionId }: any) => {
      updateGlobalState();
    };

    const handleSessionCompleted = ({ sessionId }: any) => {
      updateGlobalState();
      optionsRef.current.onSessionComplete?.(sessionId);
    };

    const handleSessionError = ({ sessionId, error }: any) => {
      setState(prev => ({ ...prev, globalError: error }));
      updateGlobalState();
      optionsRef.current.onSessionError?.(sessionId, error);
    };

    const handleBackpressure = ({ sessionId, active }: any) => {
      updateGlobalState();
      optionsRef.current.onBackpressureChange?.(active);
    };

    // Register event listeners
    enhancedBufferManager.on('session-created', handleSessionCreated);
    enhancedBufferManager.on('session-completed', handleSessionCompleted);
    enhancedBufferManager.on('session-destroyed', updateGlobalState);
    enhancedBufferManager.on('session-error', handleSessionError);
    enhancedBufferManager.on('backpressure', handleBackpressure);

    // Initial state update
    updateGlobalState();

    return () => {
      enhancedBufferManager.off('session-created', handleSessionCreated);
      enhancedBufferManager.off('session-completed', handleSessionCompleted);
      enhancedBufferManager.off('session-destroyed', updateGlobalState);
      enhancedBufferManager.off('session-error', handleSessionError);
      enhancedBufferManager.off('backpressure', handleBackpressure);
    };
  }, []);

  // Utility functions
  const getSessionState = useCallback((sessionId: string): StreamState | null => {
    return state.sessionStates.get(sessionId) || null;
  }, [state.sessionStates]);

  const isSessionActive = useCallback((sessionId: string): boolean => {
    return state.activeSessions.includes(sessionId);
  }, [state.activeSessions]);

  const pauseSession = useCallback((sessionId: string) => {
    enhancedBufferManager.pauseSession(sessionId);
  }, []);

  const resumeSession = useCallback((sessionId: string) => {
    enhancedBufferManager.resumeSession(sessionId);
  }, []);

  const destroySession = useCallback((sessionId: string) => {
    enhancedBufferManager.destroySession(sessionId);
  }, []);

  const cleanupCompletedSessions = useCallback(() => {
    enhancedBufferManager.cleanup();
  }, []);

  const clearGlobalError = useCallback(() => {
    setState(prev => ({ ...prev, globalError: undefined }));
  }, []);

  return {
    ...state,
    getSessionState,
    isSessionActive,
    pauseSession,
    resumeSession,
    destroySession,
    cleanupCompletedSessions,
    clearGlobalError
  };
}