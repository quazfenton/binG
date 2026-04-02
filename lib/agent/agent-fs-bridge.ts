/**
 * VFS ↔ Sandbox Bridge
 *
 * Bidirectional synchronization between Virtual Filesystem and OpenSandbox workspace.
 * Ensures user's VFS files are available in sandbox and changes are synced back.
 */

import { virtualFilesystem } from '../virtual-filesystem/virtual-filesystem-service';
import { agentSessionManager } from '../session/agent/agent-session-manager';
import { normalizeSessionId } from '../virtual-filesystem/scope-utils';
import { createLogger } from '../utils/logger';
import { emitFilesystemUpdated } from '../virtual-filesystem/sync/sync-events';

const logger = createLogger('Agent:FSBridge');

export interface SyncResult {
  success: boolean;
  syncedFiles: string[];
  errors: string[];
  duration: number;
}

export interface SyncOptions {
  direction: 'to-sandbox' | 'from-sandbox' | 'bidirectional';
  includePatterns?: string[];
  excludePatterns?: string[];
}

class AgentFSBridge {
  /**
   * Sync VFS to sandbox workspace
   */
  async syncToSandbox(
    userId: string,
    conversationId: string,
    options: SyncOptions = { direction: 'to-sandbox' },
  ): Promise<SyncResult> {
    const startTime = Date.now();
    const syncedFiles: string[] = [];
    const errors: string[] = [];

    try {
      const session = await agentSessionManager.getOrCreateSession(userId, conversationId);
      // CRITICAL FIX: Normalize conversationId to prevent composite IDs in paths
      const simpleSessionId = normalizeSessionId(conversationId) || conversationId; // Use original if normalize returns empty
      const vfsPath = `project/sessions/${simpleSessionId}`;
      const sandboxPath = session.workspacePath;

      logger.debug(`Syncing VFS → Sandbox: ${vfsPath} → ${sandboxPath}`);

      // Export VFS snapshot
      const snapshot = await virtualFilesystem.exportWorkspace(userId);
      
      // Filter files by session path
      const sessionFiles = snapshot.files.filter(f => 
        f.path.startsWith(vfsPath) && this.shouldIncludeFile(f.path, options)
      );

      logger.info(`Syncing ${sessionFiles.length} files to sandbox`);

      // Sync each file to sandbox
      for (const file of sessionFiles) {
        try {
          const relativePath = file.path.replace('project/', '');
          const sandboxFilePath = `${sandboxPath}/${relativePath}`;
          
          await session.sandboxHandle.writeFile(sandboxFilePath, file.content);
          syncedFiles.push(file.path);
          
          logger.debug(`Synced: ${file.path}`);
        } catch (error: any) {
          errors.push(`Failed to sync ${file.path}: ${error.message}`);
          logger.warn(`Failed to sync ${file.path}`, error);
        }
      }

      const duration = Date.now() - startTime;
      logger.info(`VFS → Sandbox sync complete: ${syncedFiles.length} files in ${duration}ms`);

      return {
        success: errors.length === 0,
        syncedFiles,
        errors,
        duration,
      };

    } catch (error: any) {
      logger.error('VFS → Sandbox sync failed', error);
      return {
        success: false,
        syncedFiles: [],
        errors: [error.message],
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Sync sandbox workspace to VFS
   */
  async syncFromSandbox(
    userId: string,
    conversationId: string,
    options: SyncOptions = { direction: 'from-sandbox' },
  ): Promise<SyncResult> {
    const startTime = Date.now();
    const syncedFiles: string[] = [];
    const errors: string[] = [];

    try {
      const session = await agentSessionManager.getOrCreateSession(userId, conversationId);
      // CRITICAL FIX: Normalize conversationId to prevent composite IDs in paths
      const simpleSessionId = normalizeSessionId(conversationId) || conversationId; // Use original if normalize returns empty
      const vfsPath = `project/sessions/${simpleSessionId}`;
      const sandboxPath = session.workspacePath;

      logger.debug(`Syncing Sandbox → VFS: ${sandboxPath} → ${vfsPath}`);

      // Get list of files in sandbox workspace
      const listResult = await session.sandboxHandle.executeCommand(
        `find ${sandboxPath} -type f -name "*.ts" -o -name "*.tsx" -o -name "*.js" -o -name "*.jsx" -o -name "*.json" -o -name "*.md" -o -name "*.py" -o -name "*.html" -o -name "*.css"`,
      );

      if (!listResult.success) {
        throw new Error(`Failed to list sandbox files: ${listResult.output}`);
      }

      const sandboxFiles = listResult.output.split('\n').filter(Boolean);
      
      logger.info(`Found ${sandboxFiles.length} files in sandbox`);

      // Sync each file from sandbox to VFS
      for (const sandboxFile of sandboxFiles) {
        try {
          if (!this.shouldIncludeFile(sandboxFile, options)) {
            continue;
          }

          const readResult = await session.sandboxHandle.readFile(sandboxFile);
          
          if (!readResult.success) {
            errors.push(`Failed to read ${sandboxFile}: ${readResult.output}`);
            continue;
          }

          const relativePath = sandboxFile.replace(`${sandboxPath}/`, '');
          const vfsFilePath = `${vfsPath}/${relativePath}`;

          await virtualFilesystem.writeFile(userId, vfsFilePath, readResult.output);
          syncedFiles.push(sandboxFile);
          
          logger.debug(`Synced: ${sandboxFile} → ${vfsFilePath}`);
        } catch (error: any) {
          errors.push(`Failed to sync ${sandboxFile}: ${error.message}`);
          logger.warn(`Failed to sync ${sandboxFile}`, error);
        }
      }

      const duration = Date.now() - startTime;
      logger.info(`Sandbox → VFS sync complete: ${syncedFiles.length} files in ${duration}ms`);

      // CRITICAL FIX Bug #3: Emit filesystem-updated event after V2 sandbox sync
      // This ensures components update after V2 agent writes files
      if (syncedFiles.length > 0) {
        emitFilesystemUpdated({
          scopePath: vfsPath,
          sessionId: simpleSessionId,
          paths: syncedFiles,
          type: 'update',
          source: 'v2-agent',
        });
      }

      return {
        success: errors.length === 0,
        syncedFiles,
        errors,
        duration,
      };

    } catch (error: any) {
      logger.error('Sandbox → VFS sync failed', error);
      return {
        success: false,
        syncedFiles: [],
        errors: [error.message],
        duration: Date.now() - startTime,
      };
    }
  }

  /**
   * Bidirectional sync
   */
  async syncBidirectional(
    userId: string,
    conversationId: string,
    options?: Partial<SyncOptions>,
  ): Promise<{ toSandbox: SyncResult; fromSandbox: SyncResult }> {
    logger.info(`Starting bidirectional sync for ${userId}:${conversationId}`);

    const toSandbox = await this.syncToSandbox(userId, conversationId, {
      direction: 'to-sandbox',
      ...options,
    });

    const fromSandbox = await this.syncFromSandbox(userId, conversationId, {
      direction: 'from-sandbox',
      ...options,
    });

    logger.info(`Bidirectional sync complete: ${toSandbox.syncedFiles.length + fromSandbox.syncedFiles.length} total files`);

    return { toSandbox, fromSandbox };
  }

  /**
   * Watch for changes and sync in real-time
   */
  async watchAndSync(
    userId: string,
    conversationId: string,
    intervalMs: number = 5000,
  ): Promise<() => void> {
    let watching = true;
    let lastSyncTime = Date.now();

    const watchInterval = setInterval(async () => {
      if (!watching) {
        clearInterval(watchInterval);
        return;
      }

      try {
        const session = agentSessionManager.getSession(userId, conversationId);
        if (!session || session.state === 'idle') {
          return; // Skip sync if session doesn't exist or is idle
        }

        // Sync in both directions
        await this.syncBidirectional(userId, conversationId);
        lastSyncTime = Date.now();
        
        logger.debug(`Auto-sync complete for ${userId}:${conversationId}`);
      } catch (error: any) {
        logger.warn(`Auto-sync failed for ${userId}:${conversationId}`, error);
      }
    }, intervalMs);

    logger.info(`Started watching ${userId}:${conversationId} (interval: ${intervalMs}ms)`);

    // Return cleanup function
    return () => {
      watching = false;
      clearInterval(watchInterval);
      logger.info(`Stopped watching ${userId}:${conversationId}`);
    };
  }

  /**
   * Check if file should be included based on patterns
   */
  private shouldIncludeFile(filePath: string, options: SyncOptions): boolean {
    // Check exclude patterns first
    if (options.excludePatterns) {
      for (const pattern of options.excludePatterns) {
        if (this.matchesPattern(filePath, pattern)) {
          return false;
        }
      }
    }

    // Check include patterns
    if (options.includePatterns) {
      for (const pattern of options.includePatterns) {
        if (this.matchesPattern(filePath, pattern)) {
          return true;
        }
      }
      // If include patterns specified but no match, exclude
      return false;
    }

    return true;
  }

  /**
   * Simple glob pattern matching
   */
  private matchesPattern(filePath: string, pattern: string): boolean {
    // Convert glob to regex
    const regexPattern = pattern
      .replace(/\./g, '\\.')
      .replace(/\*/g, '.*')
      .replace(/\?/g, '.');
    
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(filePath);
  }
}

// Singleton instance
export const agentFSBridge = new AgentFSBridge();

// Export for testing
export { AgentFSBridge };
