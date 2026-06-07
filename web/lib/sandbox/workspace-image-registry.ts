/**
 * Phase 7: Workspace Image Registry
 *
 * Maps dependency file hashes (package-lock.json, pnpm-lock.yaml, requirements.txt, etc.)
 * to pre-synthesized workspace images. When a sandbox starts for a workspace with
 * known dependency files, the matching image is restored — giving instant warm starts
 * without re-running npm install / pip install.
 *
 * Architecture:
 *   package.json OR requirements.txt detected
 *     → hashContent(lockfile contents) = imageKey
 *     → createSandbox → install deps → snapshot → registerImage(key, checkpointId)
 *   Next sandbox for the same deps:
 *     → findImage(key) → restoreCheckpoint → ready instantly
 *
 * Storage:
 *   In-memory registry with TTL-based eviction (default: 1 hour).
 *   The actual blob data lives in provider checkpoints (Sprites, Daytona) or
 *   the CAS content-addressable store.
 *
 * @see dep-cache.ts — Lockfile detection and install commands
 * @see base-image.ts — Base OS package provisioning (separate from workspace deps)
 * @see workspacefs-snapshot-service.ts — Affinity-based workspace snapshots
 */

import { createLogger } from '@/lib/utils/logger';
import { createHash } from 'node:crypto';

const logger = createLogger('Phase7:WorkspaceImage');

// ============================================================================
// Types
// ============================================================================

/** Runtime type inferred from dependency files */
export type ImageRuntime = 'node' | 'python' | 'ruby' | 'rust' | 'go' | 'php' | 'unknown';

/** Package manager or tool name (e.g., 'npm', 'pnpm', 'pip', 'cargo') */
export type ToolName = string;

/** Detected dependency set in a workspace */
export interface DependencySet {
  /** Unique hash of all lockfile contents (SHA256) */
  hash: string;
  /** Runtime type */
  runtime: ImageRuntime;
  /** Lockfiles detected (relative paths within workspace) */
  lockfiles: string[];
  /** Tools found (e.g., ['npm', 'pip']) */
  tools: ToolName[];
  /** Framework hint from package.json / pyproject.toml */
  framework?: string;
  /** The install commands that were run to build this image */
  installCommands: string[];
}

/**
 * A synthesized workspace image — a pre-cached environment with all
 * workspace dependencies installed. Images are built once and reused
 * across sandbox sessions for the same dependency set.
 */
export interface WorkspaceImage {
  /** SHA256 hash of all lockfile contents (the image key) */
  hash: string;
  /** Detected runtime */
  runtime: ImageRuntime;
  /** Detected tools */
  tools: ToolName[];
  /** Framework hint */
  framework?: string;
  /** When the image was created */
  createdAt: number;
  /** How many times this image has been used (restored) */
  useCount: number;
  /** Last time it was used */
  lastUsedAt: number;
  /** How long the image is valid after creation (ms, default 1h) */
  ttl: number;
  /**
   * Provider-specific checkpoint ID if the provider supports
   * native checkpoints (Sprites, Daytona). Fastest restore.
   */
  checkpointId?: string;
  /** Sandbox ID where the image was created (for provider context) */
  sourceSandboxId: string;
  /** Provider type that created this image */
  sourceProvider: string;
  /** The install commands that were run */
  installCommands: string[];
  /**
   * Estimated total size of installed dependencies (bytes).
   * Used for monitoring and cache pressure tracking.
   */
  estimatedSizeBytes?: number;
}

// ============================================================================
// Lockfile → Runtime + Tool Mapping
// ============================================================================

export interface LockfilePattern {
  filename: string;
  runtime: ImageRuntime;
  tool: ToolName;
  installCommand: string;
}

