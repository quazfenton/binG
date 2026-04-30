/**
 * SelfEvolvingAgent
 * 
 * Monitors task execution outcomes and dynamically adjusts agent configuration 
 * (temperature, model, maxTokens) to optimize for success.
 */

import { chatLogger } from '../chat/chat-logger';

export class SelfEvolvingAgent {
  private static readonly PERFORMANCE_KEY = 'agent_evolution_stats';

  /**
   * Adjust configuration based on past results.
   */
  static optimizeConfig(task: string, currentConfig: any): any {
    const stats = this.getStats();
    
    // Example: If task failed recently, decrease temperature to reduce creative hallucination
    if (stats[task]?.failureCount > 2) {
      chatLogger.info('[AgentEvolution] Performance low for task, tightening temperature', { task });
      return { ...currentConfig, temperature: Math.max(0.1, currentConfig.temperature - 0.1) };
    }
    
    return currentConfig;
  }

  static recordResult(task: string, success: boolean) {
    const stats = this.getStats();
    if (!stats[task]) stats[task] = { successCount: 0, failureCount: 0 };
    
    if (success) stats[task].successCount++;
    else stats[task].failureCount++;
    
    localStorage.setItem(this.PERFORMANCE_KEY, JSON.stringify(stats));
  }

  private static getStats(): Record<string, { successCount: number, failureCount: number }> {
    if (typeof window === 'undefined') return {};
    const data = localStorage.getItem(this.PERFORMANCE_KEY);
    return data ? JSON.parse(data) : {};
  }
}
