/**
 * R2 s3fs-FUSE Mount Helper
 *
 * Eliminates the fragile VFS sync layer by mounting R2 directly into
 * ephemeral terminal containers. The user's workspace IS their R2 storage —
 * files written in the terminal go directly to R2 with no polling, no
 * materialization, and no sync lag.
 *
 * Architecture:
 *   Before: VFS DB → materializeWorkspace() → temp dir → bind mount → poll-watch → VFS DB
 *   After:  R2 bucket (users/<userId>/workspace/) → s3fs-fuse → /workspace in container
 *
 * The container needs FUSE support: --cap-add SYS_ADMIN --device /dev/fuse
 *
 * For environments where FUSE isn't available (e.g., nested containers, some
 * cloud VMs), falls back gracefully to the existing VFS-based Docker mode.
 */

import * as path from 'path';
import * as fs from 'fs';
import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('R2Mount');

// === Configuration ===

/** R2 credentials and endpoint — mirrors cloud-storage.ts R2StorageService */
function getEnv(key: string, fallback: string = ''): string {
  return process.env[key] || fallback;
}

/** Docker image with s3fs-fuse pre-installed. Falls back to node:20-slim if not built. */
const R2_DOCKER_IMAGE =
  process.env.R2_TERMINAL_DOCKER_IMAGE || 'bing-terminal-r2:latest';

/** Whether to try s3fs inside the container (true) or mount on host first (false).
 *  Host-first is safer but requires s3fs installed on the host. */
const MOUNT_INSIDE_CONTAINER =
  process.env.R2_MOUNT_INSIDE_CONTAINER !== 'false'; // default: true

/** Host-side mount root when MOUNT_INSIDE_CONTAINER=false */
const HOST_MOUNT_ROOT = process.env.R2_HOST_MOUNT_ROOT || '/mnt/r2-workspaces';

/** s3fs options for performance and reliability (without allow_other — that's set inline) */
const S3FS_BASE_OPTIONS: string[] = [
  'use_path_request_style',
  'use_cache=/tmp/s3fs-cache',
  'del_cache',
  'enable_noobj_cache',
  'max_stat_cache_size=10000',
  'stat_cache_expire=900',
  'connect_timeout=10',
  'readwrite_timeout=30',
  'multireq_max=20',
  'parallel_count=5',
];

/** s3fs options as comma-separated string for host-side mount */
function s3fsFullOptions(): string {
  const r2Endpoint = getEnv('R2_ENDPOINT');
  return [
    ...S3FS_BASE_OPTIONS,
    `url=${r2Endpoint}`,
    'no_check_certificate',
    'multireq_max=20',
    'parallel_count=5',
  ].join(',');
}

// === Public API ===

/**
 * Check if R2 FUSE mounting is available.
 * Returns false if credentials are missing or s3fs isn't installed.
 */
export async function isR2FuseAvailable(): Promise<boolean> {
  const accessKey = getEnv('R2_ACCESS_KEY_ID');
  const secretKey = getEnv('R2_SECRET_ACCESS_KEY');
  const endpoint = getEnv('R2_ENDPOINT');
  const bucket = getEnv('R2_BUCKET') || getEnv('CLOUD_STORAGE_BUCKET');

  if (!accessKey || !secretKey || !endpoint || !bucket) {
    logger.info('R2 FUSE mount unavailable: missing credentials', {
      hasAccessKey: !!accessKey,
      hasSecretKey: !!secretKey,
      hasEndpoint: !!endpoint,
      hasBucket: !!bucket,
    });
    return false;
  }

  try {
    const { execFileSync } = await import('child_process');
    execFileSync('s3fs', ['--version'], { timeout: 5000, stdio: 'pipe' });
    return true;
  } catch {
    logger.warn('R2 FUSE mount unavailable: s3fs binary not found on host');
    return false;
  }
}

