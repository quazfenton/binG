/**
 * Snapshot Manager
 * Pure-TypeScript snapshot creation, restoration, and lifecycle management
 * with retry logic and optional remote storage backend support.
 * Migrated from ephemeral/snapshot_manager.py
 *
 * METRICS WIRED: All operations emit metrics
 */

import { EventEmitter } from 'node:events';
import { createReadStream, createWriteStream, mkdirSync, existsSync, statSync, unlinkSync, readdirSync, renameSync } from 'fs';
import { join, dirname, basename } from 'path';
import { pipeline } from 'stream/promises';
import * as zlib from 'zlib';
import { createGzip, createGunzip } from 'zlib';
import { pack, extract as unpack } from 'tar-stream';
import { randomBytes } from 'crypto';
import { sandboxMetrics } from '../../backend/metrics';

export interface RetryConfig {
  maxRetries: number;
  baseDelay: number; // ms
  maxDelay: number; // ms
  backoffMultiplier: number;
}

export interface SnapshotResult {
  snapshotId: string;
  path: string;
  sizeBytes: number;
  createdAt: Date;
}

export interface SnapshotInfo {
  snapshotId: string;
  sizeBytes: number;
  createdAt: Date;
  path: string;
}

export interface StorageBackend {
  upload(localPath: string, remoteKey: string): Promise<void>;
  download(remoteKey: string, localPath: string): Promise<boolean>;
  list(prefix: string): Promise<string[]>;
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxRetries: 3,
  baseDelay: 1000, // 1 second
  maxDelay: 30000, // 30 seconds
  backoffMultiplier: 2.0,
};

const VALID_ID_REGEX = /^[a-zA-Z0-9_-]+$/;

function validateId(value: string, label: string = 'ID'): void {
  if (!VALID_ID_REGEX.test(value)) {
    throw new Error(
      `Invalid ${label} format: '${value}'. Only alphanumeric characters, underscores, and hyphens are allowed.`
    );
  }
}

async function withRetry<T>(
  func: () => Promise<T>,
  config: RetryConfig = DEFAULT_RETRY_CONFIG,
  operationName: string = 'operation'
): Promise<T> {
  let lastError: Error | null = null;
  let delay = config.baseDelay;

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    try {
      console.log(`${operationName}: attempt ${attempt}/${config.maxRetries}`);
      return await func();
    } catch (error: any) {
      lastError = error;
      if (attempt === config.maxRetries) {
        console.error(`${operationName}: failed after ${config.maxRetries} attempts: ${error.message}`);
        throw error;
      }
      console.warn(
        `${operationName}: attempt ${attempt} failed (${error.message}), retrying in ${(delay / 1000).toFixed(1)}s`
      );
      await new Promise(resolve => setTimeout(resolve, delay));
      delay = Math.min(delay * config.backoffMultiplier, config.maxDelay);
    }
  }

  throw lastError;
}

export class SnapshotManager extends EventEmitter {
  private readonly workspaceDir: string;
  private readonly snapshotDir: string;
  private readonly storageBackend?: StorageBackend;

  constructor(
    workspaceDir: string = '/srv/workspaces',
    snapshotDir: string = '/srv/snapshots',
    storageBackend?: StorageBackend
  ) {
    super();
    this.workspaceDir = workspaceDir;
    this.snapshotDir = snapshotDir;
    this.storageBackend = storageBackend;
  }

  private userWorkspace(userId: string): string {
    validateId(userId, 'user_id');
    return join(this.workspaceDir, userId);
  }

  private snapshotPath(userId: string, snapshotId: string): string {
    validateId(userId, 'user_id');
    validateId(snapshotId, 'snapshot_id');
    return join(this.snapshotDir, userId, `${snapshotId}.tar.gz`);
  }

  private generateSnapshotId(): string {
    const now = new Date();
    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const day = String(now.getDate()).padStart(2, '0');
    const hours = String(now.getHours()).padStart(2, '0');
    const minutes = String(now.getMinutes()).padStart(2, '0');
    const seconds = String(now.getSeconds()).padStart(2, '0');
    return `snap_${year}_${month}_${day}_${hours}${minutes}${seconds}`;
  }

