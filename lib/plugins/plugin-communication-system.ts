/**
 * Plugin Communication System
 * Enables secure inter-plugin communication and data sharing
 */

export interface PluginMessage {
  id: string;
  from: string;
  to: string;
  type: 'request' | 'response' | 'broadcast' | 'event';
  action: string;
  data?: any;
  timestamp: number;
  correlationId?: string;
}

export interface PluginSubscription {
  pluginId: string;
  eventType: string;
  handler: (message: PluginMessage) => void;
  priority: number;
}

export interface PluginCapability {
  pluginId: string;
  name: string;
  description: string;
  inputSchema?: any;
  outputSchema?: any;
  permissions: string[];
}

export interface CommunicationPermission {
  from: string;
  to: string;
  actions: string[];
  granted: boolean;
  grantedAt: number;
  expiresAt?: number;
}

export class PluginCommunicationSystem {
  private messageQueue = new Map<string, PluginMessage[]>();
  private subscriptions = new Map<string, PluginSubscription[]>();
  private capabilities = new Map<string, PluginCapability[]>();
  private permissions = new Map<string, CommunicationPermission>();
  private messageHistory = new Map<string, PluginMessage[]>();
  private eventHandlers = new Map<string, (message: PluginMessage) => void>();

  /**
   * Register a plugin's capabilities
   */
  registerCapabilities(pluginId: string, capabilities: Omit<PluginCapability, 'pluginId'>[]): void {
    const pluginCapabilities = capabilities.map(cap => ({
      ...cap,
      pluginId
    }));
    
    this.capabilities.set(pluginId, pluginCapabilities);
  }

  /**
   * Subscribe to events or messages
   */
  subscribe(
    pluginId: string, 
    eventType: string, 
    handler: (message: PluginMessage) => void,
    priority: number = 0
  ): string {
    const subscription: PluginSubscription = {
      pluginId,
      eventType,
      handler,
      priority
    };

    const subscriptions = this.subscriptions.get(eventType) || [];
    subscriptions.push(subscription);
    subscriptions.sort((a, b) => b.priority - a.priority); // Higher priority first
    
    this.subscriptions.set(eventType, subscriptions);
    
    return `${pluginId}:${eventType}:${Date.now()}`;
  }

  /**
   * Unsubscribe from events
   */
  unsubscribe(pluginId: string, eventType?: string): void {
    if (eventType) {
      const subscriptions = this.subscriptions.get(eventType) || [];
      const filtered = subscriptions.filter(sub => sub.pluginId !== pluginId);
      this.subscriptions.set(eventType, filtered);
    } else {
      // Unsubscribe from all events
      for (const [type, subscriptions] of this.subscriptions.entries()) {
        const filtered = subscriptions.filter(sub => sub.pluginId !== pluginId);
        this.subscriptions.set(type, filtered);
      }
    }
  }

  /**
   * Send a message to another plugin
   */
  async sendMessage(message: Omit<PluginMessage, 'id' | 'timestamp'>): Promise<PluginMessage | null> {
    // Check permissions
    if (!this.hasPermission(message.from, message.to, message.action)) {
      throw new Error(`Plugin ${message.from} does not have permission to send ${message.action} to ${message.to}`);
    }

    const fullMessage: PluginMessage = {
      ...message,
      id: this.generateMessageId(),
      timestamp: Date.now()
    };

    // Add to message history
    this.addToHistory(fullMessage);

    // Handle different message types
    switch (message.type) {
      case 'request':
        return this.handleRequest(fullMessage);
      case 'response':
        return this.handleResponse(fullMessage);
      case 'broadcast':
        return this.handleBroadcast(fullMessage);
      case 'event':
        return this.handleEvent(fullMessage);
      default:
        throw new Error(`Unknown message type: ${message.type}`);
    }
  }

  /**
   * Handle request messages
   */
  private async handleRequest(message: PluginMessage): Promise<PluginMessage | null> {
    // Add to target plugin's message queue
    const queue = this.messageQueue.get(message.to) || [];
    queue.push(message);
    this.messageQueue.set(message.to, queue);

    // Notify target plugin if it has a handler
    const handler = this.eventHandlers.get(message.to);
    if (handler) {
      try {
        handler(message);
      } catch (error) {
        console.error(`Error handling message in plugin ${message.to}:`, error);
      }
    }

    return message;
  }

