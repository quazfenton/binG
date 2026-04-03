/**
 * File Import Service
 *
 * Handles importing files from user's local device into the virtual filesystem.
 * Files are organized in dedicated import folders with automatic git commit tracking.
 *
 * Features:
 * - Single file and bulk import
 * - Folder structure preservation
 * - Automatic shadow commits
 * - Import history tracking
 * - Size and quota validation
 */

// Lazy load to avoid bundling in client
let VirtualFilesystemService: any;

async function getVFS() {
  if (!VirtualFilesystemService) {
    const vfs = await import('./virtual-filesystem-service');
    VirtualFilesystemService = vfs.VirtualFilesystemService;
  }
  return VirtualFilesystemService;
}

// Lazy load ShadowCommitManager to avoid bundling in client
let ShadowCommitManager: any;

async function getCommitManager() {
  if (!ShadowCommitManager) {
    const mod = await import('@/lib/orchestra/stateful-agent/commit/shadow-commit');
    ShadowCommitManager = mod.ShadowCommitManager;
  }
  return ShadowCommitManager;
}
import { resolveScopedPath, normalizeScopePath, extractSessionIdFromPath } from './scope-utils';
import { normalizeSessionId } from './scope-utils';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('FileImport');

/**
 * VFS interface that supports writeFile operations
 * Supports both VirtualFilesystemService and GitBackedVFSProxy
 */
interface VFSWriteable {
  writeFile(
    ownerId: string,
    filePath: string,
    content: string,
    language?: string,
    options?: { failIfExists?: boolean }
  ): Promise<import('./filesystem-types').VirtualFile>;
  readFile(ownerId: string, filePath: string): Promise<import('./filesystem-types').VirtualFile>;
  listDirectory(
    ownerId: string,
    directoryPath?: string
  ): Promise<import('./filesystem-types').VirtualFilesystemDirectoryListing>;
}

export interface ImportOptions {
  /** Owner ID for the import (user ID or anonymous session) */
  ownerId: string;
  /** Session ID for commit tracking */
  sessionId?: string;
  /** Custom import folder name (default: "imports-{timestamp}") */
  importFolderName?: string;
  /** Scope path for import destination (default: project/sessions/{sessionId}) */
  scopePath?: string;
  /** Preserve folder structure from uploaded files */
  preserveStructure?: boolean;
  /** Create shadow commit for import operation */
  autoCommit?: boolean;
  /** Commit message (default: auto-generated) */
  commitMessage?: string;
}

export interface ImportedFile {
  path: string;
  size: number;
  language: string;
}

export interface ImportResult {
  success: boolean;
  importedFiles: number;
  importedFolders: number;
  destinationPath: string;
  files: ImportedFile[];
  commitId?: string;
  sessionId?: string;
  errors: string[];
  warnings: string[];
}

export class FileImportService {
  private static readonly MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB per file
  private static readonly MAX_IMPORT_FILES = 100; // Max files per import
  private static readonly MAX_TOTAL_SIZE = 50 * 1024 * 1024; // 50MB total per import

  constructor(private vfs: VFSWriteable) {}

