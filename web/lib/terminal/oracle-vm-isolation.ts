/**
 * Oracle VM Per-User Isolation Helpers
 *
 * Replaces the shared-shell Oracle VM mode (all users in the same workspace)
 * with per-user isolated environments using bwrap, chroot, or Docker on the
 * remote VM.
 *
 * Isolation levels (tried in order):
 *   1. bwrap (bubblewrap) — unprivileged container with full namespace isolation
 *   2. chroot       — minimal rootfs with filesystem jail (no namespace isolation)
 *   3. docker       — full Docker container on the remote VM (if daemon available)
 *   4. shared-shell — fallback to original behavior with cd-override (least secure)
 *
 * Each user gets their own workspace directory:
 *   <ORACLE_VM_WORKSPACE>/users/<sanitizedUserId>/
 *
 * The isolated environment provides:
 *   - Private /workspace (user's directory bind-mounted)
 *   - Read-only system directories (/usr, /bin, /lib, /lib64, /etc)
 *   - Private /tmp, /dev, /proc for bwrap mode
 *   - Network isolation (--unshare-net for bwrap, --network none for docker)
 *   - Resource limits (docker only: --memory, --cpus)
 */

import { createLogger } from '@/lib/utils/logger';

const logger = createLogger('OracleVMIsolation');

// === Configuration ===

/** Base workspace on the Oracle VM. Per-user dirs created under <base>/users/<id>/ */
const VM_WORKSPACE_BASE = process.env.ORACLE_VM_WORKSPACE || '/home/opc/workspace';

/** Memory limit for Docker-based isolation on the remote VM */
const DOCKER_MEMORY = process.env.ORACLE_VM_DOCKER_MEMORY || '512m';

/** CPU limit for Docker-based isolation */
const DOCKER_CPU = process.env.ORACLE_VM_DOCKER_CPU || '1';

/** Docker image to use on the remote VM (must be pre-pulled) */
const DOCKER_IMAGE = process.env.ORACLE_VM_DOCKER_IMAGE || 'ubuntu:22.04';

/** Minimum rootfs for chroot fallback — a tarball at this path on the VM */
export const CHROOT_ROOTFS_TARBALL = process.env.ORACLE_VM_CHROOT_TARBALL || '/opt/rootfs.tar.gz';

// === Public API ===

/**
 * Sanitize a userId for filesystem path safety.
 */
export function sanitizeOracleUserId(userId: string): string {
  let id = userId.replace(/^anon:/, '');
  id = id.replace(/\.\./g, '').replace(/[\\/ \0]/g, '_');
  return id.substring(0, 128) || '_default';
}

/**
 * Get the per-user workspace directory on the Oracle VM.
 */
export function getOracleUserWorkspace(userId: string): string {
  return `${VM_WORKSPACE_BASE}/users/${sanitizeOracleUserId(userId)}`;
}

// ============================================================================
// Remote command builders — return arrays of shell commands to run via SSH exec
// ============================================================================

/**
 * Build the remote setup commands for a bwrap-based isolated session.
 *
 * bwrap (bubblewrap) creates an unprivileged container with:
 *   - Private /workspace (user's directory, read-write)
 *   - Read-only system bindings (/usr, /bin, /lib, /lib64, /etc)
 *   - Private /tmp (tmpfs), /dev, /proc
 *   - All namespaces unshared (mount, pid, user, net, ipc, uts, cgroup)
 *   - --die-with-parent: container exits when SSH connection drops
 *
 * Returns the full command to start the isolated shell.
 */
export function buildBwrapSetupCommands(userId: string): {
  setupCommands: string[];     // Commands to run before opening shell
  shellCommand: string;        // Command to open the isolated interactive shell
  workspacePath: string;       // The user's workspace path inside the container
} {
  const userWs = getOracleUserWorkspace(userId);
  const safeWs = shellSafe(userWs);

  // Setup: create workspace dir with proper permissions
  const setupCommands = [
    `mkdir -p ${safeWs}`,
    `chmod 700 ${safeWs}`,
    // Ensure bwrap is available
    `which bwrap >/dev/null 2>&1 || echo "BWRAP_NOT_FOUND"`,
  ];

  // bwrap command to isolate the shell
  // The workspace bind-mount is read-write; system dirs are read-only
  const shellCommand = [
    'bwrap',
    '--unshare-all',           // All namespaces
    '--die-with-parent',       // Exit when parent (SSH) dies
    // Read-only system bindings
    '--ro-bind', '/usr', '/usr',
    '--ro-bind', '/bin', '/bin',
    '--ro-bind', '/sbin', '/sbin',
    '--ro-bind', '/lib', '/lib',
    '--ro-bind', '/lib64', '/lib64',
    '--ro-bind', '/etc', '/etc',
    // Read-write workspace
    '--bind', safeWs, '/workspace',
    // Private tmp
    '--tmpfs', '/tmp',
    // Device and proc
    '--dev', '/dev',
    '--proc', '/proc',
    // Working directory + shell
    '--chdir', '/workspace',
    '/bin/bash', '-i',
  ].join(' ');

  return { setupCommands, shellCommand, workspacePath: '/workspace' };
}

