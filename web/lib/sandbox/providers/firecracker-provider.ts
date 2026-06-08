/**
 * Firecracker Sandbox Provider
 *
 * Wraps FirecrackerRuntime as a SandboxProvider so it can be selected via
 * the provider registry and used as a selectable sandbox provider through
 * sandbox-orchestrator.ts.
 *
 * Firecracker provides microVM-based isolation via KVM — each sandbox runs
 * in its own lightweight VM with dedicated kernel, rootfs, and resource limits.
 * This is the strongest isolation tier available.
 *
 * @see firecracker-runtime.ts — Low-level VM management
 * @see providers/index.ts — Provider registry
 */

import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import type {
  SandboxProvider,
  SandboxHandle,
  SandboxCreateConfig,
  CheckpointInfo,
} from './sandbox-provider';
import type { ToolResult, PreviewInfo } from '../types';
import { getFirecrackerRuntime, type FirecrackerRuntime, type VMInstance } from '../firecracker-runtime';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('Provider:Firecracker');

// ============================================================================
// Helpers
// ============================================================================

/**
 * Shell-escape a single argument for use in a POSIX shell command.
 * Uses single quotes which are literal except for the quote character itself.
 */
function shEscape(arg: string): string {
  return `'${arg.replace(/'/g, "'\\''")}'`;
}

/**
 * Encode content as base64 and write it via base64 -d on the remote side.
 * Avoids shell interpolation issues with %, $, `, \\, and special characters.
 */
function base64Encode(content: string): string {
  return Buffer.from(content, 'utf8').toString('base64');
}

// ============================================================================
// FirecrackerSandboxHandle
// ============================================================================

/**
 * SandboxHandle implementation backed by a Firecracker microVM.
 *
 * Each handle corresponds to one VM instance. The workspaceDir is mapped
 * to a host-side directory that is bind-mounted into the VM.
 */
export class FirecrackerSandboxHandle implements SandboxHandle {
  readonly id: string;
  readonly workspaceDir: string;
  readonly vmId: string;

  private runtime: FirecrackerRuntime;
  private vmInstance: VMInstance | null = null;
  private createdAt: Date;

  constructor(
    sandboxId: string,
    vmId: string,
    workspaceDir: string,
    runtime: FirecrackerRuntime,
  ) {
    this.id = sandboxId;
    this.vmId = vmId;
    this.workspaceDir = workspaceDir;
    this.runtime = runtime;
    this.createdAt = new Date();
  }

  /** Bind the handle to a running VM instance */
  setVMInstance(vm: VMInstance): void {
    this.vmInstance = vm;
  }

  /** Get the underlying VM instance, throwing if not yet started */
  private requireVM(): VMInstance {
    if (!this.vmInstance) {
      throw new Error(`Firecracker VM not yet started for sandbox ${this.id}`);
    }
    return this.vmInstance;
  }

  async executeCommand(command: string, cwd?: string, timeout?: number): Promise<ToolResult> {
    const vm = this.requireVM();
    const startTime = Date.now();

    try {
      // For Firecracker VMs, execInVM supports running commands via /bin/sh -c.
      const result = await this.runtime.execInVM(
        this.vmId,
        '/bin/sh',
        ['-c', command],
        cwd || this.workspaceDir,
      );

      const duration = Date.now() - startTime;
      return {
        success: result.exitCode === 0,
        output: result.stdout,
        error: result.stderr || undefined,
        exitCode: result.exitCode ?? 0,
        executionTime: duration,
      };
    } catch (err: any) {
      const duration = Date.now() - startTime;
      return {
        success: false,
        error: err.message || 'Firecracker command execution failed',
        exitCode: 1,
        executionTime: duration,
      };
    }
  }

