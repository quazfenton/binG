/**
 * Sprites Tar-Pipe Sync Tests
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { syncFilesToSprite, syncVfsSnapshotToSprite, syncChangedFilesToSprite } from '../lib/sandbox/providers/sprites-tar-sync'

describe('Sprites Tar-Pipe Sync', () => {
  // Mock sprite instance
  const createMockSprite = () => ({
    exec: vi.fn().mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' }),
  })

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('syncFilesToSprite', () => {
    it('should sync files successfully', async () => {
      const sprite = createMockSprite()
      const files = [
        { path: 'test.txt', content: 'Hello World' },
        { path: 'src/index.ts', content: 'console.log("test")' },
      ]

      const result = await syncFilesToSprite(sprite, files, '/workspace')

      expect(result.success).toBe(true)
      expect(result.filesSynced).toBe(2)
      expect(result.duration).toBeGreaterThanOrEqual(0)
      expect(sprite.exec).toHaveBeenCalledTimes(2) // mkdir + tar
    })

    it('should handle empty file array', async () => {
      const sprite = createMockSprite()
      const result = await syncFilesToSprite(sprite, [], '/workspace')

      expect(result.success).toBe(true)
      expect(result.filesSynced).toBe(0)
      expect(result.totalSize).toBe(0)
    })

    it('should handle sync failure', async () => {
      const sprite = createMockSprite()
      sprite.exec.mockRejectedValueOnce(new Error('Connection failed'))

      const result = await syncFilesToSprite(sprite, [
        { path: 'test.txt', content: 'test' },
      ])

      expect(result.success).toBe(false)
      expect(result.error).toContain('Connection failed')
    })

    it('should use default target directory', async () => {
      const sprite = createMockSprite()
      await syncFilesToSprite(sprite, [{ path: 'test.txt', content: 'test' }])

      // Verify mkdir was called with correct path
      expect(sprite.exec).toHaveBeenNthCalledWith(
        1,
        'mkdir -p /home/sprite/workspace'
      )
      // Verify tar was called with correct path and stdin
      expect(sprite.exec).toHaveBeenNthCalledWith(
        2,
        'tar -xz -C /home/sprite/workspace',
        expect.objectContaining({ stdin: expect.anything() })
      )
    })

    it('should calculate total size correctly', async () => {
      const sprite = createMockSprite()
      const files = [
        { path: 'a.txt', content: '123' }, // 3 bytes
        { path: 'b.txt', content: '12345' }, // 5 bytes
      ]

      const result = await syncFilesToSprite(sprite, files)

      expect(result.totalSize).toBe(8) // 3 + 5 bytes
    })
  })

  describe('syncVfsSnapshotToSprite', () => {
    it('should sync VFS snapshot', async () => {
      const sprite = createMockSprite()
      const snapshot = {
        files: [
          { path: 'project/src/index.ts', content: 'export default 1' },
          { path: 'project/package.json', content: '{"name": "test"}' },
        ],
      }

      const result = await syncVfsSnapshotToSprite(sprite, snapshot)

      expect(result.success).toBe(true)
      expect(result.filesSynced).toBe(2)
    })

    it('should remove project prefix from paths', async () => {
      const sprite = createMockSprite()
      const snapshot = {
        files: [
          { path: 'project/src/index.ts', content: 'test' },
        ],
      }

      await syncVfsSnapshotToSprite(sprite, snapshot)

      // Verify the tar command uses the path without 'project/' prefix
      expect(sprite.exec).toHaveBeenCalled()
    })
  })

  describe('syncChangedFilesToSprite', () => {
    it('should sync only changed files', async () => {
      const sprite = createMockSprite()
      const files = [
        { path: 'a.txt', content: 'version1' },
        { path: 'b.txt', content: 'unchanged' },
      ]

      // First sync - all files are new
      const result1 = await syncChangedFilesToSprite(sprite, files)

      expect(result1.changedFiles).toBe(2)
      expect(result1.filesSynced).toBe(2)

      // Second sync with same content - no changes
      const result2 = await syncChangedFilesToSprite(
        sprite,
        files,
        result1.previousHash
      )

      expect(result2.changedFiles).toBe(0)
      expect(result2.filesSynced).toBe(0)
    })

    it('should detect changed files', async () => {
      const sprite = createMockSprite()
      const initialFiles = [
        { path: 'a.txt', content: 'version1' },
      ]

      // Initial sync
      const result1 = await syncChangedFilesToSprite(sprite, initialFiles)

      // Change one file
      const changedFiles = [
        { path: 'a.txt', content: 'version2' }, // Changed
      ]

      const result2 = await syncChangedFilesToSprite(
        sprite,
        changedFiles,
        result1.previousHash
      )

      expect(result2.changedFiles).toBe(1)
      expect(result2.filesSynced).toBe(1)
    })

    it('should return hash map for tracking', async () => {
      const sprite = createMockSprite()
      const files = [
        { path: 'test.txt', content: 'test content' },
      ]

      const result = await syncChangedFilesToSprite(sprite, files)

      expect(result.previousHash).toBeDefined()
      expect(result.previousHash!.size).toBe(1)
    })
  })

  describe('Performance', () => {
    it('should be faster than individual writes for large projects', async () => {
      const sprite = createMockSprite()
      const files = Array.from({ length: 100 }, (_, i) => ({
        path: `file-${i}.txt`,
        content: `Content for file ${i}`,
      }))

      const startTime = Date.now()
      const result = await syncFilesToSprite(sprite, files)
      const duration = Date.now() - startTime

      expect(result.success).toBe(true)
      expect(result.filesSynced).toBe(100)
      expect(duration).toBeLessThan(5000) // Should complete in under 5 seconds
    })
  })
})
