/**
 * OpenCode SDK Capability Provider
 * 
 * Integrates OpenCode SDK direct APIs with the capability system.
 * Maps OpenCode server APIs to capability definitions for unified tool routing.
 * 
 * Features:
 * - Maps OpenCode file APIs to file.* capabilities
 * - Maps OpenCode session APIs to session.* capabilities
 * - Maps OpenCode search APIs to repo.* capabilities
 * - Automatic VFS sync on file operations
 * - Unified response format conversion
 * 
 * @see lib/tools/capabilities.ts - Capability definitions
 * @see lib/virtual-filesystem/virtual-filesystem-service.ts - VFS integration
 * @see lib/tools/unified-response-handler.ts - Response formatting
 */

import { createLogger } from '../utils/logger'
import {
  createOpencodeFileService,
  type OpencodeFileService,
} from './opencode-file-service'
import {
  OpencodeSessionManager,
  createOpencodeSessionManager,
  type OpencodeSessionManager as OpencodeSessionManagerType,
} from './opencode-session-manager'
import type { VirtualFilesystemService } from '../virtual-filesystem/virtual-filesystem-service'

const logger = createLogger('OpenCode:CapabilityProvider')

export interface OpencodeCapabilityProviderConfig {
  baseUrl?: string
  hostname?: string
  port?: number
  vfs?: VirtualFilesystemService
  autoSyncVFS?: boolean
}

export interface CapabilityContext {
  userId: string
  conversationId?: string
  [key: string]: any
}

export interface CapabilityResult {
  success: boolean
  data?: any
  error?: string
  metadata?: Record<string, any>
}

export class OpencodeCapabilityProvider {
  readonly id = 'opencode-sdk'
  readonly name = 'OpenCode SDK'
  readonly capabilities = [
    // File capabilities
    'file.read',
    'file.list',
    'file.search',
    'file.search_text',
    'file.search_symbols',
    // Session capabilities
    'session.create',
    'session.prompt',
    'session.inject_context',
    'session.get_messages',
    'session.fork',
    'session.revert',
    'session.get_diff',
    // Repo capabilities
    'repo.search',
    'repo.search_text',
    'repo.search_symbols',
  ]

  private fileService: OpencodeFileService
  private sessionManager: OpencodeSessionManager
  private vfs?: VirtualFilesystemService
  private autoSyncVFS: boolean

  constructor(config: OpencodeCapabilityProviderConfig = {}) {
    this.fileService = createOpencodeFileService(config)
    this.sessionManager = createOpencodeSessionManager(config)
    this.vfs = config.vfs
    this.autoSyncVFS = config.autoSyncVFS ?? true
  }

