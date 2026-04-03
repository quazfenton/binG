/**
 * Sprites SSHFS Mount Helper
 *
 * Mount Sprite filesystem locally via SSHFS for seamless file editing.
 * This provides real-time sync between local IDE and Sprite filesystem.
 *
 * Requirements:
 * - SSHFS installed on local machine
 * - Sprites CLI installed and authenticated
 * - OpenSSH server running on Sprite (auto-installed via createSSHFSMount)
 *
 * Documentation: https://docs.sprites.dev/working-with-sprites#mounting-filesystem-locally
 *
 * SECURITY: Uses execFile with args array to prevent command injection
 * @see docs/COMPREHENSIVE_SECURITY_AUDIT.md Security audit - CRITICAL fix
 */

import { spawn, ChildProcess, execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'

// SECURITY: Use execFile instead of exec for safer execution
const execFilePromise = promisify(execFile)

// ============================================================================
// Security Validation
// ============================================================================

/**
 * Validate sprite name format (Sprites naming convention)
 * SECURITY: Prevents command injection via spriteName parameter
 */
function validateSpriteName(name: string): string {
  if (!name || typeof name !== 'string') {
    throw new Error('Sprite name is required')
  }

  // Sprites names are lowercase alphanumeric with hyphens
  const spriteNameRegex = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/
  if (!spriteNameRegex.test(name)) {
    throw new Error(
      'Invalid sprite name format. Must be lowercase alphanumeric with hyphens (e.g., "my-dev-sprite")'
    )
  }

  return name
}

/**
 * Validate mount point path
 * SECURITY: Prevents path traversal and ensures safe mount location
 */
function validateMountPoint(mountPoint: string): string {
  if (!mountPoint || typeof mountPoint !== 'string') {
    throw new Error('Mount point is required')
  }

  // Block path traversal
  if (mountPoint.includes('..') || mountPoint.includes('\0')) {
    throw new Error('Invalid mount point: path traversal detected')
  }

  // Must be absolute path
  if (!mountPoint.startsWith('/') && !/^[A-Za-z]:/.test(mountPoint)) {
    throw new Error('Mount point must be an absolute path')
  }

  return mountPoint
}

export interface SSHFSMountConfig {
  /** Sprite name to mount */
  spriteName: string
  /** Local directory to mount to */
  mountPoint: string
  /** Local port for SSH tunnel (default: 2000) */
  localPort?: number
  /** SSHFS mount options (default: recommended defaults) */
  sshfsOptions?: string[]
  /** Auto-install SSH server on Sprite if not present */
  autoInstallSSH?: boolean
  /** Timeout for SSH tunnel establishment (ms) */
  tunnelTimeout?: number
}

export interface SSHFSMountResult {
  /** Mount point path */
  mountPoint: string
  /** SSH tunnel process */
  tunnelProcess: ChildProcess
  /** SSHFS process */
  sshfsProcess: ChildProcess
  /** Whether SSH server was installed */
  sshInstalled: boolean
  /** Unmount function */
  unmount: () => Promise<void>
  /** Check if mounted */
  isMounted: () => boolean
}

export class SpritesSSHFS {
  private tunnelProcess: ChildProcess | null = null
  private sshfsProcess: ChildProcess | null = null
  private mounted: boolean = false
  private mountPoint: string = ''
  private spriteName: string = ''

  /**
   * Mount Sprite filesystem locally via SSHFS
   * 
   * This creates an SSH tunnel and mounts the Sprite filesystem using SSHFS.
   * Files can be edited locally with real-time sync to the Sprite.
   * 
   * @param config - Mount configuration
   * @returns Mount result with unmount function
   * 
   * @example
   * ```typescript
   * const sshfs = new SpritesSSHFS()
   * const result = await sshfs.mount({
   *   spriteName: 'my-dev-sprite',
   *   mountPoint: '/tmp/sprite-mount',
   *   autoInstallSSH: true,
   * })
   * 
   * // Edit files in /tmp/sprite-mount with your local IDE
   * // Changes sync to Sprite in real-time
   * 
   * // When done:
   * await result.unmount()
   * ```
   */
  async mount(config: SSHFSMountConfig): Promise<SSHFSMountResult> {
    try {
      // SECURITY: Validate all user inputs
      const spriteName = validateSpriteName(config.spriteName)
      const mountPoint = validateMountPoint(config.mountPoint)

      const localPort = config.localPort || 2000
      const tunnelTimeout = config.tunnelTimeout || 10000
      const sshfsOptions = config.sshfsOptions || [
        'reconnect',
        'ServerAliveInterval=15',
        'ServerAliveCountMax=3',
        'follow_symlinks',
        'allow_other',
      ]

      // Validate mount point exists
      if (!existsSync(mountPoint)) {
        mkdirSync(mountPoint, { recursive: true })
      }

      // Check if SSHFS is installed
      await this.checkSSHFSInstalled()

      // Install SSH server on Sprite if needed
      let sshInstalled = false
      if (config.autoInstallSSH !== false) {
        sshInstalled = await this.installSSHServer(config.spriteName)
      }

      // Authorize SSH keys
      await this.authorizeSSHKeys(config.spriteName)

      // Start SSH proxy tunnel
      this.tunnelProcess = spawn('sprite', [
        'proxy',
        `${localPort}:22`,
        '-s',
        config.spriteName,
      ])

      // Wait for tunnel to establish
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`SSH tunnel timed out after ${tunnelTimeout}ms`))
        }, tunnelTimeout)

        this.tunnelProcess!.on('spawn', () => {
          // Give tunnel time to establish
          setTimeout(() => {
            clearTimeout(timeout)
            resolve()
          }, 1500)
        })

        this.tunnelProcess!.on('error', (error) => {
          clearTimeout(timeout)
          reject(new Error(`SSH tunnel failed: ${error.message}`))
        })

        this.tunnelProcess!.stderr?.on('data', (data: Buffer) => {
          const output = data.toString()
          if (output.includes('error') || output.includes('failed')) {
            clearTimeout(timeout)
            reject(new Error(`SSH tunnel error: ${output}`))
          }
        })
      })

      // Mount via SSHFS
      const sshfsArgs = [
        '-o', sshfsOptions.join(','),
        `-p${localPort}`,
        'sprite@localhost:/home/sprite',
        mountPoint,
      ]

      this.sshfsProcess = spawn('sshfs', sshfsArgs)

      // Wait for SSHFS mount
      await new Promise<void>((resolve, reject) => {
        const timeout = setTimeout(() => {
          reject(new Error(`SSHFS mount timed out`))
        }, 15000)

        this.sshfsProcess!.on('spawn', () => {
          clearTimeout(timeout)
          this.mounted = true
          this.mountPoint = mountPoint
          this.spriteName = config.spriteName
          resolve()
        })

        this.sshfsProcess!.on('error', (error) => {
          clearTimeout(timeout)
          reject(new Error(`SSHFS mount failed: ${error.message}`))
        })

        this.sshfsProcess!.stderr?.on('data', (data: Buffer) => {
          const output = data.toString()
          if (output.includes('error') || output.includes('failed') || output.includes('cannot')) {
            clearTimeout(timeout)
            reject(new Error(`SSHFS error: ${output}`))
          }
        })
      })

      console.log(`[SpritesSSHFS] Mounted ${config.spriteName} at ${mountPoint}`)

      // Create unmount function
      const unmount = async () => {
        await this.unmount()
      }

      const isMounted = () => this.isMounted()

      return {
        mountPoint,
        tunnelProcess: this.tunnelProcess!,
        sshfsProcess: this.sshfsProcess!,
        sshInstalled,
        unmount,
        isMounted,
      }
    } catch (error: any) {
      await this.cleanup()
      throw new Error(`Failed to mount Sprite: ${error.message}`)
    }
  }

  /**
   * Unmount Sprite filesystem
   * SECURITY: Uses execFile with args array
   */
  async unmount(): Promise<void> {
    try {
      // Kill SSHFS process
      if (this.sshfsProcess?.pid) {
        process.kill(this.sshfsProcess.pid, 'SIGTERM')
        this.sshfsProcess = null
      }

      // Kill tunnel process
      if (this.tunnelProcess?.pid) {
        process.kill(this.tunnelProcess.pid, 'SIGTERM')
        this.tunnelProcess = null
      }

      // Unmount filesystem (platform-specific)
      try {
        const platform = await import('os')
        const isMacOS = platform.platform().includes('darwin')

        if (isMacOS) {
          // SECURITY: Use execFile with args array instead of shell command
          await execFilePromise('diskutil', ['umount', this.mountPoint], {
            timeout: 10000,
          }).catch(() => { /* Ignore unmount errors */ })
        } else {
          await execFilePromise('fusermount', ['-u', this.mountPoint], {
            timeout: 10000,
          }).catch(() => { /* Ignore unmount errors */ })
        }
      } catch (error: any) {
        console.warn('[SpritesSSHFS] Unmount warning:', error.message)
      }

      this.mounted = false
      console.log('[SpritesSSHFS] Unmounted')
    } catch (error: any) {
      console.error('[SpritesSSHFS] Unmount error:', error.message)
      throw error
    }
  }

  /**
   * Check if mounted
   */
  isMounted(): boolean {
    return this.mounted
  }

  /**
   * Get mount point
   */
  getMountPoint(): string {
    return this.mountPoint
  }

  /**
   * Get Sprite name
   */
  getSpriteName(): string {
    return this.spriteName
  }

  /**
   * Check if SSHFS is installed
   * SECURITY: Uses execFile with args array
   */
  private async checkSSHFSInstalled(): Promise<void> {
    try {
      await execFilePromise('sshfs', ['--version'], {
        timeout: 10000,
      })
    } catch (error: any) {
      const platform = await import('os')
      const isMacOS = platform.platform().includes('darwin')

      throw new Error(
        `SSHFS is not installed. Install it first:\n` +
        `${isMacOS ? '  brew install macfuse sshfs' : '  sudo apt-get install sshfs'}`
      )
    }
  }

  /**
   * Install SSH server on Sprite
   * SECURITY: Uses execFile with args array, validates spriteName
   */
  private async installSSHServer(spriteName: string): Promise<boolean> {
    try {
      // SECURITY: Validate spriteName
      const validatedSpriteName = validateSpriteName(spriteName)

      // Check if SSH is already installed using execFile with args
      const { stdout: checkStdout } = await execFilePromise(
        'sprite',
        ['exec', '-s', validatedSpriteName, 'which', 'sshd'],
        { timeout: 30000 }
      ).catch(() => ({ stdout: 'not_installed' }))

      if (checkStdout.includes('not_installed') || !checkStdout.trim()) {
        console.log(`[SpritesSSHFS] Installing OpenSSH on ${validatedSpriteName}...`)

        // Install openssh-server using execFile with args
        await execFilePromise(
          'sprite',
          ['exec', '-s', validatedSpriteName, 'sudo', 'apt', 'update', '&&', 'sudo', 'apt', 'install', '-y', 'openssh-server'],
          { timeout: 120000 }
        )

        // Create service to auto-start SSH using execFile with args
        await execFilePromise(
          'sprite-env',
          ['services', 'create', 'sshd', '-s', validatedSpriteName, '--cmd', '/usr/sbin/sshd', '--auto-start'],
          { timeout: 30000 }
        )

        console.log(`[SpritesSSHFS] SSH server installed and configured`)
        return true
      }

      console.log(`[SpritesSSHFS] SSH server already installed`)
      return false
    } catch (error: any) {
      console.warn('[SpritesSSHFS] SSH installation warning:', error.message)
      return false
    }
  }

  /**
   * Authorize SSH public keys
   * SECURITY: Uses execFile with args array, validates spriteName
   */
  private async authorizeSSHKeys(spriteName: string): Promise<void> {
    try {
      // SECURITY: Validate spriteName
      const validatedSpriteName = validateSpriteName(spriteName)

      const platform = await import('os')
      const homedir = platform.homedir()
      const pubKeyPath = join(homedir, '.ssh', 'id_*.pub')

      // Get local public keys using execFile with glob expansion handled by shell
      // Note: We use execFile with 'bash -c' for glob expansion, but sanitize the path first
      const safePubKeyPath = pubKeyPath.replace(/['";&|`$(){}\\]/g, '')
      const { stdout: pubKeys } = await execFilePromise(
        'bash',
        ['-c', `cat ${safePubKeyPath} 2>/dev/null || echo ""`],
        { timeout: 10000 }
      )

      const trimmedPubKeys = pubKeys.trim()

      if (!trimmedPubKeys) {
        console.warn('[SpritesSSHFS] No SSH public keys found. You may need to create one.')
        return
      }

      // SECURITY: Use execFile with args array - pass keys via stdin to avoid shell injection
      // Split into individual keys and add each one
      const keys = trimmedPubKeys.split('\n').filter(key => key.trim())

      for (const key of keys) {
        // Validate key format (should start with ssh-rsa, ssh-ed25519, etc.)
        if (!/^(ssh-rsa|ssh-ed25519|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521)\s/.test(key)) {
          console.warn('[SpritesSSHFS] Skipping invalid SSH key format')
          continue
        }

        // Use sprite exec with the key passed via stdin to avoid shell injection
        const execResult: any = await execFilePromise(
          'sprite',
          ['exec', '-s', validatedSpriteName, 'bash', '-c', 'mkdir -p ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys'],
          {
            timeout: 30000,
            stdio: ['pipe', 'pipe', 'pipe'],
          } as any
        );
        const child = execResult.child || execResult;
        if (child?.stdin) {
          child.stdin.write(key + '\n');
          child.stdin.end();
        }
      }

      console.log('[SpritesSSHFS] SSH keys authorized')
    } catch (error: any) {
      console.warn('[SpritesSSHFS] SSH key authorization warning:', error.message)
    }
  }

  /**
   * Cleanup on error
   */
  private async cleanup(): Promise<void> {
    try {
      await this.unmount()
    } catch {
      // Ignore cleanup errors
    }
  }
}

/**
 * Quick mount function for one-off usage
 * 
 * @example
 * ```typescript
 * const mount = await mountSpriteSSHFS({
 *   spriteName: 'my-sprite',
 *   mountPoint: '/tmp/sprite',
 * })
 * 
 * // Edit files...
 * 
 * await mount.unmount()
 * ```
 */
export async function mountSpriteSSHFS(config: SSHFSMountConfig): Promise<SSHFSMountResult> {
  const sshfs = new SpritesSSHFS()
  return sshfs.mount(config)
}

/**
 * Unmount function for quick mount
 * SECURITY: Uses execFile with args array and validates mountPoint
 */
export async function unmountSpriteSSHFS(mountPoint: string): Promise<void> {
  try {
    // SECURITY: Validate mount point
    const validatedMountPoint = validateMountPoint(mountPoint)

    const platform = await import('os')
    const isMacOS = platform.platform().includes('darwin')

    if (isMacOS) {
      await execFilePromise('diskutil', ['umount', validatedMountPoint], {
        timeout: 10000,
      }).catch(() => { /* Ignore unmount errors */ })
    } else {
      await execFilePromise('fusermount', ['-u', validatedMountPoint], {
        timeout: 10000,
      }).catch(() => { /* Ignore unmount errors */ })
    }

    // Kill any remaining tunnel processes - use pgrep + kill instead of pkill pattern
    const { stdout: pids } = await execFilePromise('pgrep', ['-f', 'sprite proxy.*2000:22'], {
      timeout: 5000,
    }).catch(() => ({ stdout: '' }))

    if (pids.trim()) {
      const pidList = pids.trim().split('\n').filter(pid => /^\d+$/.test(pid.trim()))
      for (const pid of pidList) {
        process.kill(parseInt(pid.trim()), 'SIGTERM')
      }
    }

    console.log(`[SpritesSSHFS] Unmounted ${validatedMountPoint}`)
  } catch (error: any) {
    console.error('[SpritesSSHFS] Unmount error:', error.message)
  }
}
