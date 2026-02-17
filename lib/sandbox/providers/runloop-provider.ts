import type { ToolResult, PreviewInfo } from "../types";
import type {
  SandboxProvider,
  SandboxHandle,
  SandboxCreateConfig,
} from "./sandbox-provider";
import * as path from "node:path";

const WORKSPACE_DIR = "/home/user/workspace";
const MAX_COMMAND_TIMEOUT = 120;

export class RunloopProvider implements SandboxProvider {
  readonly name = "runloop";
  private client: any;

  constructor() {
    const { RunloopSDK } = require("@runloop/api-client");
    const apiKey = process.env.RUNLOOP_API_KEY;
    if (!apiKey) {
      throw new Error("RUNLOOP_API_KEY environment variable is required");
    }
    this.client = new RunloopSDK({
      apiKey,
    });
  }

  async createSandbox(config: SandboxCreateConfig): Promise<SandboxHandle> {
    const devbox = await this.client.devbox.create({
      blueprint: "standard",
    });

    const handle = new RunloopSandboxHandle(devbox, this.client);
    await handle.executeCommand(`mkdir -p ${WORKSPACE_DIR}`);
    return handle;
  }

  async getSandbox(sandboxId: string): Promise<SandboxHandle> {
    const devbox = await this.client.devbox.get(sandboxId);
    return new RunloopSandboxHandle(devbox, this.client);
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    const devbox = await this.client.devbox.get(sandboxId);
    await devbox.shutdown();
  }
}

class RunloopSandboxHandle implements SandboxHandle {
  readonly id: string;
  readonly workspaceDir = '/home/user/workspace';
  private devbox: any;
  private client: any;

  constructor(devbox: any, client: any) {
    this.devbox = devbox;
    this.id = devbox.id;
    this.client = client;
  }

  /**
   * Sanitize command to prevent shell injection
   */
  private sanitizeCommand(command: string): string {
    // Reject commands with shell metacharacters
    const dangerousChars = /[;&|`$(){}[\]<>!#~\\]/;
    if (dangerousChars.test(command)) {
      throw new Error("Command contains disallowed characters for security");
    }
    if (/[\n\r\0]/.test(command)) {
      throw new Error("Command contains invalid control characters");
    }
    return command;
  }

  /**
   * Resolve and validate path to prevent path traversal attacks
   */
  private resolvePath(filePath: string): string {
    // Normalize path separators
    const normalized = filePath.replace(/\\/g, "/");

    // Reject path traversal attempts
    if (normalized.includes("..") || normalized.includes("\0")) {
      throw new Error(`Invalid file path: ${filePath}`);
    }

    // Reject absolute paths that aren't already in workspace
    if (filePath.startsWith("/")) {
      // Ensure it's within workspace
      const resolved = path.resolve(normalized);
      if (!resolved.startsWith(WORKSPACE_DIR)) {
        throw new Error(`Path traversal detected: ${filePath}`);
      }
      return resolved;
    }

    // For relative paths, resolve within workspace
    const resolved = path.resolve(WORKSPACE_DIR, normalized);

    // Double-check the resolved path is within workspace
    if (!resolved.startsWith(WORKSPACE_DIR)) {
      throw new Error(`Path traversal detected: ${filePath}`);
    }

    return resolved;
  }

  async executeCommand(
    command: string,
    cwd?: string,
    timeout?: number
  ): Promise<ToolResult> {
    // Sanitize command to prevent injection
    const safeCommand = this.sanitizeCommand(command);

    // Sanitize cwd to prevent injection
    if (cwd) {
      if (
        /[;&|`$(){}[\]<>!#~\\]/.test(cwd) ||
        cwd.includes("..") ||
        /[\n\r\0]/.test(cwd)
      ) {
        throw new Error(`Invalid working directory: ${cwd}`);
      }
    }

    // Use resolved safe path instead of shell string interpolation
    const safeCwd = cwd ? this.resolvePath(cwd) : WORKSPACE_DIR;

    // Apply timeout - use provided timeout or default to MAX_COMMAND_TIMEOUT
    const effectiveTimeout = timeout ?? MAX_COMMAND_TIMEOUT;

    // Shell-quote safeCwd to handle spaces and special characters
    const escapedCwd = safeCwd.replace(/'/g, "'\\''");

    // Execute with explicit cwd using sanitized values
    const fullCommand = `cd '${escapedCwd}' && ${safeCommand}`;

    const result = await this.devbox.cmd.exec({
      command: fullCommand,
      shell: "/bin/bash",
      timeout: effectiveTimeout * 1000, // Convert to milliseconds
    });

    const stdout = await result.stdout();
    const stderr = await result.stderr();

    return {
      success: result.exit_code === 0,
      output: stdout + (stderr ? `\n${stderr}` : ""),
      exitCode: result.exit_code,
    };
  }

  async writeFile(filePath: string, content: string): Promise<ToolResult> {
    const resolved = this.resolvePath(filePath);
    const dir = path.dirname(resolved);

    // Shell-quote paths for safety (handle spaces and special characters)
    const escapedDir = dir.replace(/'/g, "'\\''");
    const escapedPath = resolved.replace(/'/g, "'\\''");
    
    // Create directory - bypass sanitizeCommand since we control the paths
    const mkdirCmd = `mkdir -p '${escapedDir}'`;
    const mkdirResult = await this.devbox.cmd.exec({ command: mkdirCmd, shell: "/bin/bash" });
    const mkdirStderr = await mkdirResult.stderr();
    if (mkdirResult.exit_code !== 0) {
      return { success: false, output: mkdirStderr || 'Failed to create directory', exitCode: mkdirResult.exit_code };
    }

    // Write file content - bypass sanitizeCommand since we control the paths
    const escaped = content.replace(/'/g, "'\\''");
    const writeCmd = `printf '%s' '${escaped}' > '${escapedPath}'`;
    const writeResult = await this.devbox.cmd.exec({ command: writeCmd, shell: "/bin/bash" });
    const writeStderr = await writeResult.stderr();
    return { 
      success: writeResult.exit_code === 0, 
      output: writeResult.exit_code === 0 ? `File written: ${resolved}` : writeStderr,
      exitCode: writeResult.exit_code 
    };
  }

  async readFile(filePath: string): Promise<ToolResult> {
    const resolved = this.resolvePath(filePath);
    const escapedPath = resolved.replace(/'/g, "'\\''");
    const result = await this.devbox.cmd.exec({ 
      command: `cat '${escapedPath}'`, 
      shell: "/bin/bash" 
    });
    const stdout = await result.stdout();
    const stderr = await result.stderr();
    return {
      success: result.exit_code === 0,
      output: stdout + (stderr ? `\n${stderr}` : ''),
      exitCode: result.exit_code,
    };
  }

  async listDirectory(dirPath: string): Promise<ToolResult> {
    const resolved = this.resolvePath(dirPath);
    const escapedPath = resolved.replace(/'/g, "'\\''");
    const result = await this.devbox.cmd.exec({ 
      command: `ls -la '${escapedPath}'`, 
      shell: "/bin/bash" 
    });
    const stdout = await result.stdout();
    const stderr = await result.stderr();
    return {
      success: result.exit_code === 0,
      output: stdout + (stderr ? `\n${stderr}` : ''),
      exitCode: result.exit_code,
    };
  }
}