  /**
   * Execute capability
   */
  async execute(
    capability: string,
    params: Record<string, any>,
    context: CapabilityContext
  ): Promise<CapabilityResult> {
    const startTime = Date.now()

    try {
      logger.debug(`Executing capability: ${capability}`, params)

      let result: any

      // File capabilities
      if (capability === 'file.read') {
        result = await this.executeFileRead(params as { path: string })
      } else if (capability === 'file.list') {
        result = await this.executeFileList(params as { path?: string })
      } else if (capability === 'file.search') {
        result = await this.executeFileSearch(params as { query: string; type?: 'file' | 'directory'; limit?: number })
      } else if (capability === 'file.search_text') {
        result = await this.executeFileSearchText(params as { pattern: string; path?: string; maxResults?: number })
      } else if (capability === 'file.search_symbols') {
        result = await this.executeFileSearchSymbols(params as { query: string })
      }
      // Session capabilities
      else if (capability === 'session.create') {
        result = await this.executeSessionCreate({ title: (params as any).title, parentID: (params as any).parentID })
      } else if (capability === 'session.prompt') {
        result = await this.executeSessionPrompt(params as { sessionId: string; message: string; model?: { providerID: string; modelID: string }; agent?: string; system?: string })
      } else if (capability === 'session.inject_context') {
        result = await this.executeSessionInjectContext(params as { sessionId: string; context: string })
      } else if (capability === 'session.get_messages') {
        result = await this.executeSessionGetMessages(params as { sessionId: string; limit?: number })
      } else if (capability === 'session.fork') {
        result = await this.executeSessionFork(params as { sessionId: string; messageID?: string })
      } else if (capability === 'session.revert') {
        result = await this.executeSessionRevert(params as { sessionId: string; messageID: string; partID?: string })
      } else if (capability === 'session.get_diff') {
        result = await this.executeSessionGetDiff(params as { sessionId: string; messageID?: string })
      }
      // Repo capabilities
      else if (capability === 'repo.search') {
        result = await this.executeRepoSearch(params as { query: string; type?: 'file' | 'directory'; limit?: number })
      } else if (capability === 'repo.search_text') {
        result = await this.executeRepoSearchText(params as { pattern: string; path?: string; maxResults?: number })
      } else if (capability === 'repo.search_symbols') {
        result = await this.executeRepoSearchSymbols(params as { query: string })
      } else {
        throw new Error(`Unknown capability: ${capability}`)
      }

      // Auto-sync to VFS if enabled
      if (this.autoSyncVFS && this.vfs && result.fileChanges) {
        await this.syncFileChangesToVFS(result.fileChanges, context.userId)
      }

      const duration = Date.now() - startTime

      return {
        success: true,
        data: result,
        metadata: {
          provider: this.id,
          capability,
          duration,
        },
      }
    } catch (error: any) {
      logger.error(`Capability execution failed: ${capability}`, error)

      return {
        success: false,
        error: error.message,
        metadata: {
          provider: this.id,
          capability,
          duration: Date.now() - startTime,
        },
      }
    }
  }

  // ============================================================================
  // File Capabilities
  // ============================================================================

  private async executeFileRead(params: { path: string }): Promise<any> {
    const content = await this.fileService.readFile(params.path)
    
    return {
      content,
      path: params.path,
      size: content.length,
    }
  }

  private async executeFileList(params: { path?: string }): Promise<any> {
    const files = await this.fileService.listFiles(params.path || '')
    return { files }
  }

  private async executeFileSearch(params: { query: string; type?: 'file' | 'directory'; limit?: number }): Promise<any> {
    const files = await this.fileService.searchFiles(params.query, {
      type: params.type,
      limit: params.limit || 100,
    })
    return { files }
  }

  private async executeFileSearchText(params: { pattern: string; path?: string; maxResults?: number }): Promise<any> {
    const matches = await this.fileService.searchText(params.pattern, {
      path: params.path,
      maxResults: params.maxResults || 100,
    })
    return { matches }
  }

  private async executeFileSearchSymbols(params: { query: string }): Promise<any> {
    const symbols = await this.fileService.findSymbols(params.query)
    return { symbols }
  }

  // ============================================================================
  // Session Capabilities
  // ============================================================================

  private async executeSessionCreate(params: { title?: string; parentID?: string }): Promise<any> {
    const session = await this.sessionManager.createSession(params.title, params.parentID)
    return { session }
  }

  private async executeSessionPrompt(params: {
    sessionId: string
    message: string
    model?: { providerID: string; modelID: string }
    agent?: string
    system?: string
  }): Promise<any> {
    const result = await this.sessionManager.sendPrompt(
      params.sessionId,
      params.message,
      {
        model: params.model,
        agent: params.agent,
        system: params.system,
      }
    )

    // Extract file changes from response if any
    const fileChanges = this.extractFileChangesFromMessage(result)

    return {
      message: result,
      content: result.parts?.find((p: any) => p.type === 'text')?.text || '',
      fileChanges,
    }
  }

  private async executeSessionInjectContext(params: { sessionId: string; context: string }): Promise<any> {
    await this.sessionManager.injectContext(params.sessionId, params.context)
    return { success: true }
  }

