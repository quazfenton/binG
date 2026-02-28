import type { ToolResult, PreviewInfo } from "../types";
import type {
  SandboxProvider,
  SandboxHandle,
  SandboxCreateConfig,
} from "./sandbox-provider";
import * as path from "node:path";
import { SandboxSecurityManager } from "../security-manager";

const WORKSPACE_DIR = "/home/user/workspace";
const MAX_COMMAND_TIMEOUT = 120;

export class RunloopProvider implements SandboxProvider {
  readonly name = "runloop";
  private client: any;

  constructor() {
    const { RunloopSDK } = require("@runloop/api-client");
    const apiKey = process.env.RUNLOOP_API_KEY;
    if (!apiKey) {
      console.warn("[RunloopProvider] RUNLOOP_API_KEY not set.");
    }
    this.client = apiKey ? new RunloopSDK({ apiKey }) : null;
  }

  async createSandbox(config: SandboxCreateConfig): Promise<SandboxHandle> {
    if (!this.client) throw new Error("Runloop API key not configured");
    const devbox = await this.client.devbox.create({
      blueprint: "standard",
    });

    const handle = new RunloopSandboxHandle(devbox, this.client);
    await handle.executeCommand(`mkdir -p ${WORKSPACE_DIR}`);
    return handle;
  }

  async getSandbox(sandboxId: string): Promise<SandboxHandle> {
    if (!this.client) throw new Error("Runloop API key not configured");
    const devbox = await this.client.devbox.get(sandboxId);
    return new RunloopSandboxHandle(devbox, this.client);
  }

  async destroySandbox(sandboxId: string): Promise<void> {
    if (!this.client) return;
    const devbox = await this.client.devbox.get(sandboxId);
    await devbox.shutdown();
  }
}

class RunloopSandboxHandle implements SandboxHandle {
  readonly id: string;
  readonly workspaceDir = WORKSPACE_DIR;
  private devbox: any;
  private client: any;
  private portCache = new Map<number, PreviewInfo>();

  constructor(devbox: any, client: any) {
    this.devbox = devbox;
    this.id = devbox.id;
    this.client = client;
  }

  async executeCommand(command: string, cwd?: string, timeout?: number): Promise<ToolResult> {
    const sanitized = SandboxSecurityManager.sanitizeCommand(command);
    const safeCwd = cwd ? SandboxSecurityManager.resolvePath(this.workspaceDir, cwd) : this.workspaceDir;
    const effectiveTimeout = timeout ?? MAX_COMMAND_TIMEOUT;

    const result = await this.devbox.cmd.exec({
      command: `cd '${safeCwd.replace(/'/g, "'\\''")}' && ${sanitized}`,
      shell: "/bin/bash",
      timeout: effectiveTimeout * 1000,
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
    const resolved = SandboxSecurityManager.resolvePath(this.workspaceDir, filePath);
    const dir = path.dirname(resolved);

    await this.devbox.cmd.exec({ command: `mkdir -p '${dir.replace(/'/g, "'\\''")}'`, shell: "/bin/bash" });

    const escapedContent = content.replace(/'/g, "'\\''");
    const result = await this.devbox.cmd.exec({
      command: `printf '%s' '${escapedContent}' > '${resolved.replace(/'/g, "'\\''")}'`,
      shell: "/bin/bash",
    });

    return {
      success: result.exit_code === 0,
      output: result.exit_code === 0 ? `File written: ${resolved}` : await result.stderr(),
      exitCode: result.exit_code,
    };
  }

  async readFile(filePath: string): Promise<ToolResult> {
    const resolved = SandboxSecurityManager.resolvePath(this.workspaceDir, filePath);
    const result = await this.devbox.cmd.exec({
      command: `cat '${resolved.replace(/'/g, "'\\''")}'`,
      shell: "/bin/bash",
    });
    return {
      success: result.exit_code === 0,
      output: await result.stdout() + (await result.stderr()),
      exitCode: result.exit_code,
    };
  }

  async listDirectory(dirPath: string): Promise<ToolResult> {
    const resolved = SandboxSecurityManager.resolvePath(this.workspaceDir, dirPath);
    const result = await this.devbox.cmd.exec({
      command: `ls -la '${resolved.replace(/'/g, "'\\''")}'`,
      shell: "/bin/bash",
    });
    return {
      success: result.exit_code === 0,
      output: await result.stdout() + (await result.stderr()),
      exitCode: result.exit_code,
    };
  }

  async getPreviewLink(port: number): Promise<PreviewInfo> {
    const cached = this.portCache.get(port);
    if (cached) return cached;
    try {
      const portInfo = await this.devbox.ports.get(port);
      const preview = { port, url: portInfo.url || `https://${this.id}-${port}.runloop.dev`, token: portInfo.token };
      this.portCache.set(port, preview);
      return preview;
    } catch {
      return { port, url: `https://${this.id}-${port}.runloop.dev` };
    }
  }
}
