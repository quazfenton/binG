import { promises as fs } from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  VirtualFile,
  VirtualFilesystemDirectoryListing,
  VirtualFilesystemNode,
  VirtualFilesystemSearchResult,
  VirtualWorkspaceSnapshot,
} from './filesystem-types';
import { diffTracker } from './filesystem-diffs';

export type FilesystemChangeType = 'create' | 'update' | 'delete';

export interface FilesystemChangeEvent {
  path: string;
  type: FilesystemChangeType;
  ownerId: string;
  version: number;
}

interface WorkspaceState {
  files: Map<string, VirtualFile>;
  version: number;
  updatedAt: string;
  loaded: boolean;
}

interface PersistedWorkspace {
  root: string;
  version: number;
  updatedAt: string;
  files: VirtualFile[];
}

const DEFAULT_WORKSPACE_ROOT = 'project';
const DEFAULT_STORAGE_DIR = path.join(process.cwd(), 'data', 'virtual-filesystem');
const MAX_PATH_LENGTH = 1024;
const MAX_SEARCH_LIMIT = 200;

export class VirtualFilesystemService {
  private readonly workspaceRoot: string;
  private readonly storageDir: string;
  private readonly workspaces = new Map<string, WorkspaceState>();
  private readonly persistQueues = new Map<string, Promise<void>>();
  private readonly events = new EventEmitter();

  onFileChange(listener: (event: FilesystemChangeEvent) => void): () => void {
    this.events.on('fileChange', listener);
    return () => { this.events.off('fileChange', listener); };
  }

  onSnapshotChange(listener: (ownerId: string, version: number) => void): () => void {
    this.events.on('snapshotChange', listener);
    return () => { this.events.off('snapshotChange', listener); };
  }

  private emitFileChange(ownerId: string, filePath: string, type: FilesystemChangeType, version: number): void {
    this.events.emit('fileChange', { path: filePath, type, ownerId, version });
  }

  private emitSnapshotChange(ownerId: string, version: number): void {
    this.events.emit('snapshotChange', ownerId, version);
  }

  constructor(options: { workspaceRoot?: string; storageDir?: string } = {}) {
    this.workspaceRoot = (options.workspaceRoot || DEFAULT_WORKSPACE_ROOT).replace(/^\/+|\/+$/g, '') || DEFAULT_WORKSPACE_ROOT;
    this.storageDir = options.storageDir
      ? path.resolve(options.storageDir)
      : path.resolve(process.env.VIRTUAL_FILESYSTEM_STORAGE_DIR || DEFAULT_STORAGE_DIR);
  }

  async readFile(ownerId: string, filePath: string): Promise<VirtualFile> {
    const workspace = await this.ensureWorkspace(ownerId);
    const normalizedPath = this.normalizePath(filePath);
    const file = workspace.files.get(normalizedPath);

    if (!file) {
      throw new Error(`File not found: ${normalizedPath}`);
    }

    return file;
  }

  async writeFile(ownerId: string, filePath: string, content: string): Promise<VirtualFile> {
    const workspace = await this.ensureWorkspace(ownerId);
    const normalizedPath = this.normalizePath(filePath);
    const previous = workspace.files.get(normalizedPath);
    const now = new Date().toISOString();
    const normalizedContent = typeof content === 'string' ? content : String(content ?? '');

    const file: VirtualFile = {
      path: normalizedPath,
      content: normalizedContent,
      language: this.getLanguageFromPath(normalizedPath),
      lastModified: now,
      version: (previous?.version || 0) + 1,
      size: Buffer.byteLength(normalizedContent, 'utf8'),
    };

    workspace.files.set(normalizedPath, file);
    workspace.version += 1;
    workspace.updatedAt = now;

    const changeType: FilesystemChangeType = previous ? 'update' : 'create';
    diffTracker.trackChange(file, previous?.content);
    this.emitFileChange(ownerId, normalizedPath, changeType, workspace.version);
    this.emitSnapshotChange(ownerId, workspace.version);

    await this.persistWorkspace(ownerId, workspace);

    return file;
  }

