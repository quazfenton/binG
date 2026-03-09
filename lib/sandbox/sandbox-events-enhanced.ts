/**
 * Enhanced Sandbox Event System
 *
 * Provides event persistence, replay capability, and advanced filtering
 * Extends the basic sandbox-events.ts with additional features
 *
 * @see lib/sandbox/sandbox-events.ts - Basic event system
 */

import { EventEmitter } from 'node:events'

export type EnhancedSandboxEventType =
  | 'agent:tool_start'
  | 'agent:tool_result'
  | 'agent:stream'
  | 'agent:reasoning_start'
  | 'agent:reasoning_chunk'
  | 'agent:reasoning_complete'
  | 'agent:complete'
  | 'agent:error'
  | 'port_detected'
  | 'connected'
  | 'disconnected'
  | 'pty_output'
  | 'command_output'
  | 'desktop:ready'
  | 'mcp:ready'
  | 'preview:available'

export interface EnhancedSandboxEvent {
  /** Unique event identifier */
  id: string
  
  /** Event type */
  type: EnhancedSandboxEventType
  
  /** Sandbox identifier */
  sandboxId: string
  
  /** Optional session identifier */
  sessionId?: string
  
  /** Event timestamp */
  timestamp: number
  
  /** Event data payload */
  data: any
  
  /** Optional metadata */
  metadata?: {
    userId?: string
    provider?: string
    duration?: number
    [key: string]: any
  }
}

interface EventStore {
  events: EnhancedSandboxEvent[]
  maxEvents: number
  createdAt: number
}

const eventStores = new Map<string, EventStore>()
const MAX_EVENTS_PER_SANDBOX = parseInt(process.env.MAX_EVENTS_PER_SANDBOX || '1000', 10)
const EVENT_TTL_MS = parseInt(process.env.EVENT_TTL_MS || (4 * 60 * 60 * 1000).toString(), 10) // 4 hours default

/**
 * Enhanced sandbox event emitter with persistence and replay
 */
export class EnhancedSandboxEventEmitter extends EventEmitter {
  /**
   * Emit event with persistence
   * 
   * @param sandboxId - Sandbox identifier
   * @param type - Event type
   * @param data - Event data
   * @param metadata - Optional metadata
   * 
   * @example
   * ```typescript
   * enhancedSandboxEvents.emit(
   *   'sbx_123',
   *   'agent:tool_start',
   *   { toolName: 'exec_shell', args: { command: 'ls -la' } },
   *   { userId: 'user_456', provider: 'daytona' }
   * )
   * ```
   */
  emit(sandboxId: string, type: EnhancedSandboxEventType, data: any, metadata?: EnhancedSandboxEvent['metadata']): boolean {
    const event: EnhancedSandboxEvent = {
      id: `${sandboxId}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      sandboxId,
      timestamp: Date.now(),
      data,
      metadata,
    }

    // Store event in sandbox-specific store
    const store = eventStores.get(sandboxId) || { 
      events: [], 
      maxEvents: MAX_EVENTS_PER_SANDBOX,
      createdAt: Date.now(),
    }
    store.events.push(event)
    
    // Trim old events to prevent memory bloat
    if (store.events.length > store.maxEvents) {
      store.events = store.events.slice(-store.maxEvents)
    }
    
    // Remove expired events
    const now = Date.now()
    store.events = store.events.filter(e => now - e.timestamp < EVENT_TTL_MS)
    
    eventStores.set(sandboxId, store)

    // Emit to listeners
    super.emit(sandboxId, event)
    super.emit('*', { ...event, channel: sandboxId })
    super.emit(`event:${type}`, event)
    super.emit(`${sandboxId}:${type}`, event)

    return true
  }

  /**
   * Subscribe to events with optional replay
   * 
   * @param sandboxId - Sandbox identifier (use '*' for all sandboxes)
   * @param callback - Event callback
   * @param options - Subscription options
   * @returns Unsubscribe function
   * 
   * @example
   * ```typescript
   * // Subscribe with replay of last 10 events
   * const unsubscribe = enhancedSandboxEvents.subscribe(
   *   'sbx_123',
   *   (event) => console.log(event),
   *   { replay: true, limit: 10 }
   * )
   * 
   * // Later: unsubscribe()
   * ```
   */
  subscribe(
    sandboxId: string, 
    callback: (event: EnhancedSandboxEvent) => void,
    options?: { 
      replay?: boolean
      fromTimestamp?: number
      limit?: number
      types?: EnhancedSandboxEventType[]
    }
  ): () => void {
    // Replay historical events if requested
    if (options?.replay) {
      const history = this.getHistory(sandboxId, {
        fromTimestamp: options.fromTimestamp,
        limit: options.limit,
        types: options.types,
      })
      
      for (const event of history) {
        callback(event)
      }
    }

    // Subscribe to future events
    const listener = (event: EnhancedSandboxEvent) => {
      if (sandboxId === '*' || event.sandboxId === sandboxId) {
        callback(event)
      }
    }
    
    const targetChannel = sandboxId === '*' ? '*' : sandboxId
    this.on(targetChannel, listener)
    
    // Return unsubscribe function
    return () => {
      this.off(targetChannel, listener)
    }
  }

  /**
   * Get historical events for a sandbox
   * 
   * @param sandboxId - Sandbox identifier
   * @param options - Query options
   * @returns Array of matching events
   * 
   * @example
   * ```typescript
   * // Get last 50 events from the last hour
   * const events = enhancedSandboxEvents.getHistory('sbx_123', {
   *   fromTimestamp: Date.now() - 60 * 60 * 1000,
   *   limit: 50,
   * })
   * ```
   */
  getHistory(
    sandboxId: string, 
    options?: { 
      fromTimestamp?: number
      toTimestamp?: number
      limit?: number
      types?: EnhancedSandboxEventType[]
    }
  ): EnhancedSandboxEvent[] {
    const store = eventStores.get(sandboxId)
    if (!store) return []

    let eventList = [...store.events]

    // Filter by timestamp range
    if (options?.fromTimestamp) {
      eventList = eventList.filter(e => e.timestamp >= options.fromTimestamp)
    }

    if (options?.toTimestamp) {
      eventList = eventList.filter(e => e.timestamp <= options.toTimestamp)
    }

    // Filter by event types
    if (options?.types) {
      eventList = eventList.filter(e => options.types!.includes(e.type))
    }

    // Limit results
    if (options?.limit) {
      eventList = eventList.slice(-options.limit)
    }

    return eventList
  }

  /**
   * Get event by ID
   */
  getEvent(eventId: string): EnhancedSandboxEvent | undefined {
    for (const store of eventStores.values()) {
      const event = store.events.find(e => e.id === eventId)
      if (event) return event
    }
    return undefined
  }

  /**
   * Get events by type across all sandboxes
   */
  getEventsByType(type: EnhancedSandboxEventType, options?: { limit?: number }): EnhancedSandboxEvent[] {
    const events: EnhancedSandboxEvent[] = []
    
    for (const store of eventStores.values()) {
      for (const event of store.events) {
        if (event.type === type) {
          events.push(event)
        }
      }
    }
    
    // Sort by timestamp descending
    events.sort((a, b) => b.timestamp - a.timestamp)
    
    // Limit results
    if (options?.limit) {
      return events.slice(0, options.limit)
    }
    
    return events
  }

  /**
   * Clear event history for a sandbox
   * 
   * @param sandboxId - Sandbox identifier (omit to clear all)
   */
  clearHistory(sandboxId?: string): void {
    if (sandboxId) {
      eventStores.delete(sandboxId)
    } else {
      eventStores.clear()
    }
  }

  /**
   * Get event statistics
   */
  getStats(): {
    totalStores: number
    totalEvents: number
    eventsByType: Record<EnhancedSandboxEventType, number>
    oldestEvent?: number
    newestEvent?: number
  } {
    const stats = {
      totalStores: eventStores.size,
      totalEvents: 0,
      eventsByType: {} as Record<EnhancedSandboxEventType, number>,
      oldestEvent: undefined as number | undefined,
      newestEvent: undefined as number | undefined,
    }

    for (const store of eventStores.values()) {
      stats.totalEvents += store.events.length
      
      for (const event of store.events) {
        stats.eventsByType[event.type] = (stats.eventsByType[event.type] || 0) + 1
        
        if (!stats.oldestEvent || event.timestamp < stats.oldestEvent) {
          stats.oldestEvent = event.timestamp
        }
        if (!stats.newestEvent || event.timestamp > stats.newestEvent) {
          stats.newestEvent = event.timestamp
        }
      }
    }

    return stats
  }

  /**
   * Export events to JSON
   */
  exportEvents(sandboxId?: string): string {
    if (sandboxId) {
      const store = eventStores.get(sandboxId)
      return JSON.stringify(store?.events || [], null, 2)
    }
    
    const allEvents: EnhancedSandboxEvent[] = []
    for (const store of eventStores.values()) {
      allEvents.push(...store.events)
    }
    
    return JSON.stringify(allEvents, null, 2)
  }

  /**
   * Import events from JSON
   */
  importEvents(json: string): number {
    try {
      const events: EnhancedSandboxEvent[] = JSON.parse(json)
      let count = 0
      
      for (const event of events) {
        if (this.validateEvent(event)) {
          const store = eventStores.get(event.sandboxId) || { 
            events: [], 
            maxEvents: MAX_EVENTS_PER_SANDBOX,
            createdAt: Date.now(),
          }
          store.events.push(event)
          eventStores.set(event.sandboxId, store)
          count++
        }
      }
      
      return count
    } catch {
      return 0
    }
  }

  /**
   * Validate event structure
   */
  private validateEvent(event: any): event is EnhancedSandboxEvent {
    return (
      event &&
      typeof event.id === 'string' &&
      typeof event.type === 'string' &&
      typeof event.sandboxId === 'string' &&
      typeof event.timestamp === 'number' &&
      event.data !== undefined
    )
  }

  /**
   * Get subscriber count for a sandbox
   */
  getSubscriberCount(sandboxId: string): number {
    return this.listenerCount(sandboxId)
  }

  /**
   * Get all active sandbox IDs
   */
  getActiveSandboxIds(): string[] {
    return Array.from(eventStores.keys())
  }

  /**
   * Prune old events
   */
  pruneOldEvents(maxAgeMs: number = EVENT_TTL_MS): number {
    const now = Date.now()
    let pruned = 0
    
    for (const [sandboxId, store] of eventStores) {
      const originalLength = store.events.length
      store.events = store.events.filter(e => now - e.timestamp < maxAgeMs)
      pruned += originalLength - store.events.length
      
      // Remove empty stores
      if (store.events.length === 0) {
        eventStores.delete(sandboxId)
      }
    }
    
    return pruned
  }
}

/**
 * Singleton instance for enhanced sandbox events
 */
export const enhancedSandboxEvents = new EnhancedSandboxEventEmitter()

/**
 * Quick event emission
 */
export function emitEvent(
  sandboxId: string,
  type: EnhancedSandboxEventType,
  data: any,
  metadata?: EnhancedSandboxEvent['metadata']
): void {
  enhancedSandboxEvents.emit(sandboxId, type, data, metadata)
}

/**
 * Quick event subscription
 */
export function subscribeToEvents(
  sandboxId: string,
  callback: (event: EnhancedSandboxEvent) => void,
  options?: Parameters<EnhancedSandboxEventEmitter['subscribe']>[2]
): () => void {
  return enhancedSandboxEvents.subscribe(sandboxId, callback, options)
}

/**
 * Get event history
 */
export function getEventHistory(
  sandboxId: string,
  options?: Parameters<EnhancedSandboxEventEmitter['getHistory']>[1]
): EnhancedSandboxEvent[] {
  return enhancedSandboxEvents.getHistory(sandboxId, options)
}
