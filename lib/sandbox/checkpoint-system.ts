/**
 * Unified Sandbox Checkpoint System
 * 
 * Provides a standardized interface for filesystem state management:
 * - Persistent state snapshots (Checkpoints)
 * - Automatic retention policies
 * - Branching from checkpoints
 */

import type { SandboxHandle, CheckpointInfo } from './providers/sandbox-provider';

export interface CheckpointRetentionPolicy {
  maxCheckpoints: number;
  autoDeleteDays: number;
}

export class CheckpointSystem {
  /**
   * Create a named checkpoint for a sandbox
   */
  static async create(
    handle: SandboxHandle, 
    name?: string, 
    comment?: string
  ): Promise<CheckpointInfo> {
    if (!handle.createCheckpoint) {
      throw new Error(`Provider '${handle.id}' does not support hardware checkpoints. Use VFS Snapshots instead.`);
    }

    const checkpoint = await handle.createCheckpoint(name);
    if (comment && 'comment' in checkpoint) {
      (checkpoint as any).comment = comment;
    }

    console.log(`[CheckpointSystem] Created checkpoint '${checkpoint.id}' for sandbox ${handle.id}`);
    return checkpoint;
  }

  /**
   * Restore a sandbox to a specific checkpoint
   */
  static async restore(handle: SandboxHandle, checkpointId: string): Promise<void> {
    if (!handle.restoreCheckpoint) {
      throw new Error(`Provider '${handle.id}' does not support hardware restore.`);
    }

    await handle.restoreCheckpoint(checkpointId);
    console.log(`[CheckpointSystem] Restored sandbox ${handle.id} to checkpoint ${checkpointId}`);
  }

  /**
   * List all checkpoints for a sandbox
   */
  static async list(handle: SandboxHandle): Promise<CheckpointInfo[]> {
    if (!handle.listCheckpoints) {
      return [];
    }
    return handle.listCheckpoints();
  }

  /**
   * Create a new sandbox branch from an existing checkpoint
   * (Advanced capability for Daytona/Sprites)
   */
  static async branch(
    handle: SandboxHandle,
    checkpointId: string,
    newBranchName: string
  ): Promise<string> {
    console.log(`[CheckpointSystem] Branching '${newBranchName}' from '${checkpointId}'`);

    try {
      // Try provider-specific branching if available
      if (handle.createCheckpoint && handle.restoreCheckpoint) {
        // Provider supports checkpoints - try branching
        const checkpoints = await handle.listCheckpoints?.() || [];
        const checkpoint = checkpoints.find(c => c.id === checkpointId);
        
        if (!checkpoint) {
          throw new Error(`Checkpoint ${checkpointId} not found`);
        }

        // Create new sandbox and restore checkpoint
        const { getSandboxProvider } = await import('./providers');
        const provider = await getSandboxProvider('daytona' as any);
        const newHandle = await provider.createSandbox({
          name: newBranchName,
        });

        // Restore checkpoint if method exists
        if (newHandle.restoreCheckpoint) {
          await newHandle.restoreCheckpoint(checkpointId);
        }

        console.log(`[CheckpointSystem] Branch created: ${newHandle.id}`);
        return newHandle.id;
      }

      // Fallback: Return error if branching not supported
      throw new Error('Checkpoint branching not supported by this provider');
    } catch (error: any) {
      console.error(`[CheckpointSystem] Branching failed: ${error.message}`);
      throw error;
    }
  }
