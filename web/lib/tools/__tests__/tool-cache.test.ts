import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Cache, toolResultCache, toolCacheKey } from '../../cache'
import { invalidateToolCache, getToolCacheStats, executeToolCapability } from '../execute-capability'

describe('Tool Caching', () => {
  beforeEach(() => {
    toolResultCache.clear()
  })

  describe('Cache', () => {
    it('should store and retrieve values', () => {
      const cache = new Cache(10)
      cache.set('key1', { data: 'test' })
      expect(cache.get('key1')).toEqual({ data: 'test' })
    })

    it('should return null for expired entries', async () => {
      const cache = new Cache(10)
      cache.set('key', 'value', 1) // 1ms TTL

      await new Promise(r => setTimeout(r, 10))
      expect(cache.get('key')).toBeNull()
    })

    it('should track size', () => {
      const cache = new Cache(2)
      cache.set('a', 1)
      cache.set('b', 2)
      expect(cache.getStats().size).toBe(2)
    })
  })

  describe('toolCacheKey', () => {
    it('should generate file read keys', () => {
      const key = toolCacheKey.fileRead('/workspace/test.js')
      expect(key).toContain('tool:file:read:')
      expect(key).toContain('/workspace/test.js')
    })

    it('should include hash for file read with hash', () => {
      const key = toolCacheKey.fileRead('/workspace/test.js', 'abc123')
      expect(key).toContain(':abc123')
    })

    it('should generate file list keys', () => {
      const key = toolCacheKey.fileList('/workspace')
      expect(key).toBe('tool:file:list:/workspace')
    })

    it('should generate file search keys', () => {
      const key = toolCacheKey.fileSearch('query', '/workspace')
      expect(key).toContain('query')
      expect(key).toContain('/workspace')
    })
  })

  describe('invalidateToolCache', () => {
    it('should clear all cache when called with *', () => {
      toolResultCache.set('tool:file:read:/test', { content: 'test' })
      invalidateToolCache('*')
      expect(toolResultCache.get('tool:file:read:/test')).toBeNull()
    })

    it('should clear specific path cache', () => {
      toolResultCache.set('tool:file:read:/workspace/test.js', { content: 'test' })
      invalidateToolCache('file.read', '/workspace/test.js')
      expect(toolResultCache.get('tool:file:read:/workspace/test.js')).toBeNull()
    })
  })

  describe('getToolCacheStats', () => {
    it('should return cache statistics', () => {
      toolResultCache.set('key1', 'value1')
      toolResultCache.set('key2', 'value2')

      const stats = getToolCacheStats()
      expect(stats.size).toBe(2)
      expect(stats.maxSize).toBe(500)
    })
  })
})