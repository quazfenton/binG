/**
 * Code Service
 *
 * Central service for managing all interactions with the enhanced-code-system.
 * This service acts as a client-side singleton that communicates with the backend
 * API and provides a clean interface for UI components.
 */

import { EventEmitter } from 'events';
import { codeRequestDeduplicator } from './utils/request-deduplicator';
import { getCurrentMode } from './mode-manager';
import type { Message } from '../types/index';

export interface CodeSession {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  progress: number;
  files: { [key: string]: string };
  pendingDiffs: { path: string; diff: string }[];
  error?: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface StartSessionOptions {
  prompt: string;
  selectedFiles?: { [key: string]: string };
  rules?: string[];
  mode?: 'streaming' | 'agentic' | 'hybrid' | 'standard';
  context?: {
    messages?: Message[];
    projectInfo?: any;
  };
}

export interface CodeServiceEvents {
  'session-started': (sessionId: string) => void;
  'progress': (sessionId: string, progress: number, message?: string) => void;
  'session-completed': (sessionId: string, session: CodeSession) => void;
  'session-error': (sessionId: string, error: string) => void;
  'diff-generated': (sessionId: string, diff: { path: string; diff: string }) => void;
}

class CodeServiceClass extends EventEmitter {
  private sessions: Map<string, CodeSession> = new Map();
  private baseUrl = '/api/code';
  private pollingIntervals: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Start a new code generation session with deduplication (mode-aware)
   */
  async startSession(options: StartSessionOptions): Promise<string> {
    try {
      // Check if we're in the correct mode for code operations
      const currentMode = getCurrentMode();
      if (currentMode !== 'code') {
        throw new Error('Code sessions can only be started in Code mode');
      }

      // Validate options before sending
      this.validateStartSessionOptions(options);

      // Use request deduplicator to prevent duplicate session starts
      const requestBody = {
        action: 'start_session',
        mode: currentMode, // Include current mode in request
        ...options,
      };

      const data = await codeRequestDeduplicator.executeRequest(
        this.baseUrl,
        'POST',
        requestBody,
        async (abortController) => {
          const response = await fetch(this.baseUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
            signal: abortController.signal,
          });

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          const result = await response.json();

          if (result.error) {
            throw new Error(result.error);
          }

          return result;
        }
      );

      const sessionId = data.sessionId;
      
      // Check if session already exists (from deduplicated request)
      if (this.sessions.has(sessionId)) {
        console.log('Session already exists from deduplicated request:', sessionId);
        return sessionId;
      }

      const session: CodeSession = {
        id: sessionId,
        status: 'pending',
        progress: 0,
        files: {},
        pendingDiffs: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      };

      this.sessions.set(sessionId, session);
      this.emit('session-started', sessionId);

      // Start polling for updates
      this.pollSessionStatus(sessionId);

      return sessionId;
    } catch (error) {
      console.error('Error starting code session:', error);
      throw error;
    }
  }

