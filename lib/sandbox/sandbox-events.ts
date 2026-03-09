/**
 * Sandbox Event System
 * 
 * Provides event emission and subscription for sandbox events
 * 
 * @deprecated Use enhancedSandboxEvents from sandbox-events-enhanced.ts instead
 * This module is kept for backward compatibility
 * 
 * @see lib/sandbox/sandbox-events-enhanced.ts - Enhanced event system with persistence
 */

import { EventEmitter } from 'node:events'

// Re-export enhanced events for backward compatibility
export {
  enhancedSandboxEvents as sandboxEvents,
  EnhancedSandboxEventEmitter,
  emitEvent,
  subscribeToEvents,
  getEventHistory,
  type EnhancedSandboxEvent,
  type EnhancedSandboxEventType,
} from './sandbox-events-enhanced'

// Legacy types for backward compatibility
export type SandboxEventType = EnhancedSandboxEventType
export type SandboxEvent = EnhancedSandboxEvent

// Legacy event emitter (kept for backward compatibility)
class LegacySandboxEventEmitter {
  private emitter = new EventEmitter()

  emit(sandboxId: string, type: SandboxEventType, data: any): void {
    // Delegate to enhanced events
    emitEvent(sandboxId, type, data)
  }

  subscribe(sandboxId: string, callback: (event: SandboxEvent) => void): () => void {
    return subscribeToEvents(sandboxId, callback, { replay: false })
  }

  getSubscriberCount(sandboxId: string): number {
    return enhancedSandboxEvents.getSubscriberCount(sandboxId)
  }
}

// Export legacy instance for backward compatibility
export const legacySandboxEvents = new LegacySandboxEventEmitter()