/**
 * Build the remote setup commands for a chroot-based isolated session.
 *
 * chroot provides filesystem jail (no namespace isolation). Requires a
 * minimal rootfs tarball to be pre-deployed on the VM.
 *
 * Falls back gracefully if the rootfs tarball doesn't exist.
 */
export function buildChrootSetupCommands(userId: string): {
  setupCommands: string[];
  shellCommand: string;
  workspacePath: string;
} {
  const userWs = getOracleUserWorkspace(userId);
  const safeWs = shellSafe(userWs);
  const safeTarball = shellSafe(CHROOT_ROOTFS_TARBALL);

  const setupCommands = [
    `mkdir -p ${safeWs}`,
    `chmod 700 ${safeWs}`,
    // Extract rootfs if this user's chroot doesn't exist yet
    `if [ ! -d "${safeWs}/.chroot" ] && [ -f ${safeTarball} ]; then`,
    `  mkdir -p "${safeWs}/.chroot"`,
    `  tar -xzf ${safeTarball} -C "${safeWs}/.chroot" 2>/dev/null || echo "CHROOT_SETUP_FAILED"`,
    'fi',
    // Bind-mount workspace into chroot
    `mkdir -p "${safeWs}/.chroot/workspace" 2>/dev/null || true`,
    `mount --bind "${safeWs}" "${safeWs}/.chroot/workspace" 2>/dev/null || true`,
  ];

  const shellCommand = `chroot "${safeWs}/.chroot" /bin/bash -i`;

  return { setupCommands, shellCommand, workspacePath: '/workspace' };
}

/**
 * Build the remote setup commands for a Docker-based isolated session on the VM.
 *
 * Requires Docker daemon running on the Oracle VM. Provides full container
 * isolation with resource limits.
 */
export function buildDockerOnVMCommands(userId: string, sessionId: string): {
  setupCommands: string[];
  shellCommand: string;
  workspacePath: string;
  cleanupCommand: string;
} {
  const userWs = getOracleUserWorkspace(userId);
  const safeWs = shellSafe(userWs);
  const containerName = `pty-oracle-${sessionId.slice(0, 12)}`;

  const setupCommands = [
    `mkdir -p ${safeWs}`,
    `chmod 700 ${safeWs}`,
    // Start detached container with workspace bind-mount
    `docker rm -f ${containerName} 2>/dev/null || true`,
    `docker run -d --name ${containerName} \\`,
    `  --memory ${DOCKER_MEMORY} \\`,
    `  --cpus ${DOCKER_CPU} \\`,
    `  --network none \\`,
    `  --security-opt no-new-privileges \\`,
    `  -v ${safeWs}:/workspace \\`,
    `  -w /workspace \\`,
    `  ${DOCKER_IMAGE} \\`,
    `  sleep infinity`,
    // Verify container started
    `sleep 1`,
    `docker inspect -f '{{.State.Running}}' ${containerName} 2>/dev/null || echo "DOCKER_FAILED"`,
  ];

  const shellCommand = `docker exec -it ${containerName} /bin/bash`;
  const cleanupCommand = `docker rm -f ${containerName} 2>/dev/null || true`;

  return { setupCommands, shellCommand, workspacePath: '/workspace', cleanupCommand };
}

