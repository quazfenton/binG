/**
 * Terminal Panel Handler Wiring Utility
 * 
 * Provides wiring utilities to connect TerminalPanel.tsx to the new handlers.
 * This file helps migrate inline TerminalPanel functions to use handlers.
 * 
 * Usage:
 * ```typescript
 * // In TerminalPanel.tsx
 * import { wireTerminalHandlers } from '@/lib/sandbox/terminal-handler-wiring'
 * 
 * // In createTerminal():
 * const handlers = wireTerminalHandlers({
 *   terminalId: id,
 *   filesystemScopePath: filesystemScopePathRef.current,
 *   syncFileToVFS,
 *   getLocalFileSystem: () => localFileSystemRef.current,
 *   setLocalFileSystem: (fs) => { localFileSystemRef.current = fs },
 *   // ... other config
 * })
 * 
 * terminalHandlersRef.current[id] = handlers
 * ```
 */

import { createTerminalLocalFSHandler } from './terminal-local-fs-handler'
import { createTerminalInputHandler } from './terminal-input-handler'
import { createTerminalEditorHandler } from './terminal-editor-handler'
import { createSandboxConnectionManager } from './sandbox-connection-manager'
import { createTerminalInputBatcher } from './terminal-input-batcher'
import { createTerminalHealthMonitor } from './terminal-health-monitor'
import { createTerminalStateManager } from './terminal-state-manager'
import { createTerminalUIManager } from './terminal-ui-manager'

export interface TerminalHandlerWiringConfig {
  // Terminal identification
  terminalId: string
  
  // Filesystem
  filesystemScopePath?: string
  getLocalFileSystem: () => Record<string, any>
  setLocalFileSystem: (fs: Record<string, any>) => void
  syncFileToVFS: (filePath: string, content: string) => Promise<void>
  
  // Command execution
  executeCommand: (terminalId: string, command: string, write: (text: string) => void, isPtyMode: boolean, mode: string) => Promise<boolean>
  
  // UI callbacks
  write: (text: string) => void
  writeLine: (text: string) => void
  getPrompt: (mode: string, cwd: string) => string
  getCwd: (terminalId: string) => string
  setCwd: (terminalId: string, cwd: string) => void
  updateTerminalState: (terminalId: string, updates: any) => void
  
  // Connection
  sendInput: (sessionId: string, data: string) => void
  sendResize: (sessionId: string, cols: number, rows: number) => void
  getAuthToken: () => string | null
  getAuthHeaders: () => Record<string, string>
  getAnonymousSessionId: () => string | null
  toSandboxScopedPath: (scopePath: string, sandboxId: string) => string
  
  // Terminal state
  getCommandHistory: (terminalId: string) => string[]
  setCommandHistory: (terminalId: string, history: string[]) => void
  saveTerminalSession: (session: any) => void
  getSandboxStatus: () => string
  setSandboxStatus: (status: string) => void
  connectTerminal: (terminalId: string) => Promise<void>
  
  // UI management
  getTerminals: () => any[]
  getActiveTerminalId: () => string | null
  onContextMenu?: (x: number, y: number, terminalId: string) => void
  onClose?: () => void
  onMinimize?: () => void
  onOpenEditor?: (filePath: string, editorType: 'nano' | 'vim' | 'vi') => void
}

export interface TerminalHandlers {
  localFS: ReturnType<typeof createTerminalLocalFSHandler>
  input: ReturnType<typeof createTerminalInputHandler>
  editor: ReturnType<typeof createTerminalEditorHandler>
  connection: ReturnType<typeof createSandboxConnectionManager>
  batcher: ReturnType<typeof createTerminalInputBatcher>
  health: ReturnType<typeof createTerminalHealthMonitor>
  state: ReturnType<typeof createTerminalStateManager>
  ui: ReturnType<typeof createTerminalUIManager>
}

/**
 * Wire up all terminal handlers for a terminal instance
 */