const LOCKFILE_PATTERNS: LockfilePattern[] = [
  { filename: 'package-lock.json', runtime: 'node', tool: 'npm', installCommand: 'npm install --prefer-offline --no-audit' },
  { filename: 'pnpm-lock.yaml',    runtime: 'node', tool: 'pnpm', installCommand: 'pnpm install --prefer-offline' },
  { filename: 'yarn.lock',         runtime: 'node', tool: 'yarn', installCommand: 'yarn install --prefer-offline' },
  { filename: 'bun.lockb',         runtime: 'node', tool: 'bun', installCommand: 'bun install' },
  { filename: 'bun.lock',          runtime: 'node', tool: 'bun', installCommand: 'bun install' },
  { filename: 'requirements.txt',  runtime: 'python', tool: 'pip', installCommand: 'pip install -r requirements.txt' },
  { filename: 'Pipfile',           runtime: 'python', tool: 'pipenv', installCommand: 'pipenv install --deploy' },
  { filename: 'Pipfile.lock',      runtime: 'python', tool: 'pipenv', installCommand: 'pipenv install --deploy' },
  { filename: 'pyproject.toml',    runtime: 'python', tool: 'poetry/pip', installCommand: 'pip install -e . 2>/dev/null; pip install -r requirements.txt 2>/dev/null; true' },
  { filename: 'Gemfile',           runtime: 'ruby', tool: 'bundler', installCommand: 'bundle install' },
  { filename: 'Gemfile.lock',      runtime: 'ruby', tool: 'bundler', installCommand: 'bundle install' },
  { filename: 'Cargo.toml',        runtime: 'rust', tool: 'cargo', installCommand: 'cargo check' },
  { filename: 'go.mod',            runtime: 'go',   tool: 'go modules', installCommand: 'go mod download' },
  { filename: 'composer.lock',     runtime: 'php',  tool: 'composer', installCommand: 'composer install --prefer-dist' },
];

// ============================================================================
// WorkspaceImageRegistry
// ============================================================================

export class WorkspaceImageRegistry {
  /** In-memory image store: hash → WorkspaceImage */
  private images = new Map<string, WorkspaceImage>();

  /** TTL for images (default: 1 hour) */
  private readonly IMAGE_TTL_MS = parseInt(
    process.env.WORKSPACE_IMAGE_TTL_MS || '3600000',
    10,
  );

  /** Whether image synthesis is enabled */
  private readonly ENABLED = process.env.WORKSPACE_IMAGE_ENABLED !== 'false';

  constructor() {
    // Periodic cleanup of expired images
    const cleanupInterval = setInterval(() => this.cleanupExpired(), 120_000);
    cleanupInterval.unref?.();
  }

  // ==========================================================================
  // Public API
  // ==========================================================================

  /**
   * Find a workspace image matching the given lockfile content hash.
   * Returns null if no image exists or the image has expired.
   */
  findImage(hash: string): WorkspaceImage | null {
    const image = this.images.get(hash);
    if (!image) return null;

    // Check TTL
    if (Date.now() - image.createdAt > (image.ttl || this.IMAGE_TTL_MS)) {
      this.images.delete(hash);
      logger.debug('Workspace image expired', { hash, age: Date.now() - image.createdAt });
      return null;
    }

    return image;
  }

  /**
   * Register a newly built workspace image.
   * Overwrites any existing image with the same hash.
   */
  registerImage(image: WorkspaceImage): void {
    this.images.set(image.hash, {
      ...image,
      ttl: image.ttl || this.IMAGE_TTL_MS,
    });

    logger.info('Workspace image registered', {
      hash: image.hash.slice(0, 12),
      runtime: image.runtime,
      tools: image.tools,
      framework: image.framework,
      hasCheckpoint: !!image.checkpointId,
      estimatedSizeMb: image.estimatedSizeBytes
        ? Math.round(image.estimatedSizeBytes / (1024 * 1024))
        : undefined,
    });
  }

  /**
   * Mark an image as used (touch lastUsedAt, increment useCount).
   */
  touchImage(hash: string): void {
    const image = this.images.get(hash);
    if (image) {
      image.lastUsedAt = Date.now();
      image.useCount++;
    }
  }

  /**
   * Remove an image from the registry.
   */
  removeImage(hash: string): void {
    this.images.delete(hash);
    logger.debug('Workspace image removed', { hash: hash.slice(0, 12) });
  }

  /**
   * Check if workspace images are enabled.
   */
  isEnabled(): boolean {
    return this.ENABLED;
  }

  // ==========================================================================
  // Dependency Detection Helpers
  // ==========================================================================

  /**
   * Compute a composite hash of lockfile contents for a workspace.
   * Given a map of filenames → contents (from VFS reads), produces
   * a single SHA256 hash that uniquely identifies the dependency set.
   */
  computeLockfileHash(lockfileContents: Map<string, string>): string {
    const sorted = Array.from(lockfileContents.entries()).sort(([a], [b]) => a.localeCompare(b));
    const hash = createHash('sha256');
    for (const [filename, content] of sorted) {
      hash.update(filename).update('\x00').update(content).update('\x00');
    }
    return hash.digest('hex');
  }

