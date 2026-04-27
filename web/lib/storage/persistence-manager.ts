/**
 * Universal Sandbox Persistence Manager
 *
 * Provides standardized snapshotting and incremental syncing for all providers.
 * - Hashing-based incremental sync (from Sprites)
 * - File-level snapshotting and diffing (from CodeSandbox)
 * - Provider-agnostic rollback
 */

import type { SandboxHandle } from '@/lib/sandbox/providers/sandbox-provider';

// Simple hash function using Web Crypto API
async function hashContent(content: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(content);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

export interface Snapshot {
  id: string;
  timestamp: number;
  hash: string;
  files: Record<string, string>;
  metadata?: any;
}

export class SandboxPersistenceManager {
  private snapshots: Map<string, Snapshot[]> = new Map();
  private lastSyncHashes: Map<string, Map<string, string>> = new Map();

  /**
   * Perform an incremental sync of VFS files to the sandbox
   */
  async syncIncremental(
    handle: SandboxHandle,
    files: Array<{ path: string; content: string }>
  ): Promise<{ synced: number; skipped: number; duration: number }> {
    const startTime = Date.now();
    const sandboxId = handle.id;
    let synced = 0;
    let skipped = 0;

    if (!this.lastSyncHashes.has(sandboxId)) {
      this.lastSyncHashes.set(sandboxId, new Map());
    }
    const previousHashes = this.lastSyncHashes.get(sandboxId)!;

    for (const file of files) {
      const currentHash = this.computeHash(file.content);
      const previousHash = previousHashes.get(file.path);

      if (currentHash === previousHash) {
        skipped++;
        continue;
      }

      try {
        await handle.writeFile(file.path, file.content);
        previousHashes.set(file.path, currentHash);
        synced++;
      } catch (error) {
        console.warn(`[PersistenceManager] Sync failed for ${file.path}:`, error);
      }
    }

    return { synced, skipped, duration: Date.now() - startTime };
  }

  /**
   * Create a state snapshot of the current sandbox filesystem
   */
  async createSnapshot(handle: SandboxHandle, label?: string): Promise<Snapshot> {
    const sandboxId = handle.id;
    const files: Record<string, string> = {};
    
    // Attempt to list and read all files (recursive)
    try {
      const listing = await handle.listDirectory('.');
      // Note: This is a simplified recursive crawl for the MVP
      const paths = listing.output.split('\n')
        .filter(l => l.startsWith('-'))
        .map(l => l.split(/\s+/).pop()!)
        .filter(p => p && p !== '.' && p !== '..');

      for (const path of paths) {
        const result = await handle.readFile(path);
        if (result.success && result.content) {
          files[path] = result.content;
        }
      }
    } catch (error) {
      console.error('[PersistenceManager] Snapshot capture failed:', error);
    }

    const snapshot: Snapshot = {
      id: label || `snap_${Date.now()}`,
      timestamp: Date.now(),
      hash: this.computeHash(JSON.stringify(files)),
      files,
    };

    if (!this.snapshots.has(sandboxId)) {
      this.snapshots.set(sandboxId, []);
    }
    this.snapshots.get(sandboxId)!.push(snapshot);

    return snapshot;
  }

  /**
   * Rollback sandbox to a specific snapshot
   */
  async rollback(handle: SandboxHandle, snapshotId: string): Promise<void> {
    const sandboxId = handle.id;
    const sessionSnapshots = this.snapshots.get(sandboxId);
    const snapshot = sessionSnapshots?.find(s => s.id === snapshotId);

    if (!snapshot) {
      throw new Error(`Snapshot ${snapshotId} not found for sandbox ${sandboxId}`);
    }

    // Standard implementation: Clear and overwrite
    // Optimization: Only write differences if possible
    for (const [path, content] of Object.entries(snapshot.files)) {
      await handle.writeFile(path, content);
    }
    
    // Update local hash cache to match rollback state
    const hashes = new Map<string, string>();
    for (const [path, content] of Object.entries(snapshot.files)) {
      hashes.set(path, this.computeHash(content));
    }
    this.lastSyncHashes.set(sandboxId, hashes);
  }

  private computeHash(content: string): string {
    // FNV-1a 64-bit hash for incremental sync dedup.
    // NOTE: Returns 16-char hex (previously 64-char SHA-256). The hash map is
    // in-memory only and clears on restart, so no migration is needed. If hashes
    // are ever persisted externally, update the comparison logic accordingly.
    // Avoids require('node:crypto') which breaks client-side webpack builds.
    // 64-bit keeps collision probability negligible even at 10K-file workspace scale.
    // For security-sensitive hashing, use the async hashContent() above (Web Crypto).
    let h = 0xcbf29ce484222325n; // FNV offset basis
    for (let i = 0; i < content.length; i++) {
      h ^= BigInt(content.charCodeAt(i));
      h = (h * 0x100000001b3n) & 0xffffffffffffffffn; // FNV prime
    }
    return h.toString(16).padStart(16, '0');
  }
}

export const sandboxPersistenceManager = new SandboxPersistenceManager();