  /**
   * Handle response messages
   */
  private async handleResponse(message: PluginMessage): Promise<PluginMessage | null> {
    // Find the original request using correlationId
    if (message.correlationId) {
      const history = this.messageHistory.get(message.from) || [];
      const originalRequest = history.find(m => 
        m.id === message.correlationId && m.type === 'request'
      );

      if (originalRequest) {
        // Deliver response to the original requester
        const handler = this.eventHandlers.get(originalRequest.from);
        if (handler) {
          try {
            handler(message);
          } catch (error) {
            console.error(`Error handling response in plugin ${originalRequest.from}:`, error);
          }
        }
      }
    }

    return message;
  }

  /**
   * Handle broadcast messages
   */
  private async handleBroadcast(message: PluginMessage): Promise<PluginMessage | null> {
    // Send to all plugins except the sender
    const allPlugins = new Set<string>();
    
    // Collect all plugin IDs from capabilities
    for (const capabilities of this.capabilities.values()) {
      capabilities.forEach(cap => allPlugins.add(cap.pluginId));
    }

    // Remove sender
    allPlugins.delete(message.from);

    // Send to each plugin
    for (const pluginId of allPlugins) {
      if (this.hasPermission(message.from, pluginId, message.action)) {
        const handler = this.eventHandlers.get(pluginId);
        if (handler) {
          try {
            handler({ ...message, to: pluginId });
          } catch (error) {
            console.error(`Error handling broadcast in plugin ${pluginId}:`, error);
          }
        }
      }
    }

    return message;
  }

  /**
   * Handle event messages
   */
  private async handleEvent(message: PluginMessage): Promise<PluginMessage | null> {
    const subscriptions = this.subscriptions.get(message.action) || [];
    
    for (const subscription of subscriptions) {
      // Skip if it's the sender (unless explicitly allowed)
      if (subscription.pluginId === message.from) continue;
      
      // Check permissions
      if (!this.hasPermission(message.from, subscription.pluginId, message.action)) {
        continue;
      }

      try {
        subscription.handler({ ...message, to: subscription.pluginId });
      } catch (error) {
        console.error(`Error in event handler for plugin ${subscription.pluginId}:`, error);
      }
    }

    return message;
  }

  /**
   * Register event handler for a plugin
   */
  registerEventHandler(pluginId: string, handler: (message: PluginMessage) => void): void {
    this.eventHandlers.set(pluginId, handler);
  }

  /**
   * Get messages for a plugin
   */
  getMessages(pluginId: string): PluginMessage[] {
    const messages = this.messageQueue.get(pluginId) || [];
    this.messageQueue.set(pluginId, []); // Clear queue after reading
    return messages;
  }

  /**
   * Grant permission for plugin communication
   */
  grantPermission(
    from: string, 
    to: string, 
    actions: string[], 
    expiresIn?: number
  ): void {
    const permission: CommunicationPermission = {
      from,
      to,
      actions,
      granted: true,
      grantedAt: Date.now(),
      expiresAt: expiresIn ? Date.now() + expiresIn : undefined
    };

    const key = `${from}:${to}`;
    this.permissions.set(key, permission);
  }

  /**
   * Revoke permission
   */
  revokePermission(from: string, to: string): void {
    const key = `${from}:${to}`;
    const permission = this.permissions.get(key);
    if (permission) {
      permission.granted = false;
      this.permissions.set(key, permission);
    }
  }

  /**
   * Check if a plugin has permission to communicate
   */
  hasPermission(from: string, to: string, action: string): boolean {
    // Allow self-communication
    if (from === to) return true;

    const key = `${from}:${to}`;
    const permission = this.permissions.get(key);
    
    if (!permission || !permission.granted) {
      return false;
    }

    // Check expiration
    if (permission.expiresAt && Date.now() > permission.expiresAt) {
      permission.granted = false;
      return false;
    }

    // Check if action is allowed
    return permission.actions.includes(action) || permission.actions.includes('*');
  }

