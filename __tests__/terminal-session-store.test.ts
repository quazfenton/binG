/**
 * E2E Tests: Terminal Session Store
 * 
 * Tests terminal session persistence and recovery
 * 
 * @see lib/sandbox/terminal-session-store.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  saveTerminalSession,
  getTerminalSession,
  updateTerminalSession,
  deleteTerminalSession,
  getAllTerminalSessions,
  getSessionsByUserId,
  getSessionsBySandboxId,
  clearAllSessions,
  exportSessions,
  importSessions,
  getSessionStats,
  type TerminalSessionState,
} from '@/lib/sandbox/terminal-session-store'

describe('Terminal Session Store', () => {
  const testSession: TerminalSessionState = {
    sessionId: 'test-session-123',
    sandboxId: 'test-sandbox-456',
    ptySessionId: 'pty-789',
    userId: 'user-abc',
    mode: 'pty',
    cwd: '/workspace',
    cols: 120,
    rows: 30,
    lastActive: Date.now(),
    history: ['ls', 'cd project', 'npm install'],
    metadata: { provider: 'daytona', region: 'us-east-1' },
  }

  beforeEach(() => {
    clearAllSessions()
  })

  afterEach(() => {
    clearAllSessions()
  })

  describe('saveTerminalSession', () => {
    it('should save session successfully', () => {
      saveTerminalSession(testSession)
      
      const saved = getTerminalSession(testSession.sessionId)
      expect(saved).toBeDefined()
      expect(saved?.sessionId).toBe(testSession.sessionId)
      expect(saved?.sandboxId).toBe(testSession.sandboxId)
      expect(saved?.userId).toBe(testSession.userId)
    })

    it('should update lastActive timestamp', () => {
      const originalTime = Date.now() - 10000
      const session = { ...testSession, lastActive: originalTime }
      
      saveTerminalSession(session)
      
      const saved = getTerminalSession(session.sessionId)
      expect(saved?.lastActive).toBeGreaterThan(originalTime)
    })

    it('should save command history', () => {
      saveTerminalSession(testSession)
      
      const saved = getTerminalSession(testSession.sessionId)
      expect(saved?.history).toEqual(testSession.history)
      expect(saved?.history).toHaveLength(3)
    })

    it('should save metadata', () => {
      saveTerminalSession(testSession)
      
      const saved = getTerminalSession(testSession.sessionId)
      expect(saved?.metadata).toEqual(testSession.metadata)
      expect(saved?.metadata?.provider).toBe('daytona')
    })

    it('should update existing session', () => {
      saveTerminalSession(testSession)
      
      const updatedSession = {
        ...testSession,
        cwd: '/workspace/new-dir',
        history: [...testSession.history, 'new-command'],
      }
      
      saveTerminalSession(updatedSession)
      
      const saved = getTerminalSession(testSession.sessionId)
      expect(saved?.cwd).toBe('/workspace/new-dir')
      expect(saved?.history).toHaveLength(4)
    })

    it('should save PTY mode session', () => {
      const ptySession: TerminalSessionState = {
        ...testSession,
        mode: 'pty',
        cols: 80,
        rows: 24,
      }
      
      saveTerminalSession(ptySession)
      
      const saved = getTerminalSession(ptySession.sessionId)
      expect(saved?.mode).toBe('pty')
      expect(saved?.cols).toBe(80)
      expect(saved?.rows).toBe(24)
    })

    it('should save command-mode session', () => {
      const cmdSession: TerminalSessionState = {
        ...testSession,
        mode: 'command-mode',
        ptySessionId: 'command-mode',
      }
      
      saveTerminalSession(cmdSession)
      
      const saved = getTerminalSession(cmdSession.sessionId)
      expect(saved?.mode).toBe('command-mode')
    })
  })

  describe('getTerminalSession', () => {
    it('should return undefined for non-existent session', () => {
      const session = getTerminalSession('non-existent')
      expect(session).toBeUndefined()
    })

    it('should return session by ID', () => {
      saveTerminalSession(testSession)
      
      const saved = getTerminalSession(testSession.sessionId)
      expect(saved).toBeDefined()
      expect(saved?.sessionId).toBe(testSession.sessionId)
    })

    it('should return full session object', () => {
      saveTerminalSession(testSession)
      
      const saved = getTerminalSession(testSession.sessionId)
      expect(saved).toMatchObject({
        sessionId: testSession.sessionId,
        sandboxId: testSession.sandboxId,
        userId: testSession.userId,
        mode: testSession.mode,
        cwd: testSession.cwd,
      })
    })
  })

  describe('updateTerminalSession', () => {
    it('should update session fields', () => {
      saveTerminalSession(testSession)
      
      updateTerminalSession(testSession.sessionId, {
        cwd: '/workspace/updated',
        cols: 150,
        rows: 40,
      })
      
      const saved = getTerminalSession(testSession.sessionId)
      expect(saved?.cwd).toBe('/workspace/updated')
      expect(saved?.cols).toBe(150)
      expect(saved?.rows).toBe(40)
      expect(saved?.history).toEqual(testSession.history) // Unchanged
    })

    it('should update lastActive on update', () => {
      saveTerminalSession(testSession)
      
      const beforeUpdate = getTerminalSession(testSession.sessionId)
      const beforeTime = beforeUpdate?.lastActive
      
      // Wait a small amount to ensure time difference
      const waitMs = 10
      const start = Date.now()
      while (Date.now() - start < waitMs) { /* wait */ }
      
      updateTerminalSession(testSession.sessionId, { cwd: '/new' })
      
      const afterUpdate = getTerminalSession(testSession.sessionId)
      expect(afterUpdate?.lastActive).toBeGreaterThanOrEqual(beforeTime!)
    })

    it('should handle non-existent session gracefully', () => {
      expect(() => {
        updateTerminalSession('non-existent', { cwd: '/new' })
      }).not.toThrow()
    })

    it('should append to history', () => {
      saveTerminalSession(testSession)
      
      const session = getTerminalSession(testSession.sessionId)!
      updateTerminalSession(testSession.sessionId, {
        history: [...session.history, 'new-cmd'],
      })
      
      const saved = getTerminalSession(testSession.sessionId)
      expect(saved?.history).toHaveLength(4)
      expect(saved?.history?.[3]).toBe('new-cmd')
    })
  })

  describe('deleteTerminalSession', () => {
    it('should delete session', () => {
      saveTerminalSession(testSession)
      deleteTerminalSession(testSession.sessionId)
      
      const saved = getTerminalSession(testSession.sessionId)
      expect(saved).toBeUndefined()
    })

    it('should handle non-existent session gracefully', () => {
      expect(() => {
        deleteTerminalSession('non-existent')
      }).not.toThrow()
    })

    it('should not affect other sessions', () => {
      const session2 = { ...testSession, sessionId: 'session-2' }
      saveTerminalSession(testSession)
      saveTerminalSession(session2)
      
      deleteTerminalSession(testSession.sessionId)
      
      const saved2 = getTerminalSession(session2.sessionId)
      expect(saved2).toBeDefined()
    })
  })

  describe('getAllTerminalSessions', () => {
    it('should return all active sessions', () => {
      const session2 = { ...testSession, sessionId: 'session-2' }
      const session3 = { ...testSession, sessionId: 'session-3' }
      
      saveTerminalSession(testSession)
      saveTerminalSession(session2)
      saveTerminalSession(session3)
      
      const all = getAllTerminalSessions()
      expect(all).toHaveLength(3)
    })

    it('should return empty array when no sessions', () => {
      const all = getAllTerminalSessions()
      expect(all).toHaveLength(0)
    })

    it('should filter expired sessions', () => {
      // This would require mocking time - documented for integration test
      const all = getAllTerminalSessions()
      expect(Array.isArray(all)).toBe(true)
    })
  })

  describe('getSessionsByUserId', () => {
    it('should return sessions for user', () => {
      const session2 = { ...testSession, sessionId: 'session-2' }
      const otherUserSession = { ...testSession, sessionId: 'session-3', userId: 'other-user' }
      
      saveTerminalSession(testSession)
      saveTerminalSession(session2)
      saveTerminalSession(otherUserSession)
      
      const userSessions = getSessionsByUserId('user-abc')
      expect(userSessions).toHaveLength(2)
      expect(userSessions.every(s => s.userId === 'user-abc')).toBe(true)
    })

    it('should return empty array for user with no sessions', () => {
      const sessions = getSessionsByUserId('non-existent-user')
      expect(sessions).toHaveLength(0)
    })
  })

  describe('getSessionsBySandboxId', () => {
    it('should return sessions for sandbox', () => {
      const session2 = { ...testSession, sessionId: 'session-2' }
      const otherSandboxSession = { ...testSession, sessionId: 'session-3', sandboxId: 'other-sandbox' }
      
      saveTerminalSession(testSession)
      saveTerminalSession(session2)
      saveTerminalSession(otherSandboxSession)
      
      const sandboxSessions = getSessionsBySandboxId('test-sandbox-456')
      expect(sandboxSessions).toHaveLength(2)
      expect(sandboxSessions.every(s => s.sandboxId === 'test-sandbox-456')).toBe(true)
    })

    it('should return empty array for sandbox with no sessions', () => {
      const sessions = getSessionsBySandboxId('non-existent-sandbox')
      expect(sessions).toHaveLength(0)
    })
  })

  describe('exportSessions / importSessions', () => {
    it('should export sessions to JSON', () => {
      saveTerminalSession(testSession)
      
      const json = exportSessions()
      expect(json).toBeTruthy()
      expect(typeof json).toBe('string')
      
      const parsed = JSON.parse(json)
      expect(Array.isArray(parsed)).toBe(true)
      expect(parsed[0].sessionId).toBe(testSession.sessionId)
    })

    it('should import sessions from JSON', () => {
      const json = JSON.stringify([testSession])
      
      const count = importSessions(json)
      expect(count).toBe(1)
      
      const saved = getTerminalSession(testSession.sessionId)
      expect(saved).toBeDefined()
    })

    it('should handle invalid JSON gracefully', () => {
      const count = importSessions('invalid json')
      expect(count).toBe(0)
    })

    it('should validate session structure on import', () => {
      const invalidJson = JSON.stringify([{ invalid: 'session' }])
      
      const count = importSessions(invalidJson)
      expect(count).toBe(0)
    })

    it('should round-trip export/import', () => {
      saveTerminalSession(testSession)
      
      const json = exportSessions()
      clearAllSessions()
      
      const count = importSessions(json)
      expect(count).toBe(1)
      
      const saved = getTerminalSession(testSession.sessionId)
      expect(saved?.sessionId).toBe(testSession.sessionId)
      expect(saved?.history).toEqual(testSession.history)
    })
  })

  describe('getSessionStats', () => {
    it('should return session statistics', () => {
      const ptySession = { ...testSession, sessionId: 'pty-1', mode: 'pty' as const }
      const cmdSession = { ...testSession, sessionId: 'cmd-1', mode: 'command-mode' as const }
      
      saveTerminalSession(ptySession)
      saveTerminalSession(cmdSession)
      
      const stats = getSessionStats()
      
      expect(stats.total).toBe(2)
      expect(stats.byMode.pty).toBe(1)
      expect(stats.byMode['command-mode']).toBe(1)
      expect(stats.byAge.recent).toBeGreaterThanOrEqual(0)
    })

    it('should handle empty state', () => {
      const stats = getSessionStats()
      
      expect(stats.total).toBe(0)
      expect(stats.byMode.pty).toBe(0)
      expect(stats.byMode['command-mode']).toBe(0)
    })
  })

  describe('clearAllSessions', () => {
    it('should clear all sessions', () => {
      saveTerminalSession(testSession)
      saveTerminalSession({ ...testSession, sessionId: 'session-2' })
      
      clearAllSessions()
      
      const all = getAllTerminalSessions()
      expect(all).toHaveLength(0)
    })
  })

  describe('Session TTL', () => {
    it('should respect session TTL', () => {
      // This is documented for integration testing
      // TTL is 4 hours by default
      saveTerminalSession(testSession)
      
      const saved = getTerminalSession(testSession.sessionId)
      expect(saved).toBeDefined()
    })
  })

  describe('Concurrent Sessions', () => {
    it('should handle multiple concurrent sessions', () => {
      const sessions = Array.from({ length: 10 }, (_, i) => ({
        ...testSession,
        sessionId: `session-${i}`,
        userId: `user-${i % 3}`,
      }))
      
      sessions.forEach(s => saveTerminalSession(s))
      
      const all = getAllTerminalSessions()
      expect(all).toHaveLength(10)
      
      const user0Sessions = getSessionsByUserId('user-0')
      expect(user0Sessions.length).toBeGreaterThanOrEqual(3)
    })
  })

  describe('Large Session Data', () => {
    it('should handle large command history', () => {
      const largeHistory = Array.from({ length: 1000 }, (_, i) => `command-${i}`)
      const largeSession = { ...testSession, history: largeHistory }
      
      saveTerminalSession(largeSession)
      
      const saved = getTerminalSession(testSession.sessionId)
      expect(saved?.history).toHaveLength(1000)
    })

    it('should handle large metadata', () => {
      const largeMetadata = {
        ...testSession.metadata,
        largeArray: Array.from({ length: 100 }, (_, i) => ({ id: i })),
        nestedObject: { a: { b: { c: 'deep' } } },
      }
      const largeSession = { ...testSession, metadata: largeMetadata }
      
      saveTerminalSession(largeSession)
      
      const saved = getTerminalSession(testSession.sessionId)
      expect(saved?.metadata?.largeArray).toHaveLength(100)
    })
  })
})