/**
 * Build the remote setup commands for a rootless Podman isolated session.
 *
 * Rootless Podman provides full container isolation with cgroup resource limits,
 * seccomp security profiles, and user namespace mapping — without requiring a
 * root-privileged Docker daemon. Podman is daemonless and designed for rootless
 * operation by default.
 *
 * Features:
 *   - User namespace isolation (auto via rootless Podman)
 *   - cgroup v2 resource limits: memory, CPU, PIDs
 *   - Seccomp security profile (customizable via env var)
 *   - Network isolation (--network none)
 *   - No-new-privileges security opt
 *   - Workspace bind-mount (read-write)
 *   - Auto-cleanup on session end
 *
 * Configuration (via environment variables):
 *   ORACLE_VM_PODMAN_MEMORY     — Memory limit (default: 512m)
 *   ORACLE_VM_PODMAN_CPU        — CPU limit (default: 1)
 *   ORACLE_VM_PODMAN_PIDS_LIMIT — Max processes (default: 100)
 *   ORACLE_VM_PODMAN_IMAGE      — Container image (default: ubuntu:22.04)
 *   ORACLE_VM_PODMAN_SECCOMP    — Custom seccomp profile path (optional)
 *
 * ## Seccomp Hardening
 *
 * A hardened seccomp profile is provided at the project root:
 *   seccomp/hardened-podman.json
 *
 * This profile blocks ~65 dangerous syscalls including:
 *   - mount/umount — Prevent filesystem mounting
 *   - kexec_load, kexec_file_load — Prevent loading new kernels
 *   - pivot_root — Prevent chroot container escapes
 *   - init_module, finit_module, delete_module — Kernel module manipulation
 *   - ptrace — Process debugging/tracing (common escape vector)
 *   - bpf — Berkeley Packet Filter (CVE history in containers)
 *   - io_uring_* — Async I/O subsystem (relatively new, CVE-prone)
 *   - fanotify_* — Filesystem event monitoring (escape risk)
 *   - unshare, setns — Namespace manipulation inside container
 *   - seccomp — Prevent container from modifying its own filter
 *   - personality — Execution domain (can break some tools like gcc -m32)
 *   - perf_event_open — Performance monitoring exploitation
 *   - userfaultfd — User-space page fault handling (used in some escapes)
 *   - sethostname, setdomainname — System identity changes
 *   - reboot, swapon, swapoff — System-level operations
 *
 * To use it, copy the profile to the Oracle VM and set the env var:
 *   scp seccomp/hardened-podman.json opc@<vm>:/home/opc/seccomp/
 *   export ORACLE_VM_PODMAN_SECCOMP=/home/opc/seccomp/hardened-podman.json
 *
 * Then restart the service. All new Podman sessions will apply the profile.
 *
 * NOTE: The `personality` syscall is blocked in the hardened profile.
 * This prevents some cross-architecture execution (e.g., gcc -m32) and
 * certain runtime code generators. If you encounter "Operation not permitted"
 * from tools like gcc or JIT compilers, either:
 *   - Remove "personality" from the blocked syscalls in the JSON, or
 *   - Create a custom profile without it
 *
 * This replaces bwrap as the default isolation mode since it provides
 * both namespace isolation AND resource enforcement.
 */
export function buildRootlessPodmanCommands(userId: string, sessionId: string): {
  setupCommands: string[];
  shellCommand: string;
  workspacePath: string;
  cleanupCommand: string;
} {
  const userWs = getOracleUserWorkspace(userId);
  const safeWs = shellSafe(userWs);
  const containerName = `pty-podman-${sessionId.slice(0, 12)}`;
  const image = process.env.ORACLE_VM_PODMAN_IMAGE || 'ubuntu:22.04';
  const memoryLimit = process.env.ORACLE_VM_PODMAN_MEMORY || '512m';
  const cpuLimit = process.env.ORACLE_VM_PODMAN_CPU || '1';
  const pidsLimit = process.env.ORACLE_VM_PODMAN_PIDS_LIMIT || '100';
  const seccompProfile = process.env.ORACLE_VM_PODMAN_SECCOMP;

  const seccompArgs = seccompProfile
    ? `\\
  --security-opt seccomp=${shellSafe(seccompProfile)}`
    : '';

  const setupCommands = [
    `mkdir -p ${safeWs}`,
    `chmod 700 ${safeWs}`,
    // Ensure podman is available
    `which podman >/dev/null 2>&1 || echo "PODMAN_NOT_FOUND"`,
    // Remove any stale container from previous session
    `podman rm -f ${containerName} 2>/dev/null || true`,
    // Start rootless container with workspace bind-mount
    `podman run -d --name ${containerName} \\`,
    `  --memory ${memoryLimit} \\`,
    `  --cpus ${cpuLimit} \\`,
    `  --pids-limit ${pidsLimit} \\`,
    `  --network none \\`,
    `  --security-opt no-new-privileges \\`,
    `  -v ${safeWs}:/workspace:Z \\`,
    `  -w /workspace \\`,
    `${seccompArgs}`,
    `  ${image} \\`,
    `  sleep infinity`,
    // Verify container started
    `sleep 1`,
    `podman inspect -f '{{.State.Running}}' ${containerName} 2>/dev/null || echo "PODMAN_FAILED"`,
  ];

  const shellCommand = `podman exec -i ${containerName} /bin/bash -i`;
  const cleanupCommand = `podman rm -f ${containerName} 2>/dev/null || true`;

  return { setupCommands, shellCommand, workspacePath: '/workspace', cleanupCommand };
}

/**
 * Build the fallback shared-shell setup commands (original behavior).
 *
 * This is the least secure option — all users share the same workspace.
 * Only used when none of the isolation mechanisms are available.
 */
export function buildSharedShellSetupCommands(userId: string, baseWorkspace: string): {
  setupCommands: string[];
  shellCommand: string;
  workspacePath: string;
} {
  const safeBase = shellSafe(baseWorkspace);

  const setupCommands = [
    `mkdir -p ${safeBase}`,
  ];

  const shellCommand = `cd ${safeBase} && /bin/bash -i`;
  return { setupCommands, shellCommand, workspacePath: baseWorkspace };
}

// ============================================================================
// Helpers
// ============================================================================

/**
 * Basic shell-safe quoting for a string used in remote SSH exec commands.
 */
export function shellSafe(s: string): string {
  return `'${s.replace(/'/g, "'\\''")}'`;
}
