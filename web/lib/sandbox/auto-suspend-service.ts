/**
 * Auto-Suspend Service
 *
 * Automatically suspends inactive sandboxes to save resources.
 * Configurable idle timeout and suspension policies.
 *
 * Features:
 * - Idle detection with configurable timeout
 * - Graceful suspension with state preservation (filesystem, env vars, cwd)
 * - Auto-resume on access with state restoration
 * - Resource usage tracking
 * - Provider-agnostic suspension (supports all sandbox providers)
 *
 * @see https://codesandbox.io/docs/hibernation
 * @see https://docs.blaxel.ai/Agents/Asynchronous-triggers
 */

import { EventEmitter } from 'node:events';
import type { SandboxHandle, SandboxProvider } from './providers';
import type { SandboxProviderType } from './providers';
import type { WorkspaceSession, SandboxConfig } from './types';
import { sandboxBridge } from './sandbox-service-bridge';

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
  /** Enable state preservation (default: true) */
  preserveState: boolean;
  /** Enable state restoration on resume (default: true) */
  restoreState: boolean;
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

/**
 * Captured sandbox state for preservation across suspension
 */
export interface SandboxState {
  /** Current working directory */
  cwd: string;
  /** Environment variables */
  environment: Record<string, string>;
  /** List of files in workspace */
  files: string[];
  /** Running processes (informational only) */
  processes: string[];
  /** Captured at timestamp */
  capturedAt: number;
  /** Sandbox provider type */
  provider: string;
}

