/**
 * Oracle VM Sandbox Provider
 * 
 * Connects to Oracle Cloud Infrastructure (OCI) VM instances via SSH
 * for sandboxed code execution.
 * 
 * Features:
 * - Automatic SSH connection management
 * - Session isolation per user
 * - Command execution with timeout
 * - File upload/download via SFTP
 * - Resource monitoring
 * 
 * Configuration:
 * - ORACLE_VM_HOST: VM hostname or IP (required)
 * - ORACLE_VM_USER: SSH username (default: 'opc')
 * - ORACLE_VM_KEY_PATH: Path to SSH private key (required)
 * - ORACLE_VM_WORKSPACE: Working directory on VM (default: '/home/opc/workspace')
 */

import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { mkdir, writeFile, readFile, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import type { ToolResult, PreviewInfo } from '../types';
import type {
  SandboxProvider,
  SandboxHandle,
  SandboxCreateConfig,
  PtyHandle,
  PtyOptions,
  PtyConnectOptions,
} from './sandbox-provider';

const DEFAULT_WORKSPACE = '/home/opc/workspace';
const DEFAULT_USER = 'opc';
const CONNECTION_TIMEOUT = 10000;
const COMMAND_TIMEOUT = 120000; // 2 minutes

export interface OracleVMConfig {
  host: string;
  port: number;
  username: string;
  privateKeyPath?: string;
  privateKey?: string;
  workspace: string;
  connectTimeout: number;
  commandTimeout: number;
}

export class OracleVMSandboxHandle implements SandboxHandle {
  readonly provider = 'oracle-vm';
  readonly id: string;
  readonly sandboxId: string;
  readonly language: string;
  readonly createdAt: number;
  readonly workspace: string;
  readonly workspaceDir: string;

  private config: OracleVMConfig;
  private sshConnection: any = null;
  private lastUsed: number;
  private activeCommands = new Map<string, any>();

  constructor(
    sandboxId: string,
    language: string,
    config: OracleVMConfig
  ) {
    this.sandboxId = sandboxId;
    this.id = sandboxId;
    this.language = language;
    this.createdAt = Date.now();
    this.lastUsed = Date.now();
    this.config = config;
    this.workspace = config.workspace;
    this.workspaceDir = config.workspace;
  }

  async writeFile(path: string, content: string): Promise<ToolResult> {
    try {
      // Validate path is within workspace
      if (!this.isPathInWorkspace(path)) {
        return { success: false, error: 'Path outside workspace directory' };
      }
      await this.uploadFile(path, content);
      return { success: true, output: `File written: ${path}` };
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to write file' };
    }
  }

  async readFile(path: string): Promise<ToolResult> {
    try {
      // Validate path is within workspace
      if (!this.isPathInWorkspace(path)) {
        return { success: false, error: 'Path outside workspace directory' };
      }
      const content = await this.downloadFile(path);
      return { success: true, output: content };
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to read file' };
    }
  }

  async listDirectory(path: string): Promise<ToolResult> {
    try {
      const safePath = path.replace(/'/g, `'\\''`);
      const result = await this.executeCommand(`ls -la -- '${safePath}'`);
      if (result.success && result.output) {
        return { success: true, output: result.output };
      }
      return { success: false, error: 'Failed to list directory' };
    } catch (error: any) {
      return { success: false, error: error.message || 'Failed to list directory' };
    }
  }

  private isPathInWorkspace(path: string): boolean {
    const normalizedPath = path.replace(/\\/g, '/');
    const normalizedWorkspace = this.workspaceDir.replace(/\\/g, '/');
    return normalizedPath.startsWith(normalizedWorkspace);
  }

  async destroySandbox(): Promise<void> {
    if (this.sshConnection) {
      this.sshConnection.end();
      this.sshConnection = null;
    }
  }

  /**
   * Get or create SSH connection
   */
  private async getConnection(): Promise<any> {
    if (this.sshConnection) {
      return this.sshConnection;
    }

    const { Client } = await import('ssh2');
    
    return new Promise((resolve, reject) => {
      const client = new Client();
      
      const connectionConfig: any = {
        host: this.config.host,
        port: this.config.port,
        username: this.config.username,
        readyTimeout: this.config.connectTimeout,
        keepaliveInterval: 10000,
        keepaliveCountMax: 3,
      };

      // Use private key if provided
      if (this.config.privateKey) {
        connectionConfig.privateKey = this.config.privateKey;
      } else if (this.config.privateKeyPath) {
        connectionConfig.privateKey = require('fs').readFileSync(this.config.privateKeyPath);
      }

      client.on('ready', () => {
        this.sshConnection = client;
        console.log(`[OracleVM] SSH connection established to ${this.config.host}`);
        resolve(client);
      });

      client.on('error', (err: any) => {
        console.error(`[OracleVM] SSH connection error: ${err.message}`);
        this.sshConnection = null;
        reject(err);
      });

      client.on('close', () => {
        console.log(`[OracleVM] SSH connection closed`);
        this.sshConnection = null;
      });

      client.connect(connectionConfig);
      
      // Timeout handling
      setTimeout(() => {
        if (!this.sshConnection) {
          client.end();
          reject(new Error('SSH connection timeout'));
        }
      }, this.config.connectTimeout);
    });
  }

  /**
   * Execute command via SSH
   * SECURITY: Validates cwd to prevent command injection
   */
  async executeCommand(command: string, cwd?: string, timeout?: number): Promise<ToolResult> {
    const startTime = Date.now();
    this.lastUsed = Date.now();

    try {
      const conn = await this.getConnection();

      return new Promise((resolve, reject) => {
        const timeoutMs = timeout || this.config.commandTimeout;
        
        // SECURITY: Validate and sanitize working directory
        // Reject paths with shell metacharacters or traversal patterns
        const workingDir = cwd || this.workspace;
        if (!this.isValidPath(workingDir)) {
          resolve({
            success: false,
            output: 'Invalid working directory: contains unsafe characters',
            exitCode: 1,
            executionTime: Date.now() - startTime,
          });
          return;
        }

        // SECURITY: Use single quotes and escape any single quotes in the path
        // This prevents shell injection via the cwd
        const escapedCwd = workingDir.replace(/'/g, "'\\''");
        const escapedCommand = command.replace(/'/g, "'\\''");
        
        // Build command with working directory using single quotes
        const fullCommand = `cd '${escapedCwd}' && ${escapedCommand}`;

        conn.exec(fullCommand, (err: any, stream: any) => {
          if (err) {
            reject(err);
            return;
          }

          let stdout = '';
          let stderr = '';
          let exitCode: number | null = null;

          stream.on('close', (code: number) => {
            exitCode = code;
            const duration = Date.now() - startTime;

            resolve({
              success: code === 0,
              output: stdout || stderr,
              exitCode: code,
              executionTime: duration,
            });
          });

          stream.on('data', (data: Buffer) => {
            stdout += data.toString();
          });

          stream.stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
          });

          stream.on('error', (err: any) => {
            reject(err);
          });

          // Timeout handling
          setTimeout(() => {
            stream.kill('SIGKILL');
            reject(new Error(`Command timeout after ${timeoutMs}ms`));
          }, timeoutMs);
        });
      });
    } catch (error: any) {
      return {
        success: false,
        output: error.message || 'SSH execution failed',
        exitCode: -1,
        executionTime: Date.now() - startTime,
      };
    }
  }

  /**
   * Validate path to prevent command injection
   * SECURITY: Rejects paths with shell metacharacters
   */
  private isValidPath(path: string): boolean {
    // Reject paths containing shell metacharacters
    const dangerousChars = /[$`;|&<>(){}!\\]/;
    if (dangerousChars.test(path)) {
      return false;
    }
    
    // Path should be reasonably sized
    if (path.length > 1024) {
      return false;
    }
    
    return true;
  }

  /**
   * Upload file via SFTP
   */
  async uploadFile(remotePath: string, content: string): Promise<void> {
    try {
      const conn = await this.getConnection();
      
      return new Promise((resolve, reject) => {
        conn.sftp((err: any, sftp: any) => {
          if (err) {
            reject(err);
            return;
          }

          // Ensure directory exists
          const dir = dirname(remotePath);
          sftp.mkdir(dir, { recursive: true }, () => {
            // Write file
            sftp.writeFile(remotePath, content, (writeErr: any) => {
              if (writeErr) {
                reject(writeErr);
              } else {
                resolve();
              }
            });
          });
        });
      });
    } catch (error: any) {
      console.error(`[OracleVM] Upload failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Download file via SFTP
   */
  async downloadFile(remotePath: string): Promise<string> {
    try {
      const conn = await this.getConnection();
      
      return new Promise((resolve, reject) => {
        conn.sftp((err: any, sftp: any) => {
          if (err) {
            reject(err);
            return;
          }

          sftp.readFile(remotePath, 'utf8', (readErr: any, data: string) => {
            if (readErr) {
              reject(readErr);
            } else {
              resolve(data);
            }
          });
        });
      });
    } catch (error: any) {
      console.error(`[OracleVM] Download failed: ${error.message}`);
      throw error;
    }
  }

  /**
   * Start interactive PTY session
   */
  async startPty(options?: PtyOptions): Promise<PtyHandle> {
    const conn = await this.getConnection();
    
    return new Promise((resolve, reject) => {
      conn.shell((err: any, stream: any) => {
        if (err) {
          reject(err);
          return;
        }

        const ptyHandle: PtyHandle = {
          sessionId: `oracle-vm-${this.sandboxId}-${Date.now()}`,
          write: (data: string) => {
            stream.write(data);
          },
          resize: async (cols: number, rows: number) => {
            (stream as any).setWindow(rows, cols);
          },
          onOutput: (callback: (data: string) => void) => {
            stream.on('data', (data: Buffer) => {
              callback(data.toString());
            });
          },
          destroy: () => {
            stream.end();
          },
        } as any;

        resolve(ptyHandle);
      });
    });
  }

  /**
   * Get resource usage
   */
  async getResourceUsage(): Promise<{
    cpu: number;
    memory: number;
    disk: number;
  }> {
    try {
      const result = await this.executeCommand(
        'echo "CPU:$(top -bn1 | grep "Cpu(s)" | awk \'{print $2}\') MEM:$(free -m | awk \'/^Mem:/ {print $3}\') DISK:$(df -h / | awk \'NR==2 {print $5}\')" | tr -d "%"'
      );
      
      const output = result.output || '';
      const cpuMatch = output.match(/CPU:([0-9.]+)/);
      const memMatch = output.match(/MEM:([0-9]+)/);
      const diskMatch = output.match(/DISK:([0-9]+)/);

      return {
        cpu: cpuMatch ? parseFloat(cpuMatch[1]) : 0,
        memory: memMatch ? parseInt(memMatch[1]) : 0,
        disk: diskMatch ? parseInt(diskMatch[1]) : 0,
      };
    } catch {
      return { cpu: 0, memory: 0, disk: 0 };
    }
  }

  /**
   * Close connection
   */
  async close(): Promise<void> {
    if (this.sshConnection) {
      this.sshConnection.end();
      this.sshConnection = null;
      console.log(`[OracleVM] Connection closed for sandbox ${this.sandboxId}`);
    }
  }
}

export class OracleVMProvider implements SandboxProvider {
  readonly name = 'oracle-vm';
  private config: OracleVMConfig;
  private sandboxes = new Map<string, OracleVMSandboxHandle>();

  constructor() {
    const host = process.env.ORACLE_VM_HOST || '';
    const port = parseInt(process.env.ORACLE_VM_PORT || '22');
    const username = process.env.ORACLE_VM_USER || DEFAULT_USER;
    const privateKeyPath = process.env.ORACLE_VM_KEY_PATH || '';
    const workspace = process.env.ORACLE_VM_WORKSPACE || DEFAULT_WORKSPACE;

    if (!host) {
      throw new Error(
        'Oracle VM provider requires ORACLE_VM_HOST environment variable'
      );
    }

    this.config = {
      host,
      port,
      username,
      privateKeyPath: privateKeyPath || undefined,
      privateKey: process.env.ORACLE_VM_PRIVATE_KEY,
      workspace,
      connectTimeout: CONNECTION_TIMEOUT,
      commandTimeout: COMMAND_TIMEOUT,
    };

    console.log(
      `[OracleVM] Initialized - Host: ${host}, User: ${username}, Workspace: ${workspace}`
    );
  }

  /**
   * Health check - test SSH connectivity
   */
  async healthCheck(): Promise<{ healthy: boolean; latency?: number; details?: any }> {
    const startTime = Date.now();
    
    try {
      // Create temporary handle to test connection
      const testHandle = new OracleVMSandboxHandle(
        'health-check',
        'bash',
        this.config
      );
      
      await testHandle.executeCommand('echo "health check"');
      await testHandle.close();
      
      const latency = Date.now() - startTime;
      return { healthy: true, latency };
    } catch (error: any) {
      const latency = Date.now() - startTime;
      console.error('[OracleVM] Health check failed:', error.message);
      return { 
        healthy: false, 
        latency, 
        details: { error: error.message } 
      };
    }
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    const handle = this.sandboxes.get(sandboxId);
    if (handle) {
      await handle.destroySandbox();
      this.sandboxes.delete(sandboxId);
    }
  }

  /**
   * Create sandbox handle (SSH session)
   */
  async createSandbox(config: SandboxCreateConfig): Promise<SandboxHandle> {
    const sandboxId = `oracle-vm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    
    console.log(
      `[OracleVM] Creating sandbox - ID: ${sandboxId}, Language: ${config.language || 'default'}`
    );

    const handle = new OracleVMSandboxHandle(
      sandboxId,
      config.language || 'typescript',
      this.config
    );

    // Initialize workspace
    try {
      await handle.executeCommand(`mkdir -p "${this.config.workspace}"`);
    } catch (error: any) {
      console.warn(`[OracleVM] Failed to initialize workspace: ${error.message}`);
    }

    this.sandboxes.set(sandboxId, handle);
    return handle;
  }

  /**
   * Get existing sandbox by ID
   */
  async getSandbox(sandboxId: string): Promise<SandboxHandle | undefined> {
    return this.sandboxes.get(sandboxId);
  }

  /**
   * Close and remove sandbox
   */
  async closeSandbox(sandboxId: string): Promise<void> {
    const handle = this.sandboxes.get(sandboxId);
    if (handle) {
      await handle.close();
      this.sandboxes.delete(sandboxId);
      console.log(`[OracleVM] Closed sandbox ${sandboxId}`);
    }
  }

  /**
   * Cleanup all sandboxes
   */
  async cleanup(): Promise<void> {
    const closePromises = Array.from(this.sandboxes.values()).map(handle =>
      handle.close().catch(err => console.error('[OracleVM] Cleanup error:', err))
    );
    
    await Promise.all(closePromises);
    this.sandboxes.clear();
    console.log('[OracleVM] All sandboxes cleaned up');
  }
}