  /**
   * Detect dependency files from a list of workspace file paths.
   * Returns the subset that matches known lockfile/package file patterns.
   */
  detectLockfiles(filePaths: string[]): Array<{ filename: string; pattern: LockfilePattern }> {
    const detected: Array<{ filename: string; pattern: LockfilePattern }> = [];
    const seen = new Set<string>();

    for (const path of filePaths) {
      const filename = path.split('/').pop() || '';
      const pattern = LOCKFILE_PATTERNS.find(p => p.filename === filename);
      if (pattern && !seen.has(filename)) {
        detected.push({ filename, pattern });
        seen.add(filename);
      }
    }

    return detected;
  }

  /**
   * Build a DependencySet from detected lockfile patterns.
   */
  buildDependencySet(
    lockfileHash: string,
    detected: Array<{ filename: string; pattern: LockfilePattern }>,
    framework?: string,
  ): DependencySet {
    const tools = [...new Set(detected.map(d => d.pattern.tool))];
    const installCommands = [...new Set(detected.map(d => d.pattern.installCommand))];
    const runtimes = [...new Set(detected.map(d => d.pattern.runtime))];

    return {
      hash: lockfileHash,
      runtime: runtimes[0] || 'unknown',
      lockfiles: detected.map(d => d.filename),
      tools,
      framework,
      installCommands,
    };
  }

  // ==========================================================================
  // Dependency Change Detection
  // ==========================================================================

  /**
   * Check if a filename is a known dependency file that should trigger
   * workspace image rebuild when changed.
   */
  isDetectedDependency(filename: string): boolean {
    return LOCKFILE_PATTERNS.some(p => p.filename === filename);
  }

  /**
   * Set of workspace IDs that have stale dependency files.
   * When a dep file changes (via onDependencyFileChanged), the workspace is
   * marked as stale. On the next ensureImage() call for that workspace,
   * the image is force-rebuilt regardless of hash matching.
   *
   * Uses workspaceId (e.g., `${userId}:${sessionId}`) rather than content hash
   * because the single-file hash from onDependencyFileChanged will never match
   * the composite hash computed by ensureImage over all lockfiles.
   */
  private staleWorkspaces = new Set<string>();

  /**
   * Mark a workspace as having stale dependency files.
   * Called by onDependencyFileChanged() when a dep file changes.
   */
  markStaleWorkspace(workspaceId: string): void {
    this.staleWorkspaces.add(workspaceId);
    logger.debug('Workspace image marked stale', { workspaceId: workspaceId.slice(0, 16) });
  }

  /**
   * Check if a workspace has stale dependency files.
   * If true, ensureImage() should force a rebuild even if a matching
   * image exists in the registry.
   */
  isWorkspaceStale(workspaceId: string): boolean {
    return this.staleWorkspaces.has(workspaceId);
  }

  /**
   * Clear the stale flag for a workspace (called after image rebuild starts).
   */
  clearStaleWorkspace(workspaceId: string): void {
    this.staleWorkspaces.delete(workspaceId);
  }

  // ==========================================================================
  // Stats
  // ==========================================================================

  /**
   * Get registry statistics.
   */
  getStats(): {
    totalImages: number;
    activeImages: number;
    nodeImages: number;
    pythonImages: number;
    totalUseCount: number;
    totalEstimatedSizeMb: number;
    enabled: boolean;
  } {
    const now = Date.now();
    let activeImages = 0;
    let nodeImages = 0;
    let pythonImages = 0;
    let totalUseCount = 0;
    let totalSizeBytes = 0;

    for (const image of this.images.values()) {
      const isActive = now - image.createdAt <= (image.ttl || this.IMAGE_TTL_MS);
      if (isActive) activeImages++;
      if (image.runtime === 'node') nodeImages++;
      if (image.runtime === 'python') pythonImages++;
      totalUseCount += image.useCount;
      totalSizeBytes += image.estimatedSizeBytes ?? 0;
    }

    return {
      totalImages: this.images.size,
      activeImages,
      nodeImages,
      pythonImages,
      totalUseCount,
      totalEstimatedSizeMb: Math.round(totalSizeBytes / (1024 * 1024)),
      enabled: this.ENABLED,
    };
  }

  // ==========================================================================
  // Cleanup
  // ==========================================================================

  private cleanupExpired(): void {
    const now = Date.now();
    let cleaned = 0;

    for (const [hash, image] of this.images.entries()) {
      if (now - image.createdAt > (image.ttl || this.IMAGE_TTL_MS)) {
        this.images.delete(hash);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.debug('Cleaned up expired workspace images', { cleaned });
    }
  }
}

// ============================================================================
// Singleton
// ============================================================================

export const workspaceImageRegistry = new WorkspaceImageRegistry();