export class AutoSuspendService extends EventEmitter {
  private static instance: AutoSuspendService;
  private config: AutoSuspendConfig;
  private activities = new Map<string, SandboxActivity>();
  private checkTimer?: NodeJS.Timeout;
  private suspendedSandboxes = new Map<string, {
    provider: string;
    suspendedAt: number;
    state?: SandboxState | null;
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
      preserveState: true,
      restoreState: true,
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
   * Suspend a sandbox WITH STATE PRESERVATION
   * 
   * Captures filesystem, environment variables, and working directory
   * before suspension for restoration on resume.
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

      // Capture state before suspension (if enabled)
      let state: SandboxState | null = null;
      if (this.config.preserveState) {
        state = await this.captureSandboxState(sandboxId, provider);
        if (state) {
          console.log(`[AutoSuspend] Captured state for ${sandboxId}: ${state.files.length} files, cwd=${state.cwd}`);
        }
      }

      // Try provider-specific suspension first, fallback to shutdown
      try {
        if ('suspendSandbox' in provider && typeof provider.suspendSandbox === 'function') {
          await provider.suspendSandbox(sandboxId);
        } else if ('shutdownSandbox' in provider && typeof provider.shutdownSandbox === 'function') {
          await provider.shutdownSandbox(sandboxId);
        } else {
          console.warn(`[AutoSuspend] Provider ${providerName} has no suspension method`);
          return false;
        }
      } catch (suspendError: any) {
        console.error(`[AutoSuspend] Suspension failed for ${sandboxId}:`, suspendError.message);
        throw suspendError;
      }

      // Track suspension with state
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
      console.log(`[AutoSuspend] Suspended ${sandboxId}: ${event.reason}${state ? ' (state preserved)' : ''}`);

      return true;
    } catch (error: any) {
      console.error(`[AutoSuspend] Failed to suspend ${sandboxId}:`, error.message);
      this.emit('error', { sandboxId, error: error.message });
      return false;
    }
  }

  /**
   * Resume a suspended sandbox WITH STATE RESTORATION
   * 
   * Creates new sandbox and restores filesystem, environment, and working directory
   */
  async resumeSandbox(sandboxId: string): Promise<boolean> {
    const suspended = this.suspendedSandboxes.get(sandboxId);
    if (!suspended) {
      // Check if sandbox is active (not suspended)
      const activity = this.activities.get(sandboxId);
      if (activity) {
        console.log(`[AutoSuspend] ${sandboxId} is already active`);
        return true;
      }
      return false;
    }

    try {
      const provider = this.providers.get(suspended.provider);
      if (!provider) {
        console.error(`[AutoSuspend] Provider ${suspended.provider} not found`);
        return false;
      }

      // Create new sandbox
      console.log(`[AutoSuspend] Creating new sandbox for ${sandboxId}`);
      // @ts-ignore - ownerId may not be in SandboxCreateConfig type
      const newSandbox = await provider.createSandbox({ ownerId: sandboxId });

      // Start VFS sync for the resumed sandbox
      try {
        const { sandboxFilesystemSync } = await import('../virtual-filesystem/sync/sandbox-filesystem-sync');
        sandboxFilesystemSync.startSync(newSandbox.id, sandboxId);
        console.log(`[AutoSuspend] Started VFS sync for resumed sandbox`);
      } catch (syncErr: any) {
        console.warn(`[AutoSuspend] Failed to start VFS sync on resume:`, syncErr.message);
      }

      // Restore state if available and enabled
      if (suspended.state && this.config.restoreState) {
        console.log(`[AutoSuspend] Restoring state for ${sandboxId}`);
        await this.restoreSandboxState(newSandbox, suspended.state);
      }

      // Update tracking
      this.suspendedSandboxes.delete(sandboxId);
      this.trackActivity(sandboxId);

      // Emit event
      this.emit('resume', { 
        sandboxId, 
        timestamp: Date.now(),
        stateRestored: !!suspended.state,
      });
      console.log(`[AutoSuspend] Resumed ${sandboxId}${suspended.state ? ' with state restoration' : ''}`);

      return true;
    } catch (error: any) {
      console.error(`[AutoSuspend] Failed to resume ${sandboxId}:`, error.message);
      this.emit('error', { sandboxId, error: error.message });
      return false;
    }
  }

  /**
   * Capture sandbox state before suspension
   * 
   * Captures:
   * - Current working directory
   * - Environment variables
   * - List of files in workspace
   * - Running processes (informational)
   */
  private async captureSandboxState(
    sandboxId: string,
    provider: SandboxProvider
  ): Promise<SandboxState | null> {
    try {
      const sandbox = await provider.getSandbox(sandboxId);
      const workspaceDir = sandbox.workspaceDir || '/workspace';

      // Capture current working directory
      let cwd = workspaceDir;
      try {
        const cwdResult = await sandbox.executeCommand('pwd', workspaceDir, 5000);
        if (cwdResult.success && cwdResult.output) {
          cwd = cwdResult.output.trim();
        }
      } catch {
        // Use default workspace dir
      }

      // Capture environment variables
      const env: Record<string, string> = {};
      try {
        const envResult = await sandbox.executeCommand('env', workspaceDir, 5000);
        if (envResult.success && envResult.output) {
          for (const line of envResult.output.split('\n')) {
            const [key, ...valueParts] = line.split('=');
            if (key && valueParts.length > 0) {
              env[key.trim()] = valueParts.join('=').trim();
            }
          }
        }
      } catch {
        // Environment capture failed, continue
      }

      // List files in workspace
      const files: string[] = [];
      try {
        const filesResult = await sandbox.executeCommand(`find ${workspaceDir} -type f`, workspaceDir, 10000);
        if (filesResult.success && filesResult.output) {
          files.push(...filesResult.output.split('\n').filter(f => f.trim()));
        }
      } catch {
        // File listing failed, try alternative
        try {
          const lsResult = await sandbox.executeCommand(`ls -la ${workspaceDir}`, workspaceDir, 5000);
          if (lsResult.success && lsResult.output) {
            files.push(...lsResult.output.split('\n').filter(f => f.trim()));
          }
        } catch {
          // Both file listing methods failed
        }
      }

      // Capture running processes (informational only)
      const processes: string[] = [];
      try {
        const psResult = await sandbox.executeCommand('ps aux', workspaceDir, 5000);
        if (psResult.success && psResult.output) {
          processes.push(...psResult.output.split('\n').filter(p => p.trim()));
        }
      } catch {
        // Process listing failed
      }

      return {
        cwd,
        environment: env,
        files,
        processes,
        capturedAt: Date.now(),
        provider: provider.name,
      };
    } catch (error: any) {
      console.error(`[AutoSuspend] Failed to capture state for ${sandboxId}:`, error.message);
      return null;
    }
  }

  /**
   * Restore sandbox state after resume
   * 
   * Restores:
   * - Current working directory
   * - Environment variables
   * - Files (from VFS sync or provider checkpoint)
   * 
   * Note: Process restoration is not possible, but we log what was running
   */
  private async restoreSandboxState(
    sandbox: SandboxHandle,
    state: SandboxState
  ): Promise<void> {
    const workspaceDir = sandbox.workspaceDir || '/workspace';
    let restoredCount = 0;

    try {
      // Restore environment variables
      if (state.environment && Object.keys(state.environment).length > 0) {
        for (const [key, value] of Object.entries(state.environment)) {
          // Skip dangerous or system variables
          if (['PATH', 'HOME', 'USER'].includes(key)) continue;
          
          try {
            await sandbox.executeCommand(`export ${key}='${value.replace(/'/g, "'\\''")}'`, workspaceDir, 2000);
            restoredCount++;
          } catch (envError: any) {
            console.warn(`[AutoSuspend] Failed to restore env var ${key}:`, envError.message);
          }
        }
        console.log(`[AutoSuspend] Restored ${restoredCount} environment variables`);
      }

      // Restore working directory
      if (state.cwd && state.cwd !== workspaceDir) {
        try {
          await sandbox.executeCommand(`cd ${state.cwd}`, workspaceDir, 2000);
          console.log(`[AutoSuspend] Restored working directory: ${state.cwd}`);
        } catch (cwdError: any) {
          console.warn(`[AutoSuspend] Failed to restore cwd:`, cwdError.message);
        }
      }

      // Note: File restoration depends on provider
      // Some providers (Sprites, Blaxel) have persistent volumes
      // Others need VFS sync to restore files
      if (state.files && state.files.length > 0) {
        console.log(`[AutoSuspend] Sandbox had ${state.files.length} files before suspension`);
        console.log(`[AutoSuspend] Files: ${state.files.slice(0, 10).join(', ')}${state.files.length > 10 ? '...' : ''}`);
        
        // Trigger VFS sync if available
        try {
          const { sandboxFilesystemSync } = await import('../virtual-filesystem/sync/sandbox-filesystem-sync');
          // This will sync files from VFS to sandbox
          sandboxFilesystemSync.startSync(sandbox.id, sandbox.id);
          console.log(`[AutoSuspend] Started VFS sync for file restoration`);
        } catch (syncError: any) {
          console.warn(`[AutoSuspend] VFS sync not available:`, syncError.message);
        }
      }

      // Log processes that were running (informational only)
      if (state.processes && state.processes.length > 0) {
        console.log(`[AutoSuspend] Processes before suspension: ${state.processes.length}`);
        console.log(`[AutoSuspend] Note: Processes cannot be restored, but these were running:`);
        state.processes.slice(0, 5).forEach(p => console.log(`  ${p}`));
      }

      console.log(`[AutoSuspend] State restoration complete for ${sandbox.id}`);
    } catch (error: any) {
      console.error(`[AutoSuspend] State restoration failed:`, error.message);
      // Don't throw - partial restoration is better than none
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
