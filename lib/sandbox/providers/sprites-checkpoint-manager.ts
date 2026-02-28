/**
 * Sprites Checkpoint Manager with Retention Policies
 * 
 * Features:
 * - Create/restore/delete checkpoints
 * - Automatic retention policy enforcement
 * - Checkpoint listing with metadata
 * - Comment support for organization
 * 
 * Documentation: docs/sdk/sprites-llms-full.txt
 * 
 * Note: This is a stub implementation. The @flyio/sprites package doesn't exist on npm.
 * When Sprites SDK becomes available, replace the stub methods with actual SDK calls.
 */

export interface CheckpointRetention {
  maxCount?: number;      // Keep last N checkpoints
  maxAgeDays?: number;    // Delete checkpoints older than N days
  minKeep?: number;       // Always keep at least N checkpoints
}

export interface CheckpointInfo {
  id: string;
  name: string;
  comment?: string;
  createdAt: Date;
  size?: number;
}

export class SpritesCheckpointManager {
  private token: string;
  private spriteName: string;
  private checkpoints: Map<string, CheckpointInfo> = new Map();

  constructor(token: string, spriteName: string) {
    this.token = token;
    this.spriteName = spriteName;
    
    // Log warning about stub implementation
    console.warn(
      '[SpritesCheckpointManager] Using stub implementation. ' +
      '@flyio/sprites package not available. Install when available.'
    );
  }

  /**
   * Create checkpoint with optional retention policy
   */
  async createCheckpoint(
    name: string,
    options: {
      comment?: string;
      retention?: CheckpointRetention;
    } = {}
  ): Promise<{
    success: boolean;
    checkpointId?: string;
    error?: string;
  }> {
    try {
      // Stub implementation - generate fake checkpoint ID
      const checkpointId = `checkpoint-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      
      const checkpoint: CheckpointInfo = {
        id: checkpointId,
        name,
        comment: options.comment,
        createdAt: new Date(),
      };

      this.checkpoints.set(checkpointId, checkpoint);

      // Apply retention policy if specified
      if (options.retention) {
        await this.enforceRetentionPolicy(options.retention);
      }

      return {
        success: true,
        checkpointId,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * List all checkpoints
   */
  async listCheckpoints(): Promise<{
    success: boolean;
    checkpoints?: CheckpointInfo[];
    error?: string;
  }> {
    try {
      return {
        success: true,
        checkpoints: Array.from(this.checkpoints.values()),
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Restore checkpoint
   */
  async restoreCheckpoint(checkpointId: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      const checkpoint = this.checkpoints.get(checkpointId);
      
      if (!checkpoint) {
        return {
          success: false,
          error: `Checkpoint not found: ${checkpointId}`,
        };
      }

      // Stub - in real implementation, this would restore the sprite state
      console.log(`[SpritesCheckpointManager] Would restore checkpoint: ${checkpoint.name}`);

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Delete checkpoint
   */
  async deleteCheckpoint(checkpointId: string): Promise<{
    success: boolean;
    error?: string;
  }> {
    try {
      const deleted = this.checkpoints.delete(checkpointId);
      
      if (!deleted) {
        return {
          success: false,
          error: `Checkpoint not found: ${checkpointId}`,
        };
      }

      return { success: true };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Enforce retention policy - auto-cleanup old checkpoints
   */
  async enforceRetentionPolicy(retention: CheckpointRetention): Promise<{
    success: boolean;
    deletedCount?: number;
    error?: string;
  }> {
    try {
      const checkpoints = Array.from(this.checkpoints.values());
      let toDelete: string[] = [];

      // Sort by creation date (newest first)
      const sorted = checkpoints.sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      );

      // Apply maxCount
      if (retention.maxCount && sorted.length > retention.maxCount) {
        const keepCount = Math.max(
          retention.minKeep || 0,
          retention.maxCount
        );
        toDelete.push(...sorted.slice(keepCount).map(c => c.id));
      }

      // Apply maxAgeDays
      if (retention.maxAgeDays) {
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - retention.maxAgeDays);

        for (const checkpoint of sorted) {
          if (checkpoint.createdAt < cutoff) {
            // Don't delete if it would violate minKeep
            const remainingCount = sorted.filter(c => c.id !== checkpoint.id).length;
            if (remainingCount >= (retention.minKeep || 0)) {
              toDelete.push(checkpoint.id);
            }
          }
        }
      }

      // Delete old checkpoints
      for (const checkpointId of toDelete) {
        this.checkpoints.delete(checkpointId);
      }

      return {
        success: true,
        deletedCount: toDelete.length,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get checkpoint by name
   */
  async getCheckpointByName(name: string): Promise<{
    success: boolean;
    checkpoint?: CheckpointInfo;
    error?: string;
  }> {
    try {
      const checkpoint = Array.from(this.checkpoints.values()).find(c => c.name === name);
      
      return {
        success: !!checkpoint,
        checkpoint,
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get latest checkpoint
   */
  async getLatestCheckpoint(): Promise<{
    success: boolean;
    checkpoint?: CheckpointInfo;
    error?: string;
  }> {
    try {
      const checkpoints = Array.from(this.checkpoints.values());
      
      if (checkpoints.length === 0) {
        return {
          success: false,
          error: 'No checkpoints found',
        };
      }

      // Sort by creation date (newest first)
      const sorted = checkpoints.sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      );

      return {
        success: true,
        checkpoint: sorted[0],
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message,
      };
    }
  }
}

/**
 * Create checkpoint manager instance
 */
export function createCheckpointManager(
  token: string,
  spriteName: string
): SpritesCheckpointManager {
  return new SpritesCheckpointManager(token, spriteName);
}

/**
 * Create checkpoint manager from environment
 */
export function createCheckpointManagerFromEnv(spriteName?: string): SpritesCheckpointManager {
  const token = process.env.SPRITES_TOKEN;
  const name = spriteName || process.env.SPRITES_DEFAULT_SPRITE;

  if (!token) {
    throw new Error('SPRITES_TOKEN not configured');
  }

  if (!name) {
    throw new Error('Sprite name not provided');
  }

  return createCheckpointManager(token, name);
}

/**
 * Quick helper: Create checkpoint with retention
 */
export async function createSpriteCheckpoint(
  spriteName: string,
  name: string,
  options?: {
    comment?: string;
    maxCount?: number;
    maxAgeDays?: number;
  }
): Promise<{
  success: boolean;
  checkpointId?: string;
  error?: string;
}> {
  try {
    const manager = createCheckpointManagerFromEnv(spriteName);
    
    return manager.createCheckpoint(name, {
      comment: options?.comment,
      retention: {
        maxCount: options?.maxCount,
        maxAgeDays: options?.maxAgeDays,
      },
    });
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Quick helper: Restore latest checkpoint
 */
export async function restoreLatestCheckpoint(spriteName: string): Promise<{
  success: boolean;
  checkpointName?: string;
  error?: string;
}> {
  try {
    const manager = createCheckpointManagerFromEnv(spriteName);
    const result = await manager.getLatestCheckpoint();
    
    if (!result.success || !result.checkpoint) {
      return {
        success: false,
        error: result.error || 'No checkpoints found',
      };
    }

    const restoreResult = await manager.restoreCheckpoint(result.checkpoint.id);
    
    return {
      success: restoreResult.success,
      checkpointName: result.checkpoint.name,
      error: restoreResult.error,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message,
    };
  }
}