  /**
   * Import files from client into VFS
   * 
   * Files are stored in: project/sessions/{sessionId}/imports-{timestamp}/
   * or custom destination if specified.
   * 
   * @param files - Array of file objects with name, content, and optional path
   * @param options - Import configuration options
   * @returns ImportResult with details of imported files
   */
  async importFiles(
    files: Array<{ name: string; content: string; path?: string }>,
    options: ImportOptions
  ): Promise<ImportResult> {
    const {
      ownerId,
      sessionId,
      scopePath,
      autoCommit = true,
      importFolderName,
      preserveStructure = true,
      commitMessage,
    } = options;

    const errors: string[] = [];
    const warnings: string[] = [];
    const importedFiles: ImportedFile[] = [];
    let importedFolders = 0;

    // Validate file count
    if (files.length > FileImportService.MAX_IMPORT_FILES) {
      throw new Error(
        `Too many files to import: ${files.length} (max: ${FileImportService.MAX_IMPORT_FILES})`
      );
    }

    // Validate total size
    const totalSize = files.reduce((sum, f) => sum + Buffer.byteLength(f.content, 'utf8'), 0);
    if (totalSize > FileImportService.MAX_TOTAL_SIZE) {
      throw new Error(
        `Total import size exceeds limit: ${this.formatFileSize(totalSize)} (max: ${this.formatFileSize(FileImportService.MAX_TOTAL_SIZE)})`
      );
    }

    // Determine destination path
    const timestamp = new Date().toISOString().slice(0, 10);
    const folderName = importFolderName || `imports-${timestamp}`;
    // CRITICAL FIX: Normalize sessionId to prevent composite IDs in paths
    const simpleSessionId = sessionId ? normalizeSessionId(sessionId) : undefined;
    const baseScopePath = scopePath || (simpleSessionId ? `project/sessions/${simpleSessionId}` : 'project');
    const destinationPath = resolveScopedPath(folderName, baseScopePath);

    logger.info(`Starting import to ${destinationPath}`, {
      fileCount: files.length,
      totalSize,
      preserveStructure,
    });

    // Track operations for commit
    const operations: Array<{
      path: string;
      type: 'CREATE' | 'UPDATE';
      originalContent?: string;
      newContent: string;
    }> = [];

    // Group files by folder for structure tracking
    const folderPaths = new Set<string>();

    // Process each file
    for (const file of files) {
      try {
        // Validate individual file size
        const fileSize = Buffer.byteLength(file.content, 'utf8');
        if (fileSize > FileImportService.MAX_FILE_SIZE) {
          errors.push(`${file.name}: File exceeds size limit (${this.formatFileSize(fileSize)})`);
          continue;
        }

        // Determine file path in VFS
        let vfsPath: string;
        if (preserveStructure && file.path) {
          // Preserve relative folder structure
          const relativePath = this.extractRelativePath(file.path);
          vfsPath = resolveScopedPath(relativePath, destinationPath);
        } else {
          // Flat structure - all files in import folder
          vfsPath = resolveScopedPath(file.name, destinationPath);
        }

        // Track folder structure
        const folderPath = vfsPath.substring(0, vfsPath.lastIndexOf('/'));
        if (folderPath && folderPath !== destinationPath && !folderPaths.has(folderPath)) {
          folderPaths.add(folderPath);
          importedFolders++;
        }

        // Check if file already exists
        let existingContent: string | undefined;
        try {
          const existing = await this.vfs.readFile(ownerId, vfsPath);
          existingContent = existing.content;
          warnings.push(`${file.name}: File already exists, will be overwritten`);
        } catch {
          // File doesn't exist, this is a create operation
        }

        // Detect language from file extension
        const language = this.detectLanguage(file.name);

        // Write to VFS
        await this.vfs.writeFile(ownerId, vfsPath, file.content, language);

        importedFiles.push({
          path: vfsPath,
          size: fileSize,
          language,
        });

        // Track for commit
        operations.push({
          path: vfsPath,
          type: existingContent ? 'UPDATE' : 'CREATE',
          originalContent: existingContent,
          newContent: file.content,
        });

        logger.debug(`Imported: ${file.name} -> ${vfsPath}`);
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        errors.push(`${file.name}: ${errorMsg}`);
        logger.error(`Failed to import ${file.name}:`, error);
      }
    }

    // Create shadow commit if enabled
    let commitId: string | undefined;
    if (autoCommit && operations.length > 0 && sessionId) {
      try {
        const CommitManager = await getCommitManager();
        const commitManager = new CommitManager();
        
        // Build VFS snapshot for commit
        const vfsSnapshot: Record<string, string> = {};
        for (const op of operations) {
          vfsSnapshot[op.path] = op.newContent;
        }
        
        const commitResult = await commitManager.commit(
          vfsSnapshot,
          operations.map(op => ({
            path: op.path,
            type: op.type,
            timestamp: Date.now(),
            originalContent: op.originalContent,
            newContent: op.newContent,
          })),
          {
            sessionId,
            message:
              commitMessage ||
              `Imported ${importedFiles.length} files to ${folderName}`,
            author: ownerId,
            source: 'import',
            integration: 'file-import',
          }
        );
        commitId = commitResult.commitId;
        logger.info(`Created commit ${commitId} for import`);
      } catch (commitError) {
        logger.warn('Failed to create commit for import:', commitError);
        warnings.push('Files imported but commit tracking failed');
      }
    }

    const success = errors.length === 0 || importedFiles.length > 0;

    logger.info(`Import completed: ${importedFiles.length} files, ${errors.length} errors`);

    return {
      success,
      importedFiles: importedFiles.length,
      importedFolders,
      destinationPath,
      files: importedFiles,
      commitId,
      sessionId,
      errors,
      warnings,
    };
  }

