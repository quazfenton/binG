/**
 * Phase 7: Workspace Image Builder
 *
 * Automatically synthesizes cached workspace images from dependency files.
 * When package.json, requirements.txt, or other lockfiles are detected in a
 * workspace, this service:
 *
 *   1. Computes a content hash of all lockfile contents
 *   2. Checks the registry for a matching pre-built image
 *   3. If no match: creates a sandbox, runs install commands, creates a
 *      provider-level checkpoint (or CAS snapshot), registers the image
 *   4. If match: restores the checkpoint on the new sandbox → instant warm start
 *
 * Integration points:
 *   - core-sandbox-service.ts: called after sandbox creation (before first user command)
 *   - project-detection.ts: could trigger preemptive image building on dep file write
 *
 * @see workspace-image-registry.ts — Image metadata storage
 * @see dep-cache.ts — Install commands with cache flags
 * @see base-image.ts — Base OS package provisioning (runs before this)
 */

import { createLogger } from '@/lib/utils/logger';
import { workspaceImageRegistry, type WorkspaceImage, type LockfilePattern } from './workspace-image-registry';
import type { SandboxHandle } from './providers/sandbox-provider';
import { sandboxBridge } from './sandbox-service-bridge';

const logger = createLogger('Phase7:ImageBuilder');

// ============================================================================
// Known Dependency Filenames
// ============================================================================

/**
 * Set of filenames that, when created or modified, should trigger
 * workspace image rebuild. Matches the patterns in workspace-image-registry.ts.
 */
export const DEPENDENCY_FILE_NAMES = new Set([
  'package-lock.json',
  'pnpm-lock.yaml',
  'yarn.lock',
  'bun.lockb',
  'bun.lock',
  'requirements.txt',
  'Pipfile',
  'Pipfile.lock',
  'pyproject.toml',
  'Gemfile',
  'Gemfile.lock',
  'Cargo.toml',
  'go.mod',
  'composer.lock',
  'package.json',
  'composer.json',
  'go.sum',
  'Cargo.lock',
]);

// ============================================================================
// Workspace Image Builder
// ============================================================================

export class WorkspaceImageBuilder {
  /** Timeout for dependency install commands (default: 5 min) */
  private readonly INSTALL_TIMEOUT_MS = parseInt(
    process.env.WORKSPACE_IMAGE_INSTALL_TIMEOUT_MS || '300000',
    10,
  );

  /** Whether image synthesis is enabled */
  private readonly ENABLED = workspaceImageRegistry.isEnabled();

  // ==========================================================================
  // Main API
  // ==========================================================================

  /**
   * Attempt to restore a matching workspace image on a newly-created sandbox.
   *
   * Called during sandbox initialization (after base image provisioning, before
   * the first user command). If a matching image is found and restored, the
   * sandbox will have all dependencies pre-installed — giving an instant warm start.
   *
   * Steps:
   *   1. Detect lockfiles in the workspace
   *   2. Read their contents and compute a composite hash
   *   3. Check the registry for a matching image
   *   4. If found: restore the image (provider checkpoint)
   *   5. If not found: build a new image (install deps, snapshot, register)
   *
   * For the restore path (checkpoint), this is synchronous and completes quickly.
   * For the build path, install commands run in the background — fire-and-forget
   * since the sandbox is usable while installs proceed.
   *
   * @param handle - The newly-created sandbox handle
   * @param workspaceDir - Workspace directory path on the sandbox
   * @param fileList - Optional pre-fetched list of workspace files (saves a command)
   *
   * @returns The image that was restored or created, or null if no deps detected or image disabled
   */
  async ensureImage(
    handle: SandboxHandle,
    workspaceDir: string,
    fileList?: string[],
  ): Promise<WorkspaceImage | null> {
    if (!this.ENABLED) {
      return null;
    }

    // Step 1: Detect lockfiles in the workspace
    const files = fileList ?? await this.listWorkspaceFiles(handle, workspaceDir);
    const detected = workspaceImageRegistry.detectLockfiles(files);

    if (detected.length === 0) {
      logger.debug('No dependency files detected, skipping image synthesis', {
        sandboxId: handle.id.slice(0, 12),
      });
      return null;
    }

    // Step 2: Read lockfile contents and compute hash
    const lockfileContents = await this.readLockfiles(handle, workspaceDir, detected.map(d => d.filename));
    if (lockfileContents.size === 0) {
      logger.debug('Lockfiles referenced but not found on sandbox, skipping', {
        sandboxId: handle.id.slice(0, 12),
        detected: detected.map(d => d.filename),
      });
      return null;
    }

    const hash = workspaceImageRegistry.computeLockfileHash(lockfileContents);

    // Step 3: Check for existing image (stale workspace forces rebuild)
    // We don't have the workspaceId in this context, so we rely on hash-based
    // freshness check. If the image exists and is not stale at the workspace
    // level, we restore it. The workspace-level stale check requires the caller
    // to pass workspaceId — see the onDependencyFileChanged flow for that.
    const image = workspaceImageRegistry.findImage(hash);
    if (image) {
      logger.info('Found matching workspace image, restoring', {
        hash: hash.slice(0, 12),
        tools: image.tools,
        useCount: image.useCount,
      });

      await this.restoreImage(handle, image, workspaceDir);
      workspaceImageRegistry.touchImage(hash);
      return image;
    }

    // Step 4: Build a new image (fire-and-forget — sandbox is usable while installs run)
    logger.info('No matching image found, building new workspace image', {
      hash: hash.slice(0, 12),
      sandboxId: handle.id.slice(0, 12),
      detected: detected.map(d => d.filename),
    });

    // Build in background — don't block sandbox return for slow installs
    this.buildImage(handle, workspaceDir, hash, detected).then(newImage => {
      if (newImage) {
        workspaceImageRegistry.registerImage(newImage);
      }
    }).catch(err => {
      logger.warn('Background workspace image build failed', {
        hash: hash.slice(0, 12),
        error: err.message,
      });
    });

    return null;
  }

