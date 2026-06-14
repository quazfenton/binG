/**
 * Firecracker Container Runtime
 * Provides microVM-based sandbox isolation
 * Based on ephemeral/serverless_workers_sdk/container_runtime.py
 */

import { EventEmitter } from 'node:events';
import { spawn, ChildProcess, execFileSync, execFile as execFileCb } from 'child_process';
import { mkdirSync, existsSync, copyFileSync, writeFileSync, readFileSync, unlinkSync } from 'fs';
import http from 'node:http';
import { join } from 'path';
import { randomUUID } from 'crypto';
import { promisify } from 'util';

const execFile = promisify(execFileCb);

// ===========================================
// Abstract Container Runtime Interface
// ===========================================

export interface ResourceLimits {
  vcpuCount: number;
  memSizeMiB: number;
  diskSizeMiB: number;
}

export interface ContainerInfo {
  sandboxId: string;
  workspacePath: string;
  ipAddress?: string;
  createdAt: number;
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number | null;
}

export abstract class ContainerRuntime extends EventEmitter {
  abstract create(
    sandboxId: string,
    image: string,
    resourceLimits?: ResourceLimits
  ): Promise<ContainerInfo>;

  abstract start(sandboxId: string): Promise<boolean>;
  abstract stop(sandboxId: string): Promise<boolean>;
  abstract destroy(sandboxId: string): Promise<boolean>;
  abstract status(sandboxId: string): Promise<string>;
  
  abstract execCommand(
    sandboxId: string,
    command: string,
    args?: string[],
    timeout?: number
  ): Promise<ExecResult>;
}

// ===========================================
// Runtime Type Enum
// ===========================================

export type RuntimeType = 'firecracker' | 'process' | 'auto';

// ===========================================
// Firecracker Runtime Implementation
// ===========================================

export interface FirecrackerConfig {
  socketPath: string;
  kernelImagePath: string;
  rootfsPath: string;
  bootArgs: string;     // Kernel command-line (includes guest IP config)
  logPath: string;
  metricsPath: string;
  cpuCount: number;
  memorySize: number;   // in MB
  tapDevice: string;    // Host TAP device name
  guestIp: string;      // IP assigned to the guest inside the VM
  hostTapIp: string;    // Host-side IP for the TAP device (unique per VM)
}

export interface VMInstance {
  vmId: string;
  sandboxId: string;
  process: ChildProcess | null;
  socketPath: string;
  status: 'starting' | 'running' | 'stopped' | 'error';
  createdAt: Date;
  startedAt?: Date;
  config: FirecrackerConfig;
}

// ===========================================
// IP Address Pool Management
// ===========================================

/**
 * Manages allocation and release of /30 subnet slices from a larger network.
 *
 * Each VM gets a unique /30 slice:
 *   VM n: hostIp = 172.16.0.(4n+1), guestIp = 172.16.0.(4n+2)
 *
 * The .0 (network addr) and .3 (broadcast) addresses in each /30
 * are reserved and never assigned.
 *
 * Example with 172.16.0.0/24:
 *   VM 0: host 172.16.0.1/30  guest 172.16.0.2/30  (pool range 0-3)
 *   VM 1: host 172.16.0.5/30  guest 172.16.0.6/30  (pool range 4-7)
 *   ...
 *   VM 63: host 172.16.0.253/30  guest 172.16.0.254/30  (pool range 252-255)
 */
export class SubnetAllocator {
  private readonly baseIp: number;
  private readonly total: number;
  private readonly bitmap: boolean[];

  /**
   * @param cidr  Network in CIDR notation, e.g. "172.16.0.0/24"
   */
  constructor(cidr: string) {
    const [baseStr, prefix] = cidr.split('/');
    const prefixLen = parseInt(prefix, 10);
    if (prefixLen < 16 || prefixLen > 30) {
      throw new Error(
        `SubnetAllocator: prefix /${prefixLen} too ${prefixLen < 16 ? 'large' : 'small'}. ` +
        'Use a prefix between /16 and /30.'
      );
    }

    this.baseIp = SubnetAllocator.ipToInt(baseStr);
    if (this.baseIp < 0) {
      throw new Error(`SubnetAllocator: invalid base address "${baseStr}"`);
    }

    // Each /30 slice consumes 4 addresses. Total slices = 2^(30 - prefixLen).
    this.total = Math.pow(2, 30 - prefixLen);
    this.bitmap = new Array(this.total).fill(false);
  }

