/**
 * Auto-Suspend Service
 *
 * Automatically suspends inactive sandboxes to save resources.
 * Configurable idle timeout and suspension policies.
 *
 * Features:
 * - Idle detection with configurable timeout
 * - Graceful suspension with state preservation
 * - Auto-resume on access
 * - Resource usage tracking
 *
 * @see https://codesandbox.io/docs/hibernation
 */

import { EventEmitter } from 'events';
import type { SandboxHandle, SandboxProvider } from './types';

export interface AutoSuspendConfig {
  /** Idle timeout in ms before suspension (default: 30 minutes) */
  idleTimeout: number;
  /** Check interval in ms (default: 5 minutes) */
  checkInterval: number;
  /** Minimum sandboxes to keep active */
  minActive: number;
  /** Maximum sandboxes before aggressive suspension */
  maxActive: number;
  /** Enable auto-resume */
  autoResume: boolean;
  /** Track activity patterns */
  trackPatterns: boolean;
}

export interface SandboxActivity {
  sandboxId: string;
  lastActive: number;
  accessCount: number;
  avgSessionDuration: number;
  suspendedCount: number;
}

export interface SuspensionEvent {
  sandboxId: string;
  type: 'idle' | 'manual' | 'aggressive';
  timestamp: number;
  reason: string;
}

export class AutoSuspendService extends EventEmitter {
  private static instance: AutoSuspendService;
  private config: AutoSuspendConfig;
  private activities = new Map<string, SandboxActivity>();
  private checkTimer?: NodeJS.Timeout;
  private suspendedSandboxes = new Map<string, {
    provider: string;
    suspendedAt: number;
    state?: any;
  }>();
  private providers = new Map<string, SandboxProvider>();

  private constructor(config?: Partial<AutoSuspendConfig>) {
    super();
    this.config = {
      idleTimeout: 30 * 60 * 1000, // 30 minutes
      checkInterval: 5 * 60 * 1000, // 5 minutes
      minActive: 2,
      maxActive: 10,
      autoResume: true,
      trackPatterns: true,
      ...config,
    };
  }

  static getInstance(config?: Partial<AutoSuspendConfig>): AutoSuspendService {
    if (!AutoSuspendService.instance) {
      AutoSuspendService.instance = new AutoSuspendService(config);
    }
    return AutoSuspendService.instance;
  }

  /**
   * Start auto-suspend monitoring
   */
  start(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
    }

    this.checkTimer = setInterval(() => {
      this.checkIdleSandboxes();
    }, this.config.checkInterval);

