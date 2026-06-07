/**
 * Predictive Prewarmer
 *
 * Detects project type at workspace open (reads package.json → Node,
 * requirements.txt → Python) and pre-warms the environment image before
 * the user types their first command.
 *
 * Flow:
 *   1. After VFS files are loaded for a workspace, this service reads
 *      known dependency files (package.json, requirements.txt, etc.)
 *   2. Computes a lockfile content hash
 *   3. If no cached image exists in the registry, proactively builds one
 *      by creating a temporary sandbox, installing dependencies, and
 *      registering the resulting checkpoint image
 *   4. When the user later creates their first sandbox, ensureImage()
 *      finds the cached image and restores from checkpoint → instant warm start
 *
 * Integration points:
 *   - core-sandbox-service.ts: called after createSandboxWithProvider() completes
 *   - session initialization: can be called early when workspace files are first loaded
 *
 * @see workspace-image-registry.ts — Image metadata storage
 * @see workspace-image-builder.ts — Image building logic
 */

import { createLogger } from '@/lib/utils/logger';
import { virtualFilesystem } from '@/lib/virtual-filesystem/virtual-filesystem-service';
import { workspaceImageRegistry, type LockfilePattern, type WorkspaceImage } from './workspace-image-registry';
import { getSandboxProvider, type SandboxProviderType } from './providers';
import type { SandboxHandle } from './providers/sandbox-provider';
import { setupCacheVolumes } from './dep-cache';
import { provisionBaseImage } from './base-image';
import { quotaManager } from '../management/quota-manager';

const logger = createLogger('PredictivePrewarmer');

// ============================================================================
// Types
// ============================================================================

export interface PrewarmResult {
  /** Whether prewarming was attempted */
  attempted: boolean;
  /** Whether a new image was built */
  imageBuilt: boolean;
  /** The detected runtime, if any */
  runtime?: string;
  /** The image hash, if built */
  hash?: string;
  /** Duration in ms */
  durationMs?: number;
  /** Error message if prewarming failed */
  error?: string;
}

// ============================================================================
// Predictive Prewarmer
// ============================================================================

export class PredictivePrewarmer {
  /** Whether predictive prewarming is enabled */
  private readonly ENABLED = process.env.PREDICTIVE_PREWARM_ENABLED !== 'false';

  /** Whether to preload base packages on the prewarm sandbox */
  private readonly PRELOAD_PACKAGES = process.env.SANDBOX_PRELOAD_PACKAGES !== 'false';

  /** Timeout for sandbox creation during prewarming */
  private readonly SANDBOX_TIMEOUT_MS = parseInt(
    process.env.PREDICTIVE_PREWARM_TIMEOUT_MS || '300000',
    10,
  );

  /** Primary provider for prewarm sandboxes */
  private readonly SANDBOX_PROVIDER = (process.env.PREDICTIVE_PREWARM_PROVIDER
    || process.env.SANDBOX_PROVIDER
    || 'daytona') as SandboxProviderType;