  async createSnapshot(
    userId: string,
    snapshotId?: string,
    retryConfig?: RetryConfig
  ): Promise<SnapshotResult> {
    validateId(userId, 'user_id');
    snapshotId = snapshotId || this.generateSnapshotId();
    validateId(snapshotId, 'snapshot_id');

    const startTime = Date.now();
    sandboxMetrics.snapshotCreatedTotal.inc({ status: 'started' });

    const workspace = this.userWorkspace(userId);
    if (!existsSync(workspace)) {
      sandboxMetrics.snapshotCreatedTotal.inc({ status: 'workspace_not_found' });
      throw new Error(`Workspace not found: ${workspace}`);
    }

    const snapshotPath = this.snapshotPath(userId, snapshotId);
    mkdirSync(dirname(snapshotPath), { recursive: true });

    const compress = async () => {
      await this.compressWorkspace(workspace, snapshotPath, userId);
    };

    await withRetry(compress, retryConfig, `create_snapshot(${userId}/${snapshotId})`);

    const stat = statSync(snapshotPath);
    const result: SnapshotResult = {
      snapshotId,
      path: snapshotPath,
      sizeBytes: stat.size,
      createdAt: new Date(stat.mtime),
    };

    const duration = (Date.now() - startTime) / 1000;

    console.log(`Snapshot created: ${snapshotPath} (${result.sizeBytes} bytes)`);
    this.emit('snapshot_created', result);
    sandboxMetrics.snapshotCreatedTotal.inc({ status: 'success' }, 1);
    sandboxMetrics.snapshotSizeBytes.observe(result.sizeBytes);
    sandboxMetrics.snapshotCreationDuration.observe(duration, { userId });

    // Upload to remote storage backend if available
    if (this.storageBackend) {
      try {
        const remoteKey = `${userId}/${snapshotId}.tar.gz`;
        await this.storageBackend.upload(snapshotPath, remoteKey);
        console.log(`[SnapshotManager] Uploaded to storage: ${remoteKey}`);
      } catch (uploadError: any) {
        console.warn('[SnapshotManager] Upload to storage failed:', uploadError.message);
      }
    }

    return result;
  }