/**
 * Sanitize a userId for use in filesystem paths.
 * Mirrors normalizeOwnerId() in vfs-workspace-materializer.ts for consistency.
 */
export function sanitizeUserId(userId: string): string {
  let id = userId.replace(/^anon:/, '');
  id = id.replace(/\.\./g, '').replace(/[\\/ \0]/g, '_');
  return id.substring(0, 255) || '_default';
}

/**
 * Get the R2 S3 prefix for a user's workspace files.
 * Format: users/<sanitizedUserId>/workspace/
 */
export function getR2WorkspacePrefix(userId: string): string {
  return `users/${sanitizeUserId(userId)}/workspace/`;
}

/**
 * Get the host-side mount point for a user's R2 workspace.
 */
export function getHostMountPoint(userId: string): string {
  return path.join(HOST_MOUNT_ROOT, sanitizeUserId(userId));
}

/**
 * Mount R2 on the host filesystem for a user's workspace.
 *
 * Creates the mount directory, writes s3fs credentials file, and mounts.
 * Returns the mount point path.
 *
 * Security: credentials file is written with mode 0600 and removed after mount.
 */
export async function mountR2OnHost(userId: string): Promise<string> {
  const mountPoint = getHostMountPoint(userId);
  const prefix = getR2WorkspacePrefix(userId);
  const bucket = getEnv('R2_BUCKET') || getEnv('CLOUD_STORAGE_BUCKET');

  logger.info('Mounting R2 on host', { userId: sanitizeUserId(userId), mountPoint, prefix });

  if (!fs.existsSync(mountPoint)) {
    fs.mkdirSync(mountPoint, { recursive: true, mode: 0o755 });
  }

  if (isMounted(mountPoint)) {
    logger.info('R2 already mounted on host, reusing', { mountPoint });
    return mountPoint;
  }

  // Write s3fs passwd file — random suffix to prevent concurrent session collisions
  const { randomUUID } = await import('crypto');
  const passwdFile = path.join('/tmp', `s3fs-passwd-${sanitizeUserId(userId)}-${randomUUID().slice(0, 8)}`);
  const accessKey = getEnv('R2_ACCESS_KEY_ID');
  const secretKey = getEnv('R2_SECRET_ACCESS_KEY');

  try {
    fs.writeFileSync(passwdFile, `${accessKey}:${secretKey}`, { mode: 0o600 });
  } catch (err: any) {
    logger.error('Failed to write s3fs passwd file', { error: err.message });
    throw new Error(`Failed to write s3fs credentials: ${err.message}`);
  }

  const { execFile } = await import('child_process');
  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error('s3fs mount timed out after 30s'));
    }, 30000);

    execFile('s3fs', [
      `${bucket}:/${prefix}`,
      mountPoint,
      '-o', `${s3fsFullOptions()},passwd_file=${passwdFile}`,
    ], { timeout: 30000 }, (err, stdout, stderr) => {
      clearTimeout(timeout);

      try { fs.unlinkSync(passwdFile); } catch { /* ignore */ }

      if (err) {
        logger.error('s3fs mount failed', {
          error: err.message,
          stderr: stderr?.slice(0, 200),
          mountPoint,
        });
        reject(new Error(`s3fs mount failed: ${err.message}`));
        return;
      }

      logger.info('R2 mounted on host', { mountPoint, bucket, prefix });
      resolve(mountPoint);
    });
  });
}

/**
 * Unmount R2 from the host filesystem.
 * Safe to call even if nothing is mounted (idempotent).
 */
export async function unmountR2FromHost(userId: string): Promise<void> {
  const mountPoint = getHostMountPoint(userId);

  if (!isMounted(mountPoint)) {
    logger.debug('R2 not mounted on host, nothing to unmount', { mountPoint });
    return;
  }

  const { execFile } = await import('child_process');
  return new Promise<void>((resolve) => {
    execFile('fusermount', ['-uz', mountPoint], { timeout: 10000 }, (err) => {
      if (err) {
        execFile('umount', ['-f', mountPoint], { timeout: 10000 }, () => {
          resolve();
        });
      } else {
        resolve();
      }
    });
  });
}

