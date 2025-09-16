/**
 * React Hook for Code Mode Integration
 * 
 * Provides a React interface for the code mode integration service,
 * managing sessions, requests, and state updates.
 */

import { useState, useEffect, useCallback, useRef } from 'react';
import { getCurrentMode } from '../lib/mode-manager';
import { 
  CodeModeIntegrationService, 
  CodeModeSession, 
  CodeModeFile, 
  CodeModeRequest, 
  CodeModeResponse,
  CodeModeDiff 
} from '../lib/services/code-mode-integration';

export interface UseCodeModeIntegrationOptions {
  autoCleanup?: boolean;
  sessionTimeout?: number;
  enableRealTimeUpdates?: boolean;
}

export interface CodeModeIntegrationState {
  currentSession: CodeModeSession | null;
  isProcessing: boolean;
  error: string | null;
  pendingDiffs: { [filePath: string]: CodeModeDiff[] };
  lastResponse: CodeModeResponse | null;
}

export interface CodeModeIntegrationActions {
  createSession: (files: CodeModeFile[]) => Promise<string>;
  processRequest: (request: CodeModeRequest) => Promise<CodeModeResponse>;
  executeCodeTask: (task: string, rules?: string, selectedFiles?: string[]) => Promise<CodeModeResponse>;
  applyDiffs: (diffs: { [filePath: string]: CodeModeDiff[] }) => Promise<CodeModeResponse>;
  cancelSession: () => Promise<void>;
  clearError: () => void;
  updateSessionFiles: (files: CodeModeFile[]) => Promise<void>;
}

