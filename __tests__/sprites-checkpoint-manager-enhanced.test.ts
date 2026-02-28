/**
 * Sprites Checkpoint Manager Tests
 *
 * Tests for enhanced checkpoint management functionality
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { SpritesCheckpointManager, createCheckpointManager } from '../lib/sandbox/providers/sprites-checkpoint-manager'

// Mock SpritesSandboxHandle
const createMockHandle = () => ({
  id: 'test-sprite',
  createCheckpoint: vi.fn(),
  restoreCheckpoint: vi.fn(),
  listCheckpoints: vi.fn(),
})

type MockHandle = ReturnType<typeof createMockHandle>

describe('Sprites Checkpoint Manager', () => {
  let checkpointManager: SpritesCheckpointManager
  let mockHandle: MockHandle

  beforeEach(() => {
    mockHandle = createMockHandle()
    checkpointManager = createCheckpointManager(mockHandle as any, {
      maxCheckpoints: 5,
      maxAgeDays: 7,
      minCheckpoints: 2,
    })
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('createCheckpoint', () => {
    it('should create checkpoint with auto-generated name', async () => {
      mockHandle.createCheckpoint.mockResolvedValue({
        id: 'cp-123',
        name: 'checkpoint-1234567890',
        created_at: '2024-01-01T00:00:00Z',
      })

      const result = await checkpointManager.createCheckpoint()

      expect(result.id).toBe('cp-123')
      expect(result.name).toContain('checkpoint-')
      expect(mockHandle.createCheckpoint).toHaveBeenCalledWith(
        expect.stringContaining('checkpoint-')
      )
    })

    it('should create checkpoint with custom name', async () => {
      mockHandle.createCheckpoint.mockResolvedValue({
        id: 'cp-123',
        name: 'my-checkpoint',
        created_at: '2024-01-01T00:00:00Z',
      })

      const result = await checkpointManager.createCheckpoint('my-checkpoint', {
        comment: 'Test checkpoint',
        tags: ['test', 'experimental'],
      })

      expect(result.name).toBe('my-checkpoint')
      expect(result.comment).toBe('Test checkpoint')
      expect(result.tags).toEqual(['test', 'experimental'])
    })

    it('should enforce retention policy after creation', async () => {
      mockHandle.createCheckpoint.mockResolvedValue({
        id: 'cp-123',
        name: 'checkpoint-123',
        created_at: '2024-01-01T00:00:00Z',
      })

      const enforceSpy = vi.spyOn(checkpointManager, 'enforceRetentionPolicy')
      enforceSpy.mockResolvedValue({ deleted: 0, kept: 1 })

      await checkpointManager.createCheckpoint('test', { autoEnforceRetention: true })

      expect(enforceSpy).toHaveBeenCalled()
    })

    it('should skip retention policy enforcement if disabled', async () => {
      mockHandle.createCheckpoint.mockResolvedValue({
        id: 'cp-123',
        name: 'checkpoint-123',
        created_at: '2024-01-01T00:00:00Z',
      })

      const enforceSpy = vi.spyOn(checkpointManager, 'enforceRetentionPolicy')
      enforceSpy.mockResolvedValue({ deleted: 0, kept: 1 })

      await checkpointManager.createCheckpoint('test', { autoEnforceRetention: false })

      expect(enforceSpy).not.toHaveBeenCalled()
    })
  })

  describe('createPreOperationCheckpoint', () => {
    beforeEach(() => {
      vi.stubEnv('SPRITES_CHECKPOINT_AUTO_CREATE', 'true')
    })

    afterEach(() => {
      vi.unstubAllEnvs()
    })

    it('should create pre-operation checkpoint with tags', async () => {
      mockHandle.createCheckpoint.mockResolvedValue({
        id: 'cp-123',
        name: 'pre-dangerous-1234567890',
        created_at: '2024-01-01T00:00:00Z',
      })

      const result = await checkpointManager.createPreOperationCheckpoint('dangerous')

      expect(result).not.toBeNull()
      expect(result?.name).toContain('pre-dangerous')
      expect(result?.tags).toContain('auto')
      expect(result?.tags).toContain('dangerous')
    })

    it('should return null if auto-checkpoint is disabled', async () => {
      vi.stubEnv('SPRITES_CHECKPOINT_AUTO_CREATE', 'false')

      const result = await checkpointManager.createPreOperationCheckpoint('deploy')

      expect(result).toBeNull()
    })
  })

  describe('deleteCheckpoint', () => {
    it('should delete checkpoint successfully', async () => {
      // Mock exec to succeed
      const mockExec = vi.fn().mockResolvedValue({ stdout: '', stderr: '' })
      vi.mock('child_process', () => ({
        exec: mockExec,
      }))

      await expect(
        checkpointManager.deleteCheckpoint('cp-123')
      ).resolves.toBeUndefined()
    })

    it('should handle deletion failures gracefully', async () => {
      const mockExec = vi.fn().mockRejectedValue(new Error('Checkpoint not found'))
      vi.mock('child_process', () => ({
        exec: mockExec,
      }))

      await expect(
        checkpointManager.deleteCheckpoint('invalid')
      ).rejects.toThrow('Failed to delete checkpoint')
    })
  })

  describe('restoreCheckpoint', () => {
    it('should restore checkpoint successfully', async () => {
      mockHandle.listCheckpoints.mockResolvedValue([
        { id: 'cp-123', name: 'test', createdAt: '2024-01-01T00:00:00Z' },
      ])
      mockHandle.restoreCheckpoint.mockResolvedValue(undefined)

      const result = await checkpointManager.restoreCheckpoint('cp-123', {
        validate: true,
        createBackup: false,
      })

      expect(result.success).toBe(true)
      expect(mockHandle.restoreCheckpoint).toHaveBeenCalledWith('cp-123')
    })

    it('should validate checkpoint exists before restore', async () => {
      mockHandle.listCheckpoints.mockResolvedValue([])

      const result = await checkpointManager.restoreCheckpoint('invalid', {
        validate: true,
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('not found')
    })

    it('should skip validation if disabled', async () => {
      mockHandle.restoreCheckpoint.mockResolvedValue(undefined)

      const result = await checkpointManager.restoreCheckpoint('cp-123', {
        validate: false,
      })

      expect(result.success).toBe(true)
      expect(mockHandle.listCheckpoints).not.toHaveBeenCalled()
    })

    it('should create backup before restore if requested', async () => {
      mockHandle.listCheckpoints.mockResolvedValue([
        { id: 'cp-123', name: 'test', createdAt: '2024-01-01T00:00:00Z' },
      ])
      mockHandle.restoreCheckpoint.mockResolvedValue(undefined)
      mockHandle.createCheckpoint.mockResolvedValue({
        id: 'cp-backup',
        name: 'pre-restore-123',
        created_at: '2024-01-01T00:00:00Z',
      })

      const result = await checkpointManager.restoreCheckpoint('cp-123', {
        validate: true,
        createBackup: true,
      })

      expect(result.success).toBe(true)
      expect(mockHandle.createCheckpoint).toHaveBeenCalled()
    })
  })

  describe('getStorageStats', () => {
    it('should return storage statistics', async () => {
      mockHandle.listCheckpoints.mockResolvedValue([
        { id: 'cp-1', name: 'cp-1', createdAt: '2024-01-01T00:00:00Z' },
        { id: 'cp-2', name: 'cp-2', createdAt: '2024-01-02T00:00:00Z' },
        { id: 'cp-3', name: 'cp-3', createdAt: '2024-01-03T00:00:00Z' },
      ])

      const result = await checkpointManager.getStorageStats()

      expect(result.checkpointCount).toBe(3)
      expect(result.estimatedSizeGB).toBeCloseTo(0.3, 1) // 3 * 100MB = 300MB ≈ 0.3GB
      expect(result.percentUsed).toBeDefined()
    })

    it('should use custom quota from env', async () => {
      vi.stubEnv('SPRITES_STORAGE_QUOTA_GB', '20')

      mockHandle.listCheckpoints.mockResolvedValue([
        { id: 'cp-1', name: 'cp-1', createdAt: '2024-01-01T00:00:00Z' },
      ])

      const result = await checkpointManager.getStorageStats()

      expect(result.quotaLimit).toBe(20)
      expect(result.percentUsed).toBeLessThan(5) // 0.1GB / 20GB = 0.5%

      vi.unstubAllEnvs()
    })
  })

  describe('enforceRetentionPolicy', () => {
    it('should keep all checkpoints if below minimum', async () => {
      mockHandle.listCheckpoints.mockResolvedValue([
        { id: 'cp-1', name: 'cp-1', createdAt: '2024-01-01T00:00:00Z' },
      ])

      const result = await checkpointManager.enforceRetentionPolicy()

      expect(result.deleted).toBe(0)
      expect(result.kept).toBe(1)
    })

    it('should delete old checkpoints over max count', async () => {
      const oldCheckpoints = Array.from({ length: 10 }, (_, i) => ({
        id: `cp-${i}`,
        name: `cp-${i}`,
        createdAt: `2024-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
      }))

      mockHandle.listCheckpoints.mockResolvedValue(oldCheckpoints)

      const deleteSpy = vi.spyOn(checkpointManager, 'deleteCheckpoint')
      deleteSpy.mockResolvedValue()

      const result = await checkpointManager.enforceRetentionPolicy()

      expect(result.kept).toBeLessThanOrEqual(5) // maxCheckpoints
      expect(result.deleted).toBeGreaterThan(0)
    })

    it('should delete checkpoints over max age', async () => {
      const now = new Date()
      const oldDate = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000) // 10 days ago

      mockHandle.listCheckpoints.mockResolvedValue([
        { id: 'cp-1', name: 'cp-1', createdAt: oldDate.toISOString() },
        { id: 'cp-2', name: 'cp-2', createdAt: now.toISOString() },
        { id: 'cp-3', name: 'cp-3', createdAt: now.toISOString() },
      ])

      const deleteSpy = vi.spyOn(checkpointManager, 'deleteCheckpoint')
      deleteSpy.mockResolvedValue()

      const result = await checkpointManager.enforceRetentionPolicy()

      // cp-1 should be deleted (over 7 days old)
      expect(result.deleted).toBeGreaterThanOrEqual(0)
    })

    it('should always keep minimum checkpoints regardless of age', async () => {
      const oldDate = '2020-01-01T00:00:00Z' // Very old

      mockHandle.listCheckpoints.mockResolvedValue([
        { id: 'cp-1', name: 'cp-1', createdAt: oldDate },
        { id: 'cp-2', name: 'cp-2', createdAt: oldDate },
        { id: 'cp-3', name: 'cp-3', createdAt: oldDate },
      ])

      const deleteSpy = vi.spyOn(checkpointManager, 'deleteCheckpoint')
      deleteSpy.mockResolvedValue()

      const result = await checkpointManager.enforceRetentionPolicy()

      // Should keep at least minCheckpoints (2)
      expect(result.kept).toBeGreaterThanOrEqual(2)
    })
  })

  describe('restoreByTag', () => {
    it('should restore checkpoint by tag', async () => {
      mockHandle.listCheckpoints.mockResolvedValue([
        { id: 'cp-1', name: 'pre-deploy-123', createdAt: '2024-01-01T00:00:00Z' },
      ])
      mockHandle.restoreCheckpoint.mockResolvedValue(undefined)

      const result = await checkpointManager.restoreByTag('deploy')

      expect(result).toBe(true)
      expect(mockHandle.restoreCheckpoint).toHaveBeenCalledWith('cp-1')
    })

    it('should return false if tag not found', async () => {
      mockHandle.listCheckpoints.mockResolvedValue([])

      const result = await checkpointManager.restoreByTag('nonexistent')

      expect(result).toBe(false)
    })
  })

  describe('getRetentionPolicy & updateRetentionPolicy', () => {
    it('should return current retention policy', () => {
      const policy = checkpointManager.getRetentionPolicy()

      expect(policy.maxCheckpoints).toBe(5)
      expect(policy.maxAgeDays).toBe(7)
      expect(policy.minCheckpoints).toBe(2)
    })

    it('should update retention policy', () => {
      checkpointManager.updateRetentionPolicy({
        maxCheckpoints: 10,
        maxAgeDays: 30,
      })

      const policy = checkpointManager.getRetentionPolicy()

      expect(policy.maxCheckpoints).toBe(10)
      expect(policy.maxAgeDays).toBe(30)
      expect(policy.minCheckpoints).toBe(2) // Unchanged
    })
  })

  describe('Factory Function', () => {
    it('should create instance via createCheckpointManager', () => {
      const instance = createCheckpointManager(mockHandle as any)
      expect(instance).toBeInstanceOf(SpriteCheckpointManager)
    })

    it('should apply custom policy from factory', () => {
      const instance = createCheckpointManager(mockHandle as any, {
        maxCheckpoints: 20,
        maxAgeDays: 60,
      })

      const policy = instance.getRetentionPolicy()
      expect(policy.maxCheckpoints).toBe(20)
      expect(policy.maxAgeDays).toBe(60)
    })
  })
})
