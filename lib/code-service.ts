/**
 * Code Service
 *
 * Central service for managing all interactions with the enhanced-code-system.
 * This service acts as a client-side singleton that communicates with the backend
 * API and provides a clean interface for UI components.
 */

import { EventEmitter } from 'events';
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

  /**
   * Start a new code generation session
   */
  async startSession(options: StartSessionOptions): Promise<string> {
    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'start_session',
          ...options,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      const sessionId = data.sessionId;
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
   * Get the current status of a session
   */
  async getSessionStatus(sessionId: string): Promise<CodeSession | null> {
    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'get_session_status',
          sessionId,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

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
   * Apply pending diffs for a session
   */
  async applyDiffs(sessionId: string, diffPaths?: string[]): Promise<boolean> {
    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'apply_diffs',
          sessionId,
          diffPaths,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();

      if (data.error) {
        throw new Error(data.error);
      }

      return data.success || false;
    } catch (error) {
      console.error('Error applying diffs:', error);
      return false;
    }
  }

  /**
   * Cancel a running session
   */
  async cancelSession(sessionId: string): Promise<boolean> {
    try {
      const response = await fetch(this.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          action: 'cancel_session',
          sessionId,
        }),
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      this.sessions.delete(sessionId);

      return data.success || false;
    } catch (error) {
      console.error('Error canceling session:', error);
      return false;
    }
  }

  /**
   * Get all active sessions
   */
  getActiveSessions(): CodeSession[] {
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
   * Poll session status for updates
   */
  private async pollSessionStatus(sessionId: string): Promise<void> {
    const pollInterval = 1000; // 1 second
    let retryCount = 0;
    const maxRetries = 3;

    const poll = async () => {
      try {
        const session = await this.getSessionStatus(sessionId);

        if (!session) {
          console.warn(`Session ${sessionId} not found`);
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
          return;
        }

        // Check if session errored
        if (session.status === 'error') {
          this.emit('session-error', sessionId, session.error || 'Unknown error');
          return;
        }

        // Continue polling if still processing
        if (session.status === 'pending' || session.status === 'processing') {
          retryCount = 0; // Reset retry count on successful poll
          setTimeout(poll, pollInterval);
        }
      } catch (error) {
        console.error(`Error polling session ${sessionId}:`, error);
        retryCount++;

        if (retryCount < maxRetries) {
          setTimeout(poll, pollInterval * retryCount);
        } else {
          this.emit('session-error', sessionId, 'Failed to poll session status');
        }
      }
    };

    // Start polling
    setTimeout(poll, pollInterval);
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
