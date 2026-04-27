import { describe, it, expect, beforeEach, vi } from 'vitest'
import {
  saveCheckpoint,
  getCheckpoint,
  getCheckpointsBySession,
  deleteCheckpoint,
  getLatestCheckpoint,
  type SessionCheckpoint,
} from '../session-store'

describe('Session Checkpoint Storage', () => {
  const mockCheckpoint = (overrides = {}): SessionCheckpoint => ({
    checkpointId: `cp-${Date.now()}`,
    sessionId: 'test-session-123',
    userId: 'test-user-456',
    label: 'test checkpoint',
    timestamp: Date.now(),
    version: '1.0',
    state: {
      conversationState: { messages: [] },
      sandboxState: { sandboxId: 'sb-001', sandboxProvider: 'test', workspaceDir: '/workspace' },
      toolState: { tools: [] },
      quotaUsage: { computeMinutes: 60, computeUsed: 0 },
      metadata: { mode: 'opencode', cloudOffloadEnabled: false, mcpEnabled: false },
    },
    ...overrides,
  })

  describe('saveCheckpoint', () => {
    it('should save checkpoint without throwing', () => {
      const checkpoint = mockCheckpoint()
      expect(() => saveCheckpoint(checkpoint)).not.toThrow()
    })

    it('should save multiple checkpoints for same session', async () => {
      const sessionId = 'session-multi-' + Date.now()
      await saveCheckpoint(mockCheckpoint({ sessionId, checkpointId: 'cp-1' }))
      await saveCheckpoint(mockCheckpoint({ sessionId, checkpointId: 'cp-2' }))
      await saveCheckpoint(mockCheckpoint({ sessionId, checkpointId: 'cp-3' }))

      const checkpoints = await getCheckpointsBySession(sessionId, 10)
      expect(checkpoints.length).toBeGreaterThanOrEqual(2)
    })
  })

  describe('getCheckpoint', () => {
    it('should return undefined for non-existent checkpoint', async () => {
      const result = await getCheckpoint('non-existent-checkpoint-id')
      expect(result).toBeUndefined()
    })

    it('should retrieve saved checkpoint', async () => {
      const original = mockCheckpoint({ checkpointId: 'cp-retrieve-test' })
      await saveCheckpoint(original)

      const retrieved = await getCheckpoint('cp-retrieve-test')
      expect(retrieved).toBeDefined()
      expect(retrieved?.checkpointId).toBe('cp-retrieve-test')
    })
  })

  describe('getCheckpointsBySession', () => {
    it('should return empty array for non-existent session', async () => {
      const result = await getCheckpointsBySession('non-existent-session', 10)
      expect(result).toEqual([])
    })
  })

  describe('deleteCheckpoint', () => {
    it('should not throw when deleting non-existent checkpoint', () => {
      expect(() => deleteCheckpoint('non-existent')).not.toThrow()
    })

    it('should remove checkpoint after deletion', async () => {
      const checkpoint = mockCheckpoint({ checkpointId: 'cp-delete-test' })
      await saveCheckpoint(checkpoint)
      deleteCheckpoint('cp-delete-test')

      const result = await getCheckpoint('cp-delete-test')
      expect(result).toBeUndefined()
    })
  })

  describe('getLatestCheckpoint', () => {
    it('should return most recent checkpoint', async () => {
      const sessionId = 'session-latest-' + Date.now()
      await saveCheckpoint(mockCheckpoint({ sessionId, checkpointId: 'cp-old', timestamp: Date.now() - 10000 }))
      await saveCheckpoint(mockCheckpoint({ sessionId, checkpointId: 'cp-new', timestamp: Date.now() }))

      const latest = await getLatestCheckpoint(sessionId)
      expect(latest?.checkpointId).toBe('cp-new')
    })
  })
})
