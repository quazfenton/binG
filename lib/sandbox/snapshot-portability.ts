/**
 * Phase 3: Cross-Provider Snapshot Portability
 * 
 * Enables snapshot/checkpoint migration between providers:
 * - Export snapshot from one provider (Sprites, CodeSandbox)
 * - Convert to portable format
 * - Import to different provider
 * - VFS sync after migration
 * 
 * Use Cases:
 * - Cost optimization (create on Sprites, run on Daytona)
 * - Provider failover (migrate when provider over quota)
 * - Multi-cloud redundancy
 * - Development → Production migration
 * 
 * @see lib/sandbox/auto-snapshot-service.ts - Snapshot creation
 * @see lib/sandbox/vfs-sync-back.ts - VFS synchronization
 * 
 * @example
 * ```typescript
 * import { snapshotPortability } from '@/lib/sandbox/phase3-integration';
 * 
 * // Export snapshot from Sprites
 * const exported = await snapshotPortability.exportSnapshot(spriteSessionId);
 * 
 * // Import to CodeSandbox
 * const imported = await snapshotPortability.importSnapshot(exported, 'codesandbox');
 * 
 * // Migrate session (export + import + VFS sync)
 * const result = await snapshotPortability.migrateSession(sessionId, 'codesandbox');
 * ```
 */

import { getSandboxProvider, type SandboxProviderType } from './providers';
import { getTerminalSession, updateTerminalSession } from './terminal-session-store';
import { createLogger } from '../utils/logger';
import { vfsSyncBackService } from './vfs-sync-back';

const logger = createLogger('Phase3:SnapshotPortability');

/**
 * Portable snapshot format
 */
export interface PortableSnapshot {
  /** Snapshot ID */
  id: string;
  
  /** Source provider */
  sourceProvider: SandboxProviderType;
  
  /** Source sandbox ID */
  sourceSandboxId: string;
  
  /** User ID */
  userId: string;
  
  /** Creation timestamp */
  createdAt: number;
  
  /** Snapshot metadata */
  metadata: {
    name?: string;
    description?: string;
    fileCount?: number;
    totalSize?: number;
    environment?: Record<string, string>;
  };
  
  /** File system snapshot */
  files: Array<{
    path: string;
    content: string;
    mode?: number;
    lastModified: number;
  }>;
  
  /** Checksum for verification */
  checksum: string;
}

/**
 * Migration result
 */
export interface MigrationResult {
  success: boolean;
  targetSessionId?: string;
  targetSandboxId?: string;
  filesMigrated: number;
  duration: number;
  error?: string;
}

/**
 * Snapshot Portability
 */
