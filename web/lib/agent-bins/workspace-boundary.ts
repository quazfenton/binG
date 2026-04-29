/**
 * Workspace Boundary Utilities
 *
 * Centralized logic for detecting when a destructive file operation
 * targets a path outside the configured workspace root.
 *
 * This module re-exports shared utilities from packages/shared/lib/workspace-boundary.ts
 * to maintain backward compatibility with existing imports.
 *
 * Used by:
 *  - HITL approval workflows (to gate out-of-workspace destructive ops)
 *  - Web filesystem hooks (to show confirmation dialogs)
 *  - CLI bin.ts (to show TUI confirmation prompts) - via shared lib
 *  - Filesystem API routes (to return needsWorkspaceConfirmation flag)
 */

// Re-export everything from the shared workspace boundary utility
// This maintains backward compatibility while sharing code with CLI and Desktop
export {
  isOutsideWorkspace,
  getWorkspaceRoot,
  requiresWorkspaceBoundaryConfirmation,
  resolveWorkspaceRoot,
  normalizePath,
  buildWorkspaceBoundaryWarning,
  DESTRUCTIVE_OPERATIONS,
  VFS_VIRTUAL_PREFIXES,
  extractFilePathsFromCommand,
} from '@bing/shared/lib/workspace-boundary';

export type { WorkspaceBoundaryResult, WorkspaceBoundaryConfirmationOptions } from '@bing/shared/lib/workspace-boundary';