  /**
   * Allocate the next available /30 subnet slice.
   * @returns { hostIp, guestIp } or null if the pool is exhausted.
   */
  allocate(): { hostIp: string; guestIp: string } | null {
    for (let idx = 0; idx < this.total; idx++) {
      if (!this.bitmap[idx]) {
        this.bitmap[idx] = true;
        return this.addrPair(idx);
      }
    }
    return null; // Pool exhausted
  }

  /**
   * Release a previously allocated /30 slice back to the pool.
   * Idempotent — releasing an already-free slice is a no-op.
   */
  release(hostIp: string, guestIp: string): void {
    const idx = this.addrIndex(hostIp);
    if (idx !== -1 && idx < this.total) {
      this.bitmap[idx] = false;
    }
  }

  /**
   * Number of slots currently in use.
   */
  used(): number {
    return this.bitmap.filter(Boolean).length;
  }

  /**
   * Total number of available /30 slices.
   */
  maxCapacity(): number {
    return this.total;
  }

  /**
   * Number of remaining free slices.
   */
  available(): number {
    return this.total - this.used();
  }

  // ---- private helpers ----

  /**
   * Convert a dotted IPv4 string to a 32-bit integer.
   */
  private static ipToInt(ip: string): number {
    const parts = ip.split('.').map(Number);
    if (parts.length !== 4 || parts.some(isNaN) || parts.some(p => p < 0 || p > 255)) return -1;
    return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
  }

  /**
   * Convert a 32-bit integer back to a dotted IPv4 string.
   */
  private static intToIp(val: number): string {
    return `${(val >>> 24) & 0xff}.${(val >>> 16) & 0xff}.${(val >>> 8) & 0xff}.${val & 0xff}`;
  }

  /**
   * Compute the host and guest IPs for a given slice index.
   * Each slice is a /30: host at offset 1, guest at offset 2 from slice base.
   * Host IP  = base + 4*idx + 1
   * Guest IP = base + 4*idx + 2
   */
  private addrPair(idx: number): { hostIp: string; guestIp: string } {
    const hostNum = this.baseIp + idx * 4 + 1;
    const guestNum = this.baseIp + idx * 4 + 2;
    return {
      hostIp: SubnetAllocator.intToIp(hostNum),
      guestIp: SubnetAllocator.intToIp(guestNum),
    };
  }

  /**
   * Determine the slice index from a host IP.
   * The host IP is at offset (idx * 4 + 1) from the base.
   */
  private addrIndex(hostIp: string): number {
    const ip = SubnetAllocator.ipToInt(hostIp);
    if (ip < 0) return -1;
    const offset = ip - this.baseIp;
    // Must be in the host position (offset % 4 == 1) and within range
    if (offset < 1 || offset % 4 !== 1) return -1;
    const idx = (offset - 1) / 4;
    return idx < this.total ? idx : -1;
  }
}

export class FirecrackerRuntime extends EventEmitter {
  private vms: Map<string, VMInstance> = new Map<string, VMInstance>();
  private readonly firecrackerBin: string;
  private readonly jailerBin: string;
  private readonly baseDir: string;
  private readonly defaultKernelPath: string;
  private readonly defaultRootfsPath: string;

    // Network configuration constants
  private readonly SUBNET_MASK = '255.255.255.252';  // /30 point-to-point
  private readonly NETWORK_PREFIX = '172.16.0';
  private readonly CIDR = '24';                       // Overall pool size
  private ipPool: SubnetAllocator;

  constructor(
    firecrackerBin: string = process.env.FIRECRACKER_BIN || '/usr/bin/firecracker',
    jailerBin: string = process.env.JAILER_BIN || '/usr/bin/jailer',
    baseDir: string = process.env.FIRECRACKER_BASE_DIR || '/tmp/firecracker'
  ) {
    super();
    this.firecrackerBin = firecrackerBin;
    this.jailerBin = jailerBin;
    this.baseDir = baseDir;
    this.defaultKernelPath = process.env.FIRECRACKER_KERNEL_IMAGE || '/var/lib/firecracker/vmlinux.bin';
    this.defaultRootfsPath = process.env.FIRECRACKER_ROOTFS_IMAGE || '/var/lib/firecracker/rootfs.ext4';

    // IP address pool — allocates unique /30 slices for each VM
    this.ipPool = new SubnetAllocator(`${this.NETWORK_PREFIX}.0/${this.CIDR}`);

    // SSH guest agent paths
    this.sshDir = join(baseDir, 'ssh');
    this.sshPrivateKeyPath = join(this.sshDir, 'id_ed25519');
    this.sshPublicKeyPath = join(this.sshDir, 'id_ed25519.pub');

    // Ensure base directory exists
    if (!existsSync(baseDir)) {
      mkdirSync(baseDir, { recursive: true });
    }

    // Generate SSH key pair for guest agent (idempotent)
    this.ensureSSHKeyPair();
  }

