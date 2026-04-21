/**
 * Agent Filesystem — Centralized Desktop/Web Mode Handling
 *
 * Provides a unified filesystem interface that automatically selects
 * the correct backend based on the runtime environment:
 *
 * - Desktop mode:  Native Node.js fs with local workspace root
 * - Web mode:     VFS (virtual filesystem) via MCP tools or OPFS
 * - Remote mode:  HTTP-based filesystem proxy to a remote agent server
 *
 * This centralizes the desktop/web filesystem split that was previously
 * duplicated across pi-filesystem.ts, opencode-cli.ts, and other services.
 *
 * Key differences handled:
 * ┌──────────────────────┬──────────────────────────┬──────────────────────────┐
 * │ Aspect              │ Desktop                  │ Web                      │
 * ├──────────────────────┼──────────────────────────┼──────────────────────────┤
 * │ File ops            │ Direct Node.js fs/promises│ VFS / MCP / OPFS         │
 * │ Path root           │ User workspace dir       │ Virtual workspace scope  │
 * │ Command execution    │ Local child_process      │ VFS MCP tools / parsed   │
 * │ Path resolution     │ Native (relative to cwd) │ Normalized forward-slash  │
 * │ Permissions         │ OS-level (user scope)    │ Server-enforced sandbox   │
 * └──────────────────────┴──────────────────────────┴──────────────────────────┘
 */

import { isDesktopMode, isLocalExecution, getDefaultWorkspaceRoot } from '@bing/platform/env';
import { normalizeAndSecurePath, filterSensitiveDirs } from './security';

// ────────────────────────────────────────────────────────────────────────────
// Types
// ────────────────────────────────────────────────────────────────────────────

export type AgentFsMode = 'local' | 'vfs' | 'mcp' | 'remote';

export interface AgentFsConfig {
  /** Filesystem mode */
  mode: AgentFsMode;
  /** User ID (for VFS/MCP modes) */
  userId?: string;
  /** Working directory / workspace root */
  cwd?: string;
  /** Scope path for VFS */
  scopePath?: string;
  /** Remote server URL (for remote mode) */
  remoteUrl?: string;
}

export interface DirEntry {
  name: string;
  path: string;
  type: 'file' | 'directory';
  size?: number;
  lastModified?: string;
}

/**
 * Unified filesystem interface for all agent services.
 * Works regardless of whether we're in desktop or web mode.
 */
export interface AgentFilesystem {
  /** Current mode */
  readonly mode: AgentFsMode;

  /** Working directory root */
  readonly cwd: string;

  /** Read file contents */
  readFile(path: string): Promise<string>;

  /** Write file contents */
  writeFile(path: string, content: string): Promise<void>;

  /** List directory entries */
  listDirectory(path: string): Promise<DirEntry[]>;

  /** Check if a file/directory exists */
  exists(path: string): Promise<boolean>;

  /** Search for files by name pattern */
  search(query: string, options?: { path?: string; limit?: number }): Promise<DirEntry[]>;
}

// ────────────────────────────────────────────────────────────────────────────
// Mode detection
// ────────────────────────────────────────────────────────────────────────────

/**
 * Determine the default filesystem mode based on the runtime environment.
 *
 * - Desktop (Tauri or DESKTOP_MODE=true) → 'local'
 * - Web with VFS available                → 'vfs'
 * - Fallback                              → 'mcp'
 */
export function detectDefaultFsMode(): AgentFsMode {
  if (isDesktopMode() || isLocalExecution()) {
    return 'local';
  }
  // Web mode — prefer VFS when available, fall back to MCP
  return 'vfs';
}

/**
 * Get the default workspace root for the current environment.
 */
export function getDefaultAgentCwd(): string {
  if (isDesktopMode() || isLocalExecution()) {
    return getDefaultWorkspaceRoot() || process.cwd();
  }
  return '/workspace';
}

// ────────────────────────────────────────────────────────────────────────────
// Local filesystem implementation (desktop)
// ────────────────────────────────────────────────────────────────────────────

class LocalAgentFs implements AgentFilesystem {
  readonly mode: AgentFsMode = 'local';
  readonly cwd: string;

  constructor(cwd?: string) {
    this.cwd = cwd || getDefaultAgentCwd();
  }

  async readFile(path: string): Promise<string> {
    const fs = await import('fs/promises');
    return fs.readFile(this.resolvePath(path), 'utf-8');
  }

  async writeFile(path: string, content: string): Promise<void> {
    const fs = await import('fs/promises');
    const fullPath = this.resolvePath(path);
    // Ensure parent directory exists
    const dir = fullPath.substring(0, fullPath.lastIndexOf('/'));
    await fs.mkdir(dir, { recursive: true }).catch(() => {});
    await fs.writeFile(fullPath, content, 'utf-8');
  }

