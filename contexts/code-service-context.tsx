"use client";

import React, { createContext, useContext, useReducer, useEffect, useCallback, ReactNode } from 'react';
import { codeService, type CodeSession, type StartSessionOptions } from '../lib/code-service';
import { processResponse, getCurrentMode } from '../lib/mode-manager';
import type { Message } from '../types/index';

// State interface
interface CodeServiceState {
  isProcessing: boolean;
  activeSessions: CodeSession[];
  currentSessionId: string | null;
  currentSession: CodeSession | null;
  pendingDiffs: { path: string; diff: string }[];
  progress: number;
  error: string | null;
  lastSessionResult: {
    files: { [key: string]: string };
    diffs: { path: string; diff: string }[];
  } | null;
}

// Action types
type CodeServiceAction =
  | { type: 'SET_PROCESSING'; payload: boolean }
  | { type: 'SET_CURRENT_SESSION'; payload: string | null }
  | { type: 'UPDATE_SESSION'; payload: CodeSession }
  | { type: 'ADD_SESSION'; payload: CodeSession }
  | { type: 'REMOVE_SESSION'; payload: string }
  | { type: 'SET_PENDING_DIFFS'; payload: { path: string; diff: string }[] }
  | { type: 'ADD_PENDING_DIFF'; payload: { path: string; diff: string } }
  | { type: 'CLEAR_PENDING_DIFFS' }
  | { type: 'SET_PROGRESS'; payload: number }
  | { type: 'SET_ERROR'; payload: string | null }
  | { type: 'SET_LAST_RESULT'; payload: { files: { [key: string]: string }; diffs: { path: string; diff: string }[] } | null }
  | { type: 'RESET_STATE' };

// Context interface
interface CodeServiceContextValue {
  state: CodeServiceState;
  startSession: (options: StartSessionOptions) => Promise<string>;
  cancelSession: (sessionId: string) => Promise<boolean>;
  applyDiffs: (sessionId: string, diffPaths?: string[]) => Promise<boolean>;
  applyAllPendingDiffs: () => Promise<boolean>;
  clearPendingDiffs: () => void;
  getSession: (sessionId: string) => CodeSession | null;
  clearCompletedSessions: () => void;
  resetState: () => void;
}

// Initial state
const initialState: CodeServiceState = {
  isProcessing: false,
  activeSessions: [],
  currentSessionId: null,
  currentSession: null,
  pendingDiffs: [],
  progress: 0,
  error: null,
  lastSessionResult: null,
};

// Reducer
function codeServiceReducer(state: CodeServiceState, action: CodeServiceAction): CodeServiceState {
  switch (action.type) {
    case 'SET_PROCESSING':
      return { ...state, isProcessing: action.payload };

    case 'SET_CURRENT_SESSION':
      const currentSession = action.payload
        ? state.activeSessions.find(s => s.id === action.payload) || null
        : null;
      return {
        ...state,
        currentSessionId: action.payload,
        currentSession
      };

    case 'UPDATE_SESSION': {
      const updatedSessions = state.activeSessions.map(session =>
        session.id === action.payload.id ? action.payload : session
      );
      const currentSession = state.currentSessionId === action.payload.id ? action.payload : state.currentSession;

      return {
        ...state,
        activeSessions: updatedSessions,
        currentSession,
        pendingDiffs: action.payload.pendingDiffs || state.pendingDiffs,
        progress: action.payload.progress || state.progress,
        error: action.payload.status === 'error' ? action.payload.error || 'Unknown error' : state.error,
      };
    }

    case 'ADD_SESSION':
      return {
        ...state,
        activeSessions: [...state.activeSessions, action.payload],
        currentSessionId: action.payload.id,
        currentSession: action.payload,
        isProcessing: true,
        progress: 0,
        error: null,
      };

    case 'REMOVE_SESSION':
      const filteredSessions = state.activeSessions.filter(s => s.id !== action.payload);
      const isCurrentSession = state.currentSessionId === action.payload;

      return {
        ...state,
        activeSessions: filteredSessions,
        currentSessionId: isCurrentSession ? null : state.currentSessionId,
        currentSession: isCurrentSession ? null : state.currentSession,
        isProcessing: isCurrentSession ? false : state.isProcessing,
      };

    case 'SET_PENDING_DIFFS':
      return { ...state, pendingDiffs: action.payload };

    case 'ADD_PENDING_DIFF':
      return {
        ...state,
        pendingDiffs: [...state.pendingDiffs, action.payload]
      };

    case 'CLEAR_PENDING_DIFFS':
      return { ...state, pendingDiffs: [] };

    case 'SET_PROGRESS':
      return { ...state, progress: action.payload };

    case 'SET_ERROR':
      return { ...state, error: action.payload };

    case 'SET_LAST_RESULT':
      return { ...state, lastSessionResult: action.payload };

    case 'RESET_STATE':
      return initialState;

    default:
      return state;
  }
}

// Create context
const CodeServiceContext = createContext<CodeServiceContextValue | null>(null);

// Provider component
interface CodeServiceProviderProps {
  children: ReactNode;
}