  /**
   * Get available capabilities from other plugins
   */
  getAvailableCapabilities(requestingPluginId: string): PluginCapability[] {
    const allCapabilities: PluginCapability[] = [];
    
    for (const [pluginId, capabilities] of this.capabilities.entries()) {
      if (pluginId !== requestingPluginId) {
        // Only include capabilities the requesting plugin has permission to use
        const allowedCapabilities = capabilities.filter(cap =>
          this.hasPermission(requestingPluginId, pluginId, cap.name)
        );
        allCapabilities.push(...allowedCapabilities);
      }
    }
    
    return allCapabilities;
  }

  /**
   * Request capability from another plugin
   */
  async requestCapability(
    from: string, 
    to: string, 
    capabilityName: string, 
    data?: any
  ): Promise<any> {
    const message: Omit<PluginMessage, 'id' | 'timestamp'> = {
      from,
      to,
      type: 'request',
      action: capabilityName,
      data,
      correlationId: this.generateMessageId()
    };

    return this.sendMessage(message);
  }

  /**
   * Emit an event to all subscribers
   */
  async emitEvent(from: string, eventType: string, data?: any): Promise<void> {
    const message: Omit<PluginMessage, 'id' | 'timestamp'> = {
      from,
      to: '*',
      type: 'event',
      action: eventType,
      data
    };

    await this.sendMessage(message);
  }

  /**
   * Get message history for a plugin
   */
  getMessageHistory(pluginId: string, limit: number = 50): PluginMessage[] {
    const history = this.messageHistory.get(pluginId) || [];
    return history.slice(-limit);
  }

  /**
   * Get communication statistics
   */
  getStatistics(): {
    totalMessages: number;
    messagesByType: { [key: string]: number };
    activePlugins: number;
    totalCapabilities: number;
    activePermissions: number;
  } {
    let totalMessages = 0;
    const messagesByType: { [key: string]: number } = {};
    
    for (const history of this.messageHistory.values()) {
      totalMessages += history.length;
      for (const message of history) {
        messagesByType[message.type] = (messagesByType[message.type] || 0) + 1;
      }
    }

    const activePermissions = Array.from(this.permissions.values())
      .filter(p => p.granted && (!p.expiresAt || Date.now() < p.expiresAt))
      .length;

    return {
      totalMessages,
      messagesByType,
      activePlugins: this.capabilities.size,
      totalCapabilities: Array.from(this.capabilities.values()).reduce((sum, caps) => sum + caps.length, 0),
      activePermissions
    };
  }

  /**
   * Generate unique message ID
   */
  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Add message to history
   */
  private addToHistory(message: PluginMessage): void {
    const history = this.messageHistory.get(message.from) || [];
    history.push(message);
    
    // Keep only last 100 messages per plugin
    if (history.length > 100) {
      history.splice(0, history.length - 100);
    }
    
    this.messageHistory.set(message.from, history);
  }

  /**
   * Clean up expired permissions and old messages
   */
  cleanup(): void {
    const now = Date.now();
    
    // Clean expired permissions
    for (const [key, permission] of this.permissions.entries()) {
      if (permission.expiresAt && now > permission.expiresAt) {
        permission.granted = false;
      }
    }

    // Clean old message history (keep only last 24 hours)
    const dayAgo = now - 24 * 60 * 60 * 1000;
    for (const [pluginId, history] of this.messageHistory.entries()) {
      const filtered = history.filter(msg => msg.timestamp > dayAgo);
      this.messageHistory.set(pluginId, filtered);
    }
  }

  /**
   * Clear all data for a plugin
   */
  clearPluginData(pluginId: string): void {
    this.capabilities.delete(pluginId);
    this.messageQueue.delete(pluginId);
    this.messageHistory.delete(pluginId);
    this.eventHandlers.delete(pluginId);
    
    // Remove subscriptions
    for (const [eventType, subscriptions] of this.subscriptions.entries()) {
      const filtered = subscriptions.filter(sub => sub.pluginId !== pluginId);
      this.subscriptions.set(eventType, filtered);
    }
    
    // Remove permissions
    const keysToRemove: string[] = [];
    for (const [key, permission] of this.permissions.entries()) {
      if (permission.from === pluginId || permission.to === pluginId) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => this.permissions.delete(key));
  }
}

// Global instance
export const pluginCommunicationSystem = new PluginCommunicationSystem();