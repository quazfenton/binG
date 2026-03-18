/**
 * Blaxel Agent Handoff Manager
 * 
 * Manages agent-to-agent handoffs for complex workflows.
 * Enables distributed agent execution with state transfer.
 * 
 * Features:
 * - Agent handoff coordination
 * - State transfer between agents
 * - Handoff result retrieval
 * - Multi-agent workflows
 */

import { EventEmitter } from 'node:events';

/**
 * Handoff state
 */
export interface HandoffState {
  /**
   * Handoff ID
   */
  id: string;
  
  /**
   * Source agent ID
   */
  sourceAgent: string;
  
  /**
   * Target agent ID
   */
  targetAgent: string;
  
  /**
   * Input data
   */
  input: any;
  
  /**
   * Context data
   */
  context?: any;
  
  /**
   * Handoff status
   */
  status: 'pending' | 'processing' | 'completed' | 'failed';
  
  /**
   * Result data
   */
  result?: any;
  
  /**
   * Error message if failed
   */
  error?: string;
  
  /**
   * Created timestamp
   */
  createdAt: number;
  
  /**
   * Completed timestamp
   */
  completedAt?: number;
}

/**
 * Blaxel Agent Handoff Manager
 * 
 * Coordinates agent handoffs.
 */
export class BlaxelAgentHandoffManager extends EventEmitter {
  private handoffs: Map<string, HandoffState> = new Map();
  private readonly MAX_HANDOFFS = 1000;

  constructor() {
    super();
  }

  /**
   * Create handoff
   * 
   * @param sourceAgent - Source agent ID
   * @param targetAgent - Target agent ID
   * @param input - Input data
   * @param context - Optional context
   * @returns Handoff state
   */
  createHandoff(
    sourceAgent: string,
    targetAgent: string,
    input: any,
    context?: any
  ): HandoffState {
    const handoffId = `handoff_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    
    const handoff: HandoffState = {
      id: handoffId,
      sourceAgent,
      targetAgent,
      input,
      context,
      status: 'pending',
      createdAt: Date.now(),
    };

    this.handoffs.set(handoffId, handoff);
    this.emit('handoff-created', handoff);

    // Enforce max handoffs
    if (this.handoffs.size > this.MAX_HANDOFFS) {
      const firstKey = this.handoffs.keys().next().value;
      if (firstKey) {
        this.handoffs.delete(firstKey);
      }
    }

    return handoff;
  }

  /**
   * Start handoff processing
   * 
   * @param handoffId - Handoff ID
   */
  startProcessing(handoffId: string): void {
    const handoff = this.handoffs.get(handoffId);
    
    if (handoff) {
      handoff.status = 'processing';
      this.emit('handoff-processing', handoff);
    }
  }

  /**
   * Complete handoff
   * 
   * @param handoffId - Handoff ID
   * @param result - Result data
   */
  completeHandoff(handoffId: string, result: any): void {
    const handoff = this.handoffs.get(handoffId);
    
    if (handoff) {
      handoff.status = 'completed';
      handoff.result = result;
      handoff.completedAt = Date.now();
      this.emit('handoff-completed', handoff);
    }
  }

  /**
   * Fail handoff
   * 
   * @param handoffId - Handoff ID
   * @param error - Error message
   */
  failHandoff(handoffId: string, error: string): void {
    const handoff = this.handoffs.get(handoffId);
    
    if (handoff) {
      handoff.status = 'failed';
      handoff.error = error;
      handoff.completedAt = Date.now();
      this.emit('handoff-failed', handoff);
    }
  }

  /**
   * Get handoff by ID
   * 
   * @param handoffId - Handoff ID
   * @returns Handoff state or null
   */
  getHandoff(handoffId: string): HandoffState | null {
    return this.handoffs.get(handoffId) || null;
  }

  /**
   * Get handoffs by agent
   * 
   * @param agentId - Agent ID
   * @param role - Agent role (source or target)
   * @returns Array of handoffs
   */
  getHandoffsByAgent(
    agentId: string,
    role: 'source' | 'target' | 'both' = 'both'
  ): HandoffState[] {
    return Array.from(this.handoffs.values()).filter(h => {
      if (role === 'source') return h.sourceAgent === agentId;
      if (role === 'target') return h.targetAgent === agentId;
      return h.sourceAgent === agentId || h.targetAgent === agentId;
    });
  }

  /**
   * Get pending handoffs
   * 
   * @returns Array of pending handoffs
   */
  getPendingHandoffs(): HandoffState[] {
    return Array.from(this.handoffs.values()).filter(h => h.status === 'pending');
  }

  /**
   * Get handoff statistics
   */
  getStats(): {
    totalHandoffs: number;
    pending: number;
    processing: number;
    completed: number;
    failed: number;
    averageDuration: number;
  } {
    const handoffs = Array.from(this.handoffs.values());
    
    const pending = handoffs.filter(h => h.status === 'pending').length;
    const processing = handoffs.filter(h => h.status === 'processing').length;
    const completed = handoffs.filter(h => h.status === 'completed').length;
    const failed = handoffs.filter(h => h.status === 'failed').length;
    
    const completedHandoffs = handoffs.filter(h => h.completedAt);
    const totalDuration = completedHandoffs.reduce(
      (sum, h) => sum + (h.completedAt! - h.createdAt),
      0
    );
    const averageDuration = completedHandoffs.length > 0
      ? totalDuration / completedHandoffs.length
      : 0;

    return {
      totalHandoffs: handoffs.length,
      pending,
      processing,
      completed,
      failed,
      averageDuration,
    };
  }

  /**
   * Clear handoffs
   * 
   * @param status - Optional status filter
   */
  clearHandoffs(status?: HandoffState['status']): void {
    if (status) {
      for (const [id, handoff] of this.handoffs.entries()) {
        if (handoff.status === status) {
          this.handoffs.delete(id);
        }
      }
    } else {
      this.handoffs.clear();
    }
  }
}

// Singleton instance
export const blaxelAgentHandoff = new BlaxelAgentHandoffManager();

/**
 * Create agent handoff manager
 * 
 * @returns Agent handoff manager
 */
export function createAgentHandoffManager(): BlaxelAgentHandoffManager {
  return new BlaxelAgentHandoffManager();
}