/**
 * Build the init script that runs inside the container to mount R2.
 * Composed from array parts to avoid template-literal escape complexity.
 *
 * The script:
 * 1. Writes s3fs credentials from env vars
 * 2. Creates the workspace mount directory
 * 3. Mounts R2 via s3fs with retries
 * 4. Sets up cd-override traps to prevent path traversal outside /workspace
 */
export function buildR2ContainerInitScript(): string {
  // Build the s3fs options as individual -o flags for the init script
  const s3fsFlagLines = S3FS_BASE_OPTIONS
    .map((opt) => `      -o ${opt}`)
    .join(' \\\n');

  const lines: string[] = [
    '#!/bin/bash',
    '# R2 Terminal Container Init Script',
    '# Mounts user R2 workspace at /workspace and drops into safe shell',
    '',
    'set -e',
    '',
    'WORKSPACE_MOUNT="${WORKSPACE_MOUNT:-/workspace}"',
    'R2_BUCKET="${R2_BUCKET:-}"',
    'R2_WORKSPACE_PREFIX="${R2_WORKSPACE_PREFIX:-}"',
    'R2_ENDPOINT="${R2_ENDPOINT:-}"',
    'R2_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:-}"',
    'R2_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:-}"',
    '',
    '# === Validate env vars ===',
    'if [ -z "$R2_BUCKET" ] || [ -z "$R2_ACCESS_KEY_ID" ] || [ -z "$R2_SECRET_ACCESS_KEY" ]; then',
    '  echo "R2 credentials not set. Falling back to empty workspace." >&2',
    '  mkdir -p "$WORKSPACE_MOUNT"',
    '  exit 0',
    'fi',
    '',
    '# === Write s3fs credentials ===',
    'PASSWD_FILE="/tmp/.s3fs-passwd-$$"',
    'echo "${R2_ACCESS_KEY_ID}:${R2_SECRET_ACCESS_KEY}" > "$PASSWD_FILE"',
    'chmod 600 "$PASSWD_FILE"',
    '',
    '# === Mount R2 ===',
    'mkdir -p "$WORKSPACE_MOUNT"',
    'mkdir -p /tmp/s3fs-cache',
    '',
    'S3FS_URL="${R2_ENDPOINT:-https://r2.cloudflarestorage.com}"',
    '',
    '# Attempt s3fs mount with retries',
    'for i in 1 2 3; do',
    '  if s3fs "${R2_BUCKET}:/${R2_WORKSPACE_PREFIX}" \\',
    '      "$WORKSPACE_MOUNT" \\',
    '      -o allow_other \\',
    '      -o "url=$S3FS_URL" \\',
    '      -o "passwd_file=$PASSWD_FILE" \\',
    s3fsFlagLines,
    '      2>/tmp/s3fs-mount-err.$$; then',
    '    echo "R2 mounted at $WORKSPACE_MOUNT (attempt $i)" >&2',
    '    rm -f "$PASSWD_FILE" /tmp/s3fs-mount-err.$$',
    '    break',
    '  fi',
    '  echo "s3fs mount attempt $i failed, retrying..." >&2',
    '  sleep 2',
    'done',
    '',
    '# Check if mount succeeded',
    'if ! mountpoint -q "$WORKSPACE_MOUNT" 2>/dev/null; then',
    '  echo "s3fs mount failed after retries. Using empty workspace." >&2',
    '  rm -f "$PASSWD_FILE"',
    '  mkdir -p "$WORKSPACE_MOUNT"',
    'fi',
    '',
    '# === Change to workspace ===',
    'cd "$WORKSPACE_MOUNT" || cd /workspace || cd /',
    '',
    '# === PATH TRAVERSAL PREVENTION ===',
    'cd() {',
    '    local target="$1"',
    '    if [ -z "$target" ]; then',
    '        builtin cd "$WORKSPACE_MOUNT"',
    '        return $?',
    '    fi',
    '    local resolved',
    '    if [[ "$target" = /* ]]; then',
    '        resolved="$target"',
    '    else',
    '        resolved="$(pwd)/$target"',
    '    fi',
    '    resolved="$(cd "$resolved" 2>/dev/null && pwd -P)" || resolved=""',
    '    if [ -z "$resolved" ]; then',
    '        local check="$(pwd)/$target"',
    '        case "$check" in',
    '            "$WORKSPACE_MOUNT"/*) builtin cd "$target"; return $? ;;',
    '            "$WORKSPACE_MOUNT") builtin cd "$target"; return $? ;;',
    '            *) echo "cd: Path traversal blocked - must stay within workspace" >&2; return 1 ;;',
    '        esac',
    '    fi',
    '    if [[ "$resolved" != "$WORKSPACE_MOUNT" && "$resolved" != "$WORKSPACE_MOUNT"/* ]]; then',
    '        echo "cd: Path traversal blocked - must stay within workspace" >&2',
    '        return 1',
    '    fi',
    '    builtin cd "$resolved"',
    '}',
    '',
    '# === Start shell ===',
    'export HOME="$WORKSPACE_MOUNT"',
    'export PS1=\'\\[\\033[1;32m\\]➜\\[\\033[0m\\] \\[\\033[36m\\]\\u\\[\\033[0m\\]@\\[\\033[33m\\]workspace\\[\\033[0m\\] \\W \\$ \'',
    'exec "${SHELL:-/bin/bash}" -i',
  ];

  return lines.join('\n') + '\n';
}

