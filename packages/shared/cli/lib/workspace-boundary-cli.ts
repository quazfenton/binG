/**
 * CLI Workspace Boundary Wrapper
 * 
 * Re-exports shared workspace boundary utilities for CLI usage.
 * This wrapper provides a clean import path for bin.ts.
 * 
 * Usage: Import from this wrapper instead of the shared lib directly
 * to ensure consistent versioning and potential CLI-specific overrides.
 */

export {
  isOutsideWorkspace,
  getWorkspaceRoot,
  requiresWorkspaceBoundaryConfirmation,
  buildWorkspaceBoundaryWarning,
  resolveWorkspaceRoot,
  normalizePath,
  DESTRUCTIVE_OPERATIONS,
  VFS_VIRTUAL_PREFIXES,
  type WorkspaceBoundaryResult,
  type WorkspaceBoundaryConfirmationOptions,
} from '../lib/workspace-boundary';

// Re-export analyzeCommandImpact if needed
export { extractFilePathsFromCommand } from '../lib/workspace-boundary';