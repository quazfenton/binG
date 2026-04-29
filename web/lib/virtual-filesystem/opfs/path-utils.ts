/**
 * OPFS Path Utilities
 * 
 * Ensures consistent path resolution between server VirtualFS and client OPFS
 * Provides mount point support and traversal protection
 */

import { join, normalize, resolve } from 'path';

export interface PathResolutionOptions {
  root?: string;
  mounts?: Map<string, string>;
  allowTraversal?: boolean;
}

export interface MountPoint {
  alias: string;
  target: string;
  readOnly?: boolean;
}

/**
 * Resolve OPFS path with VirtualFS-compatible logic
 * Ensures server and client use same path resolution
 * 
 * @param path - Path to resolve
 * @param options - Resolution options
 * @returns Resolved path
 */
export function resolveOPFSPath(
  path: string,
  options: PathResolutionOptions = {}
): string {
  const {
    root = '',
    mounts = new Map<string, string>(),
    allowTraversal = false,
  } = options;

  // Remove leading slash
  const cleanPath = path.startsWith('/') ? path.substring(1) : path;

  // Check if the first component is a registered mount alias
  const parts = cleanPath.split('/');
  if (parts.length > 0 && mounts.has(parts[0])) {
    // Resolve mounted path
    const targetPath = mounts.get(parts[0])!;
    const remainingParts = parts.slice(1);

    if (remainingParts.length > 0) {
      // Validate remaining parts for directory traversal
      const normalized = normalizePathParts(remainingParts, allowTraversal);
      const result = join(targetPath, ...normalized);

      if (!allowTraversal) {
        // Verify result is still under target
        const realTarget = resolve(targetPath);
        const realResult = resolve(result);
        if (!realResult.startsWith(realTarget)) {
          throw new Error('OPFS path resolution: Directory traversal prevented');
        }
      }
      return result;
    }

    return targetPath;
  }

  // Normalize path and check for directory traversal
  const normalizedParts = normalizePathParts(parts, allowTraversal);
  const resultPath = join(root, ...normalizedParts);

  if (!allowTraversal && root) {
    // Verify that the resolved path is still under the root
    const realRoot = resolve(root);
    const realResult = resolve(resultPath);
    if (!realResult.startsWith(realRoot)) {
      throw new Error('OPFS path resolution: Directory traversal prevented');
    }
  }

  return resultPath;
}

/**
 * Normalize path parts, removing '.' and handling '..'
 * 
 * @param parts - Path parts to normalize
 * @param allowTraversal - Allow directory traversal (default: false)
 * @returns Normalized parts
 */
export function normalizePathParts(
  parts: string[],
  allowTraversal: boolean = false
): string[] {
  const normalized: string[] = [];

  for (const part of parts) {
    if (part === '..') {
      if (!allowTraversal && normalized.length === 0) {
        throw new Error('Directory traversal prevented');
      }
      if (normalized.length > 0) {
        normalized.pop();
      }
    } else if (part !== '.' && part !== '') {
      // Validate path component
      if (!isValidPathComponent(part)) {
        throw new Error(`Invalid path component: ${part}`);
      }
      normalized.push(part);
    }
  }

  return normalized;
}

/**
 * Validate a path component
 * Rejects dangerous characters and patterns
 */
export function isValidPathComponent(component: string): boolean {
  // Reject null bytes
  if (component.includes('\0')) {
    return false;
  }

  // Reject path separators within component
  if (component.includes('/') || component.includes('\\')) {
    return false;
  }

  // Reject Windows reserved names
  const reservedNames = [
    'CON', 'PRN', 'AUX', 'NUL',
    'COM1', 'COM2', 'COM3', 'COM4', 'COM5', 'COM6', 'COM7', 'COM8', 'COM9',
    'LPT1', 'LPT2', 'LPT3', 'LPT4', 'LPT5', 'LPT6', 'LPT7', 'LPT8', 'LPT9',
  ];
  if (reservedNames.includes(component.toUpperCase())) {
    return false;
  }

  // Reject components starting with .
  // (hidden files are allowed, but not . or ..)
  if (component === '.' || component === '..') {
    return false;
  }

  return true;
}

/**
 * Sanitize path for OPFS storage
 * Removes or replaces invalid characters
 */