  // ==========================================================================
  // Image Building
  // ==========================================================================

  /**
   * Build a new workspace image by installing dependencies and snapshotting.
   *
   * 1. Run all install commands (npm install, pip install, etc.)
   * 2. Attempt a provider-level checkpoint (fastest restore)
   * 3. Estimate cache size
   * 4. Register the image
   */
  private async buildImage(
    handle: SandboxHandle,
    workspaceDir: string,
    hash: string,
    detected: Array<{ filename: string; pattern: LockfilePattern }>,
  ): Promise<WorkspaceImage | null> {
    const startTime = Date.now();

    // Step 1: Build dependency set and run installs
    const deps = workspaceImageRegistry.buildDependencySet(hash, detected);

    for (const cmd of deps.installCommands) {
      try {
        logger.debug('Running install command for image', {
          hash: hash.slice(0, 12),
          command: cmd.slice(0, 60),
        });

        const result = await handle.executeCommand(cmd, workspaceDir, this.INSTALL_TIMEOUT_MS);

        if (result.exitCode !== 0) {
          logger.warn('Install command had non-zero exit during image build', {
            hash: hash.slice(0, 12),
            command: cmd.slice(0, 60),
            exitCode: result.exitCode,
            output: (result.output || '').slice(0, 200),
          });
          // Continue — partial installs may still be useful
        }
      } catch (err: any) {
        logger.warn('Install command failed during image build', {
          hash: hash.slice(0, 12),
          command: cmd.slice(0, 60),
          error: err.message,
        });
        // Continue — partial image may still provide value
      }
    }

    const installDuration = Date.now() - startTime;

    // Step 2: Try provider-level checkpoint
    let checkpointId: string | undefined;
    try {
      if (handle.createCheckpoint) {
        const checkpoint = await handle.createCheckpoint(
          `workspace-image-${hash.slice(0, 12)}`,
        );
        checkpointId = checkpoint?.id;
        logger.info('Provider checkpoint created for workspace image', {
          hash: hash.slice(0, 12),
          checkpointId,
          installDuration,
        });
      }
    } catch (err: any) {
      logger.debug('Provider checkpoint not available for image', {
        hash: hash.slice(0, 12),
        error: err.message,
      });
    }

    // Step 3: Estimate installed size
    const estimatedSizeBytes = await this.estimateInstalledSize(handle, workspaceDir, deps.tools);

    const image: WorkspaceImage = {
      hash,
      runtime: deps.runtime,
      tools: deps.tools,
      framework: deps.framework,
      createdAt: Date.now(),
      useCount: 1,
      lastUsedAt: Date.now(),
      ttl: 3600000, // 1 hour default
      checkpointId,
      sourceSandboxId: handle.id,
      sourceProvider: 'unknown', // Will be resolved on register
      installCommands: deps.installCommands,
      estimatedSizeBytes: estimatedSizeBytes ?? undefined,
    };

    // Try to resolve provider name
    try {
      const providerType = sandboxBridge.inferProviderFromSandboxId(handle.id);
      if (providerType) {
        image.sourceProvider = providerType;
      }
    } catch { /* best-effort */ }

    const totalDuration = Date.now() - startTime;
    logger.info('Workspace image built', {
      hash: hash.slice(0, 12),
      runtime: deps.runtime,
      tools: deps.tools,
      installDuration,
      totalDuration,
      hasCheckpoint: !!checkpointId,
      estimatedSizeMb: estimatedSizeBytes
        ? Math.round(estimatedSizeBytes / (1024 * 1024))
        : undefined,
    });

    return image;
  }