/**
 * Check if a path is a mounted FUSE filesystem.
 */
function isMounted(mountPoint: string): boolean {
  try {
    const output = fs.readFileSync('/proc/mounts', 'utf-8');
    return output.split('\n').some((line) => line.startsWith('s3fs ') && line.includes(mountPoint));
  } catch {
    return false;
  }
}

/**
 * Resolve the workspace directory for an R2-mounted session.
 * For R2 mode, the workspace IS the R2 mount point — no materialization needed.
 */
export function resolveR2WorkspaceDir(userId: string): string {
  if (MOUNT_INSIDE_CONTAINER) {
    return '/workspace';
  }
  return getHostMountPoint(userId);
}

/**
 * Clean up orphaned R2 FUSE mounts from previous process crashes.
 * Call once at startup to recover from unclean shutdowns.
 * Idempotent — safe to call even if no orphaned mounts exist.
 */
export async function cleanupOrphanedR2Mounts(): Promise<void> {
  if (!fs.existsSync(HOST_MOUNT_ROOT)) return;

  const { execFile } = await import('child_process');
  let cleaned = 0;

  try {
    const entries = fs.readdirSync(HOST_MOUNT_ROOT, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const mountPath = path.join(HOST_MOUNT_ROOT, entry.name);

      if (isMounted(mountPath)) {
        logger.info('Cleaning up orphaned R2 mount', { mountPath });
        await new Promise<void>((resolve) => {
          execFile('fusermount', ['-uz', mountPath], { timeout: 5000 }, (err) => {
            if (err) {
              execFile('umount', ['-f', mountPath], { timeout: 5000 }, () => resolve());
            } else {
              resolve();
            }
          });
        });
        cleaned++;
      }

      try {
        if (!isMounted(mountPath) && fs.readdirSync(mountPath).length === 0) {
          fs.rmdirSync(mountPath);
        }
      } catch { /* ignore */ }
    }
  } catch (err: any) {
    logger.warn('Error during orphaned R2 mount cleanup', { error: err.message });
  }

  if (cleaned > 0) {
    logger.info('Cleaned up orphaned R2 mounts', { count: cleaned });
  }
}
