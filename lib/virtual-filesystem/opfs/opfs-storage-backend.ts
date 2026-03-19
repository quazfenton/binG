/**
 * OPFS Storage Backend
 * 
 * Implements VFS persistence interface using OPFS
 * Allows VirtualFilesystemService to use OPFS as storage backend
 */

import { opfsCore, type OPFSCore } from './opfs-core';
import type { VirtualFile } from '../filesystem-types';

export interface WorkspaceState {
  files: Map<string, VirtualFile>;
  version: number;
  updatedAt: string;
  loaded: boolean;
}

export interface VFSStorageBackend {
  loadWorkspace(ownerId: string): Promise<WorkspaceState>;
  saveWorkspace(ownerId: string, state: WorkspaceState): Promise<void>;
  deleteWorkspace(ownerId: string): Promise<void>;
  workspaceExists(ownerId: string): Promise<boolean>;
  listWorkspaces(): Promise<string[]>;
}

/**
 * OPFS Storage Backend Implementation
 * 
 * Uses OPFS as the primary storage mechanism for VFS data.
 * Provides fast local persistence with optional server sync.
 */
export class OPFSStorageBackend implements VFSStorageBackend {
  private core: OPFSCore;
  private initializedWorkspaces = new Set<string>();
  private metadataFile = '.vfs-metadata.json';

  constructor(core?: OPFSCore) {
    this.core = core || opfsCore;
  }

  /**
   * Load workspace state from OPFS
   */
  async loadWorkspace(ownerId: string): Promise<WorkspaceState> {
    try {
      // Initialize OPFS for this workspace
      await this.core.initialize(ownerId);
      this.initializedWorkspaces.add(ownerId);

      const files = new Map<string, VirtualFile>();
      let version = 0;
      let updatedAt = new Date().toISOString();

      // Try to load metadata
      try {
        const metadataContent = await this.core.readFile(this.metadataFile);
        const metadata = JSON.parse(metadataContent.content);
        version = metadata.version || 0;
        updatedAt = metadata.updatedAt || updatedAt;
      } catch {
        // No metadata file, start fresh
      }

      // Walk directory tree and load all files
      await this.loadFilesRecursive('', files);

      console.log('[OPFS Storage] Loaded workspace:', ownerId, 'files:', files.size, 'version:', version);

      return {
        files,
        version,
        updatedAt,
        loaded: true,
      };
    } catch (error) {
      console.error('[OPFS Storage] Failed to load workspace:', error);
      
      // Return empty workspace on error
      return {
        files: new Map(),
        version: 0,
        updatedAt: new Date().toISOString(),
        loaded: false,
      };
    }
  }

  /**
   * Save workspace state to OPFS
   */
  async saveWorkspace(ownerId: string, state: WorkspaceState): Promise<void> {
    try {
      // Initialize OPFS for this workspace if not already done
      if (!this.initializedWorkspaces.has(ownerId)) {
        await this.core.initialize(ownerId);
        this.initializedWorkspaces.add(ownerId);
      }

      // Save metadata
      const metadata = {
        version: state.version,
        updatedAt: state.updatedAt,
        fileCount: state.files.size,
      };
      await this.core.writeFile(this.metadataFile, JSON.stringify(metadata, null, 2));

      // Save all files
      for (const [path, file] of state.files.entries()) {
        if (!file.isDirectoryMarker) {
          await this.core.writeFile(path, file.content);
        }
      }

      console.log('[OPFS Storage] Saved workspace:', ownerId, 'files:', state.files.size);
    } catch (error) {
      console.error('[OPFS Storage] Failed to save workspace:', error);
      throw error;
    }
  }

  /**
   * Delete workspace from OPFS
   */
  async deleteWorkspace(ownerId: string): Promise<void> {
    try {
      // Clear all data
      await this.core.clear();
      this.initializedWorkspaces.delete(ownerId);
      
      console.log('[OPFS Storage] Deleted workspace:', ownerId);
    } catch (error) {
      console.error('[OPFS Storage] Failed to delete workspace:', error);
      throw error;
    }
  }

  /**
   * Check if workspace exists
   */
  async workspaceExists(ownerId: string): Promise<boolean> {
    try {
      await this.core.initialize(ownerId);
      return await this.core.fileExists(this.metadataFile);
    } catch {
      return false;
    }
  }

  /**
   * List all workspaces
   * 
   * Note: This is limited in OPFS as we can't enumerate root directories.
   * Returns workspaces that have been initialized in this session.
   */
  async listWorkspaces(): Promise<string[]> {
    return Array.from(this.initializedWorkspaces);
  }

  /**
   * Check if OPFS is supported
   */
  static isSupported(): boolean {
    return typeof window !== 'undefined' &&
           'storage' in window &&
           typeof window.storage === 'object' && window.storage !== null &&
           'getDirectory' in window.storage;
  }

  // ========== Private Methods ==========

  private async loadFilesRecursive(
    path: string,
    files: Map<string, VirtualFile>
  ): Promise<void> {
    try {
      const entries = await this.core.listDirectory(path || '.');
      
      for (const entry of entries) {
        // Skip metadata file
        if (entry.name === this.metadataFile) {
          continue;
        }

        if (entry.type === 'file') {
          try {
            const fileData = await this.core.readFile(entry.path);
            
            files.set(entry.path, {
              path: entry.path,
              content: fileData.content,
              language: this.detectLanguage(entry.path),
              lastModified: new Date(entry.lastModified || Date.now()).toISOString(),
              version: 1,
              size: fileData.size,
            });
          } catch (error) {
            console.warn('[OPFS Storage] Failed to load file:', entry.path, error);
          }
        } else if (entry.type === 'directory' && !entry.name.startsWith('.')) {
          await this.loadFilesRecursive(entry.path, files);
        }
      }
    } catch (error: any) {
      if (error.name !== 'NotFoundError') {
        console.warn('[OPFS Storage] Failed to list directory:', path, error);
      }
    }
  }

  private detectLanguage(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    const languageMap: Record<string, string> = {
      ts: 'typescript',
      tsx: 'typescript',
      js: 'javascript',
      jsx: 'javascript',
      py: 'python',
      java: 'java',
      cs: 'csharp',
      cpp: 'cpp',
      c: 'c',
      go: 'go',
      rs: 'rust',
      rb: 'ruby',
      php: 'php',
      swift: 'swift',
      kt: 'kotlin',
      scala: 'scala',
      html: 'html',
      css: 'css',
      scss: 'scss',
      json: 'json',
      xml: 'xml',
      md: 'markdown',
      yaml: 'yaml',
      yml: 'yaml',
      sh: 'bash',
      sql: 'sql',
    };
    return languageMap[ext || ''] || 'text';
  }
}

// Singleton instance
export const opfsStorageBackend = new OPFSStorageBackend();