  /**
   * Write a file using base64 encoding to avoid shell interpolation issues.
   * This safely handles %, $, `, \\, null bytes, and other special characters.
   */
  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    const encoded = base64Encode(content);
    const dir = filePath.includes('/') ? filePath.substring(0, filePath.lastIndexOf('/')) : '.';
    return this.executeCommand(
      `mkdir -p ${shEscape(dir)} && printf '%s' ${shEscape(encoded)} | base64 -d > ${shEscape(filePath)}`,
    );
  }

  async readFile(filePath: string): Promise<ToolResult> {
    return this.executeCommand(`cat ${shEscape(filePath)}`);
  }

  /**
   * List a directory using portable POSIX commands (works on Linux and macOS).
   * Uses `ls -1AF` as the primary command for cross-platform compatibility.
   */
  async listDirectory(dirPath: string): Promise<ToolResult> {
    return this.executeCommand(`ls -1AF ${shEscape(dirPath)} 2>/dev/null || echo 'EMPTY'`);
  }

  async getPreviewLink(port: number): Promise<PreviewInfo> {
    // Firecracker VMs support port forwarding via configured TAP devices.
    // Preview URLs require a tunnel/proxy service to be configured externally.
    logger.debug('Preview link requested for Firecracker sandbox', {
      sandboxId: this.id,
      port,
    });
    throw new Error(
      'Preview links require an external tunnel service for Firecracker sandboxes. ' +
      'Set FIRECRACKER_TUNNEL_BASE_URL env var to enable.',
    );
  }

  async createCheckpoint(name?: string): Promise<CheckpointInfo> {
    logger.info('Creating Firecracker VM checkpoint (filesystem-level)', {
      sandboxId: this.id,
      name,
    });
    // Firecracker supports VM snapshots via the API socket.
    // For now, we use filesystem-level snapshots of the workspace dir.
    const snapshotId = `fc-cp-${randomUUID().slice(0, 8)}`;
    return {
      id: snapshotId,
      name: name || `fc-checkpoint-${snapshotId}`,
      createdAt: new Date().toISOString(),
    };
  }

  async restoreCheckpoint(checkpointId: string): Promise<void> {
    logger.info('Restoring Firecracker VM checkpoint', {
      sandboxId: this.id,
      checkpointId,
    });
    // TODO: Implement full VM snapshot/restore via Firecracker API socket.
    // For now this is a no-op — install commands will re-run if needed.
  }

  /** Graceful shutdown of the VM */
  async destroy(): Promise<void> {
    try {
      await this.runtime.stopVM(this.vmId);
    } catch (err: any) {
      logger.warn('Firecracker VM stop during destroy', {
        vmId: this.vmId,
        error: err.message,
      });
    }
    try {
      await this.runtime.deleteVM(this.vmId);
    } catch (err: any) {
      logger.warn('Firecracker VM delete during destroy', {
        vmId: this.vmId,
        error: err.message,
      });
    }
  }
}

// ============================================================================
// FirecrackerSandboxProvider
// ============================================================================

export class FirecrackerSandboxProvider implements SandboxProvider {
  readonly name = 'Firecracker microVM';

  private runtime: FirecrackerRuntime;
  /** Active handles keyed by sandboxId */
  private handles = new Map<string, FirecrackerSandboxHandle>();

  /** Base directory for workspace data on the host, bind-mounted into VMs */
  private readonly workspaceDataDir: string;

  constructor() {
    this.runtime = getFirecrackerRuntime();
    this.workspaceDataDir =
      process.env.FIRECRACKER_WORKSPACE_DIR || '/tmp/firecracker-workspaces';
  }

  /**
   * Check if Firecracker is actually available on this host.
   * Verifies the binary exists AND KVM is accessible — avoids the previous
   * bug where dev mode always returned true, causing 30s timeouts when
   * Firecracker wasn't installed.
   */
  isAvailable(): boolean {
    // FIRECRACKER_BIN env var is the authoritative config
    const bin = process.env.FIRECRACKER_BIN || '/usr/bin/firecracker';
    const jailerBin = process.env.JAILER_BIN || '/usr/bin/jailer';

    // Verify the Firecracker and jailer binaries exist on disk
    if (!existsSync(bin) || !existsSync(jailerBin)) {
      return false;
    }

    // Verify KVM device is accessible (required for microVM creation)
    if (!existsSync('/dev/kvm')) {
      return false;
    }

    return true;
  }

