/**
 * Desktop Sandbox Provider
 *
 * Executes commands and file operations directly on the user's local machine.
 * Used in Tauri desktop mode for native execution without cloud sandbox overhead.
 *
 * Security: Desktop mode is intentionally less restrictive than cloud sandboxes.
 * Users have full control over their local machine. Dangerous command warnings
 * are logged but not blocked by default.
 */

import { spawn } from 'child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'crypto';
import type {
  SandboxProvider,
  SandboxHandle,
  SandboxCreateConfig,
  CheckpointInfo,
} from './sandbox-provider';
import type { ToolResult } from '../types';
import { createLogger } from '@/lib/utils/logger';
import { analyzeDesktopCommand as analyzeSecurityCommand } from '../desktop-security-policy';
import { getDefaultWorkspaceRoot, isDesktopMode } from '@bing/platform/env';
import { getShellCommand } from '@bing/platform/shell';

const log = createLogger('DesktopProvider');

const DEFAULT_TIMEOUT = 120_000; // 2 minutes
const DANGEROUS_PATTERNS = [
  /rm\s+-rf\s+\/(?!\w)/,     // rm -rf / (root)
  /mkfs\./,                   // format filesystem
  /dd\s+if=.*of=\/dev\//,    // dd to device
  /:(){ :\|:& };:/,          // fork bomb
];

function warnIfDangerous(command: string): void {
  for (const pattern of DANGEROUS_PATTERNS) {
    if (pattern.test(command)) {
      log.warn('Potentially dangerous command detected', { command: command.slice(0, 200) });
      break;
    }
  }
}

export class DesktopProvider implements SandboxProvider {
  readonly name = 'desktop';
  private workspaceRoot: string;
  private sandboxes = new Map<string, DesktopSandboxHandle>();

  constructor(workspaceRoot?: string) {
    this.workspaceRoot = workspaceRoot || process.env.DESKTOP_WORKSPACE_ROOT || getDefaultWorkspaceRoot();
  }

  isAvailable(): boolean {
    return isDesktopMode();
  }

  async healthCheck(): Promise<{ healthy: boolean; latency?: number; details?: any }> {
    const start = Date.now();
    try {
      await fs.access(this.workspaceRoot);
      return { healthy: true, latency: Date.now() - start };
    } catch {
      // Try to create it
      try {
        await fs.mkdir(this.workspaceRoot, { recursive: true });
        return { healthy: true, latency: Date.now() - start, details: { created: true } };
      } catch (err: any) {
        return { healthy: false, latency: Date.now() - start, details: { error: err.message } };
      }
    }
  }

  async createSandbox(config: SandboxCreateConfig): Promise<SandboxHandle> {
    const sandboxId = `desktop-${randomUUID().slice(0, 8)}`;
    const workspaceDir = path.join(this.workspaceRoot, sandboxId);

    await fs.mkdir(workspaceDir, { recursive: true });
    log.info('Created desktop sandbox', { sandboxId, workspaceDir });

    const handle = new DesktopSandboxHandle(sandboxId, workspaceDir);
    this.sandboxes.set(sandboxId, handle);
    return handle;
  }

  async getSandbox(sandboxId: string): Promise<SandboxHandle> {
    const cached = this.sandboxes.get(sandboxId);
    if (cached) return cached;

    // Try to find existing workspace on disk
    const workspaceDir = path.join(this.workspaceRoot, sandboxId);
    try {
      await fs.access(workspaceDir);
      const handle = new DesktopSandboxHandle(sandboxId, workspaceDir);
      this.sandboxes.set(sandboxId, handle);
      return handle;
    } catch {
      throw new Error(`Desktop sandbox not found: ${sandboxId}`);
    }
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    this.sandboxes.delete(sandboxId);
    const workspaceDir = path.join(this.workspaceRoot, sandboxId);
    try {
      await fs.rm(workspaceDir, { recursive: true, force: true });
      log.info('Destroyed desktop sandbox', { sandboxId });
    } catch (err: any) {
      log.warn('Failed to clean up sandbox directory', { sandboxId, error: err.message });
    }
  }
}