  /**
   * Get the current status of a session with deduplication
   */
  async getSessionStatus(sessionId: string): Promise<CodeSession | null> {
    try {
      // Validate sessionId
      if (!sessionId || typeof sessionId !== 'string' || sessionId.trim().length === 0) {
        throw new Error('Session ID is required and must be a non-empty string');
      }

      const requestBody = {
        action: 'get_session_status',
        sessionId,
      };

      const data = await codeRequestDeduplicator.executeRequest(
        this.baseUrl,
        'POST',
        requestBody,
        async (abortController) => {
          const response = await fetch(this.baseUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
            signal: abortController.signal,
          });

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          const result = await response.json();

          if (result.error) {
            throw new Error(result.error);
          }

          return result;
        }
      );

      if (data.session) {
        const session = {
          ...data.session,
          createdAt: new Date(data.session.createdAt),
          updatedAt: new Date(data.session.updatedAt),
        };

        this.sessions.set(sessionId, session);
        return session;
      }

      return null;
    } catch (error) {
      console.error('Error getting session status:', error);
      return null;
    }
  }

  /**
   * Apply pending diffs for a session with deduplication (mode-aware)
   */
  async applyDiffs(sessionId: string, diffPaths?: string[]): Promise<boolean> {
    try {
      // Check if we're in the correct mode for diff operations
      const currentMode = getCurrentMode();
      if (currentMode !== 'code') {
        console.warn('Diff operations are only allowed in Code mode');
        return false;
      }

      // Validate sessionId
      if (!sessionId || typeof sessionId !== 'string' || sessionId.trim().length === 0) {
        throw new Error('Session ID is required and must be a non-empty string');
      }

      // Validate diffPaths if provided
      if (diffPaths && !Array.isArray(diffPaths)) {
        throw new Error('diffPaths must be an array if provided');
      }

      const requestBody = {
        action: 'apply_diffs',
        sessionId,
        diffPaths,
      };

      const data = await codeRequestDeduplicator.executeRequest(
        this.baseUrl,
        'POST',
        requestBody,
        async (abortController) => {
          const response = await fetch(this.baseUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
            signal: abortController.signal,
          });

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          const result = await response.json();

          if (result.error) {
            throw new Error(result.error);
          }

          return result;
        }
      );

      return data.success || false;
    } catch (error) {
      console.error('Error applying diffs:', error);
      return false;
    }
  }

  /**
   * Cancel a running session with deduplication
   */
  async cancelSession(sessionId: string): Promise<boolean> {
    try {
      // Validate sessionId
      if (!sessionId || typeof sessionId !== 'string' || sessionId.trim().length === 0) {
        throw new Error('Session ID is required and must be a non-empty string');
      }

      const requestBody = {
        action: 'cancel_session',
        sessionId,
      };

      const data = await codeRequestDeduplicator.executeRequest(
        this.baseUrl,
        'POST',
        requestBody,
        async (abortController) => {
          const response = await fetch(this.baseUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
            signal: abortController.signal,
          });

          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
          }

          const result = await response.json();
          return result;
        }
      );

      this.sessions.delete(sessionId);
      return data.success || false;
    } catch (error) {
      console.error('Error canceling session:', error);
      return false;
    }
  }

  /**
   * Get all active sessions (mode-aware)
   */
  getActiveSessions(): CodeSession[] {
    const currentMode = getCurrentMode();
    
    // Only return sessions if we're in code mode
    if (currentMode !== 'code') {
      return [];
    }
    
    return Array.from(this.sessions.values()).filter(
      session => session.status === 'pending' || session.status === 'processing'
    );
  }

  /**
   * Get a specific session from local cache
   */
  getSession(sessionId: string): CodeSession | null {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * Clear completed or errored sessions from memory
   */
  clearCompletedSessions(): void {
    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.status === 'completed' || session.status === 'error') {
        this.sessions.delete(sessionId);
      }
    }
  }

  /**
   * Poll session status for updates with duplicate prevention
   */
  private async pollSessionStatus(sessionId: string): Promise<void> {
    // Prevent duplicate polling for the same session
    if (this.pollingIntervals.has(sessionId)) {
      console.log(`Polling already active for session ${sessionId}`);
      return;
    }

    const pollInterval = 2000; // 2 seconds to reduce server load
    let retryCount = 0;
    const maxRetries = 3;

    const poll = async () => {
      try {
        const session = await this.getSessionStatus(sessionId);

        if (!session) {
          console.warn(`Session ${sessionId} not found`);
          this.stopPolling(sessionId);
          return;
        }

        const previousSession = this.sessions.get(sessionId);
        const progressChanged = !previousSession || previousSession.progress !== session.progress;

        // Emit progress updates
        if (progressChanged) {
          this.emit('progress', sessionId, session.progress);
        }

        // Emit diff updates
        if (session.pendingDiffs.length > (previousSession?.pendingDiffs.length || 0)) {
          const newDiffs = session.pendingDiffs.slice(previousSession?.pendingDiffs.length || 0);
          newDiffs.forEach(diff => {
            this.emit('diff-generated', sessionId, diff);
          });
        }

        // Check if session is completed
        if (session.status === 'completed') {
          this.emit('session-completed', sessionId, session);
          this.stopPolling(sessionId);
          return;
        }

        // Check if session errored
        if (session.status === 'error') {
          this.emit('session-error', sessionId, session.error || 'Unknown error');
          this.stopPolling(sessionId);
          return;
        }

        // Continue polling if still processing
        if (session.status === 'pending' || session.status === 'processing') {
          retryCount = 0; // Reset retry count on successful poll
          const timeoutId = setTimeout(poll, pollInterval);
          this.pollingIntervals.set(sessionId, timeoutId);
        } else {
          this.stopPolling(sessionId);
        }
      } catch (error) {
        console.error(`Error polling session ${sessionId}:`, error);
        retryCount++;

        if (retryCount < maxRetries) {
          const timeoutId = setTimeout(poll, pollInterval * retryCount);
          this.pollingIntervals.set(sessionId, timeoutId);
        } else {
          this.emit('session-error', sessionId, 'Failed to poll session status');
          this.stopPolling(sessionId);
        }
      }
    };

    // Start polling
    const initialTimeoutId = setTimeout(poll, pollInterval);
    this.pollingIntervals.set(sessionId, initialTimeoutId);
  }

  /**
   * Stop polling for a specific session
   */
  private stopPolling(sessionId: string): void {
    const timeoutId = this.pollingIntervals.get(sessionId);
    if (timeoutId) {
      clearTimeout(timeoutId);
      this.pollingIntervals.delete(sessionId);
    }
  }

  /**
   * Validate start session options
   */
  private validateStartSessionOptions(options: StartSessionOptions): void {
    if (!options) {
      throw new Error('StartSessionOptions is required');
    }

    if (!options.prompt || typeof options.prompt !== 'string' || options.prompt.trim().length === 0) {
      throw new Error('Prompt is required and must be a non-empty string');
    }

    if (options.selectedFiles && typeof options.selectedFiles !== 'object') {
      throw new Error('selectedFiles must be an object');
    }

    if (options.rules && !Array.isArray(options.rules)) {
      throw new Error('rules must be an array');
    }

    if (options.mode) {
      const validModes = ['streaming', 'agentic', 'hybrid', 'standard'];
      if (!validModes.includes(options.mode)) {
        throw new Error(`Invalid mode: ${options.mode}. Valid modes: ${validModes.join(', ')}`);
      }
    }

    if (options.context && typeof options.context !== 'object') {
      throw new Error('context must be an object');
    }
  }

  /**
   * Enhanced event emitter with proper typing
   */
  on<K extends keyof CodeServiceEvents>(event: K, listener: CodeServiceEvents[K]): this {
    return super.on(event, listener);
  }

  emit<K extends keyof CodeServiceEvents>(
    event: K,
    ...args: Parameters<CodeServiceEvents[K]>
  ): boolean {
    return super.emit(event, ...args);
  }

  off<K extends keyof CodeServiceEvents>(event: K, listener: CodeServiceEvents[K]): this {
    return super.off(event, listener);
  }

  once<K extends keyof CodeServiceEvents>(event: K, listener: CodeServiceEvents[K]): this {
    return super.once(event, listener);
  }
}

// Export singleton instance
export const codeService = new CodeServiceClass();

// Export types for external use
export type { CodeSession, StartSessionOptions };
export default codeService;
