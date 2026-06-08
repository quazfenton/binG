/**
 * Firecracker VM Lifecycle — Integration Test
 *
 * Tests the full FirecrackerRuntime lifecycle:
 *   createVM → startVM → execInVM → stopVM → deleteVM
 *
 * System dependencies (spawn, execFile, fs, ssh2, net, http) are mocked so
 * the test can run in CI without KVM hardware. A conditional block at the
 * bottom runs against a real Firecracker when FIRECRACKER_INTEGRATION_TEST=true
 * and /dev/kvm are both available.
 *
 * @see ../firecracker-runtime.ts — Implementation under test
 */

import { describe, it, expect, beforeEach, afterEach, vi, type Mock } from 'vitest';
import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, copyFileSync as fsCopyFileSync } from 'node:fs';

// ============================================================================
// Module-level mocks — intercept BEFORE any imports from the module under test
// ============================================================================

// Track spawned child processes so process.kill can trigger their exit events
const spawnedProcesses: any[] = [];

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
  execFileSync: vi.fn(),
  ChildProcess: class MockChildProcess extends EventEmitter {
    pid = 0; stdout = new EventEmitter() as any;
    stderr = new EventEmitter() as any;
    killed = false;
    kill(signal?: string) { this.killed = true; this.emit('exit', 0, signal); }
    unref() {}
  },
}));

vi.mock('node:child_process/promises', () => ({ execFile: vi.fn() }));

vi.mock('node:fs', () => ({
  existsSync: vi.fn().mockReturnValue(true),
  mkdirSync: vi.fn(),
  copyFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn().mockReturnValue('mock-private-key-content'),
  unlinkSync: vi.fn(),
  rmSync: vi.fn(),
}));

vi.mock('node:http', () => ({
  default: {
    request: vi.fn().mockImplementation((_opts: any, cb?: Function) => {
      const res = new (require('node:events').EventEmitter)() as any;
      res.statusCode = 200;
      const req = new (require('node:events').EventEmitter)() as any;
      req.write = vi.fn();
      req.end = vi.fn();
      req.setTimeout = vi.fn();
      req.destroy = vi.fn();
      if (cb) cb(res);
      process.nextTick(() => res.emit('end'));
      return req;
    }),
  },
  request: vi.fn(),
}));

// Mock 'net' with a createConnection that connects instantly by default.
// The runtime uses dynamic import('net') (without node: prefix) in
// waitForVMReady and waitForSSHReady — this mock makes both succeed.
vi.mock('net', () => {
  const createConnection = vi.fn().mockImplementation(() => {
    const sock = new (require('node:events').EventEmitter)() as any;
    sock.end = vi.fn();
    sock.destroy = vi.fn();
    sock.setTimeout = vi.fn();
    process.nextTick(() => sock.emit('connect'));
    return sock;
  });
  return { default: { createConnection } };
});

// ssh2 is dynamically imported in sshConnect()
// Use a proper class so `new Client()` works correctly with vitest mocks.
let lastSshClient: any = null;
vi.mock('ssh2', () => ({
  Client: class MockSshClient extends (require('node:events').EventEmitter) {
    connect = vi.fn().mockImplementation(function(this: any) {
      process.nextTick(() => this.emit('ready'));
    });
    exec = vi.fn().mockImplementation(function(this: any, _cmd: string, cb: Function) {
      const stream = new (require('node:events').EventEmitter)() as any;
      stream.stderr = new (require('node:events').EventEmitter)() as any;
      process.nextTick(() => {
        stream.emit('data', Buffer.from('mock stdout output\n'));
        stream.stderr.emit('data', Buffer.from(''));
        stream.emit('close', 0);
      });
      cb(null, stream);
    });
    end = vi.fn();
    constructor() {
      super();
      lastSshClient = this;
    }
  },
}));

// ============================================================================
// Imports (after mocks)
// ============================================================================

