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
import { stripWorkspacePrefixes } from './scope-utils';
import { VFSBatchOperations } from './vfs-batch-operations';
import { createGitBackedVFS, getGitBackedVFSForOwner, type GitBackedVFS, type GitVFSOptions } from './git-backed-vfs';

// Default configuration
const DEFAULT_WORKSPACE_ROOT = process.env.DEFAULT_WORKSPACE_ROOT || 'project';
const DEFAULT_STORAGE_DIR = process.env.VIRTUAL_FILESYSTEM_STORAGE_DIR 
  || (process.platform === 'win32' 
    ? path.join(process.env.LOCALAPPDATA || process.env.APPDATA || 'C:\\temp', 'vfs-storage')
    : '/tmp/vfs-storage');
const MAX_PATH_LENGTH = 1024;
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_TOTAL_WORKSPACE_SIZE = 100 * 1024 * 1024; // 100MB
const MAX_FILES_PER_WORKSPACE = 10000;
const MAX_SEARCH_LIMIT = 100;

export type FilesystemChangeType = 'create' | 'update' | 'delete';

/**
 * Internal workspace state interface
 */
interface WorkspaceState {
  files: Map<string, VirtualFile>;
  version: number;
  updatedAt: string;
  loaded: boolean;
}

/**
 * Persisted workspace data structure
 */
interface PersistedWorkspace {
  root: string;
  version: number;
  updatedAt: string;
  files: VirtualFile[];
}

/**
 * Filesystem change event
 */
export interface FilesystemChangeEvent {
  path: string;
  type: FilesystemChangeType;
  ownerId: string;
  version: number;
}

/**
 * Conflict event emitted when potential concurrent modification is detected
 */
export interface ConflictEvent {
  path: string;
  previousContent: string;
  newContent: string;
  previousVersion: number;
  timestamp: string;
}

export class VirtualFilesystemService {
  private readonly workspaceRoot: string;
  private readonly storageDir: string;
  private readonly workspaces = new Map<string, WorkspaceState>();
  private readonly persistQueues = new Map<string, Promise<void>>();
  private readonly events = new EventEmitter();
  private batchManager: Map<string, VFSBatchOperations> = new Map();

  /**
   * Get batch operations manager for a specific owner
   */
  batch(ownerId: string): VFSBatchOperations {
    if (!this.batchManager.has(ownerId)) {
      this.batchManager.set(ownerId, new VFSBatchOperations(ownerId));
    }
    return this.batchManager.get(ownerId)!;
  }

  onFileChange(listener: (event: FilesystemChangeEvent) => void): () => void {
    this.events.on('fileChange', listener);
    return () => { this.events.off('fileChange', listener); };
  }

  onSnapshotChange(listener: (ownerId: string, version: number) => void): () => void {
    this.events.on('snapshotChange', listener);
    return () => { this.events.off('snapshotChange', listener); };
  }

