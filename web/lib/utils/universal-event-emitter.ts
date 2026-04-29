/**
 * Universal EventEmitter - Works in both Node.js and Browser environments
 * 
 * Usage:
 * - For server-side code: Uses native Node.js EventEmitter when available
 * - For client-side code: Uses a browser-compatible implementation
 * - For dual-environment libraries: Automatically detects and uses appropriate implementation
 */

type EventListener = (...args: any[]) => void;

interface EventEmitterLike {
  on(event: string, listener: EventListener): this;
  off(event: string, listener: EventListener): this;
  emit(event: string, ...args: any[]): boolean;
  removeAllListeners(event?: string): this;
  addListener(event: string, listener: EventListener): this;
  removeListener(event: string, listener: EventListener): this;
}

/**
 * Browser-compatible EventEmitter implementation
 */
class BrowserEventEmitter implements EventEmitterLike {
  private events: Map<string, EventListener[]> = new Map<string, EventListener[]>();

  on(event: string, listener: EventListener): this {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }
    this.events.get(event)!.push(listener);
    return this;
  }

  off(event: string, listener: EventListener): this {
    const listeners = this.events.get(event);
    if (listeners) {
      const index = listeners.indexOf(listener);
      if (index > -1) {
        listeners.splice(index, 1);
      }
    }
    return this;
  }

  emit(event: string, ...args: any[]): boolean {
    const listeners = this.events.get(event);
    if (listeners) {
      // Create a copy to prevent issues if listeners modify the listeners array
      const listenersCopy = [...listeners];
      listenersCopy.forEach(listener => listener(...args));
      return true;
    }
    return false;
  }

  removeAllListeners(event?: string): this {
    if (event) {
      this.events.delete(event);
    } else {
      this.events.clear();
    }
    return this;
  }

  addListener(event: string, listener: EventListener): this {
    return this.on(event, listener);
  }

  removeListener(event: string, listener: EventListener): this {
    return this.off(event, listener);
  }
}

/**
 * Get the appropriate EventEmitter implementation for the current environment
 * 
 * Tries to use Node.js EventEmitter when available (server-side),
 * falls back to browser implementation otherwise.
 */
function getNodeEventEmitter(): EventEmitterLike {
  try {
    // Check if we're in a Node.js environment
    if (typeof process !== 'undefined' && process.versions?.node) {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { EventEmitter } = require('events');
      return new EventEmitter();
    }
  } catch {
    // Node.js not available, use browser implementation
  }
  
  return new BrowserEventEmitter();
}

/**
 * Universal EventEmitter class that works in both environments
 */
export class UniversalEventEmitter implements EventEmitterLike {
  private emitter: EventEmitterLike;

  constructor() {
    this.emitter = getNodeEventEmitter();
  }

  on(event: string, listener: EventListener): this {
    this.emitter.on(event, listener);
    return this;
  }

  off(event: string, listener: EventListener): this {
    this.emitter.off(event, listener);
    return this;
  }

  emit(event: string, ...args: any[]): boolean {
    return this.emitter.emit(event, ...args);
  }

  removeAllListeners(event?: string): this {
    this.emitter.removeAllListeners(event);
    return this;
  }

  addListener(event: string, listener: EventListener): this {
    this.emitter.addListener(event, listener);
    return this;
  }

  removeListener(event: string, listener: EventListener): this {
    this.emitter.removeListener(event, listener);
    return this;
  }
}

// Export browser-compatible implementation for direct use
export { BrowserEventEmitter };
