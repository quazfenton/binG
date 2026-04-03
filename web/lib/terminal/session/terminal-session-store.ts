/**
 * @deprecated Use lib/terminal/session/terminal-session-manager.ts instead
 * 
 * This file is kept for backward compatibility only.
 * All new code should use terminalSessionManager from terminal-session-manager.
 * 
 * Migration guide:
 * - import { saveTerminalSession } from '@/lib/terminal/session/terminal-session-store'
 * + import { terminalSessionManager } from '@/lib/terminal/session/terminal-session-manager'
 * 
 * @see lib/terminal/session/terminal-session-manager.ts - Consolidated terminal session manager
 */

import type BetterSqlite3 from 'better-sqlite3'
import { terminalSessionManager } from './terminal-session-manager'

// Log deprecation warning on first import
console.warn('[DEPRECATED] terminal-session-store.ts is deprecated. Use terminal-session-manager.ts instead.')

// Re-export types
export type { TerminalSessionState } from './terminal-session-manager'

// ============================================================================
// DEPRECATED - Use terminalSessionManager from terminal-session-manager.ts
// ============================================================================
// All functions now delegate to the consolidated terminalSessionManager.
// ============================================================================

/**
 * @deprecated Use terminalSessionManager.saveSession()
 */
export const saveTerminalSession = terminalSessionManager.saveSession.bind(terminalSessionManager)

/**
 * @deprecated Use terminalSessionManager.getSession()
 */
export const getTerminalSession = terminalSessionManager.getSession.bind(terminalSessionManager)

/**
 * @deprecated Use terminalSessionManager.updateSession()
 */
export const updateTerminalSession = terminalSessionManager.updateSession.bind(terminalSessionManager)

/**
 * @deprecated Use terminalSessionManager.deleteSession()
 */
export const deleteTerminalSession = terminalSessionManager.deleteSession.bind(terminalSessionManager)

/**
 * @deprecated Use terminalSessionManager.getAllSessions()
 */
export const getAllTerminalSessions = terminalSessionManager.getAllSessions.bind(terminalSessionManager)

/**
 * @deprecated Use terminalSessionManager.getSessionsByUserId()
 */
export const getSessionsByUserId = terminalSessionManager.getSessionsByUserId.bind(terminalSessionManager)

/**
 * @deprecated Use terminalSessionManager.getSessionsBySandboxId()
 */
export const getSessionsBySandboxId = terminalSessionManager.getSessionsBySandboxId.bind(terminalSessionManager)

/**
 * @deprecated Use terminalSessionManager.clearAllSessions()
 */
export const clearAllSessions = terminalSessionManager.clearAllSessions.bind(terminalSessionManager)

/**
 * @deprecated Use terminalSessionManager.exportSessions()
 */
export const exportSessions = terminalSessionManager.exportSessions.bind(terminalSessionManager)

/**
 * @deprecated Use terminalSessionManager.importSessions()
 */
export const importSessions = terminalSessionManager.importSessions.bind(terminalSessionManager)

/**
 * @deprecated Use terminalSessionManager.getSessionStats()
 */
export const getSessionStats = terminalSessionManager.getSessionStats.bind(terminalSessionManager)