  onConflict(listener: (event: ConflictEvent) => void): () => void {
    this.events.on('conflict', listener);
    return () => { this.events.off('conflict', listener); };
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

  async writeFile(
    ownerId: string,
    filePath: string,
    content: string,
    language?: string,
    options?: { failIfExists?: boolean },
  ): Promise<VirtualFile> {
    const workspace = await this.ensureWorkspace(ownerId);
    const normalizedPath = this.normalizePath(filePath);
    const previous = workspace.files.get(normalizedPath);
    const now = new Date().toISOString();
    const normalizedContent = typeof content === 'string' ? content : String(content ?? '');

    if (previous && options?.failIfExists) {
      throw new Error(`File already exists: ${normalizedPath}`);
    }

    // Check for concurrent modification (conflict detection)
    if (previous) {
      const timeSinceLastWrite = Date.now() - new Date(previous.lastModified).getTime();
      if (timeSinceLastWrite < 1000) {
        // File was modified within last second - potential conflict
        console.warn('[VFS] Potential concurrent modification:', filePath, {
          timeSinceLastWrite,
          previousVersion: previous.version,
        });
        
        // Emit conflict event for listeners to handle
        this.events.emit('conflict', {
          path: filePath,
          previousContent: previous.content,
          newContent: normalizedContent,
          previousVersion: previous.version,
          timestamp: now,
        });
      }
    }

    // Validate file size
    const fileSize = Buffer.byteLength(normalizedContent, 'utf8');
    if (fileSize > MAX_FILE_SIZE) {
      throw new Error(
        `File size exceeds limit: ${this.formatFileSize(fileSize)} > ${this.formatFileSize(MAX_FILE_SIZE)}`
      );
    }

    // Validate total workspace size
    const currentTotalSize = Array.from(workspace.files.values())
      .reduce((sum, file) => sum + file.size, 0);
    const newTotalSize = currentTotalSize - (previous?.size || 0) + fileSize;

    if (newTotalSize > MAX_TOTAL_WORKSPACE_SIZE) {
      throw new Error(
        `Workspace quota exceeded: ${this.formatFileSize(newTotalSize)} > ${this.formatFileSize(MAX_TOTAL_WORKSPACE_SIZE)}. ` +
        `Consider deleting unused files.`
      );
    }

    // Validate file count
    if (!previous && workspace.files.size >= MAX_FILES_PER_WORKSPACE) {
      throw new Error(
        `Maximum file count exceeded: ${workspace.files.size} >= ${MAX_FILES_PER_WORKSPACE}`
      );
    }

    const file: VirtualFile = {
      path: normalizedPath,
      content: normalizedContent,
      language: language ?? this.getLanguageFromPath(normalizedPath),
      lastModified: now,
      version: (previous?.version || 0) + 1,
      size: fileSize,
    };

    workspace.files.set(normalizedPath, file);
    workspace.version += 1;
    workspace.updatedAt = now;

    const changeType: FilesystemChangeType = previous ? 'update' : 'create';
    diffTracker.trackChange(file, ownerId, previous?.content);
    this.emitFileChange(ownerId, normalizedPath, changeType, workspace.version);
    this.emitSnapshotChange(ownerId, workspace.version);

    await this.persistWorkspace(ownerId, workspace);

    return file;
  }

  /**
   * Create a directory (ensures parent directories exist)
   * Directories are implicit in the VFS (created when files are written),
   * but this method allows explicit directory creation for empty folders.
   */
  async createDirectory(ownerId: string, dirPath: string): Promise<{ path: string; createdAt: string }> {
    const workspace = await this.ensureWorkspace(ownerId);
    const normalizedPath = this.normalizePath(dirPath);
    const now = new Date().toISOString();

    // Validate directory path
    if (!normalizedPath || normalizedPath === '.') {
      throw new Error('Directory path is required');
    }

    // Check if a file already exists at this path
    const existingFile = workspace.files.get(normalizedPath);
    if (existingFile) {
      throw new Error(`A file already exists at this path: ${normalizedPath}`);
    }

    // Check if directory already exists (by checking if any file has this as parent)
    const hasChildFiles = Array.from(workspace.files.keys()).some(
      filePath => filePath.startsWith(normalizedPath + '/')
    );

    // Create a marker file to represent the directory
    // Directories are implicit in VFS, but we create a .gitkeep-like marker for empty dirs
    const dirMarkerPath = `${normalizedPath}/.directory`;
    const dirMarker: VirtualFile = {
      path: dirMarkerPath,
      content: '',
      language: 'markdown',
      lastModified: now,
      version: 1,
      size: 0,
      isDirectoryMarker: true,
    };

    workspace.files.set(dirMarkerPath, dirMarker);
    workspace.version += 1;
    workspace.updatedAt = now;

    this.emitFileChange(ownerId, normalizedPath, 'create', workspace.version);
    this.emitSnapshotChange(ownerId, workspace.version);

    await this.persistWorkspace(ownerId, workspace);

    return {
      path: normalizedPath,
      createdAt: now,
    };
  }

  /**
   * Format file size for human-readable error messages
   */
  private formatFileSize(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(2)} ${units[unitIndex]}`;
  }

  /**
   * Get workspace size statistics
   */
  async getWorkspaceStats(ownerId: string): Promise<{
    totalSize: number;
    totalSizeFormatted: string;
    fileCount: number;
    largestFile?: { path: string; size: number; sizeFormatted: string };
    quotaUsage: {
      sizePercent: number;
      fileCountPercent: number;
    };
  }> {
    const workspace = await this.ensureWorkspace(ownerId);
    
    let totalSize = 0;
    let largestFile: { path: string; size: number } | undefined;
    
    for (const [filePath, file] of workspace.files.entries()) {
      totalSize += file.size;
      if (!largestFile || file.size > largestFile.size) {
        largestFile = { path: filePath, size: file.size };
      }
    }

    return {
      totalSize,
      totalSizeFormatted: this.formatFileSize(totalSize),
      fileCount: workspace.files.size,
      largestFile: largestFile ? {
        ...largestFile,
        sizeFormatted: this.formatFileSize(largestFile.size),
      } : undefined,
      quotaUsage: {
        sizePercent: (totalSize / MAX_TOTAL_WORKSPACE_SIZE) * 100,
        fileCountPercent: (workspace.files.size / MAX_FILES_PER_WORKSPACE) * 100,
      },
    };
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
          diffTracker.trackDeletion(existingPath, ownerId, deletedFile.content);
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
      // Skip .directory marker files (used to track empty directories)
      if (file.isDirectoryMarker || file.path.endsWith('/.directory')) {
        // But still use them to detect directory existence
        const dirPath = file.path.slice(0, -'/'.length - '.directory'.length);
        const dirName = path.posix.basename(dirPath);
        if (dirPath.startsWith(directoryPrefix) && !directoryNodes.has(dirName)) {
          directoryNodes.set(dirName, {
            type: 'directory',
            name: dirName,
            path: dirPath,
            isExplicit: true, // Mark as explicitly created directory
          });
        }
        continue;
      }

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
            isExplicit: false, // Implicit directory from file paths
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

    // Strip common sandbox/workspace prefixes (single source of truth in scope-utils)
    let strippedPath = stripWorkspacePrefixes(rawPath);
    // Also strip project/ prefix for server-side resolution
    strippedPath = strippedPath.replace(/^project\//, '');

    // Handle empty path after stripping
    if (!strippedPath) {
      return this.workspaceRoot;
    }

    const parts = strippedPath.split('/');
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

    // Always ensure path starts with workspace root
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
        
        // Fix any corrupted paths (e.g., paths starting with tmp/, workspace/, etc.)
        const fixedFiles = (parsed.files || []).map((file) => {
          // Check if path needs normalization
          const needsFix = file.path.startsWith('tmp/') || 
                          file.path.startsWith('workspace/') ||
                          file.path.startsWith('home/') ||
                          (file.path.startsWith('/tmp/') && !file.path.startsWith('/tmp/vfs-storage')) ||
                          (file.path.startsWith('/workspace/')) ||
                          (!file.path.startsWith('project/') && !file.path.startsWith('/project/'));
          
          if (needsFix) {
            const fixedPath = this.normalizePath(file.path);
            console.log('[VFS] Fixed corrupted path:', file.path, '->', fixedPath);
            return { ...file, path: fixedPath };
          }
          return file;
        });
        
        workspace.files = new Map(
          fixedFiles.map((file) => [file.path, file]),
        );
        workspace.version = Number.isFinite(parsed.version) ? parsed.version : workspace.files.size;
        workspace.updatedAt = parsed.updatedAt || new Date().toISOString();
        
        // Persist the fixed paths back to storage
        if (fixedFiles.some((f, i) => f.path !== (parsed.files || [])[i]?.path)) {
          console.log('[VFS] Persisting fixed paths...');
          this.persistWorkspace(normalizedOwnerId, workspace).catch(console.error);
        }
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
        const tmpFilePath = `${storageFilePath}.tmp-${Date.now()}`;
        try {
          // Ensure storage directory exists
          await fs.mkdir(this.storageDir, { recursive: true });

          await fs.writeFile(tmpFilePath, JSON.stringify(serialized, null, 2), 'utf8');
          await fs.rename(tmpFilePath, storageFilePath);
        } catch (error: any) {
          // Cleanup temp file if rename failed
          try {
            await fs.unlink(tmpFilePath).catch(() => { /* ignore cleanup errors */ });
          } catch {}
          
          console.error('[VFS] Persist failed:', {
            ownerId: normalizedOwnerId,
            storageDir: this.storageDir,
            storageFilePath,
            error: error.message,
            platform: process.platform,
          });
          throw error;
        }
      });

    this.persistQueues.set(normalizedOwnerId, next);
    await next;
  }

  /**
   * Get diff summary for LLM context
   * Returns a human-readable summary of all file changes
   */
  getDiffSummary(ownerId: string, maxDiffs = 10): string {
    return diffTracker.getDiffSummary(ownerId, maxDiffs);
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
    const operations = diffTracker.getRollbackOperations(ownerId, targetVersion);
    
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
   * Clear workspace state (for tests)
   */
  async clearWorkspace(ownerId: string): Promise<void> {
    const normalizedOwnerId = this.sanitizeOwnerId(ownerId);
    this.workspaces.delete(normalizedOwnerId);
    diffTracker.clear(ownerId);
    
    // Also delete storage file if it exists
    const storageFilePath = this.getWorkspaceStorageFile(normalizedOwnerId);
    try {
      await fs.unlink(storageFilePath);
    } catch {
      // Ignore if not exists
    }
  }

  /**
   * Get files at a specific version
   */
  getFilesAtVersion(ownerId: string, targetVersion: number): Map<string, string> {
    return diffTracker.getFilesAtVersion(ownerId, targetVersion);
  }

  /**
   * Get diff tracker instance for advanced operations
   */
  getDiffTracker() {
    return diffTracker;
  }

  /**
   * Get git-backed VFS wrapper for owner
   * Enables automatic commits, rollbacks, and version tracking
   */
  getGitBackedVFS(ownerId: string, options?: GitVFSOptions): GitBackedVFS {
    return getGitBackedVFSForOwner(ownerId, this, options);
  }
}

// =============================================================================
// Git-Backed VFS Proxy
// =============================================================================
// The main export now automatically wraps VFS operations with Git-backed
// functionality for automatic commits, version tracking, and rollbacks.
// This ensures all file operations are tracked without requiring code changes.
// =============================================================================

/**
 * Git-backed VFS proxy that wraps VirtualFilesystemService methods
 * to automatically create git commits for every filesystem operation.
 */
class GitBackedVFSProxy {
  private vfs: VirtualFilesystemService;

  constructor(vfs: VirtualFilesystemService) {
    this.vfs = vfs;
  }

  /**
   * Get the underlying VFS instance (for advanced operations)
   */
  get underlying(): VirtualFilesystemService {
    return this.vfs;
  }

  /**
   * Get git-backed VFS for specific owner (full-featured wrapper)
   */
  forOwner(ownerId: string, options?: GitVFSOptions): GitBackedVFS {
    return this.vfs.getGitBackedVFS(ownerId, options);
  }

  // Delegate all VFS methods with automatic git tracking

  async readFile(ownerId: string, filePath: string): Promise<VirtualFile> {
    return this.vfs.readFile(ownerId, filePath);
  }

  async writeFile(
    ownerId: string,
    filePath: string,
    content: string,
    language?: string,
    options?: { failIfExists?: boolean }
  ): Promise<VirtualFile> {
    const gitVFS = this.vfs.getGitBackedVFS(ownerId);
    return gitVFS.writeFile(ownerId, filePath, content, language, options);
  }

  async deletePath(ownerId: string, targetPath: string): Promise<{ deletedCount: number }> {
    // Track deletion in git
    const gitVFS = this.vfs.getGitBackedVFS(ownerId);
    const listing = await this.vfs.listDirectory(ownerId, targetPath);
    
    // Record deletions
    for (const node of listing.nodes) {
      if (node.type === 'file') {
        try {
          const file = await this.vfs.readFile(ownerId, node.path);
          gitVFS.trackTransaction(ownerId, {
            path: node.path,
            type: 'DELETE',
            timestamp: Date.now(),
            originalContent: file.content,
          });
        } catch {
          // File may not exist
        }
      }
    }
    
    const result = await this.vfs.deletePath(ownerId, targetPath);
    
    // Commit the deletion
    if (result.deletedCount > 0) {
      await gitVFS.commitChanges(ownerId, `Delete ${targetPath}`);
    }
    
    return result;
  }

  async listDirectory(
    ownerId: string,
    directoryPath?: string
  ): Promise<import('./filesystem-types').VirtualFilesystemDirectoryListing> {
    return this.vfs.listDirectory(ownerId, directoryPath);
  }

  async search(
    ownerId: string,
    query: string,
    options?: { path?: string; limit?: number }
  ): Promise<import('./filesystem-types').VirtualFilesystemSearchResult[]> {
    return this.vfs.search(ownerId, query, options);
  }

  async getWorkspaceVersion(ownerId: string): Promise<number> {
    return this.vfs.getWorkspaceVersion(ownerId);
  }

  async exportWorkspace(ownerId: string): Promise<import('./filesystem-types').VirtualWorkspaceSnapshot> {
    return this.vfs.exportWorkspace(ownerId);
  }

  async createDirectory(
    ownerId: string,
    dirPath: string
  ): Promise<{ path: string; createdAt: string }> {
    const result = await this.vfs.createDirectory(ownerId, dirPath);

    // Track directory creation in git
    const gitVFS = this.vfs.getGitBackedVFS(ownerId);
    gitVFS.trackTransaction(ownerId, {
      path: dirPath,
      type: 'CREATE',
      timestamp: Date.now(),
      newContent: '',
    });
    await gitVFS.commitChanges(ownerId, `Create directory ${dirPath}`);

    return result;
  }

  async getWorkspaceStats(ownerId: string): Promise<{
    totalSize: number;
    totalSizeFormatted: string;
    fileCount: number;
    largestFile?: { path: string; size: number; sizeFormatted: string };
    quotaUsage: {
      sizePercent: number;
      fileCountPercent: number;
    };
  }> {
    return this.vfs.getWorkspaceStats(ownerId);
  }

  batch(ownerId: string): import('./vfs-batch-operations').VFSBatchOperations {
    return this.vfs.batch(ownerId);
  }

  onFileChange(
    listener: (event: import('./virtual-filesystem-service').FilesystemChangeEvent) => void
  ): () => void {
    return this.vfs.onFileChange(listener);
  }

  onSnapshotChange(
    listener: (ownerId: string, version: number) => void
  ): () => void {
    return this.vfs.onSnapshotChange(listener);
  }

  onConflict(
    listener: (event: import('./virtual-filesystem-service').ConflictEvent) => void
  ): () => void {
    return this.vfs.onConflict(listener);
  }

  getDiffSummary(ownerId: string, maxDiffs?: number): string {
    return this.vfs.getDiffSummary(ownerId, maxDiffs);
  }

  async rollbackToVersion(
    ownerId: string,
    targetVersion: number
  ): Promise<{
    success: boolean;
    restoredFiles: number;
    deletedFiles: number;
    errors: string[];
  }> {
    return this.vfs.rollbackToVersion(ownerId, targetVersion);
  }

  getDiffTracker(): import('./filesystem-diffs').FilesystemDiffTracker {
    return this.vfs.getDiffTracker();
  }

  getFilesAtVersion(ownerId: string, targetVersion: number): Map<string, string> {
    return this.vfs.getFilesAtVersion(ownerId, targetVersion);
  }

  /**
   * Clear workspace (for testing)
   */
  async clearWorkspace(ownerId: string): Promise<void> {
    await this.vfs.deletePath(ownerId, 'project');
  }
}

// Export singleton instance with Git-backed proxy
export const virtualFilesystem = new GitBackedVFSProxy(new VirtualFilesystemService());
