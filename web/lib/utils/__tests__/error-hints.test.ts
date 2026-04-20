import { describe, it, expect, beforeEach } from 'vitest'
import { UnifiedErrorHandler, ErrorCategory } from '../error-handler'

describe('Error Handler Hints', () => {
  let handler: UnifiedErrorHandler

  beforeEach(() => {
    handler = UnifiedErrorHandler.getInstance()
  })

  describe('generateHints', () => {
    it('should not produce duplicate hints', () => {
      const result = handler.handleError(
        new Error('Test error'),
        { component: 'test' },
        {}
      )
      
      // Extract unique hints from the processed error
      const uniqueHints = new Set(result.hints || [])
      expect(uniqueHints.size).toBe((result.hints || []).length)
    })

    it('should handle permission errors with solutions', () => {
      const result = handler.handleError(
        new Error('Permission denied: EACCES'),
        { component: 'filesystem' },
        {}
      )
      
      const hints = result.hints || []
      expect(hints.some(h => h.includes('chmod') || h.includes('permission'))).toBe(true)
    })

    it('should handle network errors with solutions', () => {
      const result = handler.handleError(
        new Error('Connection refused: ECONNREFUSED'),
        { component: 'network' },
        {}
      )
      
      const hints = result.hints || []
      expect(hints.some(h => h.includes('service') || h.includes('port'))).toBe(true)
    })

    it('should handle not found errors with solutions', () => {
      const result = handler.handleError(
        new Error('File not found: ENOENT'),
        { component: 'filesystem' },
        {}
      )
      
      const hints = result.hints || []
      expect(hints.some(h => h.includes('path') || h.includes('file'))).toBe(true)
    })

    it('should provide authentication solutions', () => {
      const result = handler.handleError(
        new Error('Invalid API key'),
        { component: 'auth' },
        {}
      )

      const hints = result.hints || []
      expect(hints.length).toBeGreaterThan(0)
    })

    it('should provide provider-specific solutions', () => {
      const result = handler.handleError(
        new Error('OpenAI rate limit exceeded'),
        { component: 'provider' },
        {}
      )

      const hints = result.hints || []
      expect(hints.length).toBeGreaterThan(0)
    })
  })

  describe('hint formatting', () => {
    it('should not include excessively large parameter data', () => {
      const largeObject = { data: 'x'.repeat(1000) }
      
      const result = handler.handleError(
        new Error('Validation error'),
        { component: 'test' },
        largeObject
      )
      
      const paramHint = (result.hints || []).find(h => h.includes('Provided parameters'))
      if (paramHint) {
        expect(paramHint.length).toBeLessThan(600)
      }
    })
  })
})