  private async compressWorkspace(workspace: string, dest: string, userId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const packer = pack();
      const gzip = createGzip();
      const output = createWriteStream(dest);

      pipeline(packer, gzip, output)
        .then(resolve)
        .catch(reject);

      // Add files to tar (async to ensure all pipes complete before packer.end())
      this.addDirToTar(packer, workspace, userId).then(() => {
        packer.end();
      }).catch(reject);
    });
  }

  private async addDirToTar(packer: any, dir: string, userId: string): Promise<void> {
    const entries = readdirSync(dir, { withFileTypes: true });
    
    for (const entry of entries) {
      const fullPath = join(dir, entry.name);
      const relativePath = join(userId, fullPath.replace(dir, '').replace(/^[/\\]/, ''));
      
      if (entry.isDirectory()) {
        await this.addDirToTar(packer, fullPath, userId);
      } else {
        const stat = statSync(fullPath);
        await new Promise<void>((resolve, reject) => {
          const entryStream = packer.entry({ name: relativePath, size: stat.size }, (err: Error | null) => {
            if (err) reject(err);
            else resolve();
          });
          createReadStream(fullPath).pipe(entryStream);
        });
      }
    }
  }

  async restoreSnapshot(
    userId: string,
    snapshotId: string,
    retryConfig?: RetryConfig
  ): Promise<boolean> {
    validateId(userId, 'user_id');
    validateId(snapshotId, 'snapshot_id');

    const startTime = Date.now();
    sandboxMetrics.snapshotRestoredTotal.inc({ status: 'started' });

    const snapshotPath = this.snapshotPath(userId, snapshotId);
    if (!existsSync(snapshotPath)) {
      sandboxMetrics.snapshotRestoredTotal.inc({ status: 'not_found' });
      throw new Error(`Snapshot not found: ${snapshotPath}`);
    }

    const workspace = this.userWorkspace(userId);

    const extract = async () => {
      await this.extractSnapshot(snapshotPath, workspace, userId);
    };

    await withRetry(extract, retryConfig, `restore_snapshot(${userId}/${snapshotId})`);

    const duration = (Date.now() - startTime) / 1000;

    console.log(`Snapshot restored: ${snapshotPath} -> ${workspace}`);
    this.emit('snapshot_restored', { userId, snapshotId });
    sandboxMetrics.snapshotRestoredTotal.inc({ status: 'success' }, 1);
    sandboxMetrics.snapshotRestorationDuration.observe(duration, { userId });

    return true;
  }

  private async extractSnapshot(snapshotPath: string, workspace: string, userId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const workspaceParent = dirname(workspace);
      const tempDir = join(workspaceParent, `tmp_restore_${Date.now()}`);
      
      mkdirSync(tempDir, { recursive: true });

      const extractor = unpack();
      const gunzip = createGunzip();
      const input = createReadStream(snapshotPath);

      extractor.on('entry', (header: any, stream: any, next: any) => {
        // Path safety checks
        if (header.name.includes('..') || header.name.startsWith('/')) {
          console.warn(`Skipping unsafe path in archive: ${header.name}`);
          stream.resume();
          next();
          return;
        }

        // Ensure member is within expected archive root
        if (!header.name.startsWith(`${userId}/`) && header.name !== userId) {
          console.warn(`Skipping member outside expected archive root '${userId}': ${header.name}`);
          stream.resume();
          next();
          return;
        }

        // Calculate destination path
        const destPath = join(tempDir, header.name);
        
        // Check if destination is within temp directory (symlink attack prevention)
        const realDestPath = require('path').resolve(destPath);
        if (!realDestPath.startsWith(tempDir)) {
          console.warn(`Skipping path outside target directory (symlink attack?): ${header.name} -> ${realDestPath}`);
          stream.resume();
          next();
          return;
        }

        if (header.type === 'directory') {
          mkdirSync(destPath, { recursive: true });
          stream.resume();
        } else {
          mkdirSync(dirname(destPath), { recursive: true });
          stream.pipe(createWriteStream(destPath)).on('finish', next);
        }
      });

      extractor.on('finish', async () => {
        try {
          // Move contents from temp/userId to workspace
          const extractedContentRoot = join(tempDir, userId);
          if (existsSync(extractedContentRoot)) {
            const entries = readdirSync(extractedContentRoot);
            for (const entry of entries) {
              const src = join(extractedContentRoot, entry);
              const dest = join(workspace, entry);
              
              // Atomic replace
              if (existsSync(dest)) {
                renameSync(src, dest);
              } else {
                mkdirSync(dirname(dest), { recursive: true });
                renameSync(src, dest);
              }
            }
          }

          // Cleanup temp directory
          const { rm } = await import('fs/promises');
          await rm(tempDir, { recursive: true, force: true });

          resolve();
        } catch (error: any) {
          reject(error);
        }
      });

      pipeline(input, gunzip, extractor).catch(reject);
    });
  }

  async listSnapshots(userId: string): Promise<SnapshotInfo[]> {
    validateId(userId, 'user_id');
    const userSnapshotDir = join(this.snapshotDir, userId);
    
    const snapshots: SnapshotInfo[] = [];

    // Check local filesystem
    if (existsSync(userSnapshotDir)) {
      const entries = readdirSync(userSnapshotDir);
      for (const entry of entries) {
        if (entry.endsWith('.tar.gz')) {
          const path = join(userSnapshotDir, entry);
          const stat = statSync(path);
          snapshots.push({
            snapshotId: entry.replace('.tar.gz', ''),
            sizeBytes: stat.size,
            createdAt: new Date(stat.mtime),
            path,
          });
        }
      }
    }

    // If storage backend is available and no local snapshots found, check remote
    if (snapshots.length === 0 && this.storageBackend) {
      try {
        const remoteKeys = await this.storageBackend.list(`${userId}/`);
        for (const key of remoteKeys) {
          const filename = key.split('/').pop();
          if (filename?.endsWith('.tar.gz')) {
            snapshots.push({
              snapshotId: filename.replace('.tar.gz', ''),
              sizeBytes: 0,
              createdAt: new Date(),
              path: key,
            });
          }
        }
      } catch (error: any) {
        console.warn('[SnapshotManager] Failed to list remote snapshots:', error.message);
      }
    }

    snapshots.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return snapshots;
  }

  async deleteSnapshot(userId: string, snapshotId: string): Promise<boolean> {
    validateId(userId, 'user_id');
    validateId(snapshotId, 'snapshot_id');

    const snapshotPath = this.snapshotPath(userId, snapshotId);
    if (!existsSync(snapshotPath)) {
      console.warn(`Snapshot not found for deletion: ${snapshotPath}`);
      return false;
    }

    unlinkSync(snapshotPath);
    console.log(`Deleted snapshot: ${snapshotPath}`);
    this.emit('snapshot_deleted', { userId, snapshotId });

    return true;
  }

  async enforceRetention(userId: string, keepCount: number = 5): Promise<void> {
    const snapshots = await this.listSnapshots(userId);
    const toDelete = snapshots.slice(keepCount);

    for (const snap of toDelete) {
      await this.deleteSnapshot(userId, snap.snapshotId);
      console.log(`Retention: deleted ${userId}/${snap.snapshotId}`);
    }
  }

  async uploadToStorage(userId: string, snapshotId: string): Promise<void> {
    if (!this.storageBackend) {
      console.warn('No storage backend configured; skipping upload');
      return;
    }

    const snapshotPath = this.snapshotPath(userId, snapshotId);
    const remoteKey = `${userId}/${snapshotId}.tar.gz`;
    
    await this.storageBackend.upload(snapshotPath, remoteKey);
    console.log(`Uploaded snapshot to remote storage: ${remoteKey}`);
    this.emit('snapshot_uploaded', { userId, snapshotId, remoteKey });
  }

  async downloadFromStorage(userId: string, snapshotId: string): Promise<void> {
    if (!this.storageBackend) {
      console.warn('No storage backend configured; skipping download');
      return;
    }

    const snapshotPath = this.snapshotPath(userId, snapshotId);
    mkdirSync(dirname(snapshotPath), { recursive: true });
    
    const remoteKey = `${userId}/${snapshotId}.tar.gz`;
    const success = await this.storageBackend.download(remoteKey, snapshotPath);
    
    if (success) {
      console.log(`Downloaded snapshot from remote storage: ${remoteKey}`);
      this.emit('snapshot_downloaded', { userId, snapshotId, remoteKey });
    }
  }
}

// Singleton instance
export const snapshotManager = new SnapshotManager();