export function sanitizePathForOPFS(path: string): string {
  // Remove null bytes
  let sanitized = path.replace(/\0/g, '');

  // Replace path separators with forward slash
  sanitized = sanitized.replace(/\\/g, '/');

  // Remove leading/trailing slashes
  sanitized = sanitized.replace(/^\/+|\/+$/g, '');

  // Replace multiple slashes with single
  sanitized = sanitized.replace(/\/+/g, '/');

  // Replace invalid characters with underscore
  sanitized = sanitized.replace(/[<>:"|?*]/g, '_');

  // Ensure path is not empty
  if (!sanitized) {
    sanitized = '.';
  }

  return sanitized;
}

/**
 * Get relative path from absolute path and root
 */
export function relativePath(absolutePath: string, root: string): string {
  const normalizedRoot = resolve(root);
  const normalizedAbsolute = resolve(absolutePath);

  if (!normalizedAbsolute.startsWith(normalizedRoot)) {
    throw new Error('Path is not under root');
  }

  return normalizedAbsolute.slice(normalizedRoot.length).replace(/^[/\\]/, '');
}

/**
 * Check if path is under root
 */
export function isPathUnderRoot(path: string, root: string): boolean {
  try {
    const normalizedRoot = resolve(root);
    const normalizedPath = resolve(path);
    return normalizedPath.startsWith(normalizedRoot);
  } catch {
    return false;
  }
}

/**
 * Create mount point manager
 */
export class MountManager {
  private mounts: Map<string, MountPoint> = new Map();

  /**
   * Mount a target path at an alias
   */
  mount(alias: string, target: string, options: { readOnly?: boolean } = {}): void {
    if (!isValidPathComponent(alias)) {
      throw new Error(`Invalid mount alias: ${alias}`);
    }

    this.mounts.set(alias, {
      alias,
      target,
      readOnly: options.readOnly || false,
    });
  }

  /**
   * Unmount an alias
   */
  unmount(alias: string): boolean {
    return this.mounts.delete(alias);
  }

  /**
   * Get all mount points
   */
  getMounts(): MountPoint[] {
    return Array.from(this.mounts.values());
  }

  /**
   * Get mount point for alias
   */
  getMount(alias: string): MountPoint | undefined {
    return this.mounts.get(alias);
  }

  /**
   * Check if alias is mounted
   */
  isMounted(alias: string): boolean {
    return this.mounts.has(alias);
  }

  /**
   * Resolve path with mount points
   */
  resolve(path: string, root: string = ''): string {
    return resolveOPFSPath(path, {
      root,
      mounts: new Map(Array.from(this.mounts.entries()).map(([k, v]) => [k, v.target])),
    });
  }

  /**
   * Check if path is read-only (mounted as read-only)
   */
  isReadOnly(path: string): boolean {
    const parts = path.split('/');
    if (parts.length > 0) {
      const mount = this.mounts.get(parts[0]);
      return mount?.readOnly || false;
    }
    return false;
  }

  /**
   * Clear all mount points
   */
  clear(): void {
    this.mounts.clear();
  }
}

/**
 * Get common path prefix
 */
export function getCommonPathPrefix(paths: string[]): string {
  if (paths.length === 0) return '';
  if (paths.length === 1) return paths[0];

  const sorted = [...paths].sort();
  const first = sorted[0];
  const last = sorted[sorted.length - 1];

  let i = 0;
  while (i < first.length && i < last.length && first[i] === last[i]) {
    i++;
  }

  // Find last separator
  const prefix = first.substring(0, i);
  const lastSeparator = prefix.lastIndexOf('/');

  if (lastSeparator === -1) {
    return '';
  }

  return prefix.substring(0, lastSeparator);
}

/**
 * Join path segments safely
 */
export function safeJoinPath(...segments: string[]): string {
  return segments
    .filter(s => s && s !== '.')
    .map(s => s.replace(/^\/+|\/+$/g, ''))
    .join('/');
}

/**
 * Get parent directory path
 */
export function getParentDirectory(path: string): string {
  const parts = path.split('/');
  parts.pop();
  return parts.join('/') || '/';
}

/**
 * Get file name from path
 */
export function getFileName(path: string): string {
  const parts = path.split('/');
  return parts.pop() || '';
}

/**
 * Get file extension
 */
export function getFileExtension(path: string): string {
  const fileName = getFileName(path);
  const parts = fileName.split('.');
  return parts.length > 1 ? parts.pop()?.toLowerCase() || '' : '';
}

/**
 * Get file name without extension
 */
export function getFileNameWithoutExtension(path: string): string {
  const fileName = getFileName(path);
  const parts = fileName.split('.');
  if (parts.length > 1) {
    parts.pop();
  }
  return parts.join('.');
}

/**
 * Ensure path starts with slash
 */
export function ensureLeadingSlash(path: string): string {
  return path.startsWith('/') ? path : `/${path}`;
}

/**
 * Ensure path doesn't end with slash
 */
export function ensureTrailingSlash(path: string): string {
  return path.endsWith('/') ? path.slice(0, -1) : path;
}

/**
 * Normalize path (consistent slashes, no trailing slash)
 */
export function normalizePath(path: string): string {
  return ensureTrailingSlash(
    sanitizePathForOPFS(path)
  );
}