export class DesktopSandboxHandle implements SandboxHandle {
  readonly id: string;
  readonly workspaceDir: string;
  private checkpointDir: string;

  constructor(id: string, workspaceDir: string) {
    this.id = id;
    this.workspaceDir = workspaceDir;
    this.checkpointDir = path.join(workspaceDir, '.opencode', 'checkpoints');
  }

  async executeCommand(command: string, cwd?: string, timeout?: number): Promise<ToolResult> {
    warnIfDangerous(command);

    // Security: Analyze command against desktop security policy
    const securityAnalysis = analyzeSecurityCommand(command, this.workspaceDir);
    if (!securityAnalysis.allowed) {
      log.warn('Command blocked by security policy', {
        command: command.slice(0, 200),
        reason: securityAnalysis.reason,
        riskLevel: securityAnalysis.riskLevel,
      });
      return {
        success: false,
        error: securityAnalysis.reason || 'Command blocked by security policy',
        blocked: true,
      };
    }

    // Log audit entry for commands requiring approval
    if (securityAnalysis.requiresApproval) {
      log.info('Command requires approval', {
        command: command.slice(0, 200),
        riskLevel: securityAnalysis.riskLevel,
      });
    }

    const { shell, args } = getShellCommand();
    const flag = args[args.length - 1] || '-c';
    
    // Security: Validate cwd is within workspace
    let effectiveCwd = this.workspaceDir;
    if (cwd) {
      // FIX: Resolve relative cwd from workspaceDir, not host process cwd
      // This prevents incorrectly blocking valid sandbox-relative directories
      const resolvedCwd = path.isAbsolute(cwd) 
        ? path.resolve(cwd)  // Absolute path - resolve normally
        : path.resolve(this.workspaceDir, cwd);  // Relative - resolve from workspace
      
      const resolvedWorkspace = path.resolve(this.workspaceDir);
      if (!resolvedCwd.startsWith(resolvedWorkspace + path.sep) && resolvedCwd !== resolvedWorkspace) {
        return { success: false, error: 'Working directory must be within workspace', blocked: true };
      }
      effectiveCwd = resolvedCwd;
    }
    
    const effectiveTimeout = timeout || DEFAULT_TIMEOUT;

    log.debug('Executing command', { command: command.slice(0, 200), cwd: effectiveCwd });

    return new Promise<ToolResult>((resolve) => {
      const child = spawn(shell, [flag, command], {
        cwd: effectiveCwd,
        timeout: effectiveTimeout,
        env: { ...process.env, TERM: 'xterm-256color' },
        shell: false,
      });

      let stdout = '';
      let stderr = '';

      child.stdout?.on('data', (data) => { stdout += data.toString(); });
      child.stderr?.on('data', (data) => { stderr += data.toString(); });

      child.on('close', (exitCode) => {
        const output = stdout + (stderr ? `\n--- stderr ---\n${stderr}` : '');
        if (exitCode === 0) {
          resolve({ success: true, output: output.trim() });
        } else {
          resolve({
            success: false,
            output: output.trim(),
            error: `Command exited with code ${exitCode}`,
          });
        }
      });

      child.on('error', (err) => {
        resolve({ success: false, error: `Failed to execute: ${err.message}` });
      });
    });
  }