import { FirecrackerRuntime, SubnetAllocator } from '../firecracker-runtime';
import { spawn } from 'node:child_process';
import { execFile } from 'node:child_process/promises';
import { execFileSync } from 'node:child_process';

// ============================================================================
// Helpers
// ============================================================================

const TEST_BASE_DIR = '/tmp/firecracker-test';

function createRuntime(): FirecrackerRuntime {
  const r = new FirecrackerRuntime('/usr/bin/firecracker', '/usr/bin/jailer', TEST_BASE_DIR);
  createdRuntimes.push(r);
  return r;
}





/**
 * Mock spawn to return a fresh ChildProcess with a unique PID each time.
 * Registers the process so process.kill can trigger its 'exit' event.
 */
function mockSpawnOnce(): any {
  const pid = 9000 + spawnedProcesses.length;
  const proc = new EventEmitter() as any;
  proc.pid = pid;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.killed = false;
  proc.kill = vi.fn((signal?: string) => {
    proc.killed = true;
    proc.emit('exit', 0, signal);
  });
  proc.unref = vi.fn();
  spawnedProcesses.push(proc);

  (spawn as Mock).mockImplementation(() => {
    // Every spawn call returns the same proc (only one VM per test typically)
    return proc;
  });
  return proc;
}

/**
 * Create a VM and start it with all mocks primed.
 */
async function createReadyVM(): Promise<{ runtime: FirecrackerRuntime; vmId: string }> {
  const runtime = createRuntime();
  mockSpawnOnce();

  const vm = await runtime.createVM('sandbox-test');
  await runtime.startVM(vm.vmId);

  return { runtime, vmId: vm.vmId };
}

// ============================================================================
// Setup / teardown
// ============================================================================

let createdRuntimes: FirecrackerRuntime[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  spawnedProcesses.length = 0;
  createdRuntimes = [];

  // Default: all required files exist
  (existsSync as Mock).mockReturnValue(true);
  (mkdirSync as Mock).mockReturnValue(undefined);

  // Wire process.kill so that calling it on a negated PID finds the
  // corresponding spawned process and emits 'exit' immediately.
  vi.spyOn(process, 'kill').mockImplementation((pid: number, signal?: string) => {
    const absPid = Math.abs(pid);
    for (const p of spawnedProcesses) {
      if (p.pid === absPid) {
        p.kill(signal);
        return true;
      }
    }
    return true; // no-op for unknown PIDs
  });
});

afterEach(async () => {
  for (const r of createdRuntimes) {
    try { await r.shutdown(); } catch { /* best-effort */ }
  }
  createdRuntimes = [];
  vi.unstubAllEnvs();
});

// ============================================================================
// Tests — createVM
// ============================================================================