  /**
   * Prewarm a workspace image by reading dependency files from the VFS.
   *
   * Designed to be called fire-and-forget — returns immediately after
   * detecting the project type, with image building happening in background.
   *
   * @param workspaceId - The workspace identifier (e.g., `${userId}:${sessionId}`)
   * @param userId - The user who owns the workspace
   * @returns A PrewarmResult describing what was done
   */
  async prewarmFromVFS(
    workspaceId: string,
    userId: string,
  ): Promise<PrewarmResult> {
    if (!this.ENABLED || !workspaceImageRegistry.isEnabled()) {
      return { attempted: false, imageBuilt: false };
    }

    const startTime = Date.now();

    try {
      // Step 1: List all workspace files from VFS
      let filePaths: string[];
      try {
        const snapshot = await virtualFilesystem.exportWorkspace(userId);
        filePaths = snapshot.files.map(f => f.path);
      } catch {
        logger.debug('VFS not available for predictive prewarming', {
          workspaceId: workspaceId.slice(0, 16),
        });
        return { attempted: false, imageBuilt: false };
      }

      if (filePaths.length === 0) {
        logger.debug('Empty workspace, skipping predictive prewarming', {
          workspaceId: workspaceId.slice(0, 16),
        });
        return { attempted: false, imageBuilt: false };
      }

      // Step 2: Detect known dependency files using the registry.
      // detectLockfiles() returns basenames + patterns. We then resolve each
      // basename to its full VFS path so we can read the file contents.
      const detected = workspaceImageRegistry.detectLockfiles(filePaths);
      if (detected.length === 0) {
        logger.debug('No dependency files detected, skipping prewarming', {
          workspaceId: workspaceId.slice(0, 16),
        });
        return { attempted: true, imageBuilt: false };
      }

      // Step 3: Read lockfile contents from VFS using full file paths.
      // Match each basename to its actual VFS path from the file listing.
      const lockfileContents = new Map<string, string>();
      for (const dep of detected) {
        // Find the first file whose path ends with this basename
        const fullPath = filePaths.find(p => {
          const basename = p.split('/').pop();
          return basename === dep.filename;
        });
        if (!fullPath) {
          logger.debug('Could not resolve VFS path for dependency file', {
            filename: dep.filename,
          });
          continue;
        }
        try {
          const file = await virtualFilesystem.readFile(userId, fullPath);
          if (file?.content) {
            lockfileContents.set(dep.filename, file.content);
          }
        } catch {
          logger.debug('Dependency file not found in VFS', {
            filename: dep.filename,
            vfsPath: fullPath,
            workspaceId: workspaceId.slice(0, 16),
          });
        }
      }

      if (lockfileContents.size === 0) {
        logger.debug('Dependency file contents not available, skipping prewarming', {
          workspaceId: workspaceId.slice(0, 16),
          detected: detected.map(d => d.filename),
        });
        return { attempted: true, imageBuilt: false };
      }

      // Step 4: Compute hash and check for existing image
      const hash = workspaceImageRegistry.computeLockfileHash(lockfileContents);
      const existingImage = workspaceImageRegistry.findImage(hash);

      if (existingImage) {
        logger.info('Workspace image already cached, skipping prewarming', {
          hash: hash.slice(0, 12),
          runtime: existingImage.runtime,
          tools: existingImage.tools,
        });
        return {
          attempted: true,
          imageBuilt: false,
          hash,
          runtime: existingImage.runtime,
          durationMs: Date.now() - startTime,
        };
      }

      // Step 5: Build the image proactively
      logger.info('Predictive prewarming: building workspace image', {
        workspaceId: workspaceId.slice(0, 16),
        hash: hash.slice(0, 12),
        runtime: detected[0].pattern.runtime,
        tools: [...new Set(detected.map(d => d.pattern.tool))],
        files: detected.map(d => d.filename),
      });

      const image = await this.buildImage(hash, detected);
      if (image) {
        workspaceImageRegistry.registerImage(image);
        logger.info('Predictive prewarming complete', {
          hash: hash.slice(0, 12),
          runtime: image.runtime,
          tools: image.tools,
          durationMs: Date.now() - startTime,
          hasCheckpoint: !!image.checkpointId,
        });
      }

      return {
        attempted: true,
        imageBuilt: !!image,
        hash,
        runtime: detected[0].pattern.runtime,
        durationMs: Date.now() - startTime,
      };
    } catch (error: any) {
      logger.warn('Predictive prewarming failed', {
        workspaceId: workspaceId.slice(0, 16),
        error: error.message,
        durationMs: Date.now() - startTime,
      });
      return {
        attempted: true,
        imageBuilt: false,
        error: error.message,
        durationMs: Date.now() - startTime,
      };
    }
  }

  // ==========================================================================
  // Image Building
  // ==========================================================================