  /**
   * Validate that a resolved path is within workspace directory
   * Prevents path traversal attacks
   */
  private validatePathWithinWorkspace(filePath: string): string {
    const fullPath = path.resolve(this.workspaceDir, filePath);
    const resolvedWorkspace = path.resolve(this.workspaceDir);
    if (!fullPath.startsWith(resolvedWorkspace + path.sep) && fullPath !== resolvedWorkspace) {
      throw new Error('Path traversal detected: path must be within workspace');
    }
    return fullPath;
  }

  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    try {
      // Security: Validate path to prevent traversal
      const fullPath = this.validatePathWithinWorkspace(filePath);
      await fs.mkdir(path.dirname(fullPath), { recursive: true });
      await fs.writeFile(fullPath, content, 'utf-8');
      return { success: true, output: `File written: ${filePath}` };
    } catch (err: any) {
      if (err.message.includes('Path traversal')) {
        return { success: false, error: err.message, blocked: true };
      }
      return { success: false, error: `Failed to write file: ${err.message}` };
    }
  }

  async readFile(filePath: string): Promise<ToolResult> {
    try {
      // Security: Validate path to prevent traversal
      const fullPath = this.validatePathWithinWorkspace(filePath);
      const content = await fs.readFile(fullPath, 'utf-8');
      return { success: true, content, output: content };
    } catch (err: any) {
      if (err.message.includes('Path traversal')) {
        return { success: false, error: err.message, blocked: true };
      }
      return { success: false, error: `Failed to read file: ${err.message}` };
    }
  }

  async listDirectory(dirPath: string): Promise<ToolResult> {
    try {
      // Security: Validate path to prevent traversal
      const fullPath = this.validatePathWithinWorkspace(dirPath || '.');
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      const listing = entries.map((e) => {
        const suffix = e.isDirectory() ? '/' : '';
        return `${e.name}${suffix}`;
      });
      return { success: true, output: listing.join('\n') };
    } catch (err: any) {
      if (err.message.includes('Path traversal')) {
        return { success: false, error: err.message, blocked: true };
      }
      return { success: false, error: `Failed to list directory: ${err.message}` };
    }
  }

  async createCheckpoint(name?: string): Promise<CheckpointInfo> {
    const checkpointId = `cp-${Date.now()}-${randomUUID().slice(0, 6)}`;
    const cpDir = path.join(this.checkpointDir, checkpointId);
    await fs.mkdir(cpDir, { recursive: true });

    // Copy workspace files (excluding .opencode directory)
    await this.copyDir(this.workspaceDir, cpDir, ['.opencode']);
    log.info('Checkpoint created', { checkpointId, name });

    return {
      id: checkpointId,
      name: name || checkpointId,
      createdAt: new Date().toISOString(),
    };
  }

  async restoreCheckpoint(checkpointId: string): Promise<void> {
    const cpDir = path.join(this.checkpointDir, checkpointId);
    try {
      await fs.access(cpDir);
    } catch {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    // Clear workspace (except .opencode) and restore
    const entries = await fs.readdir(this.workspaceDir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name === '.opencode') continue;
      await fs.rm(path.join(this.workspaceDir, entry.name), { recursive: true, force: true });
    }
    await this.copyDir(cpDir, this.workspaceDir, []);
    log.info('Checkpoint restored', { checkpointId });
  }

  async listCheckpoints(): Promise<CheckpointInfo[]> {
    try {
      await fs.access(this.checkpointDir);
      const entries = await fs.readdir(this.checkpointDir, { withFileTypes: true });
      const checkpoints: CheckpointInfo[] = [];
      for (const entry of entries) {
        if (!entry.isDirectory()) continue;
        const stat = await fs.stat(path.join(this.checkpointDir, entry.name));
        checkpoints.push({
          id: entry.name,
          name: entry.name,
          createdAt: stat.birthtime.toISOString(),
        });
      }
      return checkpoints.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    } catch {
      return [];
    }
  }

  private async copyDir(src: string, dest: string, exclude: string[]): Promise<void> {
    const entries = await fs.readdir(src, { withFileTypes: true });
    for (const entry of entries) {
      if (exclude.includes(entry.name)) continue;
      const srcPath = path.join(src, entry.name);
      const destPath = path.join(dest, entry.name);
      if (entry.isDirectory()) {
        await fs.mkdir(destPath, { recursive: true });
        await this.copyDir(srcPath, destPath, []);
      } else {
        await fs.copyFile(srcPath, destPath);
      }
    }
  }
}