  async listDirectory(path: string): Promise<DirEntry[]> {
    const fs = await import('fs/promises');
    const fullPath = this.resolvePath(path);
    try {
      const entries = await fs.readdir(fullPath, { withFileTypes: true });
      return entries.map(entry => ({
        name: entry.name,
        path: `${path.replace(/\/+$/, '')}/${entry.name}`,
        type: entry.isDirectory() ? 'directory' : 'file',
      }));
    } catch {
      return [];
    }
  }

  async exists(path: string): Promise<boolean> {
    const fs = await import('fs/promises');
    try {
      await fs.access(this.resolvePath(path));
      return true;
    } catch {
      return false;
    }
  }

  async search(query: string, options?: { path?: string; limit?: number }): Promise<DirEntry[]> {
    const results: DirEntry[] = [];
    const searchRoot = options?.path || this.cwd;
    const limit = options?.limit || 50;

    const searchDir = async (dir: string, depth: number) => {
      if (results.length >= limit || depth > 5) return;
      try {
        const entries = await this.listDirectory(dir);
        for (const entry of entries) {
          if (results.length >= limit) break;
          if (entry.name.toLowerCase().includes(query.toLowerCase())) {
            results.push(entry);
          }
          if (entry.type === 'directory') {
            await searchDir(entry.path, depth + 1);
          }
        }
      } catch { /* skip inaccessible dirs */ }
    };

    await searchDir(searchRoot, 0);
    return results;
  }