  async deletePath(ownerId: string, targetPath: string): Promise<{ deletedCount: number }> {
    const workspace = await this.ensureWorkspace(ownerId);
    const normalizedPath = this.normalizePath(targetPath);
    const normalizedPrefix = `${normalizedPath}/`;
    let deletedCount = 0;

    for (const existingPath of Array.from(workspace.files.keys())) {
      if (existingPath === normalizedPath || existingPath.startsWith(normalizedPrefix)) {
        const deletedFile = workspace.files.get(existingPath);
        workspace.files.delete(existingPath);
        deletedCount += 1;
        if (deletedFile) {
          diffTracker.trackDeletion(existingPath, deletedFile.content);
        }
        this.emitFileChange(ownerId, existingPath, 'delete', workspace.version + 1);
      }
    }

    if (deletedCount > 0) {
      workspace.version += 1;
      workspace.updatedAt = new Date().toISOString();
      this.emitSnapshotChange(ownerId, workspace.version);
      await this.persistWorkspace(ownerId, workspace);
    }

    return { deletedCount };
  }

  async listDirectory(ownerId: string, directoryPath: string = this.workspaceRoot): Promise<VirtualFilesystemDirectoryListing> {
    const workspace = await this.ensureWorkspace(ownerId);
    const normalizedDirectoryPath = this.normalizePath(directoryPath);
    const directoryNodes = new Map<string, VirtualFilesystemNode>();
    const fileNodes: VirtualFilesystemNode[] = [];
    const directoryPrefix = `${normalizedDirectoryPath}/`;

    for (const file of workspace.files.values()) {
      if (file.path === normalizedDirectoryPath) {
        fileNodes.push(this.toFileNode(file));
        continue;
      }

      if (!file.path.startsWith(directoryPrefix)) {
        continue;
      }

      const remainder = file.path.slice(directoryPrefix.length);
      if (!remainder) {
        continue;
      }

      const slashIndex = remainder.indexOf('/');
      if (slashIndex === -1) {
        fileNodes.push(this.toFileNode(file));
      } else {
        const directoryName = remainder.slice(0, slashIndex);
        if (!directoryNodes.has(directoryName)) {
          directoryNodes.set(directoryName, {
            type: 'directory',
            name: directoryName,
            path: `${normalizedDirectoryPath}/${directoryName}`,
          });
        }
      }
    }

    const nodes = [
      ...Array.from(directoryNodes.values()).sort((a, b) => a.name.localeCompare(b.name)),
      ...fileNodes.sort((a, b) => a.name.localeCompare(b.name)),
    ];

    return {
      path: normalizedDirectoryPath,
      nodes,
    };
  }

  async search(
    ownerId: string,
    query: string,
    options: {
      path?: string;
      limit?: number;
    } = {},
  ): Promise<VirtualFilesystemSearchResult[]> {
    const workspace = await this.ensureWorkspace(ownerId);
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) {
      return [];
    }

    const searchBasePath = this.normalizePath(options.path || this.workspaceRoot);
    const searchPrefix = `${searchBasePath}/`;
    const limit = Math.max(1, Math.min(options.limit || 25, MAX_SEARCH_LIMIT));
    const matches: VirtualFilesystemSearchResult[] = [];

    for (const file of workspace.files.values()) {
      if (file.path !== searchBasePath && !file.path.startsWith(searchPrefix)) {
        continue;
      }

      const fileName = path.posix.basename(file.path).toLowerCase();
      const lowerPath = file.path.toLowerCase();
      const lowerContent = file.content.toLowerCase();
      const inName = fileName.includes(normalizedQuery);
      const inPath = lowerPath.includes(normalizedQuery);
      const inContent = lowerContent.includes(normalizedQuery);

      if (!inName && !inPath && !inContent) {
        continue;
      }

      let score = 0;
      if (fileName === normalizedQuery) score += 120;
      if (inName) score += 80;
      if (inPath) score += 40;
      if (inContent) score += 20;

      matches.push({
        path: file.path,
        name: path.posix.basename(file.path),
        language: file.language,
        score,
        snippet: this.createSnippet(file.content, normalizedQuery),
        lastModified: file.lastModified,
      });
    }