  // ======================================================================
  // VM Lifecycle
  // ======================================================================

  async createVM(sandboxId: string, config?: Partial<FirecrackerConfig>): Promise<VMInstance> {
    const vmId = randomUUID();
    const vmDir = join(this.baseDir, vmId);
    const tapDevice = `tap_${vmId.substring(0, 8)}`;

    // Allocate a unique /30 subnet slice for this VM
    const allocation = this.ipPool.allocate();
    if (!allocation) {
      throw new Error(
        'No available IP addresses in the pool. ' +
        `Maximum ${this.ipPool.maxCapacity()} VMs can run concurrently. ` +
        'Stop some VMs or increase the CIDR prefix in the network configuration.'
      );
    }
    const { hostIp, guestIp } = allocation;

    // Create VM directory
    mkdirSync(vmDir, { recursive: true });

    const bootArgs = 'console=ttyS0 reboot=k panic=1 pci=off ' +
      `ip=${guestIp}::${hostIp}:${this.SUBNET_MASK}::eth0:off`;

    const vmConfig: FirecrackerConfig = {
      socketPath: join(vmDir, 'firecracker.sock'),
      kernelImagePath: config?.kernelImagePath || this.defaultKernelPath,
      rootfsPath: config?.rootfsPath || join(vmDir, 'rootfs.img'),
      bootArgs,
      logPath: join(vmDir, 'firecracker.log'),
      metricsPath: join(vmDir, 'firecracker-metrics.json'),
      cpuCount: config?.cpuCount || 2,
      memorySize: config?.memorySize || 512,
      tapDevice,
      guestIp,
      hostTapIp: hostIp,
    };

    // Copy the base rootfs image into this VM's private rootfs path.
    // Each VM gets its own writable copy of the Alpine rootfs, so VMs
    // are fully isolated from each other.
    if (!existsSync(this.defaultRootfsPath)) {
      throw new Error(
        `Base rootfs image not found at ${this.defaultRootfsPath}. ` +
        'Run the firecracker-setup service (docker compose --profile firecracker up -d firecracker-setup).'
      );
    }
    copyFileSync(this.defaultRootfsPath, vmConfig.rootfsPath);

    // Inject the runtime's SSH public key into this VM's rootfs so the
    // guest agent (Dropbear) will accept connections from the host.
    this.injectPublicKeyIntoRootfs(vmConfig.rootfsPath);

    const vm: VMInstance = {
      vmId,
      sandboxId,
      process: null,
      socketPath: vmConfig.socketPath,
      status: 'starting',
      createdAt: new Date(),
      config: vmConfig,
    };

    this.vms.set(vmId, vm);
    this.emit('vm_created', vm);

    return vm;
  }

