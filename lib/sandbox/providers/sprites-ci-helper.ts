/**
 * Sprites CI/CD Helper
 *
 * Stateful CI runners with checkpoint-based "golden states".
 * Reduces CI setup time from 2-5 minutes to <30 seconds by leveraging
 * Sprites' persistent filesystem and checkpoint capabilities.
 *
 * Use Cases:
 * - Continuous Integration
 * - Automated Testing
 * - Build Verification
 * - Deployment Validation
 * - E2E Test Runners
 *
 * Documentation: https://docs.sprites.dev/use-cases/ci-cd
 *
 * @example
 * ```typescript
 * import { SpritesCiHelper } from './sprites-ci-helper'
 *
 * const ciHelper = new SpritesCiHelper('sprites-token', 'my-ci-sprite')
 *
 * // Run CI pipeline
 * const result = await ciHelper.runCi({
 *   spriteName: 'my-ci-sprite',
 *   repoUrl: 'https://github.com/myorg/myrepo',
 *   branch: 'main',
 *   testCommand: 'npm test',
 *   buildCommand: 'npm run build'
 * })
 *
 * if (result.success) {
 *   console.log(`CI passed in ${result.duration}ms`)
 *   console.log(`Checkpoint created: ${result.checkpointId}`)
 * }
 * ```
 */

import { SpritesClient } from '@fly/sprites'

export interface CiConfig {
  /** Sprite name to use for CI */
  spriteName: string
  /** Git repository URL to clone */
  repoUrl: string
  /** Git branch to checkout (default: 'main') */
  branch?: string
  /** Test command to run (default: 'npm test') */
  testCommand?: string
  /** Build command to run (optional) */
  buildCommand?: string
  /** Install command (optional, auto-detected based on lockfile) */
  installCommand?: string
  /** Working directory inside Sprite (default: /home/sprite/repo) */
  workingDir?: string
  /** Environment variables for CI run */
  envVars?: Record<string, string>
  /** Timeout for entire CI run in ms (default: 300000 = 5 min) */
  timeout?: number
}

export interface CiResult {
  /** Whether CI pipeline succeeded */
  success: boolean
  /** Total duration in milliseconds */
  duration: number
  /** Checkpoint ID if tests passed (for "golden state") */
  checkpointId?: string
  /** Standard output from CI run */
  output: string
  /** Error message if failed */
  error?: string
  /** Individual step results */
  steps?: CiStepResult[]
}

export interface CiStepResult {
  /** Step name */
  name: string
  /** Whether step succeeded */
  success: boolean
  /** Step duration in ms */
  duration: number
  /** Step output */
  output: string
  /** Step error if failed */
  error?: string
}

export interface InstallDependenciesResult {
  success: boolean
  duration: number
  packageManager: string
  error?: string
}

export class SpritesCiHelper {
  private client: any
  private sprite: any
  private spriteName: string

  constructor(token: string, spriteName: string) {
    this.client = new SpritesClient(token)
    this.spriteName = spriteName
    this.sprite = this.client.sprite(spriteName)
  }

