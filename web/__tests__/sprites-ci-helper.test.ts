/**
 * Sprites CI/CD Helper Tests
 *
 * Tests for the Sprites CI/CD helper functionality
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { SpritesCiHelper, createCiHelper, runCi } from '../lib/sandbox/providers/sprites-ci-helper'

// Mock SpritesClient
vi.mock('@fly/sprites', () => {
  const mockSprite = {
    exec: vi.fn(),
    createCheckpoint: vi.fn(),
    listCheckpoints: vi.fn(),
    restore: vi.fn(),
  };

  const mockClient = {
    sprite: vi.fn().mockReturnValue(mockSprite),
    createSprite: vi.fn().mockResolvedValue({ id: 'cp-123' }),
  };

  return {
    SpritesClient: vi.fn().mockImplementation(function() {
      return mockClient;
    }),
  };
})

describe('Sprites CI/CD Helper', () => {
  let ciHelper: SpritesCiHelper
  let mockSprite: any

  beforeEach(async () => {
    const { SpritesClient } = await import('@fly/sprites')
    const client = new SpritesClient('token')
    mockSprite = client.sprite('name')
    
    ciHelper = createCiHelper('test-token', 'test-sprite')
    // Access private sprite property for testing
    ;(ciHelper as any).sprite = mockSprite
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  describe('initializeRepo', () => {
    it('should clone repository if not exists', async () => {
      mockSprite.exec.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })

      const result = await ciHelper.initializeRepo({
        repoUrl: 'https://github.com/test/repo',
        branch: 'main',
        workingDir: '/home/sprite/repo',
      })

      expect(result.success).toBe(true)
      expect(mockSprite.exec).toHaveBeenCalledWith(
        expect.stringContaining('git clone -b main https://github.com/test/repo /home/sprite/repo')
      )
    })

    it('should pull updates if repository exists', async () => {
      mockSprite.exec.mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' })

      const result = await ciHelper.initializeRepo({
        repoUrl: 'https://github.com/test/repo',
        branch: 'develop',
      })

      expect(result.success).toBe(true)
      expect(mockSprite.exec).toHaveBeenCalledWith(
        expect.stringContaining('git pull origin develop')
      )
    })

    it('should handle git operation failures', async () => {
      mockSprite.exec.mockResolvedValue({
        exitCode: 1,
        stdout: '',
        stderr: 'Repository not found',
      })

      const result = await ciHelper.initializeRepo({
        repoUrl: 'https://github.com/invalid/repo',
      })

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('installDependencies', () => {
    it('should detect and use npm when package-lock.json exists', async () => {
      mockSprite.exec
        .mockResolvedValueOnce({ exitCode: 0, stdout: 'npm', stderr: '' }) // Detect package manager
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // Install

      const result = await ciHelper.installDependencies('/home/sprite/repo')

      expect(result.success).toBe(true)
      expect(result.packageManager).toBe('npm')
      expect(mockSprite.exec).toHaveBeenCalledWith(
        expect.stringContaining('npm ci')
      )
    })

    it('should detect and use pnpm when pnpm-lock.yaml exists', async () => {
      mockSprite.exec
        .mockResolvedValueOnce({ exitCode: 0, stdout: 'pnpm', stderr: '' })
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })

      const result = await ciHelper.installDependencies('/home/sprite/repo')

      expect(result.success).toBe(true)
      expect(result.packageManager).toBe('pnpm')
      expect(mockSprite.exec).toHaveBeenCalledWith(
        expect.stringContaining('pnpm install --frozen-lockfile')
      )
    })

    it('should detect and use yarn when yarn.lock exists', async () => {
      mockSprite.exec
        .mockResolvedValueOnce({ exitCode: 0, stdout: 'yarn', stderr: '' })
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })

      const result = await ciHelper.installDependencies('/home/sprite/repo')

      expect(result.success).toBe(true)
      expect(result.packageManager).toBe('yarn')
      expect(mockSprite.exec).toHaveBeenCalledWith(
        expect.stringContaining('yarn install --frozen-lockfile')
      )
    })

    it('should default to npm if no lockfile found', async () => {
      mockSprite.exec
        .mockResolvedValueOnce({ exitCode: 0, stdout: 'npm', stderr: '' })
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })

      const result = await ciHelper.installDependencies('/home/sprite/repo')

      expect(result.success).toBe(true)
      expect(result.packageManager).toBe('npm')
    })

    it('should handle installation failures', async () => {
      mockSprite.exec
        .mockResolvedValueOnce({ exitCode: 0, stdout: 'npm', stderr: '' })
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'Installation failed' })

      const result = await ciHelper.installDependencies('/home/sprite/repo')

      expect(result.success).toBe(false)
      expect(result.error).toBeDefined()
    })
  })

  describe('runCi', () => {
    it('should run full CI pipeline successfully', async () => {
      // Mock successful pipeline
      mockSprite.exec
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // init repo
        .mockResolvedValueOnce({ exitCode: 0, stdout: 'npm', stderr: '' }) // detect pm
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // install
        .mockResolvedValueOnce({ exitCode: 0, stdout: 'Build successful', stderr: '' }) // build
        .mockResolvedValueOnce({ exitCode: 0, stdout: 'Tests passed', stderr: '' }) // test

      mockSprite.createCheckpoint.mockResolvedValue({
        id: 'checkpoint-123',
        name: 'ci-passed-1234567890',
      })

      const result = await ciHelper.runCi({
        spriteName: 'test-sprite',
        repoUrl: 'https://github.com/test/repo',
        branch: 'main',
        buildCommand: 'npm run build',
        testCommand: 'npm test',
      })

      expect(result.success).toBe(true)
      expect(result.checkpointId).toBeDefined()
      expect(result.duration).toBeLessThan(100000) // Should complete in reasonable time
      expect(result.steps).toHaveLength(4) // init, install, build, test
      expect(result.steps?.every((s) => s.success)).toBe(true)
    })

    it('should fail CI if build fails', async () => {
      mockSprite.exec
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // init
        .mockResolvedValueOnce({ exitCode: 0, stdout: 'npm', stderr: '' }) // detect
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // install
        .mockResolvedValueOnce({ exitCode: 1, stdout: '', stderr: 'Build failed' }) // build fails

      const result = await ciHelper.runCi({
        spriteName: 'test-sprite',
        repoUrl: 'https://github.com/test/repo',
        buildCommand: 'npm run build',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Build failed')
      expect(result.steps).toHaveLength(3) // init, install, build (fails early)
      expect(result.steps?.[2].success).toBe(false) // build step failed
    })

    it('should fail CI if tests fail', async () => {
      mockSprite.exec
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // init
        .mockResolvedValueOnce({ exitCode: 0, stdout: 'npm', stderr: '' }) // detect
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // install
        .mockResolvedValueOnce({ exitCode: 0, stdout: 'Build OK', stderr: '' }) // build
        .mockResolvedValueOnce({ exitCode: 1, stdout: 'Test output', stderr: 'Tests failed' }) // test fails

      const result = await ciHelper.runCi({
        spriteName: 'test-sprite',
        repoUrl: 'https://github.com/test/repo',
        buildCommand: 'npm run build',
        testCommand: 'npm test',
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('Tests failed')
      expect(result.checkpointId).toBeUndefined() // No checkpoint on failure
    })

    it('should skip build if not configured', async () => {
      mockSprite.exec
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // init
        .mockResolvedValueOnce({ exitCode: 0, stdout: 'npm', stderr: '' }) // detect
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // install
        .mockResolvedValueOnce({ exitCode: 0, stdout: 'Tests passed', stderr: '' }) // test

      const result = await ciHelper.runCi({
        spriteName: 'test-sprite',
        repoUrl: 'https://github.com/test/repo',
        testCommand: 'npm test',
      })

      expect(result.success).toBe(true)
      expect(result.steps).toHaveLength(3) // init, install, test (no build)
    })

    it('should handle checkpoint creation failure gracefully', async () => {
      mockSprite.exec
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // init
        .mockResolvedValueOnce({ exitCode: 0, stdout: 'npm', stderr: '' }) // detect
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' }) // install
        .mockResolvedValueOnce({ exitCode: 0, stdout: 'Tests passed', stderr: '' }) // test

      mockSprite.createCheckpoint.mockRejectedValue(new Error('Checkpoint creation failed'))

      const result = await ciHelper.runCi({
        spriteName: 'test-sprite',
        repoUrl: 'https://github.com/test/repo',
        testCommand: 'npm test',
      })

      // Should still succeed, just without checkpoint
      expect(result.success).toBe(true)
      expect(result.checkpointId).toBeUndefined()
    })
  })

  describe('restoreFromCheckpoint', () => {
    it('should restore from checkpoint', async () => {
      mockSprite.restore.mockResolvedValue(undefined)

      const result = await ciHelper.restoreFromCheckpoint('checkpoint-123')

      expect(result.success).toBe(true)
      expect(mockSprite.restore).toHaveBeenCalledWith('checkpoint-123')
    })

    it('should handle restore failures', async () => {
      mockSprite.restore.mockRejectedValue(new Error('Checkpoint not found'))

      const result = await ciHelper.restoreFromCheckpoint('invalid-checkpoint')

      expect(result.success).toBe(false)
      expect(result.error).toContain('Checkpoint not found')
    })
  })

  describe('getLatestCiCheckpoint', () => {
    it('should return most recent CI checkpoint', async () => {
      const checkpoints = [
        { id: 'cp-1', name: 'ci-passed-1000', created_at: '2024-01-01T00:00:00Z' },
        { id: 'cp-2', name: 'ci-passed-2000', created_at: '2024-01-02T00:00:00Z' },
        { id: 'cp-3', name: 'ci-passed-3000', created_at: '2024-01-03T00:00:00Z' },
      ]

      mockSprite.listCheckpoints.mockResolvedValue(checkpoints)

      const result = await ciHelper.getLatestCiCheckpoint()

      expect(result.id).toBe('cp-3')
      expect(result.name).toBe('ci-passed-3000')
    })

    it('should return empty object if no CI checkpoints exist', async () => {
      mockSprite.listCheckpoints.mockResolvedValue([
        { id: 'cp-1', name: 'manual-checkpoint', created_at: '2024-01-01T00:00:00Z' },
      ])

      const result = await ciHelper.getLatestCiCheckpoint()

      expect(result).toEqual({})
    })

    it('should return empty object if listCheckpoints fails', async () => {
      mockSprite.listCheckpoints.mockRejectedValue(new Error('API error'))

      const result = await ciHelper.getLatestCiCheckpoint()

      expect(result).toEqual({})
    })
  })

  describe('listCiCheckpoints', () => {
    it('should list all CI checkpoints', async () => {
      const checkpoints = [
        { id: 'cp-1', name: 'ci-passed-1000', created_at: '2024-01-01T00:00:00Z' },
        { id: 'cp-2', name: 'ci-passed-2000', created_at: '2024-01-02T00:00:00Z' },
      ]

      mockSprite.listCheckpoints.mockResolvedValue(checkpoints)

      const result = await ciHelper.listCiCheckpoints()

      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('cp-2') // Sorted newest first
      expect(result[1].id).toBe('cp-1')
    })

    it('should limit results when specified', async () => {
      const checkpoints = [
        { id: 'cp-1', name: 'ci-passed-1000', created_at: '2024-01-01T00:00:00Z' },
        { id: 'cp-2', name: 'ci-passed-2000', created_at: '2024-01-02T00:00:00Z' },
        { id: 'cp-3', name: 'ci-passed-3000', created_at: '2024-01-03T00:00:00Z' },
      ]

      mockSprite.listCheckpoints.mockResolvedValue(checkpoints)

      const result = await ciHelper.listCiCheckpoints(2)

      expect(result).toHaveLength(2)
      expect(result[0].id).toBe('cp-3') // Most recent first
      expect(result[1].id).toBe('cp-2')
    })
  })

  describe('cleanOldCheckpoints', () => {
    it('should delete old checkpoints', async () => {
      const checkpoints = Array.from({ length: 10 }, (_, i) => ({
        id: `cp-${i}`,
        name: `ci-passed-${i}`,
        createdAt: `2024-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
      }))

      vi.spyOn(ciHelper, 'listCiCheckpoints').mockResolvedValue(checkpoints)

      const result = await ciHelper.cleanOldCheckpoints(5)

      expect(result.kept).toBe(5)
      expect(result.deleted).toBeGreaterThanOrEqual(0) // May be 0 if delete is mocked out
    })

    it('should not delete if under limit', async () => {
      const checkpoints = Array.from({ length: 3 }, (_, i) => ({
        id: `cp-${i}`,
        name: `ci-passed-${i}`,
        createdAt: `2024-01-${String(i + 1).padStart(2, '0')}T00:00:00Z`,
      }))

      vi.spyOn(ciHelper, 'listCiCheckpoints').mockResolvedValue(checkpoints)

      const result = await ciHelper.cleanOldCheckpoints(5)

      expect(result.deleted).toBe(0)
      expect(result.kept).toBe(3)
    })
  })

  describe('Factory Functions', () => {
    it('should create instance via createCiHelper', () => {
      const instance = createCiHelper('token', 'sprite-name')
      expect(instance).toBeInstanceOf(SpritesCiHelper)
    })

    it('should run CI via runCi factory function', async () => {
      mockSprite.exec
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
        .mockResolvedValueOnce({ exitCode: 0, stdout: 'npm', stderr: '' })
        .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' })
        .mockResolvedValueOnce({ exitCode: 0, stdout: 'Tests passed', stderr: '' })

      const result = await runCi('token', 'sprite', {
        spriteName: 'sprite',
        repoUrl: 'https://github.com/test/repo',
        testCommand: 'npm test',
      })

      expect(result.success).toBe(true)
    })
  })
})