  async startVM(vmId: string): Promise<void> {
    const vm = this.vms.get(vmId);
    if (!vm) {
      throw new Error(`VM not found: ${vmId}`);
    }

    this.emit('vm_starting', vm);

    const tapDevice = vm.config.tapDevice;

    try {
      // 1. Ensure host NAT/forwarding is configured (idempotent)
      await this.ensureHostNAT();

      // 2. Create the TAP device for this VM
      await this.createTapDevice(tapDevice, vm.config.hostTapIp);

      // 3. Start Firecracker process with jailer
      const args = [
        '--id', vmId,
        '--exec-file', this.firecrackerBin,
        '--uid', '1234',
        '--gid', '1234',
        '--chroot-base-dir', this.baseDir,
        '--',
        '--api-sock', vm.config.socketPath,
      ];

      const proc = spawn(this.jailerBin, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
      });

      vm.process = proc;
      vm.startedAt = new Date();

      // Handle process output
      proc.stdout?.on('data', (data) => {
        this.emit('vm_output', { vmId, data: data.toString(), stream: 'stdout' });
      });

      proc.stderr?.on('data', (data) => {
        this.emit('vm_output', { vmId, data: data.toString(), stream: 'stderr' });
      });

      proc.on('exit', (code, signal) => {
        vm.status = 'stopped';
        this.emit('vm_stopped', { vmId, code, signal });
      });

      proc.on('error', (error) => {
        vm.status = 'error';
        this.emit('vm_error', { vmId, error });
      });

      // 4. Wait for the Firecracker API socket to become available
      await this.waitForVMReady(vmId);

      // 5. Write debug configuration files for post-mortem inspection
      writeFileSync(join(this.baseDir, vmId, 'machine-config.json'), JSON.stringify({
        vcpu_count: vm.config.cpuCount,
        mem_size_mib: vm.config.memorySize,
      }));
      writeFileSync(join(this.baseDir, vmId, 'network-config.json'), JSON.stringify({
        iface_id: 'eth0',
        host_dev_name: vm.config.tapDevice,
        guest_ip: vm.config.guestIp,
      }));
      writeFileSync(join(this.baseDir, vmId, 'boot-config.json'), JSON.stringify({
        kernel_image_path: vm.config.kernelImagePath,
        boot_args: vm.config.bootArgs,
      }));
      writeFileSync(join(this.baseDir, vmId, 'drive-config.json'), JSON.stringify({
        drive_id: 'rootfs',
        path_on_host: vm.config.rootfsPath,
        is_root_device: true,
        is_read_only: false,
      }));

      // 6. Configure the VM via the Firecracker REST API
      await this.configureVMThroughApi(vm);

      // 7. Wait for the VM's Dropbear SSH server to accept connections
      this.emit('vm_info', { vmId, message: 'Waiting for SSH guest agent...' });
      await this.waitForSSHReady(vmId);

      vm.status = 'running';
      this.emit('vm_started', vm);
    } catch (error: any) {
      vm.status = 'error';
      this.emit('vm_start_error', { vmId, error });

      // Best-effort cleanup of the TAP device
      await this.deleteTapDevice(tapDevice).catch(() => {});

      throw new Error(`Failed to start VM: ${error.message}`);
    }
  }

  private async waitForVMReady(vmId: string, timeout: number = 30000): Promise<void> {
    const vm = this.vms.get(vmId);
    if (!vm) {
      throw new Error(`VM not found: ${vmId}`);
    }

    const startTime = Date.now();
    
    while (Date.now() - startTime < timeout) {
      try {
        // Try to connect to API socket
        const { default: net } = await import('net');
        
        await new Promise((resolve, reject) => {
          const socket = net.createConnection(vm.config.socketPath);
          socket.on('connect', () => {
            socket.end();
            resolve(true);
          });
          socket.on('error', reject);
          socket.setTimeout(1000);
          socket.on('timeout', () => {
            socket.destroy();
            reject(new Error('Connection timeout'));
          });
        });

        return; // Socket connected, VM is ready
      } catch (error) {
        // VM not ready yet, wait and retry
        await new Promise(resolve => setTimeout(resolve, 500));
      }
    }

    throw new Error(`VM ${vmId} failed to start within ${timeout}ms`);
  }

  // ======================================================================
  // Host Networking — TAP devices, NAT, IP forwarding
  // ======================================================================

  /**
   * Configure host IP forwarding and NAT once. Idempotent — rules that
   * already exist are left untouched.
   */
  private async ensureHostNAT(): Promise<void> {
    try {
      await execFile('sysctl', ['-w', 'net.ipv4.ip_forward=1']);
    } catch {
      this.emit('vm_warning', {
        message: 'Could not enable IP forwarding. ' +
          'VM will have local networking only (no internet access).',
      });
    }

    try {
      // Check if the MASQUERADE rule already exists; add if not
      await execFile('iptables', [
        '-t', 'nat', '-C', 'POSTROUTING',
        '-s', `${this.NETWORK_PREFIX}.0/24`,
        '!', '-o', `tap_+`,
        '-j', 'MASQUERADE',
      ]);
    } catch {
      // Rule doesn't exist yet — add it
      try {
        await execFile('iptables', [
          '-t', 'nat', '-A', 'POSTROUTING',
          '-s', `${this.NETWORK_PREFIX}.0/24`,
          '!', '-o', `tap_+`,
          '-j', 'MASQUERADE',
        ]);
      } catch {
        this.emit('vm_warning', {
          message: 'Could not add iptables NAT rule. ' +
            'VM will have local networking only (no internet access).',
        });
      }
    }
  }

  /**
   * Create a TAP device for a microVM and assign the host-side IP.
   * Each VM gets its own /30 subnet slice, so the host IP is unique per TAP.
   */
  private async createTapDevice(tapName: string, hostIp: string): Promise<void> {
    try {
      await execFile('ip', ['tuntap', 'add', tapName, 'mode', 'tap']);
      await execFile('ip', ['addr', 'add', `${hostIp}/30`, 'dev', tapName]);
      await execFile('ip', ['link', 'set', tapName, 'up']);
    } catch (error: any) {
      throw new Error(
        `Failed to create TAP device ${tapName}: ${error.message}. ` +
        'Ensure the container has NET_ADMIN capability and /dev/net/tun is available.'
      );
    }
  }

  /**
   * Delete a TAP device. Best-effort — the device may already be gone.
   */
  private async deleteTapDevice(tapName: string): Promise<void> {
    try {
      await execFile('ip', ['link', 'delete', tapName]);
    } catch {
      // TAP device may already be cleaned up
    }
  }

  // ======================================================================
  // Firecracker REST API Client
  // ======================================================================

  /**
   * Send an HTTP request to the Firecracker API over a Unix domain socket.
   */
  private sendApiRequest(
    socketPath: string,
    method: string,
    apiPath: string,
    body?: Record<string, unknown>,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const bodyStr = body ? JSON.stringify(body) : '';

      const req = http.request(
        {
          socketPath,
          path: apiPath,
          method,
          headers: {
            'Content-Type': 'application/json',
            'Content-Length': Buffer.byteLength(bodyStr).toString(),
          },
        },
        (res) => {
          let data = '';
          res.on('data', (chunk: string) => {
            data += chunk;
          });
          res.on('end', () => {
            if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
              resolve();
            } else {
              reject(
                new Error(
                  `Firecracker API ${method} ${apiPath} returned ${res.statusCode}: ${data}`,
                ),
              );
            }
          });
        },
      );

      req.on('error', reject);
      req.setTimeout(10000, () => {
        req.destroy(new Error('Firecracker API request timed out'));
      });

      if (bodyStr) {
        req.write(bodyStr);
      }
      req.end();
    });
  }

  /**
   * Configure a microVM through the Firecracker REST API after the
   * process has started and the API socket is ready.
   *
   * Order matters — Firecracker expects:
   *   1. PUT /machine-config
   *   2. PUT /boot-source
   *   3. PUT /drives/{id}
   *   4. PUT /network-interfaces/{id}
   *   5. PUT /actions (InstanceStart)
   */
  private async configureVMThroughApi(vm: VMInstance): Promise<void> {
    const sock = vm.config.socketPath;

    // 1. Machine configuration
    await this.sendApiRequest(sock, 'PUT', '/machine-config', {
      vcpu_count: vm.config.cpuCount,
      mem_size_mib: vm.config.memorySize,
      smt: false,
    });

    // 2. Boot source (kernel image + boot args with guest IP)
    await this.sendApiRequest(sock, 'PUT', '/boot-source', {
      kernel_image_path: vm.config.kernelImagePath,
      boot_args: vm.config.bootArgs,
    });

    // 3. Root filesystem drive
    await this.sendApiRequest(sock, 'PUT', '/drives/rootfs', {
      drive_id: 'rootfs',
      path_on_host: vm.config.rootfsPath,
      is_root_device: true,
      is_read_only: false,
    });

    // 4. Network interface (attaches the host TAP device)
    await this.sendApiRequest(sock, 'PUT', '/network-interfaces/eth0', {
      iface_id: 'eth0',
      host_dev_name: vm.config.tapDevice,
      guest_mac: `06:00:${vm.vmId.substring(0, 2)}:${vm.vmId.substring(2, 4)}:${vm.vmId.substring(4, 6)}:${vm.vmId.substring(6, 8)}`,
    });

    // 5. Start the microVM (Firecracker boots the guest kernel)
    await this.sendApiRequest(sock, 'PUT', '/actions', {
      action_type: 'InstanceStart',
    });
  }

  // ======================================================================
  // SSH Guest Agent — runs commands inside the VM via Dropbear SSH
  // ======================================================================

  private readonly sshDir: string;
  private readonly sshPrivateKeyPath: string;
  private readonly sshPublicKeyPath: string;
  private sshConnections: Map<string, any> = new Map();

  /**
   * Generate an ED25519 SSH key pair for this runtime instance on first use.
   * The public key is injected into each VM's rootfs image before boot so the
   * host can authenticate to the guest's Dropbear SSH server.
   */
  private ensureSSHKeyPair(): void {
    if (!existsSync(this.sshDir)) {
      mkdirSync(this.sshDir, { recursive: true });
    }

    if (!existsSync(this.sshPrivateKeyPath)) {
      this.emit('vm_build', { message: 'Generating runtime SSH key pair for guest agent...' });
      execFileSync('ssh-keygen', [
        '-t', 'ed25519',
        '-f', this.sshPrivateKeyPath,
        '-N', '',   // no passphrase
        '-q',
      ]);
      // Permissions must be strict for SSH to accept the key
      execFileSync('chmod', ['600', this.sshPrivateKeyPath]);
    }
  }

  /**
   * Inject the runtime's SSH public key into a VM's rootfs image before boot.
   * Uses debugfs (part of e2fsprogs) to write the key file without needing a
   * loopback mount. Called during createVM after the rootfs is copied.
   */
  private injectPublicKeyIntoRootfs(rootfsPath: string): void {
    const tmpKey = join(this.baseDir, '.inject_key.pub');
    copyFileSync(this.sshPublicKeyPath, tmpKey);

    try {
      // Remove the placeholder authorized_keys, then write ours
      execFileSync('debugfs', [
        '-w', '-R',
        `rm /root/.ssh/authorized_keys`,
        rootfsPath,
      ]);
      execFileSync('debugfs', [
        '-w', '-R',
        `write ${tmpKey} /root/.ssh/authorized_keys`,
        rootfsPath,
      ]);
      // Set correct permissions (600 = owner read/write only)
      execFileSync('debugfs', [
        '-w', '-R',
        'set_inode_field /root/.ssh/authorized_keys mode 0100600',
        rootfsPath,
      ]);
    } finally {
      // Clean up temp copy regardless of success
      try { unlinkSync(tmpKey); } catch { /* best-effort */ }
    }
  }

  /**
   * Poll the VM's guest IP until the Dropbear SSH server accepts connections.
   */
  private async waitForSSHReady(vmId: string, timeout: number = 30000): Promise<void> {
    const vm = this.vms.get(vmId);
    if (!vm) throw new Error(`VM not found: ${vmId}`);

    const startTime = Date.now();
    const host = vm.config.guestIp;
    const port = 22;

    while (Date.now() - startTime < timeout) {
      try {
        const sock = await import('net');
        await new Promise<void>((resolve, reject) => {
          const socket = sock.default.createConnection({ host, port });
          socket.on('connect', () => { socket.end(); resolve(); });
          socket.on('error', reject);
          socket.setTimeout(2000);
          socket.on('timeout', () => { socket.destroy(); reject(new Error('timeout')); });
        });
        return; // SSH port is open
      } catch {
        await new Promise(r => setTimeout(r, 500));
      }
    }

    throw new Error(`VM ${vmId} SSH not ready within ${timeout}ms (guest IP: ${vm.config.guestIp})`);
  }

  /**
   * Establish an SSH connection to a running VM.
   * Connections are cached and reused for subsequent execInVM calls.
   */
  private async sshConnect(vmId: string): Promise<any> {
    const cached = this.sshConnections.get(vmId);
    if (cached) return cached;

    const vm = this.vms.get(vmId);
    if (!vm) throw new Error(`VM not found: ${vmId}`);

    const { Client } = await import('ssh2');
    const client = new Client();

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        client.end();
        reject(new Error(`SSH connection to ${vm.config.guestIp}:22 timed out`));
      }, 10000);

      client.on('ready', () => {
        clearTimeout(timeout);
        this.sshConnections.set(vmId, client);
        this.emit('vm_ssh_ready', { vmId, ip: vm.config.guestIp });
        resolve(client);
      });

      client.on('error', (err: Error) => {
        clearTimeout(timeout);
        reject(err);
      });

      client.on('close', () => {
        this.sshConnections.delete(vmId);
      });

      client.connect({
        host: vm.config.guestIp,
        port: 22,
        username: 'root',
        privateKey: readFileSync(this.sshPrivateKeyPath, 'utf8'),
        readyTimeout: 10000,
        keepaliveInterval: 15000,
        keepaliveCountMax: 3,
      });
    });
  }

  /**
   * Execute a command inside the VM via SSH.
   *
   * Unlike the previous implementation that spawned commands on the HOST,
   * this method connects to the VM's internal Dropbear SSH server and runs
   * the command inside the guest, preserving complete VM isolation.
   */
  async execInVM(vmId: string, command: string, args: string[] = [], cwd?: string): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    const vm = this.vms.get(vmId);
    if (!vm || vm.status !== 'running') {
      throw new Error(`VM not running: ${vmId}`);
    }

    const client = await this.sshConnect(vmId);

    // Build the full shell command: chdir if cwd given, then run the command
    const shellCmd = cwd
      ? `cd ${cwd.replace(/'/g, "'\\''")} && ${command}${args.length ? ' ' + args.map(a => a.replace(/'/g, "'\\''")).join(' ') : ''}`
      : `${command}${args.length ? ' ' + args.map(a => a.replace(/'/g, "'\\''")).join(' ') : ''}`;

    return new Promise((resolve, reject) => {
      client.exec(shellCmd, (err: Error | null, stream: any) => {
        if (err) {
          reject(new Error(`SSH exec failed: ${err.message}`));
          return;
        }

        let stdout = '';
        let stderr = '';

        stream.on('data', (data: Buffer) => {
          stdout += data.toString();
        });

        stream.stderr.on('data', (data: Buffer) => {
          stderr += data.toString();
        });

        stream.on('close', (exitCode: number | null) => {
          resolve({ stdout, stderr, exitCode });
        });

        stream.on('error', (streamErr: Error) => {
          resolve({ stdout, stderr, exitCode: null });
        });
      });
    });
  }

  /**
   * Close the SSH connection to a VM.
   */
  private async sshDisconnect(vmId: string): Promise<void> {
    const client = this.sshConnections.get(vmId);
    if (client) {
      try { client.end(); } catch { /* best-effort */ }
      this.sshConnections.delete(vmId);
    }
  }

  async stopVM(vmId: string): Promise<void> {
    const vm = this.vms.get(vmId);
    if (!vm) {
      throw new Error(`VM not found: ${vmId}`);
    }

    this.emit('vm_stopping', vm);

    try {
      // Close SSH connection to the guest (best-effort)
      await this.sshDisconnect(vmId).catch(() => {});

      if (vm.process && vm.process.pid) {
        process.kill(-vm.process.pid, 'SIGTERM');
        
        // Wait for process to exit
        await new Promise((resolve) => {
          vm.process?.on('exit', resolve);
          setTimeout(resolve, 5000); // Timeout after 5 seconds
        });
      }

      // Clean up the TAP device
      await this.deleteTapDevice(vm.config.tapDevice).catch(() => {});

      // Release the IP allocation back to the pool
      this.ipPool.release(vm.config.hostTapIp, vm.config.guestIp);

      vm.status = 'stopped';
      this.emit('vm_stopped', vm);
    } catch (error: any) {
      this.emit('vm_stop_error', { vmId, error });
      throw error;
    }
  }

  async deleteVM(vmId: string): Promise<void> {
    const vm = this.vms.get(vmId);
    if (!vm) {
      throw new Error(`VM not found: ${vmId}`);
    }

    this.emit('vm_deleting', vm);

    try {
      // Close SSH connection to the guest (best-effort, in case stopVM was skipped)
      await this.sshDisconnect(vmId).catch(() => {});

      // Release IP allocation even if VM wasn't started
      this.ipPool.release(vm.config.hostTapIp, vm.config.guestIp);

      // Stop VM if running (stopVM also cleans up the TAP device)
      if (vm.status === 'running') {
        await this.stopVM(vmId);
      }

      // Clean up VM directory
      const vmDir = join(this.baseDir, vmId);
      if (existsSync(vmDir)) {
        const { rm } = await import('fs/promises');
        await rm(vmDir, { recursive: true, force: true });
      }

      this.vms.delete(vmId);
      this.emit('vm_deleted', vmId);
    } catch (error: any) {
      this.emit('vm_delete_error', { vmId, error });
      throw error;
    }
  }

  async getVM(vmId: string): Promise<VMInstance | null> {
    return this.vms.get(vmId) || null;
  }

  async listVMs(): Promise<VMInstance[]> {
    return Array.from(this.vms.values());
  }

  async getVMStats(vmId: string): Promise<{ cpuUsage: number; memoryUsage: number; diskUsage: number } | null> {
    const vm = this.vms.get(vmId);
    if (!vm || vm.status !== 'running') {
      return null;
    }

    // Read metrics from Firecracker metrics file
    try {
      const metricsContent = readFileSync(vm.config.metricsPath, 'utf8');
      const metrics = JSON.parse(metricsContent);
      
      return {
        cpuUsage: metrics.vcpu_usage || 0,
        memoryUsage: metrics.memory_usage || 0,
        diskUsage: metrics.disk_usage || 0,
      };
    } catch (error) {
      return null;
    }
  }

  async shutdown(): Promise<void> {
    // Stop all VMs
    for (const vmId of this.vms.keys()) {
      try {
        await this.stopVM(vmId);
      } catch (error) {
        this.emit('shutdown_error', { vmId, error });
      }
    }

    this.vms.clear();
    this.emit('shutdown');
  }
}

