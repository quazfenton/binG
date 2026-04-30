/**
 * Shared Workspace Boundary Utilities
 * 
 * Centralized path validation for detecting when destructive file operations
 * target paths outside the configured workspace root.
 * 
 * Used by:
 *  - CLI (packages/shared/cli/bin.ts)
 *  - Desktop (desktop/src-tauri/src/commands.rs) - via Rust bindings
 *  - Web (web/lib/agent-bins/workspace-boundary.ts)
 * 
 * Resolution order for workspace root:
 *  1. INITIAL_CWD env (set by Tauri sidecar or CLI wrapper)
 *  2. DESKTOP_WORKSPACE_ROOT env (desktop-specific)
 *  3. WORKSPACE_ROOT env (filesystem middleware default)
 *  4. WORKSPACE_DIR env (alternative)
 *  5. cwd fallback (process.cwd() or ~/workspace)
 */

// ──────────────────────────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────────────────────────

export interface WorkspaceBoundaryResult {
  needsConfirmation: boolean;
  reason?: string;
  workspaceRoot: string | null;
}

// ──────────────────────────────────────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Operations considered destructive — they modify or remove data.
 * These require workspace-boundary confirmation when targeting paths
 * outside the workspace root.
 */
export const DESTRUCTIVE_OPERATIONS = new Set([
  'delete',
  'write',
  'move',
  'overwrite',
  'apply_diff',
  'rename',
  'mkdir', // mkdir outside workspace can have side effects
]);
/**
 * VFS virtual path prefixes that are always considered inside the workspace.
 * These are the canonical prefixes used by the virtual filesystem layer
 * and should never trigger a workspace-boundary confirmation.
 */
export const VFS_VIRTUAL_PREFIXES = [
  '/project/',
  '/workspace/',
  'project/',
  'workspace/',
];
// ──────────────────────────────────────────────────────────────────────────────
// Workspace Root Resolution
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Resolve the workspace root from environment variables.
 * Priority: INITIAL_CWD > DESKTOP_WORKSPACE_ROOT > WORKSPACE_ROOT > WORKSPACE_DIR > cwd
 * 
 * @param override Optional override for the workspace root
 * @returns The resolved workspace root path, or null if not configured
 */
export function resolveWorkspaceRoot(override?: string): string | null {
  if (override) return override;

  // Check environment variables (works in Node.js, browser, and CLI contexts)
  if (typeof process !== 'undefined' && process.env) {
    const fromEnv =
      process.env.INITIAL_CWD ||
      process.env.DESKTOP_WORKSPACE_ROOT ||
      process.env.WORKSPACE_ROOT ||
      process.env.WORKSPACE_DIR ||
      undefined;

    if (fromEnv) return fromEnv;
  }

  // Cross-platform fallback to process.cwd()
  if (typeof process !== 'undefined' && typeof process.cwd === 'function') {
    return process.cwd();
  }

  return null;
}

/**
 * Get the workspace root as a string (with fallback to empty string).
 * Use this when you need a string and can handle empty/default cases.
 */
export function getWorkspaceRoot(): string {
  return resolveWorkspaceRoot() ?? '';
}

// ──────────────────────────────────────────────────────────────────────────────
// Path Normalization
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Normalize a path for comparison.
 * - Converts backslashes to forward slashes (Windows compatibility)
 * - Strips trailing slashes
 * - Collapses leading slashes to single /
 * - Resolves .. segments for security (prevents ../../etc/passwd attacks)
 * 
 * @param p The path to normalize
 * @returns Normalized path string
 */
export function normalizePath(p: string): string {
  let n = p
    .replace(/\\/g, '/')   // backslashes → forward slashes
    .replace(/\/+$/, '')   // strip trailing slashes
    .replace(/^\/+/, '/'); // collapse leading slashes to single /

  // Resolve .. segments so paths like '../../etc/passwd' are collapsed
  // before comparison. This mirrors path.resolve() without requiring
  // the Node path module (works in browser and CLI too).
  const segments = n.split('/');
  const resolved: string[] = [];
  const isAbsolute = p.startsWith('/') || /^[A-Z]:/i.test(p);
  
  for (const seg of segments) {
    if (seg === '..') {
      if (resolved.length > 0 && resolved[resolved.length - 1] !== '..') {
        resolved.pop();
      } else if (!isAbsolute) {
        // Keep .. for relative paths only
        resolved.push('..');
      }
    } else if (seg !== '.' && seg !== '') {
      resolved.push(seg);
    }
  }
  const result = resolved.join('/');
  return result.startsWith('/') ? result : (n.startsWith('/') ? '/' + result : result);
}

// ──────────────────────────────────────────────────────────────────────────────
// Workspace Boundary Checks
// ──────────────────────────────────────────────────────────────────────────────

/**
 * Check whether a given file path is absolute.
 * Supports POSIX, Windows drive letters, AND Windows UNC paths.
 * 
 * UNC paths like \\server\share\file are absolute and should not be
 * treated as relative paths inside the workspace.
 */
function isAbsolutePath(p: string): boolean {
  // POSIX absolute path
  if (p.startsWith('/')) return true;
  
  // Windows drive letter (e.g., C:\ or D:/)
  if (/^[a-zA-Z]:[\\/]/.test(p)) return true;
  
  // Windows UNC path (e.g., \\server\share or \\192.168.1.1\share)
  // UNC paths start with \\ and have at least server\share components
  if (/^\\\\[^\\/:*?"<>|]+\\[^\\/:*?"<>|]+/.test(p)) return true;
  
  return false;
}