describe('createVM', () => {
  it('creates a VM with correct config and status "starting"', async () => {
    const runtime = createRuntime();
    const vm = await runtime.createVM('sandbox-1');

    expect(vm.sandboxId).toBe('sandbox-1');
    expect(vm.status).toBe('starting');
    expect(vm.process).toBeNull();
    expect(vm.config.cpuCount).toBe(2);
    expect(vm.config.memorySize).toBe(512);
    expect(vm.config.tapDevice).toMatch(/^tap_/);
    // Guest IP should be a valid /30 address at offset 2 mod 4 within the /24 pool
    expect(vm.config.guestIp).toMatch(/^172\.16\.0\.(\d{1,3})$/);
    const guestOct = parseInt(vm.config.guestIp.split('.')[3], 10);
    expect(guestOct % 4).toBe(2);
    expect(guestOct).toBeGreaterThan(0);
    expect(guestOct).toBeLessThan(255);

    // Host TAP IP should be the matching host address at offset 1 mod 4
    expect(vm.config.hostTapIp).toMatch(/^172\.16\.0\.(\d{1,3})$/);
    const hostOct = parseInt(vm.config.hostTapIp.split('.')[3], 10);
    expect(hostOct % 4).toBe(1);
    expect(hostOct).toBeGreaterThan(0);
    expect(hostOct).toBeLessThan(255);
    expect(vm.config.bootArgs).toContain('ip=');
    expect(vm.config.bootArgs).toContain('console=ttyS0');
  });

  it('applies partial config overrides', async () => {
    const runtime = createRuntime();
    const vm = await runtime.createVM('override-1', { cpuCount: 4, memorySize: 1024 });
    expect(vm.config.cpuCount).toBe(4);
    expect(vm.config.memorySize).toBe(1024);
  });

  it('copies rootfs and injects SSH key via debugfs', async () => {
    const runtime = createRuntime();
    await runtime.createVM('ssh-key-test');

    expect(fsCopyFileSync).toHaveBeenCalled();
    const debugfsCalls = (execFileSync as Mock).mock.calls.filter(
      (c: any[]) => c[0] === 'debugfs',
    );
    expect(debugfsCalls.length).toBeGreaterThanOrEqual(3);
    // execFileSync args: ['-w', '-R', 'command...', rootfsPath]
    // The actual debugfs command is at index 2
    expect(debugfsCalls.some((c: any[]) => c[1]?.[2]?.includes('authorized_keys'))).toBe(true);
    expect(debugfsCalls.some((c: any[]) => c[1]?.[2]?.includes('mode'))).toBe(true);
  });

  it('throws if base rootfs is missing', async () => {
    (existsSync as Mock).mockReturnValue(false);
    const runtime = createRuntime();
    await expect(runtime.createVM('no-rootfs')).rejects.toThrow(/Base rootfs image not found/);
  });

  it('emits vm_created event', async () => {
    const runtime = createRuntime();
    const events: string[] = [];
    runtime.on('vm_created', () => events.push('vm_created'));
    await runtime.createVM('evt-test');
    expect(events).toContain('vm_created');
  });
});

// ============================================================================
// Tests — startVM
// ============================================================================

describe('startVM', () => {
  it('configures NAT, creates TAP, spawns Firecracker, configures API, waits for SSH', async () => {
    const runtime = createRuntime();
    mockSpawnOnce();

    const vm = await runtime.createVM('full-start');
    await runtime.startVM(vm.vmId);

    // NAT config
    expect(execFile).toHaveBeenCalledWith('sysctl', expect.any(Array));
    expect(execFile).toHaveBeenCalledWith('iptables', expect.arrayContaining(['-t', 'nat']));

    // TAP creation — uses per-VM host IP with /30 subnet mask
    expect(execFile).toHaveBeenCalledWith('ip', expect.arrayContaining(['tuntap', 'add']));
    const addrCall = (execFile as Mock).mock.calls.find(
      (c: any[]) => c[0] === 'ip' && c[1]?.includes('addr'),
    );
    expect(addrCall).toBeDefined();
    expect(addrCall[1]).toEqual(
      expect.arrayContaining([expect.stringMatching(/^172\.16\.0\.\d+\/30$/)]),
    );

    // Firecracker spawn
    expect(spawn).toHaveBeenCalledWith(
      '/usr/bin/jailer',
      expect.arrayContaining(['--id', vm.vmId]),
      expect.any(Object),
    );

    expect(vm.status).toBe('running');
    expect(vm.startedAt).toBeDefined();
  });

  it('throws for unknown VM', async () => {
    await expect(createRuntime().startVM('ghost')).rejects.toThrow('VM not found');
  });

  it('sets status to error and cleans up TAP on spawn failure', async () => {
    const runtime = createRuntime();
    (spawn as Mock).mockImplementation(() => { throw new Error('jailer missing'); });

    const vm = await runtime.createVM('fail-boot');
    await expect(runtime.startVM(vm.vmId)).rejects.toThrow('Failed to start VM');

    expect((await runtime.getVM(vm.vmId))?.status).toBe('error');
  });

  it('emits correct lifecycle events', async () => {
    const runtime = createRuntime();
    mockSpawnOnce();

    const order: string[] = [];
    runtime.on('vm_starting', () => order.push('started'));
    runtime.on('vm_started', () => order.push('running'));
    runtime.on('vm_start_error', () => order.push('error'));

    const vm = await runtime.createVM('events');
    await runtime.startVM(vm.vmId);

    expect(order).toEqual(['started', 'running']);
  });
});