export function CodeServiceProvider({ children }: CodeServiceProviderProps) {
  const [state, dispatch] = useReducer(codeServiceReducer, initialState);

  // Event handlers
  useEffect(() => {
    const handleSessionStarted = (sessionId: string) => {
      const session: CodeSession = {
        id: sessionId,
        status: 'pending',
        progress: 0,
        files: {},
        pendingDiffs: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      dispatch({ type: 'ADD_SESSION', payload: session });
    };

    const handleProgress = (sessionId: string, progress: number, message?: string) => {
      dispatch({ type: 'SET_PROGRESS', payload: progress });

      // Update the session if it exists
      const session = codeService.getSession(sessionId);
      if (session) {
        dispatch({ type: 'UPDATE_SESSION', payload: { ...session, progress } });
      }
    };

    const handleSessionCompleted = (sessionId: string, session: CodeSession) => {
      dispatch({ type: 'UPDATE_SESSION', payload: session });
      dispatch({ type: 'SET_PROCESSING', payload: false });
      
      // Only set result if we're in code mode
      if (getCurrentMode() === 'code') {
        dispatch({ type: 'SET_LAST_RESULT', payload: {
          files: session.files,
          diffs: session.pendingDiffs,
        }});
      }
    };

    const handleSessionError = (sessionId: string, error: string) => {
      dispatch({ type: 'SET_ERROR', payload: error });
      dispatch({ type: 'SET_PROCESSING', payload: false });

      const session = codeService.getSession(sessionId);
      if (session) {
        dispatch({ type: 'UPDATE_SESSION', payload: { ...session, status: 'error', error } });
      }
    };

    const handleDiffGenerated = (sessionId: string, diff: { path: string; diff: string }) => {
      dispatch({ type: 'ADD_PENDING_DIFF', payload: diff });
    };

    // Subscribe to events
    codeService.on('session-started', handleSessionStarted);
    codeService.on('progress', handleProgress);
    codeService.on('session-completed', handleSessionCompleted);
    codeService.on('session-error', handleSessionError);
    codeService.on('diff-generated', handleDiffGenerated);

    // Cleanup
    return () => {
      codeService.off('session-started', handleSessionStarted);
      codeService.off('progress', handleProgress);
      codeService.off('session-completed', handleSessionCompleted);
      codeService.off('session-error', handleSessionError);
      codeService.off('diff-generated', handleDiffGenerated);
    };
  }, []);

  // Context value functions
  const startSession = useCallback(async (options: StartSessionOptions): Promise<string> => {
    dispatch({ type: 'SET_ERROR', payload: null });
    dispatch({ type: 'SET_PROCESSING', payload: true });

    try {
      const sessionId = await codeService.startSession(options);
      return sessionId;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to start session';
      dispatch({ type: 'SET_ERROR', payload: errorMessage });
      dispatch({ type: 'SET_PROCESSING', payload: false });
      throw error;
    }
  }, []);

  const cancelSession = useCallback(async (sessionId: string): Promise<boolean> => {
    try {
      const success = await codeService.cancelSession(sessionId);
      if (success) {
        dispatch({ type: 'REMOVE_SESSION', payload: sessionId });
        dispatch({ type: 'SET_PROCESSING', payload: false });
      }
      return success;
    } catch (error) {
      console.error('Error canceling session:', error);
      return false;
    }
  }, []);

  const applyDiffs = useCallback(async (sessionId: string, diffPaths?: string[]): Promise<boolean> => {
    try {
      const success = await codeService.applyDiffs(sessionId, diffPaths);
      if (success) {
        // Remove applied diffs from pending list
        if (diffPaths) {
          const remainingDiffs = state.pendingDiffs.filter(
            diff => !diffPaths.includes(diff.path)
          );
          dispatch({ type: 'SET_PENDING_DIFFS', payload: remainingDiffs });
        } else {
          dispatch({ type: 'CLEAR_PENDING_DIFFS' });
        }
      }
      return success;
    } catch (error) {
      console.error('Error applying diffs:', error);
      return false;
    }
  }, [state.pendingDiffs]);

  const applyAllPendingDiffs = useCallback(async (): Promise<boolean> => {
    if (state.currentSessionId) {
      return applyDiffs(state.currentSessionId);
    }
    return false;
  }, [state.currentSessionId, applyDiffs]);

  const clearPendingDiffs = useCallback(() => {
    dispatch({ type: 'CLEAR_PENDING_DIFFS' });
  }, []);

  const getSession = useCallback((sessionId: string): CodeSession | null => {
    return codeService.getSession(sessionId);
  }, []);

  const clearCompletedSessions = useCallback(() => {
    codeService.clearCompletedSessions();

    // Update local state
    const activeSessions = state.activeSessions.filter(
      session => session.status === 'pending' || session.status === 'processing'
    );

    dispatch({ type: 'SET_PROCESSING', payload: activeSessions.length > 0 });
  }, [state.activeSessions]);

  const resetState = useCallback(() => {
    dispatch({ type: 'RESET_STATE' });
  }, []);

  const contextValue: CodeServiceContextValue = {
    state,
    startSession,
    cancelSession,
    applyDiffs,
    applyAllPendingDiffs,
    clearPendingDiffs,
    getSession,
    clearCompletedSessions,
    resetState,
  };

  return (
    <CodeServiceContext.Provider value={contextValue}>
      {children}
    </CodeServiceContext.Provider>
  );
}

// Hook for using the context
export function useCodeService(): CodeServiceContextValue {
  const context = useContext(CodeServiceContext);
  if (!context) {
    throw new Error('useCodeService must be used within a CodeServiceProvider');
  }
  return context;
}

// Export types
export type { CodeServiceState, CodeServiceContextValue };
