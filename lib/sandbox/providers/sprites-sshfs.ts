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
 */

import { spawn, ChildProcess, exec } from 'child_process'
import { promisify } from 'util'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'

const execPromise = promisify(exec)

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
      const localPort = config.localPort || 2000
      const tunnelTimeout = config.tunnelTimeout || 10000
      const sshfsOptions = config.sshfsOptions || [
        'reconnect',
        'ServerAliveInterval=15',
        'ServerAliveCountMax=3',
        'follow_symlinks',
        'allow_other',
      ]

      // Validate mount point
      const mountPoint = config.mountPoint
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
          await execPromise(`diskutil umount ${this.mountPoint} 2>/dev/null || true`)
        } else {
          await execPromise(`fusermount -u ${this.mountPoint} 2>/dev/null || true`)
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
   */
  private async checkSSHFSInstalled(): Promise<void> {
    try {
      await execPromise('sshfs --version')
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
   */
  private async installSSHServer(spriteName: string): Promise<boolean> {
    try {
      // Check if SSH is already installed
      const checkResult = await execPromise(
        `sprite exec -s ${spriteName} "which sshd || echo 'not_installed'"`
      )

      if (checkResult.stdout.includes('not_installed')) {
        console.log(`[SpritesSSHFS] Installing OpenSSH on ${spriteName}...`)
        
        await execPromise(
          `sprite exec -s ${spriteName} "sudo apt update && sudo apt install -y openssh-server"`
        )

        // Create service to auto-start SSH
        await execPromise(
          `sprite-env services create sshd -s ${spriteName} --cmd "/usr/sbin/sshd" --auto-start`
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
   */
  private async authorizeSSHKeys(spriteName: string): Promise<void> {
    try {
      const platform = await import('os')
      const homedir = platform.homedir()
      const pubKeyPath = join(homedir, '.ssh', 'id_*.pub')

      // Get local public keys
      const keysResult = await execPromise(`cat ${pubKeyPath} 2>/dev/null || echo ""`)
      const pubKeys = keysResult.stdout.trim()

      if (!pubKeys) {
        console.warn('[SpritesSSHFS] No SSH public keys found. You may need to create one.')
        return
      }

      // Add to authorized_keys on Sprite
      const escapedKeys = pubKeys.replace(/'/g, "'\\''")
      
      await execPromise(
        `sprite exec -s ${spriteName} ` +
        `"mkdir -p ~/.ssh && echo '${escapedKeys}' >> ~/.ssh/authorized_keys && chmod 700 ~/.ssh && chmod 600 ~/.ssh/authorized_keys"`
      )

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
 */
export async function unmountSpriteSSHFS(mountPoint: string): Promise<void> {
  try {
    const platform = await import('os')
    const isMacOS = platform.platform().includes('darwin')

    if (isMacOS) {
      await execPromise(`diskutil umount ${mountPoint} 2>/dev/null || true`)
    } else {
      await execPromise(`fusermount -u ${mountPoint} 2>/dev/null || true`)
    }

    // Kill any remaining tunnel processes
    await execPromise(`pkill -f "sprite proxy.*2000:22" 2>/dev/null || true`)

    console.log(`[SpritesSSHFS] Unmounted ${mountPoint}`)
  } catch (error: any) {
    console.error('[SpritesSSHFS] Unmount error:', error.message)
  }
}
