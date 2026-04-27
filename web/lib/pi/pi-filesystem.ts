/**
 * Pi Filesystem Adapters
 *
 * Thin wrappers around the centralized agent-filesystem module.
 * All filesystem backend logic (VFS, local, MCP, remote) is handled
 * by AgentFilesystem — this module just adapts the interface to
 * PiFilesystemAdapter (which adds optional git operations).
 *
 * Modes:
 * - VFS (virtual filesystem for web mode)
 * - Local (native filesystem for desktop mode)
 * - MCP Tools (integrates with binG's MCP tool system)
 * - Remote (HTTP proxy to a remote agent server)
 */

import type { PiFilesystemAdapter, PiDirEntry } from './pi-types';
import {
  createAgentFilesystem,
  type AgentFilesystem,
  type DirEntry,
} from '@/lib/agent-bins/agent-filesystem';

// ────────────────────────────────────────────────────────────────────────────
// Adapter: wraps AgentFilesystem → PiFilesystemAdapter
// ────────────────────────────────────────────────────────────────────────────

/**
 * Wraps an AgentFilesystem to implement PiFilesystemAdapter.
 * Converts DirEntry → PiDirEntry and delegates all core operations.
 * Optional git operations can be mixed in by subclasses or extensions.
 */
class AgentFsAdapter implements PiFilesystemAdapter {
  protected readonly fs: AgentFilesystem;

  constructor(fs: AgentFilesystem) {
    this.fs = fs;
  }

  /** Current working directory used by the underlying filesystem */
  get cwd(): string {
    return this.fs.cwd;
  }

  async readFile(path: string): Promise<string> {
    return this.fs.readFile(path);
  }

  async writeFile(path: string, content: string): Promise<void> {
    return this.fs.writeFile(path, content);
  }

  async listDirectory(path: string): Promise<PiDirEntry[]> {
    const entries = await this.fs.listDirectory(path);
    return entries.map(toPiDirEntry);
  }

  async exists(path: string): Promise<boolean> {
    return this.fs.exists(path);
  }

  async search(query: string, options?: { path?: string; limit?: number }): Promise<PiDirEntry[]> {
    const entries = await this.fs.search(query, options);
    return entries.map(toPiDirEntry);
  }
}

/** Convert AgentFilesystem DirEntry → PiDirEntry */
function toPiDirEntry(entry: DirEntry): PiDirEntry {
  return {
    name: entry.name,
    path: entry.path,
    type: entry.type,
    size: entry.size,
    lastModified: entry.lastModified,
  };
}

// ────────────────────────────────────────────────────────────────────────────
// Convenience subclasses (backward-compatible exports)
// ────────────────────────────────────────────────────────────────────────────

/** VFS Filesystem Adapter — uses binG's virtual filesystem (web mode) */
export class VfsFilesystemAdapter extends AgentFsAdapter {
  constructor(
    userId: string,
    scopePath?: string,
  ) {
    super(createAgentFilesystem({
      mode: 'vfs',
      userId,
      scopePath,
    }));
  }
}

/** Local Filesystem Adapter — uses native Node.js fs (desktop mode) */
export class LocalFilesystemAdapter extends AgentFsAdapter {
  constructor(
    cwd: string = process.cwd(),
  ) {
    super(createAgentFilesystem({ mode: 'local', cwd }));
  }
}

/** MCP Tools Adapter — uses binG's MCP tool system (web fallback) */
export class McpToolsFilesystemAdapter extends AgentFsAdapter {
  constructor(
    userId: string = 'default',
  ) {
    super(createAgentFilesystem({ mode: 'mcp', userId }));
  }
}

/** Remote Filesystem Adapter — proxies to a remote agent server */
export class RemoteFilesystemAdapter extends AgentFsAdapter {
  constructor(
    remoteUrl: string,
    cwd?: string,
  ) {
    super(createAgentFilesystem({ mode: 'remote', remoteUrl, cwd }));
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Factory
// ────────────────────────────────────────────────────────────────────────────

/** Create filesystem adapter based on mode */
export function createFilesystemAdapter(
  mode: 'vfs' | 'local' | 'mcp' | 'remote',
  options: { userId?: string; cwd?: string; scopePath?: string; remoteUrl?: string },
): PiFilesystemAdapter {
  // Use the centralized factory for automatic mode detection when mode is not specified
  const fs = createAgentFilesystem({
    mode: mode === 'remote' ? 'remote' : mode,
    userId: options.userId,
    cwd: options.cwd,
    scopePath: options.scopePath,
    remoteUrl: options.remoteUrl,
  });

  return new AgentFsAdapter(fs);
}

/**
 * Create a filesystem adapter using auto-detected mode from the runtime environment.
 *
 * - Desktop → local (native Node.js fs)
 * - Web     → vfs   (virtual filesystem)
 */
export function createAutoFilesystemAdapter(
  options: { userId?: string; cwd?: string; scopePath?: string; remoteUrl?: string } = {},
): PiFilesystemAdapter {
  const fs = createAgentFilesystem({
    userId: options.userId,
    cwd: options.cwd,
    scopePath: options.scopePath,
    remoteUrl: options.remoteUrl,
    // mode omitted → auto-detected via detectDefaultFsMode()
  });

  return new AgentFsAdapter(fs);
}
