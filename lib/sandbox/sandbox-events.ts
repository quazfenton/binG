import { EventEmitter } from 'events'

export type SandboxEventType = 'agent:tool_start' | 'agent:tool_result' | 'agent:stream' | 'agent:complete' | 'agent:error'

export interface SandboxEvent {
  type: SandboxEventType
  sandboxId: string
  timestamp: number
  data: any
}

class SandboxEventEmitter {
  private emitter = new EventEmitter()

  emit(sandboxId: string, type: SandboxEventType, data: any): void {
    const event: SandboxEvent = {
      type,
      sandboxId,
      timestamp: Date.now(),
      data,
    }
    this.emitter.emit(sandboxId, event)
  }

  subscribe(sandboxId: string, callback: (event: SandboxEvent) => void): () => void {
    this.emitter.on(sandboxId, callback)
    return () => {
      this.emitter.off(sandboxId, callback)
    }
  }

  getSubscriberCount(sandboxId: string): number {
    return this.emitter.listenerCount(sandboxId)
  }
}

export const sandboxEvents = new SandboxEventEmitter()
