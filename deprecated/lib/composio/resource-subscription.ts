/**
 * Composio Resource Subscription
 * 
 * Provides real-time subscription to Composio resources and events.
 * Enables reactive updates for connected accounts and triggers.
 * 
 * Features:
 * - Account status subscription
 * - Trigger event subscription
 * - Tool execution subscription
 * - Real-time notifications
 */

import { EventEmitter } from 'node:events';

/**
 * Subscription event types
 */
export type SubscriptionEventType = 
  | 'account.connected'
  | 'account.disconnected'
  | 'account.expired'
  | 'trigger.executed'
  | 'tool.executed'
  | 'tool.failed';

/**
 * Subscription event
 */
export interface SubscriptionEvent {
  /**
   * Event type
   */
  type: SubscriptionEventType;
  
  /**
   * Event data
   */
  data: any;
  
  /**
   * Timestamp
   */
  timestamp: number;
  
  /**
   * User ID
   */
  userId?: string;
  
  /**
   * Account ID
   */
  accountId?: string;
  
  /**
   * Trigger ID
   */
  triggerId?: string;
}

/**
 * Resource subscription
 */
export interface ResourceSubscription {
  /**
   * Subscription ID
   */
  id: string;
  
  /**
   * User ID
   */
  userId: string;
  
  /**
   * Event types to subscribe to
   */
  eventTypes: SubscriptionEventType[];
  
  /**
   * Filter by account ID
   */
  accountId?: string;
  
  /**
   * Filter by trigger ID
   */
  triggerId?: string;
  
  /**
   * Created timestamp
   */
  createdAt: number;
  
  /**
   * Active status
   */
  active: boolean;
}

/**
 * Composio Resource Subscription Manager
 * 
 * Manages resource subscriptions.
 */
export class ComposioSubscriptionManager extends EventEmitter {
  private subscriptions: Map<string, ResourceSubscription> = new Map();
  private eventQueue: SubscriptionEvent[] = [];
  private readonly MAX_QUEUE_SIZE = 10000;

  constructor() {
    super();
  }

  /**
   * Create subscription
   * 
   * @param userId - User ID
   * @param eventTypes - Event types to subscribe to
   * @param options - Subscription options
   * @returns Subscription
   */
  createSubscription(
    userId: string,
    eventTypes: SubscriptionEventType[],
    options?: {
      accountId?: string;
      triggerId?: string;
    }
  ): ResourceSubscription {
    const subscriptionId = `sub_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    const subscription: ResourceSubscription = {
      id: subscriptionId,
      userId,
      eventTypes,
      accountId: options?.accountId,
      triggerId: options?.triggerId,
      createdAt: Date.now(),
      active: true,
    };

    this.subscriptions.set(subscriptionId, subscription);
    this.emit('subscription-created', subscription);

    return subscription;
  }

  /**
   * Cancel subscription
   * 
   * @param subscriptionId - Subscription ID
   */
  cancelSubscription(subscriptionId: string): void {
    const subscription = this.subscriptions.get(subscriptionId);
    
    if (subscription) {
      subscription.active = false;
      this.subscriptions.delete(subscriptionId);
      this.emit('subscription-cancelled', subscription);
    }
  }

  /**
   * Publish event to subscribers
   * 
   * @param event - Subscription event
   */
  publishEvent(event: SubscriptionEvent): void {
    // Queue event
    this.eventQueue.push(event);
    
    // Enforce max queue size
    if (this.eventQueue.length > this.MAX_QUEUE_SIZE) {
      this.eventQueue.shift();
    }

    // Notify matching subscriptions
    for (const subscription of this.subscriptions.values()) {
      if (!subscription.active) continue;
      if (!subscription.eventTypes.includes(event.type)) continue;
      if (subscription.accountId && event.accountId !== subscription.accountId) continue;
      if (subscription.triggerId && event.triggerId !== subscription.triggerId) continue;
      if (subscription.userId !== event.userId) continue;

      this.emit('event', { subscription: subscription.id, event });
    }

    this.emit('event-published', event);
  }

  /**
   * Get subscription by ID
   * 
   * @param subscriptionId - Subscription ID
   * @returns Subscription or null
   */
  getSubscription(subscriptionId: string): ResourceSubscription | null {
    return this.subscriptions.get(subscriptionId) || null;
  }

  /**
   * Get subscriptions by user
   * 
   * @param userId - User ID
   * @returns Array of subscriptions
   */
  getSubscriptionsByUser(userId: string): ResourceSubscription[] {
    return Array.from(this.subscriptions.values()).filter(s => s.userId === userId);
  }

  /**
   * Get queued events
   * 
   * @param subscriptionId - Optional subscription ID
   * @param limit - Max events to return
   * @returns Array of events
   */
  getQueuedEvents(subscriptionId?: string, limit: number = 100): Array<{
    subscription: string;
    event: SubscriptionEvent;
  }> {
    const events: Array<{ subscription: string; event: SubscriptionEvent }> = [];
    
    for (const event of this.eventQueue.slice(-limit)) {
      if (subscriptionId) {
        // Find matching subscription
        for (const [subId, sub] of this.subscriptions.entries()) {
          if (subId === subscriptionId && sub.eventTypes.includes(event.type)) {
            events.push({ subscription: subId, event });
            break;
          }
        }
      } else {
        events.push({ subscription: 'all', event });
      }
    }
    
    return events;
  }

  /**
   * Get subscription statistics
   */
  getStats(): {
    totalSubscriptions: number;
    activeSubscriptions: number;
    queuedEvents: number;
    eventsByType: Record<string, number>;
  } {
    const subscriptions = Array.from(this.subscriptions.values());
    const activeSubscriptions = subscriptions.filter(s => s.active).length;
    
    const eventsByType: Record<string, number> = {};
    for (const event of this.eventQueue) {
      eventsByType[event.type] = (eventsByType[event.type] || 0) + 1;
    }

    return {
      totalSubscriptions: subscriptions.length,
      activeSubscriptions,
      queuedEvents: this.eventQueue.length,
      eventsByType,
    };
  }

  /**
   * Clear subscriptions
   * 
   * @param userId - Optional user ID filter
   */
  clearSubscriptions(userId?: string): void {
    if (userId) {
      for (const [id, sub] of this.subscriptions.entries()) {
        if (sub.userId === userId) {
          this.subscriptions.delete(id);
        }
      }
    } else {
      this.subscriptions.clear();
    }
  }

  /**
   * Clear event queue
   */
  clearEventQueue(): void {
    this.eventQueue = [];
  }
}

// Singleton instance
export const composioSubscriptionManager = new ComposioSubscriptionManager();

/**
 * Create subscription manager
 * 
 * @returns Subscription manager
 */
export function createSubscriptionManager(): ComposioSubscriptionManager {
  return new ComposioSubscriptionManager();
}

/**
 * Quick subscription helper
 * 
 * @param userId - User ID
 * @param eventTypes - Event types
 * @param callback - Event callback
 * @returns Unsubscribe function
 */
export function subscribe(
  userId: string,
  eventTypes: SubscriptionEventType[],
  callback: (event: SubscriptionEvent) => void
): () => void {
  const manager = composioSubscriptionManager;
  const subscription = manager.createSubscription(userId, eventTypes);
  
  const handler = (data: { subscription: string; event: SubscriptionEvent }) => {
    if (data.subscription === subscription.id) {
      callback(data.event);
    }
  };
  
  manager.on('event', handler);
  
  return () => {
    manager.off('event', handler);
    manager.cancelSubscription(subscription.id);
  };
}