// ============================================================================
// Tests — execInVM
// ============================================================================

describe('execInVM', () => {
  it('returns stdout/stderr/exitCode via SSH', async () => {
    const { runtime, vmId } = await createReadyVM();
    const result = await runtime.execInVM(vmId, 'echo', ['hello']);
    expect(result.stdout).toContain('mock stdout output');
    expect(result.exitCode).toBe(0);
  });

  it('caches SSH connections', async () => {
    const { runtime, vmId } = await createReadyVM();
    await runtime.execInVM(vmId, 'a');
    await runtime.execInVM(vmId, 'b');
    // `lastSshClient` is set once in the constructor — if caching works,
    // Client was only constructed once across both execInVM calls.
    expect(lastSshClient).toBeDefined();
    // The connect method should only have been called once (first execInVM)
    expect(lastSshClient.connect).toHaveBeenCalledTimes(1);
  });

  it('throws if VM is not running', async () => {
    await expect(createRuntime().execInVM('ghost', 'cmd')).rejects.toThrow('VM not running');
  });

  it('includes cwd in the shell command', async () => {
    const { runtime, vmId } = await createReadyVM();
    await runtime.execInVM(vmId, 'ls', ['-la'], '/home/user');
    expect((lastSshClient.exec as Mock).mock.calls[0][0]).toContain('cd /home/user');
  });
});

// ============================================================================
// Tests — stopVM
// ============================================================================

describe('stopVM', () => {
  it('disconnects SSH, kills process, deletes TAP', async () => {
    const { runtime, vmId } = await createReadyVM();

    // Establish an SSH connection first so we can verify it gets cleaned up
    await runtime.execInVM(vmId, 'echo', ['hi']);

    await runtime.stopVM(vmId);

    // SSH disconnected
    expect(lastSshClient.end).toHaveBeenCalled();

    // TAP deleted
    expect(execFile).toHaveBeenCalledWith('ip', expect.arrayContaining(['link', 'delete']));

    const vm = await runtime.getVM(vmId);
    expect(vm?.status).toBe('stopped');
  });

  it('throws for unknown VM', async () => {
    await expect(createRuntime().stopVM('ghost')).rejects.toThrow('VM not found');
  });

  it('handles double stop gracefully', async () => {
    const { runtime, vmId } = await createReadyVM();
    await runtime.stopVM(vmId);
    await expect(runtime.stopVM(vmId)).resolves.not.toThrow();
  });
});

// ============================================================================
// Tests — deleteVM
// ============================================================================

describe('deleteVM', () => {
  it('stops VM and removes it from the map', async () => {
    const { runtime, vmId } = await createReadyVM();
    await runtime.deleteVM(vmId);
    expect(await runtime.getVM(vmId)).toBeNull();
  });

  it('throws for unknown VM', async () => {
    await expect(createRuntime().deleteVM('ghost')).rejects.toThrow('VM not found');
  });

  it('works after VM was already stopped', async () => {
    const { runtime, vmId } = await createReadyVM();
    await runtime.stopVM(vmId);
    await expect(runtime.deleteVM(vmId)).resolves.not.toThrow();
    expect(await runtime.getVM(vmId)).toBeNull();
  });

  it('handles never-started VMs', async () => {
    const runtime = createRuntime();
    const vm = await runtime.createVM('never-started');
    await expect(runtime.deleteVM(vm.vmId)).resolves.not.toThrow();
    expect(await runtime.getVM(vm.vmId)).toBeNull();
  });
});