// Process-based fallback runtime (for development/testing)
export class ProcessRuntime extends EventEmitter {
  private processes: Map<string, ChildProcess> = new Map<string, ChildProcess>();
  private readonly baseWorkspaceDir: string;

  constructor(baseWorkspaceDir: string = process.env.WORKSPACE_DIR || '/tmp/workspaces') {
    super();
    this.baseWorkspaceDir = baseWorkspaceDir;

    // Ensure base directory exists
    if (!existsSync(baseWorkspaceDir)) {
      mkdirSync(baseWorkspaceDir, { recursive: true });
    }
  }

  async createSandbox(sandboxId: string): Promise<{ sandboxId: string; workspace: string }> {
    const workspace = join(this.baseWorkspaceDir, sandboxId);
    
    // Create workspace directory structure
    mkdirSync(workspace, { recursive: true });
    mkdirSync(join(workspace, 'code'), { recursive: true });
    mkdirSync(join(workspace, '.config'), { recursive: true });
    mkdirSync(join(workspace, '.cache'), { recursive: true });

    this.emit('sandbox_created', { sandboxId, workspace });
    
    return { sandboxId, workspace };
  }

  async execInSandbox(sandboxId: string, command: string, args: string[] = [], cwd?: string): Promise<{ stdout: string; stderr: string; exitCode: number | null }> {
    const workspace = join(this.baseWorkspaceDir, sandboxId);
    
    if (!existsSync(workspace)) {
      throw new Error(`Sandbox not found: ${sandboxId}`);
    }

    const proc = spawn(command, args, {
      cwd: cwd || workspace,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.processes.set(sandboxId, proc);

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
      this.emit('sandbox_output', { sandboxId, data: data.toString(), stream: 'stdout' });
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
      this.emit('sandbox_output', { sandboxId, data: data.toString(), stream: 'stderr' });
    });

    return new Promise((resolve) => {
      proc.on('close', (exitCode) => {
        this.processes.delete(sandboxId);
        resolve({ stdout, stderr, exitCode });
      });

      proc.on('error', (error) => {
        this.processes.delete(sandboxId);
        resolve({ stdout, stderr, exitCode: null });
      });
    });
  }