export function useCodeModeIntegration(
  options: UseCodeModeIntegrationOptions = {}
): [CodeModeIntegrationState, CodeModeIntegrationActions] {
  const {
    autoCleanup = true,
    sessionTimeout = 10 * 60 * 1000, // 10 minutes
    enableRealTimeUpdates = true,
  } = options;

  // State
  const [state, setState] = useState<CodeModeIntegrationState>({
    currentSession: null,
    isProcessing: false,
    error: null,
    pendingDiffs: {},
    lastResponse: null,
  });

  // Service instance ref
  const serviceRef = useRef<CodeModeIntegrationService | null>(null);
  const currentSessionIdRef = useRef<string | null>(null);

  // Initialize service
  useEffect(() => {
    if (!serviceRef.current) {
      serviceRef.current = new CodeModeIntegrationService({
        sessionTimeoutMs: sessionTimeout,
        enableAutoValidation: true,
        enableSafetyChecks: true,
      });

      // Set up event listeners if real-time updates are enabled
      if (enableRealTimeUpdates) {
        setupEventListeners(serviceRef.current);
      }
    }

    return () => {
      if (autoCleanup && serviceRef.current) {
        serviceRef.current.destroy();
        serviceRef.current = null;
      }
    };
  }, [sessionTimeout, autoCleanup, enableRealTimeUpdates]);

  // Set up event listeners for real-time updates
  const setupEventListeners = useCallback((service: CodeModeIntegrationService) => {
    const handleSessionProgress = (data: any) => {
      if (data.sessionId === currentSessionIdRef.current) {
        setState(prev => ({
          ...prev,
          currentSession: prev.currentSession ? {
            ...prev.currentSession,
            lastActivity: new Date(),
          } : null,
        }));
      }
    };

    const handleSessionError = (data: any) => {
      if (data.sessionId === currentSessionIdRef.current) {
        setState(prev => ({
          ...prev,
          error: data.error,
          isProcessing: false,
        }));
      }
    };

    const handleDiffsApplied = (data: any) => {
      if (data.sessionId === currentSessionIdRef.current) {
        setState(prev => ({
          ...prev,
          pendingDiffs: {},
          isProcessing: false,
        }));
      }
    };

    const handleSessionCompleted = (data: any) => {
      if (data.sessionId === currentSessionIdRef.current) {
        setState(prev => ({
          ...prev,
          isProcessing: false,
          currentSession: prev.currentSession ? {
            ...prev.currentSession,
            status: 'completed',
            lastActivity: new Date(),
          } : null,
        }));
      }
    };

    service.on('session_progress', handleSessionProgress);
    service.on('session_error', handleSessionError);
    service.on('diffs_applied', handleDiffsApplied);
    service.on('orchestrator_completed', handleSessionCompleted);

    // Cleanup function
    return () => {
      service.off('session_progress', handleSessionProgress);
      service.off('session_error', handleSessionError);
      service.off('diffs_applied', handleDiffsApplied);
      service.off('orchestrator_completed', handleSessionCompleted);
    };
  }, []);

  // Actions
  const createSession = useCallback(async (files: CodeModeFile[]): Promise<string> => {
    if (!serviceRef.current) {
      throw new Error('Code mode integration service not initialized');
    }

    // Check if we're in the correct mode
    const currentMode = getCurrentMode();
    if (currentMode !== 'code') {
      throw new Error('Code mode integration can only be used in Code mode');
    }

    setState(prev => ({ ...prev, isProcessing: true, error: null }));

    try {
      const sessionId = await serviceRef.current.createSession(files);
      currentSessionIdRef.current = sessionId;

      const sessionInfo = serviceRef.current.getSessionInfo(sessionId);
      setState(prev => ({
        ...prev,
        currentSession: sessionInfo,
        isProcessing: false,
        pendingDiffs: {},
        lastResponse: null,
      }));

      return sessionId;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to create session';
      setState(prev => ({
        ...prev,
        error: errorMessage,
        isProcessing: false,
      }));
      throw error;
    }
  }, []);

  const processRequest = useCallback(async (request: CodeModeRequest): Promise<CodeModeResponse> => {
    if (!serviceRef.current || !currentSessionIdRef.current) {
      throw new Error('No active session');
    }

    setState(prev => ({ ...prev, isProcessing: true, error: null }));

    try {
      const response = await serviceRef.current.processRequest(currentSessionIdRef.current, request);
      
      // Update state based on response
      setState(prev => {
        const newState = { ...prev, isProcessing: false, lastResponse: response };
        
        if (response.type === 'diff_preview' && response.diffs) {
          newState.pendingDiffs = response.diffs;
        }
        
        if (response.type === 'error') {
          newState.error = response.message || 'Request failed';
        }

        return newState;
      });

      // Update session info
      const sessionInfo = serviceRef.current.getSessionInfo(currentSessionIdRef.current);
      if (sessionInfo) {
        setState(prev => ({ ...prev, currentSession: sessionInfo }));
      }

      return response;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Request failed';
      setState(prev => ({
        ...prev,
        error: errorMessage,
        isProcessing: false,
      }));
      throw error;
    }
  }, []);

  const executeCodeTask = useCallback(async (
    task: string, 
    rules?: string, 
    selectedFiles?: string[]
  ): Promise<CodeModeResponse> => {
    if (!serviceRef.current || !currentSessionIdRef.current) {
      throw new Error('No active session');
    }

    // Check if we're in the correct mode
    const currentMode = getCurrentMode();
    if (currentMode !== 'code') {
      throw new Error('Code tasks can only be executed in Code mode');
    }

    // Prevent duplicate execution if already processing
    if (state.isProcessing) {
      console.log('Code task already in progress, skipping duplicate request');
      throw new Error('Operation cancelled');
    }

    setState(prev => ({ ...prev, isProcessing: true, error: null }));

    // Set up a safety timeout to prevent stuck processing states
    const safetyTimeout = setTimeout(() => {
      console.warn('Code task execution taking too long, resetting processing state');
      setState(prev => ({ 
        ...prev, 
        isProcessing: false, 
        error: 'Request timed out - please try again' 
      }));
    }, 150000); // 2.5 minute safety timeout

    try {
      const response = await serviceRef.current.executeCodeTask(
        currentSessionIdRef.current,
        task,
        rules,
        selectedFiles
      );

      clearTimeout(safetyTimeout);

      setState(prev => {
        const newState = { ...prev, isProcessing: false, lastResponse: response };
        
        if (response.type === 'diff_preview' && response.diffs) {
          newState.pendingDiffs = response.diffs;
        }
        
        if (response.type === 'error') {
          newState.error = response.message || 'Code task failed';
        }

        return newState;
      });

      // Update session info
      const sessionInfo = serviceRef.current.getSessionInfo(currentSessionIdRef.current);
      if (sessionInfo) {
        setState(prev => ({ ...prev, currentSession: sessionInfo }));
      }

      return response;
    } catch (error) {
      clearTimeout(safetyTimeout);
      
      const errorMessage = error instanceof Error ? error.message : 'Code task execution failed';
      setState(prev => ({
        ...prev,
        error: errorMessage,
        isProcessing: false,
      }));
      throw error;
    }
  }, [state.isProcessing]);

  const applyDiffs = useCallback(async (diffs: { [filePath: string]: CodeModeDiff[] }): Promise<CodeModeResponse> => {
    if (!serviceRef.current || !currentSessionIdRef.current) {
      throw new Error('No active session');
    }

    // Check if we're in the correct mode
    const currentMode = getCurrentMode();
    if (currentMode !== 'code') {
      console.warn('Diff operations are only allowed in Code mode');
      return { success: false, message: 'Diff operations are only allowed in Code mode' };
    }

    setState(prev => ({ ...prev, isProcessing: true, error: null }));

    try {
      const response = await serviceRef.current.applyDiffs(currentSessionIdRef.current, diffs);

      setState(prev => ({
        ...prev,
        isProcessing: false,
        lastResponse: response,
        pendingDiffs: response.success ? {} : prev.pendingDiffs,
        error: response.success ? null : (response.message || 'Failed to apply diffs'),
      }));

      // Update session info
      const sessionInfo = serviceRef.current.getSessionInfo(currentSessionIdRef.current);
      if (sessionInfo) {
        setState(prev => ({ ...prev, currentSession: sessionInfo }));
      }

      return response;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Failed to apply diffs';
      setState(prev => ({
        ...prev,
        error: errorMessage,
        isProcessing: false,
      }));
      throw error;
    }
  }, []);

  const cancelSession = useCallback(async (): Promise<void> => {
    if (!serviceRef.current || !currentSessionIdRef.current) {
      return;
    }

    // Immediately reset processing state to prevent UI from being stuck
    setState(prev => ({
      ...prev,
      isProcessing: false,
      error: null,
    }));

    try {
      await serviceRef.current.cancelSession(currentSessionIdRef.current);
      
      setState(prev => ({
        ...prev,
        currentSession: prev.currentSession ? {
          ...prev.currentSession,
          status: 'cancelled',
        } : null,
        pendingDiffs: {},
      }));

      currentSessionIdRef.current = null;
    } catch (error) {
      console.error('Failed to cancel session:', error);
      // Even if cancellation fails, ensure state is reset
      setState(prev => ({
        ...prev,
        isProcessing: false,
        error: 'Session cancellation failed, but state has been reset',
        currentSession: null,
        pendingDiffs: {},
      }));
      currentSessionIdRef.current = null;
    }
  }, []);

  const clearError = useCallback(() => {
    setState(prev => ({ 
      ...prev, 
      error: null,
      // Also reset processing state if it's stuck
      isProcessing: false 
    }));
  }, []);

  const updateSessionFiles = useCallback(async (files: CodeModeFile[]): Promise<void> => {
    if (!serviceRef.current || !currentSessionIdRef.current) {
      return;
    }

    try {
      const success = await serviceRef.current.updateSessionFiles(currentSessionIdRef.current, files);
      
      if (success) {
        setState(prev => ({
          ...prev,
          currentSession: prev.currentSession ? {
            ...prev.currentSession,
            files: [...files],
            lastActivity: new Date(),
          } : null,
        }));
      }
    } catch (error) {
      console.error('Failed to update session files:', error);
    }
  }, []);

  const actions: CodeModeIntegrationActions = {
    createSession,
    processRequest,
    executeCodeTask,
    applyDiffs,
    cancelSession,
    clearError,
    updateSessionFiles,
  };

  return [state, actions];
}

export default useCodeModeIntegration;