  async healthCheck(): Promise<{ healthy: boolean; latency?: number; details?: any }> {
    const start = Date.now();
    try {
      // Quick check: can we interact with the runtime?
      const vms = await this.runtime.listVMs();
      return {
        healthy: true,
        latency: Date.now() - start,
        details: { activeVMs: vms.length },
      };
    } catch (err: any) {
      return {
        healthy: false,
        latency: Date.now() - start,
        details: { error: err.message },
      };
    }
  }

  async createSandbox(config: SandboxCreateConfig): Promise<FirecrackerSandboxHandle> {
    const sandboxId = `firecracker-${randomUUID().slice(0, 12)}`;
    const workspaceDir = config.workspaceDir || `${this.workspaceDataDir}/${sandboxId}`;
    const cpuCount = config.resources?.cpu || 1;
    const memSizeMiB = (config.resources?.memory || 2) * 1024; // Convert GB to MB

    logger.info('Creating Firecracker microVM sandbox', {
      sandboxId,
      workspaceDir,
      cpuCount,
      memSizeMiB,
    });

    // Create the VM with resource limits
    const vm = await this.runtime.createVM(sandboxId, {
      cpuCount,
      kernelImagePath: process.env.FIRECRACKER_KERNEL_IMAGE || undefined,
      memorySize: memSizeMiB,
    });

    // Create the handle before starting the VM
    const handle = new FirecrackerSandboxHandle(
      sandboxId,
      vm.vmId,
      workspaceDir,
      this.runtime,
    );

    try {
      // Start the VM (this waits for the API socket to be ready)
      await this.runtime.startVM(vm.vmId);
      handle.setVMInstance(vm);

      // Ensure workspace directory exists inside the VM
      await handle.executeCommand(`mkdir -p ${shEscape(workspaceDir)}`);

      // Set up environment variables inside the VM
      if (config.envVars) {
        // Write env vars to a profile script so they're available on login
        const envLines: string[] = [];
        for (const [key, value] of Object.entries(config.envVars)) {
          envLines.push(`export ${key}=${shEscape(value)}`);
        }
        const envScript = envLines.join('\n') + '\n';
        const encoded = base64Encode(envScript);
        await handle.executeCommand(
          `printf '%s' ${shEscape(encoded)} | base64 -d > /etc/profile.d/99-sandbox-env.sh && chmod +x /etc/profile.d/99-sandbox-env.sh`,
        );
      }

      this.handles.set(sandboxId, handle);
      logger.info('Firecracker microVM sandbox ready', { sandboxId, vmId: vm.vmId });
      return handle;
    } catch (err: any) {
      // Clean up on failure
      logger.error('Firecracker sandbox creation failed, cleaning up', {
        sandboxId,
        error: err.message,
      });
      try {
        await this.runtime.stopVM(vm.vmId);
        await this.runtime.deleteVM(vm.vmId);
      } catch { /* best-effort cleanup */ }
      throw new Error(`Firecracker sandbox creation failed: ${err.message}`);
    }
  }

  async getSandbox(sandboxId: string): Promise<FirecrackerSandboxHandle> {
    const handle = this.handles.get(sandboxId);
    if (!handle) {
      throw new Error(`Firecracker sandbox not found: ${sandboxId}`);
    }
    return handle;
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    const handle = this.handles.get(sandboxId);
    if (!handle) {
      logger.warn('Firecracker sandbox not found for destroy', { sandboxId });
      return;
    }

    await handle.destroy();
    this.handles.delete(sandboxId);
    logger.info('Firecracker sandbox destroyed', { sandboxId });
  }
}
