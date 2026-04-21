/**
 * Workspace Boundary Utilities
 *
 * Centralized logic for detecting when a destructive file operation
 * targets a path outside the configured workspace root.
 *
 * Used by:
 *  - HITL approval workflows (to gate out-of-workspace destructive ops)
 *  - Web filesystem hooks (to show confirmation dialogs)
 *  - CLI bin.ts (to show TUI confirmation prompts)
 *  - Filesystem API routes (to return needsWorkspaceConfirmation flag)
 */

import { getDefaultWorkspaceRoot } from '@bing/platform/env';

/** Operations considered destructive — they modify or remove data. */
export const DESTRUCTIVE_OPERATIONS = new Set([
  'delete',
  'write',
  'move',
  'overwrite',
  'apply_diff',
  'rename',
  'mkdir', // mkdir outside workspace can be a side-effect
]);

/**
 * VFS virtual path prefixes that are always considered inside the workspace.
 * These are the canonical prefixes used by the virtual filesystem layer
 * and should never trigger a workspace-boundary confirmation.
 */
const VFS_VIRTUAL_PREFIXES = [
  '/project/',
  '/workspace/',
  '/home/',
  'project/',
  'workspace/',
  'home/',
];

/**
 * Check whether a given file path is outside the workspace root.
 *
 * Resolution order for workspace root:
 *  1. INITIAL_CWD env (set by Tauri sidecar or CLI wrapper)
 *  2. DESKTOP_WORKSPACE_ROOT env
 *  3. WORKSPACE_DIR env (filesystem middleware default)
 *  4. getDefaultWorkspaceRoot() (falls back to cwd or ~/workspace)
 *
 * VFS-awareness: Virtual paths (e.g., `/project/foo.txt`, `/workspace/bar.txt`)
 * are always considered inside the workspace, since they are managed by the
 * virtual filesystem layer and don't correspond to real filesystem locations.
 *
 * @param targetPath  - The path to check (absolute or relative)
 * @param workspaceRoot - Optional override for the workspace root
 * @returns true if the path resolves outside the workspace boundary
 */
export function isOutsideWorkspace(
  targetPath: string,
  workspaceRoot?: string,
): boolean {
  // VFS virtual paths are always inside the workspace
  const prefixMatch = VFS_VIRTUAL_PREFIXES.some(
    (prefix) => targetPath.startsWith(prefix),
  );
  if (prefixMatch) return false;

  const root = resolveWorkspaceRoot(workspaceRoot);
  if (!root) return false; // No root configured → cannot determine boundary

  const normalizedTarget = normalizePath(targetPath);
  const normalizedRoot = normalizePath(root);

  // Empty target → not outside
  if (!normalizedTarget) return false;

  // If the target starts with the root prefix, it's inside
  if (normalizedTarget.startsWith(normalizedRoot + '/') || normalizedTarget === normalizedRoot) {
    return false;
  }

  return true;
}

/**
 * Determine whether a destructive operation requires workspace-boundary
 * confirmation before proceeding.
 *
 * @param operation  - The filesystem operation type
 * @param targetPath - The target path for the operation
 * @param workspaceRoot - Optional override for the workspace root
 * @returns An object indicating whether confirmation is needed and why
 */
export function requiresWorkspaceBoundaryConfirmation(
  operation: string,
  targetPath: string,
  workspaceRoot?: string,
): { needsConfirmation: boolean; reason?: string } {
  // Only destructive operations need confirmation
  if (!DESTRUCTIVE_OPERATIONS.has(operation)) {
    return { needsConfirmation: false };
  }

  if (!isOutsideWorkspace(targetPath, workspaceRoot)) {
    return { needsConfirmation: false };
  }

  const root = resolveWorkspaceRoot(workspaceRoot) || 'unknown';

  return {
    needsConfirmation: true,
    reason: `Path "${targetPath}" is outside the workspace root "${root}". ` +
      `This operation will modify data outside the project directory.`,
  };
}

/**
 * Resolve the workspace root using the same priority chain used elsewhere.
 * Exported for reuse in contexts that need the raw root string.
 */
export function resolveWorkspaceRoot(override?: string): string | null {
  if (override) return override;

  // Server-side: check env vars first
  if (typeof process !== 'undefined' && process.env) {
    const fromEnv =
      process.env.INITIAL_CWD ||
      process.env.DESKTOP_WORKSPACE_ROOT ||
      process.env.WORKSPACE_DIR ||
      undefined;

    if (fromEnv) return fromEnv;
  }

  // Cross-platform fallback
  return getDefaultWorkspaceRoot();
}

// ──────────────────────────────────────────────────────────────────────────────
// Internal helpers
// ──────────────────────────────────────────────────────────────────────────────

function normalizePath(p: string): string {
  let n = p
    .replace(/\\/g, '/')   // backslashes → forward slashes
    .replace(/\/+$/, '')   // strip trailing slashes
    .replace(/^\/+/, '/'); // collapse leading slashes to single /

  // Resolve .. segments so paths like "../../etc/passwd" are collapsed
  // before comparison. This mirrors path.resolve() without requiring
  // the Node path module (works in browser too).
  const segments = n.split('/');
  const resolved: string[] = [];
  for (const seg of segments) {
    if (seg === '..') {
      if (resolved.length > 0 && resolved[resolved.length - 1] !== '..') {
        resolved.pop();
      } else {
        // .. above root — keep it so the comparison will correctly
        // flag the path as outside the workspace
        resolved.push('..');
      }
    } else if (seg !== '.' && seg !== '') {
      resolved.push(seg);
    }
  }
  const result = resolved.join('/');
  return result.startsWith('/') ? result : (n.startsWith('/') ? '/' + result : result);
}