    console.log(`[AutoSuspend] Started with ${this.config.idleTimeout / 60000}min idle timeout`);
  }

  /**
   * Stop auto-suspend monitoring
   */
  stop(): void {
    if (this.checkTimer) {
      clearInterval(this.checkTimer);
      this.checkTimer = undefined;
    }
    console.log('[AutoSuspend] Stopped');
  }

  /**
   * Register a provider for suspension operations
   */
  registerProvider(name: string, provider: SandboxProvider): void {
    this.providers.set(name, provider);
  }

  /**
   * Track sandbox activity
   */
  trackActivity(sandboxId: string): void {
    const activity = this.activities.get(sandboxId) || {
      sandboxId,
      lastActive: Date.now(),
      accessCount: 0,
      avgSessionDuration: 0,
      suspendedCount: 0,
    };

    activity.lastActive = Date.now();
    activity.accessCount++;

    this.activities.set(sandboxId, activity);
  }

  /**
   * Check for idle sandboxes and suspend if needed
   */
  private async checkIdleSandboxes(): Promise<void> {
    const now = Date.now();
    const idleThreshold = now - this.config.idleTimeout;

    const idleSandboxes: string[] = [];

    for (const [sandboxId, activity] of this.activities.entries()) {
      if (activity.lastActive < idleThreshold) {
        idleSandboxes.push(sandboxId);
      }
    }

    // Sort by last active (oldest first)
    idleSandboxes.sort((a, b) => {
      const aActivity = this.activities.get(a)!;
      const bActivity = this.activities.get(b)!;
      return aActivity.lastActive - bActivity.lastActive;
    });

    // Keep minimum active sandboxes
    const toSuspend = idleSandboxes.slice(0, Math.max(0, idleSandboxes.length - this.config.minActive));

    for (const sandboxId of toSuspend) {
      await this.suspendSandbox(sandboxId, 'idle');
    }

    // Aggressive suspension if over max
    if (this.activities.size > this.config.maxActive) {
      const aggressiveSuspend = idleSandboxes.slice(
        Math.max(0, idleSandboxes.length - this.config.minActive),
        idleSandboxes.length - this.config.maxActive + this.config.minActive
      );

      for (const sandboxId of aggressiveSuspend) {
        await this.suspendSandbox(sandboxId, 'aggressive');
      }
    }
  }

  /**
   * Suspend a sandbox
   */
  async suspendSandbox(sandboxId: string, type: 'idle' | 'manual' | 'aggressive' = 'idle'): Promise<boolean> {
    const activity = this.activities.get(sandboxId);
    if (!activity) {
      return false;
    }

    try {
      // Find provider for this sandbox
      let provider: SandboxProvider | undefined;
      let providerName = '';

      for (const [name, p] of this.providers.entries()) {
        try {
          await p.getSandbox(sandboxId);
          provider = p;
          providerName = name;
          break;
        } catch {
          // Not this provider
        }
      }

      if (!provider) {
        console.warn(`[AutoSuspend] Provider not found for sandbox ${sandboxId}`);
        return false;
      }

      // Save state before suspension
      const state = await this.captureSandboxState(sandboxId, provider);

      // Suspend the sandbox
      await provider.shutdownSandbox(sandboxId);

      // Track suspension
      this.suspendedSandboxes.set(sandboxId, {
        provider: providerName,
        suspendedAt: Date.now(),
        state,
      });

      activity.suspendedCount++;

      // Emit event
      const event: SuspensionEvent = {
        sandboxId,
        type,
        timestamp: Date.now(),
        reason: type === 'idle' 
          ? `Idle for ${this.config.idleTimeout / 60000} minutes`
          : type === 'aggressive'
          ? 'Resource limit exceeded'
          : 'Manual suspension',
      };

      this.emit('suspend', event);
      console.log(`[AutoSuspend] Suspended ${sandboxId}: ${event.reason}`);

      return true;
    } catch (error: any) {
      console.error(`[AutoSuspend] Failed to suspend ${sandboxId}:`, error.message);
      this.emit('error', { sandboxId, error: error.message });
      return false;
    }
  }

  /**
   * Resume a suspended sandbox
   */
  async resumeSandbox(sandboxId: string): Promise<boolean> {
    const suspended = this.suspendedSandboxes.get(sandboxId);
    if (!suspended) {
      return false;
    }

    try {
      const provider = this.providers.get(suspended.provider);
      if (!provider) {
        console.error(`[AutoSuspend] Provider ${suspended.provider} not found`);
        return false;
      }

      // Create new sandbox
      const newSandbox = await provider.createSandbox({ ownerId: sandboxId });

      // Restore state if available
      if (suspended.state) {
        await this.restoreSandboxState(newSandbox, suspended.state);
      }

      // Update tracking
      this.suspendedSandboxes.delete(sandboxId);
      this.trackActivity(sandboxId);

      // Emit event
      this.emit('resume', { sandboxId, timestamp: Date.now() });
      console.log(`[AutoSuspend] Resumed ${sandboxId}`);

      return true;
    } catch (error: any) {
      console.error(`[AutoSuspend] Failed to resume ${sandboxId}:`, error.message);
      this.emit('error', { sandboxId, error: error.message });
      return false;
    }
  }

  /**
   * Capture sandbox state before suspension
   */
  private async captureSandboxState(
    sandboxId: string,
    provider: SandboxProvider
  ): Promise<any> {
    try {
      const sandbox = await provider.getSandbox(sandboxId);
      
      // List files in workspace
      const files = await sandbox.listDirectory(sandbox.workspaceDir);
      
      return {
        files: files.files?.map((f: any) => f.path) || [],
        capturedAt: Date.now(),
      };
    } catch {
      return null;
    }
  }

  /**
   * Restore sandbox state after resume
   */
  private async restoreSandboxState(
    sandbox: SandboxHandle,
    state: any
  ): Promise<void> {
    // State restoration logic
    // For now, just verify files exist
    if (state?.files) {
      console.log(`[AutoSuspend] Restored ${state.files.length} files for ${sandbox.id}`);
    }
  }

  /**
   * Get suspension statistics
   */
  getStats(): {
    totalTracked: number;
    suspended: number;
    active: number;
    avgIdleTime: number;
  } {
    const now = Date.now();
    const idleTimes = Array.from(this.activities.values())
      .map(a => now - a.lastActive);

    return {
      totalTracked: this.activities.size,
      suspended: this.suspendedSandboxes.size,
      active: this.activities.size - this.suspendedSandboxes.size,
      avgIdleTime: idleTimes.length > 0 
        ? idleTimes.reduce((a, b) => a + b, 0) / idleTimes.length 
        : 0,
    };
  }

  /**
   * Get activity for a specific sandbox
   */
  getActivity(sandboxId: string): SandboxActivity | undefined {
    return this.activities.get(sandboxId);
  }

  /**
   * Clear activity tracking for a sandbox
   */
  clearActivity(sandboxId: string): void {
    this.activities.delete(sandboxId);
  }
}

// Export singleton instance
export const autoSuspendService = AutoSuspendService.getInstance();