  /**
   * Build a workspace image on a temporary sandbox.
   * The sandbox is created specifically for prewarming and destroyed
   * after the image is registered (or on failure).
   *
   * Steps:
   *   1. Create a sandbox with the configured provider
   *   2. Provision base image (system tools, runtimes)
   *   3. Install workspace dependencies
   *   4. Create a provider checkpoint
   *   5. Register the image
   *   6. Destroy the temporary sandbox
   */
  private async buildImage(
    hash: string,
    detected: Array<{ filename: string; pattern: LockfilePattern }>,
  ): Promise<WorkspaceImage | null> {
    const startTime = Date.now();
    let handle: SandboxHandle | null = null;

    try {
      // Step 1: Create a sandbox for prewarming
      const provider = await getSandboxProvider(this.SANDBOX_PROVIDER);
      handle = await provider.createSandbox({
        language: 'typescript',
        autoStopInterval: 60, // Auto-stop after 60s of inactivity
        envVars: {
          TERM: 'xterm-256color',
          LANG: 'en_US.UTF-8',
          PREDICTIVE_PREWARM: 'true',
        },
        labels: {
          createdBy: 'predictive-prewarmer',
          prewarmHash: hash.slice(0, 12),
        },
        resources: {
          cpu: parseInt(process.env.SANDBOX_WARM_POOL_CPU || '1', 10),
          memory: parseInt(process.env.SANDBOX_WARM_POOL_MEMORY || '2', 10),
        },
      });

      this.trackProviderUsage(provider.name);

      // Step 2: Provision base image (system tools + runtimes)
      if (this.PRELOAD_PACKAGES) {
        try {
          await setupCacheVolumes(handle);
          await provisionBaseImage(handle);
        } catch (err: any) {
          logger.warn('Base image provisioning failed during prewarming', {
            hash: hash.slice(0, 12),
            error: err.message,
          });
          // Continue — partial provision may still be useful
        }
      }

      // Step 2.5: Create workspace directory
      try {
        await handle.executeCommand('mkdir -p /workspace', '/', 10_000);
      } catch {
        logger.debug('Could not create workspace directory', {
          hash: hash.slice(0, 12),
        });
      }

      // Step 3: Install workspace dependencies
      const deps = workspaceImageRegistry.buildDependencySet(hash, detected);
      for (const cmd of deps.installCommands) {
        try {
          const result = await handle.executeCommand(cmd, '/workspace', 120_000);
          if (result.exitCode !== 0) {
            logger.warn('Install command had non-zero exit during prewarming', {
              hash: hash.slice(0, 12),
              command: cmd.slice(0, 60),
              exitCode: result.exitCode,
            });
          }
        } catch (err: any) {
          logger.warn('Install command failed during prewarming', {
            hash: hash.slice(0, 12),
            command: cmd.slice(0, 60),
            error: err.message,
          });
          // Continue — partial install may still provide value
        }
      }

      const installDuration = Date.now() - startTime;

      // Step 4: Create provider checkpoint
      let checkpointId: string | undefined;
      try {
        if (handle.createCheckpoint) {
          const checkpoint = await handle.createCheckpoint(
            `prewarm-image-${hash.slice(0, 12)}`,
          );
          checkpointId = checkpoint?.id;
        }
      } catch {
        // Provider may not support checkpoints — image will be built fresh
        logger.debug('Provider checkpoint not available for prewarm image', {
          hash: hash.slice(0, 12),
        });
      }

      const totalDuration = Date.now() - startTime;

      // Step 5: Build the image metadata
      const image: WorkspaceImage = {
        hash,
        runtime: deps.runtime,
        tools: deps.tools,
        framework: deps.framework,
        createdAt: Date.now(),
        useCount: 0,
        lastUsedAt: Date.now(),
        ttl: parseInt(process.env.WORKSPACE_IMAGE_TTL_MS || '3600000', 10),
        checkpointId,
        sourceSandboxId: handle.id,
        sourceProvider: this.SANDBOX_PROVIDER,
        installCommands: deps.installCommands,
      };

      return image;
    } catch (error: any) {
      logger.warn('Predictive image build failed', {
        hash: hash.slice(0, 12),
        error: error.message,
        durationMs: Date.now() - startTime,
      });
      return null;
    } finally {
      // Step 6: Clean up the temporary sandbox
      if (handle) {
        try {
          const provider = await getSandboxProvider(this.SANDBOX_PROVIDER);
          await provider.destroySandbox(handle.id);
          logger.debug('Prewarm sandbox destroyed', { sandboxId: handle.id.slice(0, 12) });
        } catch (err: any) {
          logger.warn('Failed to destroy prewarm sandbox', {
            sandboxId: handle.id.slice(0, 12),
            error: err.message,
          });
        }
      }
    }
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  private trackProviderUsage(providerName: string): void {
    try {
      quotaManager.recordUsage(providerName);
    } catch {
      // Non-critical
    }
  }

  /**
   * Get current prewarming status.
   */
  getStatus(): { enabled: boolean; imageRegistryEnabled: boolean; provider: string } {
    return {
      enabled: this.ENABLED,
      imageRegistryEnabled: workspaceImageRegistry.isEnabled(),
      provider: this.SANDBOX_PROVIDER,
    };
  }
}

// ============================================================================
// Singleton
// ============================================================================

export const predictivePrewarmer = new PredictivePrewarmer();