  private async executeSessionGetMessages(params: { sessionId: string; limit?: number }): Promise<any> {
    const messages = await this.sessionManager.getMessages(params.sessionId, params.limit || 100)
    return { messages }
  }

  private async executeSessionFork(params: { sessionId: string; messageID?: string }): Promise<any> {
    const session = await this.sessionManager.forkSession(params.sessionId, params.messageID)
    return { session }
  }

  private async executeSessionRevert(params: { sessionId: string; messageID: string; partID?: string }): Promise<any> {
    await this.sessionManager.revertMessage(params.sessionId, params.messageID, params.partID)
    return { success: true }
  }

  private async executeSessionGetDiff(params: { sessionId: string; messageID?: string }): Promise<any> {
    const diff = await this.sessionManager.getDiff(params.sessionId, params.messageID)
    return {
      diff: diff.diff,
      worktree: diff.worktree,
    }
  }

  // ============================================================================
  // Repo Capabilities (aliases for file search)
  // ============================================================================

  private async executeRepoSearch(params: { query: string; type?: 'file' | 'directory'; limit?: number }): Promise<any> {
    return this.executeFileSearch(params)
  }

  private async executeRepoSearchText(params: { pattern: string; path?: string; maxResults?: number }): Promise<any> {
    return this.executeFileSearchText(params)
  }

  private async executeRepoSearchSymbols(params: { query: string }): Promise<any> {
    return this.executeFileSearchSymbols(params)
  }

  // ============================================================================
  // VFS Integration
  // ============================================================================

  /**
   * Extract file changes from session message
   */
  private extractFileChangesFromMessage(message: any): Array<{
    path: string
    operation: 'write' | 'patch' | 'delete'
    content?: string
  }> {
    const fileChanges: Array<{ path: string; operation: string; content?: string }> = []

    // Look for file changes in message parts
    if (message.parts && Array.isArray(message.parts)) {
      for (const part of message.parts) {
        if (part.type === 'tool' && part.tool?.name === 'write_file') {
          fileChanges.push({
            path: part.tool.args?.path,
            operation: 'write',
            content: part.tool.args?.content,
          })
        } else if (part.type === 'tool' && part.tool?.name === 'edit_file') {
          fileChanges.push({
            path: part.tool.args?.path,
            operation: 'patch',
            content: part.tool.args?.diff,
          })
        } else if (part.type === 'tool' && part.tool?.name === 'delete_file') {
          fileChanges.push({
            path: (part.tool.args as any)?.path || (part.tool.args as any)?.file,
            operation: 'delete' as 'write' | 'patch' | 'delete',
          })
        }
      }
    }

    return fileChanges
  }

  /**
   * Sync file changes to VFS
   */
  private async syncFileChangesToVFS(
    fileChanges: Array<{ path: string; operation: string; content?: string }>,
    ownerId: string
  ): Promise<void> {
    if (!this.vfs) return

    try {
      for (const change of fileChanges) {
        if (change.operation === 'write' || change.operation === 'patch') {
          if (change.content) {
            await this.vfs.writeFile(ownerId, change.path, change.content)
            logger.debug(`Synced file to VFS: ${change.path}`)
          }
        } else if (change.operation === 'delete') {
          await (this.vfs as any).deleteFile(ownerId, change.path)
          logger.debug(`Deleted file from VFS: ${change.path}`)
        }
      }
    } catch (error: any) {
      logger.error('Failed to sync file changes to VFS:', error)
      // Don't throw - VFS sync is optional
    }
  }

  // ============================================================================
  // Health Check
  // ============================================================================

  /**
   * Check provider health
   */
  async healthCheck(): Promise<{ healthy: boolean; version?: string }> {
    return this.fileService.healthCheck()
  }
}

/**
 * Create OpenCode capability provider
 */
export function createOpencodeCapabilityProvider(
  config?: OpencodeCapabilityProviderConfig
): OpencodeCapabilityProvider {
  return new OpencodeCapabilityProvider(config)
}
