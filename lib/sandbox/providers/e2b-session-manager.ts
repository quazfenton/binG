/**
 * E2B Session Persistence Helpers
 * 
 * Manages session IDs for Claude Code and Codex to enable
 * multi-turn conversations with context persistence.
 * 
 * @see https://e2b.dev/docs/agents/claude-code#resume-a-session
 * @see https://e2b.dev/docs/agents/codex#resume-a-session
 */

import type { SandboxHandle } from './sandbox-provider';
import { generateSecureId } from '@/lib/utils';

/**
 * Session metadata
 */
export interface SessionMetadata {
  /**
   * Session ID
   */
  id: string;
  
  /**
   * Agent type (claude or codex)
   */
  agentType: 'claude' | 'codex';
  
  /**
   * Session created timestamp
   */
  createdAt: number;
  
  /**
   * Last activity timestamp
   */
  lastActivityAt: number;
  
  /**
   * Turn count
   */
  turnCount: number;
  
  /**
   * Session description
   */
  description?: string;
  
  /**
   * Working directory
   */
  workingDir?: string;
}

/**
 * Session execution result
 */
export interface SessionExecutionResult {
  /**
   * Command output
   */
  output: string;
  
  /**
   * Session ID (may change if new session created)
   */
  sessionId: string;
  
  /**
   * Whether session was resumed
   */
  resumed: boolean;
  
  /**
   * Turn count
   */
  turnCount: number;
  
  /**
   * Execution metadata
   */
  metadata?: {
    duration: number;
    exitCode: number;
  };
}

/**
 * E2B Session Manager
 * 
 * Manages AI agent sessions with persistence and context tracking.
 * Enables multi-turn conversations with full context retention.
 * 
 * @example
 * ```typescript
 * const sessionManager = new E2BSessionManager(sandbox);
 * 
 * // Start new session
 * const session = await sessionManager.createSession('claude', {
 *   description: 'Code refactoring session',
 *   workingDir: '/home/user/repo',
 * });
 * 
 * // First turn
 * const result1 = await sessionManager.executeInSession(
 *   session.id,
 *   'Analyze the codebase and create a refactoring plan'
 * );
 * 
 * // Second turn - continues from previous context
 * const result2 = await sessionManager.executeInSession(
 *   session.id,
 *   'Now implement step 1 of the plan'
 * );
 * 
 * // List all sessions
 * const sessions = await sessionManager.listSessions();
 * 
 * // Close session when done
 * await sessionManager.closeSession(session.id);
 * ```
 */
export class E2BSessionManager {
  private sandbox: SandboxHandle;
  private sessions: Map<string, SessionMetadata> = new Map();
  private readonly SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000; // 24 hours

  constructor(sandbox: SandboxHandle) {
    this.sandbox = sandbox;
    
    // Auto-cleanup old sessions periodically
    setInterval(() => {
      this.cleanupExpiredSessions();
    }, 60 * 60 * 1000); // Every hour
  }

  /**
   * Create new session
   * 
   * @param agentType - Agent type (claude or codex)
   * @param options - Session options
   * @returns Session metadata
   */
  async createSession(
    agentType: 'claude' | 'codex',
    options?: {
      description?: string;
      workingDir?: string;
    }
  ): Promise<SessionMetadata> {
    const sessionId = this.generateSessionId();
    
    const metadata: SessionMetadata = {
      id: sessionId,
      agentType,
      createdAt: Date.now(),
      lastActivityAt: Date.now(),
      turnCount: 0,
      description: options?.description,
      workingDir: options?.workingDir,
    };
    
    this.sessions.set(sessionId, metadata);
    
    return metadata;
  }

  /**
   * Execute command in session
   * 
   * @param sessionId - Session ID
   * @param prompt - Prompt for agent
   * @param options - Execution options
   * @returns Execution result
   */
  async executeInSession(
    sessionId: string,
    prompt: string,
    options?: {
      timeout?: number;
      outputFormat?: 'text' | 'json' | 'stream-json';
    }
  ): Promise<SessionExecutionResult> {
    const session = this.sessions.get(sessionId);
    
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }
    
    const startTime = Date.now();
    
    // Build command with session ID
    let command: string;
    const outputFormat = options?.outputFormat || 'text';
    
    if (session.agentType === 'claude') {
      command = `claude --session-id ${sessionId} --output-format ${outputFormat} -p "${prompt.replace(/"/g, '\\"')}"`;
    } else {
      command = `codex exec --session-id ${sessionId} --full-auto -p "${prompt.replace(/"/g, '\\"')}"`;
    }
    
    // Add working directory if specified
    if (session.workingDir) {
      command = `cd ${session.workingDir} && ${command}`;
    }
    
    const result = await this.sandbox.executeCommand(
      command,
      undefined,
      options?.timeout
    );
    
    // Update session metadata
    session.lastActivityAt = Date.now();
    session.turnCount++;
    this.sessions.set(sessionId, session);
    
    // Extract session ID from output if it changed
    let newSessionId = sessionId;
    try {
      if (outputFormat === 'json') {
        const output = JSON.parse(result.output);
        if (output.session_id) {
          newSessionId = output.session_id;
        }
      }
    } catch {
      // Ignore parse errors
    }
    
    return {
      output: result.output,
      sessionId: newSessionId,
      resumed: session.turnCount > 1,
      turnCount: session.turnCount,
      metadata: {
        duration: Date.now() - startTime,
        exitCode: result.exitCode || 0,
      },
    };
  }

  /**
   * Continue session with follow-up task
   * 
   * @param sessionId - Session ID
   * @param prompt - Follow-up prompt
   * @returns Execution result
   */
  async continueSession(
    sessionId: string,
    prompt: string
  ): Promise<SessionExecutionResult> {
    return this.executeInSession(sessionId, prompt);
  }

  /**
   * Get session by ID
   * 
   * @param sessionId - Session ID
   * @returns Session metadata or null
   */
  getSession(sessionId: string): SessionMetadata | null {
    return this.sessions.get(sessionId) || null;
  }

  /**
   * List all sessions
   * 
   * @returns Array of session metadata
   */
  listSessions(): SessionMetadata[] {
    return Array.from(this.sessions.values());
  }

  /**
   * List active sessions (recent activity)
   * 
   * @param maxAgeMs - Maximum age in milliseconds
   * @returns Array of active session metadata
   */
  listActiveSessions(maxAgeMs: number = 60 * 60 * 1000): SessionMetadata[] {
    const now = Date.now();
    return this.sessions
      .values()
      .filter(session => now - session.lastActivityAt < maxAgeMs);
  }

  /**
   * Close session
   * 
   * @param sessionId - Session ID
   */
  async closeSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }

  /**
   * Close all sessions
   */
  async closeAllSessions(): Promise<void> {
    this.sessions.clear();
  }

  /**
   * Get session statistics
   */
  getStats(): {
    totalSessions: number;
    activeSessions: number;
    claudeSessions: number;
    codexSessions: number;
    totalTurns: number;
  } {
    const sessions = Array.from(this.sessions.values());
    const now = Date.now();
    
    return {
      totalSessions: sessions.length,
      activeSessions: sessions.filter(s => now - s.lastActivityAt < 60 * 60 * 1000).length,
      claudeSessions: sessions.filter(s => s.agentType === 'claude').length,
      codexSessions: sessions.filter(s => s.agentType === 'codex').length,
      totalTurns: sessions.reduce((sum, s) => sum + s.turnCount, 0),
    };
  }

  /**
   * Cleanup expired sessions
   */
  private cleanupExpiredSessions(): void {
    const now = Date.now();
    
    for (const [sessionId, session] of this.sessions.entries()) {
      if (now - session.lastActivityAt > this.SESSION_TIMEOUT_MS) {
        this.sessions.delete(sessionId);
        console.log(`[E2BSessionManager] Cleaned up expired session: ${sessionId}`);
      }
    }
  }

  /**
   * Generate session ID
   */
  private generateSessionId(): string {
    return generateSecureId('session');
  }

  /**
   * Export sessions for persistence
   */
  exportSessions(): SessionMetadata[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Import sessions from persistence
   * 
   * @param sessions - Sessions to import
   */
  importSessions(sessions: SessionMetadata[]): void {
    for (const session of sessions) {
      this.sessions.set(session.id, session);
    }
  }
}

/**
 * Create session manager for sandbox
 * 
 * @param sandbox - Sandbox handle
 * @returns Session manager
 */
export function createSessionManager(sandbox: SandboxHandle): E2BSessionManager {
  return new E2BSessionManager(sandbox);
}

/**
 * Quick execute with session persistence
 * 
 * @param sandbox - Sandbox handle
 * @param agentType - Agent type
 * @param prompts - Array of prompts for multi-turn conversation
 * @returns Array of execution results
 */
export async function quickMultiTurnExecute(
  sandbox: SandboxHandle,
  agentType: 'claude' | 'codex',
  prompts: string[]
): Promise<SessionExecutionResult[]> {
  const sessionManager = createSessionManager(sandbox);
  
  // Create session
  const session = await sessionManager.createSession(agentType);
  
  const results: SessionExecutionResult[] = [];
  
  try {
    // Execute each prompt in sequence
    for (const prompt of prompts) {
      const result = await sessionManager.executeInSession(session.id, prompt);
      results.push(result);
    }
  } finally {
    // Cleanup
    await sessionManager.closeSession(session.id);
  }
  
  return results;
}
