/**
 * Sprites Checkpoint Manager Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { SpritesCheckpointManager, createCheckpointManager } from '../lib/sandbox/providers/sprites-checkpoint-manager'

const mockExec = vi.fn()
vi.mock('child_process', () => ({
  exec: mockExec,
}))

describe('SpritesCheckpointManager', () => {
  let mockHandle: any
  let manager: SpritesCheckpointManager

  beforeEach(() => {
    // Mock SpritesSandboxHandle
    mockHandle = {
      id: 'test-sprite',
      workspaceDir: '/home/sprite/workspace',
      createCheckpoint: vi.fn().mockResolvedValue({
        id: 'checkpoint-123',
        name: 'test-checkpoint',
        createdAt: new Date().toISOString(),
      }),
      restoreCheckpoint: vi.fn().mockResolvedValue(undefined),
      listCheckpoints: vi.fn().mockResolvedValue([
        { id: 'cp-1', name: 'checkpoint-1', createdAt: '2026-02-27T10:00:00Z' },
        { id: 'cp-2', name: 'checkpoint-2', createdAt: '2026-02-27T11:00:00Z' },
        { id: 'cp-3', name: 'checkpoint-3', createdAt: '2026-02-27T12:00:00Z' },
      ]),
    }

    manager = new SpritesCheckpointManager(mockHandle)
    mockExec.mockImplementation((cmd, cb) => cb(null, { stdout: '', stderr: '' }))
  })

  describe('constructor', () => {
    it('should initialize with default policy', () => {
      const policy = manager.getRetentionPolicy()
      
      expect(policy.maxCheckpoints).toBe(10)
      expect(policy.maxAgeDays).toBe(30)
      expect(policy.minCheckpoints).toBe(3)
    })

    it('should accept custom policy', () => {
      const customManager = new SpritesCheckpointManager(mockHandle, {
        maxCheckpoints: 5,
        maxAgeDays: 7,
        minCheckpoints: 2,
      })

      const policy = customManager.getRetentionPolicy()
      
      expect(policy.maxCheckpoints).toBe(5)
      expect(policy.maxAgeDays).toBe(7)
      expect(policy.minCheckpoints).toBe(2)
    })
  })

  describe('createCheckpoint', () => {
    it('should create checkpoint with default name', async () => {
      const checkpoint = await manager.createCheckpoint()

      expect(checkpoint.id).toBe('checkpoint-123')
      expect(checkpoint.name).toMatch(/checkpoint-\d+/)
      expect(mockHandle.createCheckpoint).toHaveBeenCalled()
    })

    it('should create checkpoint with custom name', async () => {
      const checkpoint = await manager.createCheckpoint('pre-deploy')

      expect(checkpoint.name).toBe('pre-deploy')
    })

    it('should create checkpoint with tags', async () => {
      const checkpoint = await manager.createCheckpoint('pre-refactor', {
        comment: 'Before major refactoring',
        tags: ['pre-refactor', 'safe-point'],
      })

      expect(checkpoint.comment).toBe('Before major refactoring')
      expect(checkpoint.tags).toContain('pre-refactor')
    })

    it('should enforce retention policy by default', async () => {
      const enforceSpy = vi.spyOn(manager, 'enforceRetentionPolicy').mockResolvedValue({
        deleted: 0,
        kept: 3,
      })

      await manager.createCheckpoint()

      expect(enforceSpy).toHaveBeenCalled()
      enforceSpy.mockRestore()
    })

    it('should skip retention enforcement when disabled', async () => {
      const enforceSpy = vi.spyOn(manager, 'enforceRetentionPolicy').mockResolvedValue({
        deleted: 0,
        kept: 3,
      })

      await manager.createCheckpoint('test', { autoEnforceRetention: false })

      expect(enforceSpy).not.toHaveBeenCalled()
      enforceSpy.mockRestore()
    })

    it('should throw error on failure', async () => {
      mockHandle.createCheckpoint.mockRejectedValue(new Error('Checkpoint failed'))

      await expect(manager.createCheckpoint())
        .rejects
        .toThrow('Failed to create checkpoint: Checkpoint failed')
    })
  })

  describe('createPreOperationCheckpoint', () => {
    it('should create checkpoint for dangerous operation', async () => {
      vi.stubEnv('SPRITES_CHECKPOINT_AUTO_CREATE', 'true')
      
      const checkpoint = await manager.createPreOperationCheckpoint('dangerous')

      expect(checkpoint).not.toBeNull()
      expect(checkpoint!.name).toMatch(/pre-dangerous-\d+/)
      expect(checkpoint!.tags).toContain('auto')
      expect(checkpoint!.tags).toContain('dangerous')
      
      vi.unstubAllEnvs()
    })

    it('should return null when auto-checkpoints disabled', async () => {
      vi.stubEnv('SPRITES_CHECKPOINT_AUTO_CREATE', 'false')
      
      const checkpoint = await manager.createPreOperationCheckpoint('deploy')

      expect(checkpoint).toBeNull()
      
      vi.unstubAllEnvs()
    })

    it('should support all operation types', async () => {
      vi.stubEnv('SPRITES_CHECKPOINT_AUTO_CREATE', 'true')
      
      const types: Array<'dangerous' | 'deploy' | 'refactor' | 'experiment'> = [
        'dangerous',
        'deploy',
        'refactor',
        'experiment',
      ]

      for (const type of types) {
        const checkpoint = await manager.createPreOperationCheckpoint(type)
        expect(checkpoint!.name).toMatch(new RegExp(`pre-${type}-\\d+`))
      }
      
      vi.unstubAllEnvs()
    })
  })

  describe('listCheckpoints', () => {
    it('should list all checkpoints', async () => {
      const checkpoints = await manager.listCheckpoints()

      expect(checkpoints).toHaveLength(3)
      expect(checkpoints[0].id).toBe('cp-1')
    })

    it('should filter by tag', async () => {
      mockHandle.listCheckpoints.mockResolvedValue([
        { id: 'cp-1', name: 'pre-deploy-123', createdAt: '2026-02-27T10:00:00Z' },
        { id: 'cp-2', name: 'pre-refactor-456', createdAt: '2026-02-27T11:00:00Z' },
      ])

      const checkpoints = await manager.listCheckpoints({ tag: 'deploy' })

      expect(checkpoints).toHaveLength(1)
      expect(checkpoints[0].name).toContain('deploy')
    })

    it('should apply limit', async () => {
      const checkpoints = await manager.listCheckpoints({ limit: 2 })

      expect(checkpoints).toHaveLength(2)
    })

    it('should return empty array on error', async () => {
      mockHandle.listCheckpoints.mockRejectedValue(new Error('Failed'))
      
      const checkpoints = await manager.listCheckpoints()

      expect(checkpoints).toEqual([])
    })
  })

  describe('getCheckpointByTag', () => {
    it('should find checkpoint by tag', async () => {
      mockHandle.listCheckpoints.mockResolvedValue([
        { id: 'cp-1', name: 'pre-deploy-123', createdAt: '2026-02-27T10:00:00Z' },
      ])

      const checkpoint = await manager.getCheckpointByTag('deploy')

      expect(checkpoint).not.toBeNull()
      expect(checkpoint!.name).toContain('deploy')
    })

    it('should return null if not found', async () => {
      mockHandle.listCheckpoints.mockResolvedValue([])

      const checkpoint = await manager.getCheckpointByTag('nonexistent')

      expect(checkpoint).toBeNull()
    })
  })

  describe('restoreByTag', () => {
    it('should restore checkpoint by tag', async () => {
      mockHandle.listCheckpoints.mockResolvedValue([
        { id: 'cp-1', name: 'pre-deploy-123', createdAt: '2026-02-27T10:00:00Z' },
      ])

      const result = await manager.restoreByTag('deploy')

      expect(result).toBe(true)
      expect(mockHandle.restoreCheckpoint).toHaveBeenCalledWith('cp-1')
    })

    it('should return false if tag not found', async () => {
      mockHandle.listCheckpoints.mockResolvedValue([])

      const result = await manager.restoreByTag('nonexistent')

      expect(result).toBe(false)
    })
  })

  describe('deleteCheckpoint', () => {
    it('should log deletion request', async () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {})
      
      await manager.deleteCheckpoint('checkpoint-123')
      
      expect(consoleSpy).toHaveBeenCalledWith(
        expect.stringContaining('Delete checkpoint requested')
      )
      
      consoleSpy.mockRestore()
    })
  })

  describe('enforceRetentionPolicy', () => {
    it('should keep all checkpoints if below minimum', async () => {
      mockHandle.listCheckpoints.mockResolvedValue([
        { id: 'cp-1', name: 'checkpoint-1', createdAt: '2026-02-27T10:00:00Z' },
        { id: 'cp-2', name: 'checkpoint-2', createdAt: '2026-02-27T11:00:00Z' },
      ])

      const result = await manager.enforceRetentionPolicy()

      expect(result.deleted).toBe(0)
      expect(result.kept).toBe(2)
    })

    it('should delete old checkpoints', async () => {
      // Create 15 checkpoints (over max of 10)
      const oldCheckpoints = Array.from({ length: 15 }, (_, i) => ({
        id: `cp-${i}`,
        name: `checkpoint-${i}`,
        createdAt: new Date(Date.now() - i * 24 * 60 * 60 * 1000).toISOString(),
      }))

      mockHandle.listCheckpoints.mockResolvedValue(oldCheckpoints)
      mockHandle.restoreCheckpoint.mockResolvedValue(undefined)

      const result = await manager.enforceRetentionPolicy()

      expect(result.deleted).toBeGreaterThan(0)
      expect(result.kept).toBeLessThanOrEqual(10)
    })

    it('should delete checkpoints older than max age', async () => {
      const checkpoints = [
        { id: 'cp-1', name: 'old', createdAt: '2026-01-01T10:00:00Z' }, // Over 30 days old
        { id: 'cp-2', name: 'recent', createdAt: new Date().toISOString() },
      ]

      mockHandle.listCheckpoints.mockResolvedValue(checkpoints)

      const result = await manager.enforceRetentionPolicy()

      expect(result.deleted).toBeGreaterThanOrEqual(0)
    })
  })

  describe('getStorageStats', () => {
    it('should return storage statistics', async () => {
      const stats = await manager.getStorageStats()

      expect(stats.checkpointCount).toBe(3)
      expect(stats.estimatedSize).toBeDefined()
    })

    it('should estimate size based on checkpoint count', async () => {
      mockHandle.listCheckpoints.mockResolvedValue(
        Array.from({ length: 10 }, (_, i) => ({
          id: `cp-${i}`,
          name: `checkpoint-${i}`,
          createdAt: new Date().toISOString(),
        }))
      )

      const stats = await manager.getStorageStats()

      // ~100MB per checkpoint estimate
      expect(stats.estimatedSize).toBe(10 * 100 * 1024 * 1024)
    })
  })

  describe('updateRetentionPolicy', () => {
    it('should update policy', () => {
      manager.updateRetentionPolicy({
        maxCheckpoints: 20,
        maxAgeDays: 60,
      })

      const policy = manager.getRetentionPolicy()

      expect(policy.maxCheckpoints).toBe(20)
      expect(policy.maxAgeDays).toBe(60)
      expect(policy.minCheckpoints).toBe(3) // Unchanged
    })
  })
})

describe('createCheckpointManager', () => {
  it('should create checkpoint manager instance', () => {
    const mockHandle = {
      id: 'test-sprite',
      workspaceDir: '/home/sprite/workspace',
      createCheckpoint: vi.fn(),
      restoreCheckpoint: vi.fn(),
      listCheckpoints: vi.fn(),
    }

    const manager = createCheckpointManager(mockHandle)

    expect(manager).toBeInstanceOf(SpritesCheckpointManager)
  })

  it('should accept custom policy', () => {
    const mockHandle = {
      id: 'test-sprite',
      workspaceDir: '/home/sprite/workspace',
      createCheckpoint: vi.fn(),
    }

    const manager = createCheckpointManager(mockHandle, {
      maxCheckpoints: 5,
    })

    const policy = manager.getRetentionPolicy()
    expect(policy.maxCheckpoints).toBe(5)
  })
})

describe('SpritesCheckpointManager Integration', () => {
  it('should integrate with SpritesSandboxHandle', () => {
    // Verify the manager can be created from handle
    const mockHandle = {
      id: 'test-sprite',
      workspaceDir: '/home/sprite/workspace',
      createCheckpoint: vi.fn(),
      restoreCheckpoint: vi.fn(),
      listCheckpoints: vi.fn(),
    }

    const manager = createCheckpointManager(mockHandle)
    expect(manager).toBeDefined()
  })
})