/**
 * Check whether a given file path is outside the workspace root.
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
   const normalizedTarget = normalizePath(targetPath);
   const prefixMatch = VFS_VIRTUAL_PREFIXES.some(
     (prefix) => normalizedTarget.startsWith(prefix),
   );
   if (prefixMatch) return false;

   const root = resolveWorkspaceRoot(workspaceRoot);
   if (!root) return false; // No root configured → cannot determine boundary

   const normalizedRoot = normalizePath(root);

   // Empty target → not outside
   if (!normalizedTarget) return false;

   // Resolve relative paths against workspace root before comparison
   const resolvedTarget = isAbsolutePath(targetPath) 
     ? normalizedTarget 
     : normalizePath(`${root}/${targetPath}`);

   // If the target starts with the root prefix, it's inside
   if (
     resolvedTarget.startsWith(normalizedRoot + '/') ||
     resolvedTarget === normalizedRoot
   ) {
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
): WorkspaceBoundaryResult {
  // Only destructive operations need confirmation
  if (!DESTRUCTIVE_OPERATIONS.has(operation)) {
    return { needsConfirmation: false, workspaceRoot: resolveWorkspaceRoot(workspaceRoot) };
  }

  if (!isOutsideWorkspace(targetPath, workspaceRoot)) {
    return { needsConfirmation: false, workspaceRoot: resolveWorkspaceRoot(workspaceRoot) };
  }

  const root = resolveWorkspaceRoot(workspaceRoot) ?? 'unknown';

  return {
    needsConfirmation: true,
    reason: `Path \"${targetPath}\" is outside the workspace root \"${root}\". ` +
      `This operation will modify data outside the project directory.`,
    workspaceRoot: root,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Confirmation Prompt Builder (for CLI/desktop use)
// ──────────────────────────────────────────────────────────────────────────────

export interface WorkspaceBoundaryConfirmationOptions {
  operation: string;
  targetPath: string;
  forceFlag?: boolean;
  workspaceRoot?: string;
}

/**
 * Build a confirmation message for workspace boundary warnings.
 * Returns null if no confirmation is needed (safe operation or force flag set).
 * 
 * @param options Confirmation options
 * @returns Confirmation message object, or null if not needed
 */
export function buildWorkspaceBoundaryWarning(
   options: WorkspaceBoundaryConfirmationOptions,
): { shouldConfirm: boolean; message: string } | null {
   const { operation, targetPath, forceFlag, workspaceRoot } = options;
 
   // Check if confirmation is needed
   const check = requiresWorkspaceBoundaryConfirmation(operation, targetPath, workspaceRoot);
   
   if (!check.needsConfirmation) {
     return null; // No confirmation needed - safe operation
   }
 
   if (forceFlag) {
     return {
       shouldConfirm: false, // Force flag bypasses confirmation
       message: `⚠ Workspace boundary bypassed with --force\n` +
         `  Operation: ${operation}\n` +
         `  Target: ${targetPath}\n` +
         `  Workspace: ${check.workspaceRoot}`,
     };
   }
 
   return {
     shouldConfirm: true,
     message: `⚠️  WORKSPACE BOUNDARY WARNING\n` +
       `  Operation: ${operation}\n` +
       `  Target path: ${targetPath}\n` +
       `  Workspace root: ${check.workspaceRoot}\n\n` +
       `This operation will affect files outside the configured workspace.\n` +
       `This could potentially access or modify system files.`,
   };
 }
/**
 * Parse a command to extract filesystem operation and targets.
 * Useful for CLI tools that need to analyze user commands.
 * 
 * CRIT-7 fix: Robustly handles quoted paths and escaped spaces.
 * 
 * @param command The command string to analyze
 * @returns Array of detected file paths
 */
export function extractFilePathsFromCommand(command: string): string[] {
  const paths: string[] = [];

  // Helper to extract paths from a string, handling quotes
  const extractFromArgString = (str: string) => {
    // This regex matches:
    // 1. Double quoted strings: "..."
    // 2. Single quoted strings: '...'
    // 3. Unquoted strings (ended by space, or end of string): ...
    const argRegex = /"([^"\\]*(?:\\.[^"\\]*)*)"|'([^'\\]*(?:\\.[^'\\]*)*)'|([^\s\\]*(?:\\.[^\s\\]*)*)+/g;
    let m;
    while ((m = argRegex.exec(str)) !== null) {
      const path = m[1] || m[2] || m[3];
      if (path && path.length > 0) {
        // Clean up escaping
        paths.push(path.replace(/\\(.)/g, '$1'));
      }
    }
  };

  // Common filesystem operation patterns
  // Matches command + optional space/flags
  const patterns = [
    { cmd: /rm(?:\s+-[rf]+)*/gi, multiple: true },
    { cmd: /del/gi, multiple: true },
    { cmd: /rmdir/gi, multiple: true },
    { cmd: /mv/gi, multiple: true },
    { cmd: /cp/gi, multiple: true },
    { cmd: /cat/gi, multiple: true },
    { cmd: /write/gi, multiple: true },
    { cmd: /touch/gi, multiple: true },
  ];

  for (const pattern of patterns) {
    const regex = new RegExp(`(?:^|&&|;|\\|)\\s*${pattern.cmd.source}\\s+(.*)`, 'gi');
    let match;
    while ((match = regex.exec(command)) !== null) {
      const argString = match[1];
      if (argString) {
        extractFromArgString(argString);
      }
    }
  }

  return [...new Set(paths)]; // Deduplicate
}

// ──────────────────────────────────────────────────────────────────────────────
// Re-exports for convenience
// ──────────────────────────────────────────────────────────────────────────────

// Note: DESTRUCTIVE_OPERATIONS and VFS_VIRTUAL_PREFIXES are already exported above
// via their const declarations. No need for additional re-exports here.