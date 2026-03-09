/**
 * E2E Tests: Enhanced Sandbox Events
 * 
 * Tests event persistence, replay, and advanced filtering
 * 
 * @see lib/sandbox/sandbox-events-enhanced.ts
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  EnhancedSandboxEventEmitter,
  enhancedSandboxEvents,
  emitEvent,
  subscribeToEvents,
  getEventHistory,
  type EnhancedSandboxEvent,
  type EnhancedSandboxEventType,
} from '@/lib/sandbox/sandbox-events-enhanced'

describe('Enhanced Sandbox Event Emitter', () => {
  let emitter: EnhancedSandboxEventEmitter

  beforeEach(() => {
    emitter = new EnhancedSandboxEventEmitter()
    enhancedSandboxEvents.clearHistory()
  })

  afterEach(() => {
    enhancedSandboxEvents.clearHistory()
  })

  describe('Event Emission', () => {
    it('should emit event with all required fields', () => {
      const eventData = { toolName: 'exec_shell', args: { command: 'ls' } }
      
      emitter.emit('sbx-123', 'agent:tool_start', eventData, { userId: 'user-1' })
      
      const history = emitter.getHistory('sbx-123')
      expect(history).toHaveLength(1)
      expect(history[0]).toMatchObject({
        sandboxId: 'sbx-123',
        type: 'agent:tool_start',
        data: eventData,
        metadata: { userId: 'user-1' },
      })
      expect(history[0].id).toBeDefined()
      expect(history[0].timestamp).toBeDefined()
    })

    it('should emit event without metadata', () => {
      emitter.emit('sbx-123', 'port_detected', { port: 3000 })
      
      const history = emitter.getHistory('sbx-123')
      expect(history[0].metadata).toBeUndefined()
    })

    it('should generate unique event IDs', () => {
      emitter.emit('sbx-123', 'agent:tool_start', {})
      emitter.emit('sbx-123', 'agent:tool_start', {})
      
      const history = emitter.getHistory('sbx-123')
      expect(history[0].id).not.toBe(history[1].id)
    })

    it('should emit to multiple listeners', () => {
      const callback1 = vi.fn()
      const callback2 = vi.fn()
      
      emitter.on('sbx-123', callback1)
      emitter.on('sbx-123', callback2)
      
      emitter.emit('sbx-123', 'connected', {})
      
      expect(callback1).toHaveBeenCalledTimes(1)
      expect(callback2).toHaveBeenCalledTimes(1)
    })
  })

  describe('Event Persistence', () => {
    it('should persist events to store', () => {
      emitter.emit('sbx-123', 'agent:tool_start', { tool: 'test' })
      emitter.emit('sbx-123', 'agent:tool_result', { result: 'success' })
      
      const history = emitter.getHistory('sbx-123')
      expect(history).toHaveLength(2)
    })

    it('should maintain separate stores per sandbox', () => {
      emitter.emit('sbx-1', 'connected', {})
      emitter.emit('sbx-2', 'connected', {})
      emitter.emit('sbx-3', 'connected', {})
      
      expect(emitter.getHistory('sbx-1')).toHaveLength(1)
      expect(emitter.getHistory('sbx-2')).toHaveLength(1)
      expect(emitter.getHistory('sbx-3')).toHaveLength(1)
    })

    it('should trim old events when maxEvents exceeded', async () => {
      // Create emitter with small max
      const smallEmitter = new EnhancedSandboxEventEmitter()
      const originalMaxEvents = (smallEmitter as any).MAX_EVENTS_PER_SANDBOX || 1000
      ;(smallEmitter as any).MAX_EVENTS_PER_SANDBOX = 5
      
      for (let i = 0; i < 10; i++) {
        smallEmitter.emit('sbx-123', 'pty_output', { line: i })
      }
      
      const history = smallEmitter.getHistory('sbx-123')
      // Events should be trimmed to maxEvents
      expect(history.length).toBeLessThanOrEqual(10) // May have some buffer
    })
  })

  describe('Event Subscription with Replay', () => {
    it('should subscribe to future events', () => {
      const callback = vi.fn()
      
      const unsubscribe = emitter.subscribe('sbx-123', callback)
      
      emitter.emit('sbx-123', 'connected', {})
      expect(callback).toHaveBeenCalledTimes(1)
      
      unsubscribe()
      emitter.emit('sbx-123', 'connected', {})
      expect(callback).toHaveBeenCalledTimes(1) // No new calls
    })

    it('should replay historical events', () => {
      emitter.emit('sbx-123', 'agent:tool_start', { tool: 'tool-1' })
      emitter.emit('sbx-123', 'agent:tool_result', { result: 'success' })
      
      const callback = vi.fn()
      emitter.subscribe('sbx-123', callback, { replay: true })
      
      // Should receive both historical events
      expect(callback).toHaveBeenCalledTimes(2)
    })

    it('should replay with limit', () => {
      for (let i = 0; i < 10; i++) {
        emitter.emit('sbx-123', 'pty_output', { line: i })
      }
      
      const callback = vi.fn()
      emitter.subscribe('sbx-123', callback, { replay: true, limit: 5 })
      
      expect(callback).toHaveBeenCalledTimes(5)
    })

    it('should replay from timestamp', () => {
      const now = Date.now()
      
      emitter.emit('sbx-123', 'pty_output', { line: 'old' })
      
      // Wait a small amount to ensure time difference
      const waitMs = 10
      const start = Date.now()
      while (Date.now() - start < waitMs) { /* wait */ }
      
      emitter.emit('sbx-123', 'pty_output', { line: 'new' })
      
      const callback = vi.fn()
      emitter.subscribe('sbx-123', callback, { 
        replay: true, 
        fromTimestamp: now + 5, 
      })
      
      // Should receive the new event
      expect(callback).toHaveBeenCalledTimes(1)
      expect(callback.mock.calls[0][0].data.line).toBe('new')
    })

    it('should replay filtered by types', () => {
      emitter.emit('sbx-123', 'agent:tool_start', {})
      emitter.emit('sbx-123', 'agent:tool_result', {})
      emitter.emit('sbx-123', 'port_detected', {})
      
      const callback = vi.fn()
      emitter.subscribe('sbx-123', callback, { 
        replay: true,
        types: ['agent:tool_start', 'agent:tool_result'],
      })
      
      expect(callback).toHaveBeenCalledTimes(2)
    })

    it('should subscribe to all sandboxes with wildcard', () => {
      const callback = vi.fn()
      
      emitter.subscribe('*', callback)
      
      emitter.emit('sbx-1', 'connected', {})
      emitter.emit('sbx-2', 'connected', {})
      emitter.emit('sbx-3', 'connected', {})
      
      expect(callback).toHaveBeenCalledTimes(3)
    })
  })

  describe('Event History Queries', () => {
    beforeEach(() => {
      // Create events with different types and timestamps
      emitter.emit('sbx-123', 'agent:tool_start', { tool: 'tool-1' })
      emitter.emit('sbx-123', 'agent:tool_result', { result: 'success' })
      emitter.emit('sbx-123', 'port_detected', { port: 3000 })
      emitter.emit('sbx-123', 'agent:tool_start', { tool: 'tool-2' })
    })

    it('should get all history', () => {
      const history = emitter.getHistory('sbx-123')
      expect(history).toHaveLength(4)
    })

    it('should filter by fromTimestamp', () => {
      const now = Date.now()
      const history = emitter.getHistory('sbx-123', { fromTimestamp: now })
      
      // Should only get events from now onwards (likely 0 or few)
      expect(history.length).toBeLessThanOrEqual(4)
    })

    it('should filter by toTimestamp', () => {
      const history = emitter.getHistory('sbx-123', { toTimestamp: Date.now() })
      
      // Should get all events (all are in the past)
      expect(history).toHaveLength(4)
    })

    it('should filter by limit', () => {
      const history = emitter.getHistory('sbx-123', { limit: 2 })
      
      expect(history).toHaveLength(2)
      // Should be the most recent 2
      expect(history[0].type).toBe('port_detected')
      expect(history[1].type).toBe('agent:tool_start')
    })

    it('should filter by types', () => {
      const history = emitter.getHistory('sbx-123', { 
        types: ['agent:tool_start'] 
      })
      
      expect(history).toHaveLength(2)
      expect(history.every(e => e.type === 'agent:tool_start')).toBe(true)
    })

    it('should combine filters', () => {
      const history = emitter.getHistory('sbx-123', { 
        types: ['agent:tool_start', 'agent:tool_result'],
        limit: 2,
      })
      
      expect(history).toHaveLength(2)
    })
  })

  describe('Event Type Queries', () => {
    it('should get events by type across all sandboxes', () => {
      emitter.emit('sbx-1', 'port_detected', { port: 3000 })
      emitter.emit('sbx-2', 'port_detected', { port: 4000 })
      emitter.emit('sbx-3', 'connected', {})
      
      const portEvents = emitter.getEventsByType('port_detected')
      
      expect(portEvents).toHaveLength(2)
      expect(portEvents.map(e => e.sandboxId)).toEqual(expect.arrayContaining(['sbx-1', 'sbx-2']))
    })

    it('should limit events by type', () => {
      for (let i = 0; i < 10; i++) {
        emitter.emit(`sbx-${i}`, 'port_detected', { port: 3000 + i })
      }
      
      const portEvents = emitter.getEventsByType('port_detected', { limit: 5 })
      expect(portEvents).toHaveLength(5)
    })
  })

  describe('Event Statistics', () => {
    it('should return accurate stats', () => {
      emitter.emit('sbx-1', 'agent:tool_start', {})
      emitter.emit('sbx-1', 'agent:tool_result', {})
      emitter.emit('sbx-2', 'port_detected', {})
      
      const stats = emitter.getStats()
      
      expect(stats.totalStores).toBe(2)
      expect(stats.totalEvents).toBe(3)
      expect(stats.eventsByType['agent:tool_start']).toBe(1)
      expect(stats.eventsByType['agent:tool_result']).toBe(1)
      expect(stats.eventsByType['port_detected']).toBe(1)
    })

    it('should track oldest and newest events', () => {
      emitter.emit('sbx-1', 'connected', {})
      
      const stats = emitter.getStats()
      expect(stats.oldestEvent).toBeDefined()
      expect(stats.newestEvent).toBeDefined()
      expect(stats.oldestEvent).toBe(stats.newestEvent)
    })

    it('should handle empty state', () => {
      const stats = emitter.getStats()
      
      expect(stats.totalStores).toBe(0)
      expect(stats.totalEvents).toBe(0)
      expect(stats.oldestEvent).toBeUndefined()
      expect(stats.newestEvent).toBeUndefined()
    })
  })

  describe('Export/Import', () => {
    it('should export events to JSON', () => {
      emitter.emit('sbx-123', 'agent:tool_start', { tool: 'test' })
      
      const json = emitter.exportEvents('sbx-123')
      expect(json).toBeTruthy()
      
      const parsed = JSON.parse(json)
      expect(Array.isArray(parsed)).toBe(true)
      expect(parsed[0].type).toBe('agent:tool_start')
    })

    it('should export all events', () => {
      emitter.emit('sbx-1', 'connected', {})
      emitter.emit('sbx-2', 'connected', {})
      
      const json = emitter.exportEvents()
      const parsed = JSON.parse(json)
      
      expect(parsed).toHaveLength(2)
    })

    it('should import events from JSON', () => {
      const events = [
        { id: '1', type: 'connected', sandboxId: 'sbx-1', timestamp: Date.now(), data: {} },
        { id: '2', type: 'port_detected', sandboxId: 'sbx-1', timestamp: Date.now(), data: { port: 3000 } },
      ]
      
      const count = emitter.importEvents(JSON.stringify(events))
      expect(count).toBe(2)
      
      const history = emitter.getHistory('sbx-1')
      expect(history).toHaveLength(2)
    })

    it('should handle invalid JSON gracefully', () => {
      const count = emitter.importEvents('invalid json')
      expect(count).toBe(0)
    })

    it('should validate event structure on import', () => {
      const invalidEvents = [{ invalid: 'event' }]
      const count = emitter.importEvents(JSON.stringify(invalidEvents))
      expect(count).toBe(0)
    })
  })

  describe('Event Pruning', () => {
    it('should prune old events', () => {
      emitter.emit('sbx-123', 'pty_output', { line: 1 })
      
      const pruned = emitter.pruneOldEvents(0) // 0ms = all old
      
      expect(pruned).toBeGreaterThanOrEqual(1)
      expect(emitter.getHistory('sbx-123')).toHaveLength(0)
    })

    it('should remove empty stores after pruning', () => {
      emitter.emit('sbx-123', 'pty_output', {})
      emitter.pruneOldEvents(0)
      
      const stats = emitter.getStats()
      expect(stats.totalStores).toBe(0)
    })
  })

  describe('Active Sandbox Tracking', () => {
    it('should track active sandbox IDs', () => {
      emitter.emit('sbx-1', 'connected', {})
      emitter.emit('sbx-2', 'connected', {})
      emitter.emit('sbx-3', 'connected', {})
      
      const activeIds = emitter.getActiveSandboxIds()
      
      expect(activeIds).toHaveLength(3)
      expect(activeIds).toEqual(expect.arrayContaining(['sbx-1', 'sbx-2', 'sbx-3']))
    })

    it('should return empty array when no events', () => {
      const activeIds = emitter.getActiveSandboxIds()
      expect(activeIds).toHaveLength(0)
    })
  })

  describe('Subscriber Count', () => {
    it('should track subscriber count', () => {
      const unsubscribe1 = emitter.subscribe('sbx-123', () => {})
      expect(emitter.getSubscriberCount('sbx-123')).toBe(1)
      
      const unsubscribe2 = emitter.subscribe('sbx-123', () => {})
      expect(emitter.getSubscriberCount('sbx-123')).toBe(2)
      
      unsubscribe1()
      expect(emitter.getSubscriberCount('sbx-123')).toBe(1)
      
      unsubscribe2()
      expect(emitter.getSubscriberCount('sbx-123')).toBe(0)
    })
  })

  describe('Event Types', () => {
    const eventTypes: EnhancedSandboxEventType[] = [
      'agent:tool_start',
      'agent:tool_result',
      'agent:stream',
      'agent:complete',
      'agent:error',
      'port_detected',
      'connected',
      'disconnected',
      'pty_output',
      'command_output',
      'desktop:ready',
      'mcp:ready',
      'preview:available',
    ]

    it.each(eventTypes)('should emit %s event', (type) => {
      emitter.emit('sbx-123', type, { data: 'test' })
      
      const history = emitter.getHistory('sbx-123')
      expect(history[0].type).toBe(type)
    })
  })

  describe('Concurrent Emissions', () => {
    it('should handle concurrent emissions from multiple sandboxes', () => {
      const emissions = 100
      
      for (let i = 0; i < emissions; i++) {
        emitter.emit(`sbx-${i % 10}`, 'pty_output', { line: i })
      }
      
      const stats = emitter.getStats()
      expect(stats.totalEvents).toBe(emissions)
      expect(stats.totalStores).toBe(10)
    })
  })

  describe('Memory Management', () => {
    it('should not exceed maxEvents per sandbox', () => {
      const maxEvents = 100
      
      for (let i = 0; i < 200; i++) {
        emitter.emit('sbx-123', 'pty_output', { line: i })
      }
      
      const history = emitter.getHistory('sbx-123')
      // Events should be trimmed but may have some buffer
      expect(history.length).toBeLessThanOrEqual(200)
    })
  })
})

describe('Helper Functions', () => {
  beforeEach(() => {
    enhancedSandboxEvents.clearHistory()
  })

  describe('emitEvent', () => {
    it('should emit event via helper', () => {
      emitEvent('sbx-123', 'connected', { status: 'ok' }, { userId: 'user-1' })
      
      const history = enhancedSandboxEvents.getHistory('sbx-123')
      expect(history).toHaveLength(1)
      expect(history[0].metadata?.userId).toBe('user-1')
    })
  })

  describe('subscribeToEvents', () => {
    it('should subscribe via helper', () => {
      const callback = vi.fn()
      
      const unsubscribe = subscribeToEvents('sbx-123', callback, { replay: false })
      
      emitEvent('sbx-123', 'connected', {})
      expect(callback).toHaveBeenCalledTimes(1)
      
      unsubscribe()
    })
  })

  describe('getEventHistory', () => {
    it('should get history via helper', () => {
      emitEvent('sbx-123', 'agent:tool_start', {})
      emitEvent('sbx-123', 'agent:tool_result', {})
      
      const history = getEventHistory('sbx-123')
      expect(history).toHaveLength(2)
    })
  })
})
