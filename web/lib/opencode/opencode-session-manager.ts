/**
 * OpenCode Session Manager
 * 
 * Provides direct session management via OpenCode server APIs.
 * Bypasses LLM provider layer for native session-based conversations.
 * 
 * Features:
 * - Create/delete sessions
 * - Send prompts with model selection
 * - Inject context without triggering response (noReply mode)
 * - Get session messages
 * - Fork sessions
 * - Revert messages
 * - Get git diffs
 * - Event streaming
 * 
 * Integration with local session manager:
 * - Can sync with lib/session/session-manager for unified session tracking
 * - Supports both OpenCode native sessions and local sessions
 * 
 * @see https://github.com/anomalyco/opencode/blob/dev/packages/web/src/content/docs/server.mdx
 * @see lib/session/session-manager - Local session management
 */

import { createLogger } from '../utils/logger'

const logger = createLogger('OpenCode:SessionManager')

export interface Session {
  id: string
  title?: string
  createdAt?: string
  updatedAt?: string
  parentID?: string
  model?: {
    providerID: string
    modelID: string
  }
}

export interface Message {
  id: string
  sessionID: string
  role: 'user' | 'assistant' | 'system'
  parts: Array<{
    type: 'text' | 'tool' | 'image'
    text?: string
    tool?: any
    image?: string
  }>
  createdAt: string
  completedAt?: string
}

export interface PromptOptions {
  model?: {
    providerID: string
    modelID: string
  }
  agent?: string
  noReply?: boolean
  system?: string
  tools?: string[]
}

export interface OpencodeSessionManagerConfig {
  baseUrl?: string
  hostname?: string
  port?: number
  timeout?: number
}

export class OpencodeSessionManager {
  private baseUrl: string
  private timeout: number
  private sessions: Map<string, Session> = new Map<string, Session>();

  constructor(config: OpencodeSessionManagerConfig = {}) {
    const hostname = config.hostname || process.env.OPENCODE_HOSTNAME || '127.0.0.1'
    const port = config.port || parseInt(process.env.OPENCODE_PORT || '4096')
    this.baseUrl = config.baseUrl || `http://${hostname}:${port}`
    this.timeout = config.timeout || 30000
  }

  /**
   * Create a new session
   * 
   * POST /session
   * Body: { parentID?, title? }
   * 
   * @param title - Optional session title
   * @param parentID - Optional parent session ID for forking
   * @returns Created session
   * 
   * @example
   * ```typescript
   * const session = await sessionManager.createSession('Refactor auth module')
   * ```
   */
  async createSession(title?: string, parentID?: string): Promise<Session> {
    const url = `${this.baseUrl}/session`
    
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.timeout)
      
      const response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          ...(title && { title }),
          ...(parentID && { parentID }),
        }),
      })
      
      clearTimeout(timeoutId)
      
      if (!response.ok) {
        throw new Error(`Failed to create session: ${response.status}`)
      }
      
      const data = await response.json()
      const session = data.data || data
      
      this.sessions.set(session.id, session)
      logger.info(`Created session: ${session.id} (${session.title || 'Untitled'})`)
      
      return session
    } catch (error: any) {
      logger.error('Failed to create session:', error.message)
      throw error
    }
  }

  /**
   * Get session by ID
   * 
   * GET /session/:id
   * 
   * @param sessionId - Session ID
   * @returns Session details
   */
  async getSession(sessionId: string): Promise<Session | null> {
    const cached = this.sessions.get(sessionId)
    if (cached) return cached
    
    const url = `${this.baseUrl}/session/${sessionId}`
    
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.timeout)
      
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
        },
      })
      
      clearTimeout(timeoutId)
      
      if (!response.ok) {
        return null
      }
      
      const data = await response.json()
      const session = data.data || data
      
      this.sessions.set(sessionId, session)
      return session
    } catch (error: any) {
      logger.error(`Failed to get session ${sessionId}:`, error.message)
      return null
    }
  }

  /**
   * List all sessions
   * 
   * GET /session
   * 
   * @returns Array of sessions
   */
  async listSessions(): Promise<Session[]> {
    const url = `${this.baseUrl}/session`
    
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.timeout)
      
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
        },
      })
      
      clearTimeout(timeoutId)
      
      if (!response.ok) {
        return []
      }
      
      const data = await response.json()
      const sessions = data.data || data.sessions || []
      
      sessions.forEach((s: Session) => this.sessions.set(s.id, s))
      
      logger.debug(`Listed ${sessions.length} sessions`)
      
      return sessions
    } catch (error: any) {
      logger.error('Failed to list sessions:', error.message)
      return []
    }
  }

  /**
   * Delete session
   * 
   * DELETE /session/:id
   * 
   * @param sessionId - Session ID to delete
   */
  async deleteSession(sessionId: string): Promise<void> {
    const url = `${this.baseUrl}/session/${sessionId}`
    
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.timeout)
      
      await fetch(url, {
        method: 'DELETE',
        signal: controller.signal,
      })
      
      clearTimeout(timeoutId)
      
      this.sessions.delete(sessionId)
      logger.info(`Deleted session: ${sessionId}`)
    } catch (error: any) {
      logger.error(`Failed to delete session ${sessionId}:`, error.message)
      throw error
    }
  }

  /**
   * Send prompt to session and wait for response
   * 
   * POST /session/:id/message
   * Body: { parts: [{ type: 'text', text: '...' }], model?, agent?, ... }
   * 
   * @param sessionId - Session ID
   * @param message - Message text
   * @param options - Prompt options (model, agent, etc.)
   * @returns Assistant response message
   * 
   * @example
   * ```typescript
   * const result = await sessionManager.sendPrompt(
   *   sessionId,
   *   'Refactor the authentication module to use JWT',
   *   {
   *     model: {
   *       providerID: 'anthropic',
   *       modelID: 'claude-3-5-sonnet-20241022',
   *     },
   *   }
   * )
   * ```
   */
  async sendPrompt(
    sessionId: string,
    message: string,
    options: PromptOptions = {}
  ): Promise<Message> {
    const url = `${this.baseUrl}/session/${sessionId}/message`
    
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.timeout)
      
      const response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          parts: [{ type: 'text', text: message }],
          ...options,
        }),
      })
      
      clearTimeout(timeoutId)
      
      if (!response.ok) {
        throw new Error(`Prompt failed: ${response.status}`)
      }
      
      const data = await response.json()
      const messageData = data.data || data
      
      logger.debug(`Got response for session ${sessionId}`)
      
      return messageData
    } catch (error: any) {
      logger.error(`Prompt failed for session ${sessionId}:`, error.message)
      throw error
    }
  }

  /**
   * Inject context without triggering AI response
   * 
   * POST /session/:id/message
   * Body: { noReply: true, parts: [{ type: 'text', text: '...' }] }
   * 
   * This is useful for:
   * - Adding file context
   * - Setting system instructions
   * - Providing background information
   * 
   * @param sessionId - Session ID
   * @param context - Context text to inject
   * 
   * @example
   * ```typescript
   * await sessionManager.injectContext(
   *   sessionId,
   *   `Current file: src/auth.ts\n${fileContent}`
   * )
   * ```
   */
  async injectContext(sessionId: string, context: string): Promise<void> {
    const url = `${this.baseUrl}/session/${sessionId}/message`
    
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)
      
      await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          noReply: true,
          parts: [{ type: 'text', text: context }],
        }),
      })
      
      clearTimeout(timeoutId)
      
      logger.debug(`Injected context into session ${sessionId}`)
    } catch (error: any) {
      logger.error(`Failed to inject context:`, error.message)
      // Don't throw - context injection is optional
    }
  }

  /**
   * Get session messages
   * 
   * GET /session/:id/message?limit=100
   * 
   * @param sessionId - Session ID
   * @param limit - Max messages to return
   * @returns Array of messages
   */
  async getMessages(sessionId: string, limit: number = 100): Promise<Message[]> {
    const url = `${this.baseUrl}/session/${sessionId}/message?limit=${limit}`
    
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.timeout)
      
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
        },
      })
      
      clearTimeout(timeoutId)
      
      if (!response.ok) {
        return []
      }
      
      const data = await response.json()
      const messages = data.data || data.messages || []
      
      logger.debug(`Got ${messages.length} messages for session ${sessionId}`)
      
      return messages
    } catch (error: any) {
      logger.error(`Failed to get messages:`, error.message)
      return []
    }
  }

  /**
   * Fork session at specific message
   * 
   * POST /session/:id/fork
   * Body: { messageID? }
   * 
   * @param sessionId - Session ID to fork
   * @param messageID - Optional message ID to fork at
   * @returns New forked session
   */
  async forkSession(sessionId: string, messageID?: string): Promise<Session> {
    const url = `${this.baseUrl}/session/${sessionId}/fork`
    
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.timeout)
      
      const response = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json',
        },
        body: JSON.stringify({
          ...(messageID && { messageID }),
        }),
      })
      
      clearTimeout(timeoutId)
      
      if (!response.ok) {
        throw new Error(`Fork failed: ${response.status}`)
      }
      
      const data = await response.json()
      const session = data.data || data
      
      this.sessions.set(session.id, session)
      logger.info(`Forked session ${sessionId} → ${session.id}`)
      
      return session
    } catch (error: any) {
      logger.error(`Failed to fork session:`, error.message)
      throw error
    }
  }

  /**
   * Revert message (undo changes)
   * 
   * POST /session/:id/revert
   * Body: { messageID, partID? }
   * 
   * @param sessionId - Session ID
   * @param messageID - Message ID to revert
   * @param partID - Optional part ID to revert
   */
  async revertMessage(sessionId: string, messageID: string, partID?: string): Promise<void> {
    const url = `${this.baseUrl}/session/${sessionId}/revert`
    
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.timeout)
      
      await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messageID,
          ...(partID && { partID }),
        }),
      })
      
      clearTimeout(timeoutId)
      
      logger.info(`Reverted message ${messageID} in session ${sessionId}`)
    } catch (error: any) {
      logger.error(`Failed to revert message:`, error.message)
      throw error
    }
  }

  /**
   * Get git diff for session
   * 
   * GET /session/:id/diff?messageID={messageID}
   * 
   * @param sessionId - Session ID
   * @param messageID - Optional message ID to get diff for
   * @returns Git diff and worktree state
   */
  async getDiff(sessionId: string, messageID?: string): Promise<{
    diff: string
    worktree: string
  }> {
    const params = new URLSearchParams()
    if (messageID) params.append('messageID', messageID)
    
    const url = `${this.baseUrl}/session/${sessionId}/diff${params.toString() ? `?${params}` : ''}`
    
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.timeout)
      
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
        },
      })
      
      clearTimeout(timeoutId)
      
      if (!response.ok) {
        return { diff: '', worktree: '' }
      }
      
      const data = await response.json()
      const diffData = data.data || data
      
      logger.debug(`Got diff for session ${sessionId}`)
      
      return {
        diff: diffData.diff || '',
        worktree: diffData.worktree || '',
      }
    } catch (error: any) {
      logger.error(`Failed to get diff:`, error.message)
      return { diff: '', worktree: '' }
    }
  }

  /**
   * Abort running session
   * 
   * POST /session/:id/abort
   * 
   * @param sessionId - Session ID to abort
   */
  async abortSession(sessionId: string): Promise<void> {
    const url = `${this.baseUrl}/session/${sessionId}/abort`
    
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), 5000)
      
      await fetch(url, {
        method: 'POST',
        signal: controller.signal,
      })
      
      clearTimeout(timeoutId)
      
      logger.info(`Aborted session: ${sessionId}`)
    } catch (error: any) {
      logger.error(`Failed to abort session:`, error.message)
    }
  }

  /**
   * Get session status
   * 
   * GET /session/status
   * 
   * @returns Status for all sessions
   */
  async getStatus(): Promise<Array<{
    id: string
    status: 'idle' | 'running' | 'completed' | 'error'
    lastActivity?: string
  }>> {
    const url = `${this.baseUrl}/session/status`
    
    try {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), this.timeout)
      
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
        },
      })
      
      clearTimeout(timeoutId)
      
      if (!response.ok) {
        return []
      }
      
      const data = await response.json()
      return data.data || data.status || []
    } catch (error: any) {
      logger.error('Failed to get status:', error.message)
      return []
    }
  }

  /**
   * Clear cached sessions
   */
  clearCache(): void {
    this.sessions.clear()
    logger.debug('Session cache cleared')
  }
}

/**
 * Create session manager instance
 */
export function createOpencodeSessionManager(config?: OpencodeSessionManagerConfig): OpencodeSessionManager {
  return new OpencodeSessionManager(config)
}