    return matches
      .sort((a, b) => (b.score - a.score) || a.path.localeCompare(b.path))
      .slice(0, limit);
  }

  async getWorkspaceVersion(ownerId: string): Promise<number> {
    const workspace = await this.ensureWorkspace(ownerId);
    return workspace.version;
  }

  async exportWorkspace(ownerId: string): Promise<VirtualWorkspaceSnapshot> {
    const workspace = await this.ensureWorkspace(ownerId);
    const files = Array.from(workspace.files.values())
      .map((file) => ({ ...file }))
      .sort((a, b) => a.path.localeCompare(b.path));

    return {
      root: this.workspaceRoot,
      version: workspace.version,
      updatedAt: workspace.updatedAt,
      files,
    };
  }

  private toFileNode(file: VirtualFile): VirtualFilesystemNode {
    return {
      type: 'file',
      name: path.posix.basename(file.path),
      path: file.path,
      language: file.language,
      size: file.size,
      lastModified: file.lastModified,
    };
  }

  private createSnippet(content: string, query: string): string {
    const lowerContent = content.toLowerCase();
    const matchIndex = lowerContent.indexOf(query);

    if (matchIndex === -1) {
      return content.slice(0, 140);
    }

    const start = Math.max(0, matchIndex - 60);
    const end = Math.min(content.length, matchIndex + query.length + 60);
    const prefix = start > 0 ? '...' : '';
    const suffix = end < content.length ? '...' : '';
    return `${prefix}${content.slice(start, end)}${suffix}`;
  }

  private getLanguageFromPath(filePath: string): string {
    const extension = filePath.split('.').pop()?.toLowerCase();
    const languageByExtension: Record<string, string> = {
      js: 'javascript',
      jsx: 'jsx',
      ts: 'typescript',
      tsx: 'tsx',
      py: 'python',
      java: 'java',
      cpp: 'cpp',
      c: 'c',
      html: 'html',
      css: 'css',
      scss: 'scss',
      json: 'json',
      md: 'markdown',
      yml: 'yaml',
      yaml: 'yaml',
      xml: 'xml',
      php: 'php',
      rb: 'ruby',
      go: 'go',
      rs: 'rust',
      swift: 'swift',
      kt: 'kotlin',
      dart: 'dart',
      vue: 'vue',
      svelte: 'svelte',
      sh: 'shell',
      bash: 'shell',
      txt: 'text',
    };

    return languageByExtension[extension || ''] || 'text';
  }

  private normalizePath(inputPath: string): string {
    const rawPath = (inputPath || '').replace(/\\/g, '/').trim();
    if (!rawPath || rawPath === '/') {
      return this.workspaceRoot;
    }

    const normalizedInput = rawPath.replace(/^\/+/, '');
    const parts = normalizedInput.split('/');
    const safeParts: string[] = [];

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed || trimmed === '.') {
        continue;
      }
      if (trimmed === '..') {
        throw new Error(`Path traversal is not allowed: ${inputPath}`);
      }
      if (trimmed.includes('\0')) {
        throw new Error(`Invalid path segment: ${inputPath}`);
      }
      safeParts.push(trimmed);
    }

    if (safeParts.length === 0) {
      return this.workspaceRoot;
    }

    if (safeParts[0] !== this.workspaceRoot) {
      safeParts.unshift(this.workspaceRoot);
    }

    const normalizedPath = safeParts.join('/');
    if (normalizedPath.length > MAX_PATH_LENGTH) {
      throw new Error(`Path exceeds max length (${MAX_PATH_LENGTH})`);
    }

    return normalizedPath;
  }

  private sanitizeOwnerId(ownerId: string): string {
    const trimmed = (ownerId || '').trim();
    if (!trimmed) return 'anon:public';
    if (trimmed.length > 256) return trimmed.slice(0, 256);
    return trimmed;
  }

  private getWorkspaceStorageFile(ownerId: string): string {
    const normalizedOwnerId = this.sanitizeOwnerId(ownerId);
    const hash = crypto.createHash('sha256').update(normalizedOwnerId).digest('hex').slice(0, 32);
    return path.join(this.storageDir, `${hash}.json`);
  }

  private async ensureWorkspace(ownerId: string): Promise<WorkspaceState> {
    const normalizedOwnerId = this.sanitizeOwnerId(ownerId);
    let workspace = this.workspaces.get(normalizedOwnerId);

    if (!workspace) {
      workspace = {
        files: new Map<string, VirtualFile>(),
        version: 0,
        updatedAt: new Date().toISOString(),
        loaded: false,
      };
      this.workspaces.set(normalizedOwnerId, workspace);
    }

    if (!workspace.loaded) {
      const storageFilePath = this.getWorkspaceStorageFile(normalizedOwnerId);
      try {
        const raw = await fs.readFile(storageFilePath, 'utf8');
        const parsed = JSON.parse(raw) as PersistedWorkspace;
        workspace.files = new Map(
          (parsed.files || []).map((file) => [file.path, file]),
        );
        workspace.version = Number.isFinite(parsed.version) ? parsed.version : workspace.files.size;
        workspace.updatedAt = parsed.updatedAt || new Date().toISOString();
      } catch (error: unknown) {
        const errorCode = (error as NodeJS.ErrnoException)?.code;
        if (errorCode !== 'ENOENT') {
          console.warn('[virtual-filesystem] Failed to load workspace from storage:', error);
        }
        workspace.files = new Map<string, VirtualFile>();
        workspace.version = 0;
        workspace.updatedAt = new Date().toISOString();
      }
      workspace.loaded = true;
    }

    return workspace;
  }

  private async persistWorkspace(ownerId: string, workspace: WorkspaceState): Promise<void> {
    const normalizedOwnerId = this.sanitizeOwnerId(ownerId);
    const storageFilePath = this.getWorkspaceStorageFile(normalizedOwnerId);
    const serialized: PersistedWorkspace = {
      root: this.workspaceRoot,
      version: workspace.version,
      updatedAt: workspace.updatedAt,
      files: Array.from(workspace.files.values()).sort((a, b) => a.path.localeCompare(b.path)),
    };

    const previous = this.persistQueues.get(normalizedOwnerId) || Promise.resolve();
    const next = previous
      .catch(() => undefined)
      .then(async () => {
        await fs.mkdir(this.storageDir, { recursive: true });
        const tmpFilePath = `${storageFilePath}.tmp-${Date.now()}`;
        await fs.writeFile(tmpFilePath, JSON.stringify(serialized, null, 2), 'utf8');
        await fs.rename(tmpFilePath, storageFilePath);
      });

    this.persistQueues.set(normalizedOwnerId, next);
    await next;
  }

  /**
   * Get diff summary for LLM context
   * Returns a human-readable summary of all file changes
   */
  getDiffSummary(ownerId: string, maxDiffs = 10): string {
    return diffTracker.getDiffSummary(maxDiffs, ownerId);
  }

  /**
   * Rollback workspace to a specific version
   * Restores all files to their state at the target version
   */
  async rollbackToVersion(ownerId: string, targetVersion: number): Promise<{
    success: boolean;
    restoredFiles: number;
    deletedFiles: number;
    errors: string[];
  }> {
    const workspace = await this.ensureWorkspace(ownerId);
    const operations = diffTracker.getRollbackOperations(targetVersion);
    
    const errors: string[] = [];
    let restoredFiles = 0;
    let deletedFiles = 0;

    for (const op of operations) {
      try {
        if (op.operation === 'delete') {
          await this.deletePath(ownerId, op.path);
          deletedFiles++;
        } else if (op.content !== undefined) {
          await this.writeFile(ownerId, op.path, op.content);
          restoredFiles++;
        }
      } catch (error: any) {
        errors.push(`Failed to ${op.operation} ${op.path}: ${error.message}`);
      }
    }

    return {
      success: errors.length === 0,
      restoredFiles,
      deletedFiles,
      errors,
    };
  }

  /**
   * Get files at a specific version
   */
  getFilesAtVersion(ownerId: string, targetVersion: number): Map<string, string> {
    return diffTracker.getFilesAtVersion(targetVersion);
  }

  /**
   * Get diff tracker instance for advanced operations
   */
  getDiffTracker() {
    return diffTracker;
  }
}

export const virtualFilesystem = new VirtualFilesystemService();