export function wireTerminalHandlers(config: TerminalHandlerWiringConfig): TerminalHandlers {
  // Create SINGLE editor handler instance - used by both localFS and terminal
  const editorHandler = createTerminalEditorHandler({
    terminalId: config.terminalId,
    filePath: '',
    content: '',
    write: config.write,
    writeLine: config.writeLine,
    getPrompt: (cwd) => config.getPrompt('editor', cwd),
    syncToVFS: config.syncFileToVFS,
    updateTerminalState: (updates) => config.updateTerminalState(config.terminalId, updates),
    getCwd: () => config.getCwd(config.terminalId),
    getFileSystem: config.getLocalFileSystem,
    setFileSystem: config.setLocalFileSystem,
  })

  return {
    // Local filesystem handler - uses the SAME editor handler
    localFS: createTerminalLocalFSHandler({
      terminalId: config.terminalId,
      filesystemScopePath: config.filesystemScopePath,
      syncToVFS: config.syncFileToVFS,
      getLocalFileSystem: config.getLocalFileSystem,
      setLocalFileSystem: config.setLocalFileSystem,
      onWrite: config.write,
      onWriteLine: config.writeLine,
      onWriteError: config.writeLine,
      onOpenEditor: (filePath, editorType) => {
        // Open file in the SHARED editor handler
        editorHandler.openFile(filePath, editorType)
      },
    }),

    // Input handler
    input: createTerminalInputHandler({
      terminalId: config.terminalId,
      getFileSystem: config.getLocalFileSystem,
      getCwd: () => config.getCwd(config.terminalId),
      getCommandHistory: () => config.getCommandHistory(config.terminalId),
      setCommandHistory: (history) => config.setCommandHistory(config.terminalId, history),
      executeCommand: async (command) => {
        await config.executeCommand(config.terminalId, command, config.write, false, 'local')
      },
      write: config.write,
      writeLine: config.writeLine,
      getPrompt: (cwd) => config.getPrompt('local', cwd),
    }),

    // Editor handler - use the SAME instance
    editor: editorHandler,

    // Connection manager
    connection: createSandboxConnectionManager({
      terminalId: config.terminalId,
      write: config.write,
      writeLine: config.writeLine,
      updateTerminalState: (updates) => config.updateTerminalState(config.terminalId, updates),
      sendResize: config.sendResize,
      sendInput: config.sendInput,
      getPrompt: config.getPrompt,
      getCwd: () => config.getCwd(config.terminalId),
      setCwd: (cwd) => config.setCwd(config.terminalId, cwd),
      getAuthToken: config.getAuthToken,
      getAuthHeaders: config.getAuthHeaders,
      toSandboxScopedPath: config.toSandboxScopedPath,
      filesystemScopePath: config.filesystemScopePath,
      getAnonymousSessionId: config.getAnonymousSessionId,
    }),

    // Input batcher
    batcher: createTerminalInputBatcher({
      terminalId: config.terminalId,
      sendInput: config.sendInput,
      sendResize: config.sendResize,
    }),

    // Health monitor
    health: createTerminalHealthMonitor({
      getTerminals: config.getTerminals,
      updateTerminalState: (terminalId, updates) => config.updateTerminalState(terminalId, updates),
      writeLine: (terminalId, text) => {
        const term = config.getTerminals().find(t => t.id === terminalId)
        term?.terminal?.write(text + '\r\n')
      },
    }),

    // State manager
    state: createTerminalStateManager({
      getCommandHistory: () => ({ [config.terminalId]: config.getCommandHistory(config.terminalId) }),
      getSandboxStatus: config.getSandboxStatus,
      restoreCommandHistory: (history) => config.setCommandHistory(config.terminalId, history[config.terminalId] || []),
      restoreSandboxStatus: (status) => config.setSandboxStatus(status),
    }),

    // UI manager
    ui: createTerminalUIManager({
      getTerminals: config.getTerminals,
      getActiveTerminalId: config.getActiveTerminalId,
      getSandboxStatus: config.getSandboxStatus,
      setSandboxStatus: config.setSandboxStatus,
      connectTerminal: config.connectTerminal,
      copyOutput: async () => { /* Implement copy */ },
      pasteFromClipboard: async () => { /* Implement paste */ },
      selectAll: () => { /* Implement select all */ },
      clearTerminal: (terminalId) => { /* Implement clear */ },
      killAllTerminals: async () => { /* Implement kill all */ },
      saveTerminalSession: config.saveTerminalSession,
      getCommandHistory: (terminalId) => config.getCommandHistory(terminalId),
      onContextMenu: config.onContextMenu,
      onClose: config.onClose,
      onMinimize: config.onMinimize,
    }),
  }
}

/**
 * Helper: Get handler for terminal
 */
export function getHandler(handlers: Record<string, TerminalHandlers>, terminalId: string): TerminalHandlers {
  const handler = handlers[terminalId]
  if (!handler) {
    throw new Error(`No handlers found for terminal ${terminalId}`)
  }
  return handler
}

/**
 * Helper: Check if handler exists
 */
export function hasHandler(handlers: Record<string, TerminalHandlers>, terminalId: string): boolean {
  return !!handlers[terminalId]
}

/**
 * Helper: Cleanup handlers for terminal
 */
export function cleanupHandlers(handlers: Record<string, TerminalHandlers>, terminalId: string): void {
  const handler = handlers[terminalId]
  if (handler) {
    handler.health.stop()
    handler.batcher.flush()
    handler.connection.disconnect()
    handler.ui.cleanup()
    delete handlers[terminalId]
  }
}