  /**
   * Restore a workspace image onto a sandbox.
   *
   * Priority:
   *   1. Provider checkpoint restore (fast)
   *   2. Re-run install commands (slow but always works)
   */
  private async restoreImage(
    handle: SandboxHandle,
    image: WorkspaceImage,
    workspaceDir: string,
  ): Promise<void> {
    // Strategy 1: Provider checkpoint
    if (image.checkpointId && handle.restoreCheckpoint) {
      try {
        await handle.restoreCheckpoint(image.checkpointId);

        const now = Date.now();
        const age = now - image.createdAt;
        logger.info('Workspace image restored from provider checkpoint', {
          hash: image.hash.slice(0, 12),
          checkpointId: image.checkpointId,
          age,
        });
        return;
      } catch (err: any) {
        logger.warn('Provider checkpoint restore failed, falling back to reinstall', {
          hash: image.hash.slice(0, 12),
          error: err.message,
        });
      }
    }

    // Strategy 2: Re-run install commands (always works)
    for (const cmd of image.installCommands) {
      try {
        const result = await handle.executeCommand(cmd, workspaceDir, this.INSTALL_TIMEOUT_MS);
        if (result.exitCode !== 0) {
          logger.warn('Reinstall command had non-zero exit during image restore', {
            hash: image.hash.slice(0, 12),
            command: cmd.slice(0, 60),
            exitCode: result.exitCode,
          });
        }
      } catch (err: any) {
        logger.warn('Reinstall command failed during image restore', {
          hash: image.hash.slice(0, 12),
          command: cmd.slice(0, 60),
          error: err.message,
        });
      }
    }

    logger.info('Workspace image restored via reinstall', {
      hash: image.hash.slice(0, 12),
      tools: image.tools,
    });
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  /**
   * List files in the workspace directory on the sandbox.
   * Only returns regular files (not directories).
   */
  private async listWorkspaceFiles(
    handle: SandboxHandle,
    workspaceDir: string,
  ): Promise<string[]> {
    try {
      const result = await handle.executeCommand(
        `find ${shellEscape(workspaceDir)} -maxdepth 2 -type f 2>/dev/null | head -500`,
        workspaceDir,
        10_000,
      );
      if (result.exitCode === 0 && result.output) {
        return result.output.trim().split('\n').filter(Boolean);
      }
    } catch {
      // Fallback: single-level glob of known patterns
    }

    try {
      const result = await handle.executeCommand(
        `find ${shellEscape(workspaceDir)} -maxdepth 1 -type f \( -name '*.json' -o -name '*.txt' -o -name '*.lock' -o -name '*.toml' -o -name '*.yaml' -o -name '*.yml' -o -name 'Makefile' -o -name 'Gemfile' -o -name 'go.mod' \) 2>/dev/null | head -100`,
        workspaceDir,
        10_000,
      );
      if (result.exitCode === 0 && result.output) {
        return result.output.trim().split('\n').filter(Boolean);
      }
    } catch {
      // Worst case: empty
    }

    return [];
  }

  /**
   * Read lockfile contents from the sandbox.
   */
  private async readLockfiles(
    handle: SandboxHandle,
    workspaceDir: string,
    filenames: string[],
  ): Promise<Map<string, string>> {
    const contents = new Map<string, string>();

    for (const filename of filenames) {
      try {
        const fullPath = `${workspaceDir}/${filename}`;
        const result = await handle.executeCommand(
          `cat ${shellEscape(fullPath)}`,
          workspaceDir,
          10_000,
        );
        if (result.exitCode === 0 && result.output) {
          contents.set(filename, result.output);
        }
      } catch {
        // File may not exist yet
      }
    }

    return contents;
  }

  /**
   * Estimate the total size of installed dependencies by checking
   * common cache/dependency directories.
   */
  private async estimateInstalledSize(
    handle: SandboxHandle,
    workspaceDir: string,
    tools: string[],
  ): Promise<number | undefined> {
    const dirs: string[] = [];

    if (tools.some(t => t === 'npm' || t === 'pnpm' || t === 'yarn' || t === 'bun')) {
      dirs.push('node_modules');
    }
    if (tools.some(t => t === 'pip' || t === 'pipenv' || t === 'poetry/pip')) {
      dirs.push('.venv', 'venv', '__pycache__');
    }
    if (tools.some(t => t === 'bundler')) {
      dirs.push('vendor/bundle');
    }
    if (tools.some(t => t === 'cargo')) {
      dirs.push('target');
    }
    if (tools.some(t => t === 'composer')) {
      dirs.push('vendor');
    }

    if (dirs.length === 0) return undefined;

    const dirList = dirs.map(d => `${shellEscape(workspaceDir)}/${d}`).join(' ');
    try {
      const result = await handle.executeCommand(
        `du -sb ${dirList} 2>/dev/null | awk '{sum+=$1} END {print sum+0}'`,
        workspaceDir,
        10_000,
      );
      const bytes = parseInt(result.output?.trim() || '0', 10);
      return bytes > 0 ? bytes : undefined;
    } catch {
      return undefined;
    }
  }  }

// ==========================================================================
// Dependency File Change Auto-Trigger
// ==========================================================================

/**
 * Called when a dependency file is created or modified in a workspace.
 * Triggers rebuild of the workspace image so the next sandbox gets
 * the updated dependencies pre-installed.
 *
 * This is the hook that VFS write events should call when a file like
 * `package.json` or `requirements.txt` is written/updated.
 *
 * @param workspaceId - The workspace identifier (e.g., `${userId}:${sessionId}`)
 * @param filename - The dependency file that changed
 * @param contents - The new file contents
 * @param existingImageHash - Optional hash of the current image (to invalidate)
 * @returns The hash of the newly built image, or null if unchanged/skipped
 */
export async function onDependencyFileChanged(
  workspaceId: string,
  filename: string,
  contents: string,
  existingImageHash?: string,
): Promise<string | null> {
  if (!workspaceImageRegistry.isEnabled()) {
    logger.debug('Image synthesis disabled, skipping dep file change', { filename });
    return null;
  }

  if (!workspaceImageRegistry.isDetectedDependency(filename)) {
    return null;
  }

  // Compute new hash for this single file and check if changed
  const newHash = workspaceImageRegistry.computeLockfileHash(
    new Map([[filename, contents]]),
  );

  // If the hash hasn't changed relative to the existing image, skip
  if (existingImageHash && existingImageHash === newHash) {
    logger.debug('Dependency file unchanged, skipping rebuild', { filename });
    return null;
  }

  logger.info('Dependency file changed, triggering image rebuild', {
    workspaceId: workspaceId.slice(0, 16),
    filename,
    hash: newHash.slice(0, 12),
  });

  // Invalidate the old image so the next ensureImage() call rebuilds
  if (existingImageHash) {
    workspaceImageRegistry.removeImage(existingImageHash);
  }    // We can't build the actual image here (no sandbox handle available yet).
    // Instead, invalidate the existing image so ensureImage() will rebuild.
    // The next ensureImage() call will read all lockfiles from the sandbox,
    // compute a fresh composite hash, and find no matching image → rebuild.
    if (existingImageHash) {
      workspaceImageRegistry.removeImage(existingImageHash);
    }

    // Mark the workspace as stale so external callers can request rebuild
    workspaceImageRegistry.markStaleWorkspace(workspaceId);

    return newHash;
}

/**
 * Shell-safe quoting: wrap a path in single quotes, escaping any single quotes within.
 * Single-quoted strings in POSIX shell are literal except for single quote itself.
 * The pattern `'foo'\''bar'` closes the quote, adds a literal `'`, reopens the quote.
 */
function shellEscape(path: string): string {
  return `'${path.replace(/'/g, "'\\''")}'`;
}

// ============================================================================
// Singleton
// ============================================================================

export const workspaceImageBuilder = new WorkspaceImageBuilder();
