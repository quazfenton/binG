/**
 * Code Mode Context
 * 
 * Provides application-wide access to code mode integration functionality,
 * managing sessions and state across different components.
 */

import React, { createContext, useContext, useCallback, useEffect, useState } from 'react';
import { 
  CodeModeIntegrationService, 
  CodeModeSession, 
  CodeModeFile, 
  CodeModeResponse 
} from '../lib/services/code-mode-integration';

interface CodeModeContextValue {
  // Service instance
  service: CodeModeIntegrationService | null;
  
  // Current state
  currentSession: CodeModeSession | null;
  isProcessing: boolean;
  error: string | null;
  
  // Actions
  initializeService: (config?: any) => void;
  createSession: (files: CodeModeFile[]) => Promise<string>;
  executeCodeTask: (sessionId: string, task: string, rules?: string, selectedFiles?: string[]) => Promise<CodeModeResponse>;
  cancelCurrentSession: () => Promise<void>;
  clearError: () => void;
  
  // Session management
  getSessionInfo: (sessionId: string) => CodeModeSession | null;
  getAllSessions: () => CodeModeSession[];
}

const CodeModeContext = createContext<CodeModeContextValue | null>(null);

interface CodeModeProviderProps {
  children: React.ReactNode;
  config?: {
    maxConcurrentSessions?: number;
    sessionTimeoutMs?: number;
    enableAutoValidation?: boolean;
    enableSafetyChecks?: boolean;
  };
}

export function CodeModeProvider({ children, config }: CodeModeProviderProps) {
  const [service, setService] = useState<CodeModeIntegrationService | null>(null);
  const [currentSession, setCurrentSession] = useState<CodeModeSession | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Map<string, CodeModeSession>>(new Map());

  // Initialize service
  const initializeService = useCallback((serviceConfig?: any) => {
    if (service) {
      service.destroy();
    }

    const newService = new CodeModeIntegrationService({
      ...config,
      ...serviceConfig,
    });

    // Set up event listeners
    newService.on('session_created', (data) => {
      console.log('Session created:', data.sessionId);
    });

    newService.on('session_progress', (data) => {
      setIsProcessing(true);
      // Update session info if it's the current session
      if (currentSession?.id === data.sessionId) {
        const sessionInfo = newService.getSessionInfo(data.sessionId);
        if (sessionInfo) {
          setCurrentSession(sessionInfo);
          setSessions(prev => new Map(prev.set(data.sessionId, sessionInfo)));
        }
      }
    });

    newService.on('session_error', (data) => {
      setError(data.error);
      setIsProcessing(false);
      
      // Update session info
      const sessionInfo = newService.getSessionInfo(data.sessionId);
      if (sessionInfo) {
        setSessions(prev => new Map(prev.set(data.sessionId, sessionInfo)));
        if (currentSession?.id === data.sessionId) {
          setCurrentSession(sessionInfo);
        }
      }
    });

    newService.on('orchestrator_completed', (data) => {
      setIsProcessing(false);
      
      // Update session info
      const sessionInfo = newService.getSessionInfo(data.sessionId);
      if (sessionInfo) {
        setSessions(prev => new Map(prev.set(data.sessionId, sessionInfo)));
        if (currentSession?.id === data.sessionId) {
          setCurrentSession(sessionInfo);
        }
      }
    });

    newService.on('diffs_applied', (data) => {
      setIsProcessing(false);
      console.log('Diffs applied:', data.appliedFiles);
    });

    newService.on('session_cancelled', (data) => {
      setIsProcessing(false);
      if (currentSession?.id === data.sessionId) {
        setCurrentSession(null);
      }
      setSessions(prev => {
        const newSessions = new Map(prev);
        newSessions.delete(data.sessionId);
        return newSessions;
      });
    });

    newService.on('session_expired', (data) => {
      if (currentSession?.id === data.sessionId) {
        setCurrentSession(null);
      }
      setSessions(prev => {
        const newSessions = new Map(prev);
        newSessions.delete(data.sessionId);
        return newSessions;
      });
    });

    setService(newService);
  }, [config, service, currentSession]);

  // Initialize service on mount
  useEffect(() => {
    initializeService();
    
    return () => {
      if (service) {
        service.destroy();
      }
    };
  }, []);

  // Actions
  const createSession = useCallback(async (files: CodeModeFile[]): Promise<string> => {
    if (!service) {
      throw new Error('Code mode service not initialized');
    }

    setError(null);
    setIsProcessing(true);

    try {
      const sessionId = await service.createSession(files);
      const sessionInfo = service.getSessionInfo(sessionId);
      
      if (sessionInfo) {
        setCurrentSession(sessionInfo);
        setSessions(prev => new Map(prev.set(sessionId, sessionInfo)));
      }

      setIsProcessing(false);
      return sessionId;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to create session';
      setError(errorMessage);
      setIsProcessing(false);
      throw err;
    }
  }, [service]);

  const executeCodeTask = useCallback(async (
    sessionId: string,
    task: string,
    rules?: string,
    selectedFiles?: string[]
  ): Promise<CodeModeResponse> => {
    if (!service) {
      throw new Error('Code mode service not initialized');
    }

    setError(null);
    setIsProcessing(true);

    try {
      const response = await service.executeCodeTask(sessionId, task, rules, selectedFiles);
      
      // Update session info
      const sessionInfo = service.getSessionInfo(sessionId);
      if (sessionInfo) {
        setSessions(prev => new Map(prev.set(sessionId, sessionInfo)));
        if (currentSession?.id === sessionId) {
          setCurrentSession(sessionInfo);
        }
      }

      setIsProcessing(false);
      return response;
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to execute code task';
      setError(errorMessage);
      setIsProcessing(false);
      throw err;
    }
  }, [service, currentSession]);

  const cancelCurrentSession = useCallback(async (): Promise<void> => {
    if (!service || !currentSession) {
      return;
    }

    try {
      await service.cancelSession(currentSession.id);
      setCurrentSession(null);
      setIsProcessing(false);
      setSessions(prev => {
        const newSessions = new Map(prev);
        newSessions.delete(currentSession.id);
        return newSessions;
      });
    } catch (err) {
      console.error('Failed to cancel session:', err);
    }
  }, [service, currentSession]);

  const clearError = useCallback(() => {
    setError(null);
  }, []);

  const getSessionInfo = useCallback((sessionId: string): CodeModeSession | null => {
    return sessions.get(sessionId) || null;
  }, [sessions]);

  const getAllSessions = useCallback((): CodeModeSession[] => {
    return Array.from(sessions.values());
  }, [sessions]);

  const contextValue: CodeModeContextValue = {
    service,
    currentSession,
    isProcessing,
    error,
    initializeService,
    createSession,
    executeCodeTask,
    cancelCurrentSession,
    clearError,
    getSessionInfo,
    getAllSessions,
  };

  return (
    <CodeModeContext.Provider value={contextValue}>
      {children}
    </CodeModeContext.Provider>
  );
}

export function useCodeModeContext(): CodeModeContextValue {
  const context = useContext(CodeModeContext);
  if (!context) {
    throw new Error('useCodeModeContext must be used within a CodeModeProvider');
  }
  return context;
}

export default CodeModeContext;