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

import { UniversalEventEmitter } from '@/lib/utils/universal-event-emitter'
import type { EnhancedSandboxEventType, EnhancedSandboxEvent } from './sandbox-events-enhanced'

// Import enhanced events for use in legacy emitter
import {
  enhancedSandboxEvents,
  emitEvent,
  subscribeToEvents,
} from './sandbox-events-enhanced'

// Re-export enhanced events for backward compatibility
export {
  enhancedSandboxEvents as sandboxEvents,
  EnhancedSandboxEventEmitter,
  emitEvent,
  subscribeToEvents,
  getEventHistory,
} from './sandbox-events-enhanced'

// Legacy types for backward compatibility
export type SandboxEventType = EnhancedSandboxEventType
export type SandboxEvent = EnhancedSandboxEvent

// Legacy event emitter (kept for backward compatibility)
class LegacySandboxEventEmitter extends UniversalEventEmitter {
  emit(event: string, ...args: any[]): boolean {
    // Support legacy emit(sandboxId, type, data) format for backward compatibility
    if (args.length >= 3) {
      // Legacy format: emit(sandboxId, type, data)
      emitEvent(args[0] as string, args[1] as SandboxEventType, args[2] as any, args[3] as any)
    }
    return super.emit(event, ...args)
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
