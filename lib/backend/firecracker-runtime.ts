/**
 * Firecracker Container Runtime
 * Provides microVM-based sandbox isolation
 * Based on ephemeral/serverless_workers_sdk/container_runtime.py
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { mkdirSync, existsSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import { join } from 'path';
import { randomUUID } from 'crypto';

// ===========================================
// Abstract Container Runtime Interface
// ===========================================

export interface ResourceLimits {
  vcpuCount: number;
  memSizeMiB: number;
  diskSizeMiB: number;
}

export interface ContainerInfo {
  sandboxId: string;
  workspacePath: string;
  ipAddress?: string;
  createdAt: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export abstract class ContainerRuntime extends EventEmitter {
  abstract create(
    sandboxId: string,
    image: string,
    resourceLimits?: ResourceLimits
  ): Promise<ContainerInfo>;

  abstract start(sandboxId: string): Promise<boolean>;
  abstract stop(sandboxId: string): Promise<boolean>;
  abstract destroy(sandboxId: string): Promise<boolean>;
  abstract status(sandboxId: string): Promise<string>;
  
  abstract execCommand(
    sandboxId: string,
    command: string,
    args?: string[],
    timeout?: number
  ): Promise<ExecResult>;
}

// ===========================================
// Runtime Type Enum
// ===========================================

export type RuntimeType = 'firecracker' | 'process' | 'auto';

// ===========================================
// Firecracker Runtime Implementation
// ===========================================

export interface FirecrackerConfig {
  socketPath: string;
  kernelImagePath: string;
  rootfsPath: string;
  logPath: string;
  metricsPath: string;
  cpuCount: number;
  memorySize: number; // in MB
}

export interface VMInstance {
  vmId: string;
  sandboxId: string;
  process: ChildProcess | null;
  socketPath: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
  createdAt: Date;
  startedAt?: Date;
  config: FirecrackerConfig;
}

export class FirecrackerRuntime extends EventEmitter {
  private vms: Map<string, VMInstance> = new Map();
  private readonly firecrackerBin: string;
  private readonly jailerBin: string;
  private readonly baseDir: string;

  constructor(
    firecrackerBin: string = '/usr/bin/firecracker',
    jailerBin: string = '/usr/bin/jailer',
    baseDir: string = '/tmp/firecracker'
  ) {
    super();
    this.firecrackerBin = firecrackerBin;
    this.jailerBin = jailerBin;
    this.baseDir = baseDir;

    // Ensure base directory exists
    if (!existsSync(baseDir)) {
      mkdirSync(baseDir, { recursive: true });
    }
  }

  async createVM(sandboxId: string, config?: Partial<FirecrackerConfig>): Promise<VMInstance> {
    const vmId = randomUUID();
    const vmDir = join(this.baseDir, vmId);

    // Create VM directory
    mkdirSync(vmDir, { recursive: true });

    const vmConfig: FirecrackerConfig = {
      socketPath: join(vmDir, 'firecracker.sock'),
      kernelImagePath: config?.kernelImagePath || '/var/lib/firecracker/vmlinux.bin',
      rootfsPath: config?.rootfsPath || join(vmDir, 'rootfs.img'),
      logPath: join(vmDir, 'firecracker.log'),
      metricsPath: join(vmDir, 'firecracker-metrics.json'),
      cpuCount: config?.cpuCount || 2,
      memorySize: config?.memorySize || 512,
    };

    const vm: VMInstance = {
      vmId,
      sandboxId,
      process: null,
      socketPath: vmConfig.socketPath,
      status: 'starting',
      createdAt: new Date(),
      config: vmConfig,
    };

    this.vms.set(vmId, vm);
    this.emit('vm_created', vm);

    return vm;
  }

  async startVM(vmId: string): Promise<void> {
    const vm = this.vms.get(vmId);
    if (!vm) {
      throw new Error(`VM not found: ${vmId}`);
    }

    this.emit('vm_starting', vm);

    try {
      // Create boot configuration
      const bootConfig = {
        boot_args: 'console=ttyS0 reboot=k panic=1 pci=off',
        kernel_image_path: vm.config.kernelImagePath,
      };

      // Create machine configuration
      const machineConfig = {
        vcpu_count: vm.config.cpuCount,
        mem_size_mib: vm.config.memorySize,
        smt: false,
      };

      // Create drive configuration
      const driveConfig = {
        drive_id: 'rootfs',
        path_on_host: vm.config.rootfsPath,
        is_root_device: true,
        is_read_only: false,
      };

      // Create network configuration
      const networkConfig = {
        iface_id: 'eth0',
        host_dev_name: `tap_${vmId.substring(0, 8)}`,
      };

      // Write configuration files
      writeFileSync(join(this.baseDir, vmId, 'boot-config.json'), JSON.stringify(bootConfig));
      writeFileSync(join(this.baseDir, vmId, 'machine-config.json'), JSON.stringify(machineConfig));
      writeFileSync(join(this.baseDir, vmId, 'drive-config.json'), JSON.stringify(driveConfig));
      writeFileSync(join(this.baseDir, vmId, 'network-config.json'), JSON.stringify(networkConfig));

      // Start Firecracker process with jailer
      const args = [
        '--id', vmId,
        '--exec-file', this.firecrackerBin,
        '--uid', '1234',
        '--gid', '1234',
        '--chroot-base-dir', this.baseDir,
        '--',
        '--api-sock', vm.config.socketPath,
      ];

      const proc = spawn(this.jailerBin, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
      });

      vm.process = proc;
      vm.status = 'running';
      vm.startedAt = new Date();

      // Handle process output
      proc.stdout?.on('data', (data) => {
        this.emit('vm_output', { vmId, data: data.toString(), stream: 'stdout' });
      });

      proc.stderr?.on('data', (data) => {
        this.emit('vm_output', { vmId, data: data.toString(), stream: 'stderr' });
      });

      proc.on('exit', (code, signal) => {
        vm.status = 'stopped';
        this.emit('vm_stopped', { vmId, code, signal });
      });

      proc.on('error', (error) => {
        vm.status = 'error';
        this.emit('vm_error', { vmId, error });
      });

      // Wait for VM to be ready
      await this.waitForVMReady(vmId);

      this.emit('vm_started', vm);
    } catch (error: any) {
      vm.status = 'error';
      this.emit('vm_start_error', { vmId, error });
      throw new Error(`Failed to start VM: ${error.message}`);
    }
  }

  private async waitForVMReady(vmId: string, timeout: number = 30000): Promise<void> {
    const vm = this.vms.get(vmId);
    if (!vm) {
      throw new Error(`VM not found: ${vmId}`);
    }

    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        // Try to connect to API socket
        const { default: net } = await import('net');
        
        await new Promise((resolve, reject) => {
          const socket = net.createConnection(vm.config.socketPath);
          socket.on('connect', () => {
            socket.end();
            resolve(true);
          });
          socket.on('error', reject);
          socket.setTimeout(1000);
          socket.on('timeout', () => {
            socket.destroy();
            reject(new Error('Connection timeout'));
          });
        });

        return; // Socket connected, VM is ready
      } catch (error) {
        // VM not ready yet, wait and retry
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    throw new Error(`VM ${vmId} failed to start within ${timeout}ms`);
  }

  async execInVM(vmId: string, command: string, args: string[] = [], cwd?: string): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    const vm = this.vms.get(vmId);
    if (!vm || vm.status !== 'running') {
      throw new Error(`VM not running: ${vmId}`);
    }

    // For now, spawn process directly (in production, this would use VM's SSH/guest agent)
    const proc = spawn(command, args, {
      cwd: cwd || vm.config.rootfsPath,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    return new Promise((resolve) => {
      proc.on('close', (exitCode) => {
        resolve({ stdout, stderr, exitCode });
      });

      proc.on('error', (error) => {
        resolve({ stdout, stderr, exitCode: null });
      });
    });
  }

  async stopVM(vmId: string): Promise<void> {
    const vm = this.vms.get(vmId);
    if (!vm) {
      throw new Error(`VM not found: ${vmId}`);
    }

    this.emit('vm_stopping', vm);

    try {
      if (vm.process && vm.process.pid) {
        process.kill(-vm.process.pid, 'SIGTERM');
        
        // Wait for process to exit
        await new Promise((resolve) => {
          vm.process?.on('exit', resolve);
          setTimeout(resolve, 5000); // Timeout after 5 seconds
        });
      }

      vm.status = 'stopped';
      this.emit('vm_stopped', vm);
    } catch (error: any) {
      this.emit('vm_stop_error', { vmId, error });
      throw error;
    }
  }

  async deleteVM(vmId: string): Promise<void> {
    const vm = this.vms.get(vmId);
    if (!vm) {
      throw new Error(`VM not found: ${vmId}`);
    }

    this.emit('vm_deleting', vm);

    try {
      // Stop VM if running
      if (vm.status === 'running') {
        await this.stopVM(vmId);
      }

      // Clean up VM directory
      const vmDir = join(this.baseDir, vmId);
      if (existsSync(vmDir)) {
        const { rm } = await import('fs/promises');
        await rm(vmDir, { recursive: true, force: true });
      }

      this.vms.delete(vmId);
      this.emit('vm_deleted', vmId);
    } catch (error: any) {
      this.emit('vm_delete_error', { vmId, error });
      throw error;
    }
  }

  async getVM(vmId: string): Promise<VMInstance | null> {
    return this.vms.get(vmId) || null;
  }

  async listVMs(): Promise<VMInstance[]> {
    return Array.from(this.vms.values());
  }

  async getVMStats(vmId: string): Promise<{ cpuUsage: number; memoryUsage: number; diskUsage: number } | null> {
    const vm = this.vms.get(vmId);
    if (!vm || vm.status !== 'running') {
      return null;
    }

    // Read metrics from Firecracker metrics file
    try {
      const metricsContent = readFileSync(vm.config.metricsPath, 'utf8');
      const metrics = JSON.parse(metricsContent);
      
      return {
        cpuUsage: metrics.vcpu_usage || 0,
        memoryUsage: metrics.memory_usage || 0,
        diskUsage: metrics.disk_usage || 0,
      };
    } catch (error) {
      return null;
    }
  }

  async shutdown(): Promise<void> {
    // Stop all VMs
    for (const vmId of this.vms.keys()) {
      try {
        await this.stopVM(vmId);
      } catch (error) {
        this.emit('shutdown_error', { vmId, error });
      }
    }

    this.vms.clear();
    this.emit('shutdown');
  }
}

// Process-based fallback runtime (for development/testing)
export class ProcessRuntime extends EventEmitter {
  private processes: Map<string, ChildProcess> = new Map();
  private readonly baseWorkspaceDir: string;

  constructor(baseWorkspaceDir: string = '/tmp/workspaces') {
    super();
    this.baseWorkspaceDir = baseWorkspaceDir;

    // Ensure base directory exists
    if (!existsSync(baseWorkspaceDir)) {
      mkdirSync(baseWorkspaceDir, { recursive: true });
    }
  }

  async createSandbox(sandboxId: string): Promise<{ sandboxId: string; workspace: string }> {
    const workspace = join(this.baseWorkspaceDir, sandboxId);
    
    // Create workspace directory structure
    mkdirSync(workspace, { recursive: true });
    mkdirSync(join(workspace, 'code'), { recursive: true });
    mkdirSync(join(workspace, '.config'), { recursive: true });
    mkdirSync(join(workspace, '.cache'), { recursive: true });

    this.emit('sandbox_created', { sandboxId, workspace });
    
    return { sandboxId, workspace };
  }

  async execInSandbox(sandboxId: string, command: string, args: string[] = [], cwd?: string): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    const workspace = join(this.baseWorkspaceDir, sandboxId);
    
    if (!existsSync(workspace)) {
      throw new Error(`Sandbox not found: ${sandboxId}`);
    }

    const proc = spawn(command, args, {
      cwd: cwd || workspace,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.processes.set(sandboxId, proc);

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
      this.emit('sandbox_output', { sandboxId, data: data.toString(), stream: 'stdout' });
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
      this.emit('sandbox_output', { sandboxId, data: data.toString(), stream: 'stderr' });
    });

    return new Promise((resolve) => {
      proc.on('close', (exitCode) => {
        this.processes.delete(sandboxId);
        resolve({ stdout, stderr, exitCode });
      });

      proc.on('error', (error) => {
        this.processes.delete(sandboxId);
        resolve({ stdout, stderr, exitCode: null });
      });
    });
  }

  async deleteSandbox(sandboxId: string): Promise<void> {
    const workspace = join(this.baseWorkspaceDir, sandboxId);
    
    if (!existsSync(workspace)) {
      throw new Error(`Sandbox not found: ${sandboxId}`);
    }

    // Kill any running process
    const proc = this.processes.get(sandboxId);
    if (proc && proc.pid) {
      proc.kill('SIGTERM');
      this.processes.delete(sandboxId);
    }

    // Clean up workspace
    const { rm } = await import('fs/promises');
    await rm(workspace, { recursive: true, force: true });

    this.emit('sandbox_deleted', sandboxId);
  }

  async shutdown(): Promise<void> {
    // Kill all running processes
    for (const [sandboxId, proc] of this.processes.entries()) {
      if (proc.pid) {
        proc.kill('SIGTERM');
      }
    }
    this.processes.clear();
    this.emit('shutdown');
  }
}

// Factory function to create runtime
export function createRuntime(type: 'firecracker' | 'process' | 'auto', config?: any): FirecrackerRuntime | ProcessRuntime {
  if (type === 'firecracker') {
    return new FirecrackerRuntime(
      config?.firecrackerBin,
      config?.jailerBin,
      config?.baseDir
    );
  } else if (type === 'process') {
    return new ProcessRuntime(config?.baseWorkspaceDir);
  } else {
    // Auto-detect: try Firecracker, fall back to Process
    try {
      const { existsSync } = require('fs');
      if (existsSync('/usr/bin/firecracker')) {
        return new FirecrackerRuntime();
      }
    } catch (error) {
      // Fall through to Process runtime
    }
    return new ProcessRuntime();
  }
}

// Singleton instances
let firecrackerRuntime: FirecrackerRuntime | null = null;
let processRuntime: ProcessRuntime | null = null;

export function getFirecrackerRuntime(config?: any): FirecrackerRuntime {
  if (!firecrackerRuntime) {
    firecrackerRuntime = new FirecrackerRuntime(
      config?.firecrackerBin,
      config?.jailerBin,
      config?.baseDir
    );
  }
  return firecrackerRuntime;
}

export function getProcessRuntime(baseWorkspaceDir?: string): ProcessRuntime {
  if (!processRuntime) {
    processRuntime = new ProcessRuntime(baseWorkspaceDir);
  }
  return processRuntime;
}