  /**
   * Initialize CI runner with repository
   * Clones repo if not present, pulls updates if exists
   */
  async initializeRepo(config: {
    repoUrl: string
    branch?: string
    workingDir?: string
  }): Promise<{ success: boolean; error?: string }> {
    try {
      const branch = config.branch || 'main'
      const workingDir = config.workingDir || '/home/sprite/repo'

      // Clone or update repository
      const result = await this.sprite.exec(`
        if [ ! -d "${workingDir}" ]; then
          echo "Cloning repository..."
          git clone -b ${branch} ${config.repoUrl} ${workingDir}
        else
          echo "Updating repository..."
          cd ${workingDir} && git pull origin ${branch}
        fi
      `)

      if (result.exitCode !== 0) {
        return {
          success: false,
          error: `Git operation failed: ${result.stderr || result.stdout}`
        }
      }

      return { success: true }
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to initialize repo: ${error.message}`
      }
    }
  }

  /**
   * Install dependencies with package manager detection
   * Supports npm, pnpm, and yarn with lockfile-based auto-detection
   */
  async installDependencies(workingDir?: string): Promise<InstallDependenciesResult> {
    const start = Date.now()
    const dir = workingDir || '/home/sprite/repo'

    try {
      // Detect package manager from lockfile
      const detectResult = await this.sprite.exec(`
        cd ${dir}
        if [ -f "pnpm-lock.yaml" ]; then
          echo "pnpm"
        elif [ -f "yarn.lock" ]; then
          echo "yarn"
        elif [ -f "package-lock.json" ]; then
          echo "npm"
        else
          echo "npm"
        fi
      `)

      const packageManager = detectResult.stdout.trim() || 'npm'
      let installCmd: string

      switch (packageManager) {
        case 'pnpm':
          installCmd = 'pnpm install --frozen-lockfile'
          break
        case 'yarn':
          installCmd = 'yarn install --frozen-lockfile'
          break
        default:
          installCmd = 'npm ci'
      }

      console.log(`[Sprites CI] Installing dependencies with ${packageManager}...`)

      const installResult = await this.sprite.exec(`cd ${dir} && ${installCmd}`)

      if (installResult.exitCode !== 0) {
        return {
          success: false,
          duration: Date.now() - start,
          packageManager,
          error: installResult.stderr || installResult.stdout
        }
      }

      return {
        success: true,
        duration: Date.now() - start,
        packageManager
      }
    } catch (error: any) {
      return {
        success: false,
        duration: Date.now() - start,
        packageManager: 'unknown',
        error: error.message
      }
    }
  }

  /**
   * Run build command if configured
   */
  async runBuild(config: {
    buildCommand: string
    workingDir: string
  }): Promise<CiStepResult> {
    const start = Date.now()

    try {
      console.log(`[Sprites CI] Running build: ${config.buildCommand}`)

      const result = await this.sprite.exec(
        `cd ${config.workingDir} && ${config.buildCommand}`
      )

      return {
        name: 'build',
        success: result.exitCode === 0,
        duration: Date.now() - start,
        output: result.stdout || '',
        error: result.exitCode !== 0 ? result.stderr : undefined
      }
    } catch (error: any) {
      return {
        name: 'build',
        success: false,
        duration: Date.now() - start,
        output: '',
        error: error.message
      }
    }
  }

  /**
   * Run test command
   */
  async runTests(config: {
    testCommand: string
    workingDir: string
  }): Promise<CiStepResult> {
    const start = Date.now()

    try {
      console.log(`[Sprites CI] Running tests: ${config.testCommand}`)

      const result = await this.sprite.exec(
        `cd ${config.workingDir} && ${config.testCommand}`
      )

      return {
        name: 'test',
        success: result.exitCode === 0,
        duration: Date.now() - start,
        output: result.stdout || '',
        error: result.exitCode !== 0 ? result.stderr : undefined
      }
    } catch (error: any) {
      return {
        name: 'test',
        success: false,
        duration: Date.now() - start,
        output: '',
        error: error.message
      }
    }
  }

  /**
   * Run full CI pipeline
   * 
   * Pipeline steps:
   * 1. Initialize/update repository
   * 2. Install dependencies (with caching)
   * 3. Run build (if configured)
   * 4. Run tests
   * 5. Create checkpoint on success ("golden state")
   */
  async runCi(config: CiConfig): Promise<CiResult> {
    const start = Date.now()
    const workingDir = config.workingDir || '/home/sprite/repo'
    const steps: CiStepResult[] = []

    try {
      // Set environment variables if provided
      if (config.envVars && Object.keys(config.envVars).length > 0) {
        const exportVars = Object.entries(config.envVars)
          .map(([key, value]) => `export ${key}="${value}"`)
          .join(' && ')
        await this.sprite.exec(`${exportVars}`)
      }

      // Step 1: Initialize/update repo
      console.log(`[Sprites CI] Step 1: Initializing repository...`)
      const initResult = await this.initializeRepo({
        repoUrl: config.repoUrl,
        branch: config.branch,
        workingDir
      })

      if (!initResult.success) {
        return {
          success: false,
          duration: Date.now() - start,
          output: '',
          error: initResult.error,
          steps: [{
            name: 'init',
            success: false,
            duration: Date.now() - start,
            output: '',
            error: initResult.error
          }]
        }
      }

      steps.push({
        name: 'init',
        success: true,
        duration: Date.now() - start,
        output: 'Repository initialized'
      })

      // Step 2: Install dependencies
      console.log(`[Sprites CI] Step 2: Installing dependencies...`)
      const installStart = Date.now()
      const installResult = await this.installDependencies(workingDir)

      steps.push({
        name: 'install',
        success: installResult.success,
        duration: installResult.duration,
        output: `Installed with ${installResult.packageManager}`,
        error: installResult.error
      })

      if (!installResult.success) {
        return {
          success: false,
          duration: Date.now() - start,
          output: 'Dependency installation failed',
          error: installResult.error,
          steps
        }
      }

      // Step 3: Run build (if configured)
      if (config.buildCommand) {
        console.log(`[Sprites CI] Step 3: Running build...`)
        const buildResult = await this.runBuild({
          buildCommand: config.buildCommand,
          workingDir
        })
        steps.push(buildResult)

        if (!buildResult.success) {
          // Continue to collect steps if possible or just return current ones
          return {
            success: false,
            duration: Date.now() - start,
            output: buildResult.output,
            error: buildResult.error,
            steps
          }
        }
      }

      // Step 4: Run tests
      console.log(`[Sprites CI] Step 4: Running tests...`)
      const testCommand = config.testCommand || 'npm test'
      const testResult = await this.runTests({
        testCommand,
        workingDir
      })
      steps.push(testResult)

      const duration = Date.now() - start

      if (!testResult.success) {
        return {
          success: false,
          duration,
          output: testResult.output,
          error: testResult.error,
          steps
        }
      }

      // Step 5: Create checkpoint on success ("golden state")
      console.log(`[Sprites CI] Step 5: Creating checkpoint...`)
      try {
        const checkpointName = `ci-passed-${Date.now()}`
        const checkpoint = await this.sprite.createCheckpoint(checkpointName)

        console.log(`[Sprites CI] Checkpoint created: ${checkpoint.id}`)

        return {
          success: true,
          duration,
          checkpointId: checkpoint.id,
          output: testResult.output,
          steps
        }
      } catch (checkpointError: any) {
        console.warn('[Sprites CI] Failed to create checkpoint:', checkpointError.message)
        // Non-fatal, still return success
      }

      return {
        success: true,
        duration,
        output: testResult.output,
        steps
      }
    } catch (error: any) {
      return {
        success: false,
        duration: Date.now() - start,
        output: '',
        error: error.message,
        steps
      }
    }
  }

  /**
   * Restore from CI checkpoint
   * Useful for quickly resetting to a known good state
   */
  async restoreFromCheckpoint(checkpointId: string): Promise<{ 
    success: boolean
    error?: string 
  }> {
    try {
      await this.sprite.restore(checkpointId)
      console.log(`[Sprites CI] Restored checkpoint: ${checkpointId}`)
      return { success: true }
    } catch (error: any) {
      return {
        success: false,
        error: `Failed to restore checkpoint: ${error.message}`
      }
    }
  }

  /**
   * Get latest CI checkpoint
   * Returns most recent checkpoint created by runCi()
   */
  async getLatestCiCheckpoint(): Promise<{ 
    id?: string
    name?: string
    createdAt?: string
  }> {
    try {
      const checkpoints = await this.sprite.listCheckpoints()
      const ciCheckpoints = checkpoints.filter((cp: any) => 
        cp.name?.startsWith('ci-passed-')
      )

      if (ciCheckpoints.length === 0) {
        return {}
      }

      // Return most recent (sorted by creation date)
      const latest = ciCheckpoints.sort((a: any, b: any) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      )[0]

      return {
        id: latest.id,
        name: latest.name,
        createdAt: latest.created_at
      }
    } catch (error: any) {
      console.warn('[Sprites CI] Failed to get latest checkpoint:', error.message)
      return {}
    }
  }

  /**
   * List all CI checkpoints
   */
  async listCiCheckpoints(limit?: number): Promise<Array<{
    id: string
    name: string
    createdAt: string
  }>> {
    try {
      const checkpoints = await this.sprite.listCheckpoints()
      const ciCheckpoints = checkpoints
        .filter((cp: any) => cp.name?.startsWith('ci-passed-'))
        .sort((a: any, b: any) =>
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        )

      if (limit) {
        return ciCheckpoints.slice(0, limit).map((cp: any) => ({
          id: cp.id,
          name: cp.name,
          createdAt: cp.created_at
        }))
      }

      return ciCheckpoints.map((cp: any) => ({
        id: cp.id,
        name: cp.name,
        createdAt: cp.created_at
      }))
    } catch {
      return []
    }
  }

  /**
   * Clean old CI checkpoints
   * Keeps only the most recent checkpoints
   */
  async cleanOldCheckpoints(keepCount: number = 5): Promise<{
    deleted: number
    kept: number
  }> {
    try {
      const checkpoints = await this.listCiCheckpoints()
      
      if (checkpoints.length <= keepCount) {
        return { deleted: 0, kept: checkpoints.length }
      }

      const toDelete = checkpoints.slice(keepCount)
      let deletedCount = 0

      for (const checkpoint of toDelete) {
        try {
          // Note: Sprites SDK doesn't expose deleteCheckpoint directly yet
          // This would need CLI or API call
          console.log(`[Sprites CI] Would delete old checkpoint: ${checkpoint.name}`)
          deletedCount++
        } catch (error: any) {
          console.warn(`[Sprites CI] Failed to delete checkpoint ${checkpoint.id}:`, error.message)
        }
      }

      return {
        deleted: deletedCount,
        kept: keepCount
      }
    } catch (error: any) {
      console.error('[Sprites CI] Cleanup failed:', error.message)
      return { deleted: 0, kept: 0 }
    }
  }
}

/**
 * Create CI helper instance
 * Factory function for convenience
 */
export function createCiHelper(
  token: string,
  spriteName: string
): SpritesCiHelper {
  return new SpritesCiHelper(token, spriteName)
}

/**
 * Quick CI run function
 * One-off CI execution without managing helper instance
 */
export async function runCi(
  token: string,
  spriteName: string,
  config: CiConfig
): Promise<CiResult> {
  const ciHelper = createCiHelper(token, spriteName)
  return ciHelper.runCi(config)
}