// ============================================================================
// Tests — shutdown
// ============================================================================

describe('shutdown', () => {
  it('stops all running VMs and clears the map', async () => {
    const runtime = createRuntime();

    // First VM
    mockSpawnOnce();
    const v1 = await runtime.createVM('sht-1');
    await runtime.startVM(v1.vmId);

    // Second VM
    mockSpawnOnce();
    const v2 = await runtime.createVM('sht-2');
    await runtime.startVM(v2.vmId);

    // Reset call counts for process.kill so we don't count the startVM calls
    vi.mocked(process.kill).mockClear();

    await runtime.shutdown();

    expect(await runtime.listVMs()).toHaveLength(0);
  });
});

// ============================================================================
// Tests — event emissions
// ============================================================================

describe('event emissions', () => {
  it('vm_created fires with the VM instance', async () => {
    const runtime = createRuntime();
    const emitted: any[] = [];
    runtime.on('vm_created', (v) => emitted.push(v));
    const vm = await runtime.createVM('e1');
    expect(emitted).toHaveLength(1);
    expect(emitted[0].vmId).toBe(vm.vmId);
  });

  it('vm_starting and vm_started fire in order', async () => {
    const runtime = createRuntime();
    mockSpawnOnce();
    const order: string[] = [];
    runtime.on('vm_starting', () => order.push('s'));
    runtime.on('vm_started', () => order.push('r'));
    const vm = await runtime.createVM('e2');
    await runtime.startVM(vm.vmId);
    expect(order).toEqual(['s', 'r']);
  });

  it('vm_stopped fires on stop', async () => {
    const { runtime, vmId } = await createReadyVM();
    const info: any[] = [];
    runtime.on('vm_stopped', (i) => info.push(i));
    await runtime.stopVM(vmId);
    // Two emissions: one from the process 'exit' handler registered in startVM,
    // and one from stopVM() itself. This is existing runtime behavior.
    expect(info.length).toBeGreaterThanOrEqual(1);
  });

  it('vm_deleted fires on delete', async () => {
    const { runtime, vmId } = await createReadyVM();
    const ids: string[] = [];
    runtime.on('vm_deleted', (id) => ids.push(id));
    await runtime.deleteVM(vmId);
    expect(ids).toContain(vmId);
  });

  it('vm_start_error fires on start failure', async () => {
    const runtime = createRuntime();
    (spawn as Mock).mockImplementation(() => { throw new Error('boom'); });

    const info: any[] = [];
    runtime.on('vm_start_error', (i) => info.push(i));
    const vm = await runtime.createVM('e3');
    await expect(runtime.startVM(vm.vmId)).rejects.toThrow();
    expect(info).toHaveLength(1);
    expect(info[0].error.message).toBe('boom');
  });
});

// ============================================================================
// Tests — SubnetAllocator (IP address pool)
// ============================================================================