  async deleteSandbox(sandboxId: string): Promise<void> {
    const workspace = join(this.baseWorkspaceDir, sandboxId);
    
    if (!existsSync(workspace)) {
      throw new Error(`Sandbox not found: ${sandboxId}`);
    }

    // Kill any running process
    const proc = this.processes.get(sandboxId);
    if (proc && proc.pid) {
      proc.kill('SIGTERM');
      this.processes.delete(sandboxId);
    }

    // Clean up workspace
    const { rm } = await import('fs/promises');
    await rm(workspace, { recursive: true, force: true });

    this.emit('sandbox_deleted', sandboxId);
  }

  async shutdown(): Promise<void> {
    // Kill all running processes
    for (const [sandboxId, proc] of this.processes.entries()) {
      if (proc.pid) {
        proc.kill('SIGTERM');
      }
    }
    this.processes.clear();
    this.emit('shutdown');
  }
}

// Factory function to create runtime
export function createRuntime(type: 'firecracker' | 'process' | 'auto', config?: any): FirecrackerRuntime | ProcessRuntime {
  if (type === 'firecracker') {
    return new FirecrackerRuntime(
      config?.firecrackerBin,
      config?.jailerBin,
      config?.baseDir
    );
  } else if (type === 'process') {
    return new ProcessRuntime(config?.baseWorkspaceDir);
  } else {
    // Auto-detect: try Firecracker, fall back to Process
    try {
      const { existsSync } = require('fs');
      if (existsSync('/usr/bin/firecracker')) {
        return new FirecrackerRuntime();
      }
    } catch (error) {
      // Fall through to Process runtime
    }
    return new ProcessRuntime();
  }
}

// Singleton instances
let firecrackerRuntime: FirecrackerRuntime | null = null;
let processRuntime: ProcessRuntime | null = null;

export function getFirecrackerRuntime(config?: any): FirecrackerRuntime {
  if (!firecrackerRuntime) {
    firecrackerRuntime = new FirecrackerRuntime(
      config?.firecrackerBin,
      config?.jailerBin,
      config?.baseDir
    );
  }
  return firecrackerRuntime;
}

export function getProcessRuntime(baseWorkspaceDir?: string): ProcessRuntime {
  if (!processRuntime) {
    processRuntime = new ProcessRuntime(baseWorkspaceDir);
  }
  return processRuntime;
}
