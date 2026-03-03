/**
 * Sandbox Manager
 * Manages sandbox lifecycle, execution, and filesystem operations
 * Migrated from ephemeral/sandbox_api.py and container_fallback.py
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { createWriteStream, mkdirSync, existsSync, readdirSync, statSync } from 'fs';
import { join, resolve } from 'path';
import { pipeline } from 'stream/promises';
import { createReadStream } from 'fs';
import * as zlib from 'zlib';
import { createWriteStream as createTarWriteStream } from 'tar-stream';
import { createReadStream as createTarReadStream } from 'tar-stream';

export interface SandboxConfig {
  sandboxId?: string;
  image?: string;
  workspaceDir?: string;
}

export interface Sandbox {
  sandboxId: string;
  workspace: string;
  status: 'creating' | 'running' | 'stopped' | 'error';
  createdAt: Date;
  lastActive: Date;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
  command: string;
  duration: number;
}

export interface FileEntry {
  name: string;
  type: 'file' | 'directory';
  size?: number;
  modifiedAt?: Date;
}

export class SandboxManager extends EventEmitter {
  private sandboxes: Map<string, Sandbox> = new Map();
  private baseWorkspaceDir: string;
  private baseSnapshotDir: string;
  private runningProcesses: Map<string, ChildProcess> = new Map();

  constructor(baseWorkspaceDir: string = '/tmp/workspaces', baseSnapshotDir: string = '/tmp/snapshots') {
    super();
    this.baseWorkspaceDir = baseWorkspaceDir;
    this.baseSnapshotDir = baseSnapshotDir;
    
    // Ensure base directories exist
    if (!existsSync(baseWorkspaceDir)) {
      mkdirSync(baseWorkspaceDir, { recursive: true });
    }
    if (!existsSync(baseSnapshotDir)) {
      mkdirSync(baseSnapshotDir, { recursive: true });
    }
  }

  async createSandbox(config?: SandboxConfig): Promise<Sandbox> {
    const sandboxId = config?.sandboxId || `sandbox_${Date.now()}_${Math.random().toString(36).substring(7)}`;
    const workspace = join(this.baseWorkspaceDir, sandboxId);
    
    // Create workspace directory structure
    if (!existsSync(workspace)) {
      mkdirSync(workspace, { recursive: true });
      mkdirSync(join(workspace, 'code'), { recursive: true });
      mkdirSync(join(workspace, '.config'), { recursive: true });
      mkdirSync(join(workspace, '.cache'), { recursive: true });
    }

    const sandbox: Sandbox = {
      sandboxId,
      workspace,
      status: 'running',
      createdAt: new Date(),
      lastActive: new Date(),
    };

    this.sandboxes.set(sandboxId, sandbox);
    this.emit('created', sandbox);
    
    return sandbox;
  }

  async getSandbox(sandboxId: string): Promise<Sandbox> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      throw new Error(`Sandbox not found: ${sandboxId}`);
    }
    sandbox.lastActive = new Date();
    return sandbox;
  }

  async execCommand(sandboxId: string, command: string, args?: string[], timeout?: number): Promise<ExecResult> {
    const sandbox = await this.getSandbox(sandboxId);
    
    const startTime = Date.now();
    const child = spawn(command, args || [], {
      cwd: sandbox.workspace,
      timeout: timeout || 30000,
      shell: true,
    });

    this.runningProcesses.set(sandboxId, child);

    let stdout = '';
    let stderr = '';

    child.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    child.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    return new Promise((resolve, reject) => {
      child.on('close', (exitCode) => {
        this.runningProcesses.delete(sandboxId);
        const duration = Date.now() - startTime;
        const result: ExecResult = {
          stdout,
          stderr,
          exitCode,
          command,
          duration,
        };
        this.emit('executed', { sandboxId, result });
        resolve(result);
      });

      child.on('error', (error) => {
        this.runningProcesses.delete(sandboxId);
        reject(error);
      });

      child.on('timeout', () => {
        child.kill('SIGTERM');
        this.runningProcesses.delete(sandboxId);
        reject(new Error(`Command timed out after ${timeout}ms`));
      });
    });
  }

  async writeFile(sandboxId: string, path: string, data: string): Promise<void> {
    const sandbox = await this.getSandbox(sandboxId);
    const fullPath = join(sandbox.workspace, path);
    
    // Ensure parent directory exists
    const parentDir = join(fullPath, '..');
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }

    await this.writeToFile(fullPath, data);
    this.emit('file_written', { sandboxId, path });
  }

  private async writeToFile(path: string, data: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const stream = createWriteStream(path);
      stream.on('finish', resolve);
      stream.on('error', reject);
      stream.write(data);
      stream.end();
    });
  }

  async listFiles(sandboxId: string, path: string = ''): Promise<FileEntry[]> {
    const sandbox = await this.getSandbox(sandboxId);
    const fullPath = join(sandbox.workspace, path);
    
    if (!existsSync(fullPath)) {
      throw new Error(`Path not found: ${path}`);
    }

    const entries = readdirSync(fullPath, { withFileTypes: true });
    return entries.map(entry => {
      const stat = statSync(join(fullPath, entry.name));
      return {
        name: entry.name,
        type: entry.isDirectory() ? 'directory' : 'file',
        size: stat.size,
        modifiedAt: stat.mtime,
      };
    });
  }

  async readFile(sandboxId: string, path: string): Promise<string> {
    const sandbox = await this.getSandbox(sandboxId);
    const fullPath = join(sandbox.workspace, path);
    
    return new Promise((resolve, reject) => {
      createReadStream(fullPath, 'utf8').on('data', resolve).on('error', reject);
    });
  }

  async createSnapshot(sandboxId: string, snapshotId: string): Promise<string> {
    const sandbox = await this.getSandbox(sandboxId);
    const snapshotPath = join(this.baseSnapshotDir, sandboxId, `${snapshotId}.tar.zst`);
    
    // Ensure snapshot directory exists
    const snapshotDir = join(this.baseSnapshotDir, sandboxId);
    if (!existsSync(snapshotDir)) {
      mkdirSync(snapshotDir, { recursive: true });
    }

    // Create tar.zst snapshot
    await this.createTarSnapshot(sandbox.workspace, snapshotPath);
    
    this.emit('snapshot_created', { sandboxId, snapshotId, path: snapshotPath });
    return snapshotPath;
  }

  private async createTarSnapshot(sourceDir: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const pack = createTarWriteStream();
      const gzip = zlib.createGzip();
      const output = createWriteStream(outputPath);

      pipeline(pack, gzip, output)
        .then(resolve)
        .catch(reject);

      // Add files to tar
      this.addDirToTar(pack, sourceDir, sourceDir);
      pack.end();
    });
  }

  private addDirToTar(pack: any, dir: string, baseDir: string): void {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = fullPath.replace(baseDir, '');
      
      if (entry.isDirectory()) {
        this.addDirToTar(pack, fullPath, baseDir);
      } else {
        pack.entry({ name: relativePath }, createReadStream(fullPath));
      }
    }
  }

  async restoreSnapshot(sandboxId: string, snapshotId: string): Promise<void> {
    const sandbox = await this.getSandbox(sandboxId);
    const snapshotPath = join(this.baseSnapshotDir, sandboxId, `${snapshotId}.tar.zst`);
    
    if (!existsSync(snapshotPath)) {
      throw new Error(`Snapshot not found: ${snapshotId}`);
    }

    // Clear workspace
    await this.clearDirectory(sandbox.workspace);
    
    // Extract snapshot
    await this.extractTarSnapshot(snapshotPath, sandbox.workspace);
    
    this.emit('snapshot_restored', { sandboxId, snapshotId });
  }

  private async extractTarSnapshot(inputPath: string, extractDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const gunzip = zlib.createGunzip();
      const input = createReadStream(inputPath);
      const extract = createTarReadStream();

      extract.on('entry', (header: any, stream: any, next: any) => {
        const fullPath = join(extractDir, header.name);
        
        if (header.type === 'directory') {
          mkdirSync(fullPath, { recursive: true });
          next();
        } else {
          mkdirSync(join(fullPath, '..'), { recursive: true });
          stream.pipe(createWriteStream(fullPath)).on('finish', next);
        }
      });

      pipeline(input, gunzip, extract)
        .then(resolve)
        .catch(reject);
    });
  }

  private async clearDirectory(dir: string): Promise<void> {
    const entries = readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) {
        await this.clearDirectory(fullPath);
      } else {
        // Would use fs.promises.rm in production
      }
    }
  }

  async deleteSandbox(sandboxId: string): Promise<void> {
    const sandbox = this.sandboxes.get(sandboxId);
    if (!sandbox) {
      throw new Error(`Sandbox not found: ${sandboxId}`);
    }

    // Kill any running processes
    const process = this.runningProcesses.get(sandboxId);
    if (process) {
      process.kill('SIGTERM');
      this.runningProcesses.delete(sandboxId);
    }

    this.sandboxes.delete(sandboxId);
    this.emit('deleted', sandboxId);
  }

  async listSandboxes(): Promise<Sandbox[]> {
    return Array.from(this.sandboxes.values());
  }

  async shutdown(): Promise<void> {
    // Kill all running processes
    for (const [sandboxId, process] of this.runningProcesses.entries()) {
      process.kill('SIGTERM');
    }
    this.runningProcesses.clear();
    this.sandboxes.clear();
    this.emit('shutdown');
  }
}

// Singleton instance
export const sandboxManager = new SandboxManager();