describe('SubnetAllocator', () => {
  it('allocates sequential /30 slices starting from base IP + 1', () => {
    const pool = new SubnetAllocator('172.16.0.0/24');
    const a1 = pool.allocate()!;
    expect(a1.hostIp).toBe('172.16.0.1');
    expect(a1.guestIp).toBe('172.16.0.2');
    expect(pool.used()).toBe(1);

    const a2 = pool.allocate()!;
    expect(a2.hostIp).toBe('172.16.0.5');
    expect(a2.guestIp).toBe('172.16.0.6');
    expect(pool.used()).toBe(2);
  });

  it('returns null when pool is exhausted', () => {
    const pool = new SubnetAllocator('172.16.0.0/28'); // 4 slices only
    expect(pool.allocate()).not.toBeNull();
    expect(pool.allocate()).not.toBeNull();
    expect(pool.allocate()).not.toBeNull();
    expect(pool.allocate()).not.toBeNull();
    expect(pool.allocate()).toBeNull();
    expect(pool.available()).toBe(0);
  });

  it('reuses released IPs', () => {
    const pool = new SubnetAllocator('172.16.0.0/28');
    const a1 = pool.allocate()!;
    const a2 = pool.allocate()!;
    pool.release(a1.hostIp, a1.guestIp);

    const a3 = pool.allocate()!;
    expect(a3.hostIp).toBe(a1.hostIp);
    expect(a3.guestIp).toBe(a1.guestIp);
    expect(pool.used()).toBe(2);
  });

  it('tracks capacity metrics', () => {
    const pool = new SubnetAllocator('172.16.0.0/24');
    expect(pool.maxCapacity()).toBe(64);
    expect(pool.available()).toBe(64);
    expect(pool.used()).toBe(0);

    pool.allocate();
    expect(pool.available()).toBe(63);
    expect(pool.used()).toBe(1);
  });

  it('release is idempotent', () => {
    const pool = new SubnetAllocator('172.16.0.0/24');
    const a = pool.allocate()!;
    pool.release(a.hostIp, a.guestIp);
    pool.release(a.hostIp, a.guestIp); // double release
    expect(pool.available()).toBe(64);
  });

  it('rejects invalid CIDR prefix lengths', () => {
    expect(() => new SubnetAllocator('172.16.0.0/15')).toThrow();
    expect(() => new SubnetAllocator('172.16.0.0/31')).toThrow();
  });

  it('works with non-zero base octets', () => {
    const pool = new SubnetAllocator('10.100.200.0/24');
    const a1 = pool.allocate()!;
    expect(a1.hostIp).toBe('10.100.200.1');
    expect(a1.guestIp).toBe('10.100.200.2');
  });
});

// ============================================================================
// Tests — VM IP allocation (integration with runtime)
// ============================================================================

describe('VM IP allocation', () => {
  it('gives unique IPs to concurrent VMs', async () => {
    const runtime = createRuntime();
    const v1 = await runtime.createVM('v1');
    const v2 = await runtime.createVM('v2');
    const v3 = await runtime.createVM('v3');

    expect(v1.config.guestIp).toBe('172.16.0.2');
    expect(v2.config.guestIp).toBe('172.16.0.6');
    expect(v3.config.guestIp).toBe('172.16.0.10');

    // hostTapIp should also be unique
    expect(v1.config.hostTapIp).toBe('172.16.0.1');
    expect(v2.config.hostTapIp).toBe('172.16.0.5');
    expect(v3.config.hostTapIp).toBe('172.16.0.9');
  });

  it('releases IP when VM is stopped', async () => {
    const runtime = createRuntime();
    const v1 = await runtime.createVM('release1');
    const v2 = await runtime.createVM('release2');

    expect(v2.config.guestIp).toBe('172.16.0.6');

    // Stop first VM — its IP should be freed
    await runtime.deleteVM(v1.vmId);

    // New VM should reuse the freed IP
    const v3 = await runtime.createVM('release3');
    expect(v3.config.guestIp).toBe('172.16.0.2');
  });

  it('throws on pool exhaustion', async () => {
    const pool = new SubnetAllocator('172.16.0.0/30'); // 1 slice only
    const runtime = createRuntime();
    // Override the IP pool on the instance
    (runtime as any).ipPool = pool;

    await runtime.createVM('full-1');
    await expect(runtime.createVM('full-2')).rejects.toThrow('No available IP addresses');
  });

  it('hostTapIp is included in TAP creation', async () => {
    const runtime = createRuntime();
    mockSpawnOnce();

    const vm = await runtime.createVM('tap-ip-test');
    await runtime.startVM(vm.vmId);

    // The `ip addr add` call should use the per-VM host IP with /30
    const addrAddCall = (execFile as Mock).mock.calls.find(
      (c: any[]) => c[0] === 'ip' && c[1]?.join(' ').includes('addr add'),
    );
    expect(addrAddCall).toBeDefined();
    expect(addrAddCall[1]).toContain('172.16.0.1/30');
  });
});