export class SnapshotPortability {
  /**
   * Export snapshot to portable format
   */
  async exportSnapshot(sessionId: string): Promise<PortableSnapshot> {
    const session = getTerminalSession(sessionId);
    
    if (!session) {
      throw new Error(`Session ${sessionId} not found`);
    }
    
    try {
      const provider = await getSandboxProvider(this.inferProviderType(session.sandboxId));
      const handle = await provider.getSandbox(session.sandboxId);
      
      // List files in sandbox
      const listResult = await handle.listDirectory(session.cwd || '/workspace');
      
      if (!listResult.success) {
        throw new Error('Failed to list directory');
      }
      
      // Read all files
      const files: PortableSnapshot['files'] = [];
      const fileLines = listResult.output.split('\n').filter(line => line.trim());
      
      for (const line of fileLines) {
        const parts = line.trim().split(/\s+/);
        const fileName = parts[parts.length - 1];
        
        if (fileName === '.' || fileName === '..') continue;
        
        const readResult = await handle.readFile(fileName);
        if (readResult.success && readResult.output !== undefined) {
          files.push({
            path: fileName,
            content: readResult.output,
            lastModified: Date.now(),
          });
        }
      }
      
      // Calculate checksum
      const checksum = await this.calculateChecksum(files);
      
      // Get environment variables
      const envResult = await handle.executeCommand('env');
      const environment = this.parseEnvVars(envResult.output || '');
      
      const snapshot: PortableSnapshot = {
        id: `snapshot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        sourceProvider: this.inferProviderType(session.sandboxId),
        sourceSandboxId: session.sandboxId,
        userId: session.userId,
        createdAt: Date.now(),
        metadata: {
          name: session.lastSnapshotId ? `snapshot-${session.lastSnapshotId.slice(0, 8)}` : undefined,
          fileCount: files.length,
          totalSize: files.reduce((sum, f) => sum + f.content.length, 0),
          environment,
        },
        files,
        checksum,
      };
      
      logger.info(`Exported snapshot with ${files.length} files from ${snapshot.sourceProvider}`);
      
      return snapshot;
    } catch (error: any) {
      logger.error('Snapshot export failed:', error);
      throw error;
    }
  }
  
  /**
   * Import portable snapshot to target provider
   */
  async importSnapshot(
    snapshot: PortableSnapshot,
    targetProvider: SandboxProviderType
  ): Promise<{ sessionId: string; sandboxId: string }> {
    try {
      // Create new sandbox on target provider
      const provider = await getSandboxProvider(targetProvider);
      const handle = await provider.createSandbox({
        language: 'typescript',
        envVars: snapshot.metadata.environment,
      });
      
      logger.info(`Created target sandbox ${handle.id} on ${targetProvider}`);
      
      // Write all files
      let filesWritten = 0;
      for (const file of snapshot.files) {
        await handle.writeFile(file.path, file.content);
        filesWritten++;
      }
      
      logger.info(`Imported ${filesWritten} files to target sandbox`);
      
      // Create session record
      const { randomUUID } = await import('crypto');
      const sessionId = `user-${snapshot.userId}-${Date.now()}-${randomUUID().slice(0, 8)}`;
      
      const { saveTerminalSession } = await import('./terminal-session-store');
      saveTerminalSession({
        sessionId,
        sandboxId: handle.id,
        userId: snapshot.userId,
        providerType: targetProvider,
        mode: 'pty',
        cwd: '/workspace',
        cols: 120,
        rows: 30,
        lastActive: Date.now(),
        history: [],
        metadata: {
          importedFrom: {
            provider: snapshot.sourceProvider,
            sandboxId: snapshot.sourceSandboxId,
            snapshotId: snapshot.id,
          },
        },
      });
      
      return { sessionId, sandboxId: handle.id };
    } catch (error: any) {
      logger.error('Snapshot import failed:', error);
      throw error;
    }
  }
  
  /**
   * Migrate session to different provider
   */
  async migrateSession(
    sessionId: string,
    targetProvider: SandboxProviderType,
    options?: { syncVFS?: boolean; vfsScopePath?: string }
  ): Promise<MigrationResult> {
    const startTime = Date.now();
    
    try {
      // Export from source
      const snapshot = await this.exportSnapshot(sessionId);
      
      // Import to target
      const { sessionId: newSessionId, sandboxId: newSandboxId } = await this.importSnapshot(
        snapshot,
        targetProvider
      );
      
      // Sync to VFS if requested
      let filesMigrated = snapshot.files.length;
      if (options?.syncVFS && options.vfsScopePath) {
        const syncResult = await vfsSyncBackService.syncSandboxToVFS(newSessionId, {
          vfsScopePath: options.vfsScopePath,
          syncMode: 'full',
        });
        
        if (syncResult.success) {
          filesMigrated = syncResult.filesSynced;
        }
      }
      
      logger.info(`Migrated session from ${snapshot.sourceProvider} to ${targetProvider}`);
      
      return {
        success: true,
        targetSessionId: newSessionId,
        targetSandboxId: newSandboxId,
        filesMigrated,
        duration: Date.now() - startTime,
      };
    } catch (error: any) {
      logger.error('Migration failed:', error);
      return {
        success: false,
        filesMigrated: 0,
        duration: Date.now() - startTime,
        error: error?.message || 'Migration failed',
      };
    }
  }
  
  /**
   * Verify snapshot integrity
   */
  async verifySnapshot(snapshot: PortableSnapshot): Promise<{ valid: boolean; error?: string }> {
    try {
      const checksum = await this.calculateChecksum(snapshot.files);
      
      if (checksum !== snapshot.checksum) {
        return {
          valid: false,
          error: 'Checksum mismatch - snapshot may be corrupted',
        };
      }
      
      return { valid: true };
    } catch (error: any) {
      return {
        valid: false,
        error: error?.message || 'Verification failed',
      };
    }
  }
  
  /**
   * Calculate checksum for files
   */
  private async calculateChecksum(
    files: Array<{ path: string; content: string }>
  ): Promise<string> {
    // Simple hash - in production, use crypto.createHash('sha256')
    let hash = 0;
    
    for (const file of files.sort((a, b) => a.path.localeCompare(b.path))) {
      for (let i = 0; i < file.content.length; i++) {
        const char = file.content.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
      }
    }
    
    return hash.toString(36);
  }
  
  /**
   * Parse environment variables from env command output
   */
  private parseEnvVars(envOutput: string): Record<string, string> {
    const env: Record<string, string> = {};
    
    for (const line of envOutput.split('\n')) {
      const [key, ...valueParts] = line.split('=');
      if (key && valueParts.length > 0) {
        env[key.trim()] = valueParts.join('=').trim();
      }
    }
    
    return env;
  }
  
  /**
   * Infer provider type from sandbox ID
   */
  private inferProviderType(sandboxId: string): SandboxProviderType {
    if (sandboxId.startsWith('mistral-')) return 'mistral';
    if (sandboxId.startsWith('blaxel-mcp-')) return 'blaxel-mcp';
    if (sandboxId.startsWith('blaxel-')) return 'blaxel';
    if (sandboxId.startsWith('sprite-') || sandboxId.startsWith('bing-')) return 'sprites';
    if (sandboxId.startsWith('webcontainer-')) return 'webcontainer';
    if (sandboxId.startsWith('wc-fs-')) return 'webcontainer-filesystem';
    if (sandboxId.startsWith('wc-spawn-')) return 'webcontainer-spawn';
    if (sandboxId.startsWith('osb-ci-')) return 'opensandbox-code-interpreter';
    if (sandboxId.startsWith('osb-agent-')) return 'opensandbox-agent';
    if (sandboxId.startsWith('opensandbox-') || sandboxId.startsWith('osb-')) return 'opensandbox';
    if (sandboxId.startsWith('csb-') || sandboxId.length === 6) return 'codesandbox';
    if (sandboxId.startsWith('e2b-')) return 'e2b';
    return 'daytona';
  }
}

/**
 * Singleton instance
 */
export const snapshotPortability = new SnapshotPortability();

/**
 * Convenience functions
 */
export const exportSnapshot = (sessionId: string) =>
  snapshotPortability.exportSnapshot(sessionId);

export const importSnapshot = (snapshot: PortableSnapshot, targetProvider: SandboxProviderType) =>
  snapshotPortability.importSnapshot(snapshot, targetProvider);

export const migrateSession = (sessionId: string, targetProvider: SandboxProviderType, options?: { syncVFS?: boolean; vfsScopePath?: string }) =>
  snapshotPortability.migrateSession(sessionId, targetProvider, options);

export const verifySnapshot = (snapshot: PortableSnapshot) =>
  snapshotPortability.verifySnapshot(snapshot);