  private resolvePath(filePath: string): string {
    let p = filePath.replace(/\\/g, '/');

    // Strip redundant CWD prefix if the LLM echoed back the full absolute path
    // e.g. cwd="/home/user/project", LLM writes "/home/user/project/src/app.ts"
    //   → resolve to just "src/app.ts" relative to CWD (avoids double-nesting)
    const cwdNorm = this.cwd.replace(/\\/g, '/').replace(/\/+$/, '');
    if (cwdNorm && p.startsWith(cwdNorm + '/')) {
      p = p.slice(cwdNorm.length + 1);
    }
    // Also handle Windows drive letter case (C:\Users\... echoed as C:/Users/...)
    if (cwdNorm && /^[A-Za-z]:/.test(p)) {
      const pNorm = p.replace(/^([A-Za-z]):/, (_, d) => d.toUpperCase() + ':');
      const cwdDrive = cwdNorm.replace(/^([A-Za-z]):/, (_, d) => d.toUpperCase() + ':');
      if (pNorm.startsWith(cwdDrive + '/')) {
        p = pNorm.slice(cwdDrive.length + 1);
      }
    }

    // Absolute paths start with '/' or drive letter (Windows) — use as-is
    if (p.startsWith('/') || /^[A-Za-z]:/.test(p)) {
      return p;
    }
    return `${cwdNorm}/${p}`;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// VFS filesystem implementation (web)
// ────────────────────────────────────────────────────────────────────────────

class VfsAgentFs implements AgentFilesystem {
  readonly mode: AgentFsMode = 'vfs';
  readonly cwd: string;

  constructor(
    private userId: string,
    cwd?: string,
    private scopePath?: string,
  ) {
    this.cwd = cwd || '/workspace';
  }

  async readFile(path: string): Promise<string> {
    const { virtualFilesystem } = await import('@/lib/virtual-filesystem');
    const file = await virtualFilesystem.readFile(this.userId, path);
    return file.content || '';
  }

  async writeFile(path: string, content: string): Promise<void> {
    const { virtualFilesystem } = await import('@/lib/virtual-filesystem');
    await virtualFilesystem.writeFile(this.userId, path, content);
  }

  async listDirectory(path: string): Promise<DirEntry[]> {
    const { virtualFilesystem } = await import('@/lib/virtual-filesystem');
    const listing = await virtualFilesystem.listDirectory(this.userId, path);
    const entries = (listing.nodes || []).map(node => ({
      name: node.name,
      path: node.path,
      type: node.type === 'directory' ? 'directory' : 'file',
      size: node.size,
      lastModified: node.lastModified,
    }));
    // Filter out sensitive directories (.git, node_modules, etc.)
    return filterSensitiveDirs(entries) as DirEntry[];
  }

  async exists(path: string): Promise<boolean> {
    try {
      const { virtualFilesystem } = await import('@/lib/virtual-filesystem');
      await virtualFilesystem.readFile(this.userId, path);
      return true;
    } catch {
      return false;
    }
  }

  async search(query: string, options?: { path?: string; limit?: number }): Promise<DirEntry[]> {
    const { virtualFilesystem } = await import('@/lib/virtual-filesystem');
    const results = await virtualFilesystem.search(this.userId, query, {
      path: options?.path,
      limit: options?.limit,
    }) as any;
    return (results.files || results).map((f: any) => ({
      name: f.name,
      path: f.path,
      type: f.type === 'directory' ? 'directory' : 'file',
    }));
  }
}

// ────────────────────────────────────────────────────────────────────────────
// MCP filesystem implementation (web fallback)
// ────────────────────────────────────────────────────────────────────────────

class McpAgentFs implements AgentFilesystem {
  readonly mode: AgentFsMode = 'mcp';
  readonly cwd: string;

  constructor(
    private userId: string = 'default',
    cwd?: string,
  ) {
    this.cwd = cwd || '/workspace';
  }

  async readFile(path: string): Promise<string> {
    const { callMCPToolFromAI_SDK } = await import('@/lib/mcp/architecture-integration');
    const result = await callMCPToolFromAI_SDK('read_file', { path }, this.userId);
    if (!result.success) {
      throw new Error(result.error || 'Failed to read file');
    }
    return result.output;
  }

  async writeFile(path: string, content: string): Promise<void> {
    const { callMCPToolFromAI_SDK } = await import('@/lib/mcp/architecture-integration');
    const result = await callMCPToolFromAI_SDK('write_file', { path, content }, this.userId);
    if (!result.success) {
      throw new Error(result.error || 'Failed to write file');
    }
  }

  async listDirectory(path: string): Promise<DirEntry[]> {
    const { callMCPToolFromAI_SDK } = await import('@/lib/mcp/architecture-integration');
    const result = await callMCPToolFromAI_SDK('list_files', { path }, this.userId);
    if (!result.success) return [];
    try {
      const data = JSON.parse(result.output);
      return (data.files || data.nodes || []).map((node: any) => ({
        name: node.name || node.path?.split('/').pop(),
        path: node.path,
        type: (node.type === 'directory' ? 'directory' : 'file') as 'file' | 'directory',
        size: node.size,
      }));
    } catch {
      return [];
    }
  }

  async exists(path: string): Promise<boolean> {
    try {
      await this.readFile(path);
      return true;
    } catch {
      return false;
    }
  }

  async search(query: string, options?: { path?: string; limit?: number }): Promise<DirEntry[]> {
    const { callMCPToolFromAI_SDK } = await import('@/lib/mcp/architecture-integration');
    const result = await callMCPToolFromAI_SDK('search_files', {
      query,
      path: options?.path || '.',
      limit: options?.limit || 50,
    }, this.userId);
    if (!result.success) return [];
    try {
      const data = JSON.parse(result.output);
      return (data.matches || []).map((m: any) => ({
        name: m.file?.split('/').pop() || m.path?.split('/').pop(),
        path: m.file || m.path,
        type: 'file' as const,
      }));
    } catch {
      return [];
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Remote filesystem implementation (proxy to agent server)
// ────────────────────────────────────────────────────────────────────────────

class RemoteAgentFs implements AgentFilesystem {
  readonly mode: AgentFsMode = 'remote';
  readonly cwd: string;

  constructor(
    private remoteUrl: string,
    cwd?: string,
  ) {
    this.cwd = cwd || '/workspace';
  }

  private async request(endpoint: string, body?: Record<string, unknown>): Promise<unknown> {
    const baseUrl = this.remoteUrl.replace(/\/+$/, '');
    const response = await fetch(`${baseUrl}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (!response.ok) {
      throw new Error(`Remote FS error: HTTP ${response.status}`);
    }
    return response.json();
  }

  async readFile(path: string): Promise<string> {
    const result = await this.request('/fs/read', { path });
    return (result as any).content || '';
  }

  async writeFile(path: string, content: string): Promise<void> {
    await this.request('/fs/write', { path, content });
  }

  async listDirectory(path: string): Promise<DirEntry[]> {
    const result = await this.request('/fs/list', { path });
    return (result as any)?.entries || [];
  }

  async exists(path: string): Promise<boolean> {
    const result = await this.request('/fs/exists', { path });
    return (result as any)?.exists || false;
  }

  async search(query: string, options?: { path?: string; limit?: number }): Promise<DirEntry[]> {
    const result = await this.request('/fs/search', { query, ...options });
    return (result as any)?.entries || [];
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Factory
// ────────────────────────────────────────────────────────────────────────────

/**
 * Create an AgentFilesystem instance from the given config.
 *
 * If no mode is specified, it auto-detects based on the runtime:
 * - Desktop → local (native Node.js fs)
 * - Web     → vfs   (virtual filesystem)
 */
export function createAgentFilesystem(config?: Partial<AgentFsConfig>): AgentFilesystem {
  const mode = config?.mode || detectDefaultFsMode();
  const cwd = config?.cwd || getDefaultAgentCwd();

  switch (mode) {
    case 'local':
      return new LocalAgentFs(cwd);
    case 'vfs':
      return new VfsAgentFs(config?.userId || 'default', cwd, config?.scopePath);
    case 'mcp':
      return new McpAgentFs(config?.userId || 'default', cwd);
    case 'remote':
      if (!config?.remoteUrl) {
        throw new Error('remoteUrl is required for remote filesystem mode');
      }
      return new RemoteAgentFs(config.remoteUrl, cwd);
    default:
      throw new Error(`Unknown filesystem mode: ${mode}`);
  }
}