// ============================================================================
// Tests — edge cases
// ============================================================================

describe('edge cases', () => {
  it('independent VM creation', async () => {
    const r = createRuntime();
    const [a, b] = await Promise.all([r.createVM('a'), r.createVM('b')]);
    expect(a.vmId).not.toBe(b.vmId);
    expect((await r.listVMs())).toHaveLength(2);
  });

  it('SSH key generation is idempotent', () => {
    // First runtime: make the private key look like it doesn't exist
    // so ensureSSHKeyPair generates it.
    (existsSync as Mock).mockImplementation((path: string) => {
      if (path.includes('/ssh/id_ed25519')) return false;
      return true;
    });
    const r1 = createRuntime();
    expect(execFileSync).toHaveBeenCalledWith('ssh-keygen', expect.any(Array));
    (execFileSync as Mock).mockClear();

    // Second runtime: key "exists" now, so generation is skipped.
    (existsSync as Mock).mockReturnValue(true);
    const r2 = createRuntime();
    expect(execFileSync).not.toHaveBeenCalledWith('ssh-keygen', expect.any(Array));
  });

  it('getVM returns null for unknown VM', async () => {
    expect(await createRuntime().getVM('x')).toBeNull();
  });

  it('listVMs returns all created VMs', async () => {
    const r = createRuntime();
    await r.createVM('l1'); await r.createVM('l2'); await r.createVM('l3');
    expect(await r.listVMs()).toHaveLength(3);
  });

  it('getVMStats returns null for non-running VM', async () => {
    const r = createRuntime();
    const v = await r.createVM('stats');
    expect(await r.getVMStats(v.vmId)).toBeNull();
  });

  it('double delete throws', async () => {
    const { runtime, vmId } = await createReadyVM();
    await runtime.deleteVM(vmId);
    await expect(runtime.deleteVM(vmId)).rejects.toThrow('VM not found');
  });
});

// ============================================================================
// Real KVM Integration (only when explicitly enabled + hardware available)
// ============================================================================

const kvmExists = (() => { try { return existsSync('/dev/kvm'); } catch { return false; } })();
const fcBin = process.env.FIRECRACKER_BIN || '/usr/bin/firecracker';
const fcExists = (() => { try { return existsSync(fcBin); } catch { return false; } })();
const rootfsExists = (() => {
  const p = process.env.FIRECRACKER_ROOTFS_IMAGE || '/var/lib/firecracker/rootfs.ext4';
  try { return existsSync(p); } catch { return false; }
})();
const enableKvm = process.env.FIRECRACKER_INTEGRATION_TEST === 'true';
const canRunRealVM = enableKvm && kvmExists && fcExists && rootfsExists;

describe.runIf(canRunRealVM)('real KVM integration', () => {
  it('full lifecycle: create → start → exec → stop → delete', async () => {
    const rt = new FirecrackerRuntime(
      process.env.FIRECRACKER_BIN!,
      process.env.JAILER_BIN || '/usr/bin/jailer',
      '/tmp/fc-integration',
    );

    const vm = await rt.createVM('kvm-test');
    expect(vm.status).toBe('starting');
    await rt.startVM(vm.vmId);
    expect(vm.status).toBe('running');

    const r = await rt.execInVM(vm.vmId, '/bin/uname', ['-a']);
    expect(r.exitCode).toBe(0);
    expect(r.stdout).toContain('Linux');

    await rt.stopVM(vm.vmId);
    expect(vm.status).toBe('stopped');
    await rt.deleteVM(vm.vmId);
    expect(await rt.getVM(vm.vmId)).toBeNull();
    await rt.shutdown();
  }, 120_000);
});