  /**
   * Extract relative path from webkitRelativePath
   * Removes the first folder component (usually the selected folder name)
   */
  private extractRelativePath(fullPath: string): string {
    if (!fullPath) return '';
    
    // webkitRelativePath format: "selected-folder/subfolder/file.txt"
    // We want to preserve: "subfolder/file.txt"
    const parts = fullPath.split('/');
    if (parts.length > 1) {
      // Remove first part (selected folder name)
      return parts.slice(1).join('/');
    }
    return fullPath;
  }

  /**
   * Detect programming language from file extension
   */
  private detectLanguage(filename: string): string {
    const extension = filename.split('.').pop()?.toLowerCase() || '';
    
    const languageMap: Record<string, string> = {
      js: 'javascript',
      jsx: 'jsx',
      ts: 'typescript',
      tsx: 'tsx',
      py: 'python',
      java: 'java',
      cpp: 'cpp',
      c: 'c',
      h: 'c',
      hpp: 'cpp',
      html: 'html',
      htm: 'html',
      css: 'css',
      scss: 'scss',
      sass: 'sass',
      less: 'less',
      json: 'json',
      md: 'markdown',
      markdown: 'markdown',
      yml: 'yaml',
      yaml: 'yaml',
      xml: 'xml',
      php: 'php',
      rb: 'ruby',
      go: 'go',
      rs: 'rust',
      swift: 'swift',
      kt: 'kotlin',
      kts: 'kotlin',
      dart: 'dart',
      vue: 'vue',
      svelte: 'svelte',
      sh: 'shell',
      bash: 'shell',
      zsh: 'shell',
      txt: 'text',
      sql: 'sql',
      graphql: 'graphql',
      gql: 'graphql',
      dockerfile: 'dockerfile',
      makefile: 'makefile',
      tf: 'terraform',
      tfvars: 'terraform',
      env: 'dotenv',
    };

    return languageMap[extension] || 'text';
  }

  /**
   * Format file size for human-readable messages
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
   * Get import folder suggestions based on existing imports
   */
  async getSuggestedFolderName(ownerId: string, scopePath: string): Promise<string> {
    const timestamp = new Date().toISOString().slice(0, 10);
    const baseName = `imports-${timestamp}`;
    
    try {
      // Check if folder already exists
      const normalizedScope = normalizeScopePath(scopePath);
      const listing = await this.vfs.listDirectory(ownerId, normalizedScope);
      
      const existingImports = listing.nodes
        .filter(node => node.type === 'directory' && node.name.startsWith('imports-'))
        .map(node => node.name);

      if (existingImports.includes(baseName)) {
        // Add counter if folder exists
        let counter = 1;
        while (existingImports.includes(`${baseName}-${counter}`)) {
          counter++;
        }
        return `${baseName}-${counter}`;
      }

      return baseName;
    } catch {
      return baseName;
    }
  }
}

// Singleton instance for convenience - lazily initialized
let importServiceInstance: FileImportService | undefined;

export async function getFileImportService(vfs?: VFSWriteable): Promise<FileImportService> {
  if (!importServiceInstance) {
    // Lazy load to avoid circular dependencies and bundling in client
    const { virtualFilesystem } = await import('./virtual-filesystem-service');
    importServiceInstance = new FileImportService(vfs || virtualFilesystem);
  }
  return importServiceInstance;
